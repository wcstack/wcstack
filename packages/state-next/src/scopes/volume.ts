/**
 * Volumes — `<wcs-state mount="p">` (README "Mounting Additional State"). A volume is not a
 * root: its state is grafted onto the root tree at `p` by ordinary writes, its getters and
 * setters become root accessors at `p.<key>`, its methods live at `p.<method>`, and inside all
 * of them — and in its `$connectedCallback` / `$disconnectedCallback` — `this` is chrooted at
 * `p` (`this.x` is the tree's `p.x`). Load order does not matter: a volume that loads before its
 * root grafts when the root engine is created, before the page is bound.
 *
 * Not carried over from @wcstack/state 3.3 (approved simplifications, each an error rather than
 * a silent no-op): injections on the volume element (`data-wcs="state.k: …"`), and a volume's
 * own `$watch` / `$listKeys` / `$renderedCallback` — declare them on the root.
 */
import type { Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { Claimed } from "../hooks";
import { config } from "../config";
import { engines } from "../dom/mount";
import { raiseError } from "../parser/raiseError";

interface Volume {
  readonly el: HTMLElement;
  readonly root: Node;
  readonly path: string;
  state: Record<string, any> | null;
  engine: Engine | null;
  chroot: object | null;
  /** Settles the element's connectedCallbackPromise. */
  settle: (() => void) | null;
}

/** Root engines by root node, known from the moment they are created (before their mount). */
const rootEngines = new WeakMap<Node, Engine>();
/** Mount paths held on each root (reserved when a volume connects, kept once grafted). */
const slots = new WeakMap<Node, Map<string, Volume>>();
/** Loaded volumes waiting for their root's engine. */
const waiting = new WeakMap<Node, Volume[]>();
/** The mount paths grafted onto each engine. */
export const grafted = new WeakMap<Engine, string[]>();

const REJECTED = ["$stream", "$streams", "$scan", "$recursion", "$watch", "$listKeys", "$renderedCallback"];
const NOT_RUN = ["$commandTokens", "$eventTokens", "$on", "$errorCallback"];
const PREFIX = (path: string) => `[@wcstack/state] <${config.tagNames.state} mount="${path}">`;

/** `$` APIs that take a state path: inside a volume the path is relative to the mount. */
const PATH_APIS = new Set(["$getAll", "$setAll", "$resolve", "$postUpdate", "$dependOn", "$trackDependency", "$eq"]);

function chrootOf(engine: Engine, prefix: string): object {
  const at = (key: string) => `${prefix}.${key}`;
  return new Proxy({}, {
    get(_t, key) {
      if (typeof key === "symbol") return undefined;
      if (key.charCodeAt(0) !== 36) return engine.proxy[at(key)];
      const v = engine.proxy[key];
      if (key === "$eqPath") return (path: string, keyPath: string) => v(at(path), at(keyPath));
      return PATH_APIS.has(key) && typeof v === "function" ? (path: string, ...rest: unknown[]) => v(at(path), ...rest) : v;
    },
    set(_t, key, value) {
      if (typeof key === "symbol") return false;
      engine.proxy[at(key as string)] = value;
      return true;
    },
  });
}

function validPath(path: string): boolean {
  return path !== "" && path.split(".").every((s) => s !== "" && !/[*$#@\s]/.test(s));
}

/** The engine created on `root`: graft the volumes that were waiting for it (before its page is bound). */
export function rootEngineCreated(engine: Engine, root: Node): void {
  rootEngines.set(root, engine);
  const list = waiting.get(root);
  if (list === undefined) return;
  waiting.delete(root);
  for (const v of list) graft(v, engine);
}

function release(v: Volume): void {
  const held = slots.get(v.root);
  if (held?.get(v.path) === v) held.delete(v.path);
}

/** Reports a volume that will not graft, releases its slot and settles its promise. */
function fail(v: Volume, message: string, error?: unknown): void {
  console.error(`${PREFIX(v.path)} ${message}`, ...(error === undefined ? [] : [error]));
  release(v);
  v.settle?.();
  v.settle = null;
}

function callLifecycle(v: Volume, name: "$connectedCallback" | "$disconnectedCallback"): void {
  const fn = v.state?.[name];
  if (typeof fn !== "function") return;
  try {
    const r = fn.call(v.chroot);
    if (r !== null && typeof r === "object" && typeof r.then === "function") r.then(undefined, (e: unknown) => console.error(e));
  } catch (e) {
    console.error(e);
  }
}

function graft(v: Volume, engine: Engine): void {
  const state = v.state!;
  const target = engine.target;
  const segs = v.path.split(".");
  let at: any = target;
  for (const s of segs) at = at == null ? undefined : at[s];
  if (at !== undefined) return fail(v, `will not graft: the root state already has "${v.path}".`);
  const chroot = chrootOf(engine, v.path);
  v.chroot = chroot;
  // the data (methods bound to the chroot); accessors apart
  const data: Record<string, unknown> = {};
  const accessors: [string, PropertyDescriptor][] = [];
  const seen = new Set<string>();
  for (let o: object | null = state; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Object.getOwnPropertyNames(o)) {
      if (seen.has(key) || key === "constructor") continue;
      seen.add(key);
      const d = Object.getOwnPropertyDescriptor(o, key)!;
      if (d.get !== undefined || d.set !== undefined) accessors.push([key, d]);
      else if (key[0] === "$") continue;
      else data[key] = typeof d.value === "function" ? d.value.bind(chroot) : d.value;
    }
  }
  // intermediate objects of a deep mount path, then the volume's own object
  for (let i = 1; i < segs.length; i++) {
    const p = engine.pattern(segs.slice(0, i).join("."));
    if (engine.readData(p, null) == null) engine.write(p, null, {});
  }
  engine.write(engine.pattern(v.path), null, data);
  const defined: Pattern[] = [];
  for (const [key, d] of accessors) {
    const p = engine.pattern(`${v.path}.${key}`);
    const get = d.get;
    const set = d.set;
    p.getter = get === undefined ? null : function () { return get.call(chroot); };
    p.setter = set === undefined ? null : function (value: unknown) { set.call(chroot, value); };
    defined.push(p);
  }
  if (defined.length > 0) {
    // paths under the new accessors now read through them
    for (const p of engine.patterns.all()) (engine as any).onPatternCreated(p);
    for (const p of defined) engine.changed(p, null);
  }
  v.engine = engine;
  let list = grafted.get(engine);
  if (list === undefined) grafted.set(engine, (list = []));
  list.push(v.path);
  if (v.el.isConnected) callLifecycle(v, "$connectedCallback");
  v.settle?.();
  v.settle = null;
}

/** `<wcs-state mount="p">`: claimed instead of becoming a root. */
export function claimVolume(el: HTMLElement, root: Node): Claimed | null {
  const path = el.getAttribute("mount");
  if (path === null) return null;
  const v: Volume = { el, root, path, state: null, engine: null, chroot: null, settle: null };
  let problem: string | null = null;
  if (!validPath(path)) problem = `has an invalid mount path: it must be a static path (no "*", "$", "#", "@").`;
  else if (el.hasAttribute(config.bindAttributeName)) problem = `: injections (data-wcs="state.<key>: …") are not supported — read the root path in a root getter.`;
  else {
    let held = slots.get(root);
    if (held === undefined) slots.set(root, (held = new Map()));
    const other = held.get(path);
    if (other !== undefined && other !== v) problem = `will not graft: another volume already holds "${path}".`;
    else held.set(path, v);
  }
  return {
    start(state): Promise<void> | void {
      if (problem !== null) return fail(v, problem);
      for (const key of REJECTED) if (state[key] !== undefined) return fail(v, `: ${key} is not run in a volume — declare it on the root state.`);
      for (const key of NOT_RUN) if (state[key] !== undefined) console.warn(`${PREFIX(path)}: ${key} is not run in a volume (it belongs to the root).`);
      v.state = state;
      return new Promise<void>((resolve) => {
        v.settle = resolve;
        const engine = rootEngines.get(root) ?? engines.get(root);
        if (engine !== undefined) graft(v, engine);
        else {
          let list = waiting.get(root);
          if (list === undefined) waiting.set(root, (list = []));
          list.push(v);
        }
      });
    },
    connected() {
      if (v.engine !== null) callLifecycle(v, "$connectedCallback");
    },
    disconnected() {
      // a grafted volume keeps its data and its slot (there is no unmount)
      if (v.engine !== null) callLifecycle(v, "$disconnectedCallback");
    },
    reset() {
      raiseError(`re-setting a volume is not supported: its data was copied into the root tree at "${path}" — write the paths under it on the root instead.`);
    },
  };
}

/** A root write that would replace an object a volume is grafted under. */
export function guardAncestorWrite(engine: Engine, p: Pattern): void {
  const list = grafted.get(engine);
  if (list === undefined || p.depth !== 0) return;
  for (const path of list) {
    if (path.startsWith(`${p.path}.`)) raiseError(`writing "${p.path}" would replace the volume grafted at "${path}"; write the paths under it instead.`);
  }
}
