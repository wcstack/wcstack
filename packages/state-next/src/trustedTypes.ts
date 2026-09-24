/**
 * Trusted Types for the HTML sinks (`html:`, `innerHTML:`, `outerHTML:`, `srcdoc:`).
 * The policy lives on the same global slot as @wcstack/state, so a page that installed
 * one for the current engine keeps working:
 *   globalThis[Symbol.for("wcstack.trustedTypes.policy")] = trustedTypes.createPolicy(…)
 * No identity policy is ever created here — that would defeat the CSP.
 */
export interface TrustedTypesPolicy {
  createHTML?(input: string): unknown;
}

export const TRUSTED_TYPES_POLICY_SLOT = Symbol.for("wcstack.trustedTypes.policy");

type Slot = { [key: symbol]: unknown };

export function getTrustedTypesPolicy(): TrustedTypesPolicy | null {
  const value = (globalThis as Slot)[TRUSTED_TYPES_POLICY_SLOT];
  return value !== null && typeof value === "object" ? (value as TrustedTypesPolicy) : null;
}

export function setTrustedTypesPolicy(policy: TrustedTypesPolicy | null): void {
  (globalThis as Slot)[TRUSTED_TYPES_POLICY_SLOT] = policy;
}

export function isHtmlSink(prop: string): boolean {
  return prop === "innerHTML" || prop === "outerHTML" || prop === "srcdoc";
}

/** A string for an HTML sink, passed through the installed policy (if any). */
export function trustHtml(value: string): unknown {
  const policy = getTrustedTypesPolicy();
  const create = policy?.createHTML;
  return typeof create === "function" ? create.call(policy, value) : value;
}
