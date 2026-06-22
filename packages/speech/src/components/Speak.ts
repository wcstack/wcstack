import { config } from "../config.js";
import { IWcBindable, SpeakOptions, SpeechVoiceInfo, WcsSpeakErrorDetail } from "../types.js";
import { SpeakCore } from "../core/SpeakCore.js";
import { registerAutoTrigger } from "../autoTrigger.js";

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
export class WcsSpeak extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static wcBindable: IWcBindable = {
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

  private _core: SpeakCore;
  private _say: string = "";
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._core = new SpeakCore(this);
  }

  get connectedCallbackPromise(): Promise<void> {
    return this._connectedCallbackPromise;
  }

  // --- Attribute accessors ---

  get rate(): number {
    return this._numberAttr("rate", 1);
  }

  set rate(value: number) {
    this.setAttribute("rate", String(value));
  }

  get pitch(): number {
    return this._numberAttr("pitch", 1);
  }

  set pitch(value: number) {
    this.setAttribute("pitch", String(value));
  }

  get volume(): number {
    return this._numberAttr("volume", 1);
  }

  set volume(value: number) {
    this.setAttribute("volume", String(value));
  }

  get voice(): string {
    return this.getAttribute("voice") ?? "";
  }

  set voice(value: string | null) {
    if (value == null) {
      this.removeAttribute("voice");
    } else {
      this.setAttribute("voice", String(value));
    }
  }

  get lang(): string {
    return this.getAttribute("lang") ?? "";
  }

  set lang(value: string | null) {
    if (value == null) {
      this.removeAttribute("lang");
    } else {
      this.setAttribute("lang", String(value));
    }
  }

  get manual(): boolean {
    return this.hasAttribute("manual");
  }

  set manual(value: boolean) {
    if (value) {
      this.setAttribute("manual", "");
    } else {
      this.removeAttribute("manual");
    }
  }

  // --- Reactive command-property ---

  get say(): string {
    return this._say;
  }

  set say(value: string | null) {
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
    if (value == null) return;
    if (this.manual) return;
    const v = String(value);
    // Same-value guard: only speak when the bound source actually changes. For
    // "speak the same text again on demand", use the `speak` command instead.
    if (v === this._say) return;
    this._say = v;
    this.speak(v);
  }

  // --- Core delegated getters ---

  get voices(): SpeechVoiceInfo[] {
    return this._core.voices;
  }

  get speaking(): boolean {
    return this._core.speaking;
  }

  get paused(): boolean {
    return this._core.paused;
  }

  get pending(): boolean {
    return this._core.pending;
  }

  get charIndex(): number | null {
    return this._core.charIndex;
  }

  get spokenWord(): string | null {
    return this._core.spokenWord;
  }

  get error(): WcsSpeakErrorDetail | null {
    return this._core.error;
  }

  get unsupported(): boolean {
    return this._core.unsupported;
  }

  // --- Commands ---

  speak(text: string): void {
    this._core.speak(text, this._options());
  }

  cancel(): void {
    this._core.cancel();
  }

  pause(): void {
    this._core.pause();
  }

  resume(): void {
    this._core.resume();
  }

  // --- Internal ---

  private _numberAttr(name: string, fallback: number): number {
    const attr = this.getAttribute(name);
    if (attr === null || attr.trim() === "") return fallback;
    // Strict parse via Number() (unlike parseInt, "1px" -> NaN, not 1). Fall back
    // to the API default for any non-finite value, matching the geolocation
    // "invalid values fall back to default" convention.
    const parsed = Number(attr);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private _options(): SpeakOptions {
    return {
      rate: this.rate,
      pitch: this.pitch,
      volume: this.volume,
      voice: this.voice,
      lang: this.lang,
    };
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.style.display = "none";
    if (config.autoTrigger) {
      registerAutoTrigger();
    }
    // observe() revives the voiceschanged subscription after a reconnect
    // (reparenting) and returns the readiness promise for SSR; it wraps
    // reinitVoices() (no-op on the first connect — the constructor subscribed).
    this._connectedCallbackPromise = this._core.observe();
  }

  disconnectedCallback(): void {
    // Detach event subscriptions and neutralize in-flight utterance callbacks.
    // Any utterance already speaking finishes naturally (SpeechSynthesis is a
    // global singleton; cancelling here would stop other <wcs-speak> elements
    // too). Call `cancel()` explicitly to stop audio.
    this._core.dispose();
  }
}
