/**
 * broadcastCapabilities.ts
 *
 * Broadcast node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。BroadcastChannel の post / message は concurrent-independent(競合しない)
 * ため lane は持たず、error taxonomy(errorInfo)のみを採用する。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";
import type { WcsBroadcastErrorDetail } from "../types.js";

/** 安定した broadcast error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_BROADCAST_ERROR_CODE = {
  /** BroadcastChannel コンストラクタ不在(`_unsupportedError()` の `NotSupportedError`)。 */
  CapabilityMissing: "capability-missing",
  /** structured clone 不可な payload を post(`DataCloneError`)。呼び出し側入力の不備。 */
  InvalidArgument: "invalid-argument",
  /** その他の post / channel 失敗(DataError / InvalidStateError / "Error" fallback など)。 */
  BroadcastError: "broadcast-error",
} as const;

/**
 * 正規化済み error(`{ name, message }`)を serializable な error taxonomy に写す。
 * `name` は `DOMException.name`(`_normalizeError`)/ 合成名(`_unsupportedError` の
 * `NotSupportedError`、`messageerror` の `DataError`、post 前の `InvalidStateError`)。
 *
 * - `NotSupportedError`(BroadcastChannel 不在)は利用直前の能力欠如 → phase="probe" /
 *   capability-missing。
 * - `DataCloneError`(structured clone 不可な payload を post)は呼び出し側入力の不備 →
 *   phase="execute" / invalid-argument。
 * - それ以外(`DataError` の deserialize 失敗 / `InvalidStateError` / "Error" fallback)は
 *   phase="execute" / broadcast-error。
 * いずれも同一入力の再送では回復しない(recoverable=false)。
 */
export function deriveBroadcastErrorInfo(error: WcsBroadcastErrorDetail): WcsIoErrorInfo {
  if (error.name === "NotSupportedError") {
    return { code: WCS_BROADCAST_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message: error.message };
  }
  if (error.name === "DataCloneError") {
    return { code: WCS_BROADCAST_ERROR_CODE.InvalidArgument, phase: "execute", recoverable: false, message: error.message };
  }
  return { code: WCS_BROADCAST_ERROR_CODE.BroadcastError, phase: "execute", recoverable: false, message: error.message };
}
