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
            { name: "charIndex", event: "wcs-speak:boundary", getter: (e) => e.detail.charIndex },
            { name: "spokenWord", event: "wcs-speak:boundary", getter: (e) => e.detail.word },
            { name: "error", event: "wcs-speak:error" },
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
    get unsupported() {
        return this._unsupported;
    }
    // --- State setters with event dispatch ---
    _setVoices(voices) {
        this._voices = voices;
        this._target.dispatchEvent(new CustomEvent("wcs-speak:voices-changed", {
            detail: voices,
            bubbles: true,
        }));
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
        this._target.dispatchEvent(new CustomEvent("wcs-speak:error", {
            detail: error,
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
        utterance.onstart = () => {
            if (gen !== this._gen)
                return;
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
                const length = event.charLength ?? 0;
                const word = text.substring(charIndex, charIndex + length);
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
            this._finishUtterance();
        };
        utterance.onerror = (event) => {
            if (gen !== this._gen)
                return;
            this._setError(this._normalizeError(event));
            this._finishUtterance();
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
     * Detach the live voiceschanged listener and neutralize any in-flight
     * utterance callbacks. Call from the Shell's `disconnectedCallback`.
     */
    dispose() {
        this._voicesSubscribed = false;
        this._gen++;
        // Reset the queue bookkeeping silently (no dispatch on a disposed element);
        // a reconnect starts fresh.
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
    _finishUtterance() {
        this._started = Math.max(0, this._started - 1);
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
    const triggerElement = target.closest(`[${config.triggerAttribute}]`);
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
    const text = explicit !== null ? explicit : triggerElement.textContent;
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
    constructor() {
        super();
        this._core = new SpeakCore(this);
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
        // Revive the voiceschanged subscription after a reconnect (reparenting).
        // No-op on the first connect since the constructor already subscribed.
        this._core.reinitVoices();
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
 * - **continuous** (`continuous = true`) — keep a session open and, because the
 *   browser still ends a session on silence, auto-restart it on `end`. The
 *   restart loop is bounded by `maxRestarts` so a persistent failure (e.g.
 *   `not-allowed`) cannot spin forever or exhaust quota.
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
    get unsupported() {
        return this._unsupported;
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
        this._target.dispatchEvent(new CustomEvent("wcs-listen:error", { detail: value, bubbles: true }));
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
        this._maxRestarts = typeof options.maxRestarts === "number" && options.maxRestarts >= 0 ? options.maxRestarts : 0;
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
     * Stop recognition and detach the live permission listener. Call from the
     * Shell's `disconnectedCallback`.
     */
    dispose() {
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
            if (event && (event.error === "not-allowed" || event.error === "service-not-allowed")) {
                this._active = false;
            }
        };
        recognition.onend = () => {
            this._setListening(false);
            if (this._active && this._continuous && this._restartCount < this._maxRestarts) {
                this._restartCount++;
                this._safeStart();
                return;
            }
            // No restart: the session is fully over.
            this._active = false;
        };
    }
    _handleResult(event) {
        const results = event.results;
        let interim = "";
        let finalChunk = "";
        for (let i = event.resultIndex ?? 0; i < results.length; i++) {
            const res = results[i];
            const transcript = res[0]?.transcript ?? "";
            if (res.isFinal) {
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
    const triggerElement = target.closest(`[${config.listenTriggerAttribute}]`);
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
    constructor() {
        super();
        this._core = new ListenCore(this);
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
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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
        this._core.reinitPermission();
        if (!this.manual) {
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

export { ListenCore, SpeakCore, WcsListen, WcsSpeak, bootstrapSpeech, getConfig };
//# sourceMappingURL=index.esm.js.map
