/** operation error の phase(taxonomy)。 */
type WcsIoErrorPhase = "probe" | "start" | "execute" | "decode" | "commit" | "dispose";
/** serializable な error info(non-cloneable な cause とは分離。DevTools / remote へは info のみ)。 */
interface WcsIoErrorInfo {
    readonly code: string;
    readonly phase: WcsIoErrorPhase;
    readonly recoverable: boolean;
    readonly capabilityId?: string;
    readonly message: string;
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
    /** Integer protocol version. All versions >= 1 are core-compatible. */
    readonly version: number;
    readonly properties: readonly IWcBindableProperty[];
    readonly inputs?: readonly IWcBindableInput[];
    readonly commands?: readonly IWcBindableCommand[];
}

interface ITagNames {
    readonly speak: string;
    readonly listen: string;
}
interface IWritableTagNames {
    speak?: string;
    listen?: string;
}
interface IConfig {
    readonly autoTrigger: boolean;
    /** DOM autoTrigger attribute for `<wcs-speak>` (click → speak). */
    readonly triggerAttribute: string;
    /** DOM autoTrigger attribute for `<wcs-listen>` (click → toggle start/stop). */
    readonly listenTriggerAttribute: string;
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    autoTrigger?: boolean;
    triggerAttribute?: string;
    listenTriggerAttribute?: string;
    tagNames?: IWritableTagNames;
}

/**
 * Structured-clone-friendly snapshot of a `SpeechSynthesisVoice`. The live voice
 * objects are not serializable and cannot flow through data binding, so the Core
 * exposes this plain copy. `name` is the selection key used by the `voice`
 * input.
 */
interface SpeechVoiceInfo {
    name: string;
    lang: string;
    default: boolean;
    localService: boolean;
    voiceURI: string;
}
/**
 * Normalized speech-synthesis failure. `error` mirrors
 * `SpeechSynthesisErrorEvent.error` (e.g. `"canceled"`, `"interrupted"`,
 * `"not-allowed"`, `"synthesis-failed"`); `"unsupported"` is surfaced when the
 * SpeechSynthesis API is absent.
 */
interface WcsSpeakErrorDetail {
    error: string;
    message: string;
}
/**
 * Per-utterance parameters accepted by `speak()`, mirroring the settable fields
 * of `SpeechSynthesisUtterance`. `voice` selects a voice by its `name`.
 */
interface SpeakOptions {
    rate?: number;
    pitch?: number;
    volume?: number;
    voice?: string;
    lang?: string;
}
/**
 * Value types for SpeakCore (headless) — the observable state properties. Use
 * with `bind()` from `a wc-bindable binding core` for compile-time type checking.
 */
interface WcsSpeakCoreValues {
    voices: SpeechVoiceInfo[];
    speaking: boolean;
    paused: boolean;
    pending: boolean;
    charIndex: number | null;
    spokenWord: string | null;
    error: WcsSpeakErrorDetail | null;
    /** Phase 6 serializable failure taxonomy derived from `error`, or null. */
    errorInfo: WcsIoErrorInfo | null;
    unsupported: boolean;
}
/**
 * Value types for the Shell (`<wcs-speak>`) — the Core's observable surface plus
 * the reactive `say` command-property.
 */
interface WcsSpeakValues extends WcsSpeakCoreValues {
    say: string;
}
interface WcsSpeakInputs {
    /**
     * Reactive command-property (no mirrored attribute): writing a value speaks it.
     * A same-value write is suppressed, so it fires only when the bound source
     * actually changes — ideal for status / a11y announcements. Bind through a
     * `|debounce` filter when wired to a rapidly-changing source (e.g. an
     * `<input>` value). For "speak this on demand, even the same text again", use
     * the imperative `speak` command instead.
     */
    say: string;
    rate: number;
    pitch: number;
    volume: number;
    voice: string;
    lang: string;
    /**
     * Suppress the reactive `say` path. The imperative `speak` command still
     * works. Also the hook used to mute speaking while listening, to avoid a
     * recognition echo loop.
     */
    manual: boolean;
}
interface WcsSpeakCoreCommands {
    speak(text: string, options?: SpeakOptions): void;
    cancel(): void;
    pause(): void;
    resume(): void;
}
interface WcsSpeakCommands {
    speak(text: string): void;
    cancel(): void;
    pause(): void;
    resume(): void;
}
/**
 * Permission state for the microphone, mirroring the Permissions API
 * `PermissionState` plus `"unsupported"` for environments without
 * `navigator.permissions` (or where the `microphone` permission cannot be
 * queried).
 */
type ListenPermissionState = "prompt" | "granted" | "denied" | "unsupported";
interface WcsListenAlternative {
    transcript: string;
    confidence: number;
}
/**
 * Structured-clone-friendly snapshot of the most recent recognition result —
 * the top alternative flattened (`transcript` / `confidence`) plus the full
 * `alternatives` list and whether the result is final.
 */
interface WcsListenResultDetail {
    transcript: string;
    confidence: number;
    isFinal: boolean;
    alternatives: WcsListenAlternative[];
}
/**
 * Normalized recognition failure. `error` mirrors
 * `SpeechRecognitionErrorEvent.error` (e.g. `"no-speech"`, `"not-allowed"`,
 * `"network"`, `"aborted"`); `"unsupported"` is surfaced when the
 * SpeechRecognition API is absent.
 */
interface WcsListenErrorDetail {
    error: string;
    message: string;
}
/**
 * Options accepted by `start()`, mirroring the settable fields of
 * `SpeechRecognition`.
 */
interface ListenOptions {
    lang?: string;
    continuous?: boolean;
    interimResults?: boolean;
    maxAlternatives?: number;
    /**
     * Maximum number of automatic session restarts in continuous mode before
     * giving up. Bounds the auto-restart loop so a persistent failure cannot spin
     * forever or exhaust quota.
     */
    maxRestarts?: number;
}
/**
 * Value types for ListenCore (headless) — the observable state properties.
 */
interface WcsListenCoreValues {
    interimTranscript: string;
    finalTranscript: string;
    result: WcsListenResultDetail | null;
    listening: boolean;
    permission: ListenPermissionState;
    error: WcsListenErrorDetail | null;
    /** Phase 6 serializable failure taxonomy derived from `error`, or null. */
    errorInfo: WcsIoErrorInfo | null;
    unsupported: boolean;
}
/**
 * Value types for the Shell (`<wcs-listen>`) — the Core's observable surface plus
 * the DOM-driven `trigger` command-property.
 */
interface WcsListenValues extends WcsListenCoreValues {
    trigger: boolean;
}
interface WcsListenInputs {
    lang: string;
    continuous: boolean;
    interim: boolean;
    maxRestarts: number;
    manual: boolean;
    /**
     * Momentary command-property (no mirrored attribute): a `false`→`true` write
     * starts a recognition session, then the flag immediately resets to `false`.
     */
    trigger: boolean;
}
interface WcsListenCoreCommands {
    start(options?: ListenOptions): void;
    stop(): void;
    abort(): void;
}
interface WcsListenCommands {
    start(): void;
    stop(): void;
    abort(): void;
}

declare function bootstrapSpeech(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

/**
 * Headless text-to-speech primitive. A thin, framework-agnostic wrapper around
 * the SpeechSynthesis API exposed through the wc-bindable protocol.
 *
 * It is the "command" half of the speech package (the recognition half is
 * ListenCore): state drives the element, never the reverse, except for the
 * observable progress/status it publishes back.
 *
 * - **speak(text, options)** queues an utterance. Like the native API, multiple
 *   calls queue; `cancel()` clears the queue and stops the current utterance.
 * - **pause() / resume()** suspend and resume the queue.
 * - The observable surface mirrors the live SpeechSynthesis flags
 *   (`speaking` / `paused` / `pending`) and exposes voice-list loading
 *   (`voices`, which the API populates asynchronously via `voiceschanged`) plus
 *   word-boundary progress (`charIndex` / `spokenWord`) for karaoke-style
 *   highlighting.
 *
 * Unlike geolocation/clipboard there is no permission gate — synthesis needs no
 * user grant. Failures never throw: they surface through the `error` property so
 * they flow into the declarative state.
 */
declare class SpeakCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _voices;
    private _rawVoices;
    private _speaking;
    private _paused;
    private _pending;
    private _charIndex;
    private _spokenWord;
    private _error;
    private _errorInfo;
    private _unsupported;
    private _queued;
    private _started;
    private _gen;
    private _voicesSubscribed;
    private _ready;
    constructor(target?: EventTarget);
    get voices(): SpeechVoiceInfo[];
    get speaking(): boolean;
    get paused(): boolean;
    get pending(): boolean;
    get charIndex(): number | null;
    get spokenWord(): string | null;
    get error(): WcsSpeakErrorDetail | null;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-speak:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    get unsupported(): boolean;
    /** Resolves once the first probe settles (immediate — see `_ready`). */
    get ready(): Promise<void>;
    private _setVoices;
    private _voicesEqual;
    private _setSpeaking;
    private _setPaused;
    private _setPending;
    private _setBoundary;
    private _setError;
    private _commitErrorInfo;
    private _setUnsupported;
    /**
     * Queue an utterance for `text` with optional per-utterance parameters. Never
     * throws: when the API is unavailable it surfaces an `error` and returns. An
     * empty/whitespace-only `text` is a no-op (the browser would not fire start).
     */
    speak(text: string, options?: SpeakOptions): void;
    /**
     * Clear the queue and stop the current utterance immediately. Resets all
     * progress state synchronously and invalidates in-flight utterance callbacks
     * (the browser fires a "canceled" error per utterance) so they do not surface
     * as real errors.
     */
    cancel(): void;
    pause(): void;
    resume(): void;
    /**
     * Re-establish the voiceschanged subscription after a dispose() — e.g. the
     * Shell element was disconnected and then reconnected (reparented). No-op while
     * a subscription is already live, so the first connect after construction does
     * not double-subscribe.
     */
    reinitVoices(): void;
    /**
     * Establish monitoring (§3.5). Synthesis is command-driven (speak/cancel), so
     * observe() only (re-)establishes the live `voiceschanged` subscription —
     * idempotent via reinitVoices()'s `_voicesSubscribed` guard, so the first
     * connect after construction does not double-subscribe while a reconnect after
     * dispose() does. Returns the `ready` promise for SSR. Call from the Shell's
     * connectedCallback.
     */
    observe(): Promise<void>;
    /**
     * Detach the live voiceschanged listener and neutralize any in-flight
     * utterance callbacks. Call from the Shell's `disconnectedCallback`.
     */
    dispose(): void;
    private _finishUtterance;
    private _hasApi;
    private _initVoices;
    private _onVoicesChanged;
    private _loadVoices;
    private _normalizeVoice;
    private _normalizeError;
    private _unsupportedError;
}

/**
 * `<wcs-speak>` — declarative text-to-speech. Wraps SpeakCore and exposes:
 *
 * - **`say`** (reactive input): writing a value speaks it, suppressing same-value
 *   writes so it fires only when the bound source actually changes. The
 *   imperative `speak` command instead speaks on demand (even the same text
 *   again). See `docs/speech-tag-design.md` § 5.
 * - per-utterance parameters (`rate` / `pitch` / `volume` / `voice` / `lang`) as
 *   mirrored attributes.
 * - the Core's observable surface (voices / speaking / paused / pending /
 *   charIndex / spokenWord / error / unsupported) via delegated getters.
 */
declare class WcsSpeak extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _say;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get connectedCallbackPromise(): Promise<void>;
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get rate(): number;
    set rate(value: number);
    get pitch(): number;
    set pitch(value: number);
    get volume(): number;
    set volume(value: number);
    get voice(): string;
    set voice(value: string | null);
    get lang(): string;
    set lang(value: string | null);
    get manual(): boolean;
    set manual(value: boolean);
    get say(): string;
    set say(value: string | null);
    get voices(): SpeechVoiceInfo[];
    get speaking(): boolean;
    get paused(): boolean;
    get pending(): boolean;
    get charIndex(): number | null;
    get spokenWord(): string | null;
    get error(): WcsSpeakErrorDetail | null;
    get errorInfo(): WcsIoErrorInfo | null;
    get unsupported(): boolean;
    speak(text: string): void;
    cancel(): void;
    pause(): void;
    resume(): void;
    private _numberAttr;
    private _options;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * Headless speech-to-text primitive. A thin, framework-agnostic wrapper around
 * the SpeechRecognition API (vendor-prefixed `webkitSpeechRecognition` in
 * Chrome) exposed through the wc-bindable protocol.
 *
 * It is the "event" half of the speech package (the synthesis half is
 * SpeakCore): recognition results flow element → state.
 *
 * Two phases mirror geolocation:
 * - **one-shot** (`continuous = false`) — recognize until the first `end`.
 * - **continuous** (`continuous = true`) — keep a single session open across
 *   phrases. The browser still ends a session on silence; auto-restart bridges
 *   that gap **but is opt-in via `maxRestarts`**: with the default `maxRestarts
 *   = 0` a continuous session is *not* restarted on `end` (the safe default —
 *   unbounded restart is the infinite-loop risk we guard against). Set
 *   `maxRestarts > 0` to bridge N silences. The cap also stops a persistent
 *   failure (e.g. `not-allowed`) from spinning forever or exhausting quota; a
 *   real result resets the budget so only consecutive empty restarts count.
 *
 * A microphone permission gate (like geolocation's) reflects
 * `navigator.permissions.query({ name: "microphone" })`. Failures never throw —
 * they surface through the `error` property.
 */
declare class ListenCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _recognition;
    private _interimTranscript;
    private _finalTranscript;
    private _result;
    private _listening;
    private _permission;
    private _error;
    private _errorInfo;
    private _unsupported;
    private _active;
    private _continuous;
    private _maxRestarts;
    private _restartCount;
    private _permissionStatus;
    private _permissionSubscribed;
    private _permGen;
    private _ready;
    constructor(target?: EventTarget);
    get interimTranscript(): string;
    get finalTranscript(): string;
    get result(): WcsListenResultDetail | null;
    get listening(): boolean;
    get permission(): ListenPermissionState;
    get error(): WcsListenErrorDetail | null;
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-listen:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo(): WcsIoErrorInfo | null;
    get unsupported(): boolean;
    /** Resolves once the first probe settles (immediate — see `_ready`). */
    get ready(): Promise<void>;
    private _setInterim;
    private _setFinal;
    private _setResult;
    private _setListening;
    private _setPermission;
    private _setError;
    private _commitErrorInfo;
    private _setUnsupported;
    /**
     * Begin a recognition session. Resets the transcripts (a fresh, user-initiated
     * listen), applies options, and starts. Idempotent while already listening: a
     * redundant start() is ignored so the browser does not throw "recognition has
     * already started".
     */
    start(options?: ListenOptions): void;
    stop(): void;
    abort(): void;
    /**
     * Re-establish the permission `change` subscription after a dispose().
     */
    reinitPermission(): void;
    /**
     * Establish monitoring (§3.5). Recognition is command-driven (start/stop), so
     * observe() only (re-)establishes the live permission subscription — idempotent
     * via reinitPermission()'s `_permissionSubscribed` guard, so the first connect
     * after construction does not double-subscribe while a reconnect after dispose()
     * does. Returns the `ready` promise for SSR. Call from the Shell's
     * connectedCallback.
     */
    observe(): Promise<void>;
    /**
     * Stop recognition and detach the live permission listener. Call from the
     * Shell's `disconnectedCallback`.
     */
    dispose(): void;
    private _attachHandlers;
    private _handleResult;
    private _normalizeResult;
    private _safeStart;
    private _getCtor;
    private _initPermission;
    private _onPermissionChange;
    private _normalizeError;
    private _unsupportedError;
}

/**
 * `<wcs-listen>` — declarative speech-to-text. Wraps ListenCore and exposes the
 * recognition surface (interim/final transcripts, structured result, listening
 * flag, microphone permission, error) plus the two-phase start/stop/abort
 * commands and a momentary `trigger` for DOM-driven starts.
 *
 * Mirrors `<wcs-geo>`: `manual` suppresses the connect-time auto-start, and the
 * `continuous` attribute selects the auto-restarting session phase.
 */
declare class WcsListen extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static wcBindable: IWcBindable;
    private _core;
    private _trigger;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get connectedCallbackPromise(): Promise<void>;
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get lang(): string;
    set lang(value: string | null);
    get continuous(): boolean;
    set continuous(value: boolean);
    get interim(): boolean;
    set interim(value: boolean);
    get maxRestarts(): number;
    set maxRestarts(value: number);
    get manual(): boolean;
    set manual(value: boolean);
    get interimTranscript(): string;
    get finalTranscript(): string;
    get result(): WcsListenResultDetail | null;
    get listening(): boolean;
    get permission(): ListenPermissionState;
    get error(): WcsListenErrorDetail | null;
    get errorInfo(): WcsIoErrorInfo | null;
    get unsupported(): boolean;
    get trigger(): boolean;
    set trigger(value: boolean);
    start(): void;
    stop(): void;
    abort(): void;
    private _options;
    connectedCallback(): void;
    disconnectedCallback(): void;
}

/**
 * speechCapabilities.ts
 *
 * speech node 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)から
 * import する。speech パッケージは 2 つの Core を持つ:
 *
 * - ListenCore(`<wcs-listen>`, SpeechRecognition / STT) — 認識セッションの
 *   start/stop/abort。監視ではなく command 駆動だが、競合する非同期 operation の lane は
 *   持たない(直近の start が単一セッションを置換する)ため、lane は採用せず error
 *   taxonomy(errorInfo)のみを追加する。
 * - SpeakCore(`<wcs-speak>`, SpeechSynthesis / TTS) — 発話キュー。同上。
 *
 * SpeechRecognitionErrorEvent と SpeechSynthesisErrorEvent は `error` enum の値集合が
 * 異なるため、taxonomy も Core ごとに別 derive を持つ。いずれの Core も error detail の
 * `.error` は既に安定コード(SpeechRecognition/SpeechSynthesis の error enum、または
 * `"unsupported"` fallback)であり Error.name ではないので、derivation は notification と
 * 同型の「`.error` コードを taxonomy に写す純粋 map」である。想定外のコードは防御的に
 * `speech-error` へ畳む。
 */

/** 安定した listen(SpeechRecognition)error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_LISTEN_ERROR_CODE: {
    /** SpeechRecognition API 非対応(`SpeechRecognition` / `webkitSpeechRecognition` 不在)。 */
    readonly CapabilityMissing: "capability-missing";
    /** `not-allowed` / `service-not-allowed` — マイク権限拒否 / サービス不許可。 */
    readonly NotAllowed: "not-allowed";
    /** `audio-capture` — マイクが読めない(不在 / ハードウェア)。 */
    readonly NotReadable: "not-readable";
    /** `no-speech` — 無音のまま検出できず(transient — retry で成功しうる)。 */
    readonly NoSpeech: "no-speech";
    /** `network` — 認識バックエンドへの通信失敗(transient)。 */
    readonly NetworkError: "network-error";
    /** `aborted` — セッションが中断された(transient)。 */
    readonly Aborted: "aborted";
    /** `language-not-supported` / `bad-grammar` — 言語 / 文法が不正(前提条件違反)。 */
    readonly InvalidArgument: "invalid-argument";
    /** その他 / 想定外の error code に対する防御的 fallback。 */
    readonly SpeechError: "speech-error";
};
/** 安定した speak(SpeechSynthesis)error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_SPEAK_ERROR_CODE: {
    /** SpeechSynthesis API 非対応(`speechSynthesis` / `SpeechSynthesisUtterance` 不在)。 */
    readonly CapabilityMissing: "capability-missing";
    /** `not-allowed` — 合成が許可されていない。 */
    readonly NotAllowed: "not-allowed";
    /** `canceled` / `interrupted` — 発話がキャンセル / 中断された(transient)。 */
    readonly Aborted: "aborted";
    /** `audio-busy` / `audio-hardware` — オーディオ出力の占有 / ハードウェア障害。 */
    readonly NotReadable: "not-readable";
    /** `network` — 合成バックエンドへの通信失敗(transient)。 */
    readonly NetworkError: "network-error";
    /** `language-unavailable` / `voice-unavailable` / `text-too-long` / `invalid-argument` —
     *  発話パラメータが不正 / 未対応(前提条件違反)。 */
    readonly InvalidArgument: "invalid-argument";
    /** `synthesis-unavailable` / `synthesis-failed` — 合成そのものが失敗した。 */
    readonly SynthesisFailed: "synthesis-failed";
    /** その他 / 想定外の error code に対する防御的 fallback。 */
    readonly SpeechError: "speech-error";
};

export { ListenCore, SpeakCore, WCS_LISTEN_ERROR_CODE, WCS_SPEAK_ERROR_CODE, WcsListen, WcsSpeak, bootstrapSpeech, getConfig };
export type { IWritableConfig, IWritableTagNames, ListenOptions, ListenPermissionState, SpeakOptions, SpeechVoiceInfo, WcsIoErrorInfo, WcsIoErrorPhase, WcsListenAlternative, WcsListenCommands, WcsListenCoreCommands, WcsListenCoreValues, WcsListenErrorDetail, WcsListenInputs, WcsListenResultDetail, WcsListenValues, WcsSpeakCommands, WcsSpeakCoreCommands, WcsSpeakCoreValues, WcsSpeakErrorDetail, WcsSpeakInputs, WcsSpeakValues };
