import { rowAt, type Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { StateList, StateRow } from "../list";
import type { FilterFn } from "./filters";
import { isHtmlSink, trustHtml } from "../trustedTypes";

/**
 * `on*:` bindings of bubbling events are delegated: one listener per event type on the
 * root (so `event.currentTarget` is the root — decided 2026-09-25). Inside a block the
 * handler is not attached to the element at all: the block's top node carries the block,
 * which finds its handlers from its plan when an event passes (Block.dispatch). Outside
 * any block (a root-level element) the handler is stored on the element. A non-bubbling
 * event gets a listener on the element itself.
 */
export function attachEvent(engine: Engine, node: Node, s: Spec, row: StateRow | null): void {
  const fn = s.listener!;
  if (s.delegated) (node as any)[engine.delegate(s.name)] = fn;
  else node.addEventListener(s.name, (e) => fn(e, row));
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
  /** Command / event token name. */
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
  /** The delegated event specs: found through the block when an event passes. */
  events: Spec[];
  specs: Spec[];
  /** The block renders exactly one top-level node. */
  single: boolean;
  /** Some spec builds a nested view (for / if): the scratch nodes must be copied first. */
  nested: boolean;
  /** The slot specs of a row plan, by slot index (empty for a branch plan). */
  lazy: Spec[];
}

const TYPE_NAMES = ["text", "prop", "class", "attr", "style", "event", "for", "if", "html", "radio", "checkbox", "prop", "command", "eventToken", "spread"];
/** Display surfaces: undefined and null both mean "no value" (B8). Other properties are element inputs. */
const DISPLAY_PROPS = new Set(["textContent", "innerText", "innerHTML"]);

export class Binding {
  queued = false;
  readonly engine: Engine;
  readonly kind: number;
  readonly node: Node;
  readonly name: string;
  readonly pattern: Pattern;
  /** Row at pattern.depth (null for a root-level pattern). */
  readonly row: StateRow | null;
  /** The block that renders this binding (null at the root). */
  readonly owner: Block | null;
  readonly filters: FilterFn[] | null;
  /** Input filters for the value the element writes back. */
  inFilters: FilterFn[] | null = null;
  /** The `if` chain an `if`/`elseif` condition drives. */
  readonly chain: IfView | null;
  value: unknown;
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
    return TYPE_NAMES[this.kind] ?? "prop";
  }

  apply(): void {
    if (this.chain !== null) {
      this.chain.update();
      return;
    }
    let v = this.engine.read(this.pattern, this.row);
    const fs = this.filters;
    if (fs !== null) for (let i = 0; i < fs.length; i++) v = fs[i](v);
    if (v === this.value) return;
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
    let v: unknown = (this.node as any).value;
    const fs = this.inFilters;
    if (fs !== null) for (let i = 0; i < fs.length; i++) v = fs[i](v);
    return v;
  }

  /** Writes the element's value back to state (two-way, radio, checkbox). */
  writeBack(): void {
    const n = this.node as any;
    const engine = this.engine;
    if (this.kind === K_RADIO) {
      if (!n.checked) return;
      engine.write(this.pattern, this.row, this.elementValue());
      return;
    }
    if (this.kind === K_CHECKBOX) {
      const v = this.elementValue();
      const cur = engine.readUntracked(this.pattern, this.row);
      const arr = Array.isArray(cur) ? cur : [];
      const has = arr.includes(v);
      if (n.checked && !has) engine.write(this.pattern, this.row, [...arr, v]);
      else if (!n.checked && has) engine.write(this.pattern, this.row, arr.filter((x) => x !== v));
      return;
    }
    let v: unknown = n[this.name];
    const fs = this.inFilters;
    if (fs !== null) for (let i = 0; i < fs.length; i++) v = fs[i](v);
    engine.write(this.pattern, this.row, v);
  }
}

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
      if (DISPLAY_PROPS.has(name)) {
        n[name] = name === "innerHTML" ? trustHtml(v == null ? "" : String(v)) : v == null ? "" : v;
      } else if (isHtmlSink(name)) {
        n[name] = trustHtml(v == null ? "" : String(v));
      } else if (v !== undefined && n[name] !== v && !(name === "value" && n.value === String(v))) {
        // undefined: an element input keeps its own value when state has no opinion (B8);
        // never re-write what the element already shows (keeps the caret while typing)
        n[name] = v;
      }
      return;
    case K_HTML:
      n.innerHTML = trustHtml(v == null ? "" : String(v));
      return;
    case K_CLASS:
      if (v != null && typeof v !== "boolean") {
        throw new Error(`[wcs/binding-type] class.${name} needs a boolean (got ${typeof v}); write "class.${name}: path|truthy" to toggle on truthiness`);
      }
      n.classList.toggle(name, v === true);
      return;
    case K_ATTR:
      if (v == null) n.removeAttribute(name);
      else n.setAttribute(name, String(v));
      return;
    case K_STYLE:
      if (v == null) n.style.removeProperty(name);
      else n.style.setProperty(name, String(v));
      return;
  }
}

/**
 * One rendering of a plan: a list row (RowView) or the content of an `if` branch.
 * It owns its nodes, its bindings and the structural views nested in it.
 */
export class Block {
  alive = true;
  /** The row this block renders in (its own row for a RowView; the enclosing row, or null, for an if branch). */
  readonly row: StateRow | null;
  readonly first: ChildNode;
  /** All top-level nodes when the plan renders more than one. */
  readonly nodes: ChildNode[] | null;
  /** The Binding objects built with this block, unregistered when it goes (allocated on first use). */
  bindings: Binding[] | null = null;
  children: (ForView | IfView)[] | null = null;
  /** Run when the block goes away (token unsubscriptions); allocated on first use. */
  cleanups: (() => void)[] | null = null;
  readonly plan: RowPlan;

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
    let hits: { node: Node; spec: Spec }[] | null = null;
    for (const s of plan.events) {
      if (s.name !== type) continue;
      const path = plan.nodePaths[s.node];
      let n: Node = this.nodes === null ? this.first : this.nodes[path[0]];
      for (let j = 1; j < path.length; j++) {
        n = n.firstChild!;
        for (let k = path[j]; k > 0; k--) n = n.nextSibling!;
      }
      if (n.contains(target)) (hits ?? (hits = [])).push({ node: n, spec: s });
    }
    if (hits === null) return false;
    hits.sort((a, b) => (a.node.contains(b.node) ? 1 : -1));
    for (const { spec } of hits) {
      spec.listener!(e, this.row);
      if (e.cancelBubble) return true;
    }
    return false;
  }

  get last(): ChildNode {
    return this.nodes === null ? this.first : this.nodes[this.nodes.length - 1];
  }

  insertBefore(parent: Node, ref: Node | null): void {
    if (this.nodes === null) parent.insertBefore(this.first, ref);
    else for (const n of this.nodes) parent.insertBefore(n, ref);
  }

  removeNodes(): void {
    if (this.nodes === null) this.first.remove();
    else for (const n of this.nodes) n.remove();
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
  readonly slots: unknown[] | null;
  /** The Binding objects the slots became (sparse, allocated on first use). */
  bound: (Binding | undefined)[] | null = null;

  constructor(row: StateRow, first: ChildNode, nodes: ChildNode[] | null, plan: RowPlan) {
    super(row, first, nodes, plan);
    this.slots = plan.lazy.length === 0 ? null : new Array(plan.lazy.length * 2);
  }

  /** The Binding object of slot k (built on first use; from then on it holds the value). */
  slotBinding(engine: Engine, k: number): Binding {
    const bound = this.bound ?? (this.bound = new Array(this.plan.lazy.length));
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

/** The list whose rows `p` ranges over, in the context of `row`. */
function listFor(engine: Engine, p: Pattern, row: StateRow | null): StateList {
  return p.depth === 0 ? engine.rootList(p) : engine.childList(rowAt(row, p.depth)!, p);
}

/**
 * Records `b` in its block (unregistered when the block goes) and, unless it only carries
 * element → state, registers it where a change of its location finds it.
 */
export function adopt(engine: Engine, b: Binding, register: boolean): void {
  if (register) engine.register(b);
  const owner = b.owner;
  if (owner !== null) (owner.bindings ?? (owner.bindings = [])).push(b);
}

/** The block built by the last buildBlock call (read right after it; saves an allocation per row). */
export let lastBlock: Block | null = null;

/**
 * Clones the plan in the context of `row`, binds it and applies the initial values
 * (off-document). `fv`: the for view the block is a row of (null for an if branch).
 * Returns the node to insert: the block's element, or a fragment of its nodes.
 */
export function buildBlock(engine: Engine, plan: RowPlan, row: StateRow | null, fv: ForView | null): Node {
  const paths = plan.nodePaths;
  const build = plan.build;
  const nodes = plan.scratch;
  let top: Node;
  let first: ChildNode;
  let all: ChildNode[] | null = null;
  if (plan.single) {
    // clone the block's element itself; paths start at the fragment, so skip their first step
    top = plan.root!.cloneNode(true);
    for (let b = 0; b < build.length; b++) {
      const i = build[b];
      let n: Node = top;
      const path = paths[i];
      for (let j = 1; j < path.length; j++) {
        n = n.firstChild!;
        for (let k = path[j]; k > 0; k--) n = n.nextSibling!;
      }
      nodes[i] = n;
    }
    first = top as ChildNode;
  } else {
    top = plan.fragment.cloneNode(true);
    for (let b = 0; b < build.length; b++) {
      const i = build[b];
      let n: Node = top;
      const path = paths[i];
      for (let j = 0; j < path.length; j++) {
        n = n.firstChild!;
        for (let k = path[j]; k > 0; k--) n = n.nextSibling!;
      }
      nodes[i] = n;
    }
    all = Array.from(top.childNodes) as ChildNode[];
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
  if (plan.events.length > 0) {
    // delegated events find the block through its top node(s)
    const key = engine.blockKey;
    if (all === null) (first as any)[key] = block;
    else for (const n of all) if (n.nodeType === 1) (n as any)[key] = block;
  }
  const rowDepth = row === null ? 0 : row.list.depth;
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
        // already reached by a change during this build: it is a Binding now
        if (rendered === null) {
          try {
            b.apply();
          } catch (error) {
            engine.fail(error, b);
          }
        } else {
          engine.applyBinding(b);
        }
        continue;
      }
      try {
        let v = engine.read(s.pattern!, row);
        const fs = s.filters;
        if (fs !== null) for (let j = 0; j < fs.length; j++) v = fs[j](v);
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
      case K_EVENT:
        // a delegated one is found through the block (Block.dispatch)
        if (!s.delegated) attachEvent(engine, node, s, row);
        break;
      case K_FOR: {
        const view = new ForView(engine, s.plan!, listFor(engine, s.pattern!, row), node as Comment);
        (block.children ?? (block.children = [])).push(view);
        view.update();
        break;
      }
      case K_IF: {
        const iv = attachChain(engine, s.branches!.map((br) => ({ plan: br.plan, pattern: br.pattern, filters: br.filters, anchor: own[br.node] })), row, block);
        (block.children ?? (block.children = [])).push(iv);
        break;
      }
      case K_COMMAND:
        whenDefined(node as Element, block, (bd) => attachCommand(engine, s, node as Element, block, bd));
        break;
      case K_EVTTOKEN:
        whenDefined(node as Element, block, (bd) => attachEventToken(engine, s, node as Element, row, bd));
        break;
      case K_SPREAD: {
        const brow = s.pattern!.depth === 0 ? null : rowAt(row, s.pattern!.depth);
        whenDefined(node as Element, block, (bd) => attachSpread(engine, s, node as Element, brow, block, bd));
        break;
      }
      default: {
        const p = s.pattern!;
        const brow = p.depth === 0 ? null : p.depth === rowDepth ? row : rowAt(row, p.depth);
        if (s.custom && s.kind === K_PROP) {
          whenDefined(node as Element, block, (bd) => attachCustomOrPlain(engine, s, node as Element, brow, block, bd));
          break;
        }
        const b = new Binding(engine, s.kind, node, s.name, p, brow, block, s.filters, s.initial);
        b.inFilters = s.inFilters;
        adopt(engine, b, true);
        if (rendered === null) {
          try {
            b.apply();
          } catch (error) {
            engine.fail(error, b);
          }
        } else {
          engine.applyBinding(b);
        }
        if (s.twoWay !== null) node.addEventListener(s.twoWay, () => b.writeBack());
      }
    }
  }
  lastBlock = block;
  return top;
}

/** A property binding on a custom element: wc-bindable members get direction and authority, others are plain. */
export function attachCustomOrPlain(engine: Engine, s: Spec, el: Element, row: StateRow | null, owner: Block | null, bd: Bindable | null): void {
  if (bd !== null) {
    attachProperty(engine, s, el, s.name, s.pattern!, row, owner, bd);
    return;
  }
  const b = new Binding(engine, K_PROP, el, s.name, s.pattern!, row, owner, s.filters, s.initial);
  b.inFilters = s.inFilters;
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
    const b = new Binding(engine, K_IF, br.anchor, "if", p, p.depth === 0 ? null : rowAt(row, p.depth), owner, null, undefined, iv);
    adopt(engine, b, true);
    if (owner === null) iv.rootBindings.push(b);
    first ??= b;
  }
  if (first !== null) engine.applyBinding(first);
  else iv.update();
  return iv;
}

export class IfView {
  alive = true;
  current: Block | null = null;
  index = -1;
  /** Condition bindings of a root-level chain (a nested chain's belong to its block). */
  readonly rootBindings: Binding[] = [];
  readonly engine: Engine;
  readonly branches: Branch[];
  readonly row: StateRow | null;

  constructor(engine: Engine, branches: Branch[], row: StateRow | null) {
    this.engine = engine;
    this.branches = branches;
    this.row = row;
  }

  /** Renders the first branch whose condition holds (JavaScript truthiness), or nothing. */
  update(): void {
    if (!this.alive) return;
    const engine = this.engine;
    let index = -1;
    for (let i = 0; i < this.branches.length; i++) {
      const br = this.branches[i];
      if (br.pattern === null) {
        index = i;
        break;
      }
      let v = engine.read(br.pattern, br.pattern.depth === 0 ? null : rowAt(this.row, br.pattern.depth));
      const fs = br.filters;
      if (fs !== null) for (let k = 0; k < fs.length; k++) v = fs[k](v);
      if (v) {
        index = i;
        break;
      }
    }
    if (index === this.index) return;
    if (this.current !== null) {
      this.current.removeNodes();
      this.current.dispose(engine);
      this.current = null;
    }
    this.index = index;
    if (index >= 0) {
      const br = this.branches[index];
      const top = buildBlock(engine, br.plan, this.row, null);
      this.current = lastBlock;
      br.anchor.parentNode!.insertBefore(top, br.anchor);
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
  readonly engine: Engine;
  readonly plan: RowPlan;
  readonly list: StateList;
  readonly anchor: Comment;
  /**
   * The row views by row when another for view already renders this list (the list's first
   * view keeps them on row.view instead).
   */
  readonly map: Map<StateRow, RowView> | null;

  constructor(engine: Engine, plan: RowPlan, list: StateList, anchor: Comment) {
    this.engine = engine;
    this.plan = plan;
    this.list = list;
    this.anchor = anchor;
    if (list.view === null) {
      list.view = this;
      this.map = null;
    } else {
      (list.extra ?? (list.extra = [])).push(this);
      this.map = new Map();
    }
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
    const n = rows.length;
    const o = old.length;
    const anchor = this.anchor;
    const parent = anchor.parentNode!;

    if (n === 0) {
      if (o > 0) {
        removeContiguous(old[0].first, old[o - 1].last);
        for (let i = 0; i < o; i++) this.drop(old[i]);
      }
      this.rowViews = [];
      return;
    }
    if (o === 0) {
      const frag = document.createDocumentFragment();
      const views: RowView[] = new Array(n);
      for (let i = 0; i < n; i++) {
        frag.appendChild(buildBlock(engine, this.plan, rows[i], this));
        views[i] = lastBlock as RowView;
      }
      parent.insertBefore(frag, anchor);
      this.rowViews = views;
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
      for (let i = 0; i < m; i++) {
        const rv = this.viewOf(rows[s + i]);
        if (rv !== null && rv.alive) {
          src[i] = rv.pos;
          anyKept = true;
        } else {
          src[i] = -1;
        }
      }
      const next0: Node = ne + 1 < n ? views[ne + 1].first : anchor;
      if (!anyKept) {
        const frag = document.createDocumentFragment();
        for (let i = s; i <= ne; i++) {
          frag.appendChild(buildBlock(engine, this.plan, rows[i], this));
          views[i] = lastBlock as RowView;
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
            rv = lastBlock as RowView;
          } else if (keep[i] === 0) {
            rv.insertBefore(parent, next);
          }
          views[s + i] = rv;
          next = rv.first;
        }
      }
    }
    this.rowViews = views;
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

function removeContiguous(first: ChildNode, last: ChildNode): void {
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  range.deleteContents();
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
