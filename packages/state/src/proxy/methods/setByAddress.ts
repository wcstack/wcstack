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
import { DELIMITER, WILDCARD } from "../../define";
import { dispatchBindableEvent } from "../../dcc/dispatchBindableEvent";
import { createListIndex } from "../../list/createListIndex";
import { getListIndexesByList } from "../../list/listIndexesByList";
import { createListDiff } from "../../list/createListDiff";
import { collectFieldWrites, IKeyedListMerge, mergeKeyedList } from "../../list/mergeKeyedList";
import { IListIndex } from "../../list/types";
import { getPathInfo } from "../../address/PathInfo";
import { createStateAddress } from "../../address/StateAddress";
import { raiseError } from "../../raiseError";
import { getUpdater } from "../../updater/updater";
import { IStateHandler, IStateProxy } from "../types";
import { getByAddress } from "./getByAddress";
import { isCacheable } from "./isCacheable";
import { hasByAddress } from "./hasByAddress";
import { getSwapInfoByAddress, setSwapInfoByAddress } from "./swapInfo";
import { walkDependency } from "../../dependency/walkDependency";
import { dirtyCacheEntryByAbsoluteStateAddress, setCacheEntryByAbsoluteStateAddress } from "../../cache/cacheEntryByAbsoluteStateAddress";
import { getAbsolutePathInfo } from "../../address/AbsolutePathInfo";
import { config } from "../../config";
import { devtoolsSink } from "../../devtools/sink";
import { beginPropagationTransaction, getCurrentPropagationContext } from "../../propagation/propagation";
import { getListParentListIndex } from "../../webComponent/baseListIndex";
import { popCrossBoundaryAddress, pushCrossBoundaryAddress } from "../../webComponent/crossBoundaryAddress";
import { consumeOccurrenceWrite } from "../occurrenceWrite";

// Phase 3: 書き込み時点の因果 context を update record に付与する。
// binding 経由の書き込みは呼び出し元の dynamic scope から context を引き継ぎ、
// binding 外からの API update は新しい transaction を開始する（設計書 §4 規則 1）。
// 依存 walk で enqueue される派生アドレスも同じ書き込みの因果に属する。
function notifyWrite(
  address  : IStateAddress,
  absAddress: IAbsoluteStateAddress,
  receiver : any,
  handler  : IStateHandler,
  keyedMergePath: string | null
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
    { listExpansion: "diff", keyedMergePath }
  )
}

function _setByAddress(
  target   : object,
  address  : IStateAddress,
  absAddress: IAbsoluteStateAddress,
  value    : any,
  receiver : any,
  handler  : IStateHandler,
  keyedMergePath: string | null
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
      } else if (handler.stateElement.hasMappedComponentState === true) {
        // target は innerState proxy。set トラップにはパス文字列しか渡らないので、
        // 解決済みの listIndex を動的スコープで越境させる（§1.8）
        pushCrossBoundaryAddress(handler.stateElement, address);
        try {
          return Reflect.set(target, address.pathInfo.path, value);
        } finally {
          popCrossBoundaryAddress();
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
    notifyWrite(address, absAddress, receiver, handler, keyedMergePath);
  }
}

function _setByAddressWithSwap(
  target   : object,
  address  : IStateAddress,
  absAddress: IAbsoluteStateAddress,
  value    : any,
  receiver : any,
  handler  : IStateHandler,
  keyedMergePath: string | null
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
    return _setByAddress(target, address, absAddress, value, receiver, handler, keyedMergePath);
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

/**
 * `$listKeys` 宣言済みリストパスへの配列代入を「キー一致行のオブジェクト値展開」に
 * 変換する（docs/state-list-key-design.md §2）。
 *
 * 1. キー突合して、一致行は旧オブジェクトを据え置いたハイブリッド配列を作る
 * 2. ハイブリッド配列を通常の書き込み経路で格納する
 * 3. createListDiff で listIndex を確定し、変化フィールドだけを per-path 書き込みで発行
 *
 * 3 を格納後に行うのが要点。フィールド書き込みは `list.*.field` を親経由で解決する
 * ため、親（ハイブリッド配列）が既に格納されていなければ正しい行に届かない。
 * また per-path 書き込みは再び setByAddress に入るので、ネストしたリストパスが
 * 宣言されていればそのレベルのキー突合が再帰的に走る（§4）。
 *
 * 未宣言時のコストは stateElement.listKeys の null 判定 1 回のみ（§7-1）。
 */
function setKeyedListByAddress(
    target   : object,
    address  : IStateAddress,
    merge    : IKeyedListMerge,
    oldList  : readonly unknown[],
    receiver : any,
    handler  : IStateHandler
): any {
  const listPath = address.pathInfo.path;
  // diff の基準は「マージ相手にした配列」= 書き込み直前に格納されていた配列。
  // 読み手（applyChangeToFor / $getAll / resolve）は現在格納されている配列の
  // listIndex 台帳（listIndexesByList）へ収束するため、同じ基準で引くことで
  // 書き込みが dirty 化・キャッシュするアドレスと読み手のアドレスが一致する。
  // lastValue（最後に *適用* された配列）を基準にすると、for が未マウントで
  // lastValue が空のときに別台帳を作ってしまい、値は入っているのにワイルドカード
  // 読みだけ旧値のまま残る（設計書 §8.1）。
  // 格納より前に引くのは、格納時の walkDependency（listExpansion: "diff"）が
  // 先にハイブリッド配列の台帳を作ってしまうと、後から上書きした台帳との間で
  // 同じ分裂が起きるため。先に確定させておけば以降は全経路がこれに合流する。
  const listParentListIndex = getListParentListIndex(handler.stateElement, address.listIndex);
  if (getListIndexesByList(oldList) === null) {
    // 一度も描画されていないリストは台帳自体が無い。先に生やしておかないと
    // isSameList 経路が空の oldIndexes をそのまま新台帳にしてしまう。
    createListDiff(listParentListIndex, null, oldList);
  }
  const diff = createListDiff(listParentListIndex, oldList, merge.list);
  const result = setByAddressCore(target, address, merge.list, receiver, handler, listPath);
  const elementPathInfo = getPathInfo(listPath + DELIMITER + WILDCARD);
  for (const match of merge.matched) {
    const fieldWrites = collectFieldWrites(match.oldRow, match.newRow);
    if (fieldWrites.length === 0) {
      continue;
    }
    // createListDiff の契約上 newIndexes の長さはハイブリッド配列と一致するため
    // 通常 undefined にはならない。仮に不変条件が破れても、per-path 書き込みを
    // 諦めるだけで値そのものは行オブジェクトへ反映する（skip すると state だけが
    // 旧値のまま残り、本機能が塞ごうとしている stale を作ってしまう）。
    const listIndex: IListIndex | undefined = diff.newIndexes[match.position];
    for (const write of fieldWrites) {
      if (typeof listIndex === "undefined") {
        match.oldRow[write.field] = write.value;
        continue;
      }
      const fieldPathInfo = getPathInfo(elementPathInfo.path + DELIMITER + write.field);
      const fieldAddress = createStateAddress(fieldPathInfo, listIndex);
      setByAddress(target, fieldAddress, write.value, receiver, handler);
    }
  }
  return result;
}

export function setByAddress(
    target   : object,
    address  : IStateAddress,
    value    : any,
    receiver : any,
    handler  : IStateHandler
): any {
  const listKeys = handler.stateElement.listKeys;
  if (listKeys != null && Array.isArray(value)) {
    const keySpec = listKeys.get(address.pathInfo.path);
    if (typeof keySpec !== "undefined") {
      const oldValue = getByAddress(target, address, receiver, handler);
      const merge = mergeKeyedList(address.pathInfo.path, keySpec, oldValue, value);
      if (merge !== null) {
        // merge が非 null なのは oldValue が非空配列のときだけ（mergeKeyedList 参照）
        return setKeyedListByAddress(target, address, merge, oldValue as readonly unknown[], receiver, handler);
      }
    }
  }
  return setByAddressCore(target, address, value, receiver, handler, null);
}

function setByAddressCore(
    target   : object,
    address  : IStateAddress,
    value    : any,
    receiver : any,
    handler  : IStateHandler,
    keyedMergePath: string | null
): any {
  const stateElement = handler.stateElement;
  const path = address.pathInfo.path;
  // occurrence（wc-bindable の `semantics: "event"`）由来の書き込みは、同値でも
  // 「もう一度起きた」ことを落としてはならないため same-value guard を 1 回だけ飛ばす。
  // トークンはここで消費されるので、この write の内側で走る他の書き込みには波及しない。
  const skipSameValueGuard = consumeOccurrenceWrite();

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
      if (!skipSameValueGuard && config.sameValueGuard && (value === null || typeof value !== "object")) {
        // hasByAddress と同じ「初期化済みスロットか」判定（undefined 格納と未初期化を区別）
        const has = key !== undefined && key in parentValue;
        const oldValue = key !== undefined ? (parentValue as Record<PropertyKey, unknown>)[key] : undefined;
        if (has && Object.is(oldValue, value)) {
          return true;
        }
        devOldValue = oldValue;
        devHasOldValue = true;
      }
      const cacheable = isCacheable(stateElement, address);
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
        notifyWrite(address, absAddress, receiver, handler, keyedMergePath);
        if (cacheable) {
          setCacheEntryByAbsoluteStateAddress(absAddress, {
            value: value,
            dirty: false
          });
        }
        // DCC bindable イベントディスパッチ（完全一致 ＋ サブパス → 先頭セグメント、§2.1）
        dispatchBindableEvent(stateElement, address.pathInfo, { value });
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
  if (!skipSameValueGuard && config.sameValueGuard && (value === null || typeof value !== "object")) {
    const oldValue = getByAddress(target, address, receiver, handler);
    if (hasByAddress(target, address, receiver, handler) && Object.is(oldValue, value)) {
      return true;
    }
    devOldValue = oldValue;
    devHasOldValue = true;
  }
  // --- end same-value guard ---
  const isSwappable = stateElement.elementPaths.has(address.pathInfo.path);
  const cacheable = isCacheable(stateElement, address);
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
      return _setByAddressWithSwap(target, address, absAddress, value, receiver, handler, keyedMergePath);
    } else {
      return _setByAddress(target, address, absAddress, value, receiver, handler, keyedMergePath);
    }
  } finally {
    if (cacheable) {
      setCacheEntryByAbsoluteStateAddress(absAddress, {
        value: value,
        dirty: false
      });
    }
    // DCC bindable イベントディスパッチ（完全一致 ＋ サブパス → 先頭セグメント、§2.1）
    dispatchBindableEvent(stateElement, address.pathInfo, { value });
  }
}

