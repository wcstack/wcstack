export interface ITagNames {
  readonly midi: string;
}

export interface IWritableTagNames {
  midi?: string;
}

export interface IConfig {
  readonly tagNames: ITagNames;
}

export interface IWritableConfig {
  tagNames?: IWritableTagNames;
}

// wc-bindable protocol manifest types — single source of truth in /protocol/wc-bindable.ts.
export type {
  IWcBindable, IWcBindableProperty, IWcBindableInput, IWcBindableCommand,
} from "./protocol/wcBindable.js";

// Shared io-core error taxonomy — single source of truth in /io-core/platform-capability.ts.
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";

/**
 * Permission surface for Web MIDI, mirroring the four-value shape used by
 * `@wcstack/permission` / `geolocation` / `clipboard`.
 *
 * - `"unsupported"` — `navigator.requestMIDIAccess` is absent (Firefox with the
 *   pref off, Safari, or any non-secure context). Nothing to retry.
 * - `"prompt"` / `"granted"` / `"denied"` — the Permissions API state when the
 *   browser can answer `query({ name: "midi" })`, otherwise inferred from the
 *   outcome of `request()`.
 */
export type MidiPermissionState = "prompt" | "granted" | "denied" | "unsupported";

/**
 * Normalized message kind. `"noteoff"` covers both a real note-off (status 0x8n)
 * and the note-on-with-zero-velocity idiom (0x9n with data2 === 0), because they
 * mean the same thing to every consumer — see README "velocity 0".
 */
export type MidiMessageType =
  | "noteon"
  | "noteoff"
  | "polyaftertouch"
  | "controlchange"
  | "programchange"
  | "aftertouch"
  | "pitchbend"
  | "sysex"
  | "other";

/**
 * Fields decoded from a MIDI status byte. Members that do not apply to the
 * message kind are `null` rather than 0, so `note === null` is distinguishable
 * from note number 0 (C-1).
 */
export interface IMidiParsed {
  readonly type: MidiMessageType;
  /** 1-16 for channel messages, `null` for system messages. */
  readonly channel: number | null;
  /** Note number 0-127 (note on/off and polyphonic aftertouch). */
  readonly note: number | null;
  /** Note velocity normalized to 0-1. */
  readonly velocity: number | null;
  /** Controller number 0-127 (control change only). */
  readonly control: number | null;
  /**
   * Raw 0-127 payload for control change / program change / aftertouch, and the
   * -1..1 normalized bend for pitch bend.
   */
  readonly value: number | null;
}

/**
 * One incoming MIDI message. `data` is a freshly allocated copy on every
 * message — the producer never mutates a published array (producer snapshot
 * contract), so a consumer that retains it (RxJS replay, a React snapshot) is
 * safe.
 */
export interface IMidiMessage extends IMidiParsed {
  readonly data: Uint8Array;
  /** Id of the `MIDIInput` the message arrived on. */
  readonly port: string;
  readonly portName: string;
  /** `MIDIMessageEvent.timeStamp` (page-relative milliseconds). */
  readonly timestamp: number;
}

/** A MIDI port as published to bindings. Plain, serializable, snapshot-safe. */
export interface IMidiDevice {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly direction: "input" | "output";
  readonly state: "connected" | "disconnected";
}

/** Options accepted by `MidiCore.observe()` / `setOptions()`. */
export interface IMidiOptions {
  /** Port id or case-insensitive name prefix. Omitted = every input port. */
  input?: string | null;
  /** Port id or case-insensitive name prefix. Omitted = the first output port. */
  output?: string | null;
  /** Only deliver messages on this channel (1-16). Omitted = every channel. */
  channel?: number | null;
  /** Request the system-exclusive grant (a separate, more restricted permission). */
  sysex?: boolean;
  /** Request access as soon as `observe()` runs, instead of waiting for `request()`. */
  auto?: boolean;
}

/**
 * Value types for MidiCore (headless) — the observable state properties.
 * Use with `bind()` from a wc-bindable binding core for compile-time checking.
 *
 * @example
 * ```typescript
 * const core = new MidiCore();
 * await core.request();
 * bind(core, (name: keyof WcsMidiCoreValues, value) => { ... });
 * ```
 */
export interface WcsMidiCoreValues {
  message: IMidiMessage | null;
  type: MidiMessageType | null;
  channel: number | null;
  note: number | null;
  velocity: number | null;
  control: number | null;
  value: number | null;
  devices: IMidiDevice[];
  connected: boolean;
  permission: MidiPermissionState;
  error: string | null;
  errorInfo: import("./core/platformCapability.js").WcsIoErrorInfo | null;
}

/** Observable surface of the Shell (`<wcs-midi>`) — identical to the Core's. */
export type WcsMidiValues = WcsMidiCoreValues;

/**
 * Settable input surface for the Shell (`<wcs-midi>`) — the attributes mirrored
 * as properties. Matches the `inputs` entries of the wc-bindable manifest.
 */
export interface WcsMidiInputs {
  input: string;
  output: string;
  channel: number | null;
  sysex: boolean;
  auto: boolean;
}
