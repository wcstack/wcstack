/**
 * Volumes — `<wcs-state mount="p">` (README "Mounting Additional State"). A volume is not a
 * root: its state is grafted onto the root tree at `p` by ordinary writes, its getters and
 * setters become root accessors at `p.<key>`, its methods live at `p.<method>`, and inside all
 * of them — and in its `$connectedCallback` / `$disconnectedCallback` — `this` is chrooted at
 * `p` (`this.x` is the tree's `p.x`). Load order does not matter: a volume that loads before its
 * root grafts when the root engine is created, before the page is bound; if the root fails to
 * initialize, its volumes report it and settle. A root hydrated from a server snapshot (SSR)
 * already holds the volume's data at `p`: the volume adopts it (3.x D14). A volume in a component
 * wired to its host (`data-wcs="state…"`) is refused, whenever it loads (3.x left it pending).
 *
 * Not carried over from @wcstack/state 3.3 (approved simplifications, each an error rather than
 * a silent no-op): injections on the volume element (`data-wcs="state.k: …"`), and a volume's
 * own `$watch` / `$listKeys` / `$renderedCallback` — declare them on the root.
 */
import type { Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { Claimed } from "../hooks";
import type { WcsState } from "../element";
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
/**
 * Loaded volumes waiting for their root's engine; an element: the root's `<wcs-state>` that failed
 * to initialize (what loads later fails with it while it is in the page: failed()).
 */
const waiting = new WeakMap<Node, Volume[] | Element>();
const ORPHAN = "will not graft: the root state failed to initialize.";
/** The engines of components wired to their host: they read the host's tree, a volume has none to graft onto. */
export const wired = new WeakSet<Engine>();
/** The mount paths grafted onto each engine. */
export const grafted = new WeakMap<Engine, string[]>();

const REJECTED = ["$stream", "$streams", "$scan", "$recursion", "$watch", "$listKeys", "$renderedCallback", "$updatedCallback", "$behavior", "$features"];
const NOT_RUN = ["$commandTokens", "$eventTokens", "$on", "$errorCallback"];
const PREFIX = (path: string) => `[@wcstack/state] <${config.tagNames.state} mount="${path}">`;

/** `$` APIs that take a state path: inside a volume the path is relative to the mount. */
const PATH_APIS = new Set(["$getAll", "$setAll", "$resolve", "$postUpdate", "$dependOn", "$eq", "$eqIndex"]);

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

/**
 * An engine whose `<wcs-state>` is in the page: a root taken out of it (the page's content
 * replaced) stays registered until another root replaces it, and nothing grafts onto it meanwhile.
 */
const live = (e: Engine | undefined): Engine | undefined => ((e?.element as Node | undefined)?.isConnected ? e : undefined);

/** The root `<wcs-state>` on `root` failed to initialize, and is still in the page. */
function failed(root: Node): boolean {
  const w = waiting.get(root);
  return w !== undefined && !Array.isArray(w) && w.isConnected;
}

/** The engine created on `root`: graft the volumes that were waiting for it (before its page is bound). */
export function rootEngineCreated(engine: Engine, root: Node): void {
  rootEngines.set(root, engine);
  const list = waiting.get(root);
  waiting.delete(root);
  if (Array.isArray(list)) for (const v of list) graft(v, engine);
}

function release(v: Volume): void {
  const held = slots.get(v.root);
  if (held?.get(v.path) === v) held.delete(v.path);
}

/** Reports a volume that will not graft, releases its slot and settles its promise. */
function fail(v: Volume, message: string): void {
  console.error(`${PREFIX(v.path)} ${message}`);
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
  if (wired.has(engine)) return fail(v, "will not graft: its component is wired to its host.");
  const state = v.state!;
  const target = engine.target;
  const segs = v.path.split(".");
  let at: any = target;
  for (const s of segs) at = at == null ? undefined : at[s];
  // a root hydrated from a server snapshot (ssr/ssr.ts) has the volume's data there already: adopted
  if (at !== undefined && (engine as any).hydrated !== true) return fail(v, `will not graft: the root state already has "${v.path}".`);
  const chroot = chrootOf(engine, v.path);
  v.chroot = chroot;
  // the data; accessors and methods (bound to the chroot) apart, as root accessors at `p.<key>`,
  // so that whatever replaces the data (the snapshot, a write of the mount path) keeps them
  const data: Record<string, unknown> = {};
  const defs: PropertyDescriptorMap = {};
  const seen = new Set<string>();
  for (let o: object | null = state; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Object.getOwnPropertyNames(o)) {
      if (seen.has(key) || key === "constructor") continue;
      seen.add(key);
      const { get, set, value } = Object.getOwnPropertyDescriptor(o, key)!;
      if (get !== undefined || set !== undefined) {
        defs[`${v.path}.${key}`] = {
          get: get && function () { return get.call(chroot); },
          set: set && function (next: unknown) { set.call(chroot, next); },
        };
      } else if (key[0] === "$") continue;
      else if (typeof value === "function") {
        const fn = value.bind(chroot);
        defs[`${v.path}.${key}`] = { get: () => fn };
      } else data[key] = value;
    }
  }
  if (at === undefined) {
    // intermediate objects of a deep mount path, then the volume's own object
    for (let i = 1; i < segs.length; i++) {
      const p = engine.pattern(segs.slice(0, i).join("."));
      if (engine.readData(p, null) == null) engine.write(p, null, {});
    }
    engine.write(engine.pattern(v.path), null, data);
  }
  // registered as the root's own are (a row-level getter gets its cache slot; the paths under
  // them read through them)
  (engine as any).registerAccessors(Object.defineProperties({}, defs));
  for (const path in defs) engine.changed(engine.pattern(path), null);
  v.engine = engine;
  let list = grafted.get(engine);
  if (list === undefined) grafted.set(engine, (list = []));
  list.push(v.path);
  if (v.el.isConnected) callLifecycle(v, "$connectedCallback");
  v.settle?.();
  v.settle = null;
}

/**
 * A root `<wcs-state>` (the one no claim took; asked by the last, claimComponent): if it fails to
 * initialize, the volumes waiting on `root` settle instead of waiting forever, and so do the ones
 * that load later — and the components waiting there for their wiring (onRootFailed).
 */
export function watchRoot(el: HTMLElement, root: Node): null {
  (el as WcsState).connectedCallbackPromise.catch(() => {
    // a root that bound the page (only its $connectedCallback failed), or a stray second one (#47)
    // beside the root that binds it: nothing failed for what waits there
    const live = engines.get(root)?.element as Element | undefined;
    if ((el as WcsState).bound || (live !== undefined && live !== el && live.isConnected)) return;
    orphan(root, el);
    for (const f of giveUp.get(root) ?? []) f();
  });
  return null;
}

/**
 * The state of `root` failed to initialize (`el`: the page's root, or a component's in its shadow
 * root): the volumes waiting there report it and settle, and so do those that load later while
 * `el` is in the page.
 */
export function orphan(root: Node, el: Element): void {
  const list = waiting.get(root);
  if (Array.isArray(list)) for (const v of list) fail(v, ORPHAN);
  waiting.set(root, el);
}

/** What else waits on a root node's `<wcs-state>` (a component, for the page's wiring). */
const giveUp = new WeakMap<Node, Set<() => void>>();

/**
 * Calls `fn` when (or if) the root `<wcs-state>` on `root` fails to initialize; the function
 * returned stops waiting (what `fn` holds is not kept for as long as the page lives).
 */
export function onRootFailed(root: Node, fn: () => void): () => boolean {
  if (failed(root)) fn();
  const s = giveUp.get(root) ?? new Set();
  giveUp.set(root, s.add(fn));
  return () => s.delete(fn);
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
    // (one grafted onto a root that left the page holds it no more)
    if (other !== undefined && other !== v && (other.engine === null || live(other.engine))) problem = `will not graft: another volume already holds "${path}".`;
    else held.set(path, v);
  }
  return {
    // a volume that cannot load resolves its connectedCallbackPromise (3.x; it reports, as below)
    lenient: true,
    start(state): Promise<void> | void {
      if (problem !== null) return fail(v, problem);
      for (const key of REJECTED) if (state[key] !== undefined) return fail(v, `: ${key} is not run in a volume — declare it on the root state.`);
      for (const key of NOT_RUN) if (state[key] !== undefined) console.warn(`${PREFIX(path)}: ${key} is not run in a volume (it belongs to the root).`);
      v.state = state;
      return new Promise<void>((resolve) => {
        v.settle = resolve;
        const engine = live(rootEngines.get(root)) ?? live(engines.get(root));
        const list = waiting.get(root);
        if (engine !== undefined) graft(v, engine);
        else if (failed(root)) fail(v, ORPHAN);
        else waiting.set(root, [...(Array.isArray(list) ? list : []), v]);
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
