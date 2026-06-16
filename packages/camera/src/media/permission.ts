import { MediaPermissionState } from "../types.js";

/**
 * Live monitor for a single media permission (`camera` or `microphone`) via the
 * Permissions API. Mirrors PermissionCore's two-phase pattern: an initial query
 * plus a live `change` subscription, guarded by a monotonic generation so a query
 * superseded by a rapid dispose/observe never attaches a stale listener.
 *
 * When the Permissions API is absent or rejects the descriptor (e.g. Firefox does
 * not accept the `camera` / `microphone` descriptor), the watcher reports
 * `"unsupported"`. The CameraCore then refines the state from the getUserMedia
 * outcome (granted on success, denied on NotAllowedError).
 */
export class MediaPermissionWatcher {
  private _name: "camera" | "microphone";
  private _onChange: (state: MediaPermissionState) => void;
  private _status: PermissionStatus | null = null;
  private _gen: number = 0;
  private _subscribed: boolean = false;

  constructor(name: "camera" | "microphone", onChange: (state: MediaPermissionState) => void) {
    this._name = name;
    this._onChange = onChange;
  }

  /** Issue the initial query and subscribe to live changes. Resolves when settled. */
  observe(): Promise<void> {
    if (this._subscribed) return Promise.resolve();
    if (typeof navigator === "undefined" || !navigator.permissions
      || typeof navigator.permissions.query !== "function") {
      this._onChange("unsupported");
      return Promise.resolve();
    }
    this._subscribed = true;
    const gen = ++this._gen;
    return navigator.permissions
      .query({ name: this._name as PermissionName })
      .then(
        (status) => {
          if (gen !== this._gen) return;
          this._status = status;
          this._onChange(status.state as MediaPermissionState);
          status.addEventListener("change", this._onStatusChange);
        },
        () => {
          if (gen !== this._gen) return;
          this._onChange("unsupported");
        },
      );
  }

  /** Detach the live listener and invalidate any in-flight query. */
  dispose(): void {
    this._subscribed = false;
    this._gen++;
    if (this._status) {
      this._status.removeEventListener("change", this._onStatusChange);
      this._status = null;
    }
  }

  private _onStatusChange = (event: Event): void => {
    const status = event.target as PermissionStatus;
    this._onChange(status.state as MediaPermissionState);
  };
}
