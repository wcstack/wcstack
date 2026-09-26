/**
 * Wiring to custom elements that declare the wc-bindable protocol:
 *   static wcBindable = { protocol: "wc-bindable", version: 1,
 *     properties: [{ name, event, getter?, semantics? }],   // element → state
 *     inputs:     [{ name, attribute? }],                    // state → element
 *     commands:   [{ name, async? }] }                       // state invokes
 * Property bindings take their direction and initial authority from the declaration;
 * `command.<m>:` subscribes a method to a command token; `eventToken.<p>:` fires an event
 * token when the element dispatches that property's event; `...:` spreads a state object
 * over every declared property and input.
 */
import type { Engine } from "../engine";
import { raise, M } from "../messages";
import type { StateRow } from "../list";
import { adopt, Binding, K_CUSTOM, type Block, type Spec } from "./view";
// (view.ts imports this module too: the cycle is fine, everything here is used at call time)

interface PropertyDecl {
  event: string;
  getter: ((e: Event) => unknown) | null;
  /** `semantics: "event"`: an occurrence, written even when equal to the current value. */
  occurrence: boolean;
}

export interface Bindable {
  properties: Map<string, PropertyDecl>;
  inputs: Map<string, { attribute: string | null }>;
  commands: Set<string>;
}

const bindableByClass = new WeakMap<Function, Bindable | null>();

/** The element's wc-bindable declaration (null when it has none), cached per class. */
export function readBindable(cls: Function): Bindable | null {
  if (bindableByClass.has(cls)) return bindableByClass.get(cls)!;
  const decl = (cls as any).wcBindable;
  let out: Bindable | null = null;
  if (decl !== null && typeof decl === "object" && decl.protocol === "wc-bindable" && Number.isInteger(decl.version) && decl.version >= 1) {
    out = { properties: new Map(), inputs: new Map(), commands: new Set() };
    for (const p of decl.properties ?? []) {
      out.properties.set(p.name, { event: p.event, getter: typeof p.getter === "function" ? p.getter : null, occurrence: p.semantics === "event" });
    }
    for (const i of decl.inputs ?? []) out.inputs.set(i.name, { attribute: typeof i.attribute === "string" ? i.attribute : null });
    for (const c of decl.commands ?? []) if (c !== null && typeof c === "object" && typeof c.name === "string") out.commands.add(c.name);
  }
  bindableByClass.set(cls, out);
  return out;
}

export const isCustomTag = (el: Element): boolean => el.localName.includes("-");

/**
 * Runs `attach` once the element's class is defined (at once when it already is) and
 * upgraded, unless its block went away in the meantime.
 */
export function whenDefined(el: Element, owner: Block | null, attach: (bindable: Bindable | null) => void): void {
  const tag = el.localName;
  const run = (): void => {
    if (owner !== null && !owner.alive) return;
    const cls = customElements.get(tag);
    customElements.upgrade(el);
    attach(cls ? readBindable(cls) : null);
  };
  if (customElements.get(tag) !== undefined) run();
  else void customElements.whenDefined(tag).then(run);
}

const JSON_TYPES = new Set(["object"]);

/** Mirrors an input's value to its declared attribute (best effort, never blocks the write). */
export function mirrorAttribute(el: Element, attribute: string, v: unknown): void {
  try {
    if (v == null) el.removeAttribute(attribute);
    else if (JSON_TYPES.has(typeof v)) {
      let s: string;
      try {
        s = JSON.stringify(v);
      } catch {
        s = String(v);
      }
      el.setAttribute(attribute, s);
    } else el.setAttribute(attribute, String(v));
  } catch {
    // mirroring is best effort
  }
}

/** A property binding on a custom element (with or without a wc-bindable declaration). */
export function attachProperty(engine: Engine, spec: Spec, el: Element, name: string, pattern = spec.pattern!,
  row: StateRow | null, owner: Block | null, bd: Bindable | null): Binding {
  const out = bd?.properties.get(name) ?? null;
  const input = bd?.inputs.get(name);
  const outputOnly = out !== null && input === undefined;
  const b = new Binding(engine, K_CUSTOM, el, name, pattern, row, owner, spec.filters, undefined);
  b.inFilters = spec.inFilters;
  b.attribute = input?.attribute ?? null;
  // state → element (every member but an output-only one)
  adopt(engine, b, !outputOnly);
  // element → state (a declared property)
  if (out !== null && !spec.ro) {
    el.addEventListener(out.event, (e) => {
      let v = out.getter !== null ? out.getter(e) : (e as CustomEvent).detail;
      if (b.applying && Object.is(v, b.value)) return; // our own write echoing back
      const fs = b.inFilters;
      if (fs !== null) for (let i = 0; i < fs.length; i++) v = fs[i](v);
      // the element already shows this value: the apply this write causes must not echo it
      // back (or re-mirror the attribute) to the element it came from
      if (b.filters === null) b.value = v;
      engine.write(b.pattern, b.row, v, out.occurrence);
    });
  }
  // initial authority: output-only members seed state from the element, others the other way
  const init = spec.init ?? (outputOnly ? "element" : "state");
  if (init === "state") {
    if (!outputOnly) engine.applyBinding(b);
  } else if (init === "element" || init === "auto") {
    const seed = (): void => {
      if (owner !== null && !owner.alive) return;
      if (init === "auto" && engine.readUntracked(b.pattern, b.row) !== undefined) {
        if (!outputOnly) engine.applyBinding(b);
        return;
      }
      const snapshot = (el as any)[name];
      if (b.filters === null) b.value = snapshot; // seeded from the element: nothing to write back
      engine.write(b.pattern, b.row, snapshot);
    };
    if (spec.sync === "connect" && !el.isConnected) void Promise.resolve().then(seed);
    else seed();
  }
  return b;
}

function noBindable(id: M, el: Element, what: string): never {
  raise(id, [el.localName, what]);
}

/** `command.<method>: $command.<token>` — the element's method subscribes to the token. */
export function attachCommand(engine: Engine, spec: Spec, el: Element, owner: Block | null, bd: Bindable | null): void {
  const method = spec.name;
  const token = engine.command(spec.token!);
  if (bd === null) noBindable(M.NoBindable, el, `command.${method}`);
  if (!bd.commands.has(method)) raise(M.NoCommand, [el.localName, method]);
  const ref = new WeakRef(el);
  const fn = (...args: unknown[]): unknown => {
    const target = ref.deref() as any;
    if (target === undefined || !target.isConnected) {
      unsubscribe();
      return undefined;
    }
    return target[method](...args);
  };
  const unsubscribe = token.subscribe(fn);
  if (owner !== null) (owner.cleanups ?? (owner.cleanups = [])).push(unsubscribe);
}

/** `eventToken.<property>: <token>` — the property's event fires the event token. */
export function attachEventToken(engine: Engine, spec: Spec, el: Element, row: StateRow | null, bd: Bindable | null): void {
  const prop = spec.name;
  if (bd === null) noBindable(M.NoBindable, el, `eventToken.${prop}`);
  const decl = bd.properties.get(prop);
  if (decl === undefined) raise(M.NoProperty, [el.localName, prop]);
  const name = spec.token!;
  el.addEventListener(decl.event, (e) => {
    if (spec.prevent) e.preventDefault();
    if (spec.stop) e.stopPropagation();
    try {
      engine.fireEventToken(name, e, row);
    } catch (error) {
      console.error(error);
    }
  });
}

/** `...: path` — one property binding per declared property and input (explicit bindings win). */
export function attachSpread(engine: Engine, spec: Spec, el: Element, row: StateRow | null, owner: Block | null, bd: Bindable | null): void {
  if (bd === null) noBindable(M.SpreadNoBindable, el, `"...: ${spec.pattern!.path}"`);
  const names = new Set([...bd.properties.keys(), ...bd.inputs.keys()]);
  for (const name of names) {
    if (spec.exclude?.includes(name)) continue;
    const p = engine.pattern(`${spec.pattern!.path}.${name}`);
    const r = p.depth === 0 ? null : row;
    attachProperty(engine, { ...spec, init: null, sync: null }, el, name, p, r, owner, bd);
  }
}
