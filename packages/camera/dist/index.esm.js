const _config = {
    tagNames: {
        camera: "wcs-camera",
        recorder: "wcs-recorder",
    },
};
function deepFreeze(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
        deepFreeze(obj[key]);
    }
    return obj;
}
function deepClone(obj) {
    if (obj === null || typeof obj !== "object")
        return obj;
    const clone = {};
    for (const key of Object.keys(obj)) {
        clone[key] = deepClone(obj[key]);
    }
    return clone;
}
let frozenConfig = null;
// Internal, mutable live config used by registerComponents (read at call time so
// setConfig() takes effect without re-import). Public consumers get the deep-frozen
// clone from getConfig().
const config = _config;
function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
function setConfig(partialConfig) {
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
}

/** True when getUserMedia is reachable (secure context with a media-devices impl). */
function hasMediaDevices() {
    return typeof navigator !== "undefined"
        && !!navigator.mediaDevices
        && typeof navigator.mediaDevices.getUserMedia === "function";
}
function hasMediaRecorderApi() {
    return typeof globalThis !== "undefined"
        && typeof globalThis.MediaRecorder === "function";
}
/** True when MediaRecorder is available in this environment. */
function hasMediaRecorder() {
    return hasMediaRecorderApi();
}
/**
 * Translate a getUserMedia constraints object from the declarative
 * CameraConstraints surface. Always requests a video track; `audio` opts the
 * microphone in. `deviceId` (exact) takes precedence over `facingMode`.
 */
function buildConstraints(c) {
    const video = {};
    if (c.deviceId) {
        video.deviceId = { exact: c.deviceId };
    }
    else if (c.facingMode) {
        video.facingMode = c.facingMode;
    }
    if (typeof c.width === "number")
        video.width = c.width;
    if (typeof c.height === "number")
        video.height = c.height;
    const hasVideoConstraint = Object.keys(video).length > 0;
    return {
        video: hasVideoConstraint ? video : true,
        audio: c.audio === true,
    };
}
/** Normalize any thrown getUserMedia / MediaRecorder failure into a flat detail. */
function normalizeMediaError(error) {
    if (error && typeof error === "object" && "name" in error) {
        const name = String(error.name) || "Error";
        const message = "message" in error && error.message
            ? String(error.message)
            : `Media request failed: ${name}.`;
        return { name, message };
    }
    return { name: "Error", message: "Media request failed." };
}
const UNSUPPORTED_ERROR = {
    name: "unsupported",
    message: "getUserMedia is not available (requires a secure context).",
};
/**
 * Request a media stream. Never throws — resolves with `{ stream }` on success or
 * `{ error }` (normalized) on failure / when the API is unavailable.
 */
async function requestUserMedia(constraints) {
    if (!hasMediaDevices()) {
        return { error: UNSUPPORTED_ERROR };
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        return { stream };
    }
    catch (error) {
        return { error: normalizeMediaError(error) };
    }
}
/** Stop every track of a stream, releasing the camera/microphone hardware. */
function stopAllTracks(stream) {
    if (!stream)
        return;
    for (const track of stream.getTracks()) {
        track.stop();
    }
}
/**
 * Enumerate video input devices as plain snapshots. Labels are only populated
 * after a grant, so this is refreshed post-acquisition. Never throws.
 */
async function enumerateVideoDevices() {
    if (!hasMediaDevices() || typeof navigator.mediaDevices.enumerateDevices !== "function") {
        return [];
    }
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices
            .filter((d) => d.kind === "videoinput")
            .map((d) => ({
            deviceId: d.deviceId,
            label: d.label,
            groupId: d.groupId,
            kind: d.kind,
        }));
    }
    catch {
        return [];
    }
}

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
class MediaPermissionWatcher {
    _name;
    _onChange;
    _status = null;
    _gen = 0;
    _subscribed = false;
    constructor(name, onChange) {
        this._name = name;
        this._onChange = onChange;
    }
    /** Issue the initial query and subscribe to live changes. Resolves when settled. */
    observe() {
        if (this._subscribed)
            return Promise.resolve();
        if (typeof navigator === "undefined" || !navigator.permissions
            || typeof navigator.permissions.query !== "function") {
            this._onChange("unsupported");
            return Promise.resolve();
        }
        this._subscribed = true;
        const gen = ++this._gen;
        return navigator.permissions
            .query({ name: this._name })
            .then((status) => {
            if (gen !== this._gen)
                return;
            this._status = status;
            this._onChange(status.state);
            status.addEventListener("change", this._onStatusChange);
        }, () => {
            if (gen !== this._gen)
                return;
            this._onChange("unsupported");
        });
    }
    /** Detach the live listener and invalidate any in-flight query. */
    dispose() {
        this._subscribed = false;
        this._gen++;
        if (this._status) {
            this._status.removeEventListener("change", this._onStatusChange);
            this._status = null;
        }
    }
    _onStatusChange = (event) => {
        const status = event.target;
        this._onChange(status.state);
    };
}

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
class CameraCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "active", event: "wcs-camera:active-changed" },
            { name: "permission", event: "wcs-camera:permission-changed" },
            { name: "audioPermission", event: "wcs-camera:audio-permission-changed" },
            { name: "deviceId", event: "wcs-camera:device-changed" },
            { name: "devices", event: "wcs-camera:devices-changed" },
            { name: "error", event: "wcs-camera:error" },
            // Direct-channel handle: event-token only — never bound as a reactive value.
            { name: "streamReady", event: "wcs-camera:stream-ready", getter: (e) => e.detail },
            { name: "ended", event: "wcs-camera:ended" },
        ],
        commands: [
            { name: "start" },
            { name: "stop" },
            { name: "switchCamera" },
        ],
    };
    _target;
    _active = false;
    _permission = "prompt";
    _audioPermission = null;
    _deviceId = null;
    _devices = [];
    _error = null;
    // The live stream — internal only, never a reactive value (see class docs).
    _stream = null;
    // desired/actual split (wakelock-style): `_desired` is whether the user wants the
    // camera on; `_active` is whether a stream is actually live. The OS can revoke a
    // track (device unplugged / taken by another app) — actual drops while desired
    // stays true, so a later resume()/visibility-restore can re-acquire.
    _desired = false;
    _constraints = {};
    // Monotonic id of the current acquisition lifecycle. Bumped by every acquire and
    // by dispose(). Each in-flight getUserMedia captures it and, on resolve, bails
    // (stopping the just-acquired stream) when superseded — so a constraints change
    // mid-acquire (switchMap-style restart) cannot leave an orphaned stream live.
    _gen = 0;
    _subscribed = false;
    _camWatcher = null;
    _micWatcher = null;
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get active() { return this._active; }
    get permission() { return this._permission; }
    get audioPermission() { return this._audioPermission; }
    get deviceId() { return this._deviceId; }
    get devices() { return this._devices; }
    get error() { return this._error; }
    get ready() { return this._ready; }
    // --- State setters with event dispatch (same-value guarded) ---
    _setActive(active) {
        if (this._active === active)
            return;
        this._active = active;
        this._dispatch("wcs-camera:active-changed", active);
    }
    _setPermission(state) {
        if (this._permission === state)
            return;
        this._permission = state;
        this._dispatch("wcs-camera:permission-changed", state);
    }
    _setAudioPermission(state) {
        if (this._audioPermission === state)
            return;
        this._audioPermission = state;
        this._dispatch("wcs-camera:audio-permission-changed", state);
    }
    _setDeviceId(id) {
        if (this._deviceId === id)
            return;
        this._deviceId = id;
        this._dispatch("wcs-camera:device-changed", id);
    }
    _setDevices(devices) {
        if (this._devicesEqual(this._devices, devices))
            return;
        this._devices = devices;
        this._dispatch("wcs-camera:devices-changed", devices);
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        this._dispatch("wcs-camera:error", error);
    }
    _dispatch(type, detail) {
        this._target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
    }
    _devicesEqual(a, b) {
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i].deviceId !== b[i].deviceId || a[i].label !== b[i].label)
                return false;
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
    observe(constraints) {
        this._constraints = { ...constraints };
        if (!this._subscribed) {
            this._subscribed = true;
            this._ready = this._initPermissions();
        }
        else {
            // Already live: just track the latest constraints for the next acquire.
            this._reconcileAudioWatcher();
        }
        return this._ready;
    }
    /** Acquire the camera (sets desired=true). Prompts on first use. */
    start() {
        this._desired = true;
        this._restart();
    }
    /** Release the camera (sets desired=false), stopping all tracks. */
    stop() {
        this._desired = false;
        this._release(false);
    }
    /** Toggle facingMode (user ↔ environment) and re-acquire if active. */
    switchCamera() {
        const next = this._constraints.facingMode === "environment" ? "user" : "environment";
        this._constraints = { ...this._constraints, facingMode: next, deviceId: undefined };
        if (this._desired) {
            this._restart();
        }
    }
    /**
     * Suspend the live stream while keeping `desired` — for page-hidden. Stops tracks
     * (clearing the hardware indicator) but remembers that the camera should resume.
     */
    suspend() {
        if (this._stream) {
            this._release(false);
        }
    }
    /** Re-acquire if the camera is desired but not currently active — for page-visible. */
    resume() {
        if (this._desired && !this._active) {
            this._restart();
        }
    }
    /** Tear down: stop the stream and detach permission listeners. */
    dispose() {
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
    _initPermissions() {
        if (!hasMediaDevices()) {
            this._setPermission("unsupported");
            return Promise.resolve();
        }
        this._camWatcher = new MediaPermissionWatcher("camera", (s) => this._setPermission(s));
        const tasks = [this._camWatcher.observe()];
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
    _onDeviceChange = () => {
        void enumerateVideoDevices().then((devices) => {
            // Guard against a late resolution after dispose.
            if (this._subscribed)
                this._setDevices(devices);
        });
    };
    // Bring the microphone watcher in line with the latest `audio` constraint when
    // observe() is called again on an already-live Core.
    _reconcileAudioWatcher() {
        if (this._constraints.audio && !this._micWatcher && hasMediaDevices()) {
            this._micWatcher = new MediaPermissionWatcher("microphone", (s) => this._setAudioPermission(s));
            this._micWatcher.observe();
        }
        else if (!this._constraints.audio && this._micWatcher) {
            this._micWatcher.dispose();
            this._micWatcher = null;
            this._setAudioPermission(null);
        }
    }
    _restart() {
        this._release(false);
        void this._acquire();
    }
    async _acquire() {
        const gen = ++this._gen;
        const constraints = buildConstraints(this._constraints);
        const { stream, error } = await requestUserMedia(constraints);
        // Superseded by a newer acquire (rapid restart) or disposed while in flight:
        // stop the orphan stream and bail without mutating state.
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
            }
            else if (error.name === "unsupported") {
                this._setPermission("unsupported");
                this._desired = false;
            }
            this._setActive(false);
            return;
        }
        const live = stream;
        this._stream = live;
        for (const track of live.getTracks()) {
            track.addEventListener("ended", this._onTrackEnded);
        }
        this._setError(null);
        // getUserMedia success is authoritative for permission.
        this._setPermission("granted");
        if (this._constraints.audio) {
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
    _release(silent) {
        if (!this._stream)
            return;
        for (const track of this._stream.getTracks()) {
            track.removeEventListener("ended", this._onTrackEnded);
        }
        stopAllTracks(this._stream);
        this._stream = null;
        if (silent) {
            this._active = false;
        }
        else {
            this._setActive(false);
        }
    }
    _onTrackEnded = () => {
        // OS revoked a track (unplug / taken by another app). actual drops; desired
        // stays true so resume()/visibility-restore can re-acquire.
        this._release(false);
        this._dispatch("wcs-camera:ended", null);
    };
    _updateDeviceId(stream) {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && typeof videoTrack.getSettings === "function") {
            const settings = videoTrack.getSettings();
            this._setDeviceId(settings.deviceId ?? null);
        }
    }
}

/**
 * `<wcs-camera>` — declarative camera capture with a built-in preview.
 *
 * The element owns a `<video>` in its shadow root and assigns the live
 * `MediaStream` to `video.srcObject` internally, so the non-serializable handle
 * never crosses the state boundary (design §1, case B). For consumers (a
 * `<wcs-recorder>`, an external `<video>`), the stream is also published via the
 * `wcs-camera:stream-ready` event-token for the direct element→element channel
 * (design §2).
 *
 * Acquisition is explicit: `start()` / the `autostart` attribute prompt and
 * acquire; merely connecting does not. While the page is hidden the stream is
 * suspended (clearing the camera indicator) and re-acquired on return, unless
 * `keep-alive` is set (e.g. during recording).
 */
class WcsCamera extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...CameraCore.wcBindable,
        inputs: [
            { name: "audio", attribute: "audio" },
            { name: "facingMode", attribute: "facing-mode" },
            { name: "deviceId", attribute: "device-id" },
            { name: "width", attribute: "width" },
            { name: "height", attribute: "height" },
            { name: "autostart", attribute: "autostart" },
            { name: "keepAlive", attribute: "keep-alive" },
        ],
        commands: CameraCore.wcBindable.commands,
    };
    static observedAttributes = ["facing-mode", "device-id", "audio", "width", "height"];
    _core;
    _video;
    _connectedCallbackPromise = Promise.resolve();
    _connected = false;
    constructor() {
        super();
        this._core = new CameraCore(this);
        const root = this.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = ":host{display:inline-block}video{display:block;width:100%;height:100%}";
        this._video = document.createElement("video");
        this._video.autoplay = true;
        this._video.muted = true;
        this._video.setAttribute("playsinline", "");
        this._video.setAttribute("part", "video");
        root.append(style, this._video);
        // Bind the live handle to the preview internally — never through state.
        this.addEventListener("wcs-camera:stream-ready", this._onStreamReady);
        this.addEventListener("wcs-camera:active-changed", this._onActiveChanged);
    }
    // --- Attribute accessors ---
    get audio() { return this.hasAttribute("audio"); }
    set audio(value) { this._toggleAttr("audio", value); }
    get facingMode() {
        return this.getAttribute("facing-mode") === "environment" ? "environment" : "user";
    }
    set facingMode(value) { this.setAttribute("facing-mode", value); }
    get deviceId() { return this.getAttribute("device-id") ?? ""; }
    set deviceId(value) { this.setAttribute("device-id", value); }
    get width() { return this._numberAttr("width"); }
    set width(value) { this.setAttribute("width", String(value)); }
    get height() { return this._numberAttr("height"); }
    set height(value) { this.setAttribute("height", String(value)); }
    get autostart() { return this.hasAttribute("autostart"); }
    set autostart(value) { this._toggleAttr("autostart", value); }
    get keepAlive() { return this.hasAttribute("keep-alive"); }
    set keepAlive(value) { this._toggleAttr("keep-alive", value); }
    /** The internal preview `<video>` (for advanced styling/measurement). */
    get videoElement() { return this._video; }
    // --- Core delegated getters ---
    get active() { return this._core.active; }
    get permission() { return this._core.permission; }
    get audioPermission() { return this._core.audioPermission; }
    get devices() { return this._core.devices; }
    get error() { return this._core.error; }
    get connectedCallbackPromise() { return this._connectedCallbackPromise; }
    // --- Commands ---
    start() { this._core.start(); }
    stop() { this._core.stop(); }
    switchCamera() { this._core.switchCamera(); }
    // --- Internal ---
    _toggleAttr(name, value) {
        if (value) {
            this.setAttribute(name, "");
        }
        else {
            this.removeAttribute(name);
        }
    }
    _numberAttr(name) {
        const attr = this.getAttribute(name);
        if (attr === null || attr.trim() === "")
            return NaN;
        const parsed = Number(attr);
        return Number.isFinite(parsed) ? parsed : NaN;
    }
    _constraints() {
        const c = { audio: this.audio, facingMode: this.facingMode };
        if (this.deviceId)
            c.deviceId = this.deviceId;
        if (Number.isFinite(this.width))
            c.width = this.width;
        if (Number.isFinite(this.height))
            c.height = this.height;
        return c;
    }
    _onStreamReady = (event) => {
        this._video.srcObject = event.detail;
    };
    _onActiveChanged = (event) => {
        // Clear the preview when the stream is released so the last frame does not stick.
        if (event.detail === false) {
            this._video.srcObject = null;
        }
    };
    // --- Lifecycle ---
    connectedCallback() {
        this._connected = true;
        this._connectedCallbackPromise = this._core.observe(this._constraints());
        if (this.autostart) {
            this._core.start();
        }
        document.addEventListener("visibilitychange", this._onVisibilityChange);
    }
    disconnectedCallback() {
        this._connected = false;
        document.removeEventListener("visibilitychange", this._onVisibilityChange);
        this._core.dispose();
    }
    attributeChangedCallback(_name, oldValue, newValue) {
        if (!this._connected || oldValue === newValue)
            return;
        // Track the new constraints (and reconcile the microphone watcher).
        this._core.observe(this._constraints());
        // A constraints change re-acquires (switchMap-style restart) only when active.
        if (this._core.active) {
            this._core.start();
        }
    }
    _onVisibilityChange = () => {
        if (this.keepAlive)
            return;
        if (document.visibilityState === "hidden") {
            this._core.suspend();
        }
        else {
            this._core.resume();
        }
    };
}

/**
 * Headless media-recording primitive. Wraps MediaRecorder, consuming a borrowed
 * `MediaStream` (received via `attachStream` over the direct channel — see
 * docs/camera-recorder-tag-design.md §2) and producing a `Blob` clip.
 *
 * Ownership: the stream is BORROWED, never owned. The Core never stops its tracks
 * — that is the camera's job (the acquirer owns release). Stopping here would tear
 * down a stream that may still be previewing.
 *
 * Output: `dataavailable` chunks are collected and assembled into one `Blob` on
 * stop, published via `wcs-recorder:recorded`. The `Blob` is structured-clone
 * friendly (a settled value, unlike MediaStream) so it may flow through state.
 * `objectURL` is a managed string — the Core revokes the previous URL before
 * issuing a new one and on dispose. Failures never throw.
 */
class RecorderCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "recording", event: "wcs-recorder:recording-changed" },
            { name: "paused", event: "wcs-recorder:paused-changed" },
            { name: "duration", event: "wcs-recorder:duration-changed" },
            { name: "mimeType", event: "wcs-recorder:mimetype-changed" },
            { name: "blob", event: "wcs-recorder:recorded", getter: (e) => e.detail?.blob ?? null },
            { name: "objectURL", event: "wcs-recorder:recorded", getter: (e) => e.detail?.objectURL ?? null },
            { name: "error", event: "wcs-recorder:error" },
            // event-token: detail = the assembled clip { blob, objectURL, mimeType, duration }.
            { name: "recorded", event: "wcs-recorder:recorded", getter: (e) => e.detail },
            // event-token (timeslice mode): detail = the streamed Blob chunk.
            { name: "dataavailable", event: "wcs-recorder:dataavailable", getter: (e) => e.detail },
        ],
        commands: [
            { name: "attachStream" },
            { name: "start" },
            { name: "stop" },
            { name: "pause" },
            { name: "resume" },
        ],
    };
    _target;
    _recording = false;
    _paused = false;
    _duration = 0;
    _mimeType = "";
    _blob = null;
    _objectURL = null;
    _error = null;
    _recorder = null;
    _stream = null; // borrowed — never stopped here
    _chunks = [];
    _timeslice = false;
    _startTime = 0;
    // Monotonic id of the current recording lifecycle. Bumped by every start() and
    // dispose(); each MediaRecorder callback bails if stale so a torn-down/restarted
    // recorder's late event cannot mutate state.
    _gen = 0;
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get recording() { return this._recording; }
    get paused() { return this._paused; }
    get duration() { return this._duration; }
    get mimeType() { return this._mimeType; }
    get blob() { return this._blob; }
    get objectURL() { return this._objectURL; }
    get error() { return this._error; }
    // --- State setters ---
    _setRecording(v) {
        if (this._recording === v)
            return;
        this._recording = v;
        this._dispatch("wcs-recorder:recording-changed", v);
    }
    _setPaused(v) {
        if (this._paused === v)
            return;
        this._paused = v;
        this._dispatch("wcs-recorder:paused-changed", v);
    }
    _setDuration(v) {
        if (this._duration === v)
            return;
        this._duration = v;
        this._dispatch("wcs-recorder:duration-changed", v);
    }
    _setMimeType(v) {
        if (this._mimeType === v)
            return;
        this._mimeType = v;
        this._dispatch("wcs-recorder:mimetype-changed", v);
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        this._dispatch("wcs-recorder:error", error);
    }
    _dispatch(type, detail) {
        this._target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
    }
    // --- Public API ---
    /**
     * Borrow a stream for recording (the direct-channel sink). Synchronous, no
     * await: the live handle is captured by reference and never stored in state.
     * Does NOT stop any previously-borrowed stream — ownership stays with the camera.
     */
    attachStream(stream) {
        this._stream = stream;
    }
    /** Start recording the borrowed stream. Never throws — surfaces `error`. */
    start(options = {}) {
        if (!hasMediaRecorder()) {
            this._setError({ name: "unsupported", message: "MediaRecorder is not available in this environment." });
            return;
        }
        if (!this._stream) {
            this._setError({ name: "NoStreamError", message: "No stream attached. Wire a camera's stream-ready to attachStream first." });
            return;
        }
        if (this._recording)
            return;
        const recOptions = {};
        if (options.mimeType && this._isTypeSupported(options.mimeType)) {
            recOptions.mimeType = options.mimeType;
        }
        if (typeof options.audioBitsPerSecond === "number")
            recOptions.audioBitsPerSecond = options.audioBitsPerSecond;
        if (typeof options.videoBitsPerSecond === "number")
            recOptions.videoBitsPerSecond = options.videoBitsPerSecond;
        let recorder;
        try {
            recorder = new MediaRecorder(this._stream, recOptions);
        }
        catch (error) {
            this._setError(normalizeMediaError(error));
            return;
        }
        const gen = ++this._gen;
        this._chunks = [];
        this._timeslice = typeof options.timeslice === "number" && options.timeslice > 0;
        recorder.ondataavailable = (event) => {
            if (gen !== this._gen)
                return;
            if (event.data && event.data.size > 0) {
                this._chunks.push(event.data);
                if (this._timeslice) {
                    this._dispatch("wcs-recorder:dataavailable", event.data);
                }
            }
        };
        recorder.onstop = () => {
            if (gen !== this._gen)
                return;
            // When stopped while paused, `_duration` was already finalized in onpause —
            // recomputing _elapsed() here would wrongly include the paused gap (the
            // clock kept running but `_startTime` was not advanced). Keep the held value.
            if (!this._paused)
                this._setDuration(this._elapsed());
            this._assembleBlob();
            this._setPaused(false);
            this._setRecording(false);
        };
        recorder.onerror = (event) => {
            if (gen !== this._gen)
                return;
            const err = event.error;
            this._setError(normalizeMediaError(err ?? { name: "RecorderError" }));
        };
        recorder.onpause = () => {
            if (gen !== this._gen)
                return;
            this._setDuration(this._elapsed());
            this._setPaused(true);
        };
        recorder.onresume = () => {
            if (gen !== this._gen)
                return;
            this._startTime = this._now() - this._duration;
            this._setPaused(false);
        };
        this._recorder = recorder;
        this._setError(null);
        this._setMimeType(recorder.mimeType || recOptions.mimeType || "");
        this._startTime = this._now();
        this._setDuration(0);
        recorder.start(this._timeslice ? options.timeslice : undefined);
        this._setRecording(true);
    }
    /** Stop recording; the assembled Blob is published from the recorder's onstop. */
    stop() {
        if (this._recorder && this._recorder.state !== "inactive") {
            this._recorder.stop();
        }
    }
    pause() {
        if (this._recorder && this._recorder.state === "recording") {
            this._recorder.pause();
        }
    }
    resume() {
        if (this._recorder && this._recorder.state === "paused") {
            this._recorder.resume();
        }
    }
    /** Stop in-flight recording, revoke the last object URL, drop the borrowed stream. */
    dispose() {
        // Bump the generation first so the native stop()'s onstop (gen-guarded) does
        // not run on a disposed Core — then reset the recording flags directly here.
        this._gen++;
        if (this._recorder && this._recorder.state !== "inactive") {
            try {
                this._recorder.stop();
            }
            catch {
                // A recorder already torn down by the environment must not throw here.
            }
        }
        this._recorder = null;
        this._revokeUrl();
        // Drop the borrowed reference WITHOUT stopping its tracks — the camera owns it.
        this._stream = null;
        // Reset transient recording state silently (onstop was gen-guarded out above).
        this._recording = false;
        this._paused = false;
    }
    // --- Internal ---
    _assembleBlob() {
        const blob = new Blob(this._chunks, this._mimeType ? { type: this._mimeType } : undefined);
        this._chunks = [];
        this._revokeUrl();
        const objectURL = this._createUrl(blob);
        this._blob = blob;
        this._objectURL = objectURL;
        const detail = {
            blob,
            objectURL,
            mimeType: this._mimeType,
            duration: this._duration,
        };
        this._dispatch("wcs-recorder:recorded", detail);
    }
    _revokeUrl() {
        if (this._objectURL && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
            URL.revokeObjectURL(this._objectURL);
        }
        this._objectURL = null;
    }
    _createUrl(blob) {
        if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
            return URL.createObjectURL(blob);
        }
        return "";
    }
    // Only called after hasMediaRecorder() has confirmed the API, so MediaRecorder
    // and its isTypeSupported are present.
    _isTypeSupported(type) {
        const MR = globalThis.MediaRecorder;
        return MR.isTypeSupported(type);
    }
    // performance.now() is universally available wherever MediaRecorder runs
    // (browsers and the happy-dom test env), so no fallback guard is needed.
    _now() {
        return performance.now();
    }
    _elapsed() {
        return Math.max(0, Math.round(this._now() - this._startTime));
    }
}

/**
 * `<wcs-recorder>` — declarative media recording. Wraps RecorderCore and records a
 * borrowed `MediaStream` received via the `attachStream` command (the direct
 * channel from `<wcs-camera>`'s `stream-ready`). It never owns or stops the stream.
 *
 * Recording parameters (`mime-type` / `timeslice` / bitrates) are mirrored
 * attributes. The assembled clip is published as `wcs-recorder:recorded`
 * (`{ blob, objectURL, mimeType, duration }`) and the `blob` / `objectURL` value
 * properties — a settled `Blob` is a value and may flow through state.
 */
class WcsRecorder extends HTMLElement {
    static wcBindable = {
        ...RecorderCore.wcBindable,
        inputs: [
            { name: "mimeType", attribute: "mime-type" },
            { name: "timeslice", attribute: "timeslice" },
            { name: "audioBitsPerSecond", attribute: "audio-bits" },
            { name: "videoBitsPerSecond", attribute: "video-bits" },
        ],
        commands: RecorderCore.wcBindable.commands,
    };
    _core;
    constructor() {
        super();
        this._core = new RecorderCore(this);
    }
    // --- Attribute accessors ---
    get mimeType() { return this.getAttribute("mime-type") ?? ""; }
    set mimeType(value) { this.setAttribute("mime-type", value); }
    get timeslice() { return this._numberAttr("timeslice"); }
    set timeslice(value) { this.setAttribute("timeslice", String(value)); }
    get audioBitsPerSecond() { return this._numberAttr("audio-bits"); }
    set audioBitsPerSecond(value) { this.setAttribute("audio-bits", String(value)); }
    get videoBitsPerSecond() { return this._numberAttr("video-bits"); }
    set videoBitsPerSecond(value) { this.setAttribute("video-bits", String(value)); }
    // --- Core delegated getters ---
    get recording() { return this._core.recording; }
    get paused() { return this._core.paused; }
    get duration() { return this._core.duration; }
    get blob() { return this._core.blob; }
    get objectURL() { return this._core.objectURL; }
    get error() { return this._core.error; }
    // --- Commands ---
    /** Borrow a stream (the direct-channel sink). */
    attachStream(stream) {
        this._core.attachStream(stream);
    }
    start() {
        this._core.start(this._options());
    }
    stop() { this._core.stop(); }
    pause() { this._core.pause(); }
    resume() { this._core.resume(); }
    // --- Internal ---
    _numberAttr(name) {
        const attr = this.getAttribute(name);
        if (attr === null || attr.trim() === "")
            return NaN;
        const parsed = Number(attr);
        return Number.isFinite(parsed) ? parsed : NaN;
    }
    _options() {
        const o = {};
        if (this.mimeType)
            o.mimeType = this.mimeType;
        if (Number.isFinite(this.timeslice))
            o.timeslice = this.timeslice;
        if (Number.isFinite(this.audioBitsPerSecond))
            o.audioBitsPerSecond = this.audioBitsPerSecond;
        if (Number.isFinite(this.videoBitsPerSecond))
            o.videoBitsPerSecond = this.videoBitsPerSecond;
        return o;
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
    }
    disconnectedCallback() {
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.camera)) {
        customElements.define(config.tagNames.camera, WcsCamera);
    }
    if (!customElements.get(config.tagNames.recorder)) {
        customElements.define(config.tagNames.recorder, WcsRecorder);
    }
}

function bootstrapCamera(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { CameraCore, RecorderCore, WcsCamera, WcsRecorder, bootstrapCamera, getConfig };
//# sourceMappingURL=index.esm.js.map
