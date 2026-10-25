import { config } from "../config.js";
import { STORAGE_EVENTS } from "../events.js";
import { IWcBindable, StorageType } from "../types.js";
import { StorageCore } from "../core/StorageCore.js";
import { WcsIoErrorInfo } from "../core/platformCapability.js";
import { registerAutoTrigger } from "../autoTrigger.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { reflectAttribute, reflectBooleanAttribute } from "../protocol/inputAttribute.js";

export class Storage extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...StorageCore.wcBindable,
    properties: [
      ...StorageCore.wcBindable.properties,
      { name: "trigger", event: STORAGE_EVENTS.triggerChanged, semantics: "state" },
    ],
    // Shell-level input surface. The Core declares only the portable `key` / `type`;
    // the Shell adds the DOM-driven settable surface. No `attribute` hints are given:
    // the `key` / `type` / `manual` setters reflect to their attributes themselves, and a
    // binding system that mirrored inputs[].attribute (@wcstack/state 3.x) would set the
    // attribute twice (`value` / `trigger` are not attribute-backed). `commands` (load / save / remove)
    // are inherited unchanged from the Core via the spread above.
    inputs: [
      { name: "key" },
      { name: "storageKey" },
      { name: "type" },
      { name: "value" },
      { name: "manual" },
      { name: "trigger" },
    ],
  };
  static get observedAttributes(): string[] { return ["key", "storage-key", "type"]; }

  private _core: StorageCore;
  private _trigger: boolean = false;
  // Storage load()/save() are synchronous, so connection work never defers.
  // This stays an already-resolved Promise for the whole lifecycle; it exists
  // only to satisfy the `hasConnectedCallbackPromise` protocol (consumers may
  // `await el.connectedCallbackPromise`). connectedCallback intentionally does
  // not reassign it — there is nothing async to wait for, unlike <wcs-fetch>.
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;
  // connectedCallback ran before (a reconnect defers its load: _scheduleLoad)
  private _everConnected = false;
  // _scheduleLoad's microtask is waiting
  private _loadPending = false;

  constructor() {
    super();
    this._core = new StorageCore(this);
    this._internals = this._initInternals();
    this._wireStates({
      [STORAGE_EVENTS.loadingChanged]: (d) => ({ loading: d === true }),
      [STORAGE_EVENTS.error]:          (d) => ({ error: d != null }),
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

  // Push the Shell's current attribute-derived key / type down into the Core.
  // Every operation (load / save / remove / value setter) and every lifecycle
  // hook that may run a Core operation or cross-tab sync must do this first, so
  // the Core never acts on a stale key / type. Centralizing it here avoids the
  // previous pattern of repeating `_core.key = …; _core.type = …;` at each call
  // site, which risked a future call site forgetting one of the two.
  private _syncCore(): void {
    this._core.key = this.key;
    this._core.type = this.type;
  }

  // Input setters never let setAttribute stringify null / undefined (a "null" /
  // "undefined" key would load and save under that literal key): `null` removes
  // the attribute (the default), `undefined` restores the attribute the element
  // started with (wc-bindable producer guidance P1; React 19 and a direct
  // assignment deliver it, @wcstack/state does not).
  get key(): string {
    return this.getAttribute("key") || this.getAttribute("storage-key") || "";
  }

  set key(value: string | null | undefined) {
    reflectAttribute(this, "key", value);
  }

  // `key` under another name. React and Vue take `key` for themselves and never hand it to
  // the element, so `<wcs-storage key="…">` in JSX or a Vue template stored nothing, with no
  // error (docs/seam-apps.md, fw-inventory). `storage-key` reaches the element in both;
  // `key` wins when both are written.
  get storageKey(): string {
    return this.key;
  }

  set storageKey(value: string | null | undefined) {
    reflectAttribute(this, "storage-key", value);
  }

  get type(): StorageType {
    // Normalize at the Shell boundary: any attribute value other than the
    // exact "session" falls back to "local". This keeps an invalid attribute
    // (e.g. type="foo") from reaching the Core's validating setter and throwing
    // out of setAttribute / connectedCallback.
    return this.getAttribute("type") === "session" ? "session" : "local";
  }

  set type(value: StorageType | null | undefined) {
    reflectAttribute(this, "type", value);
  }

  // The type attribute last warned about (once per value).
  private _warnedType: string | null = null;

  // A type attribute that is neither "local" nor "session" falls back to "local" (the getter above).
  // Say so: data meant for the session would otherwise be kept on disk without a word
  // (docs/mistake-catalogue.md, "storage-type-typo").
  private _checkType(): void {
    const type = this.getAttribute("type");
    if (type === null || type === "" || type === "local" || type === "session" || type === this._warnedType) return;
    this._warnedType = type;
    console.warn(
      `[@wcstack/storage] [wcs/storage-type-invalid] <${config.tagNames.storage} type="${type}"> is neither ` +
      `"local" nor "session": it uses localStorage, so the data is kept after the session ends.`,
    );
  }

  get value(): any {
    return this._core.value;
  }

  set value(v: any) {
    // `undefined` is "no value supplied" (wc-bindable producer guidance P1; React 19
    // and a direct assignment deliver it, @wcstack/state does not): a no-op in both
    // modes, so the stored entry is kept and nothing is staged. `null` still clears —
    // it removes the key (non-manual) or stages null (manual).
    if (v === undefined) return;
    // Non-manual mode: assigning `value` auto-saves the *assigned* argument `v`
    // (write-through). Note this differs from save()/trigger, which persist the
    // *current* `_core.value` (which load() or a cross-tab `storage` event may
    // have updated). See README "Design Notes" for the rationale.
    //
    // Manual mode: assigning `value` does NOT persist — it only stages the value
    // into the Core (no storage write). This keeps the getter/setter consistent
    // (`el.value = x; el.value === x`) and lets a later save()/trigger commit the
    // staged value, so a `value: …` + `trigger: …` binding pair works as
    // documented. The actual write still happens only via save()/trigger.
    if (!this.manual) {
      this._syncCore();
      this._core.save(v);
    } else {
      this._core.value = v;
    }
  }

  get loading(): boolean {
    return this._core.loading;
  }

  get error(): any {
    return this._core.error;
  }

  get errorInfo(): WcsIoErrorInfo | null {
    return this._core.errorInfo;
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean | null | undefined) {
    reflectBooleanAttribute(this, "manual", value);
  }

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    const v = !!value;
    if (v) {
      this._trigger = true;
      // save() is never-throw (a failure — e.g. key unset — is routed to the
      // `error` property, not thrown), but the try/finally is kept defensively
      // to guarantee the trigger resets to false and the completion event fires
      // even in the unexpected event of a throw, so the trigger never gets stuck
      // in the `true` state.
      try {
        this.save();
      } finally {
        this._trigger = false;
        this.dispatchEvent(new CustomEvent(STORAGE_EVENTS.triggerChanged, {
          detail: false,
          bubbles: true,
        }));
      }
    }
  }

  load(): any {
    this._syncCore();
    return this._core.load();
  }

  // The `save` command differs in arity between the two CSBC surfaces:
  // - Core:  save(value)  — caller supplies the value to persist
  // - Shell: save()       — persists the current `_core.value` (no argument)
  // Both are exposed under the same `commands` entry name "save". The protocol
  // `commands` list is descriptive metadata only and carries no arity, so this
  // is not a protocol violation; the difference is contractual and documented
  // in the README ("Design Notes").
  save(): void {
    this._syncCore();
    this._core.save(this._core.value);
  }

  remove(): void {
    this._syncCore();
    this._core.remove();
  }

  attributeChangedCallback(name: string, _oldValue: string | null, _newValue: string | null): void {
    if (!this.isConnected) return;
    // `storage-key` is the same input under a name the frameworks leave alone; `key` wins
    // when both are written (the getter), so a change to the other one changes nothing.
    if (name === "storage-key" && this.getAttribute("key")) return;
    if (name === "key" || name === "storage-key") {
      // Always keep the Core's key in sync with the attribute, regardless of
      // mode or whether the new value is empty. The cross-tab `storage` listener
      // compares `e.key !== _core.key`, so a stale Core key would make sync watch
      // the wrong (old/empty) key after a runtime key change. load() (which also
      // syncs the Core) only runs for non-manual mode with a non-empty key — the
      // key now in effect, so removing `key` falls back to `storage-key`.
      this._syncCore();
      // a reconnect's load is waiting for its microtask: it reads the key in effect then
      if (this.key && !this.manual && !this._loadPending) {
        this.load();
      }
    }
    if (name === "type") {
      // Route through the normalizing getter so an invalid attribute value
      // (e.g. type="foo") falls back to "local" instead of throwing.
      this._checkType();
      this._syncCore();
    }
  }

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
    this.style.display = "none";
    this._checkType();
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    if (!this._everConnected) {
      // The first connect loads at once: a binding attached in the same task (a route's content
      // handed to @wcstack/state right after its insertion) pulls `value` and expects it loaded.
      this._everConnected = true;
      if (!this.manual && this.key) {
        this.load();
      }
    } else {
      // A reconnect decides in a microtask, with the key then (timing-and-firing-contract §23).
      // @wcstack/router puts the same nodes back on a parameter-only navigation, and the state
      // writes the new route's key in a microtask: loading at once read the previous key's value
      // and published it (docs/seam-apps.md, shift-desk).
      this._scheduleLoad();
    }
    // Always bind the cross-tab watcher to the Shell's current key/type before
    // starting sync. In paths where load()/save() never run (e.g. manual mode,
    // or key set via JS without a load), _core.key/_core.type would otherwise
    // keep a stale/empty value and the storage listener's `e.key !== _key`
    // check would compare against the wrong key. This also covers detach →
    // re-attach: stale Core key from a previous session is overwritten here.
    this._syncCore();
    this._core.startSync();
  }

  disconnectedCallback(): void {
    this._core.stopSync();
  }

  private _scheduleLoad(): void {
    if (this._loadPending) return;
    this._loadPending = true;
    queueMicrotask(() => {
      this._loadPending = false;
      if (this.isConnected && !this.manual && this.key) {
        this.load();
      }
    });
  }
}
