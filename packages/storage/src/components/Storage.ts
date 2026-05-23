import { config } from "../config.js";
import { STORAGE_EVENTS } from "../events.js";
import { IWcBindable, StorageType } from "../types.js";
import { StorageCore } from "../core/StorageCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

export class Storage extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
    ...StorageCore.wcBindable,
    properties: [
      ...StorageCore.wcBindable.properties,
      { name: "trigger", event: STORAGE_EVENTS.triggerChanged },
    ],
    // Shell-level input surface. The Core declares only the portable `key` / `type`;
    // the Shell adds the DOM-driven settable surface. No `attribute` hints are given:
    // the `key` / `type` / `manual` setters already reflect to their attributes, so a
    // binding system that mirrors inputs[].attribute would set the attribute twice
    // (`value` / `trigger` are not attribute-backed). `commands` (load / save / remove)
    // are inherited unchanged from the Core via the spread above.
    inputs: [
      { name: "key" },
      { name: "type" },
      { name: "value" },
      { name: "manual" },
      { name: "trigger" },
    ],
  };
  static get observedAttributes(): string[] { return ["key", "type"]; }

  private _core: StorageCore;
  private _trigger: boolean = false;
  // Storage load()/save() are synchronous, so connection work never defers.
  // This stays an already-resolved Promise for the whole lifecycle; it exists
  // only to satisfy the `hasConnectedCallbackPromise` protocol (consumers may
  // `await el.connectedCallbackPromise`). connectedCallback intentionally does
  // not reassign it — there is nothing async to wait for, unlike <wcs-fetch>.
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new StorageCore(this);
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

  get key(): string {
    return this.getAttribute("key") || "";
  }

  set key(value: string) {
    this.setAttribute("key", value);
  }

  get type(): StorageType {
    // Normalize at the Shell boundary: any attribute value other than the
    // exact "session" falls back to "local". This keeps an invalid attribute
    // (e.g. type="foo") from reaching the Core's validating setter and throwing
    // out of setAttribute / connectedCallback.
    return this.getAttribute("type") === "session" ? "session" : "local";
  }

  set type(value: StorageType) {
    this.setAttribute("type", value);
  }

  get value(): any {
    return this._core.value;
  }

  set value(v: any) {
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

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean) {
    if (value) {
      this.setAttribute("manual", "");
    } else {
      this.removeAttribute("manual");
    }
  }

  get trigger(): boolean {
    return this._trigger;
  }

  set trigger(value: boolean) {
    const v = !!value;
    if (v) {
      this._trigger = true;
      // save() may raise (e.g. key unset). Guarantee the trigger resets to
      // false and the completion event fires even on failure, so the trigger
      // never gets stuck in the `true` state.
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

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (!this.isConnected) return;
    if (name === "key") {
      // Always keep the Core's key in sync with the attribute, regardless of
      // mode or whether the new value is empty. The cross-tab `storage` listener
      // compares `e.key !== _core.key`, so a stale Core key would make sync watch
      // the wrong (old/empty) key after a runtime key change. load() (which also
      // syncs the Core) only runs for non-manual mode with a non-empty key.
      this._syncCore();
      if (newValue && !this.manual) {
        this.load();
      }
    }
    if (name === "type") {
      // Route through the normalizing getter so an invalid attribute value
      // (e.g. type="foo") falls back to "local" instead of throwing.
      this._syncCore();
    }
  }

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    if (!this.manual && this.key) {
      this.load();
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
}
