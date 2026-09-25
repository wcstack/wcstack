/**
 * Component mounts — `<wcs-state bind-component="prop">` directly inside a custom element
 * (README "Web Component Binding"). Each component runs an engine of its own over its state
 * object (the host element's `prop`): its bindings, rows, `$1`, event indexes, getters and
 * private keys are the component's. The host wires it with ordinary property bindings on the
 * element (`state: user`, `state.x: path`, `state: .` in a row); those are taken over as
 * mount entries, and the component reads and writes the mounted keys through the host's
 * engine. Changes cross both ways through the `written` / `getterReached` hooks: the host's
 * reach the components mounted on them, and a component's writes under a mounted key reach
 * the host (and, from there, the other components mounted on the same data).
 *
 * Own keys stay private (rule R1): a key the component declares itself is its own, except a
 * one-segment partial entry, which wins over a data default. Unwired, a Shadow DOM component
 * owns an independent tree; a Light DOM one cannot (it shares the page) and fails loudly.
 *
 * Not carried over from @wcstack/state 3.3 (approved): exported getters and `#ro` (deferred).
 * A mounted component runs no temporal declaration and no `$renderedCallback`.
 */
import { Engine, rowAt } from "../engine";
import { WILDCARD, type Pattern } from "../pattern";
import type { StateRow } from "../list";
import type { Binding } from "../dom/view";
import { hooks, type Claimed } from "../hooks";
import { config } from "../config";
import { DirtyStrategy } from "../strategy/dirty";
import { mount } from "../dom/mount";
import { drainBinds } from "../dom/binder";
import { raiseError } from "../parser/raiseError";

interface Entry {
  /** The component-side path ("" = the whole state). */
  readonly inner: string;
  /** The host pattern and row (at the pattern's depth) it is mounted on. */
  readonly outer: Pattern;
  readonly row: StateRow | null;
}

/** What a host element keeps across the `<wcs-state>` elements its renders create. */
interface Host {
  readonly el: Element;
  readonly prop: string;
  /** The author's state object: the component's private data lives here. */
  readonly state: Record<string, any>;
  /** The host's engine (null: an unwired, independent component). */
  readonly engine: Engine | null;
  readonly entries: Entry[];
  current: Mount | null;
}

interface Synth {
  readonly e: Entry;
  readonly p: Pattern;
  readonly row: StateRow | null;
}

interface Mount {
  readonly el: HTMLElement;
  readonly component: Engine;
  readonly host: Host;
  readonly slots: { m: Mount; e: Entry }[];
  /** Component patterns that read and write the host. */
  readonly synth: Map<Pattern, Synth>;
  registered: boolean;
  /** A mounted key its setter just wrote through the host (its `written` is not forwarded again). */
  skip: Pattern | null;
}

type Slot = Mount["slots"][number];

/** Plain property bindings hosts made on custom elements: the candidates for wiring. */
const hostBindings = new WeakMap<Element, Binding[]>();
/** An element property's value before a host's first write to it (a mount takes the component's). */
const before = new WeakMap<Element, Map<string, unknown>>();
/** Components waiting for their host to bind the wiring written in its markup. */
const waiting = new WeakMap<Element, () => void>();
const hosts = new WeakMap<Element, Host>();
const mounts = new WeakMap<Engine, Mount>();
/** Mount entries by host engine, host pattern and host row. */
const index = new WeakMap<Engine, Map<Pattern, Map<StateRow | null, Set<Slot>>>>();
let registered = 0;
/** Engines a change is crossing from: it does not come back to them. */
const active = new Set<Engine>();

const UNWIRED = {};
const INERT = ["$watch", "$stream", "$listKeys", "$renderedCallback"];

const headOf = (path: string): string => path.split(".", 1)[0];

/** `a.*.b.*` with [2, 5] → `a.2.b.5`. */
function fill(path: string, idx: number[]): string {
  let i = 0;
  return path.split(".").map((s) => (s === WILDCARD ? String(idx[i++]) : s)).join(".");
}

/** The core's hook: a plain property binding on a custom element (before it applies). */
export function hostBinding(b: Binding): boolean {
  const el = b.node as Element;
  const head = headOf(b.name);
  if (hosts.get(el)?.prop === head) return true;
  let list = hostBindings.get(el);
  if (list === undefined) hostBindings.set(el, (list = []));
  list.push(b);
  let values = before.get(el);
  if (values === undefined) before.set(el, (values = new Map()));
  if (!values.has(head)) values.set(head, (el as any)[head]);
  waiting.get(el)?.();
  return false;
}

/** The core's hook: a Light DOM component's content is bound by its own engine. */
export function componentScope(el: Element): boolean {
  return el.localName.includes("-") && el.querySelector(`:scope > ${config.tagNames.state}[bind-component]`) !== null;
}

function wiredInMarkup(host: Element, prop: string): boolean {
  const text = host.getAttribute(config.bindAttributeName);
  return text !== null && new RegExp(`(^|;)\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[.#:]`).test(text);
}

/** A frozen author object is copied into a writable one (same prototype). */
function melt(o: Record<string, any>): Record<string, any> {
  const ds = Object.getOwnPropertyDescriptors(o);
  let frozen = Object.isFrozen(o);
  for (const d of Object.values(ds)) if ("value" in d && d.writable === false) { d.writable = true; frozen = true; }
  return frozen ? Object.create(Object.getPrototypeOf(o), ds) : o;
}

async function load(el: HTMLElement, prop: string, host: Element, light: boolean): Promise<Record<string, any>> {
  const tag = host.localName;
  if (["state", "src", "json"].some((a) => el.hasAttribute(a)) || el.querySelector('script[type="module"]') !== null) {
    raiseError(`<${config.tagNames.state} bind-component> takes its state from <${tag}>.${prop}: it cannot also load one (state / src / json / an inline script).`);
  }
  await customElements.whenDefined(tag);
  let h = hosts.get(host);
  if (h !== undefined) {
    if (h.prop !== prop) raiseError(`<${tag}> already has a <${config.tagNames.state} bind-component="${h.prop}">.`);
    return h.state;
  }
  const wiring = () => (hostBindings.get(host) ?? []).filter((b) => headOf(b.name) === prop);
  // the host binds its wiring when it renders the element (a row before inserting it; the page
  // when its state loads), or when the element's class is defined
  if (wiring().length === 0 && wiredInMarkup(host, prop)) await new Promise<void>((r) => waiting.set(host, r));
  waiting.delete(host);
  const bs = wiring();
  const values = before.get(host);
  const original = values !== undefined && values.has(prop) ? values.get(prop) : (host as any)[prop];
  if (original === null || typeof original !== "object") {
    raiseError(`"bind-component": <${tag}>.${prop} must be an object (the component's state), got ${original === null ? "null" : typeof original}.`);
  }
  if (bs.length === 0 && light) {
    // reported as an uncaught error, after this element settles (as 3.3 does)
    const error = new Error(`[@wcstack/state] A plain (unwired) Light DOM "bind-component" is not supported. Attach a shadow root to <${tag}>, or mount it from the host (${config.bindAttributeName}="${prop}: path").`);
    queueMicrotask(() => { throw error; });
    return UNWIRED;
  }
  const entries: Entry[] = [];
  for (const b of bs) {
    const inner = b.name === prop ? "" : b.name.slice(prop.length + 1);
    if (entries.some((e) => e.inner === inner)) raiseError(`<${tag}> maps "${b.name}" twice.`);
    entries.push({ inner, outer: b.pattern, row: b.row });
    // the component reads the host from now on: the binding no longer writes the element
    b.engine.unregister(b);
    if (inner !== "") delete (host as any)[b.name];
  }
  const state = bs.length === 0 ? melt(original as Record<string, any>) : original as Record<string, any>;
  hosts.set(host, (h = { el: host, prop, state, engine: bs.length === 0 ? null : bs[0].engine, entries, current: null }));
  return state;
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[@wcstack/state] ${message}`);
}

/** Whether `key` is the component's own (a data default, an accessor or a method of its state). */
const own = (h: Host, key: string): boolean => key in h.state;

/** The component's own surface for `key`: an accessor or a method (a data default is not). */
function surface(h: Host, key: string): boolean {
  const d = findDescriptor(h.state, key);
  return d !== undefined && (d.get !== undefined || d.set !== undefined || typeof d.value === "function");
}

/**
 * The component's patterns that read and write the host: a partial entry's path, and under a
 * whole mount every top-level key the component does not declare itself.
 */
function wire(m: Mount): void {
  const C = m.component;
  const h = m.host;
  const H = h.engine!;
  const tag = h.el.localName;
  const whole = h.entries.find((e) => e.inner === "") ?? null;
  for (const e of h.entries) {
    if (e.inner === "") continue;
    const head = headOf(e.inner);
    // a one-segment entry wins over a data default; the component's own surface (an accessor,
    // a method) and an own key above a deep entry win over the entry
    if (own(h, head) && (e.inner !== head || surface(h, head))) {
      warnOnce(`${tag}.${e.inner}`, `[wcs/mount-own-key-shadow] <${tag}>: "${h.prop}.${e.inner}" is hidden by the component's own "${head}"; rename one side.`);
    }
  }
  if (whole !== null) {
    const at = H.readUntracked(whole.outer, whole.row);
    if (at !== null && typeof at === "object") {
      for (const key of Object.keys(h.state)) {
        if (key[0] !== "$" && key in at && !h.entries.some((e) => e.inner === key)) {
          warnOnce(`${tag}.${key}`, `[wcs/mount-own-key-shadow] <${tag}>: its own "${key}" hides "${whole.outer.path}.${key}" — remove the default to read the tree, or rename it to keep it private.`);
        }
      }
    }
  }
  const declared = INERT.filter((k) => h.state[k] !== undefined);
  if (declared.length > 0) {
    warnOnce(`${tag}.${h.prop}$`, `[wcs/mount-dollar-declaration] <${tag}>: ${declared.join(", ")} ${declared.length === 1 ? "is" : "are"} not run in a mounted component — declare it on the root state.`);
  }
  const base = (C as any).onPatternCreated;
  (C as any).onPatternCreated = (p: Pattern) => {
    mountKey(m, whole, p);
    base.call(C, p);
  };
  // patterns the engine made before (the parents of the component's own accessors): mounted
  // keys among them, then what now reads through them
  const made = C.patterns.all();
  for (const p of made) mountKey(m, whole, p);
  for (const p of made) base.call(C, p);
}

function findDescriptor(o: object, key: string): PropertyDescriptor | undefined {
  for (let x: object | null = o; x !== null && x !== Object.prototype; x = Object.getPrototypeOf(x)) {
    const d = Object.getOwnPropertyDescriptor(x, key);
    if (d !== undefined) return d;
  }
  return undefined;
}

function mountKey(m: Mount, whole: Entry | null, p: Pattern): void {
  if (p.getter !== null) return;
  const h = m.host;
  const H = h.engine!;
  const head = headOf(p.path);
  let e = h.entries.find((x) => x.inner === p.path);
  if (e === undefined && p.parent !== null) return mountUnder(m, p);
  if (p.depth !== 0) return;
  let target: Pattern;
  if (e !== undefined) {
    if (e.inner !== head ? own(h, head) : surface(h, head)) return;
    target = e.outer;
  } else if (whole !== null && p.parent === null && head[0] !== "$" && !own(h, head) && !h.entries.some((x) => x.inner !== "" && headOf(x.inner) === head)) {
    e = whole;
    target = H.pattern(`${whole.outer.path}.${head}`);
  } else {
    return;
  }
  const row = e.row;
  p.getter = () => H.readUntracked(target, row);
  p.setter = (value: unknown) => {
    active.add(m.component);
    try {
      H.write(target, row, value);
    } finally {
      active.delete(m.component);
    }
    m.skip = p;
  };
  m.synth.set(p, { e, p: target, row });
}

/**
 * A path under a mounted key whose host counterpart is a getter (a host getter, a recursive
 * family): read — and written, if it has a setter — through the host, row by row.
 */
function mountUnder(m: Mount, p: Pattern): void {
  let s: Pattern | null = p.parent;
  let info: Synth | undefined;
  while (s !== null && (info = m.synth.get(s)) === undefined) s = s.parent;
  if (s === null || info === undefined) return;
  const C = m.component;
  const H = m.host.engine!;
  const hp = H.pattern(info.p.path + p.path.slice(s.path.length));
  if (hp.getter === null) return;
  const from = info;
  const at = (): StateRow | null => {
    const crow = p.depth === 0 ? null : rowAt(C.ctx, p.depth);
    H.resolve(fill(hp.path, [...H.indexesOf(from.row), ...C.indexesOf(crow)]), null);
    return (H as any).rr as StateRow | null;
  };
  p.getter = () => {
    const r = at();
    return hp.depth > 0 && r === null ? undefined : H.readUntracked((H as any).rp, r);
  };
  if (hp.setter !== null) {
    p.setter = (value: unknown) => {
      const r = at();
      active.add(C);
      try {
        H.write((H as any).rp, r, value);
      } finally {
        active.delete(C);
      }
      m.skip = p;
    };
  }
  if (p.depth > 0) p.slot = (C as any).slotCount++;
  m.synth.set(p, { e: from.e, p: hp, row: from.row });
}

function register(m: Mount, on: boolean): void {
  if (m.registered === on || m.host.engine === null) return;
  m.registered = on;
  registered += on ? 1 : -1;
  const H = m.host.engine;
  let byP = index.get(H);
  if (byP === undefined) index.set(H, (byP = new Map()));
  for (const slot of m.slots) {
    let byRow = byP.get(slot.e.outer);
    if (byRow === undefined) byP.set(slot.e.outer, (byRow = new Map()));
    let set = byRow.get(slot.e.row);
    if (set === undefined) byRow.set(slot.e.row, (set = new Set()));
    if (on) set.add(slot);
    else {
      set.delete(slot);
      if (set.size === 0) byRow.delete(slot.e.row);
    }
  }
}

/** A host engine that has components mounted on it: its state cannot be re-set. */
export function hasMounts(engine: Engine): boolean {
  const byP = index.get(engine);
  if (byP === undefined) return false;
  for (const byRow of byP.values()) if (byRow.size > 0) return true;
  return false;
}

/**
 * Applies a change another engine made to shared data: the lists under it re-sync (an
 * element's row takes the array's new element), hooks see it, dependents update.
 */
function touch(E: Engine, p: Pattern, row: StateRow | null, old: unknown, value: unknown, direct: boolean): void {
  if (p.getter !== null) {
    E.strategy.invalidate(E, p, row);
    E.schedule();
    return;
  }
  if (p.last === WILDCARD) {
    if (row === null) return;
    row.item = (row.list.arr as unknown[])[row.index];
    E.strategy.resetRow(row);
    if (row.children !== null) for (const l of row.children.values()) E.sync(l);
  } else {
    (E as any).syncListsUnder(p, row);
  }
  if (hooks.written !== null) hooks.written(E, p, row, old, value, direct);
  E.changed(p, row);
}

/** The value an entry is mounted on may have been replaced: every key read through it is stale. */
function refresh(slot: Slot): void {
  const C = slot.m.component;
  for (const [p, s] of slot.m.synth) {
    if (s.e !== slot.e) continue;
    if (p.depth === 0) C.strategy.invalidate(C, p, null);
    else C.forAllRows(p.lists[p.depth]!, (r) => C.strategy.invalidate(C, p, r));
  }
  C.schedule();
}

/** A host change at or under an entry: the component's path under the mounted key. */
function into(slot: Slot, q: Pattern, p: Pattern, row: StateRow | null, old: unknown, value: unknown, direct: boolean): void {
  const rest = p.path.slice(q.path.length);
  if (rest === "") return refresh(slot);
  const m = slot.m;
  const C = m.component;
  let cpath: string;
  if (slot.e.inner === "") {
    cpath = rest.slice(1);
    const head = headOf(cpath);
    // the component keeps it private, or a partial entry maps it elsewhere
    if (head[0] === "$" || own(m.host, head) || m.host.entries.some((x) => x.inner !== "" && headOf(x.inner) === head)) return;
  } else {
    cpath = slot.e.inner + rest;
  }
  const idx: number[] = [];
  for (let k = q.depth + 1; k <= p.depth; k++) idx.push(rowAt(row, k)!.index);
  C.resolve(fill(cpath, idx), null);
  const cp = (C as any).rp as Pattern;
  const crow = (C as any).rr as StateRow | null;
  if (cp.depth > 0 && crow === null) return;
  touch(C, cp, crow, old, value, direct);
}

/** A component's write under a mounted key: the host's path, with the host row's indexes first. */
function up(m: Mount, p: Pattern, row: StateRow | null, old: unknown, value: unknown, direct: boolean): void {
  let s: Pattern | null = p;
  let info: Synth | undefined;
  while (s !== null && (info = m.synth.get(s)) === undefined) s = s.parent;
  if (s === null || info === undefined) return; // private data
  const H = m.host.engine!;
  if (s === p && m.skip === p) {
    m.skip = null; // its setter wrote through the host
    return;
  }
  const idx = [...H.indexesOf(info.row), ...m.component.indexesOf(row)];
  H.resolve(fill(info.p.path + p.path.slice(s.path.length), idx), null);
  const hp = (H as any).rp as Pattern;
  const hr = (H as any).rr as StateRow | null;
  if (hp.depth > 0 && hr === null) return;
  touch(H, hp, hr, old, value, direct);
}

/**
 * The `written` / `getterReached` hook: a change in engine E crosses to the host it is mounted
 * on (a write, not a getter reached) and to the components mounted on it. A write does not come
 * back to the engines it is crossing from; a getter reached does — it only invalidates, and the
 * components a write started in read the host's getters too.
 */
export function crossed(E: Engine, p: Pattern, row: StateRow | null, old: unknown, value: unknown, direct: boolean, reached: boolean): void {
  if (registered === 0) return;
  const was = active.has(E);
  active.add(E);
  try {
    const m = mounts.get(E);
    if (!reached && m !== undefined && m.registered && !active.has(m.host.engine!)) up(m, p, row, old, value, direct);
    const byP = index.get(E);
    if (byP === undefined) return;
    for (const [q, byRow] of byP) {
      if (p.isUnder(q)) {
        const set = byRow.get(q.depth === 0 ? null : rowAt(row, q.depth));
        if (set !== undefined) for (const slot of [...set]) if (reached || !active.has(slot.m.component)) into(slot, q, p, row, old, value, direct);
      } else if (q.isUnder(p)) {
        for (const [r, set] of [...byRow]) {
          if (p.depth !== 0 && rowAt(r, p.depth) !== row) continue;
          for (const slot of [...set]) if (reached || !active.has(slot.m.component)) refresh(slot);
        }
      }
    }
  } finally {
    if (!was) active.delete(E);
  }
}

async function start(el: HTMLElement, host: Element, root: Node, state: Record<string, any>): Promise<Mount | null> {
  if (state === UNWIRED) return null;
  const h = hosts.get(host)!;
  const old = h.current;
  if (old !== null && old.el !== el && old.el.isConnected) {
    raiseError(`<${host.localName}> already has a connected <${config.tagNames.state} bind-component="${h.prop}">.`);
  }
  if (old !== null) register(old, false);
  const C = new Engine(state, new DirtyStrategy());
  C.element = el;
  (el as any).engine = C;
  const m: Mount = { el, component: C, host: h, slots: [], synth: new Map(), registered: false, skip: null };
  for (const e of h.entries) m.slots.push({ m, e });
  h.current = m;
  mounts.set(C, m);
  const independent = h.engine === null;
  if (!independent) {
    wire(m);
    register(m, true);
  } else if (hooks.element !== null) {
    hooks.element(C, "mounting");
  }
  mount(C, root as ShadowRoot | Element);
  drainBinds();
  if (independent) C.watchRendered();
  Object.defineProperty(host, h.prop, { configurable: true, enumerable: true, get: () => C.proxy });
  const ready = (host as any).$stateReadyCallback;
  if (typeof ready === "function") {
    try {
      const r = ready.call(host, h.prop);
      if (r !== null && typeof r === "object" && typeof r.then === "function") r.then(undefined, (e: unknown) => console.error(e));
    } catch (e) {
      console.error(e);
    }
  }
  await C.callHook("$connectedCallback");
  if (independent && hooks.element !== null && el.isConnected) hooks.element(C, "connected");
  return m;
}

/** `<wcs-state bind-component="prop">`: claimed instead of becoming a root of its page. */
export function claimComponent(el: HTMLElement, _root: Node): Claimed | null {
  const prop = el.getAttribute("bind-component");
  if (prop === null) return null;
  const parent = el.parentNode;
  const shadow = parent instanceof ShadowRoot;
  const host = shadow ? (parent as ShadowRoot).host : parent instanceof Element ? parent : null;
  let m: Mount | null = null;
  return {
    load() {
      if (host === null || !host.localName.includes("-")) {
        return Promise.reject(new Error(`[@wcstack/state] "bind-component" requires <${config.tagNames.state}> to be a direct child of a custom element.`));
      }
      return load(el, prop, host, !shadow);
    },
    async start(state) {
      m = await start(el, host!, shadow ? parent! : host!, state);
    },
    connected() {
      if (m === null) return;
      register(m, true);
      for (const slot of m.slots) refresh(slot);
      void Promise.resolve(m.component.callHook("$connectedCallback")).then(() => {
        if (m !== null && m.host.engine === null && hooks.element !== null && el.isConnected) hooks.element(m.component, "connected");
      });
    },
    disconnected() {
      if (m === null) return;
      register(m, false);
      m.component.callHook("$disconnectedCallback");
      if (m.host.engine === null && hooks.element !== null) hooks.element(m.component, "disconnected");
    },
    reset() {
      raiseError(`re-setting a component's state is not supported: write <${host?.localName}>.${prop} instead.`);
    },
  };
}
