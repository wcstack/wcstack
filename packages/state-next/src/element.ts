import { Engine } from "./engine";
import { mount } from "./dom/mount";
import { drainBinds, installBinder } from "./dom/binder";
import { DirtyStrategy } from "./strategy/dirty";
import { config, setConfig, type PartialConfig } from "./config";
import type { Strategy } from "./strategy/types";
import { raiseError } from "./parser/raiseError";
import { hooks, requireFeature, type Claimed } from "./hooks";

let makeStrategy: () => Strategy = () => new DirtyStrategy();

/** Chooses the invalidation strategy of every engine created from now on. */
export function configure(factory: () => Strategy): void {
  makeStrategy = factory;
}

async function loadInnerScript(script: HTMLScriptElement): Promise<Record<string, any>> {
  const url = URL.createObjectURL(new Blob([script.text], { type: "application/javascript" }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    return (mod.default ?? {}) as Record<string, any>;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadSrc(src: string): Promise<Record<string, any>> {
  const url = new URL(src, document.baseURI).href;
  if (/\.json(?:[?#]|$)/.test(url)) {
    const res = await fetch(url);
    if (!res.ok) raiseError(`failed to load "${src}": ${res.status}`);
    return (await res.json()) as Record<string, any>;
  }
  const mod = await import(/* @vite-ignore */ url);
  return (mod.default ?? {}) as Record<string, any>;
}

/** Resolves when the bindings of `root` are built (the state element on it initialized). */
const readyByRoot = new WeakMap<Node, Promise<void>>();

export function getBindingsReady(root: Node): Promise<void> {
  return readyByRoot.get(root) ?? Promise.resolve();
}

/**
 * `<wcs-state>` — one engine per element, bound to the element's root node.
 * State resolution order: `state` (id of a JSON script) → `src` → `json` → inner
 * `<script type="module">` → wait for `setInitialState()`.
 */
export class WcsState extends HTMLElement {
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
  private failed = false;
  private initial: Record<string, any> | null = null;
  /** Taken over by an add-on (a volume, a DCC definition): it never becomes a root. */
  private claimed: Claimed | null = null;
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
      // reconnected: $connectedCallback runs again (after the first initialization)
      const engine = this.engine;
      if (engine !== null) {
        void Promise.resolve(engine.callHook("$connectedCallback")).then(() => {
          if (hooks.element !== null && this.isConnected) hooks.element(engine, "connected");
        });
      }
      return;
    }
    this.started = true;
    const root = this.getRootNode();
    const claimed = hooks.claim === null ? null : hooks.claim(this, root);
    if (claimed !== null) {
      this.claimed = claimed;
      void (claimed.load === undefined ? this.loadState() : claimed.load()).then((state) => claimed.start(state)).catch((e) => console.error(e)).finally(() => {
        this.resolveInitialize();
        this.resolveConnected();
      });
      return;
    }
    const ready = this.start(root);
    readyByRoot.set(root, ready.catch(() => {}));
  }

  disconnectedCallback(): void {
    if (this.claimed !== null) {
      this.claimed.disconnected();
      return;
    }
    const engine = this.engine;
    if (engine === null) return;
    engine.callHook("$disconnectedCallback");
    if (hooks.element !== null) hooks.element(engine, "disconnected");
  }

  /**
   * Supplies the initial state; on an initialized element, replaces the whole state and
   * re-applies every binding to it before returning (not a write: no `$renderedCallback`).
   */
  setInitialState(state: Record<string, any>): void {
    if (this.failed) raiseError("this <wcs-state> failed to initialize; create a new one");
    if (this.claimed !== null && this.receiveInitial === null) {
      this.claimed.reset(state);
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
    if (engine === null) raiseError("state is not initialized");
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
    if (engine === null) raiseError("state is not initialized");
    await callback(mutability === "writable" ? engine.proxy : new Proxy(engine.proxy, {
      set() {
        throw new Error("This state is readonly.");
      },
    }));
  }

  private loadState(): Promise<Record<string, any>> {
    const id = this.getAttribute("state");
    if (id !== null) {
      const script = (this.getRootNode() as Document | ShadowRoot).getElementById?.(id) ?? document.getElementById(id);
      if (script === null) return Promise.reject(new Error(`[@wcstack/state] no <script> with id "${id}"`));
      return Promise.resolve(JSON.parse(script.textContent ?? "{}"));
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
      if (this.hasAttribute("enable-ssr")) requireFeature("ssr", "enable-ssr");
      const state = await this.loadState();
      const engine = new Engine(state, makeStrategy());
      engine.element = this;
      this.engine = engine;
      if (hooks.element !== null) hooks.element(engine, "mounting");
      mount(engine, root as Document | ShadowRoot);
      drainBinds();
      engine.watchRendered();
      this.resolveInitialize();
      await engine.callHook("$connectedCallback");
      if (hooks.element !== null && this.isConnected) hooks.element(engine, "connected");
      this.resolveConnected();
    } catch (e) {
      this.failed = true;
      this.resolveInitialize();
      console.error(e);
      this.rejectConnected(e);
      throw e;
    }
  }
}

export function define(): void {
  installBinder();
  const tag = config.tagNames.state;
  if (customElements.get(tag) === undefined) customElements.define(tag, class extends WcsState {});
}

/** Applies `config` and registers `<wcs-state>` (the named-entry equivalent of the auto bundle). */
export function bootstrapState(partial?: PartialConfig): void {
  if (partial) setConfig(partial);
  define();
}
