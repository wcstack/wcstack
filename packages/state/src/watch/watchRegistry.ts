/**
 * watch/watchRegistry.ts
 *
 * `$watch` の registry と、drain リスナーの走査元になる「発火対象の stateElement 集合」
 * （docs/state-watch-hook-design.md §9）。
 *
 * `$streams` は registry（delete 側）と runtime（add 側）が相互に依存するため
 * active 集合を stream/activeStateElements.ts へ切り出しているが、`$watch` は
 * **add が State のライフサイクル側、delete が registry 側**で、runtime は読むだけの
 * 一方向依存になる。よって循環せず、1 モジュールにまとめられる。
 *
 * リーク防止の不変条件（strong Set が切断済み要素の GC を妨げないための連動）:
 * - add は `State.connectedCallback`（$connectedCallback 完了後）だけが行う。
 * - delete は `clearWatchRegistry`（`_state` 再 set / disconnectedCallback）だけが行う。
 * どちらの経路も必ずここを通るため「Set に居る = 接続中かつ宣言済み」が保たれる。
 */

import type { IStateElement } from "../components/types";
import type { IWatchEntry } from "./types";

const registryByStateElement: WeakMap<IStateElement, Map<string, IWatchEntry>> = new WeakMap();
const activeStateElements = new Set<IStateElement>();

/**
 * watch entry 群を置換登録する（`_state` セッターからの再構築で丸ごと差し替える）。
 */
export function setWatchEntries(stateElement: IStateElement, entries: Map<string, IWatchEntry>): void {
  registryByStateElement.set(stateElement, entries);
}

/**
 * 登録済みの watch entry 群を返す。未登録なら空 Map を返す（registry への登録はしない）。
 */
export function getWatchEntries(stateElement: IStateElement): Map<string, IWatchEntry> {
  return registryByStateElement.get(stateElement) ?? new Map<string, IWatchEntry>();
}

/**
 * 発火対象として登録する（`State.connectedCallback` 専用。不変条件はモジュールヘッダ参照）。
 */
export function addActiveWatchStateElement(stateElement: IStateElement): void {
  activeStateElements.add(stateElement);
}

/**
 * 発火対象を列挙する（drain リスナーの early return 判定用）。
 */
export function getActiveWatchStateElements(): ReadonlySet<IStateElement> {
  return activeStateElements;
}

/**
 * 発火対象から外す（切断時）。**registry は保持する。**
 *
 * `$streams` の abortAllStreams と同じ二段構えで、切断は「発火しなくなる」だけにする。
 * registry まで捨てると、再接続（connectedCallback → startWatch）で宣言を作り直す経路が
 * 無い（`_state` セッターは初回ロード時にしか走らない）ため、watch が二度と発火しない。
 */
export function deactivateWatch(stateElement: IStateElement): void {
  activeStateElements.delete(stateElement);
}

/**
 * registry から削除し、発火対象からも外す（`_state` 再 set 時の再配線用）。
 */
export function clearWatchRegistry(stateElement: IStateElement): void {
  activeStateElements.delete(stateElement);
  registryByStateElement.delete(stateElement);
}

export const __private__ = {
  registryByStateElement,
  activeStateElements,
};
