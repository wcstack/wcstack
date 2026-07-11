/**
 * stream/activeStateElements.ts
 *
 * 起動中（startStreams 済み・未切断）の stateElement の列挙用 Set
 * （docs/state-streams-design.md §3-2）。
 *
 * streamRegistry の WeakMap は列挙不能のため、updater の drain リスナーが
 * 「どの stateElement の entry と batch を交差させるか」を知るには
 * 列挙可能な strong Set が別途必要になる。lastNotified.ts と同じ
 * 「import 循環回避の小モジュール」パターン
 * （streamRegistry → activeStateElements ← streamRuntime の一方向依存に保つ）。
 *
 * リーク防止の不変条件（strong Set が切断済み要素の GC を妨げないための連動）:
 * - add は startStreams（streamRuntime.ts）だけが行う
 *   （eager 起動＝connect 時、および接続中の `_state` 再 set 時の再起動）。
 * - delete は abortAllStreams / clearStreamRegistry（streamRegistry.ts）が行う。
 *   disconnect（disconnectedCallback → abortAllStreams）と `_state` 再 set
 *   （clearStreamRegistry → processStreamsDeclaration → 接続中なら startStreams で
 *   再 add）の両経路が必ずここを通るため、「Set に居る = 接続中かつ起動済み」が
 *   常に保たれ、切断済み stateElement への強参照は残らない。
 *   設計書 §3-2 の「未接続（disconnect 済み）の stateElement の entry は restart
 *   しない」はこの不変条件で担保される。
 */

import type { IStateElement } from "../components/types";

const activeStateElements = new Set<IStateElement>();

/**
 * 起動中 stateElement として登録する（startStreams 専用。不変条件はモジュールヘッダ参照）。
 */
export function addActiveStateElement(stateElement: IStateElement): void {
  activeStateElements.add(stateElement);
}

/**
 * 起動中 stateElement から外す（abortAllStreams / clearStreamRegistry 専用）。
 */
export function deleteActiveStateElement(stateElement: IStateElement): void {
  activeStateElements.delete(stateElement);
}

/**
 * 起動中 stateElement を列挙する（drain リスナーの交差判定用）。
 */
export function getActiveStateElements(): ReadonlySet<IStateElement> {
  return activeStateElements;
}

export const __private__ = {
  activeStateElements,
};
