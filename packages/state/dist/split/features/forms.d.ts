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
 * The forms add-on (@wcstack/state/features/forms): what a form does outside the `input` event
 * (docs/forms.md; docs/seam-apps.md, ekiden-entry). A two-way binding hears one event — `input` on a
 * field — and state writes the field whenever its value is not the one the field shows. Three things a
 * form does fall between those two, each without a word:
 *
 * - A composition (an IME: Japanese, Chinese, Korean). State wrote the field while its text was being
 *   composed — a setter that normalizes what is typed, a draft another tab saved, an address looked up
 *   — and a write to a field ends its composition where it is: the text so far is committed and typed
 *   again (`やまだ` became `ヤヤマヤマダヤマダ`). While a field is composed, the bindings that write it are
 *   held; when the composition is over they are applied, with the value state has then.
 * - A value that arrives with no `input` event: an autofill that fires `change` alone, a value a browser
 *   or an extension puts in silently. On `change`, and before a form is submitted, a field whose value
 *   is not the one state last saw there is told to state.
 * - A reset (`<button type="reset">`, `form.reset()`): the controls went back to their defaults and
 *   state kept its values. After a reset each control of the form that state binds is told to state, and
 *   then written from state again — what does not write back (a radio group with no default, `#ro`)
 *   shows state's value, so the two agree.
 *
 * And two things happen before state has bound a form at all (docs/v4-direction-2026-10.md §5.22). The router
 * draws a route as soon as its script runs; state binds it once the root state has loaded, which may take
 * seconds (a `src=` file, an inline module). In between the form is usable:
 *
 * - What the user typed was written over with the state's value when the form was bound (the homeroom seam
 *   app: then its `required` fields refused the submit). The user's value wins, as on a server's page (§5.1,
 *   the ssr add-on): a control the user changes while state does not bind it is marked, and when an engine
 *   starts to bind its root, each marked control there that state then binds gets back what it had, told to
 *   state.
 * - A submit went out as the browser's own: a GET to the page with the fields — the password too — in the URL
 *   and the history (the family-ledger and router-auth seam apps). A form whose `onsubmit` the page prevents
 *   (`onsubmit#prevent`) is never sent by the browser, bound or not: the document hears every submit first.
 *   One submitted before its root was bound is submitted again right after, with the user's values back.
 *
 * "Told to state" is an `input` event (and, where a binding may hear that one, a `change` event) that
 * does not bubble, dispatched on the control: its two-way binding hears it as it hears the user — through
 * its input filters, on its `#on<event>`, or not at all (`#ro`) — and a handler bound above it does not.
 *
 * The core is not involved (0 B): the bindings are seen where they are applied (Engine.applyBinding, wrapped),
 * the rest are listeners on the root. Nothing of the core is imported but the hooks: an add-on that imports
 * dom/view.ts reaches a part of the core no other entry reaches alone, and the split build then cuts the core
 * into one more chunk (+960 B gzip over its files, one more request) — so the engine's and the bindings'
 * classes are taken from the first engine made and the first binding applied, and the four kinds are repeated.
 */

declare const forms: Feature;

export { forms as default, forms };
