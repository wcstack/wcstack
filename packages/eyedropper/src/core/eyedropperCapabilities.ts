/**
 * eyedropperCapabilities.ts
 *
 * EyeDropper node 固有の capability registry と error code。汎用の assess 機構・型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは分離する。
 */

import { CapabilityRegistry, CapabilitySpec } from "./platformCapability.js";

/** 安定した eyedropper error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_EYEDROPPER_ERROR_CODE = {
  CapabilityMissing: "capability-missing",
  PickFailed: "pick-failed",
} as const;

/** eyedropper node の capability registry。文字列 ID を eval せず明示 probe を持つ。 */
export const EYEDROPPER_CAPABILITIES: CapabilityRegistry = new Map<string, CapabilitySpec>([
  ["web.eyedropper", { probe: () => typeof (globalThis as { EyeDropper?: unknown }).EyeDropper === "function", compatKey: "api.EyeDropper" }],
]);
