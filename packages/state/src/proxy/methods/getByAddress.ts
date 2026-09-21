/**
 * getByAddress.ts
 *
 * StateClassの内部APIとして、構造化パス情報（IStructuredPathInfo）とリストインデックス（IListIndex）を指定して
 * 状態オブジェクト（target）から値を取得するための関数（getByAddress）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を取得（多重ループやワイルドカードにも対応）
 * - 依存関係の自動登録（checkDependencyで登録）
 * - キャッシュ機構（リストもキャッシュ対象）
 * - getter経由で値取得時はpushAddressでスコープを一時設定
 * - 存在しない場合は親pathAddressやlistIndexを辿って再帰的に値を取得
 *
 * 設計ポイント:
 * - checkDependencyで依存追跡を実行  
 * - キャッシュ有効時はstateAddressで値をキャッシュし、取得・再利用を最適化
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値取得を実現
 * - finallyでキャッシュへの格納を保証
 */

import { liftAddress } from "../../address/liftAddress";
import { IStateAddress } from "../../address/types";
import { getCacheEntryByAbsoluteStateAddress, setCacheEntryByAbsoluteStateAddress } from "../../cache/cacheEntryByAbsoluteStateAddress";
import { getCommandNamespace } from "../../command/commandNamespace";
import { IStateElement } from "../../components/types";
import { STATE_COMMAND_NAMESPACE_NAME, WILDCARD } from "../../define";
import { missingRootPathMessage, wildcardScopeMessage } from "../../pathDiagnostics";
import { raiseError } from "../../raiseError";
import { NOT_HANDLED } from "../../core/addressHooks";
import { IStateHandler } from "../types";
import { checkDependency } from "./checkDependency";
import { isCacheable } from "./isCacheable";

/**
 * namespace 配下のパスは raw state を持たないため、proxy の get トラップと同じ
 * namespace オブジェクトを辿る。1セグメント目は namespace 本体、2セグメント目以降は
 * namespace 上のキーを順に走査する。走査値が object / function 以外（null /
 * undefined / primitive の葉）になったら undefined を返す — 葉より深い読み
 * （例: `$streamStatus.<name>.<key>`、error が primitive throw のときの
 * `$streamError.<name>.message`）は宣言外アクセスと同じ undefined 解決とし、
 * Reflect.get の non-object TypeError を updater の drain に漏らさない
 * （§4-1 の throw しない寛容規約）。
 */
function walkNamespace(namespace: object, segments: string[]): any {
  let value: any = namespace;
  for (let i = 1; i < segments.length; i++) {
    // Object(v) !== v は「v が object / function でない」（= primitive / null / undefined）判定
    if (Object(value) !== value) {
      return undefined;
    }
    value = Reflect.get(value, segments[i]);
  }
  return value;
}

// 「ツリーに意見が無い」読み（親が無い・親にそのキーが無い）を機能に聞く（設計案 H1 の readMissing）。
// 親が無ければ parentValue は null。hook の無い state は判定 1 個で抜ける
function readMissing(
  stateElement: IStateElement,
  address: IStateAddress,
  parentValue: object | null,
  receiver: any,
  handler: IStateHandler,
): unknown {
  const hooks = stateElement.addressHooks;
  if (hooks) {
    const missing = hooks.readMissing;
    for (let i = 0; i < missing.length; i++) {
      const handled = missing[i](stateElement, address, parentValue, receiver, handler);
      if (handled !== NOT_HANDLED) return handled;
    }
  }
  return NOT_HANDLED;
}

function _getByAddress(
  target   : object,
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler,
  stateElement: IStateElement,
): any {
  const firstSegment = address.pathInfo.segments[0];
  if (firstSegment === STATE_COMMAND_NAMESPACE_NAME) {
    // $command 名前空間: キーは宣言済み command token 名
    return walkNamespace(getCommandNamespace(stateElement), address.pathInfo.segments);
  }
  // $streamStatus / $streamError（stream/addressHooks.ts）とマーカーで終わるパスのオーバーレイ
  // （webComponent/addressHooks.ts）は getByAddress の read hook が先に答える（宣言・マウントのある state だけに付く）
  if (address.pathInfo.path in target) {
    // getterの中で参照の可能性があるので、addressをプッシュする
    if (stateElement.getterPaths.has(address.pathInfo.path)) {
      handler.pushAddress(address);
      try {
        return Reflect.get(target, address.pathInfo.path, receiver);
      } finally {
        handler.popAddress();
      }

    } else {
      return Reflect.get(target, address.pathInfo.path);
    }
  } else {
    // 親アドレスが無い ＝ 単一セグメントのパスが state に存在しない。ここは元から
    // throw していたが、文面が内部実装の言葉だったので打ち間違いだと分からなかった。
    // 深いパスの console.warn（pathDiagnostics.checkDeclaredPath）と語彙を揃える。
    // 親が無い（＝ ルート欠落）: ツリーに意見が無いので readMissing hook（予約済みボリューム
    // スロットの配下なら undefined — D22）に先に聞き、無ければ raise する
    if (address.parentAddress === null) {
      const missing = readMissing(stateElement, address, null, receiver, handler);
      if (missing !== NOT_HANDLED) {
        return missing;
      }
      raiseError(missingRootPathMessage(address.pathInfo.path, target, stateElement.getterPaths));
    }
    const parentAddress = address.parentAddress;
    const parentValue = getByAddress(target, parentAddress, receiver, handler);
    // 親が居ないパスの読みは undefined（＝「state に意見が無い」）。`Reflect.get` に
    // そのまま渡すと生の `TypeError: Reflect.get called on non-object` になり、
    // updater の drain も行ループも捕まえないので **1 本の stale な読みが同じバッチの
    // 無関係な更新まで道連れにする**（§1.7 / §1.9 と同じ構図）。
    //
    // 実際に踏むのは「消えた行を指すバインディングが、その行を消す `for` より先に
    // 適用される」形。同一スコープならトポロジカル順で `for` が先に来るので起きないが、
    // bind-component は親スコープの通知と子スコープの `for` が別経路で流れるため
    // 順序が保証されない（docs/state-bind-component-nested-for-design.md）。
    // undefined はプロパティ書き込みがスキップされる値なので DOM は触られず、
    // 直後に `for` が行ごと外して整合する。
    if (parentValue === null || typeof parentValue === "undefined") {
      return undefined;
    }
    const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
    // 「ツリーの未存在キー」の分岐だけ readMissing hook（公開 getter の dispatch など）に聞く
    // （X1 — 命中する読みは無改造）。hook の無い state は判定 1 個で抜ける
    const hooks = stateElement.addressHooks;
    if (hooks && hooks.readMissing.length !== 0 && lastSegment !== WILDCARD
      && !(lastSegment in Object(parentValue))) {
      const missing = readMissing(stateElement, address, Object(parentValue), receiver, handler);
      if (missing !== NOT_HANDLED) {
        return missing;
      }
    }
    if (lastSegment === WILDCARD) {
      // listIndex が無いまま末尾ワイルドカードに到達 ＝ そのパスの階数を満たす
      // ループ文脈が無い（`matrix.*.*` を 1 段の `for` の中で読む等）。元の文面は
      // 内部の言葉（address.listIndex?.index is undefined）で、何段必要なのかが
      // 書かれていなかった（pathDiagnostics.ts）。
      const index = address.listIndex?.index ?? raiseError(
        wildcardScopeMessage(
          `path "${address.pathInfo.path}"`,
          address.pathInfo.wildcardCount,
          address.listIndex?.length ?? 0,
        ),
      );
      return Reflect.get(parentValue, index);
    } else {
      return Reflect.get(parentValue, lastSegment);
    }
  }
}

function _getByAddressWithCache(
  target   : object, 
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler,
  stateElement: IStateElement
): any {
  const absAddress = liftAddress(stateElement, address);
  const cacheEntry = getCacheEntryByAbsoluteStateAddress(absAddress);
  // 世代印（issue #258 の X10）。絶対アドレスは再セットを跨いで同一なので、dirty だけでは
  // 旧世代の値と新世代の値を見分けられない。世代の違う項目は単に miss として再評価し、
  // 下で新しい印を付けて上書きする（列挙も掃き出しも要らず、どのアドレス形状でも自己修復する）。
  const generation = stateElement.stateGeneration;
  if (cacheEntry !== null && cacheEntry.dirty === false && cacheEntry.generation === generation) {
    return cacheEntry.value;
  }
  const value = _getByAddress(target, address, receiver, handler, stateElement);
  setCacheEntryByAbsoluteStateAddress(absAddress, {
    value: value,
    dirty: false,
    generation: generation
  });
  return value;
}

export function getByAddress(
  target   : object,
  address  : IStateAddress,
  receiver : any,
  handler  : IStateHandler
): any {
  // 再帰 getter の遅延実体化（Phase B）。**キャッシュ参照より前**でなければならない。
  // 未定義のまま一度読まれると isCacheable が wildcardCount > 0 だけでキャッシュ可を
  // 返すので undefined が dirty:false で固定され、後からアクセサを生やしても恒久的に
  // 直らない（Phase A の A7）。宣言の無い state は boolean 判定 1 個で抜け、宣言のある
  // state も 2 回目からは PathInfo キーの記憶 1 回で抜ける（書き側と対称・第 5 サイクル）。
  checkDependency(handler, address);
  if (handler.stateElement.hasRecursion === true) {
    handler.stateElement.recursionRegistry!.materializeForPathInfo(handler.stateElement, address.pathInfo);
  }
  const stateElement = handler.stateElement;
  // 読み書き境界の hook（設計案 H1）: 宣言が要求した機能の分だけ state に付いている。無ければ判定 1 回
  const hooks = stateElement.addressHooks;
  if (hooks) {
    const readHooks = hooks.read;
    for (let i = 0; i < readHooks.length; i++) {
      const handled = readHooks[i](stateElement, address, receiver, handler);
      if (handled !== NOT_HANDLED) return handled;
    }
  }
  const cacheable = isCacheable(stateElement, address);
  if (cacheable) {
    return _getByAddressWithCache(target, address, receiver, handler, stateElement);
  } else {
    return _getByAddress(target, address, receiver, handler, stateElement);
  }
}
