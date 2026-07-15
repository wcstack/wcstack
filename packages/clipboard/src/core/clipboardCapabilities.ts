/**
 * clipboardCapabilities.ts
 *
 * Clipboard node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。clipboard の read/write は concurrent-independent(競合しない)ため lane
 * は持たず、error taxonomy(errorInfo)のみを採用する。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した clipboard error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_CLIPBOARD_ERROR_CODE = {
  CapabilityMissing: "capability-missing",
  NotAllowed: "not-allowed",
  ClipboardError: "clipboard-error",
} as const;

/**
 * 正規化済み error(`{ name, message }`)を serializable な error taxonomy に写す。
 * `NotSupportedError`(Clipboard API 不在)→ capability-missing、`NotAllowedError`
 * (permission 拒否、retry では回復しない)→ not-allowed、その他 → clipboard-error。
 */
export function deriveClipboardErrorInfo(name: string, message: string): WcsIoErrorInfo {
  if (name === "NotSupportedError") {
    return { code: WCS_CLIPBOARD_ERROR_CODE.CapabilityMissing, phase: "start", recoverable: false, message };
  }
  if (name === "NotAllowedError") {
    return { code: WCS_CLIPBOARD_ERROR_CODE.NotAllowed, phase: "execute", recoverable: false, message };
  }
  return { code: WCS_CLIPBOARD_ERROR_CODE.ClipboardError, phase: "execute", recoverable: true, message };
}
