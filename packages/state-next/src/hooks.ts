/**
 * The places the core calls into add-ons (docs/state-engine-rewrite/addons-plan.ja.md §1.2).
 *
 * Add-ons ship as separate entries of the same build as the core (`features/*`): they reach
 * the core's internals directly, and the core only calls out through these slots. A slot is
 * null until an installed feature fills it, so a page without the feature pays one null check.
 * Slots are added with the first feature that needs them; several features share one through
 * addHook.
 */
import type { Engine } from "./engine";
import type { Pattern } from "./pattern";
import type { StateList, StateRow } from "./list";
import type { Binding, RowPlan } from "./dom/view";

export interface Hooks {
  /** Diagnostics: extra text for an error message (did-you-mean, lint pointer, how to fix). */
  explain: ((message: string, subject?: string, candidates?: Iterable<string>) => string) | null;
  /** A write before it is applied; true = the add-on handled it ($listKeys, read-only paths). */
  beforeWrite: ((engine: Engine, p: Pattern, row: StateRow | null, value: unknown) => boolean) | null;
  /** A write landed: `direct` for a data write (then `old` is the value before, `value` the new one). */
  written: ((engine: Engine, p: Pattern, row: StateRow | null, old: unknown, value: unknown, direct: boolean) => void) | null;
  /** A change reached a getter occurrence whose cached value was current (it may now differ). */
  getterReached: ((engine: Engine, g: Pattern, row: StateRow | null) => void) | null;
  /** A list was reconciled with a new value; `old` are its rows before. */
  listSynced: ((engine: Engine, list: StateList, old: StateRow[]) => void) | null;
  /** A drain ended (after its report and `$renderedCallback`). */
  drained: ((engine: Engine) => void) | null;
  /** A state object was received (construction, or a re-set before it replaces the old one). */
  declare: ((engine: Engine, target: Record<string, any>) => void) | null;
  /**
   * A root engine's lifecycle: "mounting" (created, its page not bound yet), "connected"
   * (after `$connectedCallback`, and on reconnect), "disconnected", "reset" (after a re-set).
   */
  element: ((engine: Engine, phase: "mounting" | "connected" | "disconnected" | "reset") => void) | null;
  /**
   * A `<wcs-state>` an add-on takes over instead of it becoming a root (a volume, a DCC
   * definition): asked when it connects; the core then only loads its state.
   */
  claim: ((el: HTMLElement, root: Node) => Claimed | null) | null;
  /** A `$` name the core does not know. */
  dollar: ((engine: Engine, key: string) => unknown) | null;
  /** A binding failed to apply (reported after the drain, before `$errorCallback` / the console). */
  failed: ((engine: Engine, error: unknown, binding: Binding) => void) | null;
  /**
   * A plain property binding on a custom element, made and not yet registered or applied (a
   * component mount's wiring, `state.x: path`); true = an add-on took it over.
   */
  hostBinding: ((binding: Binding) => boolean) | null;
  /** An element whose content an add-on binds (a Light DOM component): the walker leaves it. */
  componentScope: ((el: Element) => boolean) | null;
  /**
   * The page walker replaced a structural template with its anchor (`source` is the template),
   * or bound a mustache text node (`source` is its expression): SSR records both.
   */
  ssrMark: ((engine: Engine, node: Node, source: Element | string) => void) | null;
  /**
   * A block is about to be cloned from `plan` for the view anchored at `anchor`: an add-on may
   * hand over existing nodes instead (SSR hydration) — a fragment, or the single element.
   */
  adopt: ((plan: RowPlan, anchor: Node, isFor: boolean) => Node | null) | null;
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

export const hooks: Hooks = {
  explain: null,
  claim: null,
  beforeWrite: null,
  written: null,
  getterReached: null,
  listSynced: null,
  drained: null,
  declare: null,
  element: null,
  dollar: null,
  failed: null,
  hostBinding: null,
  componentScope: null,
  ssrMark: null,
  adopt: null,
};

type HookFn = (...args: any[]) => any;

/**
 * Adds `fn` to a slot, after whatever is there. For `beforeWrite` the first that handles the
 * write wins; for `dollar` / `claim` the first answer (not undefined / not null) wins.
 */
export function addHook<K extends keyof Hooks>(name: K, fn: NonNullable<Hooks[K]>): void {
  const prev = hooks[name] as HookFn | null;
  const answered = name === "beforeWrite" ? (r: unknown) => r === true
    : name === "dollar" ? (r: unknown) => r !== undefined
    : name === "claim" ? (r: unknown) => r !== null
    : null;
  hooks[name] = (prev === null
    ? fn
    : answered !== null
      ? (...a: unknown[]) => { const r = prev(...a); return answered(r) ? r : (fn as HookFn)(...a); }
      : (...a: unknown[]) => { prev(...a); (fn as HookFn)(...a); }) as Hooks[K];
}

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

/** The barrier: a declaration that needs a feature the page did not install. */
export function requireFeature(feature: string, what: string): void {
  if (!installed.has(feature)) {
    throw new Error(`[@wcstack/state] [wcs/feature-not-installed] ${what} needs the add-on @wcstack/state/features/${feature}`);
  }
}
