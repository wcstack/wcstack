import { IWcBindable, PermissionStateOrUnsupported, WcsPermissionDescriptor } from "../types.js";
import { PermissionCore } from "../core/PermissionCore.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { reflectAttribute, reflectBooleanAttribute } from "../protocol/inputAttribute.js";

// 張られた deferred が無いときの _connectResolve（呼んでも何もしない）
const nothingArmed = (): void => { /* nothing armed */ };

// Named WcsPermission (not `Permission`) so the class does not shadow any global,
// and to match the <wcs-geo> / <wcs-ws> convention (WcsGeolocation /
// WcsWebSocket). The public export keeps the `WcsPermission` name unchanged.
export class WcsPermission extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...PermissionCore.wcBindable,
    // Shell-level settable surface. `name` is the permission name; the descriptor
    // extras `user-visible-only` (push) and `sysex` (midi) are boolean flags that
    // reflect idempotently, so a binding system that writes through
    // inputs[].attribute is safe.
    inputs: [
      { name: "name", attribute: "name" },
      { name: "userVisibleOnly", attribute: "user-visible-only" },
      { name: "sysex", attribute: "sysex" },
    ],
    // No commands: read-only monitor (see PermissionCore). The Permissions API has
    // no request() — acquiring a grant is the feature node's job.
    commands: [],
  };

  // Created in the Shell constructor with no descriptor so the delegated getters
  // work before connect (returning the default "prompt" / false). The actual
  // query is driven from connectedCallback once the element's attributes resolve
  // (programmatically-created elements have no attributes at construction time).
  private _core: PermissionCore;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  // _scheduleObserve のマイクロタスクが待っている間 true
  private _observePending = false;
  // connectedCallback で張った connectedCallbackPromise を解決する関数。
  // マイクロタスク（の query の決着）か disconnectedCallback が解決する
  private _connectResolve: () => void = nothingArmed;
  private _internals: ElementInternals | null = null;

  constructor() {
    super();
    this._core = new PermissionCore(null, this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-permission:change": (d) => ({
        granted: d === "granted",
        denied: d === "denied",
        prompt: d === "prompt",
        unsupported: d === "unsupported",
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
  // Input setters never let setAttribute stringify null / undefined (an
  // "undefined" name would query a permission called "undefined"): `null`
  // removes the attribute (the default), `undefined` restores the attribute the
  // element started with (wc-bindable producer guidance P1; React 19 and a
  // direct assignment deliver it, @wcstack/state does not).

  get name(): string {
    return this.getAttribute("name") ?? "";
  }

  set name(value: string | null | undefined) {
    reflectAttribute(this, "name", value);
  }

  get userVisibleOnly(): boolean {
    return this.hasAttribute("user-visible-only");
  }

  set userVisibleOnly(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "user-visible-only", value);
  }

  get sysex(): boolean {
    return this.hasAttribute("sysex");
  }

  set sysex(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "sysex", value);
  }

  // --- Core delegated getters ---

  get state(): PermissionStateOrUnsupported {
    return this._core.state;
  }

  get granted(): boolean {
    return this._core.granted;
  }

  get denied(): boolean {
    return this._core.denied;
  }

  get prompt(): boolean {
    return this._core.prompt;
  }

  get unsupported(): boolean {
    return this._core.unsupported;
  }

  // wc-bindable connectedCallbackPromise protocol: resolves once the connect-time
  // query settles, so SSR (@wcstack/server render.ts) waits for the first probe
  // before snapshotting the HTML. Mirrors WcsGeolocation.connectedCallbackPromise.
  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Internal ---

  // Build the query descriptor from the current attributes. Only present extras
  // are included so a bare `{ name }` is passed for permissions that take no
  // additional members. The descriptor is fixed at connect time (v1 does not
  // re-query on a `name` change — see README).
  private _descriptor(): WcsPermissionDescriptor {
    const descriptor: WcsPermissionDescriptor = { name: this.name };
    if (this.userVisibleOnly) descriptor.userVisibleOnly = true;
    if (this.sysex) descriptor.sysex = true;
    return descriptor;
  }

  // 何を query するか（name / user-visible-only / sysex）はマイクロタスクで、そのときの
  // 入力で 1 回だけ決める（timing-and-firing-contract §23）。router は遷移で同じノードを
  // 入れ直し、新しいルートの params から state が name を書くのはマイクロタスク — その場で
  // query すると、前の name の state を公開し、その購読に留まっていた（docs/seam-apps.md、
  // shift-desk）。その時点で外れていれば何もしない。
  private _scheduleObserve(): void {
    if (this._observePending) return;
    this._observePending = true;
    queueMicrotask(() => {
      this._observePending = false;
      const resolveConnect = this._connectResolve;
      this._connectResolve = nothingArmed;
      if (!this.isConnected) {
        resolveConnect();
        return;
      }
      // Begin observing (or revive the subscription after a reconnect). query()
      // never rejects in a way that escapes — failures surface as the
      // `unsupported` state — so no .catch() is needed.
      void this._core.observe(this._descriptor()).then(resolveConnect);
    });
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
    this.style.display = "none";
    // connectedCallbackPromise (SSR) resolves once the connect-time query settles.
    // The query itself is decided in a microtask (_scheduleObserve), so arm a
    // deferred here; the microtask resolves it on every path, and so does
    // disconnectedCallback, so awaiting it never hangs.
    this._connectedCallbackPromise = new Promise<void>((resolve) => {
      this._connectResolve = resolve;
    });
    this._scheduleObserve();
  }

  disconnectedCallback(): void {
    this._core.dispose();
    // 同じタスクの remove() → append() では 2 回目の connectedCallback が
    // _connectResolve を上書きし、1 回目の deferred を待つ側が残される。外れた時点で
    // 接続時の初期化は意味を失うので、ここで解決する（Fetch.ts と同じ）。
    this._connectResolve();
    this._connectResolve = nothingArmed;
  }
}
