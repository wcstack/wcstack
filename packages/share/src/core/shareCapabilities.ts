/**
 * shareCapabilities.ts
 *
 * Web Share node 固有の capability registry と error code。汎用の assess 機構・型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは分離する。
 */

import { CapabilityRegistry, CapabilitySpec } from "./platformCapability.js";

/** 安定した share error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_SHARE_ERROR_CODE = {
  CapabilityMissing: "capability-missing",
  ShareFailed: "share-failed",
} as const;

/** share node の capability registry。文字列 ID を eval せず明示 probe を持つ。 */
export const SHARE_CAPABILITIES: CapabilityRegistry = new Map<string, CapabilitySpec>([
  ["web.share", { probe: () => typeof (globalThis as { navigator?: { share?: unknown } }).navigator?.share === "function", compatKey: "api.Navigator.share" }],
]);
