import { IWcBindable } from "../types.js";
import { MediaQueryCore } from "../core/MediaQueryCore.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";

/**
 * `<wcs-media-query query="(prefers-color-scheme: dark)">` — declarative
 * `matchMedia` monitor.
 *
 * One attribute (`query`), three outputs (`matched` / `media` / `supported`),
 * no commands. Changing `query` while connected re-subscribes the Core to the
 * new MediaQueryList (docs/media-query-tag-design.md §7).
 */
export class WcsMediaQuery extends HTMLElement {
  // SSR (§4.4): observe() completes synchronously, but the Shell still exposes
  // connectedCallbackPromise so SSR (@wcstack/server render.ts) can await it
  // uniformly across all IO nodes before snapshotting the HTML.
  static hasConnectedCallbackPromise = true;

  static wcBindable: IWcBindable = {
    ...MediaQueryCore.wcBindable,
    // Shell-level settable surface: the media query string, mirrored to the
    // `query` attribute (idempotent reflect, so a binder writing through
    // inputs[].attribute is safe).
    inputs: [
      { name: "query", attribute: "query" },
    ],
    // Core の commands をそのまま継承（単一情報源）。network と同型。
    commands: MediaQueryCore.wcBindable.commands,
  };

  // `query` is the only attribute worth re-subscribing for; it is the whole
  // configuration of this node.
  static get observedAttributes(): string[] { return ["query"]; }

  private _core: MediaQueryCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new MediaQueryCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-media-query:change": (d) => ({
        matched: d.matched === true,
        supported: d.supported === true,
      }),
    });
  }

  // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
  // wc-bindable (not a bind target); see README "CSS styling with :state()".
  // MUST NOT return the live CustomStateSet (that would let callers write
  // states from outside, defeating the point of :state() being read-only).
  get debugStates(): string[] {
    return this._internals ? [...this._internals.states] : [];
  }

  private _initInternals(): ElementInternals | null {
    // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
    // in happy-dom / older environments, and pre-125 Chromium rejects
    // non-dashed state names from states.add() (probed and discarded here).
    // Either case silently disables reflection — the component still works,
    // it just doesn't expose :state() selectors.
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

  // --- Attribute accessors ---

  get query(): string {
    return this.getAttribute("query") ?? "";
  }

  set query(value: string) {
    this.setAttribute("query", value);
  }

  // --- Core delegated getters ---

  get matched(): boolean {
    return this._core.matched;
  }

  get media(): string {
    return this._core.media;
  }

  get supported(): boolean {
    return this._core.supported;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Lifecycle ---

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    // Re-subscribe on a live query change. Removing the attribute (newValue
    // null) is a real change too — it means "watch nothing", so `matched`
    // drops to false instead of lingering on the old query's value. Before
    // connect the attribute is simply read by connectedCallback.
    if (name === "query" && this.isConnected) {
      this._core.observe(newValue ?? "");
    }
  }

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
    this.style.display = "none";
    this._connectedCallbackPromise = this._core.observe(this.query);
  }

  disconnectedCallback(): void {
    this._core.dispose();
  }
}
