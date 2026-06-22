import {
  IWcBindable, SpeakOptions, SpeechVoiceInfo, WcsSpeakErrorDetail,
} from "../types.js";

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
export class SpeakCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "voices", event: "wcs-speak:voices-changed" },
      { name: "speaking", event: "wcs-speak:speaking-changed" },
      { name: "paused", event: "wcs-speak:paused-changed" },
      { name: "pending", event: "wcs-speak:pending-changed" },
      { name: "charIndex", event: "wcs-speak:boundary", getter: (e: Event) => (e as CustomEvent).detail?.charIndex ?? null },
      { name: "spokenWord", event: "wcs-speak:boundary", getter: (e: Event) => (e as CustomEvent).detail?.word ?? null },
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

  private _target: EventTarget;

  private _voices: SpeechVoiceInfo[] = [];
  private _rawVoices: SpeechSynthesisVoice[] = [];
  private _speaking: boolean = false;
  private _paused: boolean = false;
  private _pending: boolean = false;
  private _charIndex: number | null = null;
  private _spokenWord: string | null = null;
  private _error: WcsSpeakErrorDetail | null = null;
  private _unsupported: boolean = false;

  // Count of utterances submitted via speak() but not yet started, and of
  // utterances started but not yet ended/errored. `pending`/`speaking` are
  // derived from these so the queue model is reflected accurately even when
  // several utterances are in flight.
  private _queued: number = 0;
  private _started: number = 0;

  // Monotonic id of the current synthesis lifecycle. Bumped by cancel() and
  // dispose(). Each speak() captures it; every utterance event handler bails if
  // it is stale, so a queued/canceled utterance's late callback (notably the
  // "canceled" error the browser fires from cancel()) never mutates state or
  // dispatches on a torn-down element.
  private _gen: number = 0;

  // True once the voiceschanged subscription has been (or is being) established;
  // reset by dispose(). Guards reinitVoices() so the first connect after
  // construction does not double-subscribe, while a reconnect after dispose()
  // does re-subscribe.
  private _voicesSubscribed: boolean = false;

  // SSR: feature detection (`_setUnsupported`) and the initial `getVoices()` read
  // are synchronous, and the `voiceschanged` subscription is established eagerly
  // in the constructor, so there is no asynchronous probe to await before
  // snapshotting — readiness is immediate. The Shell exposes this as
  // connectedCallbackPromise.
  private _ready: Promise<void> = Promise.resolve();

  constructor(target?: EventTarget) {
    super();
    this._target = target ?? this;
    // Probe support up front so observers see the real flag before the first read.
    // Routed through the setter (not a direct assignment) so the field starts at
    // its `false` default and the unsupported case actually transitions
    // false→true; the supported case is same-value guarded and dispatches nothing.
    this._setUnsupported(!this._hasApi());
    this._initVoices();
  }

  get voices(): SpeechVoiceInfo[] {
    return this._voices;
  }

  get speaking(): boolean {
    return this._speaking;
  }

  get paused(): boolean {
    return this._paused;
  }

  get pending(): boolean {
    return this._pending;
  }

  get charIndex(): number | null {
    return this._charIndex;
  }

  get spokenWord(): string | null {
    return this._spokenWord;
  }

  get error(): WcsSpeakErrorDetail | null {
    return this._error;
  }

  // Resolved once in the constructor (`_setUnsupported(!_hasApi())`) and never
  // re-evaluated: the speechSynthesis API's presence is immutable for the
  // lifetime of a document, so there's nothing to re-check.
  get unsupported(): boolean {
    return this._unsupported;
  }

  /** Resolves once the first probe settles (immediate — see `_ready`). */
  get ready(): Promise<void> {
    return this._ready;
  }

  // --- State setters with event dispatch ---

  private _setVoices(voices: SpeechVoiceInfo[]): void {
    // Same-value guard, like the other setters. `voiceschanged` can fire several
    // times with an identical list (engines re-announce after warm-up); compare
    // the normalized snapshot content so a redundant re-announcement does not
    // re-dispatch voices-changed. A genuine list change (length or any field)
    // still fires.
    if (this._voicesEqual(this._voices, voices)) return;
    this._voices = voices;
    this._target.dispatchEvent(new CustomEvent("wcs-speak:voices-changed", {
      detail: voices,
      bubbles: true,
    }));
  }

  private _voicesEqual(a: SpeechVoiceInfo[], b: SpeechVoiceInfo[]): boolean {
    if (a.length !== b.length) return false;
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

  private _setSpeaking(speaking: boolean): void {
    if (this._speaking === speaking) return;
    this._speaking = speaking;
    this._target.dispatchEvent(new CustomEvent("wcs-speak:speaking-changed", {
      detail: speaking,
      bubbles: true,
    }));
  }

  private _setPaused(paused: boolean): void {
    if (this._paused === paused) return;
    this._paused = paused;
    this._target.dispatchEvent(new CustomEvent("wcs-speak:paused-changed", {
      detail: paused,
      bubbles: true,
    }));
  }

  private _setPending(pending: boolean): void {
    if (this._pending === pending) return;
    this._pending = pending;
    this._target.dispatchEvent(new CustomEvent("wcs-speak:pending-changed", {
      detail: pending,
      bubbles: true,
    }));
  }

  private _setBoundary(charIndex: number | null, word: string | null): void {
    // Boundary events stream rapidly with changing offsets; dispatch each. The
    // guard only suppresses redundant resets (e.g. an end after an already-null
    // boundary) so a cleared highlight does not re-fire.
    if (this._charIndex === charIndex && this._spokenWord === word) return;
    this._charIndex = charIndex;
    this._spokenWord = word;
    this._target.dispatchEvent(new CustomEvent("wcs-speak:boundary", {
      detail: { charIndex, word },
      bubbles: true,
    }));
  }

  private _setError(error: WcsSpeakErrorDetail | null): void {
    if (this._error === error) return;
    this._error = error;
    this._target.dispatchEvent(new CustomEvent("wcs-speak:error", {
      detail: error,
      bubbles: true,
    }));
  }

  private _setUnsupported(unsupported: boolean): void {
    if (this._unsupported === unsupported) return;
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
  speak(text: string, options: SpeakOptions = {}): void {
    if (!this._hasApi()) {
      this._setError(this._unsupportedError());
      return;
    }
    if (typeof text !== "string" || text.trim() === "") {
      return;
    }

    const synth = window.speechSynthesis;
    const utterance = new window.SpeechSynthesisUtterance(text);
    if (typeof options.rate === "number") utterance.rate = options.rate;
    if (typeof options.pitch === "number") utterance.pitch = options.pitch;
    if (typeof options.volume === "number") utterance.volume = options.volume;
    if (typeof options.lang === "string" && options.lang !== "") utterance.lang = options.lang;
    if (typeof options.voice === "string" && options.voice !== "") {
      const match = this._rawVoices.find((v) => v.name === options.voice);
      if (match) utterance.voice = match;
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
    utterance.onstart = (): void => {
      if (gen !== this._gen) return;
      started = true;
      this._queued = Math.max(0, this._queued - 1);
      this._started++;
      this._setSpeaking(true);
      this._setPending(this._queued > 0);
      this._setBoundary(null, null);
    };
    utterance.onboundary = (event: SpeechSynthesisEvent): void => {
      if (gen !== this._gen) return;
      try {
        const charIndex = event.charIndex;
        const length = (event as unknown as { charLength?: number }).charLength;
        // Prefer the engine-provided word length. Some engines omit `charLength`
        // on word boundaries; fall back to the run of non-whitespace at charIndex
        // so `spokenWord` (the karaoke highlight) still works there.
        const word = (typeof length === "number" && length > 0)
          ? text.substring(charIndex, charIndex + length)
          : (text.slice(charIndex).match(/^\S+/)?.[0] ?? "");
        this._setBoundary(charIndex, word);
      } catch {
        // A malformed boundary event must not escape the browser callback.
      }
    };
    utterance.onpause = (): void => {
      if (gen !== this._gen) return;
      this._setPaused(true);
    };
    utterance.onresume = (): void => {
      if (gen !== this._gen) return;
      this._setPaused(false);
    };
    utterance.onend = (): void => {
      if (gen !== this._gen) return;
      this._finishUtterance(started);
    };
    utterance.onerror = (event: SpeechSynthesisErrorEvent): void => {
      if (gen !== this._gen) return;
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
  cancel(): void {
    if (!this._hasApi()) return;
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

  pause(): void {
    if (!this._hasApi()) return;
    window.speechSynthesis.pause();
  }

  resume(): void {
    if (!this._hasApi()) return;
    window.speechSynthesis.resume();
  }

  /**
   * Re-establish the voiceschanged subscription after a dispose() — e.g. the
   * Shell element was disconnected and then reconnected (reparented). No-op while
   * a subscription is already live, so the first connect after construction does
   * not double-subscribe.
   */
  reinitVoices(): void {
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
  observe(): Promise<void> {
    this.reinitVoices();
    return this._ready;
  }

  /**
   * Detach the live voiceschanged listener and neutralize any in-flight
   * utterance callbacks. Call from the Shell's `disconnectedCallback`.
   */
  dispose(): void {
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
  private _finishUtterance(started: boolean): void {
    if (started) {
      this._started = Math.max(0, this._started - 1);
    } else {
      this._queued = Math.max(0, this._queued - 1);
    }
    this._setSpeaking(this._started > 0);
    this._setPending(this._queued > 0);
    if (this._started === 0 && this._queued === 0) {
      this._setPaused(false);
      this._setBoundary(null, null);
    }
  }

  private _hasApi(): boolean {
    return typeof window !== "undefined"
      && !!window.speechSynthesis
      && typeof (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === "function";
  }

  private _initVoices(): void {
    if (!this._hasApi()) return;
    this._voicesSubscribed = true;
    this._loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", this._onVoicesChanged);
  }

  private _onVoicesChanged = (): void => {
    this._loadVoices();
  };

  private _loadVoices(): void {
    const raw = window.speechSynthesis.getVoices() ?? [];
    this._rawVoices = raw;
    this._setVoices(raw.map((v) => this._normalizeVoice(v)));
  }

  private _normalizeVoice(voice: SpeechSynthesisVoice): SpeechVoiceInfo {
    return {
      name: voice.name,
      lang: voice.lang,
      default: voice.default,
      localService: voice.localService,
      voiceURI: voice.voiceURI,
    };
  }

  private _normalizeError(event: SpeechSynthesisErrorEvent): WcsSpeakErrorDetail {
    const error = event.error ?? "synthesis-failed";
    return { error, message: `Speech synthesis failed: ${error}.` };
  }

  private _unsupportedError(): WcsSpeakErrorDetail {
    return { error: "unsupported", message: "SpeechSynthesis API is not available in this environment." };
  }
}
