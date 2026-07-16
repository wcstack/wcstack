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
/** True when MediaRecorder is available in this environment. */
function hasMediaRecorder() {
    return typeof globalThis !== "undefined"
        && typeof globalThis.MediaRecorder === "function";
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
 * mediaCapabilities.ts
 *
 * camera / recorder node 固有の error code(taxonomy)と derivation。汎用の error info
 * 型は `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。
 *
 * この 1 ファイルを CameraCore(getUserMedia)と RecorderCore(MediaRecorder)の両方が
 * import する。両 Core は同一の error detail 型(`WcsMediaErrorDetail = { name, message }`、
 * `.name` が DOMException 名 / "unsupported" sentinel / 各 Core 固有の合成名)を共有する
 * ため、derivation も 1 本で両者を賄える。lane は持たず(getUserMedia は acquire を
 * `_gen` で switchMap 済み、録画は command-driven)、error taxonomy(errorInfo)のみを採用する。
 */
/** 安定した media(camera / recorder)error code(taxonomy)。値は公開キーとして固定。 */
const WCS_MEDIA_ERROR_CODE = {
    /** getUserMedia / MediaRecorder API 不在(非セキュアコンテキスト含む) — "unsupported" sentinel。 */
    CapabilityMissing: "capability-missing",
    /** `NotAllowedError` / `SecurityError` — 権限拒否・feature-policy ブロック。 */
    NotAllowed: "not-allowed",
    /** `NotFoundError` — 要求した種類のデバイス(カメラ/マイク)が存在しない。 */
    NotFound: "not-found",
    /** `NotReadableError` — デバイスがハードウェア障害/他アプリ占有で読めない。 */
    NotReadable: "not-readable",
    /** `OverconstrainedError` / `NotSupportedError` — 制約・構成(mimeType 等)が満たせない。 */
    InvalidArgument: "invalid-argument",
    /** `NoStreamError` — stream 未 attach で録画開始(前提状態の不備)。 */
    InvalidState: "invalid-state",
    /** `AbortError` — 実行途中の中断(retry で回復しうる)。 */
    Aborted: "aborted",
    /** その他の実行時失敗(`RecorderError` / 想定外の MediaRecorder エラー等)。 */
    MediaError: "media-error",
};
/**
 * 正規化済み media error(`WcsMediaErrorDetail = { name, message }`)を serializable な
 * error taxonomy に写す。`name` は DOMException 名 / "unsupported" sentinel / Core 固有の
 * 合成名(`NoStreamError` / `RecorderError`)。公開 `error` shape は不変で、これはその
 * 付加的な分類。
 *
 * - "unsupported" は利用直前の能力欠如 → phase="probe" / capability-missing。
 * - `NotAllowedError` / `SecurityError` は取得開始時の権限拒否 → phase="start" /
 *   not-allowed。retry で回復しない。
 * - `NotFoundError` は要求デバイス不在 → phase="start" / not-found。
 * - `NotReadableError` はデバイス占有/ハードウェア障害 → phase="start" / not-readable。
 * - `OverconstrainedError` / `NotSupportedError` は制約・構成が満たせない
 *   → phase="start" / invalid-argument。
 * - `NoStreamError`(stream 未 attach で録画開始)は前提状態の不備 → phase="start" /
 *   invalid-state。
 * - `AbortError` は実行途中の中断 → phase="execute" / aborted(recoverable=true)。
 * - それ以外(`RecorderError` / runtime MediaRecorder エラー / "Error" fallback 等)は
 *   phase="execute" / media-error。
 */
function deriveMediaErrorInfo(error) {
    const { name, message } = error;
    if (name === "unsupported") {
        return { code: WCS_MEDIA_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    }
    if (name === "NotAllowedError" || name === "SecurityError") {
        return { code: WCS_MEDIA_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
    }
    if (name === "NotFoundError") {
        return { code: WCS_MEDIA_ERROR_CODE.NotFound, phase: "start", recoverable: false, message };
    }
    if (name === "NotReadableError") {
        return { code: WCS_MEDIA_ERROR_CODE.NotReadable, phase: "start", recoverable: false, message };
    }
    if (name === "OverconstrainedError" || name === "NotSupportedError") {
        return { code: WCS_MEDIA_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
    }
    if (name === "NoStreamError") {
        return { code: WCS_MEDIA_ERROR_CODE.InvalidState, phase: "start", recoverable: false, message };
    }
    if (name === "AbortError") {
        return { code: WCS_MEDIA_ERROR_CODE.Aborted, phase: "execute", recoverable: true, message };
    }
    return { code: WCS_MEDIA_ERROR_CODE.MediaError, phase: "execute", recoverable: false, message };
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
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error` (the DOMException name /
            // "unsupported" sentinel); the existing `error` property/event are unchanged.
            // Fires wcs-camera:error-info-changed. No lane — acquisition is switchMap'd by
            // `_gen`, so there is no per-node operation policy to attach here.
            { name: "errorInfo", event: "wcs-camera:error-info-changed" },
            // Direct-channel handle: event-token only — never bound as a reactive value.
            { name: "streamReady", event: "wcs-camera:stream-ready", getter: (e) => e.detail },
            // event-token: a bare signal (detail is always null) — surface detail, not the raw Event.
            { name: "ended", event: "wcs-camera:ended", getter: (e) => e.detail },
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
    _errorInfo = null;
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
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-camera:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() { return this._errorInfo; }
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
    // Errors are dispatched on EVERY non-null occurrence by design — each failure is a
    // distinct event (e.g. retrying getUserMedia and failing again must re-notify), so
    // unlike the value setters this is not content-deduped. Only the null→null
    // transition is collapsed (clearing an already-clear error stays silent). The guard
    // is written on null explicitly so it does NOT depend on callers passing a fresh
    // object: a reused/cached non-null detail would still re-notify.
    _setError(error) {
        if (error === null && this._error === null)
            return;
        this._error = error;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // error detail (or null on clear). Fires before the `error` event so an observer
        // binding both sees the classification first, mirroring the io-node family.
        this._commitErrorInfo(error === null ? null : deriveMediaErrorInfo(error));
        this._dispatch("wcs-camera:error", error);
    }
    // Called only from _setError (which already collapses the null→null transition), so
    // errorInfo transitions exactly when error does — no separate guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._dispatch("wcs-camera:error-info-changed", info);
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
            // Already live: track the latest constraints and fold any newly-started
            // microphone query into `ready` so awaiting observe() guarantees its initial
            // permission state — symmetric with _initPermissions() on the first observe.
            this._ready = this._ready.then(() => this._reconcileAudioWatcher());
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
     *
     * Bumps `_gen` to supersede any in-flight acquire: without this, an acquire that
     * resolves *after* the page went hidden would assign `_stream` and set active —
     * re-lighting the camera behind a no-op suspend (the stream had not been assigned
     * yet, so the `if (_stream)` release below could not reach it). The superseded
     * acquire stops its just-acquired orphan stream on resolve (see `_acquire`).
     */
    suspend() {
        this._gen++;
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
    // observe() is called again on an already-live Core. Returns the new watcher's
    // initial-query promise (so observe() can fold it into `ready`); resolved when
    // nothing started.
    _reconcileAudioWatcher() {
        if (this._constraints.audio && !this._micWatcher && hasMediaDevices()) {
            this._micWatcher = new MediaPermissionWatcher("microphone", (s) => this._setAudioPermission(s));
            return this._micWatcher.observe();
        }
        else if (!this._constraints.audio && this._micWatcher) {
            this._micWatcher.dispose();
            this._micWatcher = null;
            this._setAudioPermission(null);
        }
        return Promise.resolve();
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
    // `autostart` and `keep-alive` are intentionally NOT observed: `autostart` is a
    // connect-time-only acquire trigger (read once in connectedCallback; flipping it
    // later is meaningless), and `keep-alive` is read fresh on every visibilitychange
    // (_onVisibilityChange), so it never needs to drive a re-acquire. The observed set
    // is exactly the constraints that reshape the requested track.
    static observedAttributes = ["facing-mode", "device-id", "audio", "width", "height"];
    _core;
    _video;
    _connectedCallbackPromise = Promise.resolve();
    _connected = false;
    // True while switchCamera() rewrites several attributes at once. Each setAttribute /
    // removeAttribute fires its own attributeChangedCallback synchronously; without this
    // guard the FIRST change would re-acquire with the not-yet-updated constraints (and
    // tear active down so the later change's re-acquire is skipped). We suppress the
    // per-attribute re-acquire and drive a single one with the final constraints.
    _batchingAttrs = false;
    _internals = null;
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
        // Bind the live handle to the preview internally — never through state. These
        // self-listeners are intentionally not removed on disconnect (asymmetric with the
        // document-level `visibilitychange` in connect/disconnectedCallback): the target
        // is `this`, so the listeners are collected together with the element — there is
        // no external reference to leak. The visibility listener, by contrast, lives on
        // `document` (outlives the element) and MUST be detached.
        this.addEventListener("wcs-camera:stream-ready", this._onStreamReady);
        this.addEventListener("wcs-camera:active-changed", this._onActiveChanged);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-camera:active-changed": (d) => ({ active: d === true }),
            "wcs-camera:error": (d) => ({ error: d != null }),
        });
    }
    // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
    // wc-bindable (not a bind target); see README "CSS styling with :state()".
    // MUST NOT return the live CustomStateSet (that would let callers write
    // states from outside, defeating the point of :state() being read-only).
    get debugStates() {
        return this._internals ? [...this._internals.states] : [];
    }
    _initInternals() {
        // never-throw (docs/custom-state-reflection-design.md §3.4): attachInternals is
        // absent in happy-dom / older environments, and pre-125 Chromium rejects
        // non-dashed state names from states.add() (probed and discarded here). Either
        // case silently disables reflection — the component still works, it just doesn't
        // expose :state() selectors.
        try {
            if (typeof this.attachInternals !== "function")
                return null;
            const internals = this.attachInternals();
            internals.states.add("wcs-probe");
            internals.states.delete("wcs-probe");
            return internals;
        }
        catch {
            return null;
        }
    }
    _wireStates(map) {
        if (this._internals === null)
            return;
        const states = this._internals.states;
        for (const [event, toStates] of Object.entries(map)) {
            this.addEventListener(event, (e) => {
                const debug = this.hasAttribute("debug-states");
                for (const [name, on] of Object.entries(toStates(e.detail))) {
                    try {
                        // 式文の三項演算子は ESLint no-unused-expressions に抵触するため if/else。
                        if (on) {
                            states.add(name);
                        }
                        else {
                            states.delete(name);
                        }
                    }
                    catch { /* never-throw */ }
                    if (debug)
                        this.toggleAttribute(`data-wcs-state-${name}`, on);
                }
            });
        }
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
    /** The last failure's serializable `WcsIoErrorInfo` (Phase 6 taxonomy), or null. */
    get errorInfo() { return this._core.errorInfo; }
    get connectedCallbackPromise() { return this._connectedCallbackPromise; }
    // --- Commands ---
    start() { this._core.start(); }
    stop() { this._core.stop(); }
    /**
     * Toggle the front/back camera by updating the DOM attributes (the single source
     * of truth), not just the Core's internal constraints. Deliberately does NOT call
     * `CameraCore.switchCamera()` (which would mutate the Core's constraints behind the
     * DOM's back, leaving the declared attributes stale). `device-id` is removed because
     * it would otherwise take precedence over `facing-mode` (see buildConstraints) —
     * leaving it pinned would silently undo the switch on the next re-acquire. Both
     * attribute writes are batched (see `_batchingAttrs`) so they drive exactly ONE
     * re-acquire here, with the final constraints — never an early acquire on a
     * half-updated state. The DOM and the live camera stay in agreement.
     */
    switchCamera() {
        const next = this.facingMode === "environment" ? "user" : "environment";
        this._batchingAttrs = true;
        try {
            this.removeAttribute("device-id");
            this.setAttribute("facing-mode", next);
        }
        finally {
            this._batchingAttrs = false;
        }
        // Sync the (now-final) constraints and re-acquire once when a stream is live —
        // the same `active`-guarded restart attributeChangedCallback performs.
        this._core.observe(this._constraints());
        if (this._core.active) {
            this._core.start();
        }
    }
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
        // While switchCamera() batches several attribute writes, defer to its single
        // post-batch re-acquire — otherwise the first write would acquire on stale
        // constraints (see `_batchingAttrs`).
        if (this._batchingAttrs)
            return;
        // Track the new constraints (and reconcile the microphone watcher).
        this._core.observe(this._constraints());
        // A constraints change re-acquires (switchMap-style restart) only when a stream
        // is actually live. `active` is the deliberate guard (not `desired`): `active`
        // implies `desired` (a stream only goes live under desired), so re-acquiring
        // cannot spuriously re-`desired` a stopped camera. Guarding on `active` rather
        // than `desired` also avoids force-acquiring while suspended/hidden (desired but
        // not active) — the visibility handler owns resume there.
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
 * Non-goal: the Core does NOT subscribe to the borrowed tracks' `ended` and does NOT
 * auto-terminate a recording when the underlying stream dies (camera stop / OS
 * revoke / switchCamera re-acquire). Reacting would mean reaching into a stream we do
 * not own. The MediaRecorder keeps running against the now-dead source until an
 * explicit stop(); the consumer (which owns the camera lifecycle) is responsible for
 * stopping the recording when it tears the stream down. stop() then assembles
 * whatever chunks were captured — never throws.
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
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error` (the DOMException name /
            // "unsupported"/"NoStreamError"/"RecorderError" sentinel); the existing `error`
            // property/event are unchanged. Fires wcs-recorder:error-info-changed. No lane —
            // recording is command-driven.
            { name: "errorInfo", event: "wcs-recorder:error-info-changed" },
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
    _errorInfo = null;
    _recorder = null;
    _stream = null; // borrowed — never stopped here
    _chunks = [];
    _timeslice = false;
    _startTime = 0;
    // Monotonic id of the current recording lifecycle. Bumped by every start() and
    // dispose(); each MediaRecorder callback bails if stale so a torn-down/restarted
    // recorder's late event cannot mutate state.
    _gen = 0;
    // SSR: recording is command-driven (attachStream/start), so there is no
    // asynchronous probe to await — readiness is immediate.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
    }
    get recording() { return this._recording; }
    get paused() { return this._paused; }
    // Finalized at stop/pause only — there is no live ticking timer, so this stays 0
    // from start() until the first pause()/stop() (see _elapsed / onstop / onpause).
    get duration() { return this._duration; }
    get mimeType() { return this._mimeType; }
    get blob() { return this._blob; }
    get objectURL() { return this._objectURL; }
    get error() { return this._error; }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-recorder:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() { return this._errorInfo; }
    get ready() { return this._ready; }
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
    // Errors are dispatched on EVERY non-null occurrence by design — each failure is a
    // distinct event, so unlike the value setters this is not content-deduped. Only the
    // null→null transition is collapsed (clearing an already-clear error stays silent).
    // The guard is written on null explicitly so it does NOT depend on callers passing a
    // fresh object: a reused/cached non-null detail would still re-notify.
    _setError(error) {
        if (error === null && this._error === null)
            return;
        this._error = error;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // error detail (or null on clear). Fires before the `error` event so an observer
        // binding both sees the classification first, mirroring the io-node family.
        this._commitErrorInfo(error === null ? null : deriveMediaErrorInfo(error));
        this._dispatch("wcs-recorder:error", error);
    }
    // Called only from _setError (which already collapses the null→null transition), so
    // errorInfo transitions exactly when error does — no separate guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._dispatch("wcs-recorder:error-info-changed", info);
    }
    _dispatch(type, detail) {
        this._target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
    }
    // --- Public API ---
    /**
     * Borrow a stream for recording (the direct-channel sink). Synchronous, no
     * await: the live handle is captured by reference and never stored in state.
     * Does NOT stop any previously-borrowed stream — ownership stays with the camera.
     *
     * Re-attaching mid-recording takes effect on the NEXT start(), not the current
     * recording: the live MediaRecorder was already constructed around the previous
     * stream and keeps recording it until stop(). The borrowed reference is swapped so
     * the following start() uses the new stream.
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
    /**
     * Establish monitoring (§3.5). Recording is command-driven — there is no listener
     * or subscription to set up here (the borrowed stream arrives via attachStream and
     * recording is driven by start()/stop()), so observe() is an idempotent no-op that
     * resolves once ready. dispose() is its teardown counterpart.
     */
    observe() {
        return this._ready;
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
        // The PREVIOUS clip's object URL is revoked here, before minting the new one — so
        // any consumer still pointing a `<video src>` at the old URL will break once a new
        // recording completes. Consumers must follow the latest `objectURL`/`recorded`
        // value and not pin a stale URL. (The `blob` is unaffected — prefer flowing it.)
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
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...RecorderCore.wcBindable,
        // `mimeType` deliberately appears on TWO surfaces: as an output `property`
        // (inherited from RecorderCore — the browser-resolved recording type, event
        // `mimetype-changed`) and as an `input` (the `mime-type` request attribute). They
        // share a base name but are distinct directions: the property is read-only output
        // (getter → Core), the input is the write-only request (setter → attribute, read
        // back in _options()). See README "request vs. resolved".
        inputs: [
            { name: "mimeType", attribute: "mime-type" },
            { name: "timeslice", attribute: "timeslice" },
            { name: "audioBitsPerSecond", attribute: "audio-bits" },
            { name: "videoBitsPerSecond", attribute: "video-bits" },
        ],
        commands: RecorderCore.wcBindable.commands,
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new RecorderCore(this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-recorder:recording-changed": (d) => ({ recording: d === true }),
            "wcs-recorder:paused-changed": (d) => ({ paused: d === true }),
            "wcs-recorder:error": (d) => ({ error: d != null }),
        });
    }
    // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
    // wc-bindable (not a bind target); see README "CSS styling with :state()".
    // MUST NOT return the live CustomStateSet (that would let callers write
    // states from outside, defeating the point of :state() being read-only).
    get debugStates() {
        return this._internals ? [...this._internals.states] : [];
    }
    _initInternals() {
        // never-throw (docs/custom-state-reflection-design.md §3.4): attachInternals is
        // absent in happy-dom / older environments, and pre-125 Chromium rejects
        // non-dashed state names from states.add() (probed and discarded here). Either
        // case silently disables reflection — the component still works, it just doesn't
        // expose :state() selectors.
        try {
            if (typeof this.attachInternals !== "function")
                return null;
            const internals = this.attachInternals();
            internals.states.add("wcs-probe");
            internals.states.delete("wcs-probe");
            return internals;
        }
        catch {
            return null;
        }
    }
    _wireStates(map) {
        if (this._internals === null)
            return;
        const states = this._internals.states;
        for (const [event, toStates] of Object.entries(map)) {
            this.addEventListener(event, (e) => {
                const debug = this.hasAttribute("debug-states");
                for (const [name, on] of Object.entries(toStates(e.detail))) {
                    try {
                        // 式文の三項演算子は ESLint no-unused-expressions に抵触するため if/else。
                        if (on) {
                            states.add(name);
                        }
                        else {
                            states.delete(name);
                        }
                    }
                    catch { /* never-throw */ }
                    if (debug)
                        this.toggleAttribute(`data-wcs-state-${name}`, on);
                }
            });
        }
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Attribute accessors ---
    // `mimeType` is an OUTPUT value property (the Core-resolved recording type,
    // published via `wcs-recorder:mimetype-changed`), so the getter delegates to the
    // Core — NOT the `mime-type` input attribute. The attribute is a *request*: the
    // browser may pick a different type, or fill one in when none was requested, and
    // bindings must read the actual value. The input side is read straight from the
    // attribute in `_options()`. The setter still writes the request attribute.
    get mimeType() { return this._core.mimeType; }
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
    /** The last failure's serializable `WcsIoErrorInfo` (Phase 6 taxonomy), or null. */
    get errorInfo() { return this._core.errorInfo; }
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
        // Read the requested type from the input attribute directly — `get mimeType()` is
        // the resolved OUTPUT value, not the request.
        const requested = this.getAttribute("mime-type") ?? "";
        if (requested)
            o.mimeType = requested;
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
        this._connectedCallbackPromise = this._core.observe();
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

export { CameraCore, RecorderCore, WCS_MEDIA_ERROR_CODE, WcsCamera, WcsRecorder, bootstrapCamera, getConfig };
//# sourceMappingURL=index.esm.js.map
