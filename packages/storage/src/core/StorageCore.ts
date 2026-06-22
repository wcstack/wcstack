import { STORAGE_EVENTS } from "../events.js";
import { IWcBindable, StorageType, WcsStorageError } from "../types.js";

export class StorageCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value", event: STORAGE_EVENTS.valueChanged, getter: (e: Event) => (e as CustomEvent).detail },
      { name: "loading", event: STORAGE_EVENTS.loadingChanged },
      { name: "error", event: STORAGE_EVENTS.error },
    ],
    inputs: [
      { name: "key" },
      { name: "type" },
    ],
    // load / save / remove are synchronous, so none carry the `async` hint.
    commands: [
      { name: "load" },
      { name: "save" },
      { name: "remove" },
    ],
  };

  private _target: EventTarget;
  private _value: any = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _key: string = "";
  private _type: StorageType = "local";
  private _storageListener: ((e: StorageEvent) => void) | null = null;
  // Generation guard: bumped on dispose(). The cross-tab `storage` listener
  // captures the generation active when startSync() ran; a callback that fires
  // after dispose() (or a teardown→re-setup) has a stale gen and MUST NOT write
  // state to a torn-down element. A boolean flag is insufficient (dispose→observe
  // would let a stale listener slip through).
  private _gen = 0;
  // SSR: storage access is synchronous, so there is no asynchronous probe to
  // await — readiness is immediate.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get ready(): Promise<void> {
    return this._ready;
  }

  // Lifecycle (§3.5). Storage sync is command-driven (the Shell calls startSync()
  // from connectedCallback), so observe() is an idempotent no-op that resolves
  // once ready; dispose() tears down the cross-tab listener and invalidates any
  // in-flight listener callback.
  observe(): Promise<void> {
    return this._ready;
  }

  dispose(): void {
    this._gen++;
    this.stopSync();
  }

  get value(): any {
    return this._value;
  }

  // Set the current value *without* persisting it. Persistence happens only via
  // save() / remove() / a cross-tab storage event. This setter exists so the
  // Shell (manual mode) can stage a value handed in via a `value` binding and
  // then commit it later with save()/trigger. It mirrors the value to observers
  // through the same `value-changed` event load()/save() use (CSBC: a Core value
  // change is observable), but it deliberately does not touch storage.
  //
  // Same-value writes are skipped to break a potential feedback loop:
  // value-changed → state binding → value setter → value-changed → …
  set value(v: any) {
    if (Object.is(v, this._value)) return;
    this._setValue(v);
  }

  get loading(): boolean {
    return this._loading;
  }

  get error(): any {
    return this._error;
  }

  get key(): string {
    return this._key;
  }

  set key(value: string) {
    // Defensive normalization for direct Core use (the Shell already passes a
    // string via `getAttribute("key") || ""`). Coercing to String keeps a
    // non-string assignment from poisoning the cross-tab `e.key !== _key`
    // comparison; empty keys are still rejected at operation time.
    this._key = String(value);
  }

  get type(): StorageType {
    return this._type;
  }

  set type(value: StorageType) {
    if (value !== "local" && value !== "session") {
      // never-throw: an invalid type is routed to the error property and the
      // current type is kept (the safe default), rather than throwing out of the
      // setter / setAttribute / connectedCallback.
      this._setError({ message: `Invalid storage type: "${value}". Must be "local" or "session".` });
      return;
    }
    this._type = value;
  }

  private _getStorage(): globalThis.Storage {
    return this._type === "session" ? sessionStorage : localStorage;
  }

  private _setLoading(loading: boolean): void {
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.loadingChanged, {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    this._error = error;
    this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.error, {
      detail: error,
      bubbles: true,
    }));
  }

  // Wrap a caught storage exception into the documented WcsStorageError shape,
  // tagging it with the failing operation so consumers know which call failed.
  private _toStorageError(operation: WcsStorageError["operation"], e: unknown): WcsStorageError {
    return {
      operation,
      message: e instanceof Error ? e.message : String(e),
    };
  }

  private _setValue(value: any): void {
    this._value = value;
    this._target.dispatchEvent(new CustomEvent(STORAGE_EVENTS.valueChanged, {
      detail: value,
      bubbles: true,
    }));
  }

  load(): any {
    if (!this._key) {
      // never-throw: a missing key is routed to the error property and a
      // sanitized null is returned, rather than throwing.
      this._setError({ operation: "load", message: "key is required." });
      return null;
    }

    this._setLoading(true);
    this._setError(null);

    try {
      const storage = this._getStorage();
      const raw = storage.getItem(this._key);

      if (raw === null) {
        this._setValue(null);
      } else {
        try {
          this._setValue(JSON.parse(raw));
        } catch {
          this._setValue(raw);
        }
      }

      this._setLoading(false);
      return this._value;
    } catch (e: any) {
      this._setError(this._toStorageError("load", e));
      this._setLoading(false);
      return null;
    }
  }

  save(value: any): void {
    if (!this._key) {
      // never-throw: a missing key is routed to the error property instead of
      // throwing. No return value to sanitize (save returns void).
      this._setError({ operation: "save", message: "key is required." });
      return;
    }

    this._setLoading(true);
    this._setError(null);

    try {
      const storage = this._getStorage();

      if (value === null || value === undefined) {
        storage.removeItem(this._key);
        // Normalize the removed value to null (matching remove() and load() of a
        // missing key) so saving `undefined` does not leave the getter returning
        // `undefined`. README's serialization table documents null/undefined as
        // "null" on read-back.
        this._setValue(null);
      } else if (typeof value === "string") {
        storage.setItem(this._key, value);
        this._setValue(value);
      } else {
        storage.setItem(this._key, JSON.stringify(value));
        this._setValue(value);
      }

      this._setLoading(false);
    } catch (e: any) {
      this._setError(this._toStorageError("save", e));
      this._setLoading(false);
    }
  }

  remove(): void {
    if (!this._key) {
      // never-throw: a missing key is routed to the error property instead of
      // throwing. No return value to sanitize (remove returns void).
      this._setError({ operation: "remove", message: "key is required." });
      return;
    }

    this._setLoading(true);
    this._setError(null);

    try {
      const storage = this._getStorage();
      storage.removeItem(this._key);
      this._setValue(null);
      this._setLoading(false);
    } catch (e: any) {
      this._setError(this._toStorageError("remove", e));
      this._setLoading(false);
    }
  }

  startSync(): void {
    if (this._storageListener) return;

    // Capture the generation active when sync starts. A `storage` event that
    // fires after dispose() (which bumps _gen and removes the listener) carries a
    // stale gen and must not write state to a torn-down element. stopSync()
    // already detaches the listener, but the gen guard also covers a queued event
    // delivered between dispose()'s bump and the actual removeEventListener.
    const gen = ++this._gen;

    this._storageListener = (e: StorageEvent) => {
      if (gen !== this._gen) return;
      if (e.key !== this._key) return;
      if (this._type === "session") return;

      // A fresh value arriving from another tab supersedes any stale error from
      // a prior failed load/save/remove. Clearing it here keeps the sync path
      // consistent with load()/save()/remove(), which all reset error to null at
      // the start of a successful operation — otherwise an "error present + fresh
      // value" inconsistency could persist after a cross-tab update.
      this._setError(null);

      if (e.newValue === null) {
        this._setValue(null);
      } else {
        try {
          this._setValue(JSON.parse(e.newValue));
        } catch {
          this._setValue(e.newValue);
        }
      }
    };

    globalThis.addEventListener("storage", this._storageListener);
  }

  stopSync(): void {
    if (!this._storageListener) return;
    globalThis.removeEventListener("storage", this._storageListener);
    this._storageListener = null;
  }
}
