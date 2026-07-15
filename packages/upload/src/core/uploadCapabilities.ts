/**
 * uploadCapabilities.ts
 *
 * Upload node 固有の capability registry と error code。汎用の assess 機構・型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは分離する。
 */

import { CapabilityRegistry, CapabilitySpec } from "./platformCapability.js";

/** 安定した upload error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_UPLOAD_ERROR_CODE = {
  CapabilityMissing: "capability-missing",
  InvalidArgument: "invalid-argument",
  Network: "network",
  HttpError: "http-error",
} as const;

/**
 * upload node の capability registry。`XMLHttpRequest`(progress 取得のため fetch では
 * なく XHR を用いる)の presence を probe する。
 */
export const UPLOAD_CAPABILITIES: CapabilityRegistry = new Map<string, CapabilitySpec>([
  ["web.xhr", { probe: () => typeof (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest === "function", compatKey: "api.XMLHttpRequest" }],
]);
