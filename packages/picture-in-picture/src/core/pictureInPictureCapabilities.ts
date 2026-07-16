/**
 * pictureInPictureCapabilities.ts
 *
 * Picture-in-Picture node 固有の error code(taxonomy)と derivation。汎用の error
 * info 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成
 * ファイル)から import する。Picture-in-Picture は referenced `<video>` を操作する
 * ノードで競合 operation を持たないため lane は無く、error taxonomy(errorInfo)のみを
 * 採用する(fullscreen と同型)。
 *
 * `_setError` は合成 `{ message }`(target が `<video>` に解決しない / API 非対応)と
 * caught 例外(`NotAllowedError` = user gesture 外の requestPictureInPicture 拒否等)を
 * 混在受理する。呼出側が明示 `kind` を渡して合成側を曖昧さ無く分類し、caught は `.name`
 * で分類する(fullscreen / storage / screen-orientation と同じ discriminator 方式)。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 明示 kind discriminator(合成エラーの呼出側が渡す)。 */
export type PictureInPictureErrorKind = "capability-missing" | "invalid-argument";

/** 安定した Picture-in-Picture error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_PICTURE_IN_PICTURE_ERROR_CODE = {
  /** Picture-in-Picture API 非対応。 */
  CapabilityMissing: "capability-missing",
  /** target が `<video>` に解決しない等の入力不備。 */
  InvalidArgument: "invalid-argument",
  /** `NotAllowedError` / `TypeError` — user gesture 外での要求拒否。 */
  NotAllowed: "not-allowed",
  /** その他の caught 例外。 */
  PipError: "pip-error",
} as const;

function messageOf(error: unknown): string {
  return typeof (error as { message?: unknown } | null)?.message === "string"
    ? (error as { message: string }).message
    : String(error);
}

/**
 * Picture-in-Picture の失敗を serializable な error taxonomy に写す。`kind` は合成
 * エラーの呼出側が渡す明示 discriminator(`capability-missing` / `invalid-argument`)。
 * 未指定は caught 例外を意味し、`.name` で分類する。`NotAllowedError` / `TypeError` は
 * user gesture 内で再試行すれば成功しうるため recoverable=true。
 */
export function derivePictureInPictureErrorInfo(error: unknown, kind?: PictureInPictureErrorKind): WcsIoErrorInfo {
  const message = messageOf(error);
  if (kind === "capability-missing") {
    return { code: WCS_PICTURE_IN_PICTURE_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
  }
  if (kind === "invalid-argument") {
    return { code: WCS_PICTURE_IN_PICTURE_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "NotAllowedError" || name === "TypeError") {
    return { code: WCS_PICTURE_IN_PICTURE_ERROR_CODE.NotAllowed, phase: "execute", recoverable: true, message };
  }
  return { code: WCS_PICTURE_IN_PICTURE_ERROR_CODE.PipError, phase: "execute", recoverable: false, message };
}
