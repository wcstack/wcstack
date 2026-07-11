/**
 * stream/lastNotified.ts
 *
 * 「最後に通知した観測値」台帳 — DOM binding / $updatedCallback（観測層）が
 * 最後に見た status・error（docs/state-streams-design.md §4-3）。
 *
 * 通知の same-value 判定を entry フィールドとの比較で行うと、再 set
 * （clearStreamRegistry → 新 entry 生成）を跨いだ陳腐化を検出できない
 * （error 表示中に再 set すると新 entry は error=null で生まれるため
 * null → null と誤判定して $postUpdate が落ち、DOM に旧 error が残る）。
 * そのため通知 dedup は entry の寿命ではなく stateElement の寿命で持つ
 * （ただし再 set で新宣言から消えた名前のエントリは pruneLastNotified で削除する —
 *  同名にしか dedup は要らず、放置すると台帳が単調増加するため）。
 * 未通知（初回）の基準値は宣言直後の観測初期値と同じ { idle, null }。
 *
 * さらに abortAllStreams（§5-1）は registry entry を通知なしで idle / null に
 * 直接ミューテーションするため、観測層が「台帳の値」と「idle / null」の
 * どちらを見たか確定できなくなる（binding / computed の fresh 読みは通知が
 * なくても他パスの drain で走る）。その乖離フィールドは invalidateLastNotified
 * で UNCERTAIN に無効化し、次回 updateStreamStatus の同値判定が必ず
 * 「変化あり」になるようにする（再接続ウィンドウ内の idle 描画が恒久陳腐化
 * しないための不変条件、§4-3）。
 */

import type { IStateElement } from "../components/types";
import type { StreamStatus } from "./types";

/**
 * 無通知ミューテーション後の「観測値が確定できない」印。
 * どの実値とも一致しないため、次回の通知 dedup（`!==` / `Object.is`）を強制的に解除する。
 */
const UNCERTAIN: unique symbol = Symbol("wcs-stream-last-notified-uncertain");

export interface ILastNotified {
  status: StreamStatus | typeof UNCERTAIN;
  error: unknown;
}

const lastNotifiedByStateElement = new WeakMap<IStateElement, Map<string, ILastNotified>>();

/**
 * 最後に通知した観測値を返す。未通知なら基準値 { idle, null }。
 */
export function getLastNotified(stateElement: IStateElement, name: string): ILastNotified {
  return (
    lastNotifiedByStateElement.get(stateElement)?.get(name) ?? { status: "idle", error: null }
  );
}

/**
 * 通知した観測値を記録する（updateStreamStatus が $postUpdate 発行と同時に呼ぶ）。
 */
export function setLastNotified(
  stateElement: IStateElement,
  name: string,
  status: StreamStatus,
  error: unknown,
): void {
  let lastMap = lastNotifiedByStateElement.get(stateElement);
  if (typeof lastMap === "undefined") {
    lastMap = new Map();
    lastNotifiedByStateElement.set(stateElement, lastMap);
  }
  lastMap.set(name, { status, error });
}

/**
 * 再 set（clearStreamRegistry → processStreamsDeclaration）後に呼び、新宣言に
 * 存在しない名前の台帳エントリを削除する。台帳は stateElement の寿命で生存するが
 * （§4-3 の再 set・再接続跨ぎ dedup）、それが必要なのは同名エントリのみで、
 * 旧宣言にしか無い名前は以後どの通知経路（updateStreamStatus）からも参照されない。
 * prune しないと、再 set のたびに異なる stream 名を使うステートで台帳が
 * stateElement の寿命の間単調増加する。
 * 既知の許容: prune 後に同名を再宣言した場合、dedup は基準値 { idle, null } から
 * やり直しになる（宣言削除時の binding 陳腐化が §4-4 の既知エッジである以上、
 * 再宣言は新規宣言と同じ扱いでよい）。
 */
export function pruneLastNotified(stateElement: IStateElement, liveNames: ReadonlySet<string>): void {
  const lastMap = lastNotifiedByStateElement.get(stateElement);
  if (typeof lastMap === "undefined") {
    return;
  }
  for (const name of lastMap.keys()) {
    if (!liveNames.has(name)) {
      lastMap.delete(name);
    }
  }
}

/**
 * 無通知ミューテーション（abortAllStreams の idle / null 直接書き換え）の直後に呼び、
 * 台帳のうちミューテーション後の値と一致しないフィールドを UNCERTAIN に無効化する。
 * 一致しているフィールド（観測層がどちらを見ても同じ値）は dedup を維持する
 * （例: error が null のままなら再接続時に $streamError.<name> の余計な通知は出ない）。
 */
export function invalidateLastNotified(stateElement: IStateElement, name: string): void {
  const lastMap = lastNotifiedByStateElement.get(stateElement);
  if (typeof lastMap === "undefined") {
    return;
  }
  const last = lastMap.get(name);
  if (typeof last === "undefined") {
    // 未通知: 基準値 { idle, null } はミューテーション後の値と一致するため乖離しない
    return;
  }
  lastMap.set(name, {
    status: last.status === "idle" ? last.status : UNCERTAIN,
    error: Object.is(last.error, null) ? null : UNCERTAIN,
  });
}

export const __private__ = {
  lastNotifiedByStateElement,
  UNCERTAIN,
};
