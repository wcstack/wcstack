import { ViewTransitionCore } from "../core/ViewTransitionCore.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { reflectAttribute, reflectBooleanAttribute } from "../protocol/inputAttribute.js";
import { TransitionNaming } from "../protocol/transitionRunner.js";
import { IWcBindable, ReducedMotionPolicy, TransitionMode } from "../types.js";

/**
 * A token-list input (`types`, `participants`) as its attribute value: the array
 * form joins with spaces, which is exactly what the Core splits a string on.
 * `null` / `undefined` pass through for the reflect helper to interpret.
 */
function tokenListAttribute(value: readonly string[] | string | null | undefined): string | null | undefined {
  if (value == null || typeof value === "string") return value;
  return [...value].join(" ");
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

  // `properties` and `commands` come from the Core through the spread, so a
  // member added there cannot be missed here. Only `inputs` — the attribute
  // surface, which exists on the element and not on the Core — is declared.
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
  //
  // Every input setter writes its attribute, and the attribute is what reaches
  // the Core (`_applyAttribute`), so the attribute and the Core never disagree:
  // a property write survives a reconnect (`_syncAllAttributes` re-applies the
  // attribute, which now holds it) and outlives an authored attribute when it was
  // assigned before upgrade. `null` removes the attribute (the documented default)
  // and `undefined` restores the attribute the element started with (wc-bindable
  // producer guidance P1; React 19 and a direct assignment deliver it,
  // @wcstack/state does not). Neither is ever written as "null" / "undefined".
  // The getters keep returning the Core's parsed value.

  get disabled(): boolean {
    return this._core.disabled;
  }

  set disabled(value: boolean | null | undefined) {
    // Only `true` disables, as before; any other value (null included) enables.
    reflectBooleanAttribute(this, "disabled", value === undefined ? undefined : value === true);
    this._applyFromAttribute("disabled");
  }

  get mode(): TransitionMode {
    return this._core.mode;
  }

  set mode(value: TransitionMode | null | undefined) {
    reflectAttribute(this, "mode", value);
    this._applyFromAttribute("mode");
  }

  get naming(): TransitionNaming {
    return this._core.naming;
  }

  set naming(value: TransitionNaming | null | undefined) {
    reflectAttribute(this, "naming", value);
    this._applyFromAttribute("naming");
  }

  get namingLimit(): number {
    return this._core.namingLimit;
  }

  set namingLimit(value: number | null | undefined) {
    reflectAttribute(this, "naming-limit", value);
    this._applyFromAttribute("naming-limit");
  }

  get reducedMotion(): ReducedMotionPolicy {
    return this._core.reducedMotion;
  }

  set reducedMotion(value: ReducedMotionPolicy | null | undefined) {
    reflectAttribute(this, "reduced-motion", value);
    this._applyFromAttribute("reduced-motion");
  }

  get types(): readonly string[] {
    return this._core.types;
  }

  set types(value: readonly string[] | string | null | undefined) {
    reflectAttribute(this, "types", tokenListAttribute(value));
    this._applyFromAttribute("types");
  }

  get participants(): readonly string[] {
    return this._core.participants;
  }

  set participants(value: readonly string[] | string | null | undefined) {
    reflectAttribute(this, "for", tokenListAttribute(value));
    this._applyFromAttribute("for");
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
      // dispose(), not uninstall(): a mutation already handed to this arbiter must
      // still be applied even though the page just removed its policy tag.
      this._core.dispose();
      this._installed = false;
    }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    this._applyAttribute(name, newValue);
  }

  /**
   * Apply the attributes present at connect time. A property assigned before
   * upgrade (Angular's `[prop]`, Lit's `.prop=`, or plain `el.mode = ...`) has just
   * been replayed through the setter by `upgradeProperties`, which wrote it to the
   * attribute, so what is applied here already includes it. Absent ones are skipped
   * rather than applied as null, so a value set on the Core directly (`el.core`)
   * is not reset by a reconnect. Removing an attribute still resets, via
   * `attributeChangedCallback`.
   */
  private _syncAllAttributes(): void {
    for (const name of WcsViewTransition.observedAttributes) {
      const value = this.getAttribute(name);
      if (value === null) continue;
      this._applyAttribute(name, value);
    }
  }

  /**
   * Carry an attribute a setter has just written to the Core. When the write
   * changed the attribute, `attributeChangedCallback` has already done this;
   * repeating it is harmless, and it covers a write that left the attribute as it
   * was while the Core had been set to something else through `el.core`.
   */
  private _applyFromAttribute(name: string): void {
    this._applyAttribute(name, this.getAttribute(name));
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
        this._core.types = value ?? "";
        break;
      case "disabled":
        this._core.disabled = value !== null;
        break;
      case "for":
        this._core.participants = value ?? "";
        break;
    }
  }
}
