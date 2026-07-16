/**
 * wakelockCapabilities.ts
 *
 * Wake Lock node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。wake lock は request / release の pure sink で競合する operation を持た
 * ないため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 *
 * error 面は sensor family(`{ error: <name>, message }`)とは異なり、`WakeLockCore._setError`
 * は生の `Error`(または clear の null)を受け取る。分類は `Error.name` で行う。
 *
 * NOTE(未対応環境について): Screen Wake Lock API は "unsupported" を error として通知しない。
 * `navigator.wakeLock` 不在時、Core の `_acquire()` は silent no-op(`held` は false のまま・
 * error 未設定)で戻る。よって sensor family のような `capability-missing` / phase="probe" の
 * 分岐は wake lock には存在しない(到達不能なので実装しない)。error が出るのは
 * `navigator.wakeLock.request()` の reject を `_normalizeError` で正規化した場合のみ。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した wake lock error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_WAKELOCK_ERROR_CODE = {
  /** `NotAllowedError` — ページ非可視/非アクティブ、または permission / feature-policy による拒否。 */
  NotAllowed: "not-allowed",
  /** その他の `request()` 失敗(非 Error reject の正規化など)。 */
  WakeLockError: "wakelock-error",
} as const;

/**
 * wake lock の失敗を serializable な error taxonomy に写す。`error` は
 * `WakeLockCore._setError` に渡る生の `Error`(`navigator.wakeLock.request()` の reject を
 * `_normalizeError` で正規化したもの)。
 *
 * - `NotAllowedError` は取得(request/acquire)時の拒否 — ページ非可視・permission /
 *   feature-policy ブロック → phase="start" / not-allowed。
 * - それ以外(非 Error reject を正規化した `Error` name="Error" など)は phase="execute" /
 *   wakelock-error。
 *
 * いずれも retry で確実には回復しないため recoverable=false(可視復帰時の再取得は Core が
 * 内部で担うが、taxonomy 上の分類としては false)。"unsupported" は error にならない
 * (silent no-op)ため capability-missing の分岐は無い(ファイル冒頭 NOTE 参照)。
 */
export function deriveWakeLockErrorInfo(error: Error): WcsIoErrorInfo {
  if (error.name === "NotAllowedError") {
    return { code: WCS_WAKELOCK_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message: error.message };
  }
  return { code: WCS_WAKELOCK_ERROR_CODE.WakeLockError, phase: "execute", recoverable: false, message: error.message };
}
