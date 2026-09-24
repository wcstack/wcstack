import { Engine } from "./engine";
import { mount } from "./dom/mount";
import { DirtyStrategy } from "./strategy/dirty";
import { config, setConfig, type PartialConfig } from "./config";
import type { Strategy } from "./strategy/types";

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
    if (!res.ok) throw new Error(`[state-next] failed to load "${src}": ${res.status}`);
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

  engine: Engine | null = null;
  readonly connectedCallbackPromise: Promise<void>;
  private resolveConnected!: () => void;
  private rejectConnected!: (e: unknown) => void;
  private started = false;
  private initial: Record<string, any> | null = null;
  private receiveInitial: ((state: Record<string, any>) => void) | null = null;

  constructor() {
    super();
    this.connectedCallbackPromise = new Promise<void>((resolve, reject) => {
      this.resolveConnected = resolve;
      this.rejectConnected = reject;
    });
    this.connectedCallbackPromise.catch(() => {});
  }

  connectedCallback(): void {
    if (this.started) {
      // reconnected: $connectedCallback runs again (after the first initialization)
      if (this.engine !== null) void this.engine.callHook("$connectedCallback");
      return;
    }
    this.started = true;
    const root = this.getRootNode();
    const ready = this.start(root);
    readyByRoot.set(root, ready.catch(() => {}));
  }

  disconnectedCallback(): void {
    if (this.engine !== null) this.engine.callHook("$disconnectedCallback");
  }

  /** Supplies the initial state (before initialization). */
  setInitialState(state: Record<string, any>): void {
    if (this.engine !== null) throw new Error("[state-next] re-setting an initialized state is not implemented yet");
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
    if (engine === null) throw new Error("[state-next] state is not initialized");
    if (mutability === "readonly") engine.readonlyDepth++;
    try {
      callback(engine.proxy);
    } finally {
      if (mutability === "readonly") engine.readonlyDepth--;
    }
  }

  private loadState(): Promise<Record<string, any>> {
    const id = this.getAttribute("state");
    if (id !== null) {
      const script = (this.getRootNode() as Document | ShadowRoot).getElementById?.(id) ?? document.getElementById(id);
      if (script === null) return Promise.reject(new Error(`[state-next] no <script> with id "${id}"`));
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
      const state = await this.loadState();
      const engine = new Engine(state, makeStrategy());
      engine.element = this;
      this.engine = engine;
      mount(engine, root as Document | ShadowRoot);
      engine.watchRendered();
      await engine.callHook("$connectedCallback");
      this.resolveConnected();
    } catch (e) {
      console.error(e);
      this.rejectConnected(e);
      throw e;
    }
  }
}

export function define(): void {
  const tag = config.tagNames.state;
  if (customElements.get(tag) === undefined) customElements.define(tag, class extends WcsState {});
}

/** Applies `config` and registers `<wcs-state>` (the named-entry equivalent of the auto bundle). */
export function bootstrapState(partial?: PartialConfig): void {
  if (partial) setConfig(partial);
  define();
}
