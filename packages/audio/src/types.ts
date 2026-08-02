export interface ITagNames {
  readonly audio: string;
  readonly voice: string;
  readonly osc: string;
  readonly noise: string;
  readonly biquad: string;
  readonly gain: string;
  readonly delay: string;
  readonly shaper: string;
  readonly env: string;
  readonly lfo: string;
  readonly analyser: string;
}

export interface IWritableTagNames {
  audio?: string;
  voice?: string;
  osc?: string;
  noise?: string;
  biquad?: string;
  gain?: string;
  delay?: string;
  shaper?: string;
  env?: string;
  lfo?: string;
  analyser?: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
  /**
   * Supplies the `BaseAudioContext` every graph runs on. The default returns one
   * shared context per page (browsers cap concurrent contexts), reachable across
   * bundle copies through a `Symbol.for` registry.
   *
   * Override it to render into an `OfflineAudioContext` — that is how the
   * package's own real-browser tests assert audible signal deterministically,
   * without a user gesture.
   */
  readonly createContext: () => BaseAudioContext | null;
}

export interface IWritableConfig {
  tagNames?: IWritableTagNames;
  createContext?: () => BaseAudioContext | null;
}

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

// Shared io-core error taxonomy — single source of truth in /io-core/platform-capability.ts.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";

/** Every node kind the graph compiler can instantiate. */
export type AudioNodeKind =
  | "osc" | "noise" | "biquad" | "gain" | "delay" | "shaper" | "env" | "lfo" | "analyser";

/**
 * One node of a patch.
 *
 * A patch is a **descriptor**, not state: it is read once when the graph is
 * built, never diffed as a value. That distinction is what keeps a live audio
 * graph out of the reactive store — see
 * docs/architecture-hardening/14-handle-graph-wiring.md (gate G1).
 */
export interface PatchNode {
  readonly kind: AudioNodeKind;
  /** Stable key addressing every live instance of this node (`setParam` target). */
  readonly key: string;
  /** Name other nodes route to via `out` / `param`. */
  readonly id?: string;
  /** AudioParam values. Changing only these is a live update, never a rebuild. */
  readonly params?: Readonly<Record<string, number>>;
  /** Non-AudioParam settings (`type`, `mix`, ADSR times, …). */
  readonly props?: Readonly<Record<string, string>>;
  /** Routing targets: `"bus"` for audio, `"vcf.frequency"` for a param. */
  readonly out?: readonly string[];
  /** Modulator only: the parent AudioParam this node drives. */
  readonly param?: string;
  /** Oscillator only: follow the currently played note. */
  readonly note?: boolean;
  /** Analyser only: tap the root's master output rather than sit in the chain. */
  readonly master?: boolean;
  /** Nesting is the signal chain: a parent's output feeds each child's input. */
  readonly children?: readonly PatchNode[];
}

/** A polyphonic template: its subtree is instantiated once per held note. */
export interface PatchVoice {
  readonly key: string;
  readonly poly: number;
  readonly nodes: readonly PatchNode[];
}

/** The complete graph description handed to `AudioGraphCore.setPatch()`. */
export interface Patch {
  readonly nodes: readonly PatchNode[];
  readonly voices?: readonly PatchVoice[];
}

/** `AudioContext.state`, plus `"unsupported"` where Web Audio is absent. */
export type AudioContextState = "suspended" | "running" | "closed" | "unsupported";

/** A diagnostic the graph compiler emitted instead of throwing. */
export interface IAudioWarning {
  readonly message: string;
  readonly key: string | null;
}

/**
 * Value types for AudioGraphCore (headless) — the observable state properties.
 *
 * Note what is absent: no `AudioNode`, no `AudioContext`. Live handles are owned
 * and disposed by the Core and never cross the protocol boundary (ADR-14 G2),
 * exactly as `worker` / `websocket` / `broadcast` treat theirs.
 */
export interface WcsAudioCoreValues {
  state: AudioContextState;
  running: boolean;
  voices: number;
  warnings: IAudioWarning[];
  error: string | null;
  errorInfo: import("./core/platformCapability.js").WcsIoErrorInfo | null;
}

/** Observable surface of the root Shell (`<wcs-audio>`) — the Core's, verbatim. */
export type WcsAudioValues = WcsAudioCoreValues;

/** Settable input surface of the root Shell (`<wcs-audio>`). */
export interface WcsAudioInputs {
  volume: number;
  limiter: boolean;
  resumeOnGesture: boolean;
}
