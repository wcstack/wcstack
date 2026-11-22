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
import { chain, hooks, type Feature } from "../hooks";
// (nothing of it is used: every other entry that reaches hooks.ts reaches this module too, so the split build
// keeps the two in one chunk — an entry that reached hooks.ts alone cut it in two, +222 B gzip and a request)
import "../parser/raiseError";
import type { Engine } from "../engine";
import type { Binding } from "../dom/view";

/** dom/view.ts K_PROP, K_RADIO, K_CHECKBOX, K_CUSTOM (see the header; __tests__/forms.test.ts compares them). */
const K_PROP = 1;
const K_RADIO = 9;
const K_CHECKBOX = 10;
const K_CUSTOM = 11;

/** What state knows of a form control it binds. */
interface Control {
  /** Its bindings that can write back (a native control's `value:` / `checked:` / `radio:` / `checkbox:`). */
  bindings: Binding[];
  /** It has a `value:` binding: `shown` is kept. */
  field: boolean;
  /** The value the field had when state last wrote it or read it. */
  shown: unknown;
}

const controls = new WeakMap<Node, Control>();

/** The properties of a native control that write back (dom/plan.ts isTwoWay). */
const WRITES_BACK = new Set(["value", "checked", "valueAsNumber", "valueAsDate"]);

// ---------------------------------------------------------------- a field being composed

/** The field being composed (where the composition's events start), or null. */
let composing: Node | null = null;
/** The element whose shadow root holds it (a design system's text field), or null. */
let host: Node | null = null;
/** Counts the compositions: one that ended is over only if no other has started since (the next word). */
let turn = 0;
/** The bindings held while their field was composed. */
const held = new Set<Binding>();

/** The composition is over: what was held is applied, by its engine's next drain (which leaves out a row gone since). */
function release(): void {
  composing = host = null;
  for (const b of held) b.engine.enqueue(b);
  held.clear();
}

function composed(e: Event): void {
  const n = e.composedPath()[0] as Node;
  // (another field: the one before it ended without a word — it left the page)
  if (n !== composing) release();
  turn++;
  composing = n;
  host = (n.getRootNode() as ShadowRoot).host ?? null;
}

function composedEnd(): void {
  const mine = turn;
  // after the composition's own events (a browser may send its last `input` after `compositionend`),
  // and not while the next word is already being composed
  setTimeout(() => {
    if (turn === mine) release();
  });
}

// ---------------------------------------------------------------- what state knows of a control

let watching = false;

/**
 * The first engine seen — made after the add-on was installed, or, installed late (a split page that loads it
 * after its state), the first to drain: every binding is applied through its class's applyBinding from here on.
 * A control bound before that is known from its next change.
 */
function watch(engine: Engine): void {
  if (watching) return;
  watching = true;
  const proto = Object.getPrototypeOf(engine) as Engine;
  const applyBinding = proto.applyBinding;
  let bindings: Binding | null = null;
  proto.applyBinding = function (this: Engine, b: Binding): void {
    // (the first binding applied: its class's writeBack tells what state read from a field)
    if (bindings === null) {
      bindings = Object.getPrototypeOf(b) as Binding;
      const writeBack = bindings.writeBack;
      bindings.writeBack = function (this: Binding): void {
        writeBack.call(this);
        const c = controls.get(this.node);
        if (c?.field) c.shown = (this.node as any).value;
      };
    }
    // (the first binding an engine made since the add-on was installed applies: its root is bound from now on)
    if (fresh.has(this) && !begun.has(this)) begin(this);
    const n = b.node as any;
    const kind = b.kind;
    const field = kind === K_PROP && b.name === "value";
    if (composing !== null) {
      // (composed while it has the focus: a field taken out of the page mid-composition sends no end)
      if ((composing.getRootNode() as Document).activeElement !== composing) release();
      else if (field ? n === composing : kind === K_CUSTOM && (n === composing || n === host)) {
        held.add(b);
        return;
      }
    }
    const before = field ? n.value : undefined;
    applyBinding.call(this, b);
    if (kind !== K_RADIO && kind !== K_CHECKBOX && !(kind === K_PROP && WRITES_BACK.has(b.name))) return;
    let c = controls.get(n);
    if (c === undefined) {
      controls.set(n, (c = { bindings: [], field: false, shown: undefined }));
      listen(this.root as Node);
    }
    if (!c.bindings.includes(b)) c.bindings.push(b);
    // what the field shows is what state knows when state wrote it, and when it is first bound (a value put
    // in since, with no event, is not: an apply that leaves the field as it is leaves `shown` as it is)
    if (field && (!c.field || n.value !== before)) {
      c.field = true;
      c.shown = n.value;
    }
  };
}

/** Tells state the control's value as the user's typing would have: events that do not bubble (see the header). */
function tell(n: EventTarget, change: boolean): void {
  n.dispatchEvent(new Event("input"));
  if (change) n.dispatchEvent(new Event("change"));
}

/** A field whose value is not the one state last saw there: told to state. */
function fill(n: any, change: boolean): void {
  const c = controls.get(n);
  if (!c?.field || n.value === c.shown) return;
  // (a binding that hears nothing — `#ro` — is told once)
  c.shown = n.value;
  tell(n, change);
}

// ---------------------------------------------------------------- before a form is bound

/**
 * The engines made since the add-on was installed: only their roots are looked at. An engine that bound its root
 * before (a split page that loads the add-on late) wrote its controls itself — their values are not the user's.
 */
const fresh = new WeakSet<Engine>();
/** The fresh engines that have started to bind their root. */
const begun = new WeakSet<Engine>();
/** Their roots (a document, a shadow root, a Light DOM component's host): what is in them is bound. */
const roots = new WeakSet<Node>();
/**
 * The controls the user changed (an `input` or a `change` event) while no binding of state wrote them back. Only
 * theirs count: a value a script, a history cache (Turbo, htmx) or the previous engine of a replaced page put
 * there is not what the user typed, and telling it to state would run its setters as the page loads.
 */
const touched = new WeakSet<EventTarget>();

function touch(e: Event): void {
  const n = e.composedPath()[0] as Node;
  if (!controls.has(n)) touched.add(n);
}
/** What the user typed in controls not bound yet, put back once the bindings are made. */
let typedIn: [any, () => void][] = [];
/** The forms submitted before state bound them, with the button that submitted them. */
const sent = new Map<HTMLFormElement, HTMLButtonElement | null>();

/** `n` is in the root of an engine that has started to bind it. */
function covered(n: Node | null): boolean {
  for (; n !== null; n = n.parentNode) if (roots.has(n)) return true;
  return false;
}

/**
 * What the user changed in a control (its value is not the one its markup gives — the user may have typed it
 * back), as what puts it back; or null. The ssr add-on's rules: a radio counts if it is the one chosen (the
 * group's others follow it), a single select's markup selects its last marked option or its first enabled one.
 */
function typed(n: any): (() => void) | null {
  if (n.type === "checkbox" || n.type === "radio") {
    const c = n.checked;
    return c !== n.defaultChecked && (c || n.type === "checkbox") ? () => (n.checked = c) : null;
  }
  if (n.localName === "select") {
    const o: HTMLOptionElement[] = Array.from(n.options);
    const sel = o.map((x) => x.selected);
    let at = o.map((x) => x.defaultSelected).lastIndexOf(true);
    if (at < 0) at = o.findIndex((x) => !x.disabled);
    return (n.multiple ? o.some((x, i) => sel[i] !== x.defaultSelected) : n.selectedIndex !== at) ? () => o.forEach((x, i) => (x.selected = sel[i])) : null;
  }
  const v = n.value;
  return n.type !== "file" && v !== n.defaultValue ? () => (n.value = v) : null;
}

/**
 * A fresh engine is about to apply its first binding: what was typed in the controls of its root. The controls that
 * were in the page before state are bound in one go — the root's mount, then what the router handed over before
 * (drainBinds) — so what was typed is given back right after it, in a microtask. (Content drawn later, from a
 * template, is new: nobody typed in it.)
 */
function begin(engine: Engine): void {
  begun.add(engine);
  const root = engine.root as (ParentNode & Node) | undefined;
  if (root === undefined) return;
  roots.add(root);
  for (const n of root.querySelectorAll("input,textarea,select")) {
    const put = touched.has(n) ? typed(n) : null;
    if (put !== null) typedIn.push([n, put]);
  }
  if (typedIn.length > 0 || sent.size > 0) queueMicrotask(giveBack);
}

/**
 * Each control state now binds gets back what was typed in it, told to state; then a form submitted before its
 * root was bound is submitted again, now that its handler is there (the user's click is not lost).
 */
function giveBack(): void {
  const got = typedIn;
  typedIn = [];
  for (const [n, put] of got) {
    // (a control no binding of state writes back is left alone: a listener of the page's own would hear the events)
    if (!n.isConnected || !controls.has(n)) continue;
    put();
    tell(n, true);
  }
  for (const [f, by] of sent) {
    if (!covered(f)) continue;
    sent.delete(f);
    if (f.isConnected) f.requestSubmit(by?.form === f ? by : null);
  }
}

/** `onsubmit#prevent` (`prevent` among the modifiers, in any order) in a binding text. */
const PREVENTS = /(?:^|;)\s*onsubmit#[^:;]*\bprevent\b[^:;]*:/i;

/**
 * Every submit, before the page's handlers: the browser never sends a form whose page prevents its submit. One no
 * engine has started to bind yet is kept, and submitted again once one has (giveBack); a bound one is not — its
 * handler hears this very submit. The binding text is looked for in each of the form's attributes: reading
 * `bindAttributeName` would import config.ts, which the split build then cuts out of the core into a chunk of its
 * own (one more request for every page).
 */
function early(e: Event): void {
  const f = e.target as HTMLFormElement;
  if (f.localName !== "form" || ![...f.attributes].some((a) => PREVENTS.test(a.value))) return;
  e.preventDefault();
  if (!covered(f)) sent.set(f, ((e as SubmitEvent).submitter as HTMLButtonElement | null) ?? null);
}

// ---------------------------------------------------------------- the events of a root

/** The roots heard, and the documents whose compositions are. */
const listened = new WeakSet<Node>();
const composers = new WeakSet<Node>();

function changed(e: Event): void {
  // (the field's own binding may hear `change` itself, `#onchange`: it has, by now)
  fill(e.target, false);
}

function submitting(e: Event): void {
  for (const n of (e.target as HTMLFormElement).elements ?? []) fill(n, true);
}

function wasReset(e: Event): void {
  const form = e.target as HTMLFormElement;
  // after the reset itself: it follows the event, unless a handler refused it
  setTimeout(() => {
    if (e.defaultPrevented) return;
    for (const n of form.elements ?? []) {
      const c = controls.get(n);
      if (c === undefined) continue;
      if (c.field) c.shown = (n as any).value;
      tell(n, true);
      for (const b of c.bindings) {
        // (not the value it last applied: the control no longer shows it)
        b.value = NaN;
        b.engine.enqueue(b);
      }
    }
  });
}

/**
 * Hears the root a bound control is in: `change`, `submit` and `reset` do not leave a shadow root, so each
 * root is heard; a composition's events do, so the document hears them for every root.
 */
function listen(root: Node): void {
  // (a Light DOM component's engine is mounted on its host: the root that host is in)
  const r = root.nodeType === 1 ? root.getRootNode() : root;
  if (listened.has(r)) return;
  listened.add(r);
  r.addEventListener("change", changed);
  // (before the page's own handler: it reads state)
  r.addEventListener("submit", submitting, true);
  r.addEventListener("reset", wasReset);
  const doc = r.ownerDocument ?? r;
  if (composers.has(doc)) return;
  composers.add(doc);
  doc.addEventListener("compositionstart", composed, true);
  doc.addEventListener("compositionend", composedEnd, true);
}

export const forms: Feature = {
  name: "forms",
  hooks,
  install(): void {
    hooks.declare = chain(hooks.declare, (engine) => {
      // (the first state it takes in: a re-set's engine has bound its root already)
      if ((engine as any).target === undefined) fresh.add(engine);
      watch(engine);
    });
    hooks.drained = chain(hooks.drained, watch);
    // (the document of the page the add-on is installed in; a form in a shadow root is bound with its root.
    // `input` leaves a shadow root, `change` does not: a checkbox and a select send both)
    const doc = globalThis.document;
    doc?.addEventListener("submit", early, true);
    doc?.addEventListener("input", touch, true);
    doc?.addEventListener("change", touch, true);
  },
};
export default forms;
