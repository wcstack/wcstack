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
    /** The slots of the build it comes from: it fills only those (the core checks they are its own). */
    readonly hooks: object;
    install(): void;
}

/**
 * The release add-on (@wcstack/state/features/release): the binder protocol's `release(subtree)`
 * (version 2). Markup handed over to be bound (`globalThis[Symbol.for("wcstack.binder")].bind(node)`)
 * and then thrown away for good by whoever inserted it — htmx replacing search results — kept its
 * bindings: every later change wrote into the nodes it left behind, and each replacement added more
 * (docs/seam-apps.md, community-hall). `release` lets go of them: the bindings under the subtree are
 * unregistered and its `for:` / `if:` views disposed, as a row's are when its row goes. Its event
 * handlers and command subscriptions go with its nodes (held by them, or weakly).
 *
 * Only an inserter knows that content is gone for good: the router hides a route's content and shows
 * it again, so a binder cannot tell "out for now" from "out for good", and @wcstack/router never calls
 * it. Released nodes are not bound again when handed over again (walked once, they are left alone).
 */

/** Lets go of what is bound in `subtree` (see above). */
declare function releaseSubtree(subtree: Node): void;
declare const release: Feature;

export { release as default, release, releaseSubtree };
