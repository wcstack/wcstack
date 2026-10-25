import { DefinedMode, IWcBindable } from "../types.js";
import { DefinedCore } from "../core/DefinedCore.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { reflectAttribute } from "../protocol/inputAttribute.js";
import { getCustomElementRegistry } from "../platform/customElementRegistry.js";

// Named WcsDefined (not `Defined`) to match the <wcs-permission> / <wcs-geo>
// convention (WcsPermission / WcsGeolocation) and avoid shadowing any global.
export class WcsDefined extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...DefinedCore.wcBindable,
    // Shell-level settable surface: what to watch and how. All three reflect
    // idempotently as plain attributes, so a binding system writing through
    // inputs[].attribute is safe.
    inputs: [
      { name: "tags", attribute: "tags" },
      { name: "mode", attribute: "mode" },
      { name: "timeout", attribute: "timeout" },
    ],
    // No commands: read-only monitor (see DefinedCore). whenDefined cannot be
    // triggered imperatively — it only observes.
    commands: [],
  };

  // Created with no tags so the delegated getters work before connect (returning
  // the defaults: defined=false, empty arrays, count/total 0). The actual watch is
  // driven from connectedCallback once the element's attributes resolve
  // (programmatically-created elements have no attributes at construction time).
  private _core: DefinedCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;
  // True between connectedCallback and disconnectedCallback: an attribute change
  // then re-watches. Before that (attributes set at upgrade, and the inputs
  // upgradeProperties replays) the connect-time observe() reads them anyway.
  private _watching: boolean = false;
  // _scheduleObserve のマイクロタスクが待っている間 true
  private _observePending: boolean = false;
  // 予約した見張りの connectedCallbackPromise を resolve する関数。マイクロタスクが
  // 見張りを始めると、その settle へつなぐ。外れたら disconnectedCallback が resolve する。
  private _resolveWatch: (() => void) | null = null;

  // tags / mode / timeout are live: binders write the property, which the setter
  // reflects, and a wc-bindable binder (@wcstack/state included) writes it after
  // the element has upgraded and connected.
  static get observedAttributes(): string[] { return ["tags", "mode", "timeout"]; }

  constructor() {
    super();
    this._core = new DefinedCore(undefined, "all", 0, this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-defined:change": (d) => ({ defined: d?.defined === true, error: d?.error != null }),
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

  get tags(): string {
    return this.getAttribute("tags") ?? "";
  }

  // The setters write the attribute through reflectAttribute (String(value)), and
  // the matching getter normalizes on read (mode: anything but "any" → "all";
  // tags: parsed/trimmed in _parseTags; timeout: non-negative finite or 0). They
  // never let setAttribute stringify null / undefined ("undefined" would be watched
  // as a tag name): `null` removes the attribute (the default), `undefined` restores
  // the attribute the element started with (wc-bindable producer guidance P1;
  // React 19 and a direct assignment deliver it, @wcstack/state does not).
  set tags(value: string | null | undefined) {
    reflectAttribute(this, "tags", value);
  }

  get mode(): DefinedMode {
    return this.getAttribute("mode") === "any" ? "any" : "all";
  }

  set mode(value: DefinedMode | null | undefined) {
    reflectAttribute(this, "mode", value);
  }

  get timeout(): number {
    // Normalize to a non-negative finite count of ms. `Number("abc")` → NaN and a
    // negative value both collapse to 0 (= "wait forever"), so a malformed or
    // negative `timeout` attribute can never silently become an infinite wait via
    // an unexpected path; 0 is the documented no-limit sentinel.
    const ms = Number(this.getAttribute("timeout"));
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  set timeout(value: number | null | undefined) {
    reflectAttribute(this, "timeout", value);
  }

  // --- Core delegated getters ---

  get defined(): boolean {
    return this._core.defined;
  }

  get pending(): string[] {
    return this._core.pending;
  }

  get missing(): string[] {
    return this._core.missing;
  }

  get count(): number {
    return this._core.count;
  }

  get total(): number {
    return this._core.total;
  }

  get error(): string | null {
    return this._core.error;
  }

  // wc-bindable connectedCallbackPromise protocol: resolves once the connect-time
  // watch settles, so SSR (@wcstack/server render.ts) waits for readiness before
  // snapshotting the HTML. Mirrors WcsPermission.connectedCallbackPromise.
  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Internal ---

  // Parse the comma-separated `tags` attribute into trimmed, non-empty tag names.
  private _parseTags(): string[] {
    return this.tags.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
    this.style.display = "none";
    // Begin the watch (or revive it after a reconnect) — in the microtask of
    // _scheduleObserve, with the inputs as they are then.
    this._watching = true;
    this._scheduleObserve();
  }

  disconnectedCallback(): void {
    this._watching = false;
    this._core.dispose();
    // 予約した見張りの promise を resolve する — マイクロタスクより先に外れても、
    // await した側は止まらない（Fetch の connectedCallbackPromise と同じ）。
    this._resolveWatch?.();
    this._resolveWatch = null;
  }

  // A changed tags / mode / timeout on a connected element restarts the watch with
  // the new configuration (the Core re-watches only after a dispose()). The restart
  // goes through the same microtask as the connect-time watch, so several inputs
  // written in one task restart it once.
  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (!this._watching || oldValue === newValue) return;
    this._scheduleObserve();
  }

  // 見張りの開始はマイクロタスクで、そのときの tags / mode / timeout で 1 回だけ行う
  // （timing-and-firing-contract §23）。router は遷移で同じノードを入れ直し、新しいルートの
  // params から state が入力を書くのはマイクロタスク — その場で見張ると、前の tags で
  // `wcs-defined:change` を出し、connectedCallbackPromise も前の見張りのものになっていた
  // （docs/seam-apps.md、shift-desk）。判断の前に外れた要素は何もしない。
  //
  // connectedCallbackPromise は予約の時点で差し替える（見張り直しのたびに新しい promise —
  // 以前の同期の _observe() と同じ）。マイクロタスクが始めた見張りが settle すると resolve する。
  private _scheduleObserve(): void {
    if (this._resolveWatch === null) {
      this._connectedCallbackPromise = new Promise<void>((resolve) => {
        this._resolveWatch = resolve;
      });
    }
    if (this._observePending) return;
    this._observePending = true;
    queueMicrotask(() => {
      this._observePending = false;
      const resolve = this._resolveWatch;
      this._resolveWatch = null;
      // 外れていれば disconnectedCallback が resolve を済ませている
      if (!this._watching || resolve === null) return;
      this._core.dispose();
      // whenDefined failures surface as `missing` / `error` state — never as a
      // throw — so no .catch() is needed. Gate on the registry this element's own
      // subtree resolves against: with a scoped registry the same tag name means a
      // different definition per tree, so watching the global one would report
      // readiness this tree cannot use.
      this._core.observe(
        this._parseTags(),
        this.mode,
        this.timeout,
        getCustomElementRegistry(this),
      ).then(resolve);
    });
  }
}
