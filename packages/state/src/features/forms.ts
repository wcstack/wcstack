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
    if (!field && kind !== K_RADIO && kind !== K_CHECKBOX && !(kind === K_PROP && WRITES_BACK.has(b.name))) return;
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
    hooks.declare = chain(hooks.declare, watch);
    hooks.drained = chain(hooks.drained, watch);
  },
};
export default forms;
