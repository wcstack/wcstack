/**
 * The places the core calls into add-ons (docs/state-engine-rewrite/addons-plan.ja.md §1.2).
 *
 * Add-ons ship as separate entries of the same build as the core (`features/*`): they reach
 * the core's internals directly, and the core only calls out through these slots. A slot is
 * empty until an installed feature fills it (the object starts with none: a list of null slots
 * would be the core's bytes), so a page without the feature pays one `?.` check. A feature
 * restoring a slot may set it to null.
 * Slots are added with the first feature that needs them; several features share one through
 * chain / first. The slots `element` and `detail` keep their names (a DevTools-facing field and a DOM
 * name share them); the others are shortened by the build. An empty slot is read through
 * Object.prototype: a page that polluted it (a value under `element`, say) breaks the core loudly
 * there, as it does wherever the core reads a plain object's keys (`$behavior`); not defended.
 */
import type { Engine } from "./engine";
import type { Pattern } from "./pattern";
import type { StateList, StateRow } from "./list";
import type { Binding, RowPlan, Spec } from "./dom/view";

export interface Hooks {
  /** Diagnostics: extra text for an error message (did-you-mean, lint pointer, how to fix). */
  explain?: ((message: string, subject?: string, candidates?: Iterable<string>) => string) | null;
  /** Diagnostics: the full sentence of a numbered core message (`src/messages.ts`). */
  render?: ((id: number, args: readonly unknown[]) => string) | null;
  /**
   * A write before it is applied (`element`: an element wrote it back, not code); true = the
   * add-on handled it ($listKeys, a read-only mount dropping an element's write).
   */
  beforeWrite?: ((engine: Engine, p: Pattern, row: StateRow | null, value: unknown, element: boolean) => boolean) | null;
  /** A write landed: `direct` for a data write (then `old` is the value before, `value` the new one). */
  written?: ((engine: Engine, p: Pattern, row: StateRow | null, old: unknown, value: unknown, direct: boolean) => void) | null;
  /** A change reached a getter occurrence whose cached value was current (it may now differ). */
  getterReached?: ((engine: Engine, g: Pattern, row: StateRow | null) => void) | null;
  /** A list was reconciled with a new value; `old` are its rows before. */
  listSynced?: ((engine: Engine, list: StateList, old: StateRow[]) => void) | null;
  /** A drain ended (after its report and `$renderedCallback`). */
  drained?: ((engine: Engine) => void) | null;
  /** A state object was received (construction, or a re-set before it replaces the old one). */
  declare?: ((engine: Engine, target: Record<string, any>) => void) | null;
  /**
   * A root engine's lifecycle: "mounting" (created, its page not bound yet), "connected"
   * (after `$connectedCallback`, and on reconnect), "disconnected", "reset" (after a re-set).
   */
  element?: ((engine: Engine, phase: "mounting" | "connected" | "disconnected" | "reset") => void) | null;
  /**
   * A `<wcs-state>` an add-on takes over instead of it becoming a root (a volume, a DCC
   * definition): asked when it connects; the core then only loads its state.
   */
  claim?: ((el: HTMLElement, root: Node) => Claimed | null) | null;
  /** A `$` name the core does not know. */
  dollar?: ((engine: Engine, key: string) => unknown) | null;
  /** A binding failed to apply (reported after the drain, before `$errorCallback` / the console). */
  failed?: ((engine: Engine, error: unknown, binding: Binding) => void) | null;
  /**
   * A plain property binding on a custom element, made and not yet registered or applied (a
   * component mount's wiring, `state.x: path`); true = an add-on took it over.
   */
  hostBinding?: ((binding: Binding, ro: boolean) => boolean) | null;
  /** An element whose content an add-on binds (a Light DOM component): the walker leaves it. */
  componentScope?: ((el: Element) => boolean) | null;
  /**
   * The page walker replaced a structural template with its anchor (`source` is the template),
   * bound a mustache text node (`source` is its expression), or is about to bind an element
   * (`source` is its specs, which the hook may take some out of): SSR records the first two, and
   * on the server leaves `outerHTML:` to the client.
   */
  ssrMark?: ((engine: Engine, node: Node, source: Element | string | Spec[]) => void) | null;
  /**
   * A block is about to be cloned from `plan` for the view anchored at `anchor`: an add-on may
   * hand over existing nodes instead (SSR hydration) — a fragment, or the single element.
   */
  adopt?: ((plan: RowPlan, anchor: Node, isFor: boolean) => Node | null) | null;
  /**
   * A Light DOM component's engine is about to bind `root` (its host): SSR hands over the server's
   * nodes there too; the function returned is called when the walk is done.
   */
  adoptScope?: ((root: Node) => (() => void) | null) | null;
  /** A path a binding (or, with `watch`, a `$watch` key) names: diagnostics checks it exists. */
  declared?: ((engine: Engine, p: Pattern, watch?: boolean) => void) | null;
  /** `<wcs-state>` was defined in `registry`: an add-on defines its own tags there (`<wcs-ssr>`). */
  tags?: ((registry: CustomElementRegistry) => void) | null;
  /** A wc-bindable property's event read with the default getter (`e.detail`): diagnostics checks its shape. */
  detail?: ((el: Element, name: string, detail: unknown) => void) | null;
  /** The split auto entry: loads and installs add-ons of its build by name (a state's `$features`). */
  load?: ((names: string[]) => Promise<void>) | null;
  /**
   * An event an add-on reports for the DevTools protocol (a `$watch` handler fired or threw, a
   * `$watch` chain cut, a path that does not resolve): `event` is the protocol's payload, its keys
   * quoted (`{ "type": "state:watch-fired", "path": … }`). Called as `hooks.noticed?.(engine, {…})`,
   * the payload is built only while the slot is filled.
   */
  noticed?: ((engine: Engine, event: Record<string, unknown>) => void) | null;
}

/** What an add-on does with a `<wcs-state>` it claimed. */
export interface Claimed {
  /** Where the state comes from, when not from the element's own sources. */
  load?(): Promise<Record<string, any>>;
  /** The loaded state; `connectedCallbackPromise` resolves when this settles (a failure is the add-on's to report). */
  start(state: Record<string, any>): Promise<void> | void;
  connected(): void;
  disconnected(): void;
  /** `setInitialState` after the start. */
  reset(state: Record<string, any>): void;
}

export const hooks: Hooks = {};

type HookFn = (...args: any[]) => any;

/*
 * A feature fills a slot by assigning it (`hooks.written = chain(hooks.written, fn)`), never by
 * its name as a string: the slot names are shortened by the build (mangle.mjs) like any internal
 * property.
 */

/** A slot several features share: `fn` runs after whatever is there. */
export function chain<F extends HookFn>(prev: F | null | undefined, fn: F): F {
  return prev == null ? fn : ((...a: unknown[]) => { prev(...a); fn(...a); }) as F;
}

/** A slot whose first answer wins (`answered` tells one): `fn` is asked when what is there does not answer. */
export function first<F extends HookFn>(answered: (r: unknown) => boolean, prev: F | null | undefined, fn: F): F {
  return prev == null ? fn : ((...a: unknown[]) => { const r = prev(...a); return answered(r) ? r : fn(...a); }) as F;
}

/** `beforeWrite`: the first feature that handles the write. */
export const handled = (r: unknown): boolean => r === true;
/** `dollar`: the first feature that knows the `$` name (a value, possibly null or false). */
export const known = (r: unknown): boolean => r !== undefined;
/** `claim`: the first feature that takes the `<wcs-state>`. */
export const taken = (r: unknown): boolean => r != null;

/** An add-on entry: `installFeatures([temporal, diagnostics])` before the state is defined. */
export interface Feature {
  readonly name: string;
  install(): void;
}

const installed = new Set<string>();

export function installFeatures(features: readonly Feature[]): void {
  for (const f of features) {
    if (installed.has(f.name)) continue;
    installed.add(f.name);
    f.install();
  }
}

/**
 * A state's `$features` before its engine is made: the missing add-ons, loaded where an entry can
 * load them (`hooks.load`); undefined when there is nothing to wait for. The engine then checks
 * every name (a bundle or the full build only checks).
 */
export function loadFeatures(state: Record<string, any>): Promise<void> | undefined {
  const names = state.$features;
  if (hooks.load != null && Array.isArray(names)) {
    const missing = names.filter((n) => !installed.has(n));
    if (missing.length > 0) return hooks.load(missing);
  }
}

/** The barrier: a declaration that needs a feature the page did not install. */
export function requireFeature(feature: string, what: string): void {
  if (!installed.has(feature)) {
    throw new Error(`[@wcstack/state] [wcs/feature-not-installed] ${what} needs the add-on @wcstack/state/features/${feature}`);
  }
}
