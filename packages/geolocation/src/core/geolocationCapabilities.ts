/**
 * geolocationCapabilities.ts
 *
 * Geolocation node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。geolocation は concurrent-independent(競合しない)ため lane は持たず、
 * error taxonomy(errorInfo)のみを採用する。
 */

import type { WcsIoErrorInfo } from "./platformCapability.js";

/** 安定した geolocation error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_GEO_ERROR_CODE = {
  PermissionDenied: "permission-denied",
  PositionUnavailable: "position-unavailable",
  Timeout: "timeout",
} as const;

/**
 * 正規化済み `GeolocationPositionError`(spec code 1/2/3)を serializable な error
 * taxonomy に写す。Core は "unsupported"/"unexpected" を code 2(position-unavailable)
 * に畳むため、これは既存の `error.code` を忠実にミラーする。permission-denied(1)だけ
 * は retry で回復しないため recoverable=false。
 */
export function deriveGeoErrorInfo(code: number, message: string): WcsIoErrorInfo {
  const taxonomyCode = code === 1
    ? WCS_GEO_ERROR_CODE.PermissionDenied
    : code === 3
      ? WCS_GEO_ERROR_CODE.Timeout
      : WCS_GEO_ERROR_CODE.PositionUnavailable;
  return { code: taxonomyCode, phase: "execute", recoverable: code !== 1, message };
}
