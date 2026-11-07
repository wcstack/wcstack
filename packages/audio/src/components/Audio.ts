import {
  AudioContextState, IAudioWarning, IWcBindable, Patch, WcsIoErrorInfo,
} from "../types.js";
import { AudioGraphCore, clampVolume } from "../core/AudioGraphCore.js";
import { contextAwaitsGesture, defaultCreateContext } from "../core/audioContext.js";
import { getConfig } from "../config.js";
import { compilePatch } from "../patch/compilePatch.js";
import { applyNodeStyles } from "../patch/nodeStyles.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";
import { reflectAttribute } from "../protocol/inputAttribute.js";
import type { RebuildCause } from "./AudioNodeShell.js";

/** Tag names of every element whose presence changes the graph's topology. */
const AUDIO_TAG_RE = /^(WCS-OSC|WCS-NOISE|WCS-BIQUAD|WCS-GAIN|WCS-DELAY|WCS-SHAPER|WCS-ENV|WCS-LFO|WCS-ANALYSER|WCS-VOICE)$/;

const isAudioElement = (node: Node): boolean => {
  const el = node as Element & { patchKind?: string; isAudioVoice?: boolean };
  if (el.patchKind !== undefined || el.isAudioVoice === true) return true;
  // Not upgraded yet (autoloader, code-split, or a not-yet-registered tag):
  // fall back to the tag name so a patch pasted in as HTML still rebuilds.
  return typeof el.tagName === "string" && AUDIO_TAG_RE.test(el.tagName);
};

/**
 * `[wcs/audio-voices-cut]`: what changed, how many voices it cut, and the fix.
 * The fix differs with the cause: a structural attribute is written in the
 * markup, not bound; an audio tag stays in place rather than under `if:` / `for:`.
 */
const voicesCutWarning = (root: string, cause: RebuildCause | null, voices: number): string => {
  const tag = cause ? `<${cause.element.localName}>` : "";
  const what = cause === null ? "A change to the patch's structure"
    : cause.attribute !== undefined ? `Changing "${cause.attribute}" on ${tag}`
    : `${cause.removed ? "Removing" : "Adding"} ${tag}`;
  const fix = cause === null
    ? "Structure is declared, not bound: the audio tags and their id, out, param, note, master and poly attributes describe the graph. " +
      "Bind the live values instead (frequency, gain, type, mix, attack, …), which change without a rebuild, and keep audio tags out of if: / for:."
    : cause.attribute !== undefined
      ? `"${cause.attribute}" is structural, like id, out, param, note, master and poly: write it in the markup, do not bind it. ` +
        "Bind the live values instead (frequency, gain, type, mix, attack, …): they change without a rebuild, sounding voices included."
      : "The audio tags are the patch's structure: keep them in place (not under if: or for:) and switch or silence a chain " +
        "with live values instead (a gain's gain, an oscillator's type).";
  return `[@wcstack/audio] [wcs/audio-voices-cut] ${what} rebuilt the graph of <${root}> and cut ${voices} sounding ` +
    `voice${voices === 1 ? "" : "s"}. ${fix} To change the structure on purpose, call allNotesOff first. (Said once per <${root}>.)`;
};

/**
 * `<wcs-audio>` — the root of a patch.
 *
 * Owns the graph's lifecycle: it walks its own markup into a patch descriptor,
 * hands that to the Core, and publishes the graph's observable state back out.
 * Everything below it is a descriptor; every `AudioNode` lives in the Core.
 *
 * Rebuild policy (ADR-14 G5): a change to a numeric attribute is applied live,
 * a change to the shape of the patch rebuilds it, and **a rebuild cuts sounding
 * voices**. So the mutation observer is filtered to audio elements — adding a
 * `<div>` among the controls must not silence the instrument — and a rebuild
 * that does cut voices is reported once (`_applyPatch`).
 *
 * With the default context provider the graph is not built before the page's
 * first user gesture (or `resume()` / `noteOn()`): building it creates the
 * shared `AudioContext`, which a browser refuses to start earlier and warns
 * about (`_mustWait`).
 */
export class WcsAudio extends HTMLElement {
  static hasConnectedCallbackPromise = true;
  static observedAttributes = ["volume", "limiter", "resume-on-gesture"];

  static wcBindable: IWcBindable = {
    ...AudioGraphCore.wcBindable,
    inputs: [
      { name: "volume", attribute: "volume" },
      { name: "limiter", attribute: "limiter" },
      { name: "resumeOnGesture", attribute: "resume-on-gesture" },
    ],
  };

  /** Marks this element for `findAudioRoot()` (tag names are configurable). */
  readonly isAudioRoot = true;

  private _core: AudioGraphCore;
  private _observer: MutationObserver | null = null;
  private _rebuildQueued = false;
  private _connectedCallbackPromise: Promise<void> = Promise.resolve();
  private _internals: ElementInternals | null = null;
  private _gestureBound = false;
  /** The graph waits for the first gesture, `resume()` or `noteOn()` (`_mustWait`). */
  private _waiting = false;
  /** A gesture, `resume()` or `noteOn()` has come: the context may be created at any time now. */
  private _armed = false;
  /** What asked for the queued rebuild first, for `[wcs/audio-voices-cut]`. */
  private _rebuildCause: RebuildCause | null = null;
  /** `[wcs/audio-voices-cut]` is said once per root. */
  private _cutWarned = false;

  constructor() {
    super();
    // Read through getConfig() at call time rather than capturing the provider,
    // so a setConfig() after construction still takes effect.
    const createContext = (): BaseAudioContext | null => getConfig().createContext();
    this._core = new AudioGraphCore({ createContext }, this);
    this._internals = this._initInternals();
    this._wireStates({
      "wcs-audio:statechange": (d) => ({
        running: d === "running",
        suspended: d === "suspended",
        unsupported: d === "unsupported",
      }),
      "wcs-audio:error": (d) => ({ error: d !== null }),
    });
  }

  // --- CSS state reflection ---

  get debugStates(): string[] {
    return this._internals ? [...this._internals.states] : [];
  }

  private _initInternals(): ElementInternals | null {
    // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
    // in happy-dom / older environments, and pre-125 Chromium rejects non-dashed
    // state names. Either case silently disables reflection.
    try {
      if (typeof this.attachInternals !== "function") return null;
      const internals = this.attachInternals();
      internals.states.add("wcs-probe");
      internals.states.delete("wcs-probe");
      return internals;
    } catch {
      return null;
    }
  }

  private _wireStates(map: Record<string, (detail: any) => Record<string, boolean>>): void {
    if (this._internals === null) return;
    const states = this._internals.states;
    for (const [event, toStates] of Object.entries(map)) {
      this.addEventListener(event, (e) => {
        const debug = this.hasAttribute("debug-states");
        for (const [name, on] of Object.entries(toStates((e as CustomEvent).detail))) {
          try {
            if (on) { states.add(name); } else { states.delete(name); }
          } catch { /* never-throw */ }
          if (debug) this.toggleAttribute(`data-wcs-state-${name}`, on);
        }
      });
    }
  }

  // --- Attributes ---
  //
  // The setters write the attribute only; attributeChangedCallback carries the
  // change to the Core. `null` removes the attribute (the default: volume 0.8,
  // limiter and resume-on-gesture on), `undefined` restores the attribute the
  // element started with (wc-bindable producer guidance P1; React 19 and a
  // direct assignment deliver it, @wcstack/state does not). Neither is ever
  // written as "null" / "undefined", and neither turns the ear-protection
  // limiter off.

  /**
   * The master level, in [0, 1] (4.17): a value outside reads — and sounds — as
   * the nearer end; the attribute keeps what was written, as `<input type=range>`
   * keeps its `value` attribute.
   */
  get volume(): number { return clampVolume(this.getAttribute("volume")); }

  set volume(value: number | null | undefined) { reflectAttribute(this, "volume", value); }

  /** Ear-protection limiter, on unless explicitly turned off. */
  get limiter(): boolean { return this.getAttribute("limiter") !== "off"; }
  set limiter(value: boolean | null | undefined) {
    reflectAttribute(this, "limiter", value == null ? value : value ? "on" : "off");
  }

  /** Resume the context on the first user gesture. On unless turned off. */
  get resumeOnGesture(): boolean { return this.getAttribute("resume-on-gesture") !== "off"; }
  set resumeOnGesture(value: boolean | null | undefined) {
    reflectAttribute(this, "resume-on-gesture", value == null ? value : value ? "on" : "off");
  }

  // --- Core delegated getters ---

  get state(): AudioContextState { return this._core.state; }
  get running(): boolean { return this._core.running; }
  get suspended(): boolean { return this._core.suspended; }
  get unsupported(): boolean { return this._core.unsupported; }
  get voices(): number { return this._core.voices; }
  get warnings(): IAudioWarning[] { return this._core.warnings; }
  get error(): string | null { return this._core.error; }
  get errorInfo(): WcsIoErrorInfo | null { return this._core.errorInfo; }

  /** Headless escape hatch, and the surface node tags talk to. */
  get audioCore(): AudioGraphCore { return this._core; }

  get connectedCallbackPromise(): Promise<void> { return this._connectedCallbackPromise; }

  /** The patch this element's markup currently describes. */
  get patch(): Patch { return compilePatch(this); }

  // --- Commands ---

  // resume() and noteOn() are requests for sound: a graph that waited for a
  // gesture is built here, so the context is created inside the gesture (or
  // command) that called them. noteOn() too: a note dropped because no gesture
  // had come yet would go unheard *and* unreported (no voices, no noteon event).
  resume(): Promise<void> { this._arm(); return this._core.resume(); }
  suspend(): Promise<void> { return this._core.suspend(); }
  noteOn(note: number, velocity?: number): void { this._arm(); this._core.noteOn(note, velocity); }
  noteOff(note: number): void { this._core.noteOff(note); }
  allNotesOff(): void { this._core.allNotesOff(); }

  /**
   * Recompile the markup and hand the result to the Core, coalesced onto a
   * microtask so a burst of DOM edits rebuilds once.
   *
   * A microtask, not a task: the cross-cutting contract puts microtasks ahead of
   * tasks precisely so a graph is in place before the first frame that could
   * observe it (timing-and-firing-contract.md §3).
   *
   * `cause` names the element (and the structural attribute) that asked, so the
   * warning for a rebuild that cuts sounding voices can say what changed.
   */
  requestRebuild(cause?: RebuildCause): void {
    this._rebuildCause ??= cause ?? null;
    if (this._rebuildQueued) return;
    this._rebuildQueued = true;
    queueMicrotask(() => {
      this._rebuildQueued = false;
      const first = this._rebuildCause;
      this._rebuildCause = null;
      if (this.isConnected && !this._waiting) this._applyPatch(first);
    });
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
    upgradeProperties(this);
    applyNodeStyles(this.getRootNode());
    this._core.setVolume(this.volume);
    this._core.setLimiter(this.limiter);
    if (!this._observer) {
      this._observer = new MutationObserver(this._onMutations);
      // childList only: attribute changes come through each node's own
      // attributeChangedCallback, which already knows value from structure.
      this._observer.observe(this, { childList: true, subtree: true });
    }
    this._bindGesture();
    this._waiting = this._mustWait();
    this._connectedCallbackPromise = this._waiting ? Promise.resolve() : this._core.observe(compilePatch(this));
  }

  disconnectedCallback(): void {
    this._observer?.disconnect();
    this._observer = null;
    this._unbindGesture();
    this._core.dispose();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    if (name === "volume") { this._core.setVolume(this.volume); return; }
    if (name === "limiter") { this._core.setLimiter(this.limiter); return; }
    if (this.isConnected) this._bindGesture();
  }

  // --- Internal ---

  private _onMutations = (records: MutationRecord[]): void => {
    for (const record of records) {
      const added = [...record.addedNodes].find(isAudioElement);
      const element = added ?? [...record.removedNodes].find(isAudioElement);
      if (element) {
        this.requestRebuild({ element: element as Element, removed: added === undefined });
        return;
      }
    }
  };

  /**
   * Hand the markup's patch to the Core. A rebuild cuts every sounding voice
   * (timing-and-firing-contract.md §19.3), and when that happens it is said once
   * per root: a structural attribute bound to state, or an audio tag under
   * `if:`, cuts the notes on every change, and nothing else tells the author why.
   * Nothing is said when nothing sounds — declaring the structure is not a mistake.
   */
  private _applyPatch(cause: RebuildCause | null): void {
    const core = this._core;
    // The live (monophonic) graph's held note is one voice, however many keys are down.
    const sounding = core.soundingVoices + (core.liveNoteHeld ? 1 : 0);
    if (!core.setPatch(compilePatch(this)) || sounding === 0 || this._cutWarned) return;
    this._cutWarned = true;
    console.warn(voicesCutWarning(this.localName, cause, sounding), this);
  }

  /**
   * Whether building now would create the page's `AudioContext` before a user
   * gesture, which the browser does not let start, and warns about (Chromium:
   * "The AudioContext was not allowed to start", Firefox: "An AudioContext was
   * prevented from starting automatically"). Then the graph waits for the first
   * gesture (`resume-on-gesture`), `resume()` or `noteOn()`, and `state` reads
   * `"suspended"` meanwhile, as it did before a gesture. Only the default
   * provider waits: a `createContext` you supply (an `OfflineAudioContext`, which
   * needs no gesture) is called at connect, as before.
   */
  private _mustWait(): boolean {
    return !this._armed && getConfig().createContext === defaultCreateContext && contextAwaitsGesture();
  }

  /** The first gesture, `resume()` or `noteOn()`: build the graph that waited, creating the context now. */
  private _arm(): void {
    this._armed = true;
    if (!this._waiting) return;
    this._waiting = false;
    if (this.isConnected) this._core.setPatch(compilePatch(this));
  }

  // An AudioContext only leaves "suspended" inside a user gesture. Listeners are
  // attached to this element's root (not document) and removed on disconnect, so
  // the package leaves no global residue behind.
  private _bindGesture(): void {
    if (this.resumeOnGesture) {
      if (this._gestureBound) return;
      const root = this.getRootNode() as Document | ShadowRoot;
      root.addEventListener("pointerdown", this._onGesture, { capture: true });
      root.addEventListener("keydown", this._onGesture, { capture: true });
      this._gestureBound = true;
      return;
    }
    this._unbindGesture();
  }

  private _unbindGesture(): void {
    if (!this._gestureBound) return;
    const root = this.getRootNode() as Document | ShadowRoot;
    root.removeEventListener("pointerdown", this._onGesture, { capture: true });
    root.removeEventListener("keydown", this._onGesture, { capture: true });
    this._gestureBound = false;
  }

  private _onGesture = (): void => { this._arm(); void this._core.resume(); };
}
