// Single-tag bootstrap for the SPA-core profile (docs/distribution-robustness-impl-plan.md D2):
// side-effect imports of each member package's published /auto entry. Rollup inlines the five
// self-contained bootstraps into one dist/auto.min.js, renaming colliding top-level identifiers
// — the step a naive concatenation (jsDelivr /combine/) cannot do (docs/sri.md §3.1).
//
// A typo in one of these subpaths is NOT caught by tsc (an untyped side-effect import resolves
// silently), so the smoke test's tag census (__tests__/bundle.smoke.test.ts) is the gate.
//
// Loading this bundle alongside an individual member's /auto is safe: every member define is
// guarded behind customElements.get and the protocol installs (binder / ssr-snapshot) yield
// first-wins on Symbol.for globals — whichever copy evaluates first owns the page.
import "@wcstack/state/auto";
import "@wcstack/router/auto";
import "@wcstack/fetch/auto";
import "@wcstack/storage/auto";
import "@wcstack/autoloader/auto";
