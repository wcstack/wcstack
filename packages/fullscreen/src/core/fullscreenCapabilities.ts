/**
 * fullscreenCapabilities.ts
 *
 * Fullscreen node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。fullscreen は referenced element を操作するモニタ的ノードで競合 operation
 * を持たないため lane は無く、error taxonomy(errorInfo)のみを採用する。
 *
 * `_setError` は合成 `{ message }`(target 未解決 / API 非対応)と caught 例外
 * (`NotAllowedError` / `TypeError` = user gesture 外の requestFullscreen 拒否)を混在
 * 受理する。呼出側が明示 `code` を渡して合成側を曖昧さ無く分類し、caught は `.name` で
 * 分類する(storage / screen-orientation と同じ discriminator 方式)。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 明示 code discriminator(合成エラーの呼出側が渡す)。 */
export type FullscreenErrorKind = "capability-missing" | "invalid-argument";

/** 安定した fullscreen error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_FULLSCREEN_ERROR_CODE = {
  /** Fullscreen API 非対応。 */
  CapabilityMissing: "capability-missing",
  /** target selector が要素に解決しない等の入力不備。 */
  InvalidArgument: "invalid-argument",
  /** `NotAllowedError` / `TypeError` — user gesture 外での要求拒否。 */
  NotAllowed: "not-allowed",
  /** その他の caught 例外。 */
  FullscreenError: "fullscreen-error",
} as const;

function messageOf(error: unknown): string {
  return typeof (error as { message?: unknown } | null)?.message === "string"
    ? (error as { message: string }).message
    : String(error);
}

/**
 * fullscreen の失敗を serializable な error taxonomy に写す。`kind` は合成エラーの
 * 呼出側が渡す明示 discriminator(`capability-missing` / `invalid-argument`)。未指定は
 * caught 例外を意味し、`.name` で分類する。`NotAllowedError` / `TypeError` は user
 * gesture 内で再試行すれば成功しうるため recoverable=true。
 */
export function deriveFullscreenErrorInfo(error: unknown, kind?: FullscreenErrorKind): WcsIoErrorInfo {
  const message = messageOf(error);
  if (kind === "capability-missing") {
    return { code: WCS_FULLSCREEN_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
  }
  if (kind === "invalid-argument") {
    return { code: WCS_FULLSCREEN_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "NotAllowedError" || name === "TypeError") {
    return { code: WCS_FULLSCREEN_ERROR_CODE.NotAllowed, phase: "execute", recoverable: true, message };
  }
  return { code: WCS_FULLSCREEN_ERROR_CODE.FullscreenError, phase: "execute", recoverable: false, message };
}
