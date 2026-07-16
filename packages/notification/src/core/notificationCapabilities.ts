/**
 * notificationCapabilities.ts
 *
 * Notification node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。notification は監視(permission)と操作(notify/close)を 1 タグに併せ持つが、
 * 競合する非同期 operation の lane は持たない(show は最新値で上書きされる momentary な
 * 送出)ため、lane は採用せず error taxonomy(errorInfo)のみを追加する。
 *
 * sensor family と異なり、NotificationCore の error detail の `.error` は既に安定コード
 * (`this._err(code, message)` が産出する `"unsupported"` / `"not-granted"` /
 * `"invalid-title"` / `"show-failed"` / `"no-service-worker"`)であり、Error.name ではない。
 * したがって derivation は `.error` コードを taxonomy に写すだけの純粋な map である。
 * 想定外のコードは防御的に `notify-error` へ畳む。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";
import type { WcsNotifyErrorDetail } from "../types.js";

/** 安定した notification error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_NOTIFY_ERROR_CODE = {
  /** Notifications API 非対応(`globalThis.Notification` 不在)。 */
  CapabilityMissing: "capability-missing",
  /** 権限が granted でない状態での notify()。 */
  NotAllowed: "not-allowed",
  /** notify() に非文字列 title が渡された。 */
  InvalidArgument: "invalid-argument",
  /** notification の生成 / 表示に失敗した(constructor 例外 / onerror / SW show reject)。 */
  ShowFailed: "show-failed",
  /** SW backend が必要だが `navigator.serviceWorker` が不在。 */
  NoServiceWorker: "no-service-worker",
  /** その他 / 想定外の error code に対する防御的 fallback。 */
  NotifyError: "notify-error",
} as const;

/**
 * notification の失敗を serializable な error taxonomy に写す。引数は
 * `wcs-notify:error` の detail(`{ error, message }`)そのもの。`.error` は
 * `NotificationCore._err()` が付与した安定コードで、Error.name ではない。
 *
 * - `"unsupported"` は開始前の能力欠如 → phase="probe" / capability-missing。
 * - `"not-granted"` / `"invalid-title"` は show 手前の前提条件違反(権限・引数)→
 *   phase="start" / not-allowed・invalid-argument。
 * - `"show-failed"` は show 実行中の失敗 → phase="execute" / show-failed。
 * - `"no-service-worker"` は SW backend 要求時の transport 欠如 → phase="execute" /
 *   no-service-worker。
 * - それ以外(未知コード)は防御的に phase="execute" / notify-error。
 *
 * いずれも retry で自動回復しない(recoverable=false)。
 */
export function deriveNotifyErrorInfo(error: WcsNotifyErrorDetail): WcsIoErrorInfo {
  const { error: code, message } = error;
  switch (code) {
    case "unsupported":
      return { code: WCS_NOTIFY_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    case "not-granted":
      return { code: WCS_NOTIFY_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
    case "invalid-title":
      return { code: WCS_NOTIFY_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
    case "show-failed":
      return { code: WCS_NOTIFY_ERROR_CODE.ShowFailed, phase: "execute", recoverable: false, message };
    case "no-service-worker":
      return { code: WCS_NOTIFY_ERROR_CODE.NoServiceWorker, phase: "execute", recoverable: false, message };
    default:
      return { code: WCS_NOTIFY_ERROR_CODE.NotifyError, phase: "execute", recoverable: false, message };
  }
}
