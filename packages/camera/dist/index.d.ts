interface ITagNames {
    readonly camera: string;
    readonly recorder: string;
}
interface IWritableTagNames {
    camera?: string;
    recorder?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
}
interface IWcBindableInput {
    readonly name: string;
    readonly attribute?: string;
}
interface IWcBindableCommand {
    readonly name: string;
    readonly async?: boolean;
}
interface IWcBindable {
    readonly protocol: "wc-bindable";
    readonly version: number;
    readonly properties: IWcBindableProperty[];
    readonly inputs?: IWcBindableInput[];
    readonly commands?: IWcBindableCommand[];
}
/**
 * Permission state for camera / microphone, mirroring the Permissions API
 * `PermissionState` plus `"unsupported"` for environments without
 * `navigator.permissions` (or where the `camera` / `microphone` descriptor
 * cannot be queried, e.g. Firefox).
 */
type MediaPermissionState = "prompt" | "granted" | "denied" | "unsupported";
type FacingMode = "user" | "environment";
/**
 * Normalized getUserMedia / MediaRecorder failure. `name` mirrors the DOMException
 * name (`"NotAllowedError"`, `"NotFoundError"`, `"NotReadableError"`,
 * `"OverconstrainedError"`, …); `"unsupported"` is surfaced when the API is absent
 * or the context is insecure.
 */
interface WcsMediaErrorDetail {
    name: string;
    message: string;
}
/**
 * Settable camera constraints (Shell attributes). `audio` opts microphone in;
 * `facingMode` / `deviceId` / `width` / `height` shape the requested track.
 */
interface CameraConstraints {
    audio?: boolean;
    facingMode?: FacingMode;
    deviceId?: string;
    width?: number;
    height?: number;
}
/**
 * Structured-clone-friendly snapshot of a `MediaDeviceInfo` (video inputs). The
 * live device objects are exposed as plain copies so the list flows through data
 * binding as a value.
 */
interface MediaDeviceSnapshot {
    deviceId: string;
    label: string;
    groupId: string;
    kind: string;
}
/**
 * Value types for CameraCore (headless) — the observable state properties.
 *
 * Note: the live `MediaStream` is intentionally NOT here. It is a non-serializable
 * live handle and never flows through reactive state — it is published only via
 * the `wcs-camera:stream-ready` event for the direct element→element channel.
 * See docs/camera-recorder-tag-design.md §1.
 */
interface WcsCameraCoreValues {
    active: boolean;
    permission: MediaPermissionState;
    audioPermission: MediaPermissionState | null;
    deviceId: string | null;
    devices: MediaDeviceSnapshot[];
    error: WcsMediaErrorDetail | null;
}
type WcsCameraValues = WcsCameraCoreValues;
interface WcsCameraInputs {
    audio: boolean;
    facingMode: FacingMode;
    deviceId: string;
    width: number;
    height: number;
    /** Acquire the camera automatically on connect (otherwise wait for `start()`). */
    autostart: boolean;
    /** Do not suspend the stream when the page is hidden (set while recording). */
    keepAlive: boolean;
}
interface WcsCameraCoreCommands {
    start(): void;
    stop(): void;
    switchCamera(): void;
}
type WcsCameraCommands = WcsCameraCoreCommands;
/**
 * Per-recording parameters accepted by `start()`, mirroring the settable fields
 * of `MediaRecorder`.
 */
interface RecorderOptions {
    mimeType?: string;
    /** Emit `dataavailable` chunks on this interval (ms). Omit to receive one Blob on stop. */
    timeslice?: number;
    audioBitsPerSecond?: number;
    videoBitsPerSecond?: number;
}
/** Detail of the `wcs-recorder:recorded` event — the assembled clip. */
interface WcsRecordedDetail {
    blob: Blob;
    objectURL: string;
    mimeType: string;
    duration: number;
}
/**
 * Value types for RecorderCore (headless) — the observable state properties.
 * `blob` is structured-clone-friendly (a settled value, unlike MediaStream) so it
 * may flow through state. `objectURL` is a string with a revoke lifecycle the Core
 * manages.
 */
interface WcsRecorderCoreValues {
    recording: boolean;
    paused: boolean;
    duration: number;
    mimeType: string;
    blob: Blob | null;
    objectURL: string | null;
    error: WcsMediaErrorDetail | null;
}
type WcsRecorderValues = WcsRecorderCoreValues;
interface WcsRecorderInputs {
    mimeType: string;
    timeslice: number;
    audioBitsPerSecond: number;
    videoBitsPerSecond: number;
}
interface WcsRecorderCoreCommands {
    attachStream(stream: MediaStream): void;
    start(options?: RecorderOptions): void;
    stop(): void;
    pause(): void;
    resume(): void;
}
interface WcsRecorderCommands {
    /** Borrow a stream for recording — the direct-channel sink (`command.attachStream`). */
    attachStream(stream: MediaStream): void;
    start(): void;
    stop(): void;
    pause(): void;
    resume(): void;
}

declare function bootstrapCamera(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

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
declare class CameraCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _active;
    private _permission;
    private _audioPermission;
    private _deviceId;
    private _devices;
    private _error;
    private _stream;
    private _desired;
    private _constraints;
    private _gen;
    private _subscribed;
    private _camWatcher;
    private _micWatcher;
    private _ready;
    constructor(target?: EventTarget);
    get active(): boolean;
    get permission(): MediaPermissionState;
    get audioPermission(): MediaPermissionState | null;
    get deviceId(): string | null;
    get devices(): MediaDeviceSnapshot[];
    get error(): WcsMediaErrorDetail | null;
    get ready(): Promise<void>;
    private _setActive;
    private _setPermission;
    private _setAudioPermission;
    private _setDeviceId;
    private _setDevices;
    private _setError;
    private _dispatch;
    private _devicesEqual;
    /**
     * Begin observing permissions for the given constraints. Idempotent while
     * already subscribed. The first call (or one after dispose()) starts the
     * camera/microphone permission monitors. Acquisition itself is driven separately
     * by start() / autostart — observing does not prompt.
     */
    observe(constraints: CameraConstraints): Promise<void>;
    /** Acquire the camera (sets desired=true). Prompts on first use. */
    start(): void;
    /** Release the camera (sets desired=false), stopping all tracks. */
    stop(): void;
    /** Toggle facingMode (user ↔ environment) and re-acquire if active. */
    switchCamera(): void;
    /**
     * Suspend the live stream while keeping `desired` — for page-hidden. Stops tracks
     * (clearing the hardware indicator) but remembers that the camera should resume.
     */
    suspend(): void;
    /** Re-acquire if the camera is desired but not currently active — for page-visible. */
    resume(): void;
    /** Tear down: stop the stream and detach permission listeners. */
    dispose(): void;
    private _initPermissions;
    private _onDeviceChange;
    private _reconcileAudioWatcher;
    private _restart;
    private _acquire;
    private _release;
    private _onTrackEnded;
    private _updateDeviceId;
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
declare class WcsCamera extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    static observedAttributes: string[];
    private _core;
    private _video;
    private _connectedCallbackPromise;
    private _connected;
    constructor();
    get audio(): boolean;
    set audio(value: boolean);
    get facingMode(): FacingMode;
    set facingMode(value: FacingMode);
    get deviceId(): string;
    set deviceId(value: string);
    get width(): number;
    set width(value: number);
    get height(): number;
    set height(value: number);
    get autostart(): boolean;
    set autostart(value: boolean);
    get keepAlive(): boolean;
    set keepAlive(value: boolean);
    /** The internal preview `<video>` (for advanced styling/measurement). */
    get videoElement(): HTMLVideoElement;
    get active(): boolean;
    get permission(): MediaPermissionState;
    get audioPermission(): MediaPermissionState | null;
    get devices(): MediaDeviceSnapshot[];
    get error(): WcsMediaErrorDetail | null;
    get connectedCallbackPromise(): Promise<void>;
    start(): void;
    stop(): void;
    switchCamera(): void;
    private _toggleAttr;
    private _numberAttr;
    private _constraints;
    private _onStreamReady;
    private _onActiveChanged;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void;
    private _onVisibilityChange;
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
declare class RecorderCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _recording;
    private _paused;
    private _duration;
    private _mimeType;
    private _blob;
    private _objectURL;
    private _error;
    private _recorder;
    private _stream;
    private _chunks;
    private _timeslice;
    private _startTime;
    private _gen;
    constructor(target?: EventTarget);
    get recording(): boolean;
    get paused(): boolean;
    get duration(): number;
    get mimeType(): string;
    get blob(): Blob | null;
    get objectURL(): string | null;
    get error(): WcsMediaErrorDetail | null;
    private _setRecording;
    private _setPaused;
    private _setDuration;
    private _setMimeType;
    private _setError;
    private _dispatch;
    /**
     * Borrow a stream for recording (the direct-channel sink). Synchronous, no
     * await: the live handle is captured by reference and never stored in state.
     * Does NOT stop any previously-borrowed stream — ownership stays with the camera.
     */
    attachStream(stream: MediaStream): void;
    /** Start recording the borrowed stream. Never throws — surfaces `error`. */
    start(options?: RecorderOptions): void;
    /** Stop recording; the assembled Blob is published from the recorder's onstop. */
    stop(): void;
    pause(): void;
    resume(): void;
    /** Stop in-flight recording, revoke the last object URL, drop the borrowed stream. */
    dispose(): void;
    private _assembleBlob;
    private _revokeUrl;
    private _createUrl;
    private _isTypeSupported;
    private _now;
    private _elapsed;
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
declare class WcsRecorder extends HTMLElement {
    static wcBindable: IWcBindable;
    private _core;
    constructor();
    get mimeType(): string;
    set mimeType(value: string);
    get timeslice(): number;
    set timeslice(value: number);
    get audioBitsPerSecond(): number;
    set audioBitsPerSecond(value: number);
    get videoBitsPerSecond(): number;
    set videoBitsPerSecond(value: number);
    get recording(): boolean;
    get paused(): boolean;
    get duration(): number;
    get blob(): Blob | null;
    get objectURL(): string | null;
    get error(): WcsMediaErrorDetail | null;
    /** Borrow a stream (the direct-channel sink). */
    attachStream(stream: MediaStream): void;
    start(): void;
    stop(): void;
    pause(): void;
    resume(): void;
    private _numberAttr;
    private _options;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

export { CameraCore, RecorderCore, WcsCamera, WcsRecorder, bootstrapCamera, getConfig };
export type { CameraConstraints, FacingMode, IWritableConfig, IWritableTagNames, MediaDeviceSnapshot, MediaPermissionState, RecorderOptions, WcsCameraCommands, WcsCameraCoreCommands, WcsCameraCoreValues, WcsCameraInputs, WcsCameraValues, WcsMediaErrorDetail, WcsRecordedDetail, WcsRecorderCommands, WcsRecorderCoreCommands, WcsRecorderCoreValues, WcsRecorderInputs, WcsRecorderValues };
