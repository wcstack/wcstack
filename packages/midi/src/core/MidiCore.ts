import {
  IMidiDevice, IMidiMessage, IMidiOptions, IWcBindable, MidiMessageType,
  MidiPermissionState,
} from "../types.js";
import type { WcsIoErrorInfo } from "./platformCapability.js";
import { deriveMidiErrorInfo } from "./midiCapabilities.js";
import { parseMessage } from "../midi/parseMessage.js";

const UNSUPPORTED = "unsupported";

// Minimal structural types for the Web MIDI API. The DOM lib does not ship them
// in every TypeScript configuration, and structural types keep the Core testable
// against a fake without casting through `any` at each use site.
interface MidiPortLike extends EventTarget {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  state: string;
  type?: string;
}
interface MidiInputLike extends MidiPortLike {
  onmidimessage: ((event: any) => void) | null;
}
interface MidiOutputLike extends MidiPortLike {
  send(data: number[] | Uint8Array, timestamp?: number): void;
}
interface MidiAccessLike {
  inputs: Map<string, MidiInputLike>;
  outputs: Map<string, MidiOutputLike>;
  onstatechange: ((event: any) => void) | null;
  sysexEnabled?: boolean;
}

const detailOf = (event: Event): any => (event as CustomEvent).detail;
const messageField = <K extends keyof IMidiMessage>(key: K) =>
  (event: Event): IMidiMessage[K] | null => detailOf(event)?.[key] ?? null;

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
export class MidiCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      // One occurrence event, decomposed into derived getters
      // (async-io-node-guidelines.md §4.2). Never same-value guarded: two
      // identical note-ons are two distinct presses.
      { name: "message", event: "wcs-midi:message", semantics: "event" },
      { name: "type", event: "wcs-midi:message", semantics: "event", getter: messageField("type") },
      { name: "channel", event: "wcs-midi:message", semantics: "event", getter: messageField("channel") },
      { name: "note", event: "wcs-midi:message", semantics: "event", getter: messageField("note") },
      { name: "velocity", event: "wcs-midi:message", semantics: "event", getter: messageField("velocity") },
      { name: "control", event: "wcs-midi:message", semantics: "event", getter: messageField("control") },
      { name: "value", event: "wcs-midi:message", semantics: "event", getter: messageField("value") },
      { name: "devices", event: "wcs-midi:devices", semantics: "state" },
      { name: "connected", event: "wcs-midi:statechange", semantics: "state" },
      { name: "permission", event: "wcs-midi:permission", semantics: "state" },
      { name: "granted", event: "wcs-midi:permission", semantics: "state", getter: (e: Event) => detailOf(e) === "granted" },
      { name: "denied", event: "wcs-midi:permission", semantics: "state", getter: (e: Event) => detailOf(e) === "denied" },
      { name: "unsupported", event: "wcs-midi:permission", semantics: "state", getter: (e: Event) => detailOf(e) === UNSUPPORTED },
      { name: "error", event: "wcs-midi:error", semantics: "state" },
      { name: "errorInfo", event: "wcs-midi:error-info-changed", semantics: "state" },
    ],
    commands: [
      { name: "request", async: true },
      { name: "close" },
      { name: "send" },
    ],
  };

  private _target: EventTarget;
  private _options: IMidiOptions = {};

  private _access: MidiAccessLike | null = null;
  private _hookedInputs = new Set<MidiInputLike>();

  private _message: IMidiMessage | null = null;
  private _devices: IMidiDevice[] = [];
  private _connected = false;
  private _permission: MidiPermissionState = "prompt";
  private _error: string | null = null;
  private _errorInfo: WcsIoErrorInfo | null = null;

  private _permissionStatus: PermissionStatus | null = null;

  // Monotonic id bumped by every request(), close() and dispose(). An in-flight
  // requestMIDIAccess() captures it and bails on resolve when superseded, so a
  // rapid disconnect→reconnect (or a close() mid-flight) never hooks listeners
  // onto a torn-down instance.
  private _gen = 0;

  private _ready: Promise<void> = Promise.resolve();

  constructor(options?: IMidiOptions | null, target?: EventTarget) {
    super();
    this._target = target ?? this;
    if (options) this._options = { ...options };
  }

  // --- Observable getters ---

  get message(): IMidiMessage | null { return this._message; }
  get type(): MidiMessageType | null { return this._message?.type ?? null; }
  get channel(): number | null { return this._message?.channel ?? null; }
  get note(): number | null { return this._message?.note ?? null; }
  get velocity(): number | null { return this._message?.velocity ?? null; }
  get control(): number | null { return this._message?.control ?? null; }
  get value(): number | null { return this._message?.value ?? null; }

  get devices(): IMidiDevice[] { return this._devices; }
  get connected(): boolean { return this._connected; }
  get permission(): MidiPermissionState { return this._permission; }
  get granted(): boolean { return this._permission === "granted"; }
  get denied(): boolean { return this._permission === "denied"; }
  get unsupported(): boolean { return this._permission === UNSUPPORTED; }
  get error(): string | null { return this._error; }
  get errorInfo(): WcsIoErrorInfo | null { return this._errorInfo; }

  /** Resolves once the current (or initial) access attempt settles. */
  get ready(): Promise<void> { return this._ready; }

  // --- Public API ---

  /**
   * Store the options and, when `auto` is set, request access. Idempotent:
   * calling it again with new options re-applies port selection to the live
   * access without re-requesting.
   */
  observe(options: IMidiOptions): Promise<void> {
    const wasIdle = this._access === null;
    this.setOptions(options);
    if (options.auto && wasIdle) {
      this._ready = this.request();
    }
    return this._ready;
  }

  /**
   * Re-apply port selection / channel filtering. Cheap and safe at any time —
   * with no access held it only records the options for a later `request()`.
   */
  setOptions(options: IMidiOptions): void {
    this._options = { ...this._options, ...options };
    if (this._access) this._hookInputs(this._access);
  }

  /**
   * Acquire MIDI access. Never rejects: a refusal or a missing API surfaces as
   * `permission` / `error` state (async-io-node-guidelines.md §3.6).
   */
  request(): Promise<void> {
    const requestAccess = this._resolveApi();
    if (!requestAccess) {
      this._setPermission(UNSUPPORTED);
      this._setError(UNSUPPORTED, UNSUPPORTED);
      this._ready = Promise.resolve();
      return this._ready;
    }
    const gen = ++this._gen;
    this._probePermission();
    this._ready = requestAccess({ sysex: this._options.sysex === true }).then(
      (access: MidiAccessLike) => {
        if (gen !== this._gen) return;
        this._access = access;
        access.onstatechange = this._onStateChange;
        this._setError(null);
        this._setPermission("granted");
        this._hookInputs(access);
        this._publishDevices(access);
        this._setConnected(true);
      },
      (error: any) => {
        if (gen !== this._gen) return;
        this._setPermission("denied");
        this._setError(this._messageOf(error), error?.name);
      },
    );
    return this._ready;
  }

  /**
   * Release the access handle and detach every listener, keeping the observed
   * permission state. A later `request()` re-acquires.
   */
  close(): void {
    this._gen++;
    this._unhookInputs();
    if (this._access) {
      this._access.onstatechange = null;
      this._access = null;
    }
    this._setConnected(false);
  }

  /**
   * Send a raw MIDI message to the selected output port (or the first available
   * one). No-op when no output is reachable; a failing `send()` surfaces on
   * `error` rather than throwing.
   *
   * Positional arguments pass through verbatim from command-token
   * (docs/spec-proposal-command-token-arguments.md).
   */
  send(data: number[] | Uint8Array, timestamp?: number): void {
    const port = this._resolveOutput();
    if (!port) return;
    try {
      port.send(data, timestamp);
    } catch (error: any) {
      this._setError(this._messageOf(error), "send");
    }
  }

  /**
   * Detach everything. Headless callers own this lifecycle themselves: without
   * it the live `onmidimessage` handlers keep this instance reachable for as
   * long as the ports are alive.
   */
  dispose(): void {
    this.close();
    if (this._permissionStatus) {
      this._permissionStatus.removeEventListener("change", this._onPermissionChange);
      this._permissionStatus = null;
    }
  }

  // --- Internal: API resolution ---

  // Resolved at call time, never cached: keeps the unsupported branch honest and
  // lets tests swap the global (async-io-node-guidelines.md §3.7). Read off
  // globalThis rather than the bare identifier so an SSR/worker context with no
  // navigator at all takes the same "unsupported" path as Safari.
  private _resolveApi(): ((options: { sysex: boolean }) => Promise<MidiAccessLike>) | null {
    const nav = (globalThis as { navigator?: any }).navigator;
    if (!nav || typeof nav.requestMIDIAccess !== "function") return null;
    return (options) => nav.requestMIDIAccess(options);
  }

  private _messageOf(error: any): string {
    return typeof error?.message === "string" && error.message !== "" ? error.message : "MIDI error";
  }

  // --- Internal: permission monitoring ---

  // Optional extra: browsers that answer query({name:"midi"}) let a grant flipped
  // in site settings flow into the declarative state without a re-request. Where
  // the descriptor is rejected we simply keep inferring from request() outcomes.
  private _probePermission(): void {
    if (this._permissionStatus) return;
    // Only ever reached after _resolveApi() found navigator.requestMIDIAccess,
    // so navigator itself is known to exist here.
    const permissions = (globalThis as { navigator?: any }).navigator.permissions;
    if (!permissions || typeof permissions.query !== "function") return;
    const gen = this._gen;
    permissions.query({ name: "midi", sysex: this._options.sysex === true }).then(
      (status: PermissionStatus) => {
        if (gen !== this._gen) return;
        this._permissionStatus = status;
        this._setPermission(status.state as MidiPermissionState);
        status.addEventListener("change", this._onPermissionChange);
      },
      () => { /* descriptor not understood — request() outcomes remain the source */ },
    );
  }

  private _onPermissionChange = (event: Event): void => {
    this._setPermission((event.target as PermissionStatus).state as MidiPermissionState);
  };

  // --- Internal: ports ---

  private _matches(port: MidiPortLike, selector: string): boolean {
    if (port.id === selector) return true;
    const name = port.name ?? "";
    return name.toLowerCase().startsWith(selector.toLowerCase());
  }

  // Takes the access explicitly rather than reading the field: every call site
  // already holds a non-null handle, and a defensive re-check here would be a
  // branch no test could ever reach.
  private _selectedInputs(access: MidiAccessLike): MidiInputLike[] {
    const all = [...access.inputs.values()];
    const selector = this._options.input;
    // No selector means "whatever is plugged in" — the expectation for MIDI is
    // that a controller just works, not that the page names it first.
    if (selector === undefined || selector === null || selector === "") return all;
    return all.filter((port) => this._matches(port, selector));
  }

  private _resolveOutput(): MidiOutputLike | null {
    if (!this._access) return null;
    const all = [...this._access.outputs.values()];
    const selector = this._options.output;
    if (selector === undefined || selector === null || selector === "") return all[0] ?? null;
    return all.find((port) => this._matches(port, selector)) ?? null;
  }

  private _hookInputs(access: MidiAccessLike): void {
    const wanted = new Set(this._selectedInputs(access));
    for (const port of this._hookedInputs) {
      if (!wanted.has(port)) {
        port.onmidimessage = null;
        this._hookedInputs.delete(port);
      }
    }
    for (const port of wanted) {
      if (this._hookedInputs.has(port)) continue;
      port.onmidimessage = this._onMidiMessage;
      this._hookedInputs.add(port);
    }
  }

  private _unhookInputs(): void {
    for (const port of this._hookedInputs) port.onmidimessage = null;
    this._hookedInputs.clear();
  }

  private _onStateChange = (): void => {
    // Port list changed: re-apply selection (a newly plugged input must start
    // delivering) and republish. `onstatechange` is only installed while an
    // access is held and cleared in close(), so the handle is non-null here.
    const access = this._access!;
    this._hookInputs(access);
    this._publishDevices(access);
  };

  private _onMidiMessage = (event: { data?: Uint8Array | null; target?: any; timeStamp?: number }): void => {
    const raw = event.data;
    if (!raw) return;
    const parsed = parseMessage(raw);
    const channelFilter = this._options.channel;
    if (channelFilter != null && parsed.channel !== null && parsed.channel !== channelFilter) return;
    const port = event.target as MidiPortLike | undefined;
    this._publishMessage({
      ...parsed,
      // Fresh copy every time: the platform buffer must never be handed out
      // (producer snapshot contract).
      data: new Uint8Array(raw),
      port: port?.id ?? "",
      portName: port?.name ?? "",
      timestamp: event.timeStamp ?? 0,
    });
  };

  // --- Internal: state setters ---

  // Occurrence, not state: identical payloads are distinct presses, so there is
  // deliberately no same-value guard here.
  private _publishMessage(message: IMidiMessage): void {
    this._message = message;
    this._target.dispatchEvent(new CustomEvent("wcs-midi:message", { detail: message, bubbles: true }));
  }

  private _publishDevices(access: MidiAccessLike): void {
    const next = this._snapshotDevices(access);
    if (this._sameDevices(next)) return;
    // Fresh array assigned before notifying (producer snapshot contract).
    this._devices = next;
    this._target.dispatchEvent(new CustomEvent("wcs-midi:devices", { detail: next, bubbles: true }));
  }

  private _snapshotDevices(access: MidiAccessLike): IMidiDevice[] {
    const collect = (ports: Map<string, MidiPortLike>, direction: "input" | "output"): IMidiDevice[] =>
      [...ports.values()].map((port) => ({
        id: port.id,
        name: port.name ?? "",
        manufacturer: port.manufacturer ?? "",
        direction,
        state: port.state === "connected" ? "connected" : "disconnected",
      }));
    return [
      ...collect(access.inputs as Map<string, MidiPortLike>, "input"),
      ...collect(access.outputs as Map<string, MidiPortLike>, "output"),
    ];
  }

  // Content comparison, not reference: statechange fires separately for the
  // input and the output side of one physical device, so an unfiltered
  // republish would double-notify on every plug.
  private _sameDevices(next: IMidiDevice[]): boolean {
    if (next.length !== this._devices.length) return false;
    return next.every((device, i) => {
      const prev = this._devices[i];
      return prev.id === device.id && prev.state === device.state
        && prev.direction === device.direction && prev.name === device.name;
    });
  }

  private _setConnected(connected: boolean): void {
    if (this._connected === connected) return;
    this._connected = connected;
    this._target.dispatchEvent(new CustomEvent("wcs-midi:statechange", { detail: connected, bubbles: true }));
  }

  private _setPermission(permission: MidiPermissionState): void {
    if (this._permission === permission) return;
    this._permission = permission;
    this._target.dispatchEvent(new CustomEvent("wcs-midi:permission", { detail: permission, bubbles: true }));
  }

  private _setError(error: string | null, name?: string): void {
    if (this._error !== error) {
      this._error = error;
      this._target.dispatchEvent(new CustomEvent("wcs-midi:error", { detail: error, bubbles: true }));
    }
    this._commitErrorInfo(error === null ? null : deriveMidiErrorInfo(name, error));
  }

  // errorInfo transitions exactly when error does (no independent same-value
  // guard: a fresh object is built per transition).
  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    if (this._errorInfo === null && info === null) return;
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-midi:error-info-changed", { detail: info, bubbles: true }));
  }
}
