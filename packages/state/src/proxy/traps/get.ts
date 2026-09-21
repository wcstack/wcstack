/**
 * get.ts
 *
 * StateClassのProxyトラップとして、プロパティアクセス時の値取得処理を担う関数（get）の実装です。
 *
 * 主な役割:
 * - 文字列プロパティの場合、特殊プロパティ（$1〜、$stateElement, $getAll, $setAll, $postUpdate,
 *   $resolve, $trackDependency, $command, $streamStatus, $streamError）に応じた値やAPIを返却
 * - 通常のプロパティはgetResolvedPathInfoでパス情報を解決し、getListIndexでリストインデックスを取得
 * - getByRefで構造化パス・リストインデックスに対応した値を取得
 * - シンボルプロパティの場合はhandler.callableApi経由でAPIを呼び出し
 * - それ以外はReflect.getで通常のプロパティアクセスを実行
 *
 * 設計ポイント:
 * - $1〜$128（MAX_WILDCARD_DEPTH）は直近のStatePropertyRefのリストインデックス値を返す特殊プロパティ
 * - $getAll, $resolve 等はAPI関数を、$command / $streamStatus / $streamError は名前空間を返す
 * - 通常のプロパティアクセスもバインディングや多重ループに対応
 * - シンボルAPIやReflect.getで拡張性・互換性も確保
 */

import { getResolvedAddress } from "../../address/ResolvedAddress";
import { createStateAddress } from "../../address/StateAddress";
import { IAbsoluteStateAddress, IStateAddress } from "../../address/types";
import { getCommandNamespace } from "../../command/commandNamespace";
import { DELIMITER, INDEX_BY_INDEX_NAME, INDEX_PARAM_PREFIX, MAX_WILDCARD_DEPTH, STATE_COMMAND_NAMESPACE_NAME, STATE_STREAM_ERROR_NAMESPACE_NAME, STATE_STREAM_STATUS_NAMESPACE_NAME } from "../../define";
import { listIndexAtWildcard } from "../../list/wildcardLevel";
import { getIndexShiftForMarkerPath, getMountRecordByPath } from "../../webComponent/mount";
import { raiseError } from "../../raiseError";
import { getStreamErrorNamespace, getStreamStatusNamespace } from "../../stream/streamNamespace";
import { connectedCallback } from "../apis/connectedCallback";
import { disconnectedCallback } from "../apis/disconnectedCallback";
import { getAll } from "../apis/getAll";
import { postUpdate } from "../apis/postUpdate";
import { resolve } from "../apis/resolve";
import { ISetAllOptions, setAll } from "../apis/setAll";
import { trackDependency } from "../apis/trackDependency";
import { untrackDependency } from "../apis/untrackDependency";
import { registerIndexKeyedDependency, registerIndexWatcher, registerKeyedDependency } from "../../dependency/keyedDependency";
import { getListIndexesByList } from "../../list/listIndexesByList";
import { liftAddress as liftAddressForKeyed } from "../../address/liftAddress";
import { updatedCallback } from "../apis/updatedCallback";
import { errorCallback } from "../apis/errorCallback";
import { getByAddress } from "../methods/getByAddress";
import { hasByAddress } from "../methods/hasByAddress";
import { getListIndex } from "../methods/getListIndex";
import { setByAddress } from "../methods/setByAddress";
import { setLoopContext } from "../methods/setLoopContext";
import { connectedCallbackSymbol, disconnectedCallbackSymbol, errorCallbackSymbol, getByAddressSymbol, hasByAddressSymbol, setByAddressSymbol, setLoopContextSymbol, updatedCallbackSymbol } from "../symbols";
import type { IBindingErrorInfo } from "../../types";
import { bindRecursivePath } from "../../recursion/bind";
import { hasRecursionWildcard } from "../../recursion/expand";
import { IStateHandler } from "../types";

/** `$` + 数字だけの prop（`$1` / `$129`）。範囲外を無言で通さないための判別。 */
const INDEX_PARAM_RE = /^\$\d+$/;

// `$streamStatus.<name>` / `$streamError.<name>` の dotted パス判定用プレフィックス
const STREAM_STATUS_PATH_PREFIX = `${STATE_STREAM_STATUS_NAMESPACE_NAME}${DELIMITER}`;
const STREAM_ERROR_PATH_PREFIX = `${STATE_STREAM_ERROR_NAMESPACE_NAME}${DELIMITER}`;

// symbol API のクロージャは handler（= proxy と 1:1、target/receiver 不変）ごとに
// 使い回す。drain の getValue が binding ごとに getByAddressSymbol を引くため、
// 毎回の新規クロージャ生成が GC 圧・固定費になっていた。
const symbolApiCacheByHandler = new WeakMap<IStateHandler, Map<symbol, unknown>>();

function getSymbolApiCache(handler: IStateHandler): Map<symbol, unknown> {
  let cache = symbolApiCacheByHandler.get(handler);
  if (typeof cache === "undefined") {
    cache = new Map<symbol, unknown>();
    symbolApiCacheByHandler.set(handler, cache);
  }
  return cache;
}

export function get(
  target  : object, 
  prop    : PropertyKey, 
  receiver: any,
  handler : IStateHandler
): any {
  const index = INDEX_BY_INDEX_NAME[prop];
  // `$` で始まらない読み（＝通常のパス読みのほぼ全部）は charCode 1 個で抜ける。
  // 表引き失敗だけを条件にすると `$1`..`$N` 以外の**全プロパティ読み**が正規表現に
  // 触れることになり、行数×バインド数ぶん get トラップを回すリスト描画で効いてくる。
  if (typeof index === "undefined" && typeof prop === "string"
    && prop.charCodeAt(0) === 36 /* '$' */ && INDEX_PARAM_RE.test(prop)) {
    // `$1`..`$N` の表は MAX_WILDCARD_DEPTH ぶんしか無い。表引きに失敗した `$<数字>` は
    // これまで通常のプロパティ解決へ落ちて診断ゼロで undefined になっていた（`$128` は
    // 0 を返すのに `$129` だけが無言で壊れる）。境界のすぐ外側こそ名指しする
    // （docs/state-recursive-path-impl-plan.md §3-2 の E3）。綴り不正（`$0` / `$01`）も
    // 同じ入口で落ちるので、範囲だけでなく綴りも文面に含める。
    raiseError(
      `[wcs/index-param-range] "${prop}" is not a valid list index parameter: they run from ` +
      `${INDEX_PARAM_PREFIX}1 to ${INDEX_PARAM_PREFIX}${MAX_WILDCARD_DEPTH}, with no leading zeros.`,
    );
  }
  if (typeof index !== "undefined") {
    if (handler.addressStackLength === 0) {
      raiseError(`No active state reference to get list index for "${prop.toString()}".`);
    }
    const lastAddress = handler.lastAddressStack;
    // getter 評価中のインデックス読み取りを記録する。位置だけが変わった行
    // （listDiff.changeIndexSet）は index 以外の入力が不変なので、walkDependency の
    // 静的子展開を「インデックスを読んだ getter の subtree」に限定できる。
    // $untrackDependency スコープ中／setter 実行中は記録しない。
    const lastInfo = lastAddress?.pathInfo;
    if (lastInfo && !handler.untracking && handler.stateElement?.getterPaths.has(lastInfo.path)) {
      handler.stateElement.addIndexDependentGetterPath?.(lastInfo.path);
    }
    const listIndex = lastAddress?.listIndex;
    if (typeof listIndex === "undefined" || listIndex === null) {
      raiseError(`ListIndex not found: ${prop.toString()}`);
    }
    // `$1` は「このスコープの」1 段目。base 深さ Δ を持つ子スコープでも
    // 番号がずれないよう末尾から数える（list/wildcardLevel.ts）
    let scopedIndex = index;
    const lastPathInfo = lastAddress!.pathInfo;
    // マウントのアクセサ評価中（マーカーパスが push されている）はスコープ相対の Δ を
    // 足す（設計書 §4-4: `$n → listIndex.at(Δ + n - 1)`。テンプレート側の `$n` は
    // 変換時に織り込み済み — webComponent/mount.ts の translateInnerPath）
    if (handler.stateElement?.hasMounts === true && lastPathInfo.path.indexOf('#') !== -1) {
      const mountRecord = getMountRecordByPath(handler.stateElement, lastPathInfo.path);
      if (mountRecord !== null) {
        scopedIndex = index + getIndexShiftForMarkerPath(mountRecord, lastPathInfo.path);
      }
    }
    const indexListIndex = listIndexAtWildcard(listIndex, scopedIndex, lastPathInfo.wildcardCount);
    return indexListIndex?.index ?? raiseError(`ListIndex not found: ${prop.toString()}`);
  }
  if (typeof prop === "string") {
    if (prop[0] === '$') {
      switch (prop) {
        case "$stateElement": {
          return handler.stateElement;
        }
        case "$getAll": {
          return (path: string, indexes?: number[]): any[] => {
            return getAll(
              target, 
              prop, 
              receiver,
              handler
            )(path, indexes);
          }
        }
        case "$setAll": {
          return (path: string, indexes: number[], value: any, options?: ISetAllOptions): number => {
            return setAll(
              target,
              prop,
              receiver,
              handler
            )(path, indexes, value, options);
          }
        }
        case "$postUpdate": {
          return (path: string): void => {
            return postUpdate(
              target, 
              prop, 
              receiver,
              handler
            )(path);
          }
        }
        case "$resolve": {
          return (path: string, indexes: number[], ...value: [value?: any]): any => {
            return resolve(
              target, 
              prop, 
              receiver,
              handler
            )(path, indexes, ...value);
          }
        }
        case "$trackDependency": {
          return (path: string): void => {
            return trackDependency(
              target,
              prop,
              receiver,
              handler
            )(path);
          }
        }
        case "$eq": {
          // 鍵付き購読（dependency/keyedDependency.ts）: `path` を依存に張らず読み、評価中の
          // getter がリスト行のものならその行を `key` の下に登録する。`path` への書き込みは
          // 旧値・新値の鍵の行だけを再評価する（選択のような「1 行だけ真」の getter 向け）
          return (path: string, key: unknown): boolean => {
            // getter の外（メソッド・コールバック）ではアドレススタックが空: 比較だけ返す
            const lastAddress = handler.addressStackLength > 0 ? handler.lastAddressStack : null;
            handler.beginUntrack();
            let current: unknown;
            try {
              current = receiver[path];
            } finally {
              handler.endUntrack();
            }
            if (lastAddress !== null && handler.stateElement.getterPaths.has(lastAddress.pathInfo.path)) {
              registerKeyedDependency(handler.stateElement, path, key, liftAddressForKeyed(handler.stateElement, lastAddress), current);
            }
            return Object.is(current, key);
          };
        }
        case "$eqPath": {
          // `$eq` の鍵を keyPath から依存を張らずに読む形（dependency/keyedDependency.ts）。
          // 追跡付きで行 id を読むと動的辺がリスト置換で全行に展開されるので、ここで抑止する
          return (path: string, keyPath: string): boolean => {
            const lastAddress = handler.addressStackLength > 0 ? handler.lastAddressStack : null;
            handler.beginUntrack();
            let current: unknown;
            let key: unknown;
            try {
              current = receiver[path];
              key = receiver[keyPath];
            } finally {
              handler.endUntrack();
            }
            if (lastAddress !== null && handler.stateElement.getterPaths.has(lastAddress.pathInfo.path)) {
              registerKeyedDependency(handler.stateElement, path, key, liftAddressForKeyed(handler.stateElement, lastAddress), current);
            }
            return Object.is(current, key);
          };
        }
        case "$eqIndex": {
          // `$eq` の鍵を評価中の行の index（`$1` = level 1）にする形。`$1` の読み取りと違い
          // getter を index 依存には記録しない: 行の移動はリスト差分が鍵を付け替える
          // （dependency/keyedDependency.ts の rekeyIndexSubscriptions）
          return (path: string, level: number = 1): boolean => {
            const lastAddress = handler.addressStackLength > 0 ? handler.lastAddressStack : null;
            if (lastAddress === null || lastAddress.listIndex === null) {
              raiseError(`$eqIndex("${path}") needs a list row scope.`);
            }
            const levelListIndex = listIndexAtWildcard(lastAddress.listIndex, level - 1, lastAddress.pathInfo.wildcardCount);
            if (levelListIndex === null) {
              raiseError(`$eqIndex("${path}", ${level}): no list index at that level.`);
            }
            // 最内段（getter 自身の行の段）はリスト単位の監視で O(1)、外側の段は行ごとの購読
            const innermost = level === lastAddress.pathInfo.wildcardCount;
            handler.beginUntrack();
            let current: unknown;
            let listValue: unknown;
            try {
              current = receiver[path];
              if (innermost) {
                listValue = receiver[lastAddress.pathInfo.wildcardParentPaths[level - 1]];
              }
            } finally {
              handler.endUntrack();
            }
            if (handler.stateElement.getterPaths.has(lastAddress.pathInfo.path)) {
              // 描画済みの行の親リストは必ず台帳（listIndexesByList）を持つ
              const indexes = innermost ? getListIndexesByList(listValue as readonly unknown[]) : null;
              if (indexes !== null) {
                registerIndexWatcher(handler.stateElement, path, lastAddress.pathInfo, indexes, current);
              } else {
                registerIndexKeyedDependency(handler.stateElement, path, levelListIndex, liftAddressForKeyed(handler.stateElement, lastAddress), current);
              }
            }
            return Object.is(current, levelListIndex.index);
          };
        }
        case "$untrackDependency": {
          return <T>(fn: () => T): T => {
            return untrackDependency(
              target,
              prop,
              receiver,
              handler
            )(fn);
          }
        }
        case STATE_COMMAND_NAMESPACE_NAME: {
          return getCommandNamespace(handler.stateElement);
        }
        case STATE_STREAM_STATUS_NAMESPACE_NAME: {
          return getStreamStatusNamespace(handler.stateElement);
        }
        case STATE_STREAM_ERROR_NAMESPACE_NAME: {
          return getStreamErrorNamespace(handler.stateElement);
        }
      }
      // switch 不一致の $ プロパティのうち、`$streamStatus.<name>` / `$streamError.<name>`
      // の dotted パスだけは通常のパス解決（getByAddress）へフォールスルーさせる。
      // これが computed（getter）内での依存追跡付き読み取りの正規形
      // （checkDependency が getter スコープで動的依存を登録し、$postUpdate の
      //  walkDependency で computed が無効化される、docs/state-streams-design.md §4-3）。
      // それ以外の未知 $ プロパティは従来どおり undefined を返す。
      if (!prop.startsWith(STREAM_STATUS_PATH_PREFIX) && !prop.startsWith(STREAM_ERROR_PATH_PREFIX)) {
        return undefined;
      }
    }
    // オーサリング層の `**` を、いま評価している再帰 getter の深さへ束縛する。
    // 宣言の無い state は boolean 判定 1 個で抜ける（D18 の形）。
    const path = (handler.stateElement?.hasRecursion === true && hasRecursionWildcard(prop))
      ? bindRecursivePath(handler.stateElement, handler, prop)
      : prop;
    const resolvedAddress = getResolvedAddress(path);
    const listIndex = getListIndex(target, resolvedAddress, receiver, handler);
    const stateAddress = createStateAddress(resolvedAddress.pathInfo, listIndex);
    return getByAddress(
      target,
      stateAddress,
      receiver,
      handler
    );
  } else if (typeof prop === "symbol") {
    const cache = getSymbolApiCache(handler);
    const cached = cache.get(prop);
    if (typeof cached !== "undefined") {
      return cached;
    }
    let api: unknown;
    switch (prop) {
      case setLoopContextSymbol: {
        api = (loopContext: any, callback = (): any => {}): any => {
          return setLoopContext(handler, loopContext, callback);
        };
        break;
      }
      case getByAddressSymbol: {
        api = (address: IStateAddress): any => {
          return getByAddress(
            target,
            address,
            receiver,
            handler
          );
        }
        break;
      }
      case hasByAddressSymbol: {
        api = (address: IStateAddress): boolean => {
          return hasByAddress(
            target,
            address,
            receiver,
            handler
          );
        }
        break;
      }
      case setByAddressSymbol: {
        api = (address: IStateAddress, value: any): void => {
          return setByAddress(
            target,
            address,
            value,
            receiver,
            handler
          );
        }
        break;
      }
      case connectedCallbackSymbol: {
        api = (): Promise<void> => {
          return connectedCallback(
            target,
            connectedCallbackSymbol,
            receiver,
            handler
          );
        }
        break;
      }
      case disconnectedCallbackSymbol: {
        api = (): void => {
          return disconnectedCallback(
            target,
            disconnectedCallbackSymbol,
            receiver,
            handler
          );
        }
        break;
      }
      case updatedCallbackSymbol: {
        api = (
          refs: IAbsoluteStateAddress[]
        ): unknown => {
          return updatedCallback(
            target,
            refs,
            receiver,
            handler
          );
        }
        break;
      }
      case errorCallbackSymbol: {
        api = (error: unknown, info: IBindingErrorInfo): void => {
          return errorCallback(
            target,
            error,
            info,
            receiver,
            handler
          );
        }
        break;
      }
      default: {
        return Reflect.get(
          target,
          prop,
          receiver
        );
      }
    }
    cache.set(prop, api);
    return api;
  }
}
