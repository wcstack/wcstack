/**
 * contactsCapabilities.ts
 *
 * Contact Picker node 固有の capability registry と error code。汎用の assess 機構・
 * 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)
 * から import する。node 固有の宣言はこのハンドライトファイルに置き、生成コピーとは
 * 分離する。
 */

import { CapabilityRegistry, CapabilitySpec } from "./platformCapability.js";

/** 安定した contacts error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_CONTACTS_ERROR_CODE = {
  CapabilityMissing: "capability-missing",
  SelectFailed: "select-failed",
} as const;

/** contacts node の capability registry。文字列 ID を eval せず明示 probe を持つ。 */
export const CONTACTS_CAPABILITIES: CapabilityRegistry = new Map<string, CapabilitySpec>([
  ["web.contacts", { probe: () => typeof (globalThis as { navigator?: { contacts?: { select?: unknown } } }).navigator?.contacts?.select === "function", compatKey: "api.ContactsManager.select" }],
]);
