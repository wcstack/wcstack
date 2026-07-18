/**
 * setByAddress.ts
 *
 * Stateの内部APIとして、アドレス情報（IStateAddress）を指定して
 * 状態オブジェクト（target）に値を設定するための関数（setByAddress）の実装です。
 *
 * 主な役割:
 * - 指定されたパス・インデックスに対応するState値を設定（多重ループやワイルドカードにも対応）
 * - getter/setter経由で値設定時はpushAddressでスコープを一時設定
 * - 存在しない場合は親pathInfoやlistIndexを辿って再帰的に値を設定
 * - 設定後はupdater.enqueueUpdateAddressで更新情報を登録
 *
 * 設計ポイント:
 * - ワイルドカードや多重ループにも柔軟に対応し、再帰的な値設定を実現
 * - finallyで必ず更新情報を登録し、再描画や依存解決に利用
 * - getter/setter経由のスコープ切り替えも考慮した設計
 */

import { createAbsoluteStateAddress } from "../../address/AbsoluteStateAddress";
import { IAbsoluteStateAddress, IStateAddress } from "../../address/types";
import { WILDCARD } from "../../define";
import { createListIndex } from "../../list/createListIndex";
import { getListIndexesByList } from "../../list/listIndexesByList";
import { raiseError } from "../../raiseError";
import { getUpdater } from "../../updater/updater";
import { IStateHandler, IStateProxy } from "../types";
import { getByAddress } from "./getByAddress";
import { hasByAddress } from "./hasByAddress";
import { getSwapInfoByAddress, setSwapInfoByAddress } from "./swapInfo";
import { walkDependency } from "../../dependency/walkDependency";
import { dirtyCacheEntryByAbsoluteStateAddress, setCacheEntryByAbsoluteStateAddress } from "../../cache/cacheEntryByAbsoluteStateAddress";
import { getAbsolutePathInfo } from "../../address/AbsolutePathInfo";
import { config } from "../../config";
import { devtoolsSink } from "../../devtools/sink";
import { beginPropagationTransaction, getCurrentPropagationContext } from "../../propagation/propagation";

// Phase 3: 書き込み時点の因果 context を update record に付与する。
// binding 経由の書き込みは呼び出し元の dynamic scope から context を引き継ぎ、
// binding 外からの API update は新しい transaction を開始する（設計書 §4 規則 1）。
// 依存 walk で enqueue される派生アドレスも同じ書き込みの因果に属する。
function notifyWrite(
  address  : IStateAddress,
  absAddress: IAbsoluteStateAddress,
  receiver : any,
  handler  : IStateHandler
): void {
  const propagationContext = config.enablePropagationContext
    ? (getCurrentPropagationContext() ?? beginPropagationTransaction(-1))
    : null;
  const updater = getUpdater();
  updater.enqueueAbsoluteAddress(absAddress, propagationContext);
  // 依存関係のあるキャッシュを無効化（ダーティ）、更新対象として登録
  walkDependency(
    handler.stateName,
    handler.stateElement,
    address,
    handler.stateElement.staticDependency,
    handler.stateElement.dynamicDependency,
    handler.stateElement.listPaths,
    receiver as IStateProxy,
    "new",
    (depAddress: IStateAddress) => {
      // キャッシュを無効化（ダーティ）
      if (depAddress === address) return;
      const absDepPathInfo = getAbsolutePathInfo(handler.stateElement, depAddress.pathInfo);
      const absDepAddress = createAbsoluteStateAddress(absDepPathInfo, depAddress.listIndex);
      dirtyCacheEntryByAbsoluteStateAddress(absDepAddress);
      // 更新対象として登録
      updater.enqueueAbsoluteAddress(absDepAddress, propagationContext);
    },
    // リスト置換時は追加行・位置変更行のみ展開する（未変更行の再訪を省く。
    // $postUpdate の手動リフレッシュは従来通り全行展開のまま）
    { listExpansion: "diff" }
  )
}

function _setByAddress(
  target   : object,
  address  : IStateAddress,
  absAddress: IAbsoluteStateAddress,
  value    : any,
  receiver : any,
  handler  : IStateHandler
): any {
  try {
    if (address.pathInfo.path in target) {
      if (handler.stateElement.setterPaths.has(address.pathInfo.path)) {
        // setterの中で参照の可能性があるので、addressをプッシュする。
        // setter は命令的な代入であって派生（getter）ではないため、実行中の
        // 読み取り（同値ガードの旧値読み・$1 参照等）で依存を張らない。
        // アクセサペア（get/set 同名パス）では、抑止しないと setter 内の内部
        // 書き込みの同値ガード読みが「getter の依存」として誤登録される。
        handler.pushAddress(address);
        handler.beginUntrack();
        try {
          return Reflect.set(target, address.pathInfo.path, value, receiver);
        } finally {
          handler.endUntrack();
          handler.popAddress();
        }
      } else {
        return Reflect.set(target, address.pathInfo.path, value);
      }
    } else {
      const parentAddress = address.parentAddress;
      if (parentAddress === null) {
        return Reflect.set(target, address.pathInfo.path, value);
      }
      const parentValue = getByAddress(target, parentAddress, receiver, handler);
      const lastSegment = address.pathInfo.segments[address.pathInfo.segments.length - 1];
      if (lastSegment === WILDCARD) {
        const index = address.listIndex?.index ?? raiseError(`address.listIndex?.index is undefined path: ${address.pathInfo.path}`);
        return Reflect.set(parentValue, index, value);
      } else {
        return Reflect.set(parentValue, lastSegment, value);
      }
    }
  } finally {
    notifyWrite(address, absAddress, receiver, handler);
  }
}

function _setByAddressWithSwap(
  target   : object, 
  address  : IStateAddress,
  absAddress: IAbsoluteStateAddress,
  value    : any, 
  receiver : any,
  handler  : IStateHandler
) {
  // elementsの場合はswapInfoを準備
  let parentAddress = address.parentAddress ?? raiseError(`address.parentAddress is undefined path: ${address.pathInfo.path}`);
  let swapInfo = getSwapInfoByAddress(parentAddress);
  if (swapInfo === null) {
    const parentValue = getByAddress(target, parentAddress, receiver, handler) ?? [];
    const listIndexes = getListIndexesByList(parentValue) ?? [];
    swapInfo = {
      value: [...parentValue], listIndexes: [...listIndexes]
    }
    setSwapInfoByAddress(parentAddress, swapInfo);
  }
  try {
    return _setByAddress(target, address, absAddress, value, receiver, handler);
  } finally {
    const index = swapInfo.value.indexOf(value);
    const currentParentValue = getByAddress(target, parentAddress, receiver, handler) ?? [];
    const currentListIndexes = Array.isArray(currentParentValue) ? (getListIndexesByList(currentParentValue) ?? []) : [];
    const curIndex = address.listIndex!.index;
    const listIndex = (index !== -1) ? 
      swapInfo!.listIndexes[index] : 
      createListIndex(parentAddress.listIndex, -1);
    currentListIndexes[curIndex] = listIndex;
    // 重複チェック
    // 重複していない場合、swapが完了したとみなし、インデックスを更新
    const listValueSet = new Set(currentParentValue);
    if (listValueSet.size === swapInfo!.value.length) {
      for(let i = 0; i < currentListIndexes.length; i++) {
        currentListIndexes[i].index = i;
      }
      // 完了したのでswapInfoを削除
      setSwapInfoByAddress(parentAddress, null);
    }
  }
}

export function setByAddress(
    target   : object,
    address  : IStateAddress,
    value    : any,
    receiver : any,
    handler  : IStateHandler
): any {
  const stateElement = handler.stateElement;
  const path = address.pathInfo.path;

  // --- fast path: 宣言済み getter/setter でも swap 対象でもない、親を持つ葉パス ---
  // 従来は same-value guard の値読み・hasByAddress・実書き込みがそれぞれ親チェーンを
  // 解決していた（キャッシュヒットでも getByAddress 呼び出しの固定費 ×3）。
  // 親を 1 回だけ解決し、同じ親オブジェクトに対して guard 判定と Reflect.set を行う。
  // 非オブジェクト親などの例外形は従来経路へ倒し、挙動差を作らない。
  if (!(path in target) && address.parentAddress !== null && !stateElement.elementPaths.has(path)) {
    const parentValue = getByAddress(target, address.parentAddress, receiver, handler);
    if (typeof parentValue === "object" && parentValue !== null) {
      // ワイルドカード末尾で listIndex が無い不正アドレスは、従来どおり
      // 書き込み時（enqueue 済みの try 内）に raiseError する → key は undefined のまま持ち回す
      const lastSegment = address.pathInfo.lastSegment;
      const key: PropertyKey | undefined = lastSegment === WILDCARD
        ? address.listIndex?.index
        : lastSegment;
      let devOldValue: unknown;
      let devHasOldValue = false;
      if (config.sameValueGuard && (value === null || typeof value !== "object")) {
        // hasByAddress と同じ「初期化済みスロットか」判定（undefined 格納と未初期化を区別）
        const has = key !== undefined && key in parentValue;
        const oldValue = key !== undefined ? (parentValue as Record<PropertyKey, unknown>)[key] : undefined;
        if (has && Object.is(oldValue, value)) {
          return true;
        }
        devOldValue = oldValue;
        devHasOldValue = true;
      }
      const cacheable = address.pathInfo.wildcardCount > 0 ||
                        stateElement.getterPaths.has(path);
      const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
      const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
      if (devtoolsSink !== null) {
        devtoolsSink({
          type: "state:write",
          absoluteAddress: absAddress,
          value,
          oldValue: devOldValue,
          hasOldValue: devHasOldValue,
        });
      }
      try {
        if (key === undefined) {
          raiseError(`address.listIndex?.index is undefined path: ${path}`);
        }
        return Reflect.set(parentValue, key, value);
      } finally {
        notifyWrite(address, absAddress, receiver, handler);
        if (cacheable) {
          setCacheEntryByAbsoluteStateAddress(absAddress, {
            value: value,
            dirty: false
          });
        }
        // DCC bindable イベントディスパッチ
        const eventName = stateElement.bindableEventMap[path];
        if (eventName) {
          const rootNode = stateElement.rootNode;
          if (rootNode instanceof ShadowRoot) {
            rootNode.host.dispatchEvent(new CustomEvent(eventName, {
              detail: value,
              bubbles: true,
            }));
          }
        }
      }
    }
  }
  // --- end fast path ---

  // --- same-value guard (config.sameValueGuard・既定 ON) ---
  // primitive 値かつ Object.is 同値なら、set / enqueue / walkDependency / DOM 適用 /
  // $updatedCallback / DCC イベントを丸ごとスキップ（標準的なリアクティブ no-op）。
  // 参照型(object/array)は in-place mutation 取りこぼし防止のため素通し（ガードしない）。
  // devtools write イベント用: guard が既に取得した旧値のみ流用する
  // （参照型のために追加の get はしない — protocol §4.2）
  let devOldValue: unknown;
  let devHasOldValue = false;
  if (config.sameValueGuard && (value === null || typeof value !== "object")) {
    const oldValue = getByAddress(target, address, receiver, handler);
    if (hasByAddress(target, address, receiver, handler) && Object.is(oldValue, value)) {
      return true;
    }
    devOldValue = oldValue;
    devHasOldValue = true;
  }
  // --- end same-value guard ---
  const isSwappable = stateElement.elementPaths.has(address.pathInfo.path);
  const cacheable = address.pathInfo.wildcardCount > 0 ||
                    stateElement.getterPaths.has(address.pathInfo.path);
  const absPathInfo = getAbsolutePathInfo(stateElement, address.pathInfo);
  const absAddress = createAbsoluteStateAddress(absPathInfo, address.listIndex);
  if (devtoolsSink !== null) {
    devtoolsSink({
      type: "state:write",
      absoluteAddress: absAddress,
      value,
      oldValue: devOldValue,
      hasOldValue: devHasOldValue,
    });
  }
  try {
    if (isSwappable) {
      return _setByAddressWithSwap(target, address, absAddress, value, receiver, handler);
    } else {
      return _setByAddress(target, address, absAddress, value, receiver, handler);
    }
  } finally {
    if (cacheable) {
      setCacheEntryByAbsoluteStateAddress(absAddress, {
        value: value,
        dirty: false
      });
    }
    // DCC bindable イベントディスパッチ
    const eventName = stateElement.bindableEventMap[address.pathInfo.path];
    if (eventName) {
      const rootNode = stateElement.rootNode;
      if (rootNode instanceof ShadowRoot) {
        rootNode.host.dispatchEvent(new CustomEvent(eventName, {
          detail: value,
          bubbles: true,
        }));
      }
    }
  }
}

