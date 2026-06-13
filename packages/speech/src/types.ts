export interface ITagNames {
  readonly speak: string;
  readonly listen: string;
}

export interface IWritableTagNames {
  speak?: string;
  listen?: string;
}

export interface IConfig {
  readonly autoTrigger: boolean;
  /** DOM autoTrigger attribute for `<wcs-speak>` (click → speak). */
  readonly triggerAttribute: string;
  /** DOM autoTrigger attribute for `<wcs-listen>` (click → toggle start/stop). */
  readonly listenTriggerAttribute: string;
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  autoTrigger?: boolean;
  triggerAttribute?: string;
  listenTriggerAttribute?: string;
  tagNames?: IWritableTagNames;
}

// wc-bindable protocol (@wc-bindable/core, protocol version 1) for custom element binding.
// properties: observable outputs — the element dispatches events on change, observers subscribe via bind()
// inputs:     settable surface — declarative metadata; optional `attribute` hints the mirrored HTML attribute
// commands:   invocable methods — declarative metadata; binding systems call the method by name
// Per SPEC.md, core interprets only `properties`; `inputs` / `commands` and the `attribute` / `async`
// hints are descriptive (tooling, codegen, remote proxying). See SPEC-extensions.md § Extension 1.
export interface IWcBindableProperty {
  readonly name: string;
  readonly event: string;
  readonly getter?: (event: Event) => any;
}

export interface IWcBindableInput {
  readonly name: string;
  readonly attribute?: string;
}

export interface IWcBindableCommand {
  readonly name: string;
  readonly async?: boolean;
}

export interface IWcBindable {
  readonly protocol: "wc-bindable";
  readonly version: number;
  readonly properties: IWcBindableProperty[];
  readonly inputs?: IWcBindableInput[];
  readonly commands?: IWcBindableCommand[];
}

/**
 * Structured-clone-friendly snapshot of a `SpeechSynthesisVoice`. The live voice
 * objects are not serializable and cannot flow through data binding, so the Core
 * exposes this plain copy. `name` is the selection key used by the `voice`
 * input.
 */
export interface SpeechVoiceInfo {
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
export interface WcsSpeakErrorDetail {
  error: string;
  message: string;
}

/**
 * Per-utterance parameters accepted by `speak()`, mirroring the settable fields
 * of `SpeechSynthesisUtterance`. `voice` selects a voice by its `name`.
 */
export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  voice?: string;
  lang?: string;
}

/**
 * Value types for SpeakCore (headless) — the observable state properties. Use
 * with `bind()` from `@wc-bindable/core` for compile-time type checking.
 */
export interface WcsSpeakCoreValues {
  voices: SpeechVoiceInfo[];
  speaking: boolean;
  paused: boolean;
  pending: boolean;
  charIndex: number | null;
  spokenWord: string | null;
  error: WcsSpeakErrorDetail | null;
  unsupported: boolean;
}

/**
 * Value types for the Shell (`<wcs-speak>`) — the Core's observable surface plus
 * the reactive `say` command-property.
 */
export interface WcsSpeakValues extends WcsSpeakCoreValues {
  say: string;
}

export interface WcsSpeakInputs {
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

export interface WcsSpeakCoreCommands {
  speak(text: string, options?: SpeakOptions): void;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export interface WcsSpeakCommands {
  speak(text: string): void;
  cancel(): void;
  pause(): void;
  resume(): void;
}

// ---------------------------------------------------------------------------
// SpeechRecognition (STT) — <wcs-listen>
// ---------------------------------------------------------------------------

/**
 * Permission state for the microphone, mirroring the Permissions API
 * `PermissionState` plus `"unsupported"` for environments without
 * `navigator.permissions` (or where the `microphone` permission cannot be
 * queried).
 */
export type ListenPermissionState = "prompt" | "granted" | "denied" | "unsupported";

export interface WcsListenAlternative {
  transcript: string;
  confidence: number;
}

/**
 * Structured-clone-friendly snapshot of the most recent recognition result —
 * the top alternative flattened (`transcript` / `confidence`) plus the full
 * `alternatives` list and whether the result is final.
 */
export interface WcsListenResultDetail {
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
export interface WcsListenErrorDetail {
  error: string;
  message: string;
}

/**
 * Options accepted by `start()`, mirroring the settable fields of
 * `SpeechRecognition`.
 */
export interface ListenOptions {
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
export interface WcsListenCoreValues {
  interimTranscript: string;
  finalTranscript: string;
  result: WcsListenResultDetail | null;
  listening: boolean;
  permission: ListenPermissionState;
  error: WcsListenErrorDetail | null;
  unsupported: boolean;
}

/**
 * Value types for the Shell (`<wcs-listen>`) — the Core's observable surface plus
 * the DOM-driven `trigger` command-property.
 */
export interface WcsListenValues extends WcsListenCoreValues {
  trigger: boolean;
}

export interface WcsListenInputs {
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

export interface WcsListenCoreCommands {
  start(options?: ListenOptions): void;
  stop(): void;
  abort(): void;
}

export interface WcsListenCommands {
  // Renamed from a hypothetical `listen` to the native verb; no collision with
  // attribute accessors, so the Core/Shell names match.
  start(): void;
  stop(): void;
  abort(): void;
}
