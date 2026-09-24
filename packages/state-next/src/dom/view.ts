import { rowAt, type Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { StateList, StateRow } from "../list";
import type { FilterFn } from "./filters";
import { isHtmlSink, trustHtml } from "../trustedTypes";
import { config } from "../config";

/** Events that bubble: the only ones a delegated listener can see. */
const BUBBLING = new Set(["click", "dblclick", "input", "change", "submit", "keydown", "keyup", "mousedown", "mouseup", "pointerdown", "pointerup"]);
const handlerKeys = new Map<string, symbol>();
/** The property a delegated handler is stored under on its element. */
export function handlerKey(type: string): symbol {
  let k = handlerKeys.get(type);
  if (k === undefined) handlerKeys.set(type, (k = Symbol(`wcs.on${type}`)));
  return k;
}
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

/** Property on an element with an event binding: the row its handler runs for. */
export const ROW = Symbol("wcs.row");

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
  listener: ((this: any, e: Event) => void) | null;
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
}

export interface RowPlan {
  fragment: DocumentFragment;
  /** The single top-level node (when `single`), cloned directly instead of the fragment. */
  root: Node | null;
  /** Reused per block creation (nodes are handed to bindings before the next block). */
  scratch: Node[];
  nodePaths: number[][];
  specs: Spec[];
  /** The block renders exactly one top-level node. */
  single: boolean;
  /** Some spec builds a nested view (for / if): the scratch nodes must be copied first. */
  nested: boolean;
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
    switch (this.kind) {
      case K_TEXT:
        n.data = v == null ? "" : String(v);
        break;
      case K_PROP: {
        const name = this.name;
        if (DISPLAY_PROPS.has(name)) {
          n[name] = name === "innerHTML" ? trustHtml(v == null ? "" : String(v)) : v == null ? "" : v;
        } else if (isHtmlSink(name)) {
          n[name] = trustHtml(v == null ? "" : String(v));
        } else if (v === undefined) {
          // an element input keeps its own value when state has no opinion (B8)
          this.value = v;
          return;
        } else if (n[name] !== v && !(name === "value" && n.value === String(v))) {
          // never re-write what the element already shows (keeps the caret while typing)
          n[name] = v;
        }
        break;
      }
      case K_HTML:
        n.innerHTML = trustHtml(v == null ? "" : String(v));
        break;
      case K_CLASS:
        if (v != null && typeof v !== "boolean") {
          throw new Error(`[wcs/binding-type] class.${this.name} needs a boolean (got ${typeof v}); write "class.${this.name}: path|truthy" to toggle on truthiness`);
        }
        n.classList.toggle(this.name, v === true);
        break;
      case K_ATTR:
        if (v == null) n.removeAttribute(this.name);
        else n.setAttribute(this.name, String(v));
        break;
      case K_STYLE:
        if (v == null) n.style.removeProperty(this.name);
        else n.style.setProperty(this.name, String(v));
        break;
      case K_CUSTOM:
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
      case K_RADIO:
        n.checked = v !== undefined && this.elementValue() === v;
        break;
      case K_CHECKBOX:
        n.checked = Array.isArray(v) && v.includes(this.elementValue());
        break;
    }
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
  readonly bindings: Binding[] = [];
  children: (ForView | IfView)[] | null = null;
  /** Run when the block goes away (token unsubscriptions); allocated on first use. */
  cleanups: (() => void)[] | null = null;

  constructor(row: StateRow | null, first: ChildNode, nodes: ChildNode[] | null) {
    this.row = row;
    this.first = first;
    this.nodes = nodes;
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

  /**
   * Stops the block and unregisters its bindings. `rowGone`: the block's row itself was
   * dropped, so bindings registered on that row need no unregistering.
   */
  dispose(engine: Engine, rowGone: boolean): void {
    this.alive = false;
    if (this.cleanups !== null) for (const c of this.cleanups) c();
    const bs = this.bindings;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (!(rowGone && b.row === this.row)) engine.unregister(b);
    }
    if (this.children !== null) for (const c of this.children) c.dispose(rowGone);
  }
}

export class RowView extends Block {
  /** Position in the view's previous order (set during an update). */
  pos = 0;

  constructor(row: StateRow, first: ChildNode, nodes: ChildNode[] | null) {
    super(row, first, nodes);
  }

  override dispose(engine: Engine, rowGone: boolean): void {
    const row = this.row!;
    if (row.view === this) row.view = null;
    super.dispose(engine, rowGone);
  }
}

/** The list whose rows `p` ranges over, in the context of `row`. */
function listFor(engine: Engine, p: Pattern, row: StateRow | null): StateList {
  return p.depth === 0 ? engine.rootList(p) : engine.childList(rowAt(row, p.depth)!, p);
}

/**
 * Clones the plan in the context of `row`, binds it and applies the initial values
 * (off-document). Returns the block and the node(s) to insert.
 */
/** The block built by the last buildBlock call (read right after it; saves an allocation per row). */
export let lastBlock: Block | null = null;

export function buildBlock(engine: Engine, plan: RowPlan, row: StateRow | null, asRow: boolean): Node {
  const paths = plan.nodePaths;
  const nodes = plan.scratch;
  let top: Node;
  let block: Block;
  if (plan.single) {
    // clone the block's element itself; paths start at the fragment, so skip their first step
    top = plan.root!.cloneNode(true);
    for (let i = 0; i < paths.length; i++) {
      let n: Node = top;
      const path = paths[i];
      for (let j = 1; j < path.length; j++) {
        n = n.firstChild!;
        for (let k = path[j]; k > 0; k--) n = n.nextSibling!;
      }
      nodes[i] = n;
    }
    block = asRow ? new RowView(row!, top as ChildNode, null) : new Block(row, top as ChildNode, null);
  } else {
    top = plan.fragment.cloneNode(true);
    for (let i = 0; i < paths.length; i++) {
      let n: Node = top;
      const path = paths[i];
      for (let j = 0; j < path.length; j++) {
        n = n.firstChild!;
        for (let k = path[j]; k > 0; k--) n = n.nextSibling!;
      }
      nodes[i] = n;
    }
    const all = Array.from(top.childNodes) as ChildNode[];
    block = asRow ? new RowView(row!, all[0], all) : new Block(row, all[0], all);
  }
  if (asRow) row!.view = block as RowView;
  const rowDepth = row === null ? 0 : row.list.depth;
  const specs = plan.specs;
  // the scratch array is ours until a nested view builds a block of another plan: take
  // every node we need before that can happen
  const own = plan.nested ? nodes.slice(0, paths.length) : nodes;
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const node = own[s.node];
    switch (s.kind) {
      case K_EVENT:
        (node as any)[ROW] = row;
        if (config.delegateEvents && BUBBLING.has(s.name)) {
          (node as any)[handlerKey(s.name)] = s.listener;
          engine.delegate(s.name);
        } else {
          node.addEventListener(s.name, s.listener!);
        }
        break;
      case K_FOR: {
        const fv = new ForView(engine, s.plan!, listFor(engine, s.pattern!, row), node as Comment);
        (block.children ?? (block.children = [])).push(fv);
        fv.update();
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
        engine.register(b);
        block.bindings.push(b);
        engine.applyBinding(b);
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
  engine.register(b);
  owner?.bindings.push(b);
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
    engine.register(b);
    if (owner !== null) owner.bindings.push(b);
    else iv.rootBindings.push(b);
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
      this.current.dispose(engine, false);
      this.current = null;
    }
    this.index = index;
    if (index >= 0) {
      const br = this.branches[index];
      const top = buildBlock(engine, br.plan, this.row, false);
      this.current = lastBlock;
      br.anchor.parentNode!.insertBefore(top, br.anchor);
    }
  }

  dispose(rowGone: boolean): void {
    this.alive = false;
    for (const b of this.rootBindings) this.engine.unregister(b);
    if (this.current !== null) this.current.dispose(this.engine, rowGone);
  }
}

export class ForView {
  alive = true;
  rowViews: RowView[] = [];
  readonly engine: Engine;
  readonly plan: RowPlan;
  readonly list: StateList;
  readonly anchor: Comment;

  constructor(engine: Engine, plan: RowPlan, list: StateList, anchor: Comment) {
    this.engine = engine;
    this.plan = plan;
    this.list = list;
    this.anchor = anchor;
    list.view = this;
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
        for (let i = 0; i < o; i++) old[i].dispose(engine, !old[i].row!.alive);
      }
      this.rowViews = [];
      return;
    }
    if (o === 0) {
      const frag = document.createDocumentFragment();
      const views: RowView[] = new Array(n);
      for (let i = 0; i < n; i++) {
        frag.appendChild(buildBlock(engine, this.plan, rows[i], true));
        views[i] = rows[i].view!;
      }
      parent.insertBefore(frag, anchor);
      this.rowViews = views;
      return;
    }

    const views: RowView[] = new Array(n);
    let s = 0;
    while (s < n && s < o && rows[s].view === old[s]) {
      views[s] = old[s];
      s++;
    }
    let oe = o - 1;
    let ne = n - 1;
    while (oe >= s && ne >= s && rows[ne].view === old[oe]) {
      views[ne] = old[oe];
      oe--;
      ne--;
    }
    for (let i = s; i <= oe; i++) {
      const rv = old[i];
      const row = rv.row!;
      if (!row.alive || row.view !== rv) {
        rv.removeNodes();
        rv.dispose(engine, !row.alive);
      } else {
        rv.pos = i;
      }
    }
    if (s <= ne) {
      const m = ne - s + 1;
      const src = new Int32Array(m);
      let anyKept = false;
      for (let i = 0; i < m; i++) {
        const rv = rows[s + i].view;
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
          frag.appendChild(buildBlock(engine, this.plan, rows[i], true));
          views[i] = rows[i].view!;
        }
        parent.insertBefore(frag, next0);
      } else {
        const keep = lisKeep(src);
        let next: Node = next0;
        for (let i = m - 1; i >= 0; i--) {
          const row = rows[s + i];
          let rv = row.view;
          if (rv === null || !rv.alive) {
            parent.insertBefore(buildBlock(engine, this.plan, row, true), next);
            rv = row.view!;
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

  dispose(rowGone: boolean): void {
    this.alive = false;
    if (this.list.view === this) this.list.view = null;
    // rows of a nested list go away with their parent row
    for (const rv of this.rowViews) rv.dispose(this.engine, rowGone || !rv.row!.alive);
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
