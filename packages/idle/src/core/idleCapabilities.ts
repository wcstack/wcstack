/**
 * idleCapabilities.ts
 *
 * Idle Detection node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。idle は requestPermission()/start()/stop() の単一コマンド経路で、競合する
 * operation を持たない(2 回目の start() は前を stop() してから開始する supersede)ため
 * lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * この node の `_setError` は 2 形態の入力を受ける:
 *   1. synthetic な非対応マーカー(`{ message: "IdleDetector is not supported…" }`、
 *      `.name` 無し)— `globalThis.IdleDetector` 不在。
 *   2. caught された rejection を包んだ `{ error: e }`(`e.name` が実 Error.name)。
 * 両者を message coupling 無しに弁別するため、呼び出し側が明示的な `name` ヒントを渡す
 * (storage の `deriveStorageErrorInfo(error, name)` / screen-orientation と同じ
 * discriminator 技法)。非対応経路は `"unsupported"` を、caught 経路は wrap した
 * `e?.name` を渡す。
 *
 * requestPermission()/start() の実 rejection 名は spec のとおり gesture 文脈外 /
 * 権限未許可で `NotAllowedError`。それ以外(生の Error / TypeError(threshold 不正)/
 * `.name` 欠如の nullish reject 等)は一括して `idle-error`。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した idle error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_IDLE_ERROR_CODE = {
  /** Idle Detection API 非対応(`globalThis.IdleDetector` 不在)。 */
  CapabilityMissing: "capability-missing",
  /** `NotAllowedError` — 権限拒否 / user-gesture 文脈外。retry では回復しない。 */
  NotAllowed: "not-allowed",
  /** その他の requestPermission()/start() 失敗(生 throw / TypeError / nullish reject 等)。 */
  IdleError: "idle-error",
} as const;

/**
 * idle の失敗を serializable な error taxonomy に写す。
 *
 * `name` は呼び出し側が渡す discriminator:synthetic 非対応なら `"unsupported"`、
 * caught 例外なら wrap した `e?.name`(生の非 Error / nullish reject では `undefined`)。
 * `message` は wrap を解いた下位値から抽出済みの文言(非対応なら synthetic の message)。
 *
 * - `"unsupported"` は利用直前の能力欠如 → phase="probe" / capability-missing。
 * - `NotAllowedError` は requestPermission()/start() の権限ゲート失敗 → phase="start" /
 *   not-allowed / recoverable=false(gesture 違反と実 "denied" は区別しない設計 §4.1)。
 * - それ以外(生の throw、TypeError、`.name` 欠如等)は実行中の失敗 → phase="execute" /
 *   idle-error / recoverable=false。
 */
export function deriveIdleErrorInfo(name: string | undefined, message: string): WcsIoErrorInfo {
  if (name === "unsupported") {
    return { code: WCS_IDLE_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
  }
  if (name === "NotAllowedError") {
    return { code: WCS_IDLE_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
  }
  return { code: WCS_IDLE_ERROR_CODE.IdleError, phase: "execute", recoverable: false, message };
}
