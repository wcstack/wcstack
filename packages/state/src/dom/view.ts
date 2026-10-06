import { rowAt, type Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { StateList, StateRow } from "../list";
import { pipe, type FilterFn } from "./filters";
import { isHtmlSink, trustHtml } from "../trustedTypes";
import { autoNaming, nameBlock } from "./naming";
import { raise, M } from "../messages";
import { hooks } from "../hooks";

/**
 * `on*:` bindings of bubbling events are delegated: one listener per event type on the root
 * (so `event.currentTarget` is the root — decided 2026-09-25), which runs the handlers of the
 * elements the event passed, innermost first. Inside a block the handler is not attached to the
 * element at all: the block's top node carries the block, which finds its handlers from its plan
 * when an event passes (Block.dispatch). Outside any block (a root-level element), where a
 * block's content can shift before the element (see compilePlan), and on a custom element, the
 * handler is stored on the element. A custom element may dispatch such an event without bubbling
 * (the root never hears it): that one is heard on the element. A non-bubbling event type gets a
 * listener on the element itself.
 *
 * `on*#direct:` is not delegated: a listener on the element itself, as 3.x (`currentTarget` is the
 * element) — `#stop` stops the page's own listeners on its ancestors, an ancestor's
 * `stopPropagation()` does not keep it from running, and an element moved under another root still
 * runs it. In a block (a row, a branch) it is attached with the block and removed when the block
 * goes. It runs where the DOM puts it: an outer `#direct` runs before the delegated handlers inside
 * it (they run at the root), so an inner `#stop` stops it only if the inner one is `#direct` too.
 */
export function attachEvent(engine: Engine, node: Node, s: Spec, row: StateRow | null, block: Block | null): void {
  const fn = s.listener!;
  const h = (e: Event): void => fn(e, row);
  if (s.delegated) {
    const key = engine.delegate(s.name);
    const prev = (node as any)[key];
    // two of one type on one element (`onclick: a; onclick: b`): both run
    (node as any)[key] = prev === undefined ? h : (e: Event): void => {
      prev(e);
      h(e);
    };
    if (s.custom) node.addEventListener(s.name, (e) => e.bubbles || h(e));
  } else {
    node.addEventListener(s.name, h);
    if (s.direct && block !== null) (block.cleanups ??= []).push(() => node.removeEventListener(s.name, h));
  }
}

/** Events that bubble: the only ones a delegated listener can see. */
export const BUBBLING = new Set(["click", "dblclick", "input", "change", "submit", "keydown", "keyup", "mousedown", "mouseup", "pointerdown", "pointerup"]);

import { attachCommand, attachEventToken, attachProperty, attachSpread, mirrorAttribute, whenDefined, type Bindable } from "./wc";

export const K_TEXT = 0;
export const K_PROP = 1;
export const K_CLASS = 2;
export const K_ATTR = 3;
export const K_STYLE = 4;
export const K_EVENT = 5;
export const K_FOR = 6;
export const K_IF = 7;
export const K_HTML = 8;
export const K_RADIO = 9;
export const K_CHECKBOX = 10;
/** A property of a custom element (direction and authority from its wc-bindable declaration). */
export const K_CUSTOM = 11;
export const K_COMMAND = 12;
export const K_EVTTOKEN = 13;
export const K_SPREAD = 14;


export interface BranchSpec {
  /** Index into the plan's node paths: the anchor this branch renders before. */
  node: number;
  plan: RowPlan;
  /** null for `else:`. */
  pattern: Pattern | null;
  filters: FilterFn[] | null;
}

export interface Spec {
  /** Index into the plan's node paths (unused at the root). */
  node: number;
  kind: number;
  /** Property / class / attribute / style name, or the event type. */
  name: string;
  pattern: Pattern | null;
  filters: FilterFn[] | null;
  /** What the DOM already shows, so the first apply can skip a no-op write. */
  initial: unknown;
  /** Event handler, run for the row of the block the element is in (null outside rows). */
  listener: ((e: Event, row: StateRow | null) => void) | null;
  /** An event binding whose type bubbles: dispatched from the root listener. */
  delegated: boolean;
  /** `on*#direct:`: a listener on the element itself (see attachEvent). */
  direct: boolean;
  /** The row plan of a nested `for`. */
  plan: RowPlan | null;
  /** The branches of an `if` / `elseif` / `else` chain. */
  branches: BranchSpec[] | null;
  /** Input filters (left side), applied to what the element writes back. */
  inFilters: FilterFn[] | null;
  /** The event that writes the element's value back to state (two-way, radio, checkbox), or null. */
  twoWay: string | null;
  /** On a custom element: the binding is resolved when the element's class is defined. */
  custom: boolean;
  /** `#init=` / `#sync=` (binding authority on wc-bindable members). */
  init: string | null;
  sync: string | null;
  /** `#ro`: the element never writes back. */
  ro: boolean;
  prevent: boolean;
  stop: boolean;
  /** The path a command / event token binding names: `$command.<token>` / the event token's name. */
  token: string | null;
  /** Spread: members bound explicitly after it on the same element (last wins). */
  exclude: string[] | null;
  /**
   * In a row plan: the index of this binding among the row's slots (-1 = a Binding object is
   * built with the row). A slot binding reads its own row and needs nothing from the element,
   * so the row keeps only its node and value until a change reaches it.
   */
  slot: number;
}

export interface RowPlan {
  fragment: DocumentFragment;
  /** The single top-level node (when `single`), cloned directly instead of the fragment. */
  root: Node | null;
  /** Reused per block creation (nodes are handed to bindings before the next block). */
  scratch: Node[];
  /** The child-index path of every bound node (from the fragment). */
  nodePaths: number[][];
  /** The node paths a block resolves when it is built (the others serve only delegated events). */
  build: number[];
  /** The delegated event specs found through the block (by their node paths) when an event passes. */
  events: Spec[];
  /** The specs bound as a block is built (all but `events`). */
  specs: Spec[];
  /** The block renders exactly one top-level node. */
  single: boolean;
  /** Some spec builds a nested view (for / if): the scratch nodes must be copied first. */
  nested: boolean;
  /** The slot specs of a row plan, by slot index (empty for a branch plan). */
  lazy: Spec[];
}

/**
 * A binding's type as the parser classifies it (@wcstack/state 3.x reports the same in
 * `$errorCallback`'s info, the console and DevTools): `class.` / `attr.` / `style.` / `command.`
 * and HTML are properties, `eventToken.` is an event.
 */
const TYPE_NAMES = ["text", "prop", "prop", "prop", "prop", "event", "for", "if", "prop", "radio", "checkbox", "prop", "prop", "event", "spread"];

/** A binding refused as it is attached fails alone (reported as its own failure). */
export const failSpec = (engine: Engine, error: unknown, s: Spec, node: Node): void =>
  engine.failAt(error, s.pattern?.path ?? s.token!, node, TYPE_NAMES[s.kind]);

/** A binding's first value when #init= leaves the element as it is: its first apply only records the value. */
const HOLD: unique symbol = Symbol() as never;

/**
 * The first value of a binding on an element with no wc-bindable declaration. `#init=none` and
 * `element`, and `auto` over an undefined state value, leave the element as it is (3.3): the
 * value is still read (a getter must be, for a change to reach it) and applied from the next change.
 */
export function initialOf(engine: Engine, s: Spec, row: StateRow | null): unknown {
  const init = s.init;
  return init === null || init === "state" || (init === "auto" && engine.readUntracked(s.pattern!, row) !== undefined) ? s.initial : HOLD;
}

export class Binding {
  queued = false;
  declare readonly engine: Engine;
  declare readonly kind: number;
  declare readonly node: Node;
  declare readonly name: string;
  declare readonly pattern: Pattern;
  /** Row at pattern.depth (null for a root-level pattern). */
  declare readonly row: StateRow | null;
  /** The block that renders this binding (null at the root). */
  declare readonly owner: Block | null;
  declare readonly filters: FilterFn[] | null;
  /** Input filters for the value the element writes back. */
  inFilters: FilterFn[] | null = null;
  /** The `if` chain an `if`/`elseif` condition drives. */
  declare readonly chain: IfView | null;
  declare value: unknown;
  /** Custom element input: the attribute its value is mirrored to. */
  attribute: string | null = null;
  /** Set while state writes the element (an event it fires synchronously is our own echo). */
  applying = false;

  constructor(engine: Engine, kind: number, node: Node, name: string, pattern: Pattern,
    row: StateRow | null, owner: Block | null, filters: FilterFn[] | null, initial: unknown, chain: IfView | null = null) {
    this.engine = engine;
    this.kind = kind;
    this.node = node;
    this.name = name;
    this.pattern = pattern;
    this.row = row;
    this.owner = owner;
    this.filters = filters;
    this.value = initial;
    this.chain = chain;
  }

  typeName(): string {
    return TYPE_NAMES[this.kind];
  }

  apply(): void {
    if (this.chain !== null) {
      this.chain.update();
      return;
    }
    const v = pipe(this.filters, this.engine.read(this.pattern, this.row));
    // the same object may have changed in place ($postUpdate, an array assigned again): shown
    // again — but an element input keeps the object it already has, and an HTML sink the markup it
    // parsed (a TrustedHTML does not change: parsing it again would rebuild the nodes). A radio is
    // set again: checking another one of its group unchecked it.
    if (v === this.value && this.kind !== K_RADIO && (typeof v !== "object" || v === null || this.kind === K_CUSTOM || this.kind === K_HTML || isHtmlSink(this.name))) return;
    if (this.value === HOLD) {
      this.value = v;
      return;
    }
    const n = this.node as any;
    if (this.kind === K_CUSTOM) {
      if (v === undefined) {
        // an element input keeps its own value when state has no opinion (B8)
        this.value = v;
        return;
      }
      this.value = v;
      this.applying = true;
      try {
        if (n[this.name] !== v) n[this.name] = v;
      } finally {
        this.applying = false;
      }
      if (this.attribute !== null) mirrorAttribute(n, this.attribute, v);
      return;
    }
    if (this.kind === K_RADIO) n.checked = v !== undefined && this.elementValue() === v;
    else if (this.kind === K_CHECKBOX) n.checked = Array.isArray(v) && v.includes(this.elementValue());
    else applyTo(this.kind, n, this.name, v);
    this.value = v;
  }

  /** The element's own value (radio / checkbox), through the input filters. */
  elementValue(): unknown {
    return pipe(this.inFilters, (this.node as any).value);
  }

  /** Writes the element's value back to state (two-way, radio, checkbox). */
  writeBack(): void {
    const n = this.node as any;
    const engine = this.engine;
    let v: unknown;
    if (this.kind === K_RADIO) {
      if (!n.checked) return;
      v = this.elementValue();
    } else if (this.kind === K_CHECKBOX) {
      const e = this.elementValue();
      const cur = engine.readUntracked(this.pattern, this.row);
      const arr = Array.isArray(cur) ? cur : [];
      const has = arr.includes(e);
      // checked and listed, or neither: nothing to write
      if (n.checked ? has : !has) return;
      v = has ? arr.filter((x) => x !== e) : [...arr, e];
    } else {
      v = pipe(this.inFilters, n[this.name]);
      // the element shows its own value now, not the last applied one: the next apply runs (NaN
      // equals nothing) — a write in the same drain may put that value back (a reset, a validation)
      this.value = NaN;
    }
    engine.write(this.pattern, this.row, v, false, true);
  }
}

/** A property that is the element's content (its children are a value). */
export const isContent = (name: string): boolean => name === "textContent" || name === "innerText" || name === "innerHTML";

/**
 * Writes `v` to the element: the kinds that need nothing but the node and the name (the
 * ones a row slot can hold).
 */
export function applyTo(kind: number, n: any, name: string, v: unknown): void {
  switch (kind) {
    case K_TEXT:
      n.data = v == null ? "" : String(v);
      return;
    case K_PROP:
      // display surfaces: undefined and null both mean "no value" (B8); other properties are element inputs
      if (isContent(name)) {
        // a string, as a browser's setter makes it (happy-dom — the server's DOM — writes 0 as "", and
        // throws on a number for innerText); innerHTML keeps a TrustedHTML as it is
        n[name] = name === "innerHTML" ? trustHtml(v) : v == null ? "" : String(v);
      } else if (isHtmlSink(name)) {
        // srcdoc without a value: the attribute goes (the frame shows its src again, as attr.srcdoc:
        // did); outerHTML: undefined writes nothing ("" would take the element itself out)
        if (v == null && name === "srcdoc") n.removeAttribute(name);
        else if (v !== undefined) n[name] = trustHtml(v);
      } else if (v !== undefined) {
        // undefined: an element input keeps its own value when state has no opinion (B8);
        // never re-write what the element already shows (keeps the caret while typing)
        if (n[name] !== v && !(name === "value" && n.value === String(v))) n[name] = v;
        // a select's value may name an option not rendered yet: kept for reselect
        if ((name === "value" || name === "selectedIndex") && n.localName === "select") n[SELECTED] = [name, v];
      }
      return;
    case K_HTML:
      n.innerHTML = trustHtml(v);
      return;
    case K_CLASS:
      if (v != null && typeof v !== "boolean") {
        raise(M.ClassNeedsBoolean, [name, typeof v]);
      }
      n.classList.toggle(name, v === true);
      return;
    case K_ATTR:
      if (v == null) n.removeAttribute(name);
      else n.setAttribute(name, String(v));
      return;
    case K_STYLE:
      // the property as CSS writes it (background-color, --gap), or as the DOM does
      // (backgroundColor, which setProperty ignores; 3.x wrote style[name])
      if (!name.includes("-")) n.style[name] = v == null ? "" : String(v);
      else if (v == null) n.style.removeProperty(name);
      else n.style.setProperty(name, String(v));
      return;
  }
}

/** A select's last bound `value` / `selectedIndex`: [name, value]. */
const SELECTED: unique symbol = Symbol() as never;

/**
 * A view rendered options into `parent`: the select's bound value is applied again. A block binds
 * its plan in document order, so a select's value there comes before the options a `for` inside
 * it renders, and names none of them; so does a value applied before a later change renders more
 * options (3.3 applies it after the options). (On the page a select's children are bound first.)
 */
function reselect(parent: Node): void {
  const sel: any = (parent as Element).localName === "optgroup" ? parent.parentNode : parent;
  const r = sel?.[SELECTED];
  if (r !== undefined) sel[r[0]] = r[1];
}

/**
 * One rendering of a plan: a list row (RowView) or the content of an `if` branch.
 * It owns its nodes, its bindings and the structural views nested in it.
 */
export class Block {
  alive = true;
  /** The row this block renders in (its own row for a RowView; the enclosing row, or null, for an if branch). */
  declare readonly row: StateRow | null;
  declare readonly first: ChildNode;
  /** All top-level nodes when the plan renders more than one. */
  declare readonly nodes: ChildNode[] | null;
  /** The Binding objects built with this block, unregistered when it goes (allocated on first use). */
  bindings: Binding[] | null = null;
  children: (ForView | IfView)[] | null = null;
  /** Run when the block goes away (token unsubscriptions); allocated on first use. */
  cleanups: (() => void)[] | null = null;
  /** The view anchored at the block's first top-level node: it renders before the block's first node. */
  lead: ForView | IfView | null = null;
  declare readonly plan: RowPlan;

  constructor(row: StateRow | null, first: ChildNode, nodes: ChildNode[] | null, plan: RowPlan) {
    this.row = row;
    this.first = first;
    this.nodes = nodes;
    this.plan = plan;
  }

  /**
   * An event of `type` reached this block's top node: runs the handlers of the block's
   * elements it passed, innermost first. Returns true when one of them stopped it.
   */
  dispatch(type: string, e: Event): boolean {
    const target = e.target as Node;
    const plan = this.plan;
    // the specs are in document order (an element's own together): the elements the event passed
    // are met outermost first, so each one's handlers go in front — innermost first
    const hits: Spec[][] = [];
    let last: Node | null = null;
    for (const s of plan.events) {
      if (s.name !== type) continue;
      const path = plan.nodePaths[s.node];
      const n = nodeAt(this.nodes === null ? this.first : this.nodes[path[0]], path, 1);
      if (!n.contains(target)) continue;
      if (n !== last) hits.unshift([]);
      hits[0].push(s);
      last = n;
    }
    // stopPropagation stops the elements further out, not the rest of the same element's (as the DOM)
    for (const own of hits) {
      for (const s of own) s.listener!(e, this.row);
      if (e.cancelBubble) return true;
    }
    return false;
  }

  get last(): ChildNode {
    return this.nodes === null ? this.first : this.nodes[this.nodes.length - 1];
  }

  /**
   * The block's first node. A view nested at the block's top level renders before its anchor, so
   * the block spans from here to its last top-level node, the rows and branches of those views
   * included.
   */
  head(): ChildNode {
    const v = this.lead;
    return (v === null ? null : v.headAt(this.first)) ?? this.first;
  }

  insertBefore(parent: Node, ref: Node | null): void {
    const last = this.last;
    for (let n = this.head(); ; ) {
      const next = n.nextSibling!;
      parent.insertBefore(n, ref);
      if (n === last) return;
      n = next;
    }
  }

  removeNodes(): void {
    if (this.nodes === null) this.first.remove();
    else removeContiguous(this.head(), this.last);
  }

  /** Stops the block: runs its cleanups, unregisters its bindings, disposes the views nested in it. */
  dispose(engine: Engine): void {
    this.alive = false;
    if (this.cleanups !== null) for (const c of this.cleanups) c();
    const bs = this.bindings;
    if (bs !== null) for (let i = 0; i < bs.length; i++) engine.unregister(bs[i]);
    if (this.children !== null) for (const c of this.children) c.dispose();
  }
}

/**
 * The rendering of one row by one for view. Its slot bindings (plan.lazy) are kept as
 * node / value pairs and become Binding objects only when a change first reaches them:
 * creating a row allocates no Binding for them and registers nothing — a change of the
 * row finds them through the row's views (Engine.enqueueBound).
 */
export class RowView extends Block {
  /** Position in the view's previous order (set during an update). */
  pos = 0;
  /** [node0, value0, node1, value1, …] by slot; the value is the last one applied. */
  declare readonly slots: unknown[] | null;
  /** The Binding objects the slots became (sparse, allocated on first use). */
  bound: (Binding | undefined)[] | null = null;

  constructor(row: StateRow, first: ChildNode, nodes: ChildNode[] | null, plan: RowPlan) {
    super(row, first, nodes, plan);
    this.slots = plan.lazy.length === 0 ? null : new Array(plan.lazy.length * 2);
  }

  /** The Binding object of slot k (built on first use; from then on it holds the value). */
  slotBinding(engine: Engine, k: number): Binding {
    const bound = (this.bound ??= new Array(this.plan.lazy.length));
    let b = bound[k];
    if (b === undefined) {
      const s = this.plan.lazy[k];
      const slots = this.slots!;
      b = bound[k] = new Binding(engine, s.kind, slots[2 * k] as Node, s.name, s.pattern!, this.row, this, s.filters, slots[2 * k + 1]);
    }
    return b;
  }

  /** Queues the slot bindings on `p` or under it. */
  enqueueSlots(engine: Engine, p: Pattern): void {
    const lazy = this.plan.lazy;
    for (let k = 0; k < lazy.length; k++) if (lazy[k].pattern!.isUnder(p)) engine.enqueue(this.slotBinding(engine, k));
  }

  override dispose(engine: Engine): void {
    const row = this.row!;
    if (row.view === this) row.view = null;
    super.dispose(engine);
  }
}

/**
 * The list whose rows `p` ranges over, in the context of `row`. A path that fails to read
 * (a missing top-level key) is reported as the `for` binding's failure and the list starts
 * empty: it was created before the read, so a later write of the path fills it.
 */
export function listFor(engine: Engine, p: Pattern, row: StateRow | null, anchor: Node): StateList {
  const parent = rowAt(row, p.depth);
  try {
    return engine.childList(parent, p);
  } catch (error) {
    engine.failAt(error, p.path, anchor, "for");
    return parent === null ? engine.rootLists.get(p)! : parent.children!.get(p)!;
  }
}

/**
 * Records `b` in its block (unregistered when the block goes) and, unless it only carries
 * element → state, registers it where a change of its location finds it.
 */
export function adopt(engine: Engine, b: Binding, register: boolean): void {
  if (register) engine.register(b);
  const owner = b.owner;
  if (owner !== null) (owner.bindings ??= []).push(b);
}

/** The block built by the last buildBlock call (taken right after it; saves an allocation per row). */
let lastBlock: Block | null = null;

/** The block the last buildBlock call built; released here so a removed tree is not kept alive. */
function takeBlock(): Block {
  const b = lastBlock!;
  lastBlock = null;
  return b;
}

/** The auto-naming cap for the blocks being built (-1: none), read once per view update. */
let naming = -1;

/**
 * Clones the plan in the context of `row`, binds it and applies the initial values
 * (off-document). `fv`: the for view the block is a row of (null for an if branch).
 * Returns the node to insert: the block's element, or a fragment of its nodes.
 */
export function buildBlock(engine: Engine, plan: RowPlan, row: StateRow | null, fv: ForView | null, at: Node | null = null): Node {
  const paths = plan.nodePaths;
  const build = plan.build;
  const nodes = plan.scratch;
  let first: ChildNode;
  let all: ChildNode[] | null = null;
  // SSR hydration: the server's nodes, where they are (the add-on put the plan's nodes in them in
  // `nodes`); the view then inserts an empty fragment
  const adopted = hooks.adopt?.(plan, fv === null ? at! : fv.anchor, fv !== null);
  const single = !adopted && plan.single;
  // a single plan clones the block's element itself; paths start at the fragment, so skip their first step
  const top = adopted ? document.createDocumentFragment() : (single ? plan.root! : plan.fragment).cloneNode(true);
  if (!adopted) for (let b = 0; b < build.length; b++) {
    const i = build[b];
    nodes[i] = nodeAt(top, paths[i], single ? 1 : 0);
  }
  if (single) {
    first = top as ChildNode;
  } else {
    all = adopted || [...top.childNodes] as ChildNode[];
    first = all[0];
  }
  let block: Block;
  let rv: RowView | null = null;
  if (fv !== null) {
    block = rv = new RowView(row!, first, all, plan);
    if (fv.map === null) row!.view = rv;
    else fv.map.set(row!, rv);
  } else {
    block = new Block(row, first, all, plan);
  }
  if (naming >= 0) nameBlock(first, all, fv !== null ? "row" : "branch", naming);
  if (plan.events.length > 0) {
    // delegated events find the block through its top node(s)
    const key = engine.blockKey;
    if (all === null) (first as any)[key] = block;
    else for (const n of all) if (n.nodeType === 1) (n as any)[key] = block;
  }
  const specs = plan.specs;
  const rendered = engine.rendered;
  // the scratch array is ours until a nested view builds a block of another plan: take
  // every node we need before that can happen
  const own = plan.nested ? nodes.slice(0, paths.length) : nodes;
  const slots = rv === null ? null : rv.slots;
  if (slots !== null) {
    // every slot has its node before anything runs: an element bound earlier in the row can
    // write state (wc-bindable seeding) and so reach a slot further on
    const lazy = plan.lazy;
    for (let k = 0; k < lazy.length; k++) {
      slots[2 * k] = own[lazy[k].node];
      slots[2 * k + 1] = lazy[k].initial;
    }
  }
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const node = own[s.node];
    const k = s.slot;
    if (k >= 0 && slots !== null) {
      // a slot: the node and the value are all the row keeps
      const b = rv!.bound?.[k];
      if (b !== undefined) {
        // already reached by a change during this build: it is a Binding now, applied here (and
        // so no longer queued: the drain skips it)
        b.queued = false;
        engine.applyBinding(b);
        continue;
      }
      try {
        const v = pipe(s.filters, engine.read(s.pattern!, row));
        if (v !== s.initial) {
          applyTo(s.kind, node, s.name, v);
          slots[2 * k + 1] = v;
        }
        if (rendered !== null) engine.noteRendered(s.pattern!, row);
      } catch (error) {
        engine.fail(error, rv!.slotBinding(engine, k));
      }
      continue;
    }
    switch (s.kind) {
      case K_FOR: {
        const view = new ForView(engine, s.plan!, listFor(engine, s.pattern!, row, node), node as Comment);
        (block.children ??= []).push(view);
        if (node === first) block.lead = view;
        view.update();
        break;
      }
      case K_IF: {
        const iv = attachChain(engine, s.branches!.map((br) => ({ plan: br.plan, pattern: br.pattern, filters: br.filters, anchor: own[br.node] })), row, block);
        (block.children ??= []).push(iv);
        if (node === first) block.lead = iv;
        break;
      }
      default:
        // (the delegated events found through the block are not among the specs: nothing per row)
        // A binding refused as it is attached (an undeclared token or member, a failing `#init=auto`
        // read) fails alone: the row is still built whole, so its view's records stay right
        try {
          attachSpec(engine, s, node, row, block);
        } catch (error) {
          failSpec(engine, error, s, node);
        }
    }
  }
  lastBlock = block;
  return top;
}

/**
 * Binds a spec that builds no view to `node`, in `block` (null: a root-level element). A
 * delegated event that reaches here is stored on the element (attachEvent).
 */
export function attachSpec(engine: Engine, s: Spec, node: Node, row: StateRow | null, block: Block | null): void {
  const el = node as Element;
  switch (s.kind) {
    case K_EVENT:
      attachEvent(engine, node, s, row, block);
      return;
    case K_COMMAND:
      whenDefined(engine, s, el, block, (bd) => attachCommand(engine, s, el, block, bd));
      return;
    case K_EVTTOKEN:
      whenDefined(engine, s, el, block, (bd) => attachEventToken(engine, s, el, row, bd));
      return;
  }
  const p = s.pattern!;
  const brow = rowAt(row, p.depth);
  if (s.kind === K_SPREAD) {
    whenDefined(engine, s, el, block, (bd) => attachSpread(engine, s, el, brow, block, bd));
    return;
  }
  if (s.custom && s.kind === K_PROP) {
    whenDefined(engine, s, el, block, (bd) => attachCustomOrPlain(engine, s, el, brow, block, bd));
    return;
  }
  const b = new Binding(engine, s.kind, node, s.name, p, brow, block, s.filters, initialOf(engine, s, brow));
  b.inFilters = s.inFilters;
  adopt(engine, b, true);
  engine.applyBinding(b);
  if (s.twoWay !== null) node.addEventListener(s.twoWay, () => b.writeBack());
}

/** A property binding on a custom element: wc-bindable members get direction and authority, others are plain. */
export function attachCustomOrPlain(engine: Engine, s: Spec, el: Element, row: StateRow | null, owner: Block | null, bd: Bindable | null): void {
  if (bd !== null) {
    attachProperty(engine, s, el, s.name, s.pattern!, row, owner, bd);
    return;
  }
  const b = new Binding(engine, K_PROP, el, s.name, s.pattern!, row, owner, s.filters, initialOf(engine, s, row));
  b.inFilters = s.inFilters;
  if (hooks.hostBinding?.(b, s.ro)) return;
  adopt(engine, b, true);
  engine.applyBinding(b);
}

export interface Branch {
  plan: RowPlan;
  pattern: Pattern | null;
  filters: FilterFn[] | null;
  anchor: Node;
}

/**
 * Builds an `if` chain: one condition binding per `if`/`elseif` (each drives the whole
 * chain) and the initial render. `owner` is the enclosing block (null at the root).
 */
export function attachChain(engine: Engine, branches: Branch[], row: StateRow | null, owner: Block | null): IfView {
  const iv = new IfView(engine, branches, row);
  let first: Binding | null = null;
  for (const br of branches) {
    if (br.pattern === null) continue;
    const p = br.pattern;
    const b = new Binding(engine, K_IF, br.anchor, "if", p, rowAt(row, p.depth), owner, null, undefined, iv);
    adopt(engine, b, true);
    if (owner === null) iv.rootBindings.push(b);
    first ??= b;
  }
  // the first branch is the `if:`: it always has a condition
  engine.applyBinding(first!);
  return iv;
}

export class IfView {
  alive = true;
  current: Block | null = null;
  index = -1;
  /** Condition bindings of a root-level chain (a nested chain's belong to its block). */
  readonly rootBindings: Binding[] = [];
  declare readonly engine: Engine;
  declare readonly branches: Branch[];
  declare readonly row: StateRow | null;

  constructor(engine: Engine, branches: Branch[], row: StateRow | null) {
    this.engine = engine;
    this.branches = branches;
    this.row = row;
  }

  /** The first node this chain renders before anchor `n` (the shown branch's, if `n` is its anchor). */
  headAt(n: Node): ChildNode | null {
    return this.current !== null && this.branches[this.index].anchor === n ? this.current.head() : null;
  }

  /** Renders the first branch whose condition holds (JavaScript truthiness), or nothing. */
  update(): void {
    const engine = this.engine;
    let index = -1;
    for (let i = 0; i < this.branches.length; i++) {
      const br = this.branches[i];
      // `else:` (no condition) always holds
      if (br.pattern === null || pipe(br.filters, engine.read(br.pattern, rowAt(this.row, br.pattern.depth)))) {
        index = i;
        break;
      }
    }
    if (index === this.index) return;
    naming = autoNaming();
    if (this.current !== null) {
      this.current.removeNodes();
      this.current.dispose(engine);
      this.current = null;
    }
    this.index = index;
    if (index >= 0) {
      const br = this.branches[index];
      const top = buildBlock(engine, br.plan, this.row, null, br.anchor);
      this.current = takeBlock();
      const parent = br.anchor.parentNode!;
      parent.insertBefore(top, br.anchor);
      reselect(parent);
    }
  }

  dispose(): void {
    this.alive = false;
    for (const b of this.rootBindings) this.engine.unregister(b);
    if (this.current !== null) this.current.dispose(this.engine);
  }
}

export class ForView {
  alive = true;
  rowViews: RowView[] = [];
  declare readonly engine: Engine;
  declare readonly plan: RowPlan;
  declare readonly list: StateList;
  declare readonly anchor: Comment;
  /**
   * The row views by row when another for view already renders this list (the list's first
   * view keeps them on row.view instead).
   */
  declare readonly map: Map<StateRow, RowView> | null;

  constructor(engine: Engine, plan: RowPlan, list: StateList, anchor: Comment) {
    this.engine = engine;
    this.plan = plan;
    this.list = list;
    this.anchor = anchor;
    if (list.view === null) {
      list.view = this;
      this.map = null;
    } else {
      (list.extra ??= []).push(this);
      this.map = new Map();
    }
  }

  /** The first node this view renders (before its anchor), or null with no rows. */
  headAt(_n: Node): ChildNode | null {
    return this.rowViews.length === 0 ? null : this.rowViews[0].head();
  }

  /** This view's rendering of `row`, or null. */
  viewOf(row: StateRow): RowView | null {
    return this.map === null ? row.view : this.map.get(row) ?? null;
  }

  private drop(rv: RowView): void {
    const map = this.map;
    if (map !== null && map.get(rv.row!) === rv) map.delete(rv.row!);
    rv.dispose(this.engine);
  }

  /** Brings the DOM in line with list.rows, moving kept rows as little as possible. */
  update(): void {
    const engine = this.engine;
    const rows = this.list.rows;
    const old = this.rowViews;
    naming = autoNaming();
    const n = rows.length;
    const o = old.length;
    const anchor = this.anchor;
    const parent = anchor.parentNode!;

    if (n === 0) {
      if (o > 0) {
        const first = old[0].head();
        const last = old[o - 1].last;
        // the rows are all the parent holds but the anchor and text (a <tbody> of rows, its whitespace):
        // one call empties it and puts those back — faster than a Range in Chromium (10,000 rows: 14 %; node
        // by node is 5 % slower than one) and linear in happy-dom. An element beside them would be put back
        // too (a custom element reconnected, an iframe reloaded): then node by node
        let keep: Node[] | null = [];
        for (let x = parent.firstChild; x !== null; x = x === first ? last.nextSibling : x.nextSibling) {
          if (x === first) continue;
          if (x !== anchor && x.nodeType !== 3) {
            keep = null;
            break;
          }
          keep.push(x);
        }
        if (keep !== null) parent.replaceChildren(...keep);
        else removeContiguous(first, last);
        for (let i = 0; i < o; i++) this.drop(old[i]);
      }
      this.rowViews = [];
      return;
    }

    const views: RowView[] = new Array(n);
    let s = 0;
    while (s < n && s < o && this.viewOf(rows[s]) === old[s]) {
      views[s] = old[s];
      s++;
    }
    let oe = o - 1;
    let ne = n - 1;
    while (oe >= s && ne >= s && this.viewOf(rows[ne]) === old[oe]) {
      views[ne] = old[oe];
      oe--;
      ne--;
    }
    for (let i = s; i <= oe; i++) {
      const rv = old[i];
      const row = rv.row!;
      if (!row.alive || this.viewOf(row) !== rv) {
        rv.removeNodes();
        this.drop(rv);
      } else {
        rv.pos = i;
      }
    }
    if (s <= ne) {
      const m = ne - s + 1;
      const src = new Int32Array(m);
      let anyKept = false;
      // no rows before: none kept (the first render builds every row)
      if (o > 0) for (let i = 0; i < m; i++) {
        const rv = this.viewOf(rows[s + i]);
        if (rv !== null && rv.alive) {
          src[i] = rv.pos;
          anyKept = true;
        } else {
          src[i] = -1;
        }
      }
      const next0: Node = ne + 1 < n ? views[ne + 1].head() : anchor;
      if (!anyKept) {
        const frag = document.createDocumentFragment();
        for (let i = s; i <= ne; i++) {
          frag.appendChild(buildBlock(engine, this.plan, rows[i], this));
          views[i] = takeBlock() as RowView;
        }
        parent.insertBefore(frag, next0);
      } else {
        const keep = lisKeep(src);
        let next: Node = next0;
        for (let i = m - 1; i >= 0; i--) {
          const row = rows[s + i];
          let rv = this.viewOf(row);
          if (rv === null || !rv.alive) {
            parent.insertBefore(buildBlock(engine, this.plan, row, this), next);
            rv = takeBlock() as RowView;
          } else if (keep[i] === 0) {
            rv.insertBefore(parent, next);
          }
          views[s + i] = rv;
          next = rv.head();
        }
      }
    }
    this.rowViews = views;
    reselect(parent);
  }

  dispose(): void {
    this.alive = false;
    const list = this.list;
    if (list.view === this) {
      list.view = null;
    } else if (list.extra !== null) {
      const i = list.extra.indexOf(this);
      if (i >= 0) list.extra.splice(i, 1);
      if (list.extra.length === 0) list.extra = null;
    }
    for (const rv of this.rowViews) rv.dispose(this.engine);
    this.map?.clear();
  }
}

/** The node `path` leads to from `n`, following its steps from `j` on. */
function nodeAt(n: Node, path: number[], j: number): Node {
  for (; j < path.length; j++) {
    n = n.firstChild!;
    for (let k = path[j]; k > 0; k--) n = n.nextSibling!;
  }
  return n;
}

function removeContiguous(first: ChildNode, last: ChildNode): void {
  // node by node, not a Range's deleteContents(): happy-dom's (the DOM of @wcstack/testing and of SSR)
  // is quadratic — a list of 1,000 rows took 13 s to empty
  for (let n = first, next; n !== last; n = next) {
    next = n.nextSibling!;
    n.remove();
  }
  last.remove();
}

/** Marks the entries (>= 0) that form a longest increasing subsequence of `src`. */
export function lisKeep(src: Int32Array): Uint8Array {
  const n = src.length;
  const keep = new Uint8Array(n);
  const prev = new Int32Array(n).fill(-1);
  const tails: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = src[i];
    if (v < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (src[tails[mid]] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  let k = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (k >= 0) {
    keep[k] = 1;
    k = prev[k];
  }
  return keep;
}
