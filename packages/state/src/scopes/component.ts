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
 * `#ro` on an entry (`state#ro: user`) is honoured as in 3.3: a component's code writing through it
 * throws `[wcs/mount-readonly]`, an element's write-back inside the component is dropped.
 *
 * A whole mount's accessors are exported at the mount point (README "Exported getters"): the host
 * reads `user.display` (row by row for `state: .`) from the component mounted there, unless the
 * tree has the key.
 * A mounted component runs no temporal declaration and no `$renderedCallback`, and refuses `$recursion`.
 */
import { Engine, rowAt } from "../engine";
import { WILDCARD, type Pattern } from "../pattern";
import type { StateRow } from "../list";
import type { Binding } from "../dom/view";
import { hooks, loadFeatures, type Claimed } from "../hooks";
import { config } from "../config";
import { DirtyStrategy } from "../strategy/dirty";
import { mount } from "../dom/mount";
import { drainBinds } from "../dom/binder";
import { registryOf } from "../dom/wc";
import { raiseError } from "../parser/raiseError";
import { onRootFailed, orphan, rootEngineCreated, watchRoot, wired } from "./volume";

interface Entry {
  /** The component-side path ("" = the whole state). */
  readonly inner: string;
  /** The host pattern and row (at the pattern's depth) it is mounted on. */
  readonly outer: Pattern;
  readonly row: StateRow | null;
  /** Mounted `#ro`: the component reads it and does not write it. */
  readonly ro: boolean;
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
  /** Its `<wcs-state>`: a new one that takes the scope over replaces it (resume). */
  el: HTMLElement;
  /** The nodes of the scope root once it was bound: still there, a new `<wcs-state>` takes the scope over. */
  nodes: ChildNode[];
  readonly component: Engine;
  readonly host: Host;
  readonly slots: { m: Mount; e: Entry }[];
  /** Component patterns that read and write the host. */
  readonly synth: Map<Pattern, Synth>;
  registered: boolean;
  /** A mounted key its setter just wrote through the host (its `written` is not forwarded again). */
  skip: Pattern | null;
  /** The entry a change of the component is crossing to the host through: its other entries still take it. */
  from: Entry | null;
  /** Exported accessors (a whole mount's): host pattern (`user.display`) → the component's accessor pattern. */
  exports: Map<Pattern, Pattern> | null;
  /**
   * It failed before its bindings were built (a markup error): what it bound before the error follows
   * the host while it is connected, as a root's does (#384), and no lifecycle hook runs — its
   * `$connectedCallback` never did.
   */
  broken?: boolean;
}

type Slot = Mount["slots"][number];

/** Plain property bindings hosts made on custom elements: the candidates for wiring. */
const hostBindings = new WeakMap<Element, Binding[]>();
/** Those of them written with `#ro`. */
const readonlyWiring = new WeakSet<Binding>();
/** An element property's value before a host's first write to it (a mount takes the component's). */
const before = new WeakMap<Element, Map<string, unknown>>();
/** Components waiting for their host to bind the wiring written in its markup. */
const waiting = new WeakMap<Element, () => void>();
/**
 * SSR: a row is a clone of its plan, so the server's output carries no `data-wcs` on a row's
 * elements. A host binding made while rendering on the server writes the heads it binds here
 * instead, so a component whose class is defined before the client adopts the row still waits
 * for its wiring (as it does for `data-wcs`); the client's host binding removes it.
 */
const WIRED = "data-wcs-wired";
const onServer = (): boolean => document.documentElement?.hasAttribute("data-wcs-server") === true;
const hosts = new WeakMap<Element, Host>();
const mounts = new WeakMap<Engine, Mount>();
/** Mount entries by host engine, host pattern and host row. */
const index = new WeakMap<Engine, Map<Pattern, Map<StateRow | null, Set<Slot>>>>();
let registered = 0;
/** Engines a change is crossing from: it does not come back to them. */
const active = new Set<Engine>();

const UNWIRED = {};
/** Declarations a mounted component does not run (`$listKeys` runs: it keys the component's own lists). */
const INERT = ["$watch", "$stream", "$renderedCallback"];

const headOf = (path: string): string => path.split(".", 1)[0];

/** `a.*.b.*` with [2, 5] → `a.2.b.5`. */
function fill(path: string, idx: number[]): string {
  let i = 0;
  return path.split(".").map((s) => (s === WILDCARD ? String(idx[i++]) : s)).join(".");
}

/** The core's hook: a plain property binding on a custom element (before it applies). */
export function hostBinding(b: Binding, ro: boolean): boolean {
  const el = b.node as Element;
  const head = headOf(b.name);
  if (!onServer()) el.removeAttribute(WIRED);
  else if (!wiredInMarkup(el, head)) {
    const heads = el.getAttribute(WIRED)?.split(" ") ?? [];
    if (!heads.includes(head)) el.setAttribute(WIRED, [...heads, head].join(" "));
  }
  // the component took its wiring when it loaded: a mount is not re-wired
  if (hosts.get(el)?.prop === head) {
    raiseError(`<${el.localName}>.${head} has loaded its state: the wiring "${b.name}" added afterwards cannot reach it — bind the host's wiring before the component loads.`);
  }
  let list = hostBindings.get(el);
  if (list === undefined) hostBindings.set(el, (list = []));
  list.push(b);
  if (ro) readonlyWiring.add(b);
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

/** The server's output says the host binds `prop` on this row element (see WIRED). */
const wiredOnServer = (host: Element, prop: string): boolean => host.getAttribute(WIRED)?.split(" ").includes(prop) === true;

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
  await registryOf(host).whenDefined(tag);
  let h = hosts.get(host);
  if (h !== undefined) {
    if (h.prop !== prop) raiseError(`<${tag}> already has a <${config.tagNames.state} bind-component="${h.prop}">.`);
    return h.state;
  }
  const wiring = () => (hostBindings.get(host) ?? []).filter((b) => headOf(b.name) === prop);
  // the host binds its wiring when it renders the element (a row before inserting it; the page
  // when its state loads; a server-rendered row when the client adopts it), or when the
  // element's class is defined
  if (wiring().length === 0 && (wiredInMarkup(host, prop) || wiredOnServer(host, prop))) {
    // (if the page's state fails, its wiring never comes)
    let stop!: () => boolean;
    await new Promise<void>((r, j) => {
      waiting.set(host, r);
      stop = onRootFailed(host.getRootNode(), () => j(new Error(`[@wcstack/state] <${tag}>.${prop} will not mount: the root state failed to initialize.`)));
    }).finally(() => stop());
  }
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
    const star = inner.split(".").indexOf(WILDCARD);
    if (star >= 0) {
      const list = inner.split(".").slice(0, star).join(".");
      raiseError(`<${tag}> maps "${b.name}": the component-side path of a mount cannot contain "*"${list === "" ? "" : ` — map the list itself ("${prop}.${list}: <the host's list>")`}.`);
    }
    entries.push({ inner, outer: b.pattern, row: b.row, ro: readonlyWiring.has(b) });
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
  // keys among them, then what now reads through them. A snapshot: both loops walk it (a pattern
  // made during the first goes through the wrapped onPatternCreated above).
  const made = [...C.patterns.all()];
  for (const p of made) mountKey(m, whole, p);
  for (const p of made) base.call(C, p);
  // a mount in a host row goes with the row (4.0 discards a removed row's element): it renders no
  // more — what it would read of the row throws (live), its own keys stay readable and writable
  const rows = h.entries.filter((e) => e.row !== null);
  if (rows.length > 0) {
    const drain = C.drain;
    C.drain = () => {
      if (rows.every((e) => e.row!.alive)) drain.call(C);
    };
  }
}

/**
 * `element.state` is the component's proxy, handed out as an object: a function the state declares
 * (a method, or a function-valued key it starts with) read off it always runs on it, whatever `this`
 * it is called with — detached (`const { toggle } = element.state`), as a listener
 * (`button.addEventListener("click", element.state.toggle)`), by a timer — as 3.x's `bind` did
 * (#331; an explicit `call(other)` is ignored, as with `bind`). It is wrapped once per function, in a
 * proxy that keeps the function's properties, statics, `new`, `name` and identity across reads; a
 * function a key comes to hold later, the tree's or its own, is returned as it is. Only reads through
 * the proxy itself are wrapped, not through a view of it (`createStateAsync("readonly")`, whose
 * methods must run on the read-only view). A root's proxy is only lent to a callback, and a volume's
 * methods are bound to its chroot already.
 */
function bindMethods(C: Engine, state: object): void {
  const methods = new Map<unknown, unknown>();
  for (let o: object | null = state; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of Object.getOwnPropertyNames(o)) {
      const v = Object.getOwnPropertyDescriptor(o, k)!.value;
      if (typeof v === "function" && k !== "constructor") methods.set(v, null);
    }
  }
  const apply = (f: (...a: unknown[]) => unknown, _self: unknown, args: unknown[]): unknown => Reflect.apply(f, C.proxy, args);
  C.bound = (fn) => {
    let b = methods.get(fn);
    if (b === null) methods.set(fn, (b = new Proxy(fn, { apply })));
    return b;
  };
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
  } else if (whole !== null && p.parent === null && head[0] !== "$" && !own(h, head)) {
    e = whole;
    target = H.pattern(`${whole.outer.path}.${head}`);
  } else {
    return;
  }
  const row = e.row;
  const through = e;
  p.getter = () => H.readUntracked(target, live(m, row));
  p.setter = (value: unknown) => {
    across(m, through, () => H.write(target, row, value));
    m.skip = p;
  };
  m.synth.set(p, { e, p: target, row });
}

/**
 * The host row an entry is mounted on, for reading or writing through it. A removed row is gone
 * for good (4.0 never puts a removed row's element in another row): nothing of it is the
 * component's any more, and the position it had may hold another row now (3.4 #367 / #368).
 */
function live(m: Mount, row: StateRow | null): StateRow | null {
  if (row !== null && !row.alive) raiseError(`The host row of <${m.host.el.localName}> was removed.`);
  return row;
}

/** Runs a change of component `m` crossing to its host through entry `e`. */
function across(m: Mount, e: Entry, fn: () => void): void {
  const was = active.has(m.component);
  active.add(m.component);
  m.from = e;
  try {
    fn();
  } finally {
    if (!was) active.delete(m.component);
    m.from = null;
  }
}

/** Whether a change crossing from the component's own entry `from` (or from its host) reaches `slot`. */
const reaches = (slot: Slot, reached: boolean): boolean =>
  reached || !active.has(slot.m.component) || (slot.m.from !== null && slot.m.from !== slot.e);

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
  /**
   * The host row of `hp`: the entry's own row (not the row now at its position), and under it the
   * component's rows (a component path with a `*` of its own).
   */
  const at = (): StateRow | null => {
    const r = live(m, from.row);
    if (p.depth === 0) return r;
    H.resolve(fill(hp.path, [...H.indexesOf(r), ...C.indexesOf(rowAt(C.ctx, p.depth))]), null);
    return (H as any).rr as StateRow | null;
  };
  p.getter = () => {
    const r = at();
    return hp.depth > 0 && r === null ? undefined : H.readUntracked(hp, r);
  };
  if (hp.setter !== null) {
    p.setter = (value: unknown) => {
      const r = at();
      across(m, from.e, () => H.write(hp, r, value));
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
  const whole = m.host.entries.find((e) => e.inner === "");
  if (whole === undefined) return;
  if (m.exports === null) exportAccessors(m, whole);
  // the host's readers of the exported paths: the component answers them now (a re-set of the
  // host while it was away forgot the answer), or no longer
  for (const hp of m.exports!.keys()) {
    if (on && hp.getter === null) answer(H, hp, whole.outer);
    H.strategy.invalidate(H, hp, whole.row);
  }
  if (m.exports!.size > 0) H.schedule();
  if (on) warnShadowed(m, whole);
}

// ---------------------------------------------------------------- exported accessors

/** The getters `answer` gave host patterns (a re-set of the host forgets them with its accessors). */
const exporting = new WeakSet<object>();

/**
 * README "Exported getters": a whole mount's accessors (getters and setters, not methods or
 * private data, no `*` in the name) are read at the mount point. The host's own accessor there
 * wins; a key the tree has wins (`wcs/mount-export-shadowed`).
 */
function exportAccessors(m: Mount, whole: Entry): void {
  const h = m.host;
  const H = h.engine!;
  m.exports = new Map();
  const seen = new Set<string>();
  for (let o: object | null = h.state; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of Object.getOwnPropertyNames(o)) {
      if (seen.has(k)) continue;
      seen.add(k);
      const d = Object.getOwnPropertyDescriptor(o, k)!;
      if ((d.get === undefined && d.set === undefined) || k[0] === "$" || k.includes(WILDCARD)) continue;
      // a dotted accessor exports only from the component's own data (`form.label`), not the tree's
      const head = headOf(k);
      if (k !== head && !own(h, head)) continue;
      const hp = H.pattern(`${whole.outer.path}.${k}`);
      // the host's own accessor there wins
      if (hp.getter === null) answer(H, hp, whole.outer);
      else if (!exporting.has(hp.getter)) continue;
      m.exports.set(hp, m.component.pattern(k));
    }
  }
}

/** The mount that exports `hp` at host row `row` (the row at the mount point's depth). */
function exporter(H: Engine, outer: Pattern, row: StateRow | null, hp: Pattern): Mount | null {
  const set = index.get(H)?.get(outer)?.get(row);
  if (set === undefined) return null;
  let found: Mount | null = null;
  for (const slot of set) {
    if (slot.e.inner !== "" || slot.m.exports?.has(hp) !== true || slot.m === found) continue;
    if (found !== null) {
      raiseError(`[wcs/mount-export-ambiguous] "${hp.path}" is exported by two mounted components on the same instance: <${found.host.el.localName}> and <${slot.m.host.el.localName}>. Mount only one of them there, or rename one accessor. See docs/state-overlay-export-design.md X4.`);
    }
    found = slot.m;
  }
  return found;
}

/** Makes host pattern `hp` read (and write) the accessor of the component mounted at `outer`, row by row. */
function answer(H: Engine, hp: Pattern, outer: Pattern): void {
  const parent = hp.parent!;
  const last = hp.last;
  /** The tree's object that has the key, or null. */
  const tree = (): any => {
    const o = H.read(parent, H.ctx) as any;
    return o !== null && typeof o === "object" && last in o ? o : null;
  };
  hp.getter = () => {
    const o = tree();
    if (o !== null) return o[last];
    const m = exporter(H, outer, H.ctx, hp);
    return m === null ? undefined : m.component.read(m.exports!.get(hp)!, null);
  };
  exporting.add(hp.getter);
  hp.setter = (value: unknown) => {
    const o = tree();
    const m = o === null ? exporter(H, outer, H.ctx, hp) : null;
    if (m === null) {
      // no component answers it here: the tree's own key
      const at = H.read(parent, H.ctx) as any;
      if (at !== null && typeof at === "object") at[last] = value;
      return;
    }
    const cp = m.exports!.get(hp)!;
    if (findDescriptor(m.host.state, cp.path)?.set === undefined) {
      raiseError(`Cannot write to "${cp.path}" on mounted <${m.host.el.localName}>: the accessor has no setter. Add a setter or write to the underlying state paths instead.`);
    }
    m.component.write(cp, null, value);
  };
  if (hp.depth > 0) hp.slot = H.slotCount++;
}

function warnShadowed(m: Mount, whole: Entry): void {
  const H = m.host.engine!;
  for (const [hp, cp] of m.exports!) {
    const o = H.readUntracked(hp.parent!, whole.row) as any;
    if (o === null || typeof o !== "object" || !(hp.last in o)) continue;
    const tag = m.host.el.localName;
    warnOnce(`${tag}|${hp.path}`, `[wcs/mount-export-shadowed] <${tag}>.${m.host.prop}.${cp.path} is exported at "${hp.path}" but the tree already has that key, so readers outside the component get the tree value. Remove the tree key or rename the accessor. See docs/state-overlay-export-design.md X1.`);
  }
}

/** A component's exported accessor was reached (it may now differ): so are the host's readers of it. */
function exportReached(m: Mount, g: Pattern): void {
  const whole = m.host.entries.find((e) => e.inner === "")!;
  const H = m.host.engine!;
  for (const [hp, cp] of m.exports!) {
    if (cp !== g) continue;
    H.strategy.invalidate(H, hp, whole.row);
    H.schedule();
  }
}

/**
 * The `beforeWrite` hook: a component's write through a `#ro` entry, or through an entry whose
 * host row is gone. Code (a method, `element.state`, `$setAll` / `$resolve`) is refused; an
 * element's write-back (a two-way input in the component) is dropped, as `#ro` on that binding
 * would (@wcstack/state 3.3).
 */
export function guardReadonlyMount(E: Engine, p: Pattern, element: boolean): boolean {
  const m = mounts.get(E);
  if (m === undefined) return false;
  let info: Synth | undefined;
  for (let s: Pattern | null = p; s !== null && info === undefined; s = s.parent) info = m.synth.get(s);
  if (info === undefined) return false;
  const e = info.e;
  // the host's row went away (an await outlived it): the write has nowhere to land (3.3.x)
  const gone = e.row !== null && !e.row.alive;
  if (!gone && !e.ro) return false;
  if (element) return true;
  live(m, e.row);
  raiseError(`[wcs/mount-readonly] <${m.host.el.localName}> cannot write "${p.path}": it is mounted read-only ("${m.host.prop}${e.inner === "" ? "" : `.${e.inner}`}#ro: ${e.outer.path}"). Write it on the host, or drop #ro from the mount.`);
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
  hooks.written?.(E, p, row, old, value, direct);
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
    // the component keeps it private, or a partial entry maps it elsewhere (the longest prefix wins)
    if (head[0] === "$" || own(m.host, head) || m.host.entries.some((x) => x.inner !== "" && (cpath === x.inner || cpath.startsWith(`${x.inner}.`)))) return;
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
  // its host row went away (a write there is refused; `$postUpdate` is not a write): the position
  // it had may hold another row now
  if (info.row !== null && !info.row.alive) return;
  const idx = [...H.indexesOf(info.row), ...m.component.indexesOf(row)];
  H.resolve(fill(info.p.path + p.path.slice(s.path.length), idx), null);
  const hp = (H as any).rp as Pattern;
  const hr = (H as any).rr as StateRow | null;
  if (hp.depth > 0 && hr === null) return;
  across(m, info.e, () => touch(H, hp, hr, old, value, direct));
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
    if (reached && m !== undefined && m.registered && m.exports !== null) exportReached(m, p);
    const byP = index.get(E);
    if (byP === undefined) return;
    for (const [q, byRow] of byP) {
      if (p.isUnder(q)) {
        const set = byRow.get(q.depth === 0 ? null : rowAt(row, q.depth));
        if (set !== undefined) for (const slot of [...set]) if (reaches(slot, reached)) into(slot, q, p, row, old, value, direct);
      } else if (q.isUnder(p)) {
        for (const [r, set] of [...byRow]) {
          if (p.depth !== 0 && rowAt(r, p.depth) !== row) continue;
          for (const slot of [...set]) if (reaches(slot, reached)) refresh(slot);
        }
      }
    }
  } finally {
    if (!was) active.delete(E);
  }
}

async function start(el: HTMLElement, host: Element, root: Node, state: Record<string, any>, built: () => void): Promise<void> {
  if (state === UNWIRED) return;
  // the add-ons its `$features` names, before anything reads the host's current mount
  const loading = loadFeatures(state);
  if (loading) await loading;
  const h = hosts.get(host)!;
  // a mounted engine is never "mounting": its `$recursion` would run half set up — refused, as in a volume
  if (h.engine && state.$recursion) {
    raiseError(`[wcs/mount-dollar-declaration] <${host.localName}>: $recursion is not run in a mounted component — declare it on the root state.`);
  }
  const old = h.current;
  if (old !== null && old.el !== el && old.el.isConnected) {
    raiseError(`<${host.localName}> already has a connected <${config.tagNames.state} bind-component="${h.prop}">.`);
  }
  if (old !== null) register(old, false);
  if (old !== null && takesOver(old, el, root)) return resume(old, el, root, built);
  const C = new Engine(state, new DirtyStrategy());
  C.element = el;
  (el as any).engine = C;
  bindMethods(C, state);
  const m: Mount = { el, nodes: [], component: C, host: h, slots: [], synth: new Map(), registered: false, skip: null, from: null, exports: null };
  for (const e of h.entries) m.slots.push({ m, e });
  h.current = m;
  mounts.set(C, m);
  const independent = h.engine === null;
  if (!independent) {
    wire(m);
    register(m, true);
    // the volumes in it are refused (graft), those that loaded first and those that load later
    wired.add(C);
    rootEngineCreated(C, root);
  } else {
    hooks.element?.(C, "mounting");
  }
  // a Light DOM component in a server-rendered page takes the server's nodes of its content (F33)
  const adopted = hooks.adoptScope?.(root);
  mount(C, root as ShadowRoot | Element);
  adopted?.();
  m.nodes = [...root.childNodes];
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
  // the bindings are built: what waits for them goes on, whatever $connectedCallback does (as a root)
  built();
  // taken out while it initialized: it hears the host, and runs `$connectedCallback`, when it is back
  if (!el.isConnected) {
    register(m, false);
    return;
  }
  await C.callHook("$connectedCallback");
  if (independent && el.isConnected) hooks.element?.(C, "connected");
}

/**
 * Whether a new `<wcs-state bind-component>` takes the scope of the old mount `o` over (resume)
 * instead of binding its root afresh: when nodes the old engine bound or rendered are still in the
 * root (it swapped only its `<wcs-state>`). A kept `<style>`, whitespace or other nodes without
 * bindings do not count: content rendered again, its `<wcs-state>` included, is bound afresh. Nodes
 * with bindings added since next to kept bound ones (the old engine cannot take them, a new one
 * cannot take the kept ones) are reported.
 */
function takesOver(o: Mount, el: Node, root: Node): boolean {
  // (a `<wcs-state>` in another root of the host finds none of the old nodes there)
  const C = o.component;
  const attr = `[${config.bindAttributeName}]`;
  const binds = (n: Node): boolean => n.nodeType === 1 && ((n as Element).matches(attr) || (n as Element).querySelector(attr) !== null);
  // the root's children the old engine binds or rendered
  const kept = new Set<Node>();
  const top = (n: Node | null): void => {
    while (n !== null && n.parentNode !== root) n = n.parentNode;
    if (n !== null) kept.add(n);
  };
  const range = (v: { headAt(n: Node): Node | null }, anchor: Node): void => {
    for (let n = v.headAt(anchor); n !== null && n !== anchor; n = n.nextSibling) top(n);
    top(anchor);
  };
  for (const bs of C.rootBindings.values()) {
    for (const b of bs) {
      if (b.chain === null) top(b.node);
      else for (const br of b.chain.branches) range(b.chain, br.anchor);
    }
  }
  for (const l of C.rootLists.values()) for (const v of [l.view, ...(l.extra ?? [])]) if (v !== null) range(v, v.anchor);
  for (const n of o.nodes) if (n.parentNode === root && binds(n)) kept.add(n);
  if (kept.size === 0) return false;
  const added = [...root.childNodes].filter((n) => n !== el && !kept.has(n) && !o.nodes.includes(n)
    && (binds(n) || (C.mustache && n.textContent!.includes("{{"))));
  if (added.length > 0) {
    console.warn(`[@wcstack/state] <${o.host.el.localName}>: ${added.length} node(s) added beside the content taken over are not bound.`);
  }
  return true;
}

/**
 * A new `<wcs-state bind-component>` over the content the old one bound (a component that swapped only
 * its `<wcs-state>`): it takes the scope over, as a reconnection — the old engine's bindings, rows and
 * `{{ }}` anchors are on these nodes. Walking them again would bind nothing (an element walked once is
 * left alone) and read the text the bindings rendered as markup (3.x #417 / #419). Nodes with bindings
 * added since are not bound (takesOver reports them).
 */
async function resume(m: Mount, el: HTMLElement, root: Node, built: () => void): Promise<void> {
  // the old element lets go of the engine (its createState no longer reaches the scope)
  (m.el as any).engine = null;
  m.el = el;
  m.component.element = el;
  (el as any).engine = m.component;
  m.nodes = m.nodes.filter((n) => n.parentNode === root);
  // (taken out while it initialized: it hears the host when it is back, as a mount does)
  if (el.isConnected) await reconnect(m, built);
  else built();
}

/**
 * A mount connected again (or taken over, resume): it hears the host from now on, then
 * `$connectedCallback` — after `built`, for a take-over (getBindingsReady goes on as for a mount).
 */
async function reconnect(m: Mount, built?: () => void): Promise<void> {
  register(m, true);
  for (const slot of m.slots) refresh(slot);
  built?.();
  if (m.broken) return;
  // (async: a `$connectedCallback` that throws rejects, as one that rejects does)
  await m.component.callHook("$connectedCallback");
  if (m.host.engine === null && m.el.isConnected) hooks.element?.(m.component, "connected");
}

/** `<wcs-state bind-component="prop">`: claimed instead of becoming a root of its page. */
export function claimComponent(el: HTMLElement, root: Node): Claimed | null {
  const prop = el.getAttribute("bind-component");
  // the last claim: a `<wcs-state>` neither a volume nor a DCC definition nor a component is a root
  if (prop === null) return watchRoot(el, root);
  const parent = el.parentNode;
  const shadow = parent instanceof ShadowRoot;
  const host = shadow ? (parent as ShadowRoot).host : parent instanceof Element ? parent : null;
  /** Its mount, from the moment it is made (`$connectedCallback` may still run, or have thrown); null once another `<wcs-state>` took it over. */
  const mine = (): Mount | null => {
    const m = host === null ? undefined : hosts.get(host)?.current;
    return m?.el === el ? m : null;
  };
  // a component that does not mount: the volumes in its shadow root have no tree to graft onto
  const failed = (e: unknown): never => {
    if (shadow) orphan(parent!, el);
    throw e;
  };
  return {
    load() {
      return (host === null || !host.localName.includes("-")
        ? Promise.reject(new Error(`[@wcstack/state] "bind-component" requires <${config.tagNames.state}> to be a direct child of a custom element.`))
        : load(el, prop, host, !shadow)).catch(failed);
    },
    async start(state, built) {
      let bound = false;
      await start(el, host!, shadow ? parent! : host!, state, () => {
        bound = true;
        built();
      }).catch((e) => {
        // (one whose `$connectedCallback` failed is an ordinary mount)
        const m = mine();
        if (!bound && m !== null) m.broken = true;
        return failed(e);
      });
    },
    connected() {
      // (not mounted yet, or a newer `<wcs-state>` took the scope over); a failed
      // `$connectedCallback` is reported as a root's on reconnect is
      const m = mine();
      if (m !== null) reconnect(m).catch((e) => console.error(e));
    },
    disconnected() {
      const m = mine();
      if (m === null) return;
      register(m, false);
      if (m.broken) return;
      m.component.callHook("$disconnectedCallback");
      if (m.host.engine === null) hooks.element?.(m.component, "disconnected");
    },
    reset() {
      raiseError(`re-setting a component's state is not supported: write <${host?.localName}>.${prop} instead.`);
    },
  };
}
