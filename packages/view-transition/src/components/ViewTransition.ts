import { ViewTransitionCore } from "../core/ViewTransitionCore.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { TransitionNaming } from "../protocol/transitionRunner.js";
import { IWcBindable, ReducedMotionPolicy, TransitionMode } from "../types.js";

function parseList(value: string | null): string[] {
  if (value === null) return [];
  return value.split(/\s+/).filter((token) => token !== "");
}

function toList(value: readonly string[] | string): string[] {
  return typeof value === "string" ? parseList(value) : [...value];
}

/**
 * `<wcs-view-transition>` — the page's view-transition policy node.
 *
 * It renders nothing and binds no data. It declares *how* the DOM changes that
 * `@wcstack/router` and `@wcstack/state` make should animate, and it is the single
 * arbiter that decides what happens when two of those changes collide. Dropping
 * the tag on a page is the opt-in; removing it restores the framework's original
 * synchronous behavior exactly (docs/view-transition-design.md §3, G1/G2).
 *
 * ```html
 * <wcs-view-transition for="router" mode="latest"></wcs-view-transition>
 * ```
 *
 * The animation itself is written in CSS against `::view-transition-*`. This tag
 * starts and arbitrates transitions; it never describes one.
 */
export class WcsViewTransition extends HTMLElement {
  static observedAttributes = [
    "mode", "naming", "naming-limit", "reduced-motion", "types", "disabled", "for",
  ];

  static wcBindable: IWcBindable = {
    ...ViewTransitionCore.wcBindable,
    inputs: [
      { name: "disabled", attribute: "disabled" },
      { name: "mode", attribute: "mode" },
      { name: "naming", attribute: "naming" },
      { name: "namingLimit", attribute: "naming-limit" },
      { name: "reducedMotion", attribute: "reduced-motion" },
      { name: "types", attribute: "types" },
      { name: "participants", attribute: "for" },
    ],
    // Inherited from the Core so a command added there cannot be missed here.
    commands: ViewTransitionCore.wcBindable.commands,
  };

  private _core: ViewTransitionCore;
  private _internals: ElementInternals | null = null;
  private _installed: boolean = false;

  constructor() {
    super();
    this._core = new ViewTransitionCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-view-transition:active-changed": (d) => ({ active: d === true }),
      "wcs-view-transition:error": (d) => ({ error: d != null }),
    });
  }

  /** The headless arbiter, for direct (non-DOM) use. */
  get core(): ViewTransitionCore {
    return this._core;
  }

  // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
  // wc-bindable. MUST NOT return the live CustomStateSet.
  get debugStates(): string[] {
    return this._internals ? [...this._internals.states] : [];
  }

  private _initInternals(): ElementInternals | null {
    // never-throw: attachInternals is absent in happy-dom / older environments,
    // and pre-125 Chromium rejects non-dashed state names (probed and discarded).
    try {
      if (typeof this.attachInternals !== "function") return null;
      const internals = this.attachInternals();
      internals.states.add("wcs-probe");
      internals.states.delete("wcs-probe");
      return internals;
    } catch {
      return null;
    }
  }

  private _wireStates(map: Record<string, (detail: any) => Record<string, boolean>>): void {
    if (this._internals === null) return;
    const states = this._internals.states;
    for (const [event, toStates] of Object.entries(map)) {
      this.addEventListener(event, (e) => {
        const debug = this.hasAttribute("debug-states");
        for (const [name, on] of Object.entries(toStates((e as CustomEvent).detail))) {
          try {
            if (on) { states.add(name); } else { states.delete(name); }
          } catch { /* never-throw */ }
          if (debug) this.toggleAttribute(`data-wcs-state-${name}`, on);
        }
      });
    }
  }

  // --- inputs ---

  get disabled(): boolean {
    return this._core.disabled;
  }

  set disabled(value: boolean) {
    this._core.disabled = value === true;
    this.toggleAttribute("disabled", value === true);
  }

  get mode(): TransitionMode {
    return this._core.mode;
  }

  set mode(value: TransitionMode) {
    this._core.mode = value;
  }

  get naming(): TransitionNaming {
    return this._core.naming;
  }

  set naming(value: TransitionNaming) {
    this._core.naming = value;
  }

  get namingLimit(): number {
    return this._core.namingLimit;
  }

  set namingLimit(value: number) {
    this._core.namingLimit = Number(value);
  }

  get reducedMotion(): ReducedMotionPolicy {
    return this._core.reducedMotion;
  }

  set reducedMotion(value: ReducedMotionPolicy) {
    this._core.reducedMotion = value;
  }

  get types(): readonly string[] {
    return this._core.types;
  }

  set types(value: readonly string[] | string) {
    this._core.types = toList(value);
  }

  get participants(): readonly string[] {
    return this._core.participants;
  }

  set participants(value: readonly string[] | string) {
    this._core.participants = toList(value);
  }

  // --- observable outputs ---

  get active(): boolean {
    return this._core.active;
  }

  get error(): Error | null {
    return this._core.error;
  }

  // --- commands ---

  skip(): void {
    this._core.skip();
  }

  // --- lifecycle ---

  connectedCallback(): void {
    upgradeProperties(this);
    this._syncAllAttributes();
    this._installed = this._core.install();
  }

  disconnectedCallback(): void {
    if (this._installed) {
      this._core.uninstall();
      this._installed = false;
    }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    this._applyAttribute(name, newValue);
  }

  /**
   * Apply the attributes present at connect time. Absent ones are deliberately
   * skipped rather than applied as null: a property assigned before upgrade
   * (Angular's `[prop]`, Lit's `.prop=`, or plain `el.mode = ...`) has just been
   * replayed through the setter by `upgradeProperties`, and re-applying a missing
   * attribute would immediately reset it to the default. Removing an attribute
   * still resets, via `attributeChangedCallback`.
   */
  private _syncAllAttributes(): void {
    for (const name of WcsViewTransition.observedAttributes) {
      const value = this.getAttribute(name);
      if (value === null) continue;
      this._applyAttribute(name, value);
    }
  }

  private _applyAttribute(name: string, value: string | null): void {
    switch (name) {
      case "mode":
        this._core.mode = (value ?? "latest") as TransitionMode;
        break;
      case "naming":
        this._core.naming = (value ?? "manual") as TransitionNaming;
        break;
      case "naming-limit":
        this._core.namingLimit = value === null ? Number.NaN : Number(value);
        break;
      case "reduced-motion":
        this._core.reducedMotion = (value ?? "skip") as ReducedMotionPolicy;
        break;
      case "types":
        this._core.types = parseList(value);
        break;
      case "disabled":
        this._core.disabled = value !== null;
        break;
      case "for":
        this._core.participants = parseList(value);
        break;
    }
  }
}
