import {
  AudioContextState, IAudioWarning, IWcBindable, Patch, WcsIoErrorInfo,
} from "../types.js";
import { AudioGraphCore } from "../core/AudioGraphCore.js";
import { getConfig } from "../config.js";
import { compilePatch } from "../patch/compilePatch.js";
import { applyNodeStyles } from "../patch/nodeStyles.js";
import { upgradeProperties } from "../protocol/upgradeProperties.js";

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
 * `<wcs-audio>` — the root of a patch.
 *
 * Owns the graph's lifecycle: it walks its own markup into a patch descriptor,
 * hands that to the Core, and publishes the graph's observable state back out.
 * Everything below it is a descriptor; every `AudioNode` lives in the Core.
 *
 * Rebuild policy (ADR-14 G5): a change to a numeric attribute is applied live,
 * a change to the shape of the patch rebuilds it, and **a rebuild cuts sounding
 * voices**. So the mutation observer is filtered to audio elements — adding a
 * `<div>` among the controls must not silence the instrument.
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

  get volume(): number {
    const raw = this.getAttribute("volume");
    const n = raw === null ? NaN : parseFloat(raw);
    return Number.isFinite(n) ? n : 0.8;
  }

  set volume(value: number) { this.setAttribute("volume", String(value)); }

  /** Ear-protection limiter, on unless explicitly turned off. */
  get limiter(): boolean { return this.getAttribute("limiter") !== "off"; }
  set limiter(value: boolean) { this.setAttribute("limiter", value ? "on" : "off"); }

  /** Resume the context on the first user gesture. On unless turned off. */
  get resumeOnGesture(): boolean { return this.getAttribute("resume-on-gesture") !== "off"; }
  set resumeOnGesture(value: boolean) { this.setAttribute("resume-on-gesture", value ? "on" : "off"); }

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

  resume(): Promise<void> { return this._core.resume(); }
  suspend(): Promise<void> { return this._core.suspend(); }
  noteOn(note: number, velocity?: number): void { this._core.noteOn(note, velocity); }
  noteOff(note: number): void { this._core.noteOff(note); }
  allNotesOff(): void { this._core.allNotesOff(); }

  /**
   * Recompile the markup and hand the result to the Core, coalesced onto a
   * microtask so a burst of DOM edits rebuilds once.
   *
   * A microtask, not a task: the cross-cutting contract puts microtasks ahead of
   * tasks precisely so a graph is in place before the first frame that could
   * observe it (timing-and-firing-contract.md §3).
   */
  requestRebuild(): void {
    if (this._rebuildQueued) return;
    this._rebuildQueued = true;
    queueMicrotask(() => {
      this._rebuildQueued = false;
      if (this.isConnected) this._core.setPatch(compilePatch(this));
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
    this._connectedCallbackPromise = this._core.observe(compilePatch(this));
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
      const touched = [...record.addedNodes, ...record.removedNodes];
      if (touched.some(isAudioElement)) {
        this.requestRebuild();
        return;
      }
    }
  };

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

  private _onGesture = (): void => { void this._core.resume(); };
}
