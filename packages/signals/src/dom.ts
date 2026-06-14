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

import { effect, onCleanup, createRoot, ReadSignal } from "./reactive.js";

// Convenience browser entry: `@wcstack/signals/dom` re-exports the headless core
// so a BUILDLESS consumer can import everything UI-related from a SINGLE module —
// one reactive instance. Mixing the `@wcstack/signals` and `@wcstack/signals/dom`
// bundles in a buildless page (import map) would load two reactive cores (module
// globals like the tracking context are per-bundle), silently breaking
// reactivity across the boundary. Buildless: import from one entry. Bundler users
// dedupe via the package's module graph and may use either entry.
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
export { bindNode } from "./bindNode.js";
export type { BoundNode, WcBindableDescriptor, WcBindableProperty } from "./bindNode.js";

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

  const el = document.createElement(tag);
  if (props) {
    for (const key in props) {
      bindProp(el, key, props[key]);
    }
  }
  appendChildren(el, children);
  return el;
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
    // Treat false like null → empty class (consistent with the attribute path's
    // false-removes-it rule). This makes the idiomatic `() => cond && "active"`
    // binding yield "" (not "false") when the condition is falsy.
    (el as HTMLElement).className = value == null || value === false ? "" : String(value);
    return;
  }
  if (key in el) {
    // Known DOM property (value, checked, disabled, id, ...). PoC limitations:
    //  - Assigns by JS property name, so HTML attributes whose property name
    //    differs are NOT remapped (`for`→htmlFor, `colspan`→colSpan). Pass the JS
    //    name or set the attribute explicitly.
    //  - `key in el` is also true for READ-ONLY props (firstChild, childNodes, …);
    //    assigning to those silently fails or throws. Don't bind reserved DOM names.
    //  - ASYMMETRY with the attribute path below: there, null/false REMOVE the
    //    attribute; here the value is assigned as-is. That is correct for boolean
    //    props (el.disabled = false), but a STRING prop (id/title/value) given a
    //    reactive null/false becomes "null"/"false". We do NOT normalize here
    //    because the right coercion depends on the prop's type (boolean vs string),
    //    which needs a property table — out of scope for the PoC. Pass "" (or guard
    //    in the thunk) when clearing a string prop.
    // A full attribute↔property table is out of scope for the PoC.
    (el as unknown as Record<string, unknown>)[key] = value;
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
  const style = el.style as unknown as Record<string, string>;
  for (const k in value as Record<string, string>) {
    style[k] = (value as Record<string, string>)[k];
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
