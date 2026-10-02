import type { IWritableConfig } from "./public/types";
import { Engine } from "./engine";
import { engines, mount } from "./dom/mount";
import { drainBinds, installBinder } from "./dom/binder";
import { DirtyStrategy } from "./strategy/dirty";
import { config, setConfig } from "./config";
import type { Strategy } from "./strategy/types";
import { raise, M, text } from "./messages";
import { hooks, loadFeatures, requireFeature, type Claimed } from "./hooks";

let makeStrategy: () => Strategy = () => new DirtyStrategy();

/** Chooses the invalidation strategy of every engine created from now on. */
export function configure(factory: () => Strategy): void {
  makeStrategy = factory;
}

let loads = 0;

async function loadInnerScript(script: HTMLScriptElement): Promise<Record<string, any>> {
  // an import a Content-Security-Policy blocked rejects without saying why: the violation event
  // is the only witness (docs/csp.md §9)
  let blocked = false;
  const seen = (e: SecurityPolicyViolationEvent): void => {
    if (e.effectiveDirective.startsWith("script-src")) blocked = true;
  };
  document.addEventListener("securitypolicyviolation", seen);
  // a server (@wcstack/server) removes createObjectURL: a data: URL, unique so no load is cached
  const blob = typeof URL.createObjectURL === "function";
  const url = blob
    ? URL.createObjectURL(new Blob([script.text], { type: "application/javascript" }))
    : "data:text/javascript;charset=utf-8," + encodeURIComponent(`${script.text}\n//${++loads}`);
  try {
    const mod = await import(/* @vite-ignore */ url);
    return (mod.default ?? {}) as Record<string, any>;
  } catch (e) {
    // Firefox fires the violation a task after the rejection (Chromium and WebKit before it)
    await new Promise((r) => setTimeout(r));
    throw new Error(`[@wcstack/state] ${blocked ? text(M.InlineBlocked) : text(M.InlineFailed, [e instanceof Error ? e.message : String(e)])}`, { cause: e });
  } finally {
    document.removeEventListener("securitypolicyviolation", seen);
    if (blob) URL.revokeObjectURL(url);
  }
}

async function loadSrc(src: string): Promise<Record<string, any>> {
  const url = new URL(src, document.baseURI).href;
  if (/\.json(?:[?#]|$)/.test(url)) {
    const res = await fetch(url);
    if (!res.ok) raise(M.LoadFailed, [src, res.status]);
    return (await res.json()) as Record<string, any>;
  }
  const mod = await import(/* @vite-ignore */ url);
  return (mod.default ?? {}) as Record<string, any>;
}

/**
 * The root `<wcs-state>` elements of each root node (and the one a component mount or a DCC definition
 * has in its shadow root): a new list whenever one connects, without the ones no longer in the page.
 */
const readyByRoot = new WeakMap<Node, WcsState[]>();

/** Puts `el` among the `<wcs-state>` elements of its root (a new list, without the ones that left). */
function enroll(el: WcsState): void {
  const root = el.getRootNode();
  readyByRoot.set(root, [...(readyByRoot.get(root) ?? []).filter((e) => e.isConnected && e !== el), el]);
}

/**
 * Resolves when the bindings of `root` are built — by any `<wcs-state>` in it now, whatever its
 * `$connectedCallback` does then, as 3.x — and rejects, with the first failure, only when every one
 * failed before building them. A stray one (a second root, #47; one that fails to load) changes
 * nothing while another binds the root; one taken out of the page counts no more once another
 * connects (a root replaced: the new one decides).
 */
export function getBindingsReady(root: Node): Promise<void> {
  const els = readyByRoot.get(root) ?? [];
  return Promise.any(els.map((el) => el.initializePromise.then((): unknown => el.bound || el.connectedCallbackPromise))).then(
    () => {},
    // none, or every one failed: one connected since (the list is a new one) may still bind the root
    // (quoted: `errors` is a name the build shortens, an AggregateError's is not)
    (e: AggregateError) => (els.length ? readyByRoot.get(root) !== els ? getBindingsReady(root) : Promise.reject(e["errors"][0]) : undefined),
  );
}

/**
 * The base of the package's elements: HTMLElement, or — where there is none (Node without a DOM)
 * — an inert class, so the entries can be imported headless (a tool reading the manifest, a
 * server framework importing at the top level), as 3.x. Making an element stays a browser's.
 */
export const HTMLElementBase = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * `<wcs-state>` — one engine per element, bound to the element's root node.
 * State resolution order: `state` (id of a JSON script) → `src` → `json` → inner
 * `<script type="module">` → wait for `setInitialState()`.
 */
export class WcsState extends HTMLElementBase {
  static getBindingsReady = getBindingsReady;
  /** Servers (@wcstack/server) wait on connectedCallbackPromise when this is set. */
  static hasConnectedCallbackPromise = true;

  engine: Engine | null = null;
  readonly connectedCallbackPromise: Promise<void>;
  /**
   * Resolves once the state is loaded and bound (before `$connectedCallback`) — and also when
   * initialization fails: the failure is delivered on connectedCallbackPromise.
   */
  readonly initializePromise: Promise<void>;
  private resolveInitialize!: () => void;
  private resolveConnected!: () => void;
  private rejectConnected!: (e: unknown) => void;
  private started = false;
  /** Initialization failed before the page was bound: `setInitialState` refuses (#14). */
  private failed = false;
  private initial: Record<string, any> | null = null;
  /** Taken over by an add-on (a volume, a DCC definition): it never becomes a root. */
  private claimed: Claimed | null = null;
  /** A claimed element's state is loaded: `setInitialState` from now on is the add-on's re-set. */
  private loaded = false;
  /** The root's bindings are built (getBindingsReady resolves, whatever `$connectedCallback` does). */
  bound?: boolean;
  private receiveInitial: ((state: Record<string, any>) => void) | null = null;

  constructor() {
    super();
    this.connectedCallbackPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnected = resolve;
      this.rejectConnected = reject;
    });
    this.connectedCallbackPromise.catch(() => {});
    this.initializePromise = new Promise<void>((resolve) => {
      this.resolveInitialize = resolve;
    });
  }

  connectedCallback(): void {
    if (this.started) {
      if (this.claimed !== null) {
        this.claimed.connected();
        return;
      }
      enroll(this);
      // reconnected: $connectedCallback runs again (after the first initialization)
      const engine = this.engine;
      if (engine !== null) {
        // (a rejection is reported as the first connection's is)
        void Promise.resolve(engine.callHook("$connectedCallback")).then(() => {
          if (this.isConnected) hooks.element?.(engine, "connected");
        }, (e) => console.error(e));
      }
      return;
    }
    this.started = true;
    const root = this.getRootNode();
    const claimed = hooks.claim?.(this, root);
    if (claimed) {
      this.claimed = claimed;
      // the `<wcs-state>` of the shadow root it binds (a component's, a DCC definition's) is that
      // root's, as 3.x: getBindingsReady there waits for it — until its bindings are built, as a
      // root's — and fails with it (a volume never fails)
      if (!claimed.lenient && this.parentNode instanceof ShadowRoot) enroll(this);
      void (claimed.load === undefined ? this.loadState() : claimed.load()).then((state) => {
        this.loaded = true;
        return claimed.start(state, () => this.built());
      }).then(() => {
        this.resolveInitialize();
        this.resolveConnected();
      }, (e) => this.fail(e, claimed.lenient));
      return;
    }
    void this.start(root);
    enroll(this);
  }

  disconnectedCallback(): void {
    if (this.claimed !== null) {
      this.claimed.disconnected();
      return;
    }
    const engine = this.engine;
    if (engine === null) return;
    engine.callHook("$disconnectedCallback");
    hooks.element?.(engine, "disconnected");
  }

  /**
   * Supplies the initial state; on an initialized element, replaces the whole state and
   * re-applies every binding to it before returning (not a write: no `$renderedCallback`).
   */
  setInitialState(state: Record<string, any>): void {
    if (this.failed) raise(M.ElementFailed);
    // (until a claimed element's state is loaded, this supplies it like a root's)
    if (this.loaded) {
      this.claimed!.reset(state);
      return;
    }
    if (this.engine !== null) {
      this.engine.reset(state);
      return;
    }
    if (this.receiveInitial !== null) {
      const receive = this.receiveInitial;
      this.receiveInitial = null;
      receive(state);
    } else {
      this.initial = state;
    }
  }

  /** Runs `callback` with a state proxy; its writes are applied in the next drain. */
  createState(mutability: "readonly" | "writable", callback: (state: Record<string, any>) => void): void {
    const engine = this.engine;
    if (engine === null) raise(M.NotInitialized);
    if (mutability === "readonly") engine.readonlyDepth++;
    try {
      callback(engine.proxy);
    } finally {
      if (mutability === "readonly") engine.readonlyDepth--;
    }
  }

  /** `createState` whose callback may await; a readonly proxy stays readonly across its awaits. */
  async createStateAsync(mutability: "readonly" | "writable", callback: (state: Record<string, any>) => Promise<void>): Promise<void> {
    const engine = this.engine;
    if (engine === null) raise(M.NotInitialized);
    await callback(mutability === "writable" ? engine.proxy : new Proxy(engine.proxy, {
      // as in createState("readonly"), the writes of $setAll and $resolve (path, indexes, value) refuse;
      // read with this view as the receiver, a method comes as it is and runs on this view
      get(t, k, receiver) {
        const v = Reflect.get(t, k, receiver);
        return k === "$setAll" || k === "$resolve" ? (...a: unknown[]) => (a.length > 2 && raise(M.Readonly), v(...a)) : v;
      },
      set() {
        raise(M.Readonly);
      },
    }));
  }

  private async loadState(): Promise<Record<string, any>> {
    // a parser that inserts the element before its children (a server render) has added them by now
    await 0;
    const id = this.getAttribute("state");
    if (id !== null) {
      // a JSON script of that id (an element of user content with the same id, earlier, is not it)
      const find = (r: Node): HTMLScriptElement | undefined =>
        [...(r as Document).querySelectorAll<HTMLScriptElement>('script[type="application/json"]')].find((x) => x.id === id);
      const script = find(this.getRootNode()) ?? find(document);
      if (script === undefined) return Promise.reject(new Error(`[@wcstack/state] ${text(M.NoScript, [id])}`));
      return Promise.resolve(JSON.parse(script.textContent || "{}"));
    }
    const src = this.getAttribute("src");
    if (src !== null) return loadSrc(src);
    const json = this.getAttribute("json");
    if (json !== null) return Promise.resolve(JSON.parse(json));
    const script = this.querySelector('script[type="module"]') as HTMLScriptElement | null;
    if (script !== null) return loadInnerScript(script);
    if (this.initial !== null) return Promise.resolve(this.initial);
    return new Promise((resolve) => {
      this.receiveInitial = resolve;
    });
  }

  private async start(root: Node): Promise<void> {
    try {
      // what an add-on serves: a volume, a component mount, a DCC definition, server rendering
      const host = (root as ShadowRoot).host;
      if (this.hasAttribute("mount") || this.hasAttribute("bind-component") || host?.hasAttribute("data-wc-definition")) {
        requireFeature("scopes", "<wcs-state>");
      }
      const state = await this.loadState();
      const loading = loadFeatures(state);
      if (loading) await loading;
      if (this.hasAttribute("enable-ssr")) requireFeature("ssr", "enable-ssr");
      // one state tree per root: another <wcs-state> already bound this root (and still does —
      // whatever its $connectedCallback did then), or a component's took it
      const other = engines.get(root)?.element as WcsState | undefined;
      if (other?.isConnected && (other.bound || other.claimed)) raise(M.SecondRoot);
      const engine = new Engine(state, makeStrategy());
      engine.element = this;
      this.engine = engine;
      hooks.element?.(engine, "mounting");
      mount(engine, root as Document | ShadowRoot);
      drainBinds();
      engine.watchRendered();
      this.built();
      await engine.callHook("$connectedCallback");
      if (this.isConnected) hooks.element?.(engine, "connected");
      this.resolveConnected();
    } catch (e) {
      // (a root that bound its page and whose $connectedCallback then failed has not: re-set stays open)
      this.failed = !this.bound;
      this.fail(e);
    }
  }

  /** The bindings are built (before `$connectedCallback`): getBindingsReady resolves, initializePromise too. */
  private built(): void {
    this.bound = true;
    this.resolveInitialize();
  }

  /**
   * Initialization failed: reported once, the element (and where its state comes from) before what
   * was thrown, as 3.5 — `<wcs-state src="./state.js"> failed to initialize.`, or, once its
   * bindings were built, `… $connectedCallback failed.` — and connectedCallbackPromise rejects with
   * it, or resolves for a claim that is `lenient` (a volume).
   */
  private fail(e: unknown, lenient?: boolean): void {
    const at = ["mount", "bind-component", "state", "src"].flatMap((n) => (this.hasAttribute(n) ? [n, this.getAttribute(n)] : []));
    console.error(`[@wcstack/state] ${text(this.bound ? M.ConnectedFailed : M.InitFailed, [this.localName, ...at])}`, e);
    this.resolveInitialize();
    if (lenient) this.resolveConnected();
    else this.rejectConnected(e);
  }
}

/**
 * The registries `<wcs-state>` was defined in: an add-on installed later defines its tags there
 * too. Weak: a server creates a registry per render, and holding them would keep every render's
 * registry (and every constructor defined in it) alive.
 */
let refs: WeakRef<CustomElementRegistry>[] = [];

/**
 * The registries still alive (dead references are dropped). A registry deref() returned stays
 * alive until the end of this job, so the second deref() of each kept reference finds it.
 */
export function registries(): CustomElementRegistry[] {
  refs = refs.filter((r) => r.deref());
  return refs.map((r) => r.deref()!);
}

/**
 * Registers `<wcs-state>` (and the installed add-ons' tags) in `registry` — a scoped registry
 * does not inherit the global one, so a tree using one needs its own definitions.
 */
export function define(registry: CustomElementRegistry = customElements): void {
  installBinder();
  if (!registries().includes(registry)) refs.push(new WeakRef(registry));
  const tag = config.tagNames.state;
  if (registry.get(tag) === undefined) registry.define(tag, class extends WcsState {});
  hooks.tags?.(registry);
}

/** Applies `config` and registers `<wcs-state>`. The core only: install the add-ons first. */
export function bootstrapState(partial?: IWritableConfig, registry?: CustomElementRegistry): void {
  if (partial) setConfig(partial);
  define(registry);
}

/**
 * Waits for the bindings under `root` (3.x built them here; the new engine builds them when the
 * root's `<wcs-state>` loads its state, so this only waits — the same as getBindingsReady).
 */
export const buildBindings = (root: Document | ShadowRoot): Promise<void> => getBindingsReady(root);
