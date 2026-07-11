/**
 * stream/streamRegistry.ts
 *
 * `$streams` の registry（docs/state-streams-design.md §2-1 / §5）。
 * eventTokenRegistry と対称の WeakMap registry。
 *
 * - status / error の正本は registry entry（state オブジェクト上に実プロパティは持たない）。
 * - disconnect 時は abortAllStreams（abort のみ・registry 保持）、
 *   `_state` 再 set 時のみ clearStreamRegistry（abort ＋ 全削除）。
 */

import type { IStateElement } from "../components/types";
import { deleteActiveStateElement } from "./activeStateElements";
import { invalidateLastNotified } from "./lastNotified";
import type { IStreamEntry } from "./types";

const registryByStateElement: WeakMap<IStateElement, Map<string, IStreamEntry>> = new WeakMap();

/**
 * stream entry 群を置換登録する（`_state` セッターからの再構築で丸ごと差し替える）。
 */
export function setStreamEntries(stateElement: IStateElement, entries: Map<string, IStreamEntry>): void {
  registryByStateElement.set(stateElement, entries);
}

/**
 * 登録済みの stream entry 群を返す。未登録なら空 Map を返す（registry への登録はしない）。
 */
export function getStreamEntries(stateElement: IStateElement): Map<string, IStreamEntry> {
  return registryByStateElement.get(stateElement) ?? new Map<string, IStreamEntry>();
}

/**
 * 全 stream を abort して idle に戻す（設計書 §5-1）。registry は保持する。
 *
 * disconnectedCallback（切断時）に呼ばれるため、status / error の反映は
 * proxy / $postUpdate を使わず entry への直接ミューテーションで行う
 * （切断済みで binding 更新は不要かつ rootNode が無い）。
 *
 * 無通知ミューテーションは「最後に通知した観測値」台帳（stream/lastNotified.ts）
 * と registry を乖離させるため、同時に台帳側を invalidate する。これを怠ると
 * 再接続ウィンドウ内の fresh 読み（他パスの drain での getter 再計算など）が
 * 描画した idle に対し、restart の updateStreamStatus("active") が切断前の
 * 通知値と同値判定されて skip され、DOM が恒久的に陳腐化する（設計書 §4-3）。
 */
export function abortAllStreams(stateElement: IStateElement): void {
  // 依存駆動 restart の対象から外す（切断済み stateElement は restart しない、
  // 設計書 §3-2。add 側は startStreams — stream/activeStateElements.ts の
  // リーク防止不変条件を参照）。registry の有無に関わらず必ず外す。
  deleteActiveStateElement(stateElement);
  const entries = registryByStateElement.get(stateElement);
  if (typeof entries === "undefined") {
    return;
  }
  for (const entry of entries.values()) {
    entry.controller?.abort();
    entry.controller = null;
    entry.status = "idle";
    entry.error = null;
    invalidateLastNotified(stateElement, entry.name);
  }
}

/**
 * 全 stream を abort したうえで registry から削除する（`_state` 再 set 時の再配線用、設計書 §5-2）。
 */
export function clearStreamRegistry(stateElement: IStateElement): void {
  abortAllStreams(stateElement);
  // abortAllStreams が既に delete 済みだが、「clear = 全削除でも必ず restart 対象から
  // 外れる」不変条件を将来の abortAllStreams の変更から独立に保証するため明示的に呼ぶ。
  deleteActiveStateElement(stateElement);
  registryByStateElement.delete(stateElement);
}

export const __private__ = {
  registryByStateElement,
};
