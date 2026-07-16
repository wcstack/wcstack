import {
  IWcBindable, CameraConstraints, FacingMode, MediaDeviceSnapshot,
  MediaPermissionState, WcsMediaErrorDetail,
} from "../types.js";
import {
  buildConstraints, enumerateVideoDevices, hasMediaDevices, requestUserMedia, stopAllTracks,
} from "../media/getUserMedia.js";
import { MediaPermissionWatcher } from "../media/permission.js";
import { WcsIoErrorInfo } from "./platformCapability.js";
import { deriveMediaErrorInfo } from "./mediaCapabilities.js";

/**
 * Headless camera-capture primitive. Wraps getUserMedia + the Permissions API and
 * exposes a `MediaStream` through the wc-bindable protocol — but the live stream is
 * NEVER published as a reactive value. It is a non-serializable live handle: it
 * flows out only via the `wcs-camera:stream-ready` event so a consumer (the preview
 * `<video>`, a `<wcs-recorder>`) can bind it directly to an element property,
 * bypassing serializable state. See docs/camera-recorder-tag-design.md §1/§2.
 *
 * The observable value surface is strictly derived data: `active` (is a stream
 * live — the "actual" half of the desired/actual pair), `permission` /
 * `audioPermission` (two-phase: Permissions API monitor + getUserMedia outcome),
 * `deviceId` / `devices`, and `error`. Failures never throw — they surface through
 * `error`.
 */
export class CameraCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "active", event: "wcs-camera:active-changed" },
      { name: "permission", event: "wcs-camera:permission-changed" },
      { name: "audioPermission", event: "wcs-camera:audio-permission-changed" },
      { name: "deviceId", event: "wcs-camera:device-changed" },
      { name: "devices", event: "wcs-camera:devices-changed" },
      { name: "error", event: "wcs-camera:error" },
      // Serializable failure taxonomy (stable code / phase / recoverable), or null.
      // Additive bindable output derived from `error` (the DOMException name /
      // "unsupported" sentinel); the existing `error` property/event are unchanged.
      // Fires wcs-camera:error-info-changed. No lane — acquisition is switchMap'd by
      // `_gen`, so there is no per-node operation policy to attach here.
      { name: "errorInfo", event: "wcs-camera:error-info-changed" },
      // Direct-channel handle: event-token only — never bound as a reactive value.
      { name: "streamReady", event: "wcs-camera:stream-ready", getter: (e: Event) => (e as CustomEvent).detail },
      // event-token: a bare signal (detail is always null) — surface detail, not the raw Event.
      { name: "ended", event: "wcs-camera:ended", getter: (e: Event) => (e as CustomEvent).detail },
    ],
    commands: [
      { name: "start" },
      { name: "stop" },
      { name: "switchCamera" },
    ],
  };

  private _target: EventTarget;

  private _active: boolean = false;
  private _permission: MediaPermissionState = "prompt";
  private _audioPermission: MediaPermissionState | null = null;
  private _deviceId: string | null = null;
  private _devices: MediaDeviceSnapshot[] = [];
  private _error: WcsMediaErrorDetail | null = null;
  private _errorInfo: WcsIoErrorInfo | null = null;

  // The live stream — internal only, never a reactive value (see class docs).
  private _stream: MediaStream | null = null;

  // desired/actual split (wakelock-style): `_desired` is whether the user wants the
  // camera on; `_active` is whether a stream is actually live. The OS can revoke a
  // track (device unplugged / taken by another app) — actual drops while desired
  // stays true, so a later resume()/visibility-restore can re-acquire.
  private _desired: boolean = false;

  private _constraints: CameraConstraints = {};

  // Monotonic id of the current acquisition lifecycle. Bumped by every acquire and
  // by dispose(). Each in-flight getUserMedia captures it and, on resolve, bails
  // (stopping the just-acquired stream) when superseded — so a constraints change
  // mid-acquire (switchMap-style restart) cannot leave an orphaned stream live.
  private _gen: number = 0;

  private _subscribed: boolean = false;
  private _camWatcher: MediaPermissionWatcher | null = null;
  private _micWatcher: MediaPermissionWatcher | null = null;

  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
  }

  get active(): boolean { return this._active; }
  get permission(): MediaPermissionState { return this._permission; }
  get audioPermission(): MediaPermissionState | null { return this._audioPermission; }
  get deviceId(): string | null { return this._deviceId; }
  get devices(): MediaDeviceSnapshot[] { return this._devices; }
  get error(): WcsMediaErrorDetail | null { return this._error; }
  /**
   * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
   * `recoverable`), or null. Additive wc-bindable property (event
   * `wcs-camera:error-info-changed`), derived from `error`; the existing `error`
   * property/event are unchanged.
   */
  get errorInfo(): WcsIoErrorInfo | null { return this._errorInfo; }
  get ready(): Promise<void> { return this._ready; }

  // --- State setters with event dispatch (same-value guarded) ---

  private _setActive(active: boolean): void {
    if (this._active === active) return;
    this._active = active;
    this._dispatch("wcs-camera:active-changed", active);
  }

  private _setPermission(state: MediaPermissionState): void {
    if (this._permission === state) return;
    this._permission = state;
    this._dispatch("wcs-camera:permission-changed", state);
  }

  private _setAudioPermission(state: MediaPermissionState | null): void {
    if (this._audioPermission === state) return;
    this._audioPermission = state;
    this._dispatch("wcs-camera:audio-permission-changed", state);
  }

  private _setDeviceId(id: string | null): void {
    if (this._deviceId === id) return;
    this._deviceId = id;
    this._dispatch("wcs-camera:device-changed", id);
  }

  private _setDevices(devices: MediaDeviceSnapshot[]): void {
    if (this._devicesEqual(this._devices, devices)) return;
    this._devices = devices;
    this._dispatch("wcs-camera:devices-changed", devices);
  }

  // Errors are dispatched on EVERY non-null occurrence by design — each failure is a
  // distinct event (e.g. retrying getUserMedia and failing again must re-notify), so
  // unlike the value setters this is not content-deduped. Only the null→null
  // transition is collapsed (clearing an already-clear error stays silent). The guard
  // is written on null explicitly so it does NOT depend on callers passing a fresh
  // object: a reused/cached non-null detail would still re-notify.
  private _setError(error: WcsMediaErrorDetail | null): void {
    if (error === null && this._error === null) return;
    this._error = error;
    // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
    // error detail (or null on clear). Fires before the `error` event so an observer
    // binding both sees the classification first, mirroring the io-node family.
    this._commitErrorInfo(error === null ? null : deriveMediaErrorInfo(error));
    this._dispatch("wcs-camera:error", error);
  }

  // Called only from _setError (which already collapses the null→null transition), so
  // errorInfo transitions exactly when error does — no separate guard needed here.
  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    this._errorInfo = info;
    this._dispatch("wcs-camera:error-info-changed", info);
  }

  private _dispatch(type: string, detail: unknown): void {
    this._target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
  }

  private _devicesEqual(a: MediaDeviceSnapshot[], b: MediaDeviceSnapshot[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].deviceId !== b[i].deviceId || a[i].label !== b[i].label) return false;
    }
    return true;
  }

  // --- Public API ---

  /**
   * Begin observing permissions for the given constraints. Idempotent while
   * already subscribed. The first call (or one after dispose()) starts the
   * camera/microphone permission monitors. Acquisition itself is driven separately
   * by start() / autostart — observing does not prompt.
   */
  observe(constraints: CameraConstraints): Promise<void> {
    this._constraints = { ...constraints };
    if (!this._subscribed) {
      this._subscribed = true;
      this._ready = this._initPermissions();
    } else {
      // Already live: track the latest constraints and fold any newly-started
      // microphone query into `ready` so awaiting observe() guarantees its initial
      // permission state — symmetric with _initPermissions() on the first observe.
      this._ready = this._ready.then(() => this._reconcileAudioWatcher());
    }
    return this._ready;
  }

  /** Acquire the camera (sets desired=true). Prompts on first use. */
  start(): void {
    this._desired = true;
    this._restart();
  }

  /** Release the camera (sets desired=false), stopping all tracks. */
  stop(): void {
    this._desired = false;
    this._release(false);
  }

  /**
   * Toggle facingMode (user ↔ environment) and re-acquire if active. This is the
   * headless, DOM-free path: it flips the Core's internal `_constraints` (the single
   * source of truth for a standalone Core) and re-acquires while desired.
   *
   * Note: the `<wcs-camera>` Shell does NOT delegate to this — it keeps the DOM
   * attributes authoritative and drives its own single re-acquire (see Camera.ts
   * switchCamera). Both reach the same end state; the split exists because the Shell
   * must keep its declared attributes in sync, which a Core has no notion of.
   */
  switchCamera(): void {
    const next: FacingMode = this._constraints.facingMode === "environment" ? "user" : "environment";
    this._constraints = { ...this._constraints, facingMode: next, deviceId: undefined };
    if (this._desired) {
      this._restart();
    }
  }

  /**
   * Suspend the live stream while keeping `desired` — for page-hidden. Stops tracks
   * (clearing the hardware indicator) but remembers that the camera should resume.
   *
   * Bumps `_gen` to supersede any in-flight acquire: without this, an acquire that
   * resolves *after* the page went hidden would assign `_stream` and set active —
   * re-lighting the camera behind a no-op suspend (the stream had not been assigned
   * yet, so the `if (_stream)` release below could not reach it). The superseded
   * acquire stops its just-acquired orphan stream on resolve (see `_acquire`).
   */
  suspend(): void {
    this._gen++;
    if (this._stream) {
      this._release(false);
    }
  }

  /** Re-acquire if the camera is desired but not currently active — for page-visible. */
  resume(): void {
    if (this._desired && !this._active) {
      this._restart();
    }
  }

  /** Tear down: stop the stream and detach permission listeners. */
  dispose(): void {
    this._subscribed = false;
    this._gen++;
    this._desired = false;
    this._release(true);
    if (hasMediaDevices() && typeof navigator.mediaDevices.removeEventListener === "function") {
      navigator.mediaDevices.removeEventListener("devicechange", this._onDeviceChange);
    }
    this._camWatcher?.dispose();
    this._micWatcher?.dispose();
    this._camWatcher = null;
    this._micWatcher = null;
  }

  // --- Internal ---

  private _initPermissions(): Promise<void> {
    if (!hasMediaDevices()) {
      this._setPermission("unsupported");
      return Promise.resolve();
    }
    this._camWatcher = new MediaPermissionWatcher("camera", (s) => this._setPermission(s));
    const tasks: Promise<void>[] = [this._camWatcher.observe()];
    if (this._constraints.audio) {
      this._micWatcher = new MediaPermissionWatcher("microphone", (s) => this._setAudioPermission(s));
      tasks.push(this._micWatcher.observe());
    }
    // Track hot-plug: refresh the device list when a camera is added/removed.
    if (typeof navigator.mediaDevices.addEventListener === "function") {
      navigator.mediaDevices.addEventListener("devicechange", this._onDeviceChange);
    }
    return Promise.all(tasks).then(() => undefined);
  }

  private _onDeviceChange = (): void => {
    void enumerateVideoDevices().then((devices) => {
      // Guard against a late resolution after dispose.
      if (this._subscribed) this._setDevices(devices);
    });
  };

  // Bring the microphone watcher in line with the latest `audio` constraint when
  // observe() is called again on an already-live Core. Returns the new watcher's
  // initial-query promise (so observe() can fold it into `ready`); resolved when
  // nothing started.
  private _reconcileAudioWatcher(): Promise<void> {
    if (this._constraints.audio && !this._micWatcher && hasMediaDevices()) {
      this._micWatcher = new MediaPermissionWatcher("microphone", (s) => this._setAudioPermission(s));
      return this._micWatcher.observe();
    } else if (!this._constraints.audio && this._micWatcher) {
      this._micWatcher.dispose();
      this._micWatcher = null;
      this._setAudioPermission(null);
    }
    return Promise.resolve();
  }

  private _restart(): void {
    this._release(false);
    void this._acquire();
  }

  private async _acquire(): Promise<void> {
    const gen = ++this._gen;
    const constraints = buildConstraints(this._constraints);
    const { stream, error } = await requestUserMedia(constraints);

    // Superseded by a newer acquire (rapid restart) or disposed while in flight:
    // stop the orphan stream and bail without mutating state. The `ended` listeners
    // are attached only AFTER this gen check (below), so stopping the orphan here
    // cannot fire _onTrackEnded — no spurious `ended` event / state mutation. Keep
    // this stop strictly before listener attachment if the order is ever refactored.
    if (gen !== this._gen) {
      stopAllTracks(stream ?? null);
      return;
    }

    if (error) {
      this._setError(error);
      if (error.name === "NotAllowedError") {
        this._setPermission("denied");
        // Hard denial: drop `desired` so a later visibility-restore (resume()) does
        // not silently re-attempt getUserMedia on every page-visible. A transient
        // failure (NotReadableError = device busy) keeps `desired` so it can recover.
        this._desired = false;
      } else if (error.name === "unsupported") {
        this._setPermission("unsupported");
        this._desired = false;
      }
      this._setActive(false);
      return;
    }

    const live = stream as MediaStream;
    this._stream = live;
    for (const track of live.getTracks()) {
      track.addEventListener("ended", this._onTrackEnded);
    }
    this._setError(null);
    // getUserMedia success is authoritative for permission.
    this._setPermission("granted");
    // Only assert mic-granted when the grant actually produced an audio track. With
    // today's boolean `audio` this is equivalent to `_constraints.audio`, but it stays
    // correct under a future non-mandatory `{ audio: {...} }` constraint where the
    // browser may grant video while omitting audio.
    if (this._constraints.audio && live.getAudioTracks().length > 0) {
      this._setAudioPermission("granted");
    }
    this._updateDeviceId(live);
    this._setActive(true);
    // Publish the live handle for the direct element→element channel.
    this._dispatch("wcs-camera:stream-ready", live);
    // Labels become available after a grant; refresh the device list.
    const devices = await enumerateVideoDevices();
    if (gen === this._gen) {
      this._setDevices(devices);
    }
  }

  private _release(silent: boolean): void {
    if (!this._stream) return;
    for (const track of this._stream.getTracks()) {
      track.removeEventListener("ended", this._onTrackEnded);
    }
    stopAllTracks(this._stream);
    this._stream = null;
    if (silent) {
      this._active = false;
    } else {
      this._setActive(false);
    }
  }

  private _onTrackEnded = (): void => {
    // OS revoked a track (unplug / taken by another app). actual drops; desired
    // stays true so resume()/visibility-restore can re-acquire.
    this._release(false);
    this._dispatch("wcs-camera:ended", null);
  };

  private _updateDeviceId(stream: MediaStream): void {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && typeof videoTrack.getSettings === "function") {
      const settings = videoTrack.getSettings();
      this._setDeviceId(settings.deviceId ?? null);
    }
  }
}
