import { raiseError } from "../raiseError.js";
import { IWcBindable, StorageType } from "../types.js";

export class StorageCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "value", event: "wcs-storage:value-changed", getter: (e: Event) => (e as CustomEvent).detail },
      { name: "loading", event: "wcs-storage:loading-changed" },
      { name: "error", event: "wcs-storage:error" },
    ],
  };

  private _target: EventTarget;
  private _value: any = null;
  private _loading: boolean = false;
  private _error: any = null;
  private _key: string = "";
  private _type: StorageType = "local";
  private _storageListener: ((e: StorageEvent) => void) | null = null;

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get value(): any {
    return this._value;
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
    this._key = value;
  }

  get type(): StorageType {
    return this._type;
  }

  set type(value: StorageType) {
    if (value !== "local" && value !== "session") {
      raiseError(`Invalid storage type: "${value}". Must be "local" or "session".`);
    }
    this._type = value;
  }

  private _getStorage(): globalThis.Storage {
    return this._type === "session" ? sessionStorage : localStorage;
  }

  private _setLoading(loading: boolean): void {
    this._loading = loading;
    this._target.dispatchEvent(new CustomEvent("wcs-storage:loading-changed", {
      detail: loading,
      bubbles: true,
    }));
  }

  private _setError(error: any): void {
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-storage:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setValue(value: any): void {
    this._value = value;
    this._target.dispatchEvent(new CustomEvent("wcs-storage:value-changed", {
      detail: value,
      bubbles: true,
    }));
  }

  load(): any {
    if (!this._key) {
      raiseError("key is required.");
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
      this._setError(e);
      this._setLoading(false);
      return null;
    }
  }

  save(value: any): void {
    if (!this._key) {
      raiseError("key is required.");
    }

    this._setLoading(true);
    this._setError(null);

    try {
      const storage = this._getStorage();

      if (value === null || value === undefined) {
        storage.removeItem(this._key);
      } else if (typeof value === "string") {
        storage.setItem(this._key, value);
      } else {
        storage.setItem(this._key, JSON.stringify(value));
      }

      this._setValue(value);
      this._setLoading(false);
    } catch (e: any) {
      this._setError(e);
      this._setLoading(false);
    }
  }

  remove(): void {
    if (!this._key) {
      raiseError("key is required.");
    }

    this._setLoading(true);
    this._setError(null);

    try {
      const storage = this._getStorage();
      storage.removeItem(this._key);
      this._setValue(null);
      this._setLoading(false);
    } catch (e: any) {
      this._setError(e);
      this._setLoading(false);
    }
  }

  startSync(): void {
    if (this._storageListener) return;

    this._storageListener = (e: StorageEvent) => {
      if (e.key !== this._key) return;
      if (this._type === "session") return;

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
