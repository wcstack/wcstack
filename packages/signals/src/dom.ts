// Fine-grained hyperscript (v1 design notes). The "step before JSX" (docs §4-1).
//
// `h(tag, props, ...children)` is the classic JSX factory shape, but it does NOT
// build a virtual DOM and re-render. It creates a REAL DOM node once; any prop or
// child given as a function (thunk) or signal is wired to a targeted `effect`, so
// only that one binding updates when its signals change (Solid-style). This is
// what keeps the package lightweight: no reconciler is shipped.
//
// JSX is intentionally NOT shipped. A consumer who wants it sets, in their own
// tsconfig, `jsxFactory: "h"` + `jsxFragmentFactory: "Fragment"` (classic runtime)
// — opting into a build step is their choice; the buildless path is calling `h`
// directly. See docs/signals-state-design.md §4-1.
//
// OWNERSHIP: effects created here are owned by the enclosing reactive scope.
// A reactive child's effect owns the prop/child effects of the subtree it builds,
// so rebuilding that subtree disposes the previous one's effects (no leak). Mount
// an app under `createRoot` so the whole tree can be torn down on unmount; a
// dynamic child establishes its own scope automatically (it IS an effect).

import { signal, effect, onCleanup, createRoot, hasOwner, ReadSignal, WriteSignal } from "./reactive.js";
import { isDev, warnDev } from "./dev.js";

// `@wcstack/signals/dom` re-exports the headless core (signals, resource,
// streamResource, bindNode, nodeSource) so UI code can import everything from one
// module. Both built entries import a single shared `core-*.esm.js` chunk
// (rollup.config.js `manualChunks`), so importing from BOTH `@wcstack/signals` and
// `@wcstack/signals/dom` on a buildless page yields ONE reactive instance — the
// tracking context is shared, not duplicated. `__tests__/packaging.test.ts` pins
// this (both entries reference the same core chunk; a signal made via one entry is
// observed by an effect from the other).
export {
  signal,
  computed,
  effect,
  createRoot,
  onCleanup,
  flushSync,
} from "./reactive.js";
export type { ReadSignal, WriteSignal, EffectHandle, Cleanup, Equals } from "./reactive.js";
export { resource } from "./resource.js";
export type { ResourceState, ResourceOptions, ResourceSource } from "./resource.js";
export { streamResource } from "./streamResource.js";
export type {
  StreamResourceState,
  StreamResourceOptions,
  StreamSource,
  StreamProducer,
  StreamStatus,
} from "./streamResource.js";
export { bindNode, nodeSource, DisposedError, isDisposedError } from "./bindNode.js";
export type {
  BoundNode,
  NodeShape,
  DefaultNodeShape,
  WcBindableDescriptor,
  WcBindableProperty,
  EventStreamOptions,
} from "./bindNode.js";

export const Fragment = Symbol("signals.Fragment");

export type Child = unknown;
export type Props = Record<string, unknown> | null;
// h() always injects `children` into the props object it passes to a component, so
// the parameter type makes that explicit (a component can declare `{ children }`).
export type Component = (
  props: Record<string, unknown> & { children?: Child[] },
) => Node | Child[];

function isReadSignal(value: unknown): value is ReadSignal<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { get?: unknown }).get === "function" &&
    typeof (value as { peek?: unknown }).peek === "function"
  );
}

export function h(
  tag: string | typeof Fragment | Component,
  props?: Props,
  ...children: Child[]
): Node {
  if (tag === Fragment) {
    const frag = document.createDocumentFragment();
    appendChildren(frag, children);
    return frag;
  }

  if (typeof tag === "function") {
    const result = tag({ ...(props ?? {}), children });
    return Array.isArray(result) ? wrapFragment(result) : result;
  }

  const el = createElement(tag);
  if (props) {
    for (const key in props) {
      bindProp(el, key, props[key]);
    }
  }
  appendChildren(el, children);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Tags created in the SVG namespace. Ambiguous names shared with HTML (`a`,
// `title`, `script`, `style`) are intentionally EXCLUDED so ordinary HTML usage is
// not broken; an SVG `<a>` / `<title>` must be created in an explicitly-namespaced
// way by the caller. SVG DOM props are largely read-only, so `setProp`'s
// settable-property check routes SVG attributes through `setAttribute` for free.
const SVG_TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "defs", "use", "symbol", "marker", "linearGradient",
  "radialGradient", "stop", "clipPath", "mask", "pattern", "image", "foreignObject",
]);

function createElement(tag: string): Element {
  return SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
}

/** Append `child` into `container`, resolving fragments/arrays. */
export function render(child: Child, container: Node): Node {
  appendChild(container, child);
  return container;
}

function wrapFragment(children: Child[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  appendChildren(frag, children);
  return frag;
}

// --- props ------------------------------------------------------------------

// Attribute names whose corresponding JS DOM property differs. `class` is handled
// separately (it has reactive-falsy semantics in setProp), so it is not listed here.
const ATTR_TO_PROP: Record<string, string> = {
  for: "htmlFor",
  tabindex: "tabIndex",
  colspan: "colSpan",
  rowspan: "rowSpan",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  contenteditable: "contentEditable",
};

// True only if `key` resolves to a WRITABLE property on the element or its
// prototype chain (a data property with `writable !== false`, or an accessor with a
// setter). `key in el` is not enough: it also matches read-only members like
// `firstChild` / `childNodes`, whose assignment throws in strict mode. The walk
// starts at `el` itself so own instance fields (e.g. a custom element's properties)
// are still matched, exactly as the previous `key in el` did — just without the
// read-only false positives.
//
// MEMOIZATION: the prototype-chain walk runs on every bindProp/setProp. The result
// depends only on the element's PROTOTYPE (its class) and the key, since DOM props
// live on the prototype — not on per-instance own fields, which this library never
// adds dynamically per element. So cache by `(prototype, key)`: a WeakMap keyed by
// prototype (no leak — entries die with the class) holding a Map of key→result.
const settableCache = new WeakMap<object, Map<string, boolean>>();

function computeSettable(el: Element, key: string): boolean {
  let obj: object | null = el;
  while (obj !== null) {
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (desc) {
      return "set" in desc ? typeof desc.set === "function" : desc.writable !== false;
    }
    obj = Object.getPrototypeOf(obj);
  }
  return false;
}

function isSettableProperty(el: Element, key: string): boolean {
  // A real Element always has a prototype (HTMLElement.prototype → … → Object), so
  // `getPrototypeOf` is non-null here; use it as the cache key.
  const proto = Object.getPrototypeOf(el) as object;
  let byKey = settableCache.get(proto);
  if (byKey === undefined) {
    byKey = new Map<string, boolean>();
    settableCache.set(proto, byKey);
  }
  let result = byKey.get(key);
  if (result === undefined) {
    result = computeSettable(el, key);
    byKey.set(key, result);
  }
  return result;
}

function bindProp(el: Element, key: string, value: unknown): void {
  // Event handlers (`onClick` → "click") are special-cased BEFORE the reactive
  // check: a function here is the listener, not a thunk to track.
  if (/^on[A-Z]/.test(key) && typeof value === "function") {
    const type = key.slice(2).toLowerCase();
    const listener = value as EventListener;
    el.addEventListener(type, listener);
    // Remove the listener when the owning scope is torn down (e.g. a dynamic
    // child that rebuilds this subtree), so handlers don't accumulate.
    onCleanup(() => el.removeEventListener(type, listener));
    return;
  }

  if (typeof value === "function") {
    effect(() => setProp(el, key, (value as () => unknown)()));
    return;
  }

  if (isReadSignal(value)) {
    effect(() => setProp(el, key, value.get()));
    return;
  }

  setProp(el, key, value);
}

function setProp(el: Element, key: string, value: unknown): void {
  if (key === "style") {
    setStyle(el as HTMLElement, value);
    return;
  }
  if (key === "class" || key === "className") {
    // Set the `class` ATTRIBUTE, not the `className` property. On an SVGElement
    // `className` is a read-only `SVGAnimatedString`, so assigning it throws in
    // strict mode (ESM is always strict) — `setAttribute("class", …)` works for both
    // HTML and SVG. Treat false like null → empty class (consistent with the
    // attribute path's false-removes-it rule), so `() => cond && "active"` yields ""
    // (not "false") when the condition is falsy.
    // STRING-ONLY: a non-null/non-false value is coerced via String(value). Array
    // (`["a", "b"]`) and object (`{ active: true }`) class forms are NOT supported —
    // they would stringify to "a,b" / "[object Object]". Compose the class string in
    // the binding itself (e.g. `() => [a, b].join(" ")`) and pass a string. This keeps
    // the core free of a class-merging convention.
    el.setAttribute("class", value == null || value === false ? "" : String(value));
    return;
  }
  // Remap the handful of attribute names whose JS property differs, so `for` /
  // `tabindex` / `colspan` etc. reach the right property instead of falling through
  // to setAttribute (which works for some but not e.g. `htmlFor`).
  const propKey = ATTR_TO_PROP[key] ?? key;
  if (isSettableProperty(el, propKey)) {
    // Known, WRITABLE DOM property (value, checked, disabled, id, htmlFor, ...).
    // The settability check excludes read-only members (firstChild, childNodes, …)
    // that `key in el` would wrongly accept — assigning to those throws in strict
    // mode; we fall through to the attribute path for them instead.
    //
    // NORMALIZATION: null/undefined are coerced to "" before assignment. Without
    // this, a STRING prop (id/title/value/src) given a reactive null/undefined
    // lands as the literal "null"/"undefined" (e.g. img.src="null" fires a real
    // request) — a correctness footgun. "" clears the prop instead. Safe for
    // non-string props too: boolean props coerce ""→false (same as null), numeric
    // props coerce ""→0 (same as null). We do NOT normalize `false`:
    // `el.disabled = false` is the intended boolean clear.
    (el as unknown as Record<string, unknown>)[propKey] = value == null ? "" : value;
    return;
  }
  if (value == null || value === false) {
    el.removeAttribute(key);
    return;
  }
  if (value === true) {
    el.setAttribute(key, "");
    return;
  }
  el.setAttribute(key, String(value));
}

function setStyle(el: HTMLElement, value: unknown): void {
  if (value == null) {
    el.removeAttribute("style");
    return;
  }
  if (typeof value === "string") {
    el.style.cssText = value;
    return;
  }
  // Object form: the object fully describes the style. Reset first so keys present
  // in a previous run but absent now are removed — otherwise a reactive style that
  // drops a key (e.g. {color,fontWeight} → {color}) would leave the stale property
  // applied. The object is the source of truth, so wiping cssText is correct here.
  el.style.cssText = "";
  const style = el.style as CSSStyleDeclaration & Record<string, string>;
  const obj = value as Record<string, string>;
  for (const k in obj) {
    // A key with a hyphen is either kebab-case (`font-weight`) or a CSS custom
    // property (`--accent`). Neither works via property assignment (`style[k]` would
    // just set an inert expando), so route them through setProperty. camelCase keys
    // (`fontWeight`) keep the faster property path.
    if (k.includes("-")) {
      style.setProperty(k, obj[k]);
    } else {
      style[k] = obj[k];
    }
  }
}

// --- children ---------------------------------------------------------------

function appendChildren(parent: Node, children: Child[]): void {
  for (const child of children) {
    appendChild(parent, child);
  }
}

function appendChild(parent: Node, child: Child): void {
  if (child == null || typeof child === "boolean") {
    return; // null / undefined / boolean render nothing
  }
  if (Array.isArray(child)) {
    for (const c of child) {
      appendChild(parent, c);
    }
    return;
  }
  if (isListView(child)) {
    // A keyed list (For / Index): it manages its own anchored region with in-place
    // reconciliation, so it does NOT go through the wholesale insertReactive path.
    child.mount(parent);
    return;
  }
  if (child instanceof Node) {
    parent.appendChild(child);
    return;
  }
  if (typeof child === "function") {
    insertReactive(parent, child as () => unknown);
    return;
  }
  if (isReadSignal(child)) {
    insertReactive(parent, () => child.get());
    return;
  }
  parent.appendChild(document.createTextNode(String(child)));
}

/**
 * A reactive insertion point. An anchor comment marks the position; on each run
 * the previous nodes are removed and the freshly-resolved nodes inserted before
 * the anchor. Using `anchor.parentNode` (not the original `parent`) keeps it
 * correct after the subtree is moved/mounted elsewhere.
 *
 * PRECONDITION: the Nodes returned by `accessor` are owned by this insertion point
 * — do not move them to another parent externally. On the next run they are
 * removed from wherever they currently are (`node.parentNode?.removeChild`), so an
 * externally-moved node would be yanked out of its new home without warning.
 *
 * OWNERSHIP: the `effect` below is owned by the enclosing reactive scope at call
 * time (the `currentOwner`). Used under `createRoot` / `SignalsElement` (the module
 * header's mount contract) it is disposed on teardown. Calling `h`/`render` with a
 * reactive child OUTSIDE any owner (no `createRoot`/`SignalsElement`) leaves this
 * effect un-owned and therefore never cleaned up — by design, per that contract.
 */
function insertReactive(parent: Node, accessor: () => unknown): void {
  if (isDev() && !hasOwner()) {
    // A reactive child inserted with no enclosing owner: the effect below is never
    // disposed (the module header documents this as by-design, but it is a frequent
    // accidental leak). Warn once in dev so the un-owned mount is visible.
    warnDev(
      "UNOWNED_INSERT",
      "",
      "reactive child inserted with no owner — its update effect will never be " +
        "disposed and may leak. Mount under createRoot / SignalsElement.",
    );
  }
  const anchor = document.createComment("");
  parent.appendChild(anchor);
  let current: Node[] = [];

  effect(() => {
    const value = accessor();
    // FAST PATH: a plain text result that replaces a plain text result. The common
    // reactive child is a string/number thunk (`() => \`count: ${n.get()}\``); the
    // wholesale path would remove the old Text node, allocate a new one, and re-insert
    // it on every change. When BOTH the previous and next renders are a single Text
    // node, mutate the existing node's `data` in place instead — no allocation, no
    // remove/insert, and the same DOM node identity is preserved across updates.
    if ((typeof value === "string" || typeof value === "number") && current.length === 1) {
      const node = current[0];
      if (node.nodeType === 3 /* TEXT_NODE */) {
        (node as Text).data = String(value);
        return;
      }
    }
    const next = toNodes(value);
    for (const node of current) {
      node.parentNode?.removeChild(node);
    }
    const host = anchor.parentNode;
    if (host) {
      for (const node of next) {
        host.insertBefore(node, anchor);
      }
    }
    current = next;
  });
}

// --- keyed lists: For / Index (migration-plan §9-3) --------------------------
//
// `insertReactive` rebuilds its whole subtree on every change. For lists that is
// wasteful (and drops per-row state). `For` / `Index` instead keep a stable DOM row
// per item and reconcile in place. Each row is built under its OWN `createRoot`, so
// removing a row disposes exactly that row's effects/resources/listeners — the owner
// tree (§8 (d)) is what makes this leak-free. The reconcile runs in a single
// `effect` owned by the enclosing scope; an `onCleanup` disposes surviving rows when
// that scope (e.g. the component) tears down.
//
// CONTRACT: `each` must return a SINGLE Node (one row = one node). Keys (For) must
// be unique. `For` keys by value identity (=== / explicit `key`) and passes the
// index as an accessor (it changes on move); `Index` keys by position and passes the
// item as an accessor (the value at a slot changes, the slot does not).

export type ListAccessor<T> = ReadSignal<readonly T[]> | (() => readonly T[]);
export type ForEach<T> = (item: T, index: () => number) => Node;
export type IndexEach<T> = (item: () => T, index: number) => Node;

/**
 * The return type of {@link For} / {@link Index}: a keyed list that owns an anchored
 * region and reconciles rows in place. Exported (D4) so consumers can annotate
 * helpers that build or pass around lists. `mount` is called by `h`/`render` when the
 * list is used as a child; `__wcsList` is the brand `appendChild` checks.
 */
export interface ListView {
  readonly __wcsList: true;
  mount(parent: Node): void;
}

function isListView(value: unknown): value is ListView {
  return typeof value === "object" && value !== null && (value as ListView).__wcsList === true;
}

function readList<T>(list: ListAccessor<T>): () => readonly T[] {
  return isReadSignal(list) ? () => (list as ReadSignal<readonly T[]>).get() : (list as () => readonly T[]);
}

export interface ForOptions<T> {
  /** Derive a unique key per item. Default: the item value itself (identity). */
  key?: (item: T, index: number) => unknown;
}

// --- LIS-based DOM reorder ---------------------------------------------------
//
// `reconcileOrder` brings the live DOM under `host` (the contiguous region ending
// at `anchor`) into `order` — the desired final node sequence — using the FEWEST
// `insertBefore` moves, while producing EXACTLY the order a naive full re-place
// would. The naive approach (walk and insert every out-of-place node) does up to
// O(n) DOM moves on a full reverse or a head insert; here we instead keep the
// largest set of reused rows that are ALREADY in the right relative order, and
// move only the others (Solid's reconcileArrays / udomdiff idea).
//
// HOW: `prevOrder` is the node sequence the previous run left in the DOM. For each
// node in the new `order`, a reused row maps to its index in `prevOrder`; a freshly
// created row has no previous position. The longest increasing subsequence (LIS)
// of those previous indices marks the reused rows that need NOT move (their pairwise
// relative order is already correct). Every other node — fresh ones, and reused
// ones outside the LIS — is inserted before its already-correct successor, walking
// back-to-front so the "successor" reference is always a settled node or the anchor.

/**
 * Indices into `arr` (with value -1 meaning "no previous position") whose values
 * form a longest strictly-increasing subsequence. Entries equal to -1 are treated
 * as never part of the subsequence (a fresh node always moves). Classic
 * patience-sorting LIS in O(n log n); returns the chosen indices in ascending order.
 */
function longestIncreasingSubsequence(arr: number[]): number[] {
  const n = arr.length;
  // `tails[k]` = index (into arr) of the smallest tail of an increasing
  // subsequence of length k+1. `prev[i]` = predecessor index, to rebuild the chain.
  const tails: number[] = [];
  const prev: number[] = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const value = arr[i];
    if (value < 0) {
      continue; // fresh node: not eligible for the stable subsequence
    }
    // Binary search for the first tail whose value is >= this value, and replace it
    // (or extend the tails when this value beats every tail).
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[tails[mid]] < value) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo > 0) {
      prev[i] = tails[lo - 1];
    }
    tails[lo] = i;
  }
  // Rebuild the index chain from the longest tail backwards.
  const result: number[] = [];
  let k = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (k >= 0) {
    result.push(k);
    k = prev[k];
  }
  result.reverse();
  return result;
}

function reconcileOrder(
  host: Node,
  anchor: Node,
  order: Node[],
  prevOrder: Node[],
): void {
  const n = order.length;
  if (n === 0) {
    return; // nothing to place (removals already happened)
  }

  // Map each previous node to its previous position, so a node in `order` can look
  // up where it used to be. A node absent from this map is FRESH (created this run,
  // or the first run where prevOrder is empty) and is encoded as -1 — it always moves.
  const prevIndex = new Map<Node, number>();
  for (let i = 0; i < prevOrder.length; i++) {
    prevIndex.set(prevOrder[i], i);
  }

  // previous-position sequence aligned to the new order. -1 marks a fresh node.
  const seq: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = prevIndex.get(order[i]);
    seq[i] = p === undefined ? -1 : p;
  }

  // Rows whose relative order is already correct: leave them in place, move the rest.
  const lis = longestIncreasingSubsequence(seq);
  let lisPtr = lis.length - 1;

  // Walk back-to-front. `ref` is the node that must follow the one being placed; it
  // starts at the anchor (the region's tail) and becomes each placed node. A node in
  // the LIS is the maximal already-correctly-ordered set, so it is left untouched
  // (only adopted as the new `ref`). Every OTHER node is, by construction, out of
  // position relative to its settled successor and is inserted before `ref` — no
  // "is it already in place?" guard is needed (it never is, unlike the old
  // full-walk reconciler which visited correctly-placed nodes too).
  let ref: Node = anchor;
  for (let i = n - 1; i >= 0; i--) {
    const node = order[i];
    if (lisPtr >= 0 && lis[lisPtr] === i) {
      lisPtr--; // stable: do not move
    } else {
      host.insertBefore(node, ref);
    }
    ref = node;
  }
}

// Dev-only key sanity check (no effect in production — guarded by `isDev()` at the
// call site so this is never reached when dev is off). Flags the silent-failure key
// shapes: a nullish key (NaN / null / undefined collide under SameValueZero, so two
// such items map to one row and a row is silently dropped), and — when no explicit
// `key` was given — a non-primitive item used as its own identity key (every render
// gets a fresh object reference, so the row is rebuilt instead of reused, silently
// dropping per-row state). Warns once per distinct shape (deduped in warnDev).
function checkKeyDev(key: unknown, item: unknown, hasExplicitKey: boolean): void {
  if (key == null || (typeof key === "number" && Number.isNaN(key))) {
    warnDev(
      "NULLISH_KEY",
      String(key),
      "For: a key is null/undefined/NaN. Such keys collide under SameValueZero, " +
        "so rows silently merge/drop. Provide a stable unique `key`.",
      { key },
    );
    return;
  }
  if (!hasExplicitKey && (typeof key === "object" || typeof key === "function")) {
    warnDev(
      "NON_PRIMITIVE_KEY",
      typeof key,
      "For: a non-primitive item is used as its own key (no `key` option given). " +
        "Object identity changes across renders, so every row is rebuilt and per-row " +
        "state is lost. Pass `{ key: item => item.id }`.",
      { item },
    );
  }
}

export function For<T>(list: ListAccessor<T>, each: ForEach<T>, options?: ForOptions<T>): ListView {
  const read = readList(list);
  const keyOf = options?.key;
  return {
    __wcsList: true,
    mount(parent: Node): void {
      const anchor = document.createComment("for");
      parent.appendChild(anchor);

      interface Row {
        node: Node;
        dispose: () => void;
        idx: WriteSignal<number>;
      }
      let rows = new Map<unknown, Row>();
      // The node order placed by the previous reconcile run. Empty on first run.
      // Used to find which reused rows already sit in increasing relative order so
      // only the rest are moved (LIS reorder, see reconcileOrder).
      let prevOrder: Node[] = [];

      const make = (item: T, i: number): Row => {
        const idx = signal(i);
        let node!: Node;
        const dispose = createRoot((d) => {
          node = each(item, () => idx.get());
          return d;
        });
        return { node, dispose, idx };
      };

      effect(() => {
        const items = read() ?? [];

        // Key-uniqueness PRE-PASS (no side effects): throwing here, before any row is
        // created or moved, keeps a duplicate-key error from leaving half-built rows
        // orphaned (make() runs createRoot) and the DOM mid-reorder. Keys are reused
        // below so keyOf runs once per item.
        const keys: unknown[] = [];
        const seen = new Set<unknown>();
        const dev = isDev();
        for (let i = 0; i < items.length; i++) {
          const k = keyOf ? keyOf(items[i], i) : items[i];
          if (dev) {
            checkKeyDev(k, items[i], keyOf !== undefined);
          }
          if (seen.has(k)) {
            if (dev) {
              // The throw below still halts (production behaviour unchanged); the warn
              // adds the offending key + a pointer to the cause so the silent
              // "updates stopped" symptom is diagnosable.
              warnDev(
                "DUPLICATE_KEY",
                String(k),
                `For: duplicate key "${String(k)}" at index ${i} — keys must be unique. ` +
                  "Rendering throws and the list stops updating until keys are fixed.",
                { key: k, index: i },
              );
            }
            throw new Error(`For: duplicate key "${String(k)}" — keys must be unique.`);
          }
          seen.add(k);
          keys.push(k);
        }

        const next = new Map<unknown, Row>();
        const order: Node[] = [];

        // Rows freshly created in THIS run (not reused from `rows`). If a later
        // `make()` — i.e. a user `each` — throws mid-loop, the rows already built
        // here are owned by their own detached `createRoot` and are not yet tracked
        // in any surviving map, so they would leak. Dispose them before re-throwing,
        // leaving the old `rows` map untouched (it is recoverable on the next run).
        const fresh: Row[] = [];
        try {
          for (let i = 0; i < items.length; i++) {
            const k = keys[i];
            let row = rows.get(k);
            if (row) {
              if (row.idx.peek() !== i) {
                row.idx.set(i); // position changed — refresh the index accessor
              }
            } else {
              row = make(items[i], i);
              fresh.push(row);
            }
            next.set(k, row);
            order.push(row.node);
          }
        } catch (err) {
          for (const row of fresh) {
            row.dispose();
          }
          throw err;
        }

        // Dispose rows whose key vanished. `remove()` no-ops if already detached.
        for (const [k, row] of rows) {
          if (!next.has(k)) {
            (row.node as ChildNode).remove();
            row.dispose();
          }
        }

        // Reorder relative to the LIVE parent (`anchor.parentNode`, not the mount
        // arg) so the region stays correct after being moved (e.g. built inside a
        // Fragment, then appended elsewhere). `host` is null only if the anchor was
        // detached without disposing this scope (a misuse) — then there is nothing
        // to place into.
        const host = anchor.parentNode;
        if (host) {
          reconcileOrder(host, anchor, order, prevOrder);
        }

        // Snapshot this run's final order so the NEXT run's reconcile can detect
        // which rows kept their relative position (the LIS basis below). Capturing
        // the array we just placed avoids re-deriving it from the map.
        prevOrder = order;
        rows = next;
      });

      onCleanup(() => {
        for (const row of rows.values()) {
          row.dispose();
        }
        rows.clear();
      });
    },
  };
}

export function Index<T>(list: ListAccessor<T>, each: IndexEach<T>): ListView {
  const read = readList(list);
  return {
    __wcsList: true,
    mount(parent: Node): void {
      const anchor = document.createComment("index");
      parent.appendChild(anchor);

      interface Row {
        node: Node;
        dispose: () => void;
        item: WriteSignal<T>;
      }
      const rows: Row[] = [];

      effect(() => {
        const items = read() ?? [];
        // Live parent (see `For`), null only if the anchor was detached undisposed.
        const host = anchor.parentNode;

        for (let i = 0; i < items.length; i++) {
          if (i < rows.length) {
            // Slot reused: just push the new value into the row's item signal. The
            // signal's equality guard skips the update when the value is unchanged.
            rows[i].item.set(items[i]);
          } else {
            const item = signal(items[i]);
            let node!: Node;
            const dispose = createRoot((d) => {
              node = each(() => item.get(), i);
              return d;
            });
            rows.push({ node, dispose, item });
            // Positions never move for index keying, so append at the tail (before
            // the anchor) in order. ORDERING CONTRACT (shared with For and the other
            // anchored insertions): the list owns the contiguous region ENDING at its
            // anchor comment. New rows go immediately before the anchor, so the list's
            // own rows always stay correctly ordered and grouped, and static siblings
            // before the anchor (or another list with its own anchor) are never
            // disturbed. Do NOT splice unrelated nodes into the middle of this region.
            host?.insertBefore(node, anchor);
          }
        }

        // Trailing slots that no longer exist: dispose and drop.
        if (items.length < rows.length) {
          for (let i = items.length; i < rows.length; i++) {
            (rows[i].node as ChildNode).remove();
            rows[i].dispose();
          }
          rows.length = items.length;
        }
      });

      onCleanup(() => {
        for (const row of rows) {
          row.dispose();
        }
        rows.length = 0;
      });
    },
  };
}

// --- custom element lifecycle (docs §8 (e)) ---------------------------------
//
// The exit point for ownership: a custom element that mounts a signals view under
// `createRoot` on connect and disposes that root on disconnect. This wires the
// reactive ownership tree to the real DOM lifecycle — every effect, resource and
// listener created in `render()` is torn down when the element leaves the DOM, and
// rebuilt fresh on reconnect. Subclasses only implement `render()`.
//
// SCOPE (v1 intentional constraints — drive these reactively, not via this base):
//   - No attribute reactivity. There is no `attributeChangedCallback`/
//     `observedAttributes` wiring: this base does NOT turn HTML attributes into
//     signals. Feed reactive inputs as signals/props from the code that constructs
//     the view (or have a subclass map attributes to signals itself).
//   - Shadow DOM is opt-in and subclass-owned. The default mount point is light DOM
//     (`this`); a subclass that wants encapsulation overrides `getMountPoint()` to
//     return a shadow root it created (e.g. `this.attachShadow(...)` in its
//     constructor). This base never calls attachShadow implicitly.
//   - Mount/unmount only: render() runs once per connect and the whole subtree is
//     disposed on disconnect — there is no partial/incremental re-render hook here
//     (fine-grained updates come from the signals wired inside render()).

// TYPE-ONLY shape of the lifecycle base. `declare abstract class` emits NO runtime
// code (so it does not reference `HTMLElement` at module-evaluation time — the whole
// point of the lazy factory below), but it gives the exported `SignalsElement` value
// and `createSignalsElement()`'s return a precise type that preserves the original
// contract: `render` is `protected abstract` (a subclass MUST implement it and may
// only reach it from within), and `getMountPoint` is `protected` (overridable). This
// is the same surface the previous concrete `abstract class SignalsElement` exposed.
// (Used only via `typeof` below; the lint rule does not see that as a value use.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare abstract class SignalsElementType extends HTMLElement {
  /** Build the view with `h` + signals. Runs inside an ownership root. */
  protected abstract render(): Node;
  /** Mount target. Override to return a shadow root; default is light DOM. */
  protected getMountPoint(): Node;
  connectedCallback(): void;
  disconnectedCallback(): void;
}

/**
 * The lifecycle base contract: the abstract constructor type of the `SignalsElement`
 * base. Abstract, so `new SignalsElement()` is rejected (the base has an unimplemented
 * `render`) while `class X extends SignalsElement` is allowed. Returned by
 * {@link createSignalsElement} and the type of the {@link SignalsElement} value.
 */
export type SignalsElementClass = typeof SignalsElementType;

// Memoized base class. Built lazily on first access so the `./dom` module can be
// EVALUATED in a non-DOM environment (SSR pre-pass, a worker without a DOM shim)
// without a top-level `class … extends HTMLElement` blowing up with
// `ReferenceError: HTMLElement is not defined`. The class body is only constructed
// when the consumer actually reaches for the base — at which point a DOM is required
// and its absence yields a clear, actionable error instead of a raw ReferenceError.
let cachedBase: SignalsElementClass | null = null;

/**
 * Build (once, memoized) the `SignalsElement` lifecycle base class. Resolves
 * `HTMLElement` at CALL TIME, so importing `@wcstack/signals/dom` no longer requires
 * a DOM at module-evaluation time — only *calling* this (or subclassing
 * {@link SignalsElement}) does.
 *
 * Contract:
 *   - The `.` entry (`@wcstack/signals`) is non-DOM: it evaluates and runs in SSR,
 *     Node, and Web Workers with no DOM globals.
 *   - The `./dom` entry (`@wcstack/signals/dom`) may now also be *evaluated* without a
 *     DOM (so an SSR pre-pass that imports it for the headless re-exports does not
 *     crash). The DOM-touching surface — `h`/`render`/`For`/`Index` and this base —
 *     still requires DOM globals when actually used.
 *
 * @throws a clear `Error` (not a raw `ReferenceError`) when no `HTMLElement` global is
 *   present, naming the offending entry so the failure is self-explanatory.
 */
export function createSignalsElement(): SignalsElementClass {
  if (cachedBase !== null) {
    return cachedBase;
  }
  if (typeof HTMLElement === "undefined") {
    throw new Error(
      "@wcstack/signals/dom: SignalsElement requires a DOM (HTMLElement is not defined). " +
        "The `./dom` entry's element/render surface is browser-only; in SSR/Node/worker " +
        "code import the headless core from `@wcstack/signals` instead, or inject a DOM " +
        "(e.g. happy-dom) before constructing custom elements.",
    );
  }

  abstract class SignalsElementBase extends HTMLElement {
    private _dispose: (() => void) | null = null;

    /** Build the view with `h` + signals. Runs inside an ownership root. */
    protected abstract render(): Node;

    /** Mount target. Override to return a shadow root; default is light DOM. */
    protected getMountPoint(): Node {
      return this;
    }

    connectedCallback(): void {
      if (this._dispose !== null) {
        return; // already mounted (defensive against a redundant connect)
      }
      const mount = this.getMountPoint();
      // If render() throws, createRoot disposes any effects it built before the throw,
      // so nothing leaks; _dispose stays null (the element is simply not mounted) and
      // a later disconnectedCallback safely no-ops. The error propagates to the caller.
      this._dispose = createRoot((dispose) => {
        mount.appendChild(this.render());
        return dispose;
      });
    }

    disconnectedCallback(): void {
      if (this._dispose === null) {
        return; // not mounted
      }
      this._dispose();
      this._dispose = null;
      const mount = this.getMountPoint();
      while (mount.firstChild) {
        mount.removeChild(mount.firstChild);
      }
    }
  }

  cachedBase = SignalsElementBase as unknown as SignalsElementClass;
  return cachedBase;
}

// `SignalsElement` is the ergonomic name to `extends`. It is a lazily-resolved alias
// for the class built by `createSignalsElement()`: a Proxy that forwards construct /
// get / has / getPrototypeOf to the real (memoized) base, building it on first touch.
// This keeps `class X extends SignalsElement { … }` working exactly as before WHILE
// deferring the `HTMLElement` reference to subclass-definition time (in a real DOM),
// instead of `./dom` module-evaluation time (which may be a non-DOM SSR pre-pass).
//
// BREAKING note: the value is now a Proxy, not the class object literal. Subclassing,
// `instanceof`, and static/prototype access all still work; a consumer that relied on
// `SignalsElement` being a *frozen* concrete class reference (uncommon) should call
// `createSignalsElement()` to obtain the real class.
// The Proxy target is a never-called placeholder (every operation is intercepted by a
// trap below); it only needs to be constructable/callable so `new` / `extends` and the
// `apply` trap engage. It is intentionally a no-op and never executed.
/* v8 ignore next */
const signalsElementTarget = function (): void {};
export const SignalsElement: SignalsElementClass = new Proxy(signalsElementTarget as unknown as SignalsElementClass, {
  construct(_target, args, newTarget): object {
    return Reflect.construct(createSignalsElement(), args, newTarget);
  },
  get(_target, prop, receiver): unknown {
    return Reflect.get(createSignalsElement(), prop, receiver);
  },
  has(_target, prop): boolean {
    return Reflect.has(createSignalsElement(), prop);
  },
  apply(): never {
    throw new TypeError("SignalsElement is a class and cannot be invoked without `new`/`extends`.");
  },
  getPrototypeOf(): object | null {
    return Reflect.getPrototypeOf(createSignalsElement());
  },
});

function toNodes(value: unknown): Node[] {
  const out: Node[] = [];
  const visit = (v: unknown): void => {
    if (v == null || typeof v === "boolean") {
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (v instanceof Node) {
      out.push(v);
      return;
    }
    out.push(document.createTextNode(String(v)));
  };
  visit(value);
  return out;
}
