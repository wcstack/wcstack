const _config = {
    autoTrigger: true,
    triggerAttribute: "data-speaktarget",
    listenTriggerAttribute: "data-listentarget",
    tagNames: {
        speak: "wcs-speak",
        listen: "wcs-listen",
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
// Internal, mutable live config used by the components/autoTriggers (they read it
// at call time so setConfig() takes effect without re-import). Typed as the
// readonly IConfig at the export boundary — the `as IConfig` is a compile-time
// view only and does NOT freeze the object, so this export must stay
// package-internal (it is not re-exported from exports.ts). Public consumers get
// the deep-frozen clone from getConfig() instead, which is the only safe
// read-only handle.
const config = _config;
function getConfig() {
    if (!frozenConfig) {
        frozenConfig = deepFreeze(deepClone(_config));
    }
    return frozenConfig;
}
function setConfig(partialConfig) {
    if (typeof partialConfig.autoTrigger === "boolean") {
        _config.autoTrigger = partialConfig.autoTrigger;
    }
    if (typeof partialConfig.triggerAttribute === "string") {
        _config.triggerAttribute = partialConfig.triggerAttribute;
    }
    if (typeof partialConfig.listenTriggerAttribute === "string") {
        _config.listenTriggerAttribute = partialConfig.listenTriggerAttribute;
    }
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
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
// ---------------------------------------------------------------------------
// SpeechRecognition (STT) — <wcs-listen>
// ---------------------------------------------------------------------------
/** 安定した listen(SpeechRecognition)error code(taxonomy)。値は公開キーとして固定。 */
const WCS_LISTEN_ERROR_CODE = {
    /** SpeechRecognition API 非対応(`SpeechRecognition` / `webkitSpeechRecognition` 不在)。 */
    CapabilityMissing: "capability-missing",
    /** `not-allowed` / `service-not-allowed` — マイク権限拒否 / サービス不許可。 */
    NotAllowed: "not-allowed",
    /** `audio-capture` — マイクが読めない(不在 / ハードウェア)。 */
    NotReadable: "not-readable",
    /** `no-speech` — 無音のまま検出できず(transient — retry で成功しうる)。 */
    NoSpeech: "no-speech",
    /** `network` — 認識バックエンドへの通信失敗(transient)。 */
    NetworkError: "network-error",
    /** `aborted` — セッションが中断された(transient)。 */
    Aborted: "aborted",
    /** `language-not-supported` / `bad-grammar` — 言語 / 文法が不正(前提条件違反)。 */
    InvalidArgument: "invalid-argument",
    /** その他 / 想定外の error code に対する防御的 fallback。 */
    SpeechError: "speech-error",
};
/**
 * listen(SpeechRecognition)の失敗を serializable な error taxonomy に写す。引数は
 * `wcs-listen:error` の detail(`{ error, message }`)そのもの。`.error` は
 * `SpeechRecognitionErrorEvent.error` enum(または `"unsupported"` / `"aborted"`
 * fallback)で、Error.name ではない。
 *
 * - `"unsupported"` は開始前の能力欠如 → phase="probe" / capability-missing。
 * - `"not-allowed"` / `"service-not-allowed"` はマイク権限拒否 → phase="start" /
 *   not-allowed。回復しない(recoverable=false)。ListenCore はこの 2 つを終端扱いにし
 *   自動再開を止める。
 * - `"audio-capture"` はマイクの読取失敗 → phase="start" / not-readable / false。
 * - `"no-speech"` / `"network"` / `"aborted"` は transient で、continuous セッションは
 *   `maxRestarts` の範囲で自動再開しうる → phase="execute" / recoverable=true。
 * - `"language-not-supported"` / `"bad-grammar"` は言語 / 文法の前提違反 →
 *   phase="start" / invalid-argument / false。
 * - それ以外(未知コード)は防御的に phase="execute" / speech-error / false。
 */
function deriveListenErrorInfo(error) {
    const { error: code, message } = error;
    switch (code) {
        case "unsupported":
            return { code: WCS_LISTEN_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
        case "not-allowed":
        case "service-not-allowed":
            return { code: WCS_LISTEN_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
        case "audio-capture":
            return { code: WCS_LISTEN_ERROR_CODE.NotReadable, phase: "start", recoverable: false, message };
        case "no-speech":
            return { code: WCS_LISTEN_ERROR_CODE.NoSpeech, phase: "execute", recoverable: true, message };
        case "network":
            return { code: WCS_LISTEN_ERROR_CODE.NetworkError, phase: "execute", recoverable: true, message };
        case "aborted":
            return { code: WCS_LISTEN_ERROR_CODE.Aborted, phase: "execute", recoverable: true, message };
        case "language-not-supported":
        case "bad-grammar":
            return { code: WCS_LISTEN_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
        default:
            return { code: WCS_LISTEN_ERROR_CODE.SpeechError, phase: "execute", recoverable: false, message };
    }
}
// ---------------------------------------------------------------------------
// SpeechSynthesis (TTS) — <wcs-speak>
// ---------------------------------------------------------------------------
/** 安定した speak(SpeechSynthesis)error code(taxonomy)。値は公開キーとして固定。 */
const WCS_SPEAK_ERROR_CODE = {
    /** SpeechSynthesis API 非対応(`speechSynthesis` / `SpeechSynthesisUtterance` 不在)。 */
    CapabilityMissing: "capability-missing",
    /** `not-allowed` — 合成が許可されていない。 */
    NotAllowed: "not-allowed",
    /** `canceled` / `interrupted` — 発話がキャンセル / 中断された(transient)。 */
    Aborted: "aborted",
    /** `audio-busy` / `audio-hardware` — オーディオ出力の占有 / ハードウェア障害。 */
    NotReadable: "not-readable",
    /** `network` — 合成バックエンドへの通信失敗(transient)。 */
    NetworkError: "network-error",
    /** `language-unavailable` / `voice-unavailable` / `text-too-long` / `invalid-argument` —
     *  発話パラメータが不正 / 未対応(前提条件違反)。 */
    InvalidArgument: "invalid-argument",
    /** `synthesis-unavailable` / `synthesis-failed` — 合成そのものが失敗した。 */
    SynthesisFailed: "synthesis-failed",
    /** その他 / 想定外の error code に対する防御的 fallback。 */
    SpeechError: "speech-error",
};
/**
 * speak(SpeechSynthesis)の失敗を serializable な error taxonomy に写す。引数は
 * `wcs-speak:error` の detail(`{ error, message }`)そのもの。`.error` は
 * `SpeechSynthesisErrorEvent.error` enum(または `"unsupported"` /
 * `"synthesis-failed"` fallback)で、Error.name ではない。
 *
 * - `"unsupported"` は開始前の能力欠如 → phase="probe" / capability-missing。
 * - `"not-allowed"` は合成不許可 → phase="start" / not-allowed / false。
 * - `"canceled"` / `"interrupted"` は cancel()/後続発話による中断 → phase="execute" /
 *   aborted / recoverable=true(通常は SpeakCore の世代ガードが握りつぶすため error として
 *   表面化しないが、防御的に写す)。
 * - `"audio-busy"` はオーディオ占有で transient(retry で回復しうる)→ phase="execute" /
 *   not-readable / recoverable=true。`"audio-hardware"` はハードウェア障害で回復しない →
 *   同 not-readable だが recoverable=false。
 * - `"network"` は transient → phase="execute" / network-error / recoverable=true。
 * - `"language-unavailable"` / `"voice-unavailable"` / `"text-too-long"` /
 *   `"invalid-argument"` は発話パラメータの前提違反 → phase="start" / invalid-argument /
 *   false。
 * - `"synthesis-unavailable"` / `"synthesis-failed"` は合成実行の失敗 → phase="execute" /
 *   synthesis-failed / false。
 * - それ以外(未知コード)は防御的に phase="execute" / speech-error / false。
 */
function deriveSpeakErrorInfo(error) {
    const { error: code, message } = error;
    switch (code) {
        case "unsupported":
            return { code: WCS_SPEAK_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
        case "not-allowed":
            return { code: WCS_SPEAK_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
        case "canceled":
        case "interrupted":
            return { code: WCS_SPEAK_ERROR_CODE.Aborted, phase: "execute", recoverable: true, message };
        case "audio-busy":
            return { code: WCS_SPEAK_ERROR_CODE.NotReadable, phase: "execute", recoverable: true, message };
        case "audio-hardware":
            return { code: WCS_SPEAK_ERROR_CODE.NotReadable, phase: "execute", recoverable: false, message };
        case "network":
            return { code: WCS_SPEAK_ERROR_CODE.NetworkError, phase: "execute", recoverable: true, message };
        case "language-unavailable":
        case "voice-unavailable":
        case "text-too-long":
        case "invalid-argument":
            return { code: WCS_SPEAK_ERROR_CODE.InvalidArgument, phase: "start", recoverable: false, message };
        case "synthesis-unavailable":
        case "synthesis-failed":
            return { code: WCS_SPEAK_ERROR_CODE.SynthesisFailed, phase: "execute", recoverable: false, message };
        default:
            return { code: WCS_SPEAK_ERROR_CODE.SpeechError, phase: "execute", recoverable: false, message };
    }
}

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
class SpeakCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "voices", event: "wcs-speak:voices-changed" },
            { name: "speaking", event: "wcs-speak:speaking-changed" },
            { name: "paused", event: "wcs-speak:paused-changed" },
            { name: "pending", event: "wcs-speak:pending-changed" },
            { name: "charIndex", event: "wcs-speak:boundary", getter: (e) => e.detail?.charIndex ?? null },
            { name: "spokenWord", event: "wcs-speak:boundary", getter: (e) => e.detail?.word ?? null },
            { name: "error", event: "wcs-speak:error" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error.error` (the
            // SpeechSynthesisErrorEvent.error code / "unsupported"); the existing `error`
            // property/event are unchanged. Fires wcs-speak:error-info-changed. No lane —
            // speak() is a momentary queue submission with no competing async operation to
            // serialize.
            { name: "errorInfo", event: "wcs-speak:error-info-changed" },
            { name: "unsupported", event: "wcs-speak:unsupported-changed" },
        ],
        commands: [
            { name: "speak" },
            { name: "cancel" },
            { name: "pause" },
            { name: "resume" },
        ],
    };
    _target;
    _voices = [];
    _rawVoices = [];
    _speaking = false;
    _paused = false;
    _pending = false;
    _charIndex = null;
    _spokenWord = null;
    _error = null;
    _errorInfo = null;
    _unsupported = false;
    // Count of utterances submitted via speak() but not yet started, and of
    // utterances started but not yet ended/errored. `pending`/`speaking` are
    // derived from these so the queue model is reflected accurately even when
    // several utterances are in flight.
    _queued = 0;
    _started = 0;
    // Monotonic id of the current synthesis lifecycle. Bumped by cancel() and
    // dispose(). Each speak() captures it; every utterance event handler bails if
    // it is stale, so a queued/canceled utterance's late callback (notably the
    // "canceled" error the browser fires from cancel()) never mutates state or
    // dispatches on a torn-down element.
    _gen = 0;
    // True once the voiceschanged subscription has been (or is being) established;
    // reset by dispose(). Guards reinitVoices() so the first connect after
    // construction does not double-subscribe, while a reconnect after dispose()
    // does re-subscribe.
    _voicesSubscribed = false;
    // SSR: feature detection (`_setUnsupported`) and the initial `getVoices()` read
    // are synchronous, and the `voiceschanged` subscription is established eagerly
    // in the constructor, so there is no asynchronous probe to await before
    // snapshotting — readiness is immediate. The Shell exposes this as
    // connectedCallbackPromise.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
        // Probe support up front so observers see the real flag before the first read.
        // Routed through the setter (not a direct assignment) so the field starts at
        // its `false` default and the unsupported case actually transitions
        // false→true; the supported case is same-value guarded and dispatches nothing.
        this._setUnsupported(!this._hasApi());
        this._initVoices();
    }
    get voices() {
        return this._voices;
    }
    get speaking() {
        return this._speaking;
    }
    get paused() {
        return this._paused;
    }
    get pending() {
        return this._pending;
    }
    get charIndex() {
        return this._charIndex;
    }
    get spokenWord() {
        return this._spokenWord;
    }
    get error() {
        return this._error;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-speak:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    // Resolved once in the constructor (`_setUnsupported(!_hasApi())`) and never
    // re-evaluated: the speechSynthesis API's presence is immutable for the
    // lifetime of a document, so there's nothing to re-check.
    get unsupported() {
        return this._unsupported;
    }
    /** Resolves once the first probe settles (immediate — see `_ready`). */
    get ready() {
        return this._ready;
    }
    // --- State setters with event dispatch ---
    _setVoices(voices) {
        // Same-value guard, like the other setters. `voiceschanged` can fire several
        // times with an identical list (engines re-announce after warm-up); compare
        // the normalized snapshot content so a redundant re-announcement does not
        // re-dispatch voices-changed. A genuine list change (length or any field)
        // still fires.
        if (this._voicesEqual(this._voices, voices))
            return;
        this._voices = voices;
        this._target.dispatchEvent(new CustomEvent("wcs-speak:voices-changed", {
            detail: voices,
            bubbles: true,
        }));
    }
    _voicesEqual(a, b) {
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            const x = a[i];
            const y = b[i];
            if (x.name !== y.name || x.lang !== y.lang || x.default !== y.default
                || x.localService !== y.localService || x.voiceURI !== y.voiceURI) {
                return false;
            }
        }
        return true;
    }
    _setSpeaking(speaking) {
        if (this._speaking === speaking)
            return;
        this._speaking = speaking;
        this._target.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", {
            detail: speaking,
            bubbles: true,
        }));
    }
    _setPaused(paused) {
        if (this._paused === paused)
            return;
        this._paused = paused;
        this._target.dispatchEvent(new CustomEvent("wcs-speak:paused-changed", {
            detail: paused,
            bubbles: true,
        }));
    }
    _setPending(pending) {
        if (this._pending === pending)
            return;
        this._pending = pending;
        this._target.dispatchEvent(new CustomEvent("wcs-speak:pending-changed", {
            detail: pending,
            bubbles: true,
        }));
    }
    _setBoundary(charIndex, word) {
        // Boundary events stream rapidly with changing offsets; dispatch each. The
        // guard only suppresses redundant resets (e.g. an end after an already-null
        // boundary) so a cleared highlight does not re-fire.
        if (this._charIndex === charIndex && this._spokenWord === word)
            return;
        this._charIndex = charIndex;
        this._spokenWord = word;
        this._target.dispatchEvent(new CustomEvent("wcs-speak:boundary", {
            detail: { charIndex, word },
            bubbles: true,
        }));
    }
    _setError(error) {
        if (this._error === error)
            return;
        this._error = error;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // error code (or null on clear). Fires before the `error` event so an observer
        // binding both sees the classification first, mirroring the io-node family.
        this._commitErrorInfo(error === null ? null : deriveSpeakErrorInfo(error));
        this._target.dispatchEvent(new CustomEvent("wcs-speak:error", {
            detail: error,
            bubbles: true,
        }));
    }
    // Called only from _setError (which already guards on error identity), so
    // errorInfo transitions exactly when error does — no separate guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-speak:error-info-changed", {
            detail: info,
            bubbles: true,
        }));
    }
    _setUnsupported(unsupported) {
        if (this._unsupported === unsupported)
            return;
        this._unsupported = unsupported;
        this._target.dispatchEvent(new CustomEvent("wcs-speak:unsupported-changed", {
            detail: unsupported,
            bubbles: true,
        }));
    }
    // --- Public API ---
    /**
     * Queue an utterance for `text` with optional per-utterance parameters. Never
     * throws: when the API is unavailable it surfaces an `error` and returns. An
     * empty/whitespace-only `text` is a no-op (the browser would not fire start).
     */
    speak(text, options = {}) {
        if (!this._hasApi()) {
            this._setError(this._unsupportedError());
            return;
        }
        if (typeof text !== "string" || text.trim() === "") {
            return;
        }
        const synth = window.speechSynthesis;
        const utterance = new window.SpeechSynthesisUtterance(text);
        if (typeof options.rate === "number")
            utterance.rate = options.rate;
        if (typeof options.pitch === "number")
            utterance.pitch = options.pitch;
        if (typeof options.volume === "number")
            utterance.volume = options.volume;
        if (typeof options.lang === "string" && options.lang !== "")
            utterance.lang = options.lang;
        if (typeof options.voice === "string" && options.voice !== "") {
            const match = this._rawVoices.find((v) => v.name === options.voice);
            if (match)
                utterance.voice = match;
        }
        const gen = this._gen;
        // Per-utterance "has started" flag. The browser can fire onerror/onend
        // *before* onstart (e.g. a `synthesis-unavailable` / `audio-busy` failure on
        // a still-queued utterance). In that case the utterance only ever counted
        // toward `_queued`, so the terminal handler must decrement `_queued` — not
        // `_started` — otherwise `pending` (derived from `_queued > 0`) sticks true
        // forever. onstart sets this flag so the terminal handler knows which counter
        // to release.
        let started = false;
        utterance.onstart = () => {
            if (gen !== this._gen)
                return;
            started = true;
            this._queued = Math.max(0, this._queued - 1);
            this._started++;
            this._setSpeaking(true);
            this._setPending(this._queued > 0);
            this._setBoundary(null, null);
        };
        utterance.onboundary = (event) => {
            if (gen !== this._gen)
                return;
            try {
                const charIndex = event.charIndex;
                const length = event.charLength;
                // Prefer the engine-provided word length. Some engines omit `charLength`
                // on word boundaries; fall back to the run of non-whitespace at charIndex
                // so `spokenWord` (the karaoke highlight) still works there.
                const word = (typeof length === "number" && length > 0)
                    ? text.substring(charIndex, charIndex + length)
                    : (text.slice(charIndex).match(/^\S+/)?.[0] ?? "");
                this._setBoundary(charIndex, word);
            }
            catch {
                // A malformed boundary event must not escape the browser callback.
            }
        };
        utterance.onpause = () => {
            if (gen !== this._gen)
                return;
            this._setPaused(true);
        };
        utterance.onresume = () => {
            if (gen !== this._gen)
                return;
            this._setPaused(false);
        };
        utterance.onend = () => {
            if (gen !== this._gen)
                return;
            this._finishUtterance(started);
        };
        utterance.onerror = (event) => {
            if (gen !== this._gen)
                return;
            this._setError(this._normalizeError(event));
            this._finishUtterance(started);
        };
        this._setError(null);
        this._queued++;
        this._setPending(true);
        synth.speak(utterance);
    }
    /**
     * Clear the queue and stop the current utterance immediately. Resets all
     * progress state synchronously and invalidates in-flight utterance callbacks
     * (the browser fires a "canceled" error per utterance) so they do not surface
     * as real errors.
     */
    cancel() {
        if (!this._hasApi())
            return;
        // Neutralize every in-flight utterance's pending callbacks before triggering
        // the native cancel (which fires "canceled" onerror/onend on each).
        this._gen++;
        // Chrome quirk: cancelling while the engine is paused can leave the synth in
        // a state where the *next* speak() produces no audio. Resume first so cancel
        // happens from a running state. resume() on an idle/non-paused engine is a
        // harmless no-op, so guarding on the tracked `_paused` flag is sufficient.
        if (this._paused) {
            window.speechSynthesis.resume();
        }
        window.speechSynthesis.cancel();
        this._queued = 0;
        this._started = 0;
        this._setSpeaking(false);
        this._setPending(false);
        this._setPaused(false);
        this._setBoundary(null, null);
    }
    pause() {
        if (!this._hasApi())
            return;
        window.speechSynthesis.pause();
    }
    resume() {
        if (!this._hasApi())
            return;
        window.speechSynthesis.resume();
    }
    /**
     * Re-establish the voiceschanged subscription after a dispose() — e.g. the
     * Shell element was disconnected and then reconnected (reparented). No-op while
     * a subscription is already live, so the first connect after construction does
     * not double-subscribe.
     */
    reinitVoices() {
        if (!this._voicesSubscribed) {
            this._initVoices();
        }
    }
    /**
     * Establish monitoring (§3.5). Synthesis is command-driven (speak/cancel), so
     * observe() only (re-)establishes the live `voiceschanged` subscription —
     * idempotent via reinitVoices()'s `_voicesSubscribed` guard, so the first
     * connect after construction does not double-subscribe while a reconnect after
     * dispose() does. Returns the `ready` promise for SSR. Call from the Shell's
     * connectedCallback.
     */
    observe() {
        this.reinitVoices();
        return this._ready;
    }
    /**
     * Detach the live voiceschanged listener and neutralize any in-flight
     * utterance callbacks. Call from the Shell's `disconnectedCallback`.
     */
    dispose() {
        this._voicesSubscribed = false;
        this._gen++;
        // Reset the queue bookkeeping silently (no dispatch on a disposed element);
        // a reconnect starts fresh. The observable snapshot (error / charIndex /
        // spokenWord) is intentionally *kept* so a reparented element preserves its
        // last state, mirroring GeolocationCore.dispose(). The next speak() resets
        // error / boundary for its own lifecycle.
        this._queued = 0;
        this._started = 0;
        this._speaking = false;
        this._paused = false;
        this._pending = false;
        if (this._hasApi()) {
            window.speechSynthesis.removeEventListener("voiceschanged", this._onVoicesChanged);
        }
    }
    // --- Internal ---
    // `started` is the per-utterance flag set by its onstart. An utterance that
    // ended/errored after starting releases a `_started` slot; one that never
    // started (terminal event before onstart) releases its `_queued` slot instead,
    // so `pending` correctly returns to false.
    _finishUtterance(started) {
        if (started) {
            this._started = Math.max(0, this._started - 1);
        }
        else {
            this._queued = Math.max(0, this._queued - 1);
        }
        this._setSpeaking(this._started > 0);
        this._setPending(this._queued > 0);
        if (this._started === 0 && this._queued === 0) {
            this._setPaused(false);
            this._setBoundary(null, null);
        }
    }
    _hasApi() {
        return typeof window !== "undefined"
            && !!window.speechSynthesis
            && typeof window.SpeechSynthesisUtterance === "function";
    }
    _initVoices() {
        if (!this._hasApi())
            return;
        this._voicesSubscribed = true;
        this._loadVoices();
        window.speechSynthesis.addEventListener("voiceschanged", this._onVoicesChanged);
    }
    _onVoicesChanged = () => {
        this._loadVoices();
    };
    _loadVoices() {
        const raw = window.speechSynthesis.getVoices() ?? [];
        this._rawVoices = raw;
        this._setVoices(raw.map((v) => this._normalizeVoice(v)));
    }
    _normalizeVoice(voice) {
        return {
            name: voice.name,
            lang: voice.lang,
            default: voice.default,
            localService: voice.localService,
            voiceURI: voice.voiceURI,
        };
    }
    _normalizeError(event) {
        const error = event.error ?? "synthesis-failed";
        return { error, message: `Speech synthesis failed: ${error}.` };
    }
    _unsupportedError() {
        return { error: "unsupported", message: "SpeechSynthesis API is not available in this environment." };
    }
}

let registered$1 = false;
function handleClick$1(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    // A misconfigured triggerAttribute (e.g. one with a space) makes the attribute
    // selector invalid and closest() throw SyntaxError; guard so a bad config
    // disables only this shortcut rather than killing every document click handler.
    let triggerElement;
    try {
        triggerElement = target.closest(`[${config.triggerAttribute}]`);
    }
    catch {
        return;
    }
    if (!triggerElement)
        return;
    const speakId = triggerElement.getAttribute(config.triggerAttribute);
    if (!speakId)
        return;
    // Resolve the registered constructor at call time instead of importing Speak as
    // a value, avoiding a components/Speak.ts ⇄ autoTrigger.ts cycle
    // (Speak.connectedCallback() calls registerAutoTrigger()). instanceof against
    // the customElements registry keeps the same identity guarantee.
    const SpeakCtor = customElements.get(config.tagNames.speak);
    const speakElement = document.getElementById(speakId);
    if (!SpeakCtor || !(speakElement instanceof SpeakCtor))
        return;
    // The text to speak comes from the trigger element: an explicit `data-speaktext`
    // attribute wins, otherwise the element's text content. This keeps the
    // click-driven shortcut declarative without inventing a payload channel.
    const explicit = triggerElement.getAttribute("data-speaktext");
    // textContent is always a string for an Element; the cast avoids an
    // unreachable null-coalesce branch. speak() tolerates a non-string anyway.
    // The textContent fallback is trimmed (HTML indentation otherwise leaks leading
    // / trailing whitespace into the utterance); an explicit data-speaktext is kept
    // verbatim so an author can deliberately include surrounding spaces.
    const text = explicit !== null ? explicit : triggerElement.textContent.trim();
    event.preventDefault();
    speakElement.speak(text);
}
function registerAutoTrigger() {
    if (registered$1)
        return;
    registered$1 = true;
    document.addEventListener("click", handleClick$1);
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
class WcsSpeak extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...SpeakCore.wcBindable,
        // Shell-level settable surface. `say` is a momentary reactive command-property
        // with no mirrored attribute (it carries dynamic text, not declarative config),
        // mirroring how <wcs-geo>'s `trigger` has no attribute. The rest mirror their
        // HTML attributes idempotently.
        inputs: [
            { name: "say" },
            { name: "rate", attribute: "rate" },
            { name: "pitch", attribute: "pitch" },
            { name: "volume", attribute: "volume" },
            { name: "voice", attribute: "voice" },
            { name: "lang", attribute: "lang" },
            { name: "manual", attribute: "manual" },
        ],
        commands: SpeakCore.wcBindable.commands,
    };
    _core;
    _say = "";
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        // States are wired BEFORE the Core is constructed (unlike the canonical
        // Core-then-internals-then-wireStates order): SpeakCore's constructor
        // synchronously dispatches `wcs-speak:unsupported-changed` when the
        // SpeechSynthesis API is absent, so the listener must already be attached
        // to observe that first (and, in a fixed-support environment, only) event.
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-speak:speaking-changed": (d) => ({ speaking: d === true }),
            "wcs-speak:paused-changed": (d) => ({ paused: d === true }),
            "wcs-speak:pending-changed": (d) => ({ pending: d === true }),
            "wcs-speak:unsupported-changed": (d) => ({ unsupported: d === true }),
            "wcs-speak:error": (d) => ({ error: d != null }),
        });
        this._core = new SpeakCore(this);
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
    // wc-bindable (not a bind target); see README "CSS styling with :state()".
    // MUST NOT return the live CustomStateSet (that would let callers write
    // states from outside, defeating the point of :state() being read-only).
    get debugStates() {
        return this._internals ? [...this._internals.states] : [];
    }
    _initInternals() {
        // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
        // in happy-dom / older environments, and pre-125 Chromium rejects
        // non-dashed state names from states.add() (probed and discarded here).
        // Either case silently disables reflection — the component still works,
        // it just doesn't expose :state() selectors.
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
    get rate() {
        return this._numberAttr("rate", 1);
    }
    set rate(value) {
        this.setAttribute("rate", String(value));
    }
    get pitch() {
        return this._numberAttr("pitch", 1);
    }
    set pitch(value) {
        this.setAttribute("pitch", String(value));
    }
    get volume() {
        return this._numberAttr("volume", 1);
    }
    set volume(value) {
        this.setAttribute("volume", String(value));
    }
    get voice() {
        return this.getAttribute("voice") ?? "";
    }
    set voice(value) {
        if (value == null) {
            this.removeAttribute("voice");
        }
        else {
            this.setAttribute("voice", String(value));
        }
    }
    get lang() {
        return this.getAttribute("lang") ?? "";
    }
    set lang(value) {
        if (value == null) {
            this.removeAttribute("lang");
        }
        else {
            this.setAttribute("lang", String(value));
        }
    }
    get manual() {
        return this.hasAttribute("manual");
    }
    set manual(value) {
        if (value) {
            this.setAttribute("manual", "");
        }
        else {
            this.removeAttribute("manual");
        }
    }
    // --- Reactive command-property ---
    get say() {
        return this._say;
    }
    set say(value) {
        // Reactive: writing a new value speaks it. `manual` mutes the path entirely
        // (the imperative `speak` command still works) — both an opt-out and the hook
        // used to avoid a recognition echo loop while listening. A conforming binder
        // never delivers `undefined` (it skips the write), but a direct assignment
        // can, so normalize null/undefined to a no-op.
        //
        // ECHO-LOOP WARNING: when wiring <wcs-listen> → state → `say`, the synthesized
        // audio will be re-recognized unless speech is muted while listening. There is
        // no code-level interlock here (the two tags are decoupled): the consumer MUST
        // wire it — bind `manual` to the listening flag (or gate the bound source).
        // See README "Echo loop" and the speech-echo example.
        if (value == null)
            return;
        if (this.manual)
            return;
        const v = String(value);
        // Same-value guard: only speak when the bound source actually changes. For
        // "speak the same text again on demand", use the `speak` command instead.
        if (v === this._say)
            return;
        this._say = v;
        this.speak(v);
    }
    // --- Core delegated getters ---
    get voices() {
        return this._core.voices;
    }
    get speaking() {
        return this._core.speaking;
    }
    get paused() {
        return this._core.paused;
    }
    get pending() {
        return this._core.pending;
    }
    get charIndex() {
        return this._core.charIndex;
    }
    get spokenWord() {
        return this._core.spokenWord;
    }
    get error() {
        return this._core.error;
    }
    // Additive Phase 6 taxonomy output (event wcs-speak:error-info-changed),
    // delegated from the Core; declared via the inherited SpeakCore.wcBindable.
    get errorInfo() {
        return this._core.errorInfo;
    }
    get unsupported() {
        return this._core.unsupported;
    }
    // --- Commands ---
    speak(text) {
        this._core.speak(text, this._options());
    }
    cancel() {
        this._core.cancel();
    }
    pause() {
        this._core.pause();
    }
    resume() {
        this._core.resume();
    }
    // --- Internal ---
    _numberAttr(name, fallback) {
        const attr = this.getAttribute(name);
        if (attr === null || attr.trim() === "")
            return fallback;
        // Strict parse via Number() (unlike parseInt, "1px" -> NaN, not 1). Fall back
        // to the API default for any non-finite value, matching the geolocation
        // "invalid values fall back to default" convention.
        const parsed = Number(attr);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    _options() {
        return {
            rate: this.rate,
            pitch: this.pitch,
            volume: this.volume,
            voice: this.voice,
            lang: this.lang,
        };
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerAutoTrigger();
        }
        // observe() revives the voiceschanged subscription after a reconnect
        // (reparenting) and returns the readiness promise for SSR; it wraps
        // reinitVoices() (no-op on the first connect — the constructor subscribed).
        this._connectedCallbackPromise = this._core.observe();
    }
    disconnectedCallback() {
        // Detach event subscriptions and neutralize in-flight utterance callbacks.
        // Any utterance already speaking finishes naturally (SpeechSynthesis is a
        // global singleton; cancelling here would stop other <wcs-speak> elements
        // too). Call `cancel()` explicitly to stop audio.
        this._core.dispose();
    }
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
class ListenCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "interimTranscript", event: "wcs-listen:interim-changed" },
            { name: "finalTranscript", event: "wcs-listen:final-changed" },
            { name: "result", event: "wcs-listen:result" },
            { name: "listening", event: "wcs-listen:listening-changed" },
            { name: "permission", event: "wcs-listen:permission-changed" },
            { name: "error", event: "wcs-listen:error" },
            // Serializable failure taxonomy (stable code / phase / recoverable), or null.
            // Additive bindable output derived from `error.error` (the
            // SpeechRecognitionErrorEvent.error code / "unsupported"); the existing `error`
            // property/event are unchanged. Fires wcs-listen:error-info-changed. No lane —
            // recognition has no competing async operation to serialize.
            { name: "errorInfo", event: "wcs-listen:error-info-changed" },
            { name: "unsupported", event: "wcs-listen:unsupported-changed" },
        ],
        commands: [
            { name: "start" },
            { name: "stop" },
            { name: "abort" },
        ],
    };
    _target;
    _recognition = null;
    _interimTranscript = "";
    _finalTranscript = "";
    _result = null;
    _listening = false;
    _permission = "prompt";
    _error = null;
    _errorInfo = null;
    _unsupported = false;
    // Intent flag: true between start() and stop()/abort()/terminal-error. Gates
    // the auto-restart loop so a session that ended because the user stopped it
    // does not restart.
    _active = false;
    _continuous = false;
    _maxRestarts = 0;
    _restartCount = 0;
    // Permission tracking — same machinery as GeolocationCore.
    _permissionStatus = null;
    _permissionSubscribed = false;
    _permGen = 0;
    // SSR: feature detection (`_setUnsupported`) is synchronous and the permission
    // `change` subscription is established eagerly in the constructor, so there is
    // no asynchronous probe to await before snapshotting — readiness is immediate.
    // The Shell exposes this as connectedCallbackPromise.
    _ready = Promise.resolve();
    constructor(target) {
        super();
        this._target = target ?? this;
        const Ctor = this._getCtor();
        this._setUnsupported(!Ctor);
        if (Ctor) {
            this._recognition = new Ctor();
            this._attachHandlers(this._recognition);
        }
        this._initPermission();
    }
    get interimTranscript() {
        return this._interimTranscript;
    }
    get finalTranscript() {
        return this._finalTranscript;
    }
    get result() {
        return this._result;
    }
    get listening() {
        return this._listening;
    }
    get permission() {
        return this._permission;
    }
    get error() {
        return this._error;
    }
    /**
     * The last failure's serializable `WcsIoErrorInfo` (stable `code` / `phase` /
     * `recoverable`), or null. Additive wc-bindable property (event
     * `wcs-listen:error-info-changed`), derived from `error`; the existing `error`
     * property/event are unchanged.
     */
    get errorInfo() {
        return this._errorInfo;
    }
    // Resolved once in the constructor (`_setUnsupported(!Ctor)`) and never
    // re-evaluated: the SpeechRecognition API's presence is immutable for the
    // lifetime of a document, so there's nothing to re-check.
    get unsupported() {
        return this._unsupported;
    }
    /** Resolves once the first probe settles (immediate — see `_ready`). */
    get ready() {
        return this._ready;
    }
    // --- State setters with event dispatch ---
    _setInterim(value) {
        if (this._interimTranscript === value)
            return;
        this._interimTranscript = value;
        this._target.dispatchEvent(new CustomEvent("wcs-listen:interim-changed", { detail: value, bubbles: true }));
    }
    _setFinal(value) {
        if (this._finalTranscript === value)
            return;
        this._finalTranscript = value;
        this._target.dispatchEvent(new CustomEvent("wcs-listen:final-changed", { detail: value, bubbles: true }));
    }
    _setResult(value) {
        this._result = value;
        this._target.dispatchEvent(new CustomEvent("wcs-listen:result", { detail: value, bubbles: true }));
    }
    _setListening(value) {
        if (this._listening === value)
            return;
        this._listening = value;
        this._target.dispatchEvent(new CustomEvent("wcs-listen:listening-changed", { detail: value, bubbles: true }));
    }
    _setPermission(value) {
        if (this._permission === value)
            return;
        this._permission = value;
        this._target.dispatchEvent(new CustomEvent("wcs-listen:permission-changed", { detail: value, bubbles: true }));
    }
    _setError(value) {
        if (this._error === value)
            return;
        this._error = value;
        // Keep the additive `errorInfo` taxonomy in sync with `error`: derive from the
        // error code (or null on clear). Fires before the `error` event so an observer
        // binding both sees the classification first, mirroring the io-node family.
        this._commitErrorInfo(value === null ? null : deriveListenErrorInfo(value));
        this._target.dispatchEvent(new CustomEvent("wcs-listen:error", { detail: value, bubbles: true }));
    }
    // Called only from _setError (which already guards on error identity), so
    // errorInfo transitions exactly when error does — no separate guard needed here.
    _commitErrorInfo(info) {
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-listen:error-info-changed", { detail: info, bubbles: true }));
    }
    _setUnsupported(value) {
        if (this._unsupported === value)
            return;
        this._unsupported = value;
        this._target.dispatchEvent(new CustomEvent("wcs-listen:unsupported-changed", { detail: value, bubbles: true }));
    }
    // --- Public API ---
    /**
     * Begin a recognition session. Resets the transcripts (a fresh, user-initiated
     * listen), applies options, and starts. Idempotent while already listening: a
     * redundant start() is ignored so the browser does not throw "recognition has
     * already started".
     */
    start(options = {}) {
        if (!this._recognition) {
            this._setError(this._unsupportedError());
            return;
        }
        if (this._active)
            return;
        this._continuous = options.continuous ?? false;
        // `maxRestarts` is a restart *count*, so floor any fractional input to an
        // integer (e.g. 2.5 → 2). `_restartCount` increments by 1, so a fractional
        // cap would otherwise compare inconsistently. Non-finite/negative → 0.
        this._maxRestarts = typeof options.maxRestarts === "number" && options.maxRestarts >= 0
            ? Math.floor(options.maxRestarts)
            : 0;
        this._restartCount = 0;
        this._recognition.lang = options.lang ?? "";
        this._recognition.continuous = this._continuous;
        this._recognition.interimResults = options.interimResults ?? false;
        if (typeof options.maxAlternatives === "number") {
            this._recognition.maxAlternatives = options.maxAlternatives;
        }
        // Fresh session: clear prior transcripts and error.
        this._setInterim("");
        this._setFinal("");
        this._setError(null);
        this._active = true;
        this._safeStart();
    }
    stop() {
        if (!this._recognition)
            return;
        // Clear intent first so the end handler does not auto-restart.
        this._active = false;
        this._recognition.stop();
    }
    abort() {
        if (!this._recognition)
            return;
        this._active = false;
        this._recognition.abort();
    }
    /**
     * Re-establish the permission `change` subscription after a dispose().
     */
    reinitPermission() {
        if (!this._permissionSubscribed) {
            this._initPermission();
        }
    }
    /**
     * Establish monitoring (§3.5). Recognition is command-driven (start/stop), so
     * observe() only (re-)establishes the live permission subscription — idempotent
     * via reinitPermission()'s `_permissionSubscribed` guard, so the first connect
     * after construction does not double-subscribe while a reconnect after dispose()
     * does. Returns the `ready` promise for SSR. Call from the Shell's
     * connectedCallback.
     */
    observe() {
        this.reinitPermission();
        return this._ready;
    }
    /**
     * Stop recognition and detach the live permission listener. Call from the
     * Shell's `disconnectedCallback`.
     */
    dispose() {
        // Only the live subscriptions and the listening shadow are reset here. The
        // observable snapshot (transcripts / result / error) is intentionally *kept*
        // so a reparented element preserves its last state, mirroring how
        // GeolocationCore.dispose() leaves `position` / `error` intact. The next
        // start() clears the transcripts and error for its fresh session anyway.
        this._active = false;
        this._permissionSubscribed = false;
        this._permGen++;
        if (this._recognition) {
            // abort() is the immediate teardown; guard against environments where it
            // throws on an idle recognizer.
            try {
                this._recognition.abort();
            }
            catch {
                // ignore — teardown is best-effort.
            }
        }
        // Reset the listening shadow silently (no dispatch on a disposed element),
        // mirroring GeolocationCore's `_loading` reset. The abort() above neutralizes
        // the recognizer but its `end` (which would clear listening via the setter)
        // may not have fired yet; forcing false here means a reconnect+start's
        // `onstart` still transitions false→true through the same-value guard, so the
        // state never desyncs to a stale `true`.
        this._listening = false;
        if (this._permissionStatus) {
            this._permissionStatus.removeEventListener("change", this._onPermissionChange);
            this._permissionStatus = null;
        }
    }
    // --- Internal: recognition lifecycle ---
    _attachHandlers(recognition) {
        recognition.onstart = () => {
            this._setListening(true);
        };
        recognition.onresult = (event) => {
            try {
                this._handleResult(event);
            }
            catch {
                // A malformed result event must not escape the browser callback.
            }
        };
        recognition.onerror = (event) => {
            this._setError(this._normalizeError(event));
            // Terminal errors must not be retried — they would spin the restart loop.
            // The set is deliberately limited to the permission-class errors that can
            // never self-recover within a session. Transient failures
            // (`network` / `audio-capture` / `no-speech`) are intentionally *not*
            // terminal: they are recoverable, so a continuous session restarts through
            // them, bounded by `maxRestarts` (the cap is the guard against a persistent
            // transient failure spinning forever).
            if (event && (event.error === "not-allowed" || event.error === "service-not-allowed")) {
                this._active = false;
            }
        };
        recognition.onend = () => {
            if (this._active && this._continuous && this._restartCount < this._maxRestarts) {
                // Auto-restart bridges a silence-induced `end`. Keep `listening` true
                // across the gap rather than flickering true→false→true: from the
                // consumer's perspective the continuous session never stopped. The
                // immediately-following start()'s `onstart` re-sets true (same-value
                // guarded → no-op), so the flag stays steady. A genuine stop (no
                // restart) still drops to false below.
                this._restartCount++;
                this._safeStart();
                // _safeStart() clears _active if the restart threw; in that case the
                // session is over, so reflect listening=false rather than leaving it
                // stuck true.
                if (!this._active)
                    this._setListening(false);
                return;
            }
            // No restart: the session is fully over.
            this._setListening(false);
            this._active = false;
        };
    }
    _handleResult(event) {
        const results = event.results;
        let interim = "";
        let finalChunk = "";
        // Per the Web Speech spec, `resultIndex` is the lowest index in `results`
        // that changed in this event, so we only fold in `[resultIndex, length)` and
        // accumulate finals (`this._finalTranscript + finalChunk`). This assumes the
        // engine advances `resultIndex` past already-finalized results. A nonconforming
        // engine that omits `resultIndex` (`?? 0`) or re-reports finalized results at
        // index 0 on every event could double-accumulate the same final chunk; standard
        // browser engines don't, so this is not hardened against here.
        for (let i = event.resultIndex ?? 0; i < results.length; i++) {
            const res = results[i];
            const transcript = res?.[0]?.transcript ?? "";
            if (res?.isFinal) {
                finalChunk += transcript;
            }
            else {
                interim += transcript;
            }
        }
        if (finalChunk !== "") {
            this._setFinal(this._finalTranscript + finalChunk);
        }
        this._setInterim(interim);
        // Any result is progress — reset the restart budget so only *consecutive*
        // empty restarts count toward the cap.
        this._restartCount = 0;
        const last = results[results.length - 1];
        if (last) {
            this._setResult(this._normalizeResult(last));
        }
    }
    _normalizeResult(result) {
        const alternatives = [];
        for (let i = 0; i < result.length; i++) {
            alternatives.push({
                transcript: result[i]?.transcript ?? "",
                confidence: result[i]?.confidence ?? 0,
            });
        }
        const top = alternatives[0] ?? { transcript: "", confidence: 0 };
        return {
            transcript: top.transcript,
            confidence: top.confidence,
            isFinal: !!result.isFinal,
            alternatives,
        };
    }
    _safeStart() {
        try {
            this._recognition.start();
        }
        catch {
            // start() throws if already started; surface nothing — the live session
            // continues. Reset intent so state stays consistent.
            this._active = false;
        }
    }
    // --- Internal: feature detection & permission (mirrors GeolocationCore) ---
    _getCtor() {
        // Guard window access without a separate (in-browser unreachable) early
        // return, mirroring SpeakCore's `_hasApi` style.
        const w = (typeof window === "undefined" ? undefined : window);
        return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
    }
    _initPermission() {
        if (typeof navigator === "undefined" || !navigator.permissions || typeof navigator.permissions.query !== "function") {
            this._setPermission("unsupported");
            return;
        }
        this._permissionSubscribed = true;
        const gen = ++this._permGen;
        navigator.permissions.query({ name: "microphone" }).then((status) => {
            if (gen !== this._permGen)
                return;
            this._permissionStatus = status;
            this._setPermission(status.state);
            status.addEventListener("change", this._onPermissionChange);
        }, () => {
            if (gen !== this._permGen)
                return;
            this._setPermission("unsupported");
        });
    }
    _onPermissionChange = (event) => {
        const status = event.target;
        this._setPermission(status.state);
    };
    _normalizeError(event) {
        const error = (event && event.error) ? event.error : "aborted";
        return { error, message: `Speech recognition failed: ${error}.` };
    }
    _unsupportedError() {
        return { error: "unsupported", message: "SpeechRecognition API is not available in this environment." };
    }
}

let registered = false;
function handleClick(event) {
    const target = event.target;
    if (!(target instanceof Element))
        return;
    // A misconfigured listenTriggerAttribute (e.g. one with a space) makes the
    // attribute selector invalid and closest() throw SyntaxError; guard so a bad
    // config disables only this shortcut rather than killing every click handler.
    let triggerElement;
    try {
        triggerElement = target.closest(`[${config.listenTriggerAttribute}]`);
    }
    catch {
        return;
    }
    if (!triggerElement)
        return;
    const listenId = triggerElement.getAttribute(config.listenTriggerAttribute);
    if (!listenId)
        return;
    const ListenCtor = customElements.get(config.tagNames.listen);
    const listenElement = document.getElementById(listenId);
    if (!ListenCtor || !(listenElement instanceof ListenCtor))
        return;
    event.preventDefault();
    // Toggle: clicking starts a session, clicking again while listening stops it.
    const el = listenElement;
    if (el.listening) {
        el.stop();
    }
    else {
        el.start();
    }
}
function registerListenAutoTrigger() {
    if (registered)
        return;
    registered = true;
    document.addEventListener("click", handleClick);
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
class WcsListen extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static wcBindable = {
        ...ListenCore.wcBindable,
        properties: [
            ...ListenCore.wcBindable.properties,
            { name: "trigger", event: "wcs-listen:trigger-changed" },
        ],
        inputs: [
            { name: "lang", attribute: "lang" },
            { name: "continuous", attribute: "continuous" },
            { name: "interim", attribute: "interim" },
            { name: "maxRestarts", attribute: "max-restarts" },
            { name: "manual", attribute: "manual" },
            { name: "trigger" },
        ],
        commands: ListenCore.wcBindable.commands,
    };
    _core;
    _trigger = false;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        // States are wired BEFORE the Core is constructed (unlike the canonical
        // Core-then-internals-then-wireStates order): ListenCore's constructor
        // synchronously dispatches `wcs-listen:unsupported-changed` when the
        // SpeechRecognition API is absent (notably Safari, which ships
        // SpeechSynthesis but not SpeechRecognition), so the listener must already
        // be attached to observe that first (and, in a fixed-support environment,
        // only) event.
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-listen:listening-changed": (d) => ({ listening: d === true }),
            "wcs-listen:unsupported-changed": (d) => ({ unsupported: d === true }),
            "wcs-listen:error": (d) => ({ error: d != null }),
        });
        this._core = new ListenCore(this);
    }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
    // wc-bindable (not a bind target); see README "CSS styling with :state()".
    // MUST NOT return the live CustomStateSet (that would let callers write
    // states from outside, defeating the point of :state() being read-only).
    get debugStates() {
        return this._internals ? [...this._internals.states] : [];
    }
    _initInternals() {
        // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
        // in happy-dom / older environments, and pre-125 Chromium rejects
        // non-dashed state names from states.add() (probed and discarded here).
        // Either case silently disables reflection — the component still works,
        // it just doesn't expose :state() selectors.
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
    get lang() {
        return this.getAttribute("lang") ?? "";
    }
    set lang(value) {
        if (value == null) {
            this.removeAttribute("lang");
        }
        else {
            this.setAttribute("lang", String(value));
        }
    }
    get continuous() {
        return this.hasAttribute("continuous");
    }
    set continuous(value) {
        if (value) {
            this.setAttribute("continuous", "");
        }
        else {
            this.removeAttribute("continuous");
        }
    }
    get interim() {
        return this.hasAttribute("interim");
    }
    set interim(value) {
        if (value) {
            this.setAttribute("interim", "");
        }
        else {
            this.removeAttribute("interim");
        }
    }
    get maxRestarts() {
        const attr = this.getAttribute("max-restarts");
        if (attr === null || attr.trim() === "")
            return 0;
        const parsed = Number(attr);
        // A restart *count* is an integer, so floor fractional input (e.g. 1.9 → 1)
        // here too, keeping the getter's value identical to the effective cap the
        // Core applies (ListenCore.start floors it as well). Non-finite/negative → 0.
        return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
    }
    set maxRestarts(value) {
        this.setAttribute("max-restarts", String(value));
    }
    get manual() {
        return this.hasAttribute("manual");
    }
    set manual(value) {
        if (value) {
            this.setAttribute("manual", "");
        }
        else {
            this.removeAttribute("manual");
        }
    }
    // --- Core delegated getters ---
    get interimTranscript() {
        return this._core.interimTranscript;
    }
    get finalTranscript() {
        return this._core.finalTranscript;
    }
    get result() {
        return this._core.result;
    }
    get listening() {
        return this._core.listening;
    }
    get permission() {
        return this._core.permission;
    }
    get error() {
        return this._core.error;
    }
    // Additive Phase 6 taxonomy output (event wcs-listen:error-info-changed),
    // delegated from the Core; declared via the inherited ListenCore.wcBindable.
    get errorInfo() {
        return this._core.errorInfo;
    }
    get unsupported() {
        return this._core.unsupported;
    }
    // --- Command property ---
    get trigger() {
        return this._trigger;
    }
    set trigger(value) {
        // Momentary command-property: a false→true write starts a session. Mirrors
        // <wcs-geo>'s trigger. Prefer the command-token protocol (`command.start:
        // $command.listen`) for state-driven starts; this exists for DOM triggers and
        // simple boolean bindings.
        const v = !!value;
        if (v) {
            this._trigger = true;
            this.start();
            this._trigger = false;
            this.dispatchEvent(new CustomEvent("wcs-listen:trigger-changed", { detail: false, bubbles: true }));
        }
    }
    // --- Commands ---
    start() {
        this._core.start(this._options());
    }
    stop() {
        this._core.stop();
    }
    abort() {
        this._core.abort();
    }
    // --- Internal ---
    _options() {
        return {
            lang: this.lang,
            continuous: this.continuous,
            interimResults: this.interim,
            maxRestarts: this.maxRestarts,
        };
    }
    // --- Lifecycle ---
    connectedCallback() {
        this.style.display = "none";
        if (config.autoTrigger) {
            registerListenAutoTrigger();
        }
        // observe() (re-)establishes the permission subscription and returns the
        // readiness promise for SSR; it wraps reinitPermission() (idempotent).
        this._connectedCallbackPromise = this._core.observe();
        if (!this.manual) {
            // Non-blocking auto-start, mirroring <wcs-geo>: start() is fired
            // unconditionally without first awaiting/inspecting the (async) permission
            // state. A `denied` mic surfaces as a `not-allowed` error via the `error`
            // property (and stops auto-restart), rather than the connect path silently
            // suppressing the start. This keeps the permission model declarative and
            // consistent with geolocation. Use `manual` to require an explicit start.
            this.start();
        }
    }
    disconnectedCallback() {
        this._core.dispose();
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.speak)) {
        customElements.define(config.tagNames.speak, WcsSpeak);
    }
    if (!customElements.get(config.tagNames.listen)) {
        customElements.define(config.tagNames.listen, WcsListen);
    }
}

function bootstrapSpeech(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { ListenCore, SpeakCore, WCS_LISTEN_ERROR_CODE, WCS_SPEAK_ERROR_CODE, WcsListen, WcsSpeak, bootstrapSpeech, getConfig };
//# sourceMappingURL=index.esm.js.map
