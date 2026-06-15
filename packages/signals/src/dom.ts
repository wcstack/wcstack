// Fine-grained hyperscript (PoC). The "step before JSX" (docs §4-1).
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

import { signal, effect, onCleanup, createRoot, ReadSignal, WriteSignal } from "./reactive.js";

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
export { bindNode, nodeSource } from "./bindNode.js";
export type { BoundNode, WcBindableDescriptor, WcBindableProperty, EventStreamOptions } from "./bindNode.js";

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
function isSettableProperty(el: Element, key: string): boolean {
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
 */
function insertReactive(parent: Node, accessor: () => unknown): void {
  const anchor = document.createComment("");
  parent.appendChild(anchor);
  let current: Node[] = [];

  effect(() => {
    const next = toNodes(accessor());
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

interface ListView {
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
        for (let i = 0; i < items.length; i++) {
          const k = keyOf ? keyOf(items[i], i) : items[i];
          if (seen.has(k)) {
            throw new Error(`For: duplicate key "${String(k)}" — keys must be unique.`);
          }
          seen.add(k);
          keys.push(k);
        }

        const next = new Map<unknown, Row>();
        const order: Node[] = [];

        for (let i = 0; i < items.length; i++) {
          const k = keys[i];
          let row = rows.get(k);
          if (row) {
            if (row.idx.peek() !== i) {
              row.idx.set(i); // position changed — refresh the index accessor
            }
          } else {
            row = make(items[i], i);
          }
          next.set(k, row);
          order.push(row.node);
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
        // Fragment, then appended elsewhere). Walk back-to-front, moving only nodes
        // that are out of place; a node already followed by the right sibling is
        // left untouched. `host` is null only if the anchor was detached without
        // disposing this scope (a misuse) — then there is nothing to place into.
        const host = anchor.parentNode;
        if (host) {
          let ref: Node = anchor;
          for (let i = order.length - 1; i >= 0; i--) {
            const node = order[i];
            if (node.nextSibling !== ref) {
              host.insertBefore(node, ref);
            }
            ref = node;
          }
        }

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
            // the anchor) in order.
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

// --- custom element lifecycle (PoC §8 (e)) ----------------------------------
//
// The exit point for ownership: a custom element that mounts a signals view under
// `createRoot` on connect and disposes that root on disconnect. This wires the
// reactive ownership tree to the real DOM lifecycle — every effect, resource and
// listener created in `render()` is torn down when the element leaves the DOM, and
// rebuilt fresh on reconnect. Subclasses only implement `render()`.

export abstract class SignalsElement extends HTMLElement {
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
