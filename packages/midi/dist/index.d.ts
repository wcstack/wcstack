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

/**
 * Observation semantics of a `properties` entry.
 *
 *   "state"  — current value. A snapshot may cache it, and equality-based dedupe is safe.
 *   "event"  — occurrence. Repeated identical payloads are distinct occurrences; never dedupe.
 *   "handle" — live / opaque resource with its own lifecycle (e.g. MediaStream). Not
 *              snapshot-safe and not necessarily serializable; consumers need an explicit
 *              ref / callback surface rather than a value slot.
 */
type WcBindableSemantics = "state" | "event" | "handle";
interface IWcBindableProperty {
    readonly name: string;
    readonly event: string;
    readonly getter?: (event: Event) => any;
    /**
     * Optional, additive, forward-compatible. An absent value means **unspecified**, NOT
     * "state": a reader that finds no `semantics` MUST keep the behavior it had before this
     * field existed (deliver the update as-is; do not start deduping, caching or serializing
     * on assumption). Only an explicit value licenses a reader to change its handling.
     */
    readonly semantics?: WcBindableSemantics;
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
    readonly midi: string;
}
interface IWritableTagNames {
    midi?: string;
}
interface IConfig {
    readonly tagNames: ITagNames;
}
interface IWritableConfig {
    tagNames?: IWritableTagNames;
}

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
type MidiPermissionState = "prompt" | "granted" | "denied" | "unsupported";
/**
 * Normalized message kind. `"noteoff"` covers both a real note-off (status 0x8n)
 * and the note-on-with-zero-velocity idiom (0x9n with data2 === 0), because they
 * mean the same thing to every consumer — see README "velocity 0".
 */
type MidiMessageType = "noteon" | "noteoff" | "polyaftertouch" | "controlchange" | "programchange" | "aftertouch" | "pitchbend" | "sysex" | "other";
/**
 * Fields decoded from a MIDI status byte. Members that do not apply to the
 * message kind are `null` rather than 0, so `note === null` is distinguishable
 * from note number 0 (C-1).
 */
interface IMidiParsed {
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
interface IMidiMessage extends IMidiParsed {
    readonly data: Uint8Array;
    /** Id of the `MIDIInput` the message arrived on. */
    readonly port: string;
    readonly portName: string;
    /** `MIDIMessageEvent.timeStamp` (page-relative milliseconds). */
    readonly timestamp: number;
}
/** A MIDI port as published to bindings. Plain, serializable, snapshot-safe. */
interface IMidiDevice {
    readonly id: string;
    readonly name: string;
    readonly manufacturer: string;
    readonly direction: "input" | "output";
    readonly state: "connected" | "disconnected";
}
/** Options accepted by `MidiCore.observe()` / `setOptions()`. */
interface IMidiOptions {
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
interface WcsMidiCoreValues {
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
    errorInfo: WcsIoErrorInfo | null;
}
/** Observable surface of the Shell (`<wcs-midi>`) — identical to the Core's. */
type WcsMidiValues = WcsMidiCoreValues;
/**
 * Settable input surface for the Shell (`<wcs-midi>`) — the attributes mirrored
 * as properties. Matches the `inputs` entries of the wc-bindable manifest.
 */
interface WcsMidiInputs {
    input: string;
    output: string;
    channel: number | null;
    sysex: boolean;
    auto: boolean;
}

declare function bootstrapMidi(userConfig?: IWritableConfig, registry?: CustomElementRegistry): void;

declare function getConfig(): IConfig;

/**
 * Headless Web MIDI primitive: a framework-agnostic wrapper around
 * `navigator.requestMIDIAccess()` exposed through the wc-bindable protocol.
 *
 * Direction is genuinely two-way, unlike `@wcstack/permission` (monitor only):
 * incoming messages flow element → state as `event`-semantics occurrences, and
 * `send()` is a command going the other way. Both live on one node because a
 * page holds exactly one `MIDIAccess` — splitting input and output into two tags
 * would only force them to coordinate over the same shared handle.
 *
 * Nothing starts on construction. `requestMIDIAccess()` can raise a permission
 * prompt, so it is deliberately command-driven (`request()`), matching the
 * `idle` / Generic Sensor family. `observe({ auto: true })` opts back into
 * requesting immediately.
 *
 * The `MIDIAccess` handle itself is never published: the Core owns it and drops
 * it in `close()` / `dispose()`, as `worker` / `websocket` / `broadcast` do with
 * theirs. Only values cross the protocol boundary.
 */
declare class MidiCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _options;
    private _access;
    private _hookedInputs;
    private _message;
    private _devices;
    private _connected;
    private _permission;
    private _error;
    private _errorInfo;
    private _permissionStatus;
    private _gen;
    private _ready;
    constructor(options?: IMidiOptions | null, target?: EventTarget);
    get message(): IMidiMessage | null;
    get type(): MidiMessageType | null;
    get channel(): number | null;
    get note(): number | null;
    get velocity(): number | null;
    get control(): number | null;
    get value(): number | null;
    get devices(): IMidiDevice[];
    get connected(): boolean;
    get permission(): MidiPermissionState;
    get granted(): boolean;
    get denied(): boolean;
    get unsupported(): boolean;
    get error(): string | null;
    get errorInfo(): WcsIoErrorInfo | null;
    /** Resolves once the current (or initial) access attempt settles. */
    get ready(): Promise<void>;
    /**
     * Store the options and, when `auto` is set, request access. Idempotent:
     * calling it again with new options re-applies port selection to the live
     * access without re-requesting.
     */
    observe(options: IMidiOptions): Promise<void>;
    /**
     * Re-apply port selection / channel filtering. Cheap and safe at any time —
     * with no access held it only records the options for a later `request()`.
     */
    setOptions(options: IMidiOptions): void;
    /**
     * Acquire MIDI access. Never rejects: a refusal or a missing API surfaces as
     * `permission` / `error` state (async-io-node-guidelines.md §3.6).
     */
    request(): Promise<void>;
    /**
     * Release the access handle and detach every listener, keeping the observed
     * permission state. A later `request()` re-acquires.
     */
    close(): void;
    /**
     * Send a raw MIDI message to the selected output port (or the first available
     * one). No-op when no output is reachable; a failing `send()` surfaces on
     * `error` rather than throwing.
     *
     * Positional arguments pass through verbatim from command-token
     * (docs/spec-proposal-command-token-arguments.md).
     */
    send(data: number[] | Uint8Array, timestamp?: number): void;
    /**
     * Detach everything. Headless callers own this lifecycle themselves: without
     * it the live `onmidimessage` handlers keep this instance reachable for as
     * long as the ports are alive.
     */
    dispose(): void;
    private _resolveApi;
    private _messageOf;
    private _probePermission;
    private _onPermissionChange;
    private _matches;
    private _selectedInputs;
    private _resolveOutput;
    private _hookInputs;
    private _unhookInputs;
    private _onStateChange;
    private _onMidiMessage;
    private _publishMessage;
    private _publishDevices;
    private _snapshotDevices;
    private _sameDevices;
    private _setConnected;
    private _setPermission;
    private _setError;
    private _commitErrorInfo;
}

/**
 * `<wcs-midi>` — declarative Web MIDI input/output.
 *
 * Nothing happens on connect: `requestMIDIAccess()` can raise a permission
 * prompt, so access is command-driven (`command.request`). Add the `auto`
 * attribute to opt into requesting as soon as the element connects.
 */
declare class WcsMidi extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static observedAttributes: string[];
    static wcBindable: IWcBindable;
    private _core;
    private _connectedCallbackPromise;
    private _internals;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get input(): string;
    set input(value: string);
    get output(): string;
    set output(value: string);
    get channel(): number | null;
    set channel(value: number | null);
    get sysex(): boolean;
    set sysex(value: boolean);
    get auto(): boolean;
    set auto(value: boolean);
    get message(): IMidiMessage | null;
    get type(): MidiMessageType | null;
    get note(): number | null;
    get velocity(): number | null;
    get control(): number | null;
    get value(): number | null;
    get devices(): IMidiDevice[];
    get connected(): boolean;
    get permission(): MidiPermissionState;
    get granted(): boolean;
    get denied(): boolean;
    get unsupported(): boolean;
    get error(): string | null;
    get errorInfo(): WcsIoErrorInfo | null;
    /** Headless escape hatch: the Core backing this element. */
    get core(): MidiCore;
    get connectedCallbackPromise(): Promise<void>;
    request(): Promise<void>;
    close(): void;
    send(data: number[] | Uint8Array, timestamp?: number): void;
    private _options;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void;
}

/**
 * Decode a raw MIDI message into the fields bindings actually want.
 *
 * Two normalizations are deliberate, because every consumer would otherwise
 * repeat them:
 *
 * - **A note-on with velocity 0 is reported as `"noteoff"`.** Many controllers
 *   send running-status note-ons and never emit 0x8n at all; treating them as
 *   note-ons leaves stuck notes. The raw status byte is still available in
 *   `data[0]` for callers that care.
 * - **Velocity is normalized to 0-1**, so it multiplies straight into a gain
 *   without the caller knowing about the 7-bit MIDI range. Controller values
 *   stay raw 0-127 (`value`), since their meaning is per-controller.
 *
 * Never throws: a truncated or nonsensical buffer decodes to `type: "other"`
 * with every field `null` (async-io-node-guidelines.md §3.6).
 */
declare function parseMessage(data: Uint8Array | number[]): IMidiParsed;
/** Message kinds a caller may want to filter on, exported for tooling. */
declare const MIDI_MESSAGE_TYPES: readonly MidiMessageType[];

/**
 * midiCapabilities.ts
 *
 * Web MIDI 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)
 * から import する。
 *
 * この node の失敗は 2 箇所からしか来ない:
 *   1. `requestMIDIAccess()` の rejection — 権限拒否・API 不在・sysex 拒否。
 *   2. `MIDIOutput.send()` の throw — 不正なメッセージ・切断済みポート。
 * `_setError` は screen-orientation と同じ discriminator 技法で、synthetic な
 * `"unsupported"` / `"send"` ヒントと caught された `Error.name` を弁別する
 * (message の文言に依存した分岐を作らない)。
 */

/** 安定した midi error code(taxonomy)。値は公開キーとして固定。 */
declare const WCS_MIDI_ERROR_CODE: {
    /** `navigator.requestMIDIAccess` 自体が不在(synthetic "unsupported")。 */
    readonly CapabilityMissing: "capability-missing";
    /**
     * `SecurityError` / `NotAllowedError` — ユーザーが拒否した、あるいは
     * permissions policy / 非 secure context で許可されない。retry では回復しない。
     */
    readonly NotAllowed: "not-allowed";
    /** その他の `requestMIDIAccess()` 失敗。fresh な request は成功しうる。 */
    readonly AccessError: "access-error";
    /** `MIDIOutput.send()` の失敗(不正なメッセージ / 切断済みポート)。 */
    readonly SendFailed: "send-failed";
};
/**
 * Web MIDI の失敗を serializable な error taxonomy に写す。
 *
 * `name` は呼び出し側が渡す discriminator:
 * - `"unsupported"` — API 不在 → phase="probe" / capability-missing。
 * - `"send"` — 送信失敗 → phase="execute" / send-failed。recoverable(ポートが
 *   戻れば成功しうる)。
 * - `SecurityError` / `NotAllowedError` — 拒否 → phase="start" / not-allowed。
 * - それ以外(`AbortError`、生の throw、`.name` 欠如等) → phase="start" /
 *   access-error。
 */
declare function deriveMidiErrorInfo(name: string | undefined, message: string): WcsIoErrorInfo;

declare global {
    interface HTMLElementTagNameMap {
        "wcs-midi": WcsMidi;
    }
}

export { MIDI_MESSAGE_TYPES, MidiCore, WCS_MIDI_ERROR_CODE, WcsMidi, bootstrapMidi, deriveMidiErrorInfo, getConfig, parseMessage };
export type { IMidiDevice, IMidiMessage, IMidiOptions, IMidiParsed, IWritableConfig, IWritableTagNames, MidiMessageType, MidiPermissionState, WcsIoErrorInfo, WcsMidiCoreValues, WcsMidiInputs, WcsMidiValues };
