/**
 * platform-capability.ts
 *
 * Phase 6(docs/architecture-hardening/09-remediation-design.md §7.2 /
 * 07-browser-capability-variance.md)の browser capability 判定と error taxonomy の
 * 汎用プリミティブ。node 固有の capability registry / error code は各パッケージが
 * 別ファイルで宣言し、この汎用層(型 + assess 機構)を import する。
 *
 * 原則:
 * - feature detection は境界(利用直前)で行う。module 評価時に browser global を
 *   参照しない(SSR / worker で import が失敗しない)。
 * - capability ID(`web.fetch` 等)は文字列を global property path として eval せず、
 *   registry が ID ごとに副作用のない presence probe を対応付ける。
 * - availability / permission / readiness / activity / operation error を 1 つの
 *   `ready / unsupported / error` enum に畳まない。required 欠如は開始しない、
 *   optional 欠如は宣言済み fallback で readiness を `degraded` にする。
 *
 * 配置: 本ファイルは /io-core/ の単一正典であり、scripts/sync-io-core.mjs が
 * 各 IO ノードの src/core/ へ生成コピー (AUTO-GENERATED, 編集禁止) を配布する。
 * `protocol/wcBindable.ts` と同じ copy-distribution 方式で、ランタイム依存を導入せず
 * 各パッケージのバンドルへ inline される (zero-runtime-dep / 自己完結 CDN を維持)。
 * 編集はこの正典に対して行い、`node scripts/sync-io-core.mjs` で再配布する。
 *
 * pure(module 評価時に browser global 非参照)。
 */

export type Availability = "available" | "missing" | "unknown";
export type PermissionState = "granted" | "denied" | "prompt" | "not-applicable" | "unknown";
export type Readiness = "idle" | "ready" | "degraded";
export type Activity = "inactive" | "active";
export type PreconditionState = "satisfied" | "required" | "not-applicable";

/** operation error の phase(taxonomy)。 */
export type WcsIoErrorPhase = "probe" | "start" | "execute" | "decode" | "commit" | "dispose";

/** serializable な error info(non-cloneable な cause とは分離。DevTools / remote へは info のみ)。 */
export interface WcsIoErrorInfo {
  readonly code: string;
  readonly phase: WcsIoErrorPhase;
  readonly recoverable: boolean;
  readonly capabilityId?: string;
  readonly message: string;
}

export interface PlatformAssessment {
  readonly availability: ReadonlyMap<string, Availability>;
  readonly permission: PermissionState;
  readonly readiness: Readiness;
  readonly activity: Activity;
  readonly preconditions: {
    readonly secureContext: PreconditionState;
    readonly userActivation: PreconditionState;
  };
  readonly epoch: number;
  readonly lastError?: WcsIoErrorInfo;
}

/** capability 1 件の仕様。probe は副作用なく presence を返す(利用直前に呼ぶ)。 */
export interface CapabilitySpec {
  readonly probe: () => boolean;
  readonly requiresSecureContext?: boolean;
  readonly requiresUserActivation?: boolean;
  /** browser compatibility dataset のキー(任意・診断用)。 */
  readonly compatKey?: string;
}

export type CapabilityRegistry = ReadonlyMap<string, CapabilitySpec>;

export interface AssessOptions {
  readonly required: readonly string[];
  readonly optional?: readonly string[];
  readonly permission?: PermissionState;
  readonly activity?: Activity;
  readonly epoch?: number;
  readonly lastError?: WcsIoErrorInfo;
}

function isSecureContext(): boolean {
  return (globalThis as { isSecureContext?: unknown }).isSecureContext === true;
}

/**
 * capability を利用直前に評価して PlatformAssessment を作る。
 * required が 1 つでも欠ければ readiness は "idle"(開始不可)、
 * required 揃い + optional 欠けは "degraded"、全揃いは "ready"。
 */
export function assessCapabilities(registry: CapabilityRegistry, options: AssessOptions): PlatformAssessment {
  const availability = new Map<string, Availability>();
  const evaluate = (id: string): Availability => {
    const spec = registry.get(id);
    if (spec === undefined) return "unknown";
    return spec.probe() ? "available" : "missing";
  };

  let requiredAllAvailable = true;
  for (const id of options.required) {
    const a = evaluate(id);
    availability.set(id, a);
    if (a !== "available") requiredAllAvailable = false;
  }
  let optionalAllAvailable = true;
  for (const id of options.optional ?? []) {
    const a = evaluate(id);
    availability.set(id, a);
    if (a !== "available") optionalAllAvailable = false;
  }

  const readiness: Readiness = !requiredAllAvailable ? "idle" : (optionalAllAvailable ? "ready" : "degraded");

  // preconditions: 対象 capability のいずれかが要求する場合だけ評価する。
  const allIds = [...options.required, ...(options.optional ?? [])];
  const needsSecure = allIds.some((id) => registry.get(id)?.requiresSecureContext === true);
  const needsActivation = allIds.some((id) => registry.get(id)?.requiresUserActivation === true);
  const secureContext: PreconditionState = needsSecure ? (isSecureContext() ? "satisfied" : "required") : "not-applicable";
  const userActivation: PreconditionState = needsActivation ? "required" : "not-applicable";

  return {
    availability,
    permission: options.permission ?? "not-applicable",
    readiness,
    activity: options.activity ?? "inactive",
    preconditions: { secureContext, userActivation },
    epoch: options.epoch ?? 0,
    lastError: options.lastError,
  };
}

/** availability から「required がすべて available か」を判定するヘルパ(supported の最低条件)。 */
export function requiredCapabilitiesAvailable(assessment: PlatformAssessment, required: readonly string[]): boolean {
  return required.every((id) => assessment.availability.get(id) === "available");
}

/**
 * このページで機能が使えない理由(使える、または分からないなら null)。利用直前に読む。
 *
 * - `"insecure-context"`: 安全なコンテキストではない(`isSecureContext === false`)。
 *   Permissions API が扱う機能はどれも安全なコンテキストを要る。
 * - `"policy-blocked"`: Permissions-Policy(サーバーのヘッダ、または `allow` の無い
 *   `<iframe>`)がその機能を切っている。
 *
 * どちらも Permissions API は教えない: Chromium はポリシーで切られた文書でも
 * `granted` を、安全でない origin では `denied` を返す。利用者の拒否と区別するため、
 * 見張り役(`<wcs-permission>`)も取りに行く側も `unsupported` を報告する
 * (docs/v4-direction-2026-10.md の決定、state-field-report)。
 * `isSecureContext` が無い環境(SSR・テスト)は判断しない。
 */
export type FeatureUnavailableReason = "insecure-context" | "policy-blocked";

/** Permissions-Policy が制御する機能(permission 名と同じ文字列)。 */
const POLICY_CONTROLLED = new Set([
  "camera", "microphone", "geolocation", "midi", "clipboard-read", "clipboard-write",
  "screen-wake-lock", "idle-detection", "accelerometer", "gyroscope", "magnetometer",
  "ambient-light-sensor", "display-capture",
]);

interface PolicyLike { allowsFeature(feature: string): boolean }

export function featureUnavailable(feature: string): FeatureUnavailableReason | null {
  const g = globalThis as { isSecureContext?: unknown; document?: { permissionsPolicy?: PolicyLike; featurePolicy?: PolicyLike } };
  if (g.isSecureContext === false) return "insecure-context";
  if (!POLICY_CONTROLLED.has(feature)) return null;
  const policy = g.document?.permissionsPolicy ?? g.document?.featurePolicy;
  if (policy === undefined || typeof policy.allowsFeature !== "function") return null;
  try {
    return policy.allowsFeature(feature) ? null : "policy-blocked";
  } catch {
    return null;
  }
}

/** `featureUnavailable` の理由を、作者が直し方を読める文にする。`what` は文頭(「The camera」など)。 */
export function featureUnavailableMessage(what: string, feature: string, reason: FeatureUnavailableReason): string {
  return reason === "insecure-context"
    ? `${what} needs a secure context (https:, or http://localhost), and this page is not one.`
    : `${what} is turned off for this page by a Permissions-Policy: the server's Permissions-Policy header, ` +
      `or an <iframe> without allow="${feature}". The browser's site settings cannot change that.`;
}
