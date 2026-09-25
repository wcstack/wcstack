/**
 * Declarative Custom Components (README "DCC"). The `<wcs-state>` inside the shadow root of a
 * `[data-wc-definition]` host is not a root: it defines the host's tag. Each instance gets a
 * copy of the definition's (untouched) shadow content, whose own `<wcs-state>` is an ordinary
 * root with a fresh state. The class's prototype reads and writes that state (writes before it
 * initializes wait for it; methods return Promises); `$bindables` / `$commands` become its
 * `static wcBindable`, and a write to a bindable (or under it, or a `$postUpdate`) dispatches
 * `<tag>:<prop>-changed` from the instance — a notification: `detail` carries the written value
 * only for a write of the member itself, and the declared getter reads the member off the element.
 *
 * The shadow is built on first use — an accessor or the connect, whichever comes first — not in
 * the constructor: a `for` row binds its elements before they are inserted, a parser-made
 * instance has no attributes in its constructor, and the definition host itself (upgraded by
 * define()) already has its shadow.
 */
import type { Engine } from "../engine";
import type { Pattern } from "../pattern";
import type { Claimed } from "../hooks";
import { config } from "../config";
import { raiseError } from "../parser/raiseError";

interface Definition {
  readonly tag: string;
  readonly bindables: readonly string[];
}

/** DCC instances by host element, and the definition of each instance's inner engine. */
const instances = new WeakMap<Element, Definition>();
const byEngine = new WeakMap<Engine, { host: Element; def: Definition }>();

function names(state: Record<string, any>, key: string): string[] {
  const v = state[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) raiseError(`${key} must be an array of state member names.`);
  const seen = new Set<string>();
  for (const n of v) {
    if (typeof n !== "string" || n === "") raiseError(`${key} entries must be non-empty strings.`);
    if (n[0] === "$") raiseError(`${key} entry "${n}": internal ($) members are never exposed.`);
    if (seen.has(n)) raiseError(`${key} entry "${n}" is duplicated.`);
    seen.add(n);
  }
  return v;
}

/** Every member of the state (own and inherited), by descriptor. */
function members(state: Record<string, any>): Map<string, PropertyDescriptor> {
  const out = new Map<string, PropertyDescriptor>();
  for (let o: object | null = state; o !== null && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const key of Object.getOwnPropertyNames(o)) {
      if (key === "constructor" || key[0] === "$" || out.has(key)) continue;
      out.set(key, Object.getOwnPropertyDescriptor(o, key)!);
    }
  }
  const streams = state.$stream;
  if (streams !== null && typeof streams === "object") for (const n of Object.keys(streams)) if (!out.has(n)) out.set(n, { value: undefined });
  return out;
}

function define(tag: string, content: DocumentFragment, mode: ShadowRootMode, state: Record<string, any>): void {
  if (!tag.includes("-")) raiseError(`DCC: <${tag} data-wc-definition> is not a valid custom element name.`);
  if (customElements.get(tag) !== undefined) raiseError(`DCC: <${tag}> is already defined.`);
  const all = members(state);
  const bindables = names(state, "$bindables");
  const commands = names(state, "$commands");
  for (const n of bindables) {
    const d = all.get(n);
    if (d === undefined) raiseError(`$bindables entry "${n}" does not exist on the state.`);
    if (typeof d.value === "function") raiseError(`$bindables entry "${n}" is a method: list it in $commands.`);
  }
  for (const n of commands) {
    const d = all.get(n);
    if (d === undefined) raiseError(`$commands entry "${n}" does not exist on the state.`);
    if (typeof d.value !== "function") raiseError(`$commands entry "${n}" is not a method: list it in $bindables.`);
  }
  const def: Definition = { tag, bindables };
  /** Each instance's inner `<wcs-state>` (null: a definition host, or content without one). */
  const states = new WeakMap<Element, any>();
  const pending = new WeakMap<Element, [string, unknown][]>();
  /** Builds the instance's shadow once; its inner `<wcs-state>`. */
  const ensure = (el: Element): any => {
    if (states.has(el)) return states.get(el);
    if (el.hasAttribute("data-wc-definition")) return null;
    const shadow = el.attachShadow({ mode });
    shadow.appendChild(content.cloneNode(true));
    const state = shadow.querySelector(config.tagNames.state);
    states.set(el, state);
    instances.set(el, def);
    if (state === null && bindables.length > 0) {
      console.warn(`[@wcstack/state] DCC: <${tag}> declares $bindables but its content has no <${config.tagNames.state}>: no change events.`);
    }
    return state;
  };
  /** The instance's inner engine once its state initialized, else null. */
  const inner = (el: Element): any => ensure(el)?.engine ?? null;
  /** Resolves when the instance's state initialized, before its `$connectedCallback` (and lands the writes queued before). */
  const ready = (el: Element): Promise<void> => Promise.resolve(ensure(el)?.initializePromise).then(() => {
    const queued = pending.get(el);
    pending.delete(el);
    const engine = inner(el);
    if (queued !== undefined && engine !== null) for (const [k, v] of queued) engine.proxy[k] = v;
  });

  class Dcc extends HTMLElement {
    static wcBindable = bindables.length === 0 && commands.length === 0 ? null : {
      protocol: "wc-bindable", version: 1,
      properties: bindables.map((name) => ({ name, event: `${tag}:${name}-changed`, getter: (e: Event) => (e.target as any)[name] })),
      inputs: bindables.map((name) => ({ name })),
      ...(commands.length === 0 ? {} : { commands: commands.map((name) => ({ name, async: true })) }),
    };

    connectedCallback(): void {
      if (ensure(this) !== null) void ready(this);
    }

    /** The inner `<wcs-state>` (as in 3.3; builds the shadow if it is not built yet). */
    get stateElement(): HTMLElement | null {
      return ensure(this);
    }
  }
  for (const [name, d] of all) {
    if (typeof d.value === "function") {
      Object.defineProperty(Dcc.prototype, name, {
        configurable: true,
        value(this: Element, ...args: unknown[]) {
          return ready(this).then(() => {
            const engine = inner(this);
            return engine === null ? undefined : engine.proxy[name].apply(engine.proxy, args);
          });
        },
      });
    } else {
      Object.defineProperty(Dcc.prototype, name, {
        configurable: true,
        get(this: Element) { return inner(this)?.proxy[name]; },
        set(this: Element, value: unknown) {
          const engine = inner(this);
          if (engine !== null) engine.proxy[name] = value;
          else {
            let q = pending.get(this);
            if (q === undefined) pending.set(this, (q = []));
            q.push([name, value]);
          }
        },
      });
    }
  }
  customElements.define(tag, Dcc);
}

/** The `<wcs-state>` of a definition host: claimed to define the tag. */
export function claimDcc(el: HTMLElement, root: Node): Claimed | null {
  const host = (root as ShadowRoot).host;
  if (host === undefined || !host.hasAttribute("data-wc-definition")) return null;
  // the definition's content, before anything touches it: every instance starts from this
  const content = document.createDocumentFragment();
  for (const n of Array.from(root.childNodes)) content.appendChild(n.cloneNode(true));
  const mode = (root as ShadowRoot).mode;
  return {
    start(state) {
      if (el.hasAttribute("bind-component")) raiseError("DCC: a <wcs-state bind-component> cannot define a component (use one mechanism).");
      define(host.localName, content, mode, state);
    },
    connected() {},
    disconnected() {},
    reset() {
      raiseError("re-setting a DCC definition is not supported: each instance loads its own state.");
    },
  };
}

/** A root engine was created: an instance's inner state gets its host's change events. */
export function dccEngineCreated(engine: Engine, root: Node): void {
  const host = (root as ShadowRoot).host;
  const def = host === undefined ? undefined : instances.get(host);
  if (def !== undefined) byEngine.set(engine, { host, def });
}

/**
 * A write at a bindable, under it, or its `$postUpdate`: `<tag>:<prop>-changed` from the
 * instance, with the written value as `detail` only for a data write of the member itself.
 */
export function dccWritten(engine: Engine, p: Pattern, value: unknown, direct: boolean): void {
  const info = byEngine.get(engine);
  if (info === undefined) return;
  const name = p.path.split(".", 1)[0];
  if (!info.def.bindables.includes(name)) return;
  const exact = direct && p.path === name;
  info.host.dispatchEvent(new CustomEvent(`${info.def.tag}:${name}-changed`, { detail: exact ? value : undefined, bubbles: true }));
}
