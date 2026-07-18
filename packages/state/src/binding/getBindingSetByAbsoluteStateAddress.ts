import { createAbsoluteStateAddress } from "../address/AbsoluteStateAddress";
import { IAbsolutePathInfo, IAbsoluteStateAddress } from "../address/types";
import { devtoolsSink } from "../devtools/sink";
import { IListIndex } from "../list/types";
import { IBindingInfo } from "./types";

/**
 * 絶対アドレス → 登録 binding の台帳。
 *
 * リスト行の絶対アドレスは (absolutePathInfo, listIndex) の組ごとに一意で、
 * 登録される binding は通常 1 本しかない。アドレスごとに Set を確保すると
 * 行×binding の数だけ Set アロケーションが積み上がるため、単一値で持ち
 * 2 本目から Set に昇格する（interestedSessionsByNode と同じ前例）。
 */
const bindingsByAbsoluteStateAddress: WeakMap<IAbsoluteStateAddress, IBindingInfo | Set<IBindingInfo>> = new WeakMap();

/**
 * 参照専用の取得。未登録アドレスにエントリを生成・キャッシュしない
 * （リスト置換の drain は大量のバインディング無しアドレスを照会するため、
 * 生成すると空エントリが溜まり続ける）。
 * 戻り値は単一 binding（登録 1 本）か Set（2 本以上）のどちらか。
 * 呼び出し側は Set を変異してはならない（instanceof で分岐できるよう
 * ReadonlySet でなく Set 型で返す）。
 */
export function peekBindingsByAbsoluteStateAddress(
  absoluteStateAddress: IAbsoluteStateAddress,
): IBindingInfo | Set<IBindingInfo> | undefined {
  return bindingsByAbsoluteStateAddress.get(absoluteStateAddress);
}

export function addBindingByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, binding: IBindingInfo): void {
  const current = bindingsByAbsoluteStateAddress.get(absoluteStateAddress);
  if (typeof current === "undefined") {
    bindingsByAbsoluteStateAddress.set(absoluteStateAddress, binding);
  } else if (current instanceof Set) {
    current.add(binding);
  } else if (current !== binding) {
    bindingsByAbsoluteStateAddress.set(absoluteStateAddress, new Set([current, binding]));
  }
  if (devtoolsSink !== null) {
    devtoolsSink({ type: "state:binding-added", absoluteAddress: absoluteStateAddress, binding });
  }
}

export function clearBindingSetByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress): void {
  bindingsByAbsoluteStateAddress.delete(absoluteStateAddress);
  if (devtoolsSink !== null) {
    devtoolsSink({ type: "state:binding-cleared", absoluteAddress: absoluteStateAddress });
  }
}

export function removeBindingByAbsoluteStateAddress(absoluteStateAddress: IAbsoluteStateAddress, binding: IBindingInfo): void {
  const current = bindingsByAbsoluteStateAddress.get(absoluteStateAddress);
  if (typeof current === "undefined") {
    return;
  }
  if (current instanceof Set) {
    current.delete(binding);
  } else if (current === binding) {
    bindingsByAbsoluteStateAddress.delete(absoluteStateAddress);
  }
  if (devtoolsSink !== null) {
    devtoolsSink({ type: "state:binding-removed", absoluteAddress: absoluteStateAddress, binding });
  }
}

/**
 * パターン索引台帳（リスト行バインディング専用・docs/state-row-instantiation-redesign.md §3-3）。
 *
 * 行バインディングは (absolutePathInfo, listIndex) の 2 段キーで登録し、登録側では
 * AbsoluteStateAddress の intern（アドレスオブジェクト割当 + listIndex ごとの
 * intern 用 WeakMap）を一切行わない。書き込み側（setByAddress → enqueue）は従来
 * どおり intern 済みアドレスを使うため、drain はアドレスの構成要素
 * （absolutePathInfo / listIndex — どちらもオブジェクト同一性が保証済み）で
 * このパターン台帳を引ける。リオーダーは listIndex 同一性キーの帰結として
 * 従来同様ゼロタッチ。wholesale destroy は従来同様削除ゼロ（listIndex ごと GC 崩壊）。
 *
 * devtools 計装（state:binding-added/removed）はプロトコル契約なので、sink 接続時に
 * 限りアドレスを intern してイベントを流す（フック未接続時のコストは分岐 1 個の規範を維持）。
 */
const patternLedger: WeakMap<IAbsolutePathInfo, WeakMap<IListIndex, IBindingInfo | Set<IBindingInfo>>> = new WeakMap();

export function addBindingByPattern(absolutePathInfo: IAbsolutePathInfo, listIndex: IListIndex, binding: IBindingInfo): void {
  let rowMap = patternLedger.get(absolutePathInfo);
  if (typeof rowMap === "undefined") {
    rowMap = new WeakMap();
    patternLedger.set(absolutePathInfo, rowMap);
  }
  const current = rowMap.get(listIndex);
  if (typeof current === "undefined") {
    rowMap.set(listIndex, binding);
  } else if (current instanceof Set) {
    current.add(binding);
  } else if (current !== binding) {
    rowMap.set(listIndex, new Set([current, binding]));
  }
  if (devtoolsSink !== null) {
    devtoolsSink({ type: "state:binding-added", absoluteAddress: createAbsoluteStateAddress(absolutePathInfo, listIndex), binding });
  }
}

export function removeBindingByPattern(absolutePathInfo: IAbsolutePathInfo, listIndex: IListIndex, binding: IBindingInfo): void {
  const rowMap = patternLedger.get(absolutePathInfo);
  if (typeof rowMap === "undefined") {
    return;
  }
  const current = rowMap.get(listIndex);
  if (typeof current === "undefined") {
    return;
  }
  if (current instanceof Set) {
    current.delete(binding);
  } else if (current === binding) {
    rowMap.delete(listIndex);
  }
  if (devtoolsSink !== null) {
    devtoolsSink({ type: "state:binding-removed", absoluteAddress: createAbsoluteStateAddress(absolutePathInfo, listIndex), binding });
  }
}

/**
 * drain（updater）用の統合参照。従来台帳 → パターン台帳の順に引く。
 * 従来台帳を先に引くのは、listIndex 付きでも旧経路（SSR ハイドレーション等）で
 * アドレス台帳に登録される可能性を許容するため（取りこぼし防止）。
 */
export function peekBindingsForAddress(
  absoluteStateAddress: IAbsoluteStateAddress,
): IBindingInfo | Set<IBindingInfo> | undefined {
  const entry = bindingsByAbsoluteStateAddress.get(absoluteStateAddress);
  if (typeof entry !== "undefined") {
    return entry;
  }
  if (absoluteStateAddress.listIndex === null) {
    return undefined;
  }
  return patternLedger.get(absoluteStateAddress.absolutePathInfo)?.get(absoluteStateAddress.listIndex);
}
