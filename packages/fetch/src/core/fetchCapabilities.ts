/**
 * fetchCapabilities.ts
 *
 * fetch node 固有の capability registry と error code。汎用の assess 機構・型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは分離する。
 */

import { CapabilityRegistry, CapabilitySpec } from "./platformCapability.js";

/** 安定した fetch error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_FETCH_ERROR_CODE = {
  CapabilityMissing: "capability-missing",
  InvalidArgument: "invalid-argument",
  Network: "network",
  HttpError: "http-error",
  Timeout: "timeout",
  Aborted: "aborted",
} as const;

/** fetch node の capability registry。文字列 ID を eval せず明示 probe を持つ。 */
export const FETCH_CAPABILITIES: CapabilityRegistry = new Map<string, CapabilitySpec>([
  ["web.fetch", { probe: () => typeof (globalThis as { fetch?: unknown }).fetch === "function", compatKey: "api.fetch" }],
  ["web.abort-controller", { probe: () => typeof (globalThis as { AbortController?: unknown }).AbortController === "function", compatKey: "api.AbortController" }],
]);
