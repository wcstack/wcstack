/**
 * screenOrientationCapabilities.ts
 *
 * Screen Orientation node 固有の error code(taxonomy)と derivation。汎用の error info
 * 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。screen.orientation の監視(change 購読)は同期で競合する operation を持た
 * ないため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * この node は bidirectional で、失敗は `lock()`/`unlock()` から来る。`_setError` は
 * 2 形態の入力を受ける:
 *   1. synthetic な `UNSUPPORTED_ERROR`(`{ message: "unsupported" }`、`.name` 無し)
 *      — API / メソッド自体が不在。
 *   2. caught された生の rejection / 例外(`.name` を持つ)。
 * 両者を message coupling 無しに弁別するため、呼び出し側が明示的な `name` ヒントを渡す
 * (storage の `deriveStorageErrorInfo(error, name)` と同じ discriminator 技法)。
 * unsupported 経路は `"unsupported"` を、caught 経路は `Error.name` を渡す。
 *
 * lock() の実 rejection 名は README.md §"lock() needs a fullscreen…" と Core JSDoc §5 の
 * とおり `NotAllowedError` / `NotSupportedError` / `SecurityError`(いずれも plain-tab で
 * lock が効かない同一の実務的結末=「name で分岐するな」)+ spec の `AbortError`(新しい
 * lock() に取って代わられた)。前者 3 名は同一 `not-allowed` に畳む(README のモデルに一致)。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した screen-orientation error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_SCREEN_ORIENTATION_ERROR_CODE = {
  /** `screen.orientation` / `lock()`・`unlock()` 自体が不在(synthetic "unsupported")。 */
  CapabilityMissing: "capability-missing",
  /**
   * `NotAllowedError` / `NotSupportedError` / `SecurityError` — 非 fullscreen /
   * plain-tab / feature-policy / sandbox で lock が効かない。README のモデルどおり
   * 三者は同一の実務的結末なので 1 code に畳む。retry では回復しない。
   */
  NotAllowed: "not-allowed",
  /** `AbortError` — より新しい `lock()` に取って代わられた。fresh lock は成功しうる。 */
  Aborted: "aborted",
  /** その他の `lock()`/`unlock()` 失敗。 */
  OrientationError: "orientation-error",
} as const;

/**
 * screen-orientation の失敗を serializable な error taxonomy に写す。
 *
 * `name` は呼び出し側が渡す discriminator:synthetic unsupported なら `"unsupported"`、
 * caught 例外なら `Error.name`(生の非 Error throw では `undefined`)。`message` は
 * 公開 `error` と同じ文言(unsupported なら "unsupported")。
 *
 * - `"unsupported"` は利用直前の能力欠如 → phase="probe" / capability-missing。
 * - `NotAllowedError` / `NotSupportedError` / `SecurityError` は lock() 実行時に
 *   context が満たされず lock が効かない → phase="execute" / not-allowed / recoverable=false。
 * - `AbortError` は新しい lock() による supersede → phase="execute" / aborted /
 *   recoverable=true(fresh な lock() は成功しうる)。
 * - それ以外(spec の `InvalidStateError`、生の throw、`.name` 欠如等)は
 *   phase="execute" / orientation-error。
 */
export function deriveScreenOrientationErrorInfo(name: string | undefined, message: string): WcsIoErrorInfo {
  if (name === "unsupported") {
    return { code: WCS_SCREEN_ORIENTATION_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
  }
  if (name === "NotAllowedError" || name === "NotSupportedError" || name === "SecurityError") {
    return { code: WCS_SCREEN_ORIENTATION_ERROR_CODE.NotAllowed, phase: "execute", recoverable: false, message };
  }
  if (name === "AbortError") {
    return { code: WCS_SCREEN_ORIENTATION_ERROR_CODE.Aborted, phase: "execute", recoverable: true, message };
  }
  return { code: WCS_SCREEN_ORIENTATION_ERROR_CODE.OrientationError, phase: "execute", recoverable: false, message };
}
