/**
 * `[wcs/package-twice]` for `<wcs-state>` and `<wcs-ssr>` (docs/timing-and-firing-contract.md §24).
 *
 * The core's `define()` leaves a tag that is already defined alone, without a word: a page with two
 * copies of @wcstack/state ran whichever was evaluated first (the `homeroom` seam app,
 * docs/seam-apps.md). The core does not carry the check — its 20 KiB budget, the author's decision of
 * 2026-10-31 — so the full entries wrap `define()` with it: `/auto` (src/auto.ts) and `.`'s
 * `bootstrapState` (src/exports.ts). `/core` and `dist/split/auto.js` define the tags as before and
 * stamp nothing, so a copy loaded through them is named "another copy of @wcstack/state that does not
 * name its version" by one that warns.
 */
import { config } from "./config";
import { WcsState } from "./element";
import { VERSION } from "./version";
import { stampPackage, warnIfAnotherCopy } from "./protocol/defineElement";

/**
 * Runs `define` (the core's, which registers `<wcs-state>` and the add-ons' tags in `registry`),
 * then stamps what it defined with `@wcstack/state@<version>`, or warns once when another copy of
 * the package had defined `<wcs-state>` — or `<wcs-ssr>` — first.
 */
export function defineOnce(define: () => void, registry: CustomElementRegistry = customElements): void {
  const { state, ssr } = config.tagNames;
  const hadState = registry.get(state);
  const hadSsr = registry.get(ssr);
  define();
  const pkg = `@wcstack/state@${VERSION}`;
  // defined before: by this copy (a second bootstrapState), an adopter's subclass, or another copy
  if (hadState !== undefined) return warnIfAnotherCopy(registry, state, hadState, WcsState, pkg);
  stampPackage(registry.get(state)!, pkg);
  // <wcs-ssr> comes with <wcs-state> (the ssr add-on), unless another copy had defined it
  const nowSsr = registry.get(ssr);
  if (hadSsr !== undefined) warnIfAnotherCopy(registry, ssr, hadSsr, undefined, pkg);
  else if (nowSsr !== undefined) stampPackage(nowSsr, pkg);
}
