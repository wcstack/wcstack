/**
 * The places the core calls into add-ons (docs/state-engine-rewrite/addons-plan.ja.md §1.2).
 *
 * Add-ons ship as separate entries of the same build as the core (`features/*`): they reach
 * the core's internals directly, and the core only calls out through these slots. A slot is
 * empty until an installed feature fills it (the object starts with none: a list of null slots
 * would be the core's bytes), so a page without the feature pays one `?.` check. A feature
 * restoring a slot may set it to null.
 * Slots are added with the first feature that needs them; several features share one through
 * chain / first. The slots `element` and `detail` keep their names (a DevTools-facing field and a DOM
 * name share them); the others are shortened by the build. An empty slot is read through
 * Object.prototype: a page that polluted it (a value under `element`, say) breaks the core loudly
 * there, as it does wherever the core reads a plain object's keys (`$behavior`); not defended.
 */

/** An add-on entry: `installFeatures([temporal, diagnostics])` before the state is defined. */
interface Feature {
    readonly name: string;
    install(): void;
}

/**
 * The DevTools add-on (@wcstack/state/features/devtools): `@wcstack/devtools` over the hook
 * protocol v2 — see src/devtools/devtools.ts.
 */

declare const devtools: Feature;

export { devtools as default, devtools };
