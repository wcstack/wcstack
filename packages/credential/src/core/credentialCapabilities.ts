/**
 * credentialCapabilities.ts
 *
 * Credential Management node 固有の capability registry と error code。汎用の assess
 * 機構・型は `./platformCapability.js`(/io-core/ から copy-distribution される生成
 * ファイル)から import する。node 固有の宣言はこのハンドライトファイルに置き、生成
 * コピーとは分離する。
 */

import { CapabilityRegistry, CapabilitySpec } from "./platformCapability.js";

/** 安定した credential error code(taxonomy)。値は公開キーとして固定。 */
export const WCS_CREDENTIAL_ERROR_CODE = {
  CapabilityMissing: "capability-missing",
  /** WebAuthn(publicKey) は v1 スコープ外 — get()/store() 双方で拒否する。 */
  OutOfScope: "out-of-scope",
  /** get()/store() の真のプラットフォーム失敗(NotAllowedError=cancelled は除く)。 */
  CredentialFailed: "credential-failed",
} as const;

/**
 * credential node の capability registry。`navigator.credentials`(CredentialsContainer)
 * と `PasswordCredential` クラスの presence を probe する。文字列 ID を global property
 * path として eval しない。
 *
 * `web.password-credential`: このノードの対象(password / federated の資格情報)は
 * `PasswordCredential` クラスを要る。実装しているのは Chromium だけで、Firefox と Safari は
 * WebAuthn 用の `navigator.credentials` だけを持つ — そこで `get({ password: true })` や
 * `store()` をブラウザに渡すと、非対応が「失敗」(credential-failed)に見えてしまう。
 */
export const CREDENTIAL_CAPABILITIES: CapabilityRegistry = new Map<string, CapabilitySpec>([
  ["web.credentials", { probe: () => (globalThis as { navigator?: { credentials?: unknown } }).navigator?.credentials != null, compatKey: "api.CredentialsContainer" }],
  ["web.password-credential", { probe: () => typeof (globalThis as { PasswordCredential?: unknown }).PasswordCredential === "function", compatKey: "api.PasswordCredential" }],
]);
