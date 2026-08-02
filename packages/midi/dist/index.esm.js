const _config = {
    tagNames: {
        midi: "wcs-midi",
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
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    frozenConfig = null;
}

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
const WCS_MIDI_ERROR_CODE = {
    /** `navigator.requestMIDIAccess` 自体が不在(synthetic "unsupported")。 */
    CapabilityMissing: "capability-missing",
    /**
     * `SecurityError` / `NotAllowedError` — ユーザーが拒否した、あるいは
     * permissions policy / 非 secure context で許可されない。retry では回復しない。
     */
    NotAllowed: "not-allowed",
    /** その他の `requestMIDIAccess()` 失敗。fresh な request は成功しうる。 */
    AccessError: "access-error",
    /** `MIDIOutput.send()` の失敗(不正なメッセージ / 切断済みポート)。 */
    SendFailed: "send-failed",
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
function deriveMidiErrorInfo(name, message) {
    if (name === "unsupported") {
        return { code: WCS_MIDI_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    }
    if (name === "send") {
        return { code: WCS_MIDI_ERROR_CODE.SendFailed, phase: "execute", recoverable: true, message };
    }
    if (name === "SecurityError" || name === "NotAllowedError") {
        return { code: WCS_MIDI_ERROR_CODE.NotAllowed, phase: "start", recoverable: false, message };
    }
    return { code: WCS_MIDI_ERROR_CODE.AccessError, phase: "start", recoverable: true, message };
}

// Channel voice message commands (high nibble of the status byte).
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const POLY_AFTERTOUCH = 0xa0;
const CONTROL_CHANGE = 0xb0;
const PROGRAM_CHANGE = 0xc0;
const AFTERTOUCH = 0xd0;
const SYSTEM = 0xf0;
const SYSEX_START = 0xf0;
const EMPTY = {
    type: "other", channel: null, note: null, velocity: null, control: null, value: null,
};
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
function parseMessage(data) {
    const status = data[0];
    if (typeof status !== "number")
        return EMPTY;
    const d1 = typeof data[1] === "number" ? data[1] : 0;
    const d2 = typeof data[2] === "number" ? data[2] : 0;
    // System messages (0xF0-0xFF) carry no channel nibble.
    if (status >= SYSTEM) {
        return { ...EMPTY, type: status === SYSEX_START ? "sysex" : "other" };
    }
    // Below 0x80 is a data byte, not a status byte: the buffer is malformed or
    // running-status (which the Web MIDI API already expands for us).
    if (status < NOTE_OFF)
        return EMPTY;
    const command = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    switch (command) {
        case NOTE_OFF:
            return { type: "noteoff", channel, note: d1, velocity: d2 / 127, control: null, value: null };
        case NOTE_ON:
            // velocity 0 == note off (see doc comment).
            return d2 > 0
                ? { type: "noteon", channel, note: d1, velocity: d2 / 127, control: null, value: null }
                : { type: "noteoff", channel, note: d1, velocity: 0, control: null, value: null };
        case POLY_AFTERTOUCH:
            return { type: "polyaftertouch", channel, note: d1, velocity: null, control: null, value: d2 };
        case CONTROL_CHANGE:
            return { type: "controlchange", channel, note: null, velocity: null, control: d1, value: d2 };
        case PROGRAM_CHANGE:
            return { type: "programchange", channel, note: null, velocity: null, control: null, value: d1 };
        case AFTERTOUCH:
            return { type: "aftertouch", channel, note: null, velocity: null, control: null, value: d1 };
        default:
            // 0xE0 pitch bend — the only high nibble left between 0x80 and 0xEF once
            // the six cases above are taken. 14-bit little-endian, centered at 8192,
            // normalized to -1..1.
            return {
                type: "pitchbend", channel, note: null, velocity: null, control: null,
                value: (((d2 << 7) | d1) - 8192) / 8192,
            };
    }
}
/** Message kinds a caller may want to filter on, exported for tooling. */
const MIDI_MESSAGE_TYPES = [
    "noteon", "noteoff", "polyaftertouch", "controlchange",
    "programchange", "aftertouch", "pitchbend", "sysex", "other",
];

const UNSUPPORTED = "unsupported";
const detailOf = (event) => event.detail;
const messageField = (key) => (event) => detailOf(event)?.[key] ?? null;
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
class MidiCore extends EventTarget {
    static wcBindable = {
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
            { name: "granted", event: "wcs-midi:permission", semantics: "state", getter: (e) => detailOf(e) === "granted" },
            { name: "denied", event: "wcs-midi:permission", semantics: "state", getter: (e) => detailOf(e) === "denied" },
            { name: "unsupported", event: "wcs-midi:permission", semantics: "state", getter: (e) => detailOf(e) === UNSUPPORTED },
            { name: "error", event: "wcs-midi:error", semantics: "state" },
            { name: "errorInfo", event: "wcs-midi:error-info-changed", semantics: "state" },
        ],
        commands: [
            { name: "request", async: true },
            { name: "close" },
            { name: "send" },
        ],
    };
    _target;
    _options = {};
    _access = null;
    _hookedInputs = new Set();
    _message = null;
    _devices = [];
    _connected = false;
    _permission = "prompt";
    _error = null;
    _errorInfo = null;
    _permissionStatus = null;
    // Monotonic id bumped by every request(), close() and dispose(). An in-flight
    // requestMIDIAccess() captures it and bails on resolve when superseded, so a
    // rapid disconnect→reconnect (or a close() mid-flight) never hooks listeners
    // onto a torn-down instance.
    _gen = 0;
    _ready = Promise.resolve();
    constructor(options, target) {
        super();
        this._target = target ?? this;
        if (options)
            this._options = { ...options };
    }
    // --- Observable getters ---
    get message() { return this._message; }
    get type() { return this._message?.type ?? null; }
    get channel() { return this._message?.channel ?? null; }
    get note() { return this._message?.note ?? null; }
    get velocity() { return this._message?.velocity ?? null; }
    get control() { return this._message?.control ?? null; }
    get value() { return this._message?.value ?? null; }
    get devices() { return this._devices; }
    get connected() { return this._connected; }
    get permission() { return this._permission; }
    get granted() { return this._permission === "granted"; }
    get denied() { return this._permission === "denied"; }
    get unsupported() { return this._permission === UNSUPPORTED; }
    get error() { return this._error; }
    get errorInfo() { return this._errorInfo; }
    /** Resolves once the current (or initial) access attempt settles. */
    get ready() { return this._ready; }
    // --- Public API ---
    /**
     * Store the options and, when `auto` is set, request access. Idempotent:
     * calling it again with new options re-applies port selection to the live
     * access without re-requesting.
     */
    observe(options) {
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
    setOptions(options) {
        this._options = { ...this._options, ...options };
        if (this._access)
            this._hookInputs(this._access);
    }
    /**
     * Acquire MIDI access. Never rejects: a refusal or a missing API surfaces as
     * `permission` / `error` state (async-io-node-guidelines.md §3.6).
     */
    request() {
        const requestAccess = this._resolveApi();
        if (!requestAccess) {
            this._setPermission(UNSUPPORTED);
            this._setError(UNSUPPORTED, UNSUPPORTED);
            this._ready = Promise.resolve();
            return this._ready;
        }
        const gen = ++this._gen;
        this._probePermission();
        this._ready = requestAccess({ sysex: this._options.sysex === true }).then((access) => {
            if (gen !== this._gen)
                return;
            this._access = access;
            access.onstatechange = this._onStateChange;
            this._setError(null);
            this._setPermission("granted");
            this._hookInputs(access);
            this._publishDevices(access);
            this._setConnected(true);
        }, (error) => {
            if (gen !== this._gen)
                return;
            this._setPermission("denied");
            this._setError(this._messageOf(error), error?.name);
        });
        return this._ready;
    }
    /**
     * Release the access handle and detach every listener, keeping the observed
     * permission state. A later `request()` re-acquires.
     */
    close() {
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
    send(data, timestamp) {
        const port = this._resolveOutput();
        if (!port)
            return;
        try {
            port.send(data, timestamp);
        }
        catch (error) {
            this._setError(this._messageOf(error), "send");
        }
    }
    /**
     * Detach everything. Headless callers own this lifecycle themselves: without
     * it the live `onmidimessage` handlers keep this instance reachable for as
     * long as the ports are alive.
     */
    dispose() {
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
    _resolveApi() {
        const nav = globalThis.navigator;
        if (!nav || typeof nav.requestMIDIAccess !== "function")
            return null;
        return (options) => nav.requestMIDIAccess(options);
    }
    _messageOf(error) {
        return typeof error?.message === "string" && error.message !== "" ? error.message : "MIDI error";
    }
    // --- Internal: permission monitoring ---
    // Optional extra: browsers that answer query({name:"midi"}) let a grant flipped
    // in site settings flow into the declarative state without a re-request. Where
    // the descriptor is rejected we simply keep inferring from request() outcomes.
    _probePermission() {
        if (this._permissionStatus)
            return;
        // Only ever reached after _resolveApi() found navigator.requestMIDIAccess,
        // so navigator itself is known to exist here.
        const permissions = globalThis.navigator.permissions;
        if (!permissions || typeof permissions.query !== "function")
            return;
        const gen = this._gen;
        permissions.query({ name: "midi", sysex: this._options.sysex === true }).then((status) => {
            if (gen !== this._gen)
                return;
            this._permissionStatus = status;
            this._setPermission(status.state);
            status.addEventListener("change", this._onPermissionChange);
        }, () => { });
    }
    _onPermissionChange = (event) => {
        this._setPermission(event.target.state);
    };
    // --- Internal: ports ---
    _matches(port, selector) {
        if (port.id === selector)
            return true;
        const name = port.name ?? "";
        return name.toLowerCase().startsWith(selector.toLowerCase());
    }
    // Takes the access explicitly rather than reading the field: every call site
    // already holds a non-null handle, and a defensive re-check here would be a
    // branch no test could ever reach.
    _selectedInputs(access) {
        const all = [...access.inputs.values()];
        const selector = this._options.input;
        // No selector means "whatever is plugged in" — the expectation for MIDI is
        // that a controller just works, not that the page names it first.
        if (selector === undefined || selector === null || selector === "")
            return all;
        return all.filter((port) => this._matches(port, selector));
    }
    _resolveOutput() {
        if (!this._access)
            return null;
        const all = [...this._access.outputs.values()];
        const selector = this._options.output;
        if (selector === undefined || selector === null || selector === "")
            return all[0] ?? null;
        return all.find((port) => this._matches(port, selector)) ?? null;
    }
    _hookInputs(access) {
        const wanted = new Set(this._selectedInputs(access));
        for (const port of this._hookedInputs) {
            if (!wanted.has(port)) {
                port.onmidimessage = null;
                this._hookedInputs.delete(port);
            }
        }
        for (const port of wanted) {
            if (this._hookedInputs.has(port))
                continue;
            port.onmidimessage = this._onMidiMessage;
            this._hookedInputs.add(port);
        }
    }
    _unhookInputs() {
        for (const port of this._hookedInputs)
            port.onmidimessage = null;
        this._hookedInputs.clear();
    }
    _onStateChange = () => {
        // Port list changed: re-apply selection (a newly plugged input must start
        // delivering) and republish. `onstatechange` is only installed while an
        // access is held and cleared in close(), so the handle is non-null here.
        const access = this._access;
        this._hookInputs(access);
        this._publishDevices(access);
    };
    _onMidiMessage = (event) => {
        const raw = event.data;
        if (!raw)
            return;
        const parsed = parseMessage(raw);
        const channelFilter = this._options.channel;
        if (channelFilter != null && parsed.channel !== null && parsed.channel !== channelFilter)
            return;
        const port = event.target;
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
    _publishMessage(message) {
        this._message = message;
        this._target.dispatchEvent(new CustomEvent("wcs-midi:message", { detail: message, bubbles: true }));
    }
    _publishDevices(access) {
        const next = this._snapshotDevices(access);
        if (this._sameDevices(next))
            return;
        // Fresh array assigned before notifying (producer snapshot contract).
        this._devices = next;
        this._target.dispatchEvent(new CustomEvent("wcs-midi:devices", { detail: next, bubbles: true }));
    }
    _snapshotDevices(access) {
        const collect = (ports, direction) => [...ports.values()].map((port) => ({
            id: port.id,
            name: port.name ?? "",
            manufacturer: port.manufacturer ?? "",
            direction,
            state: port.state === "connected" ? "connected" : "disconnected",
        }));
        return [
            ...collect(access.inputs, "input"),
            ...collect(access.outputs, "output"),
        ];
    }
    // Content comparison, not reference: statechange fires separately for the
    // input and the output side of one physical device, so an unfiltered
    // republish would double-notify on every plug.
    _sameDevices(next) {
        if (next.length !== this._devices.length)
            return false;
        return next.every((device, i) => {
            const prev = this._devices[i];
            return prev.id === device.id && prev.state === device.state
                && prev.direction === device.direction && prev.name === device.name;
        });
    }
    _setConnected(connected) {
        if (this._connected === connected)
            return;
        this._connected = connected;
        this._target.dispatchEvent(new CustomEvent("wcs-midi:statechange", { detail: connected, bubbles: true }));
    }
    _setPermission(permission) {
        if (this._permission === permission)
            return;
        this._permission = permission;
        this._target.dispatchEvent(new CustomEvent("wcs-midi:permission", { detail: permission, bubbles: true }));
    }
    _setError(error, name) {
        if (this._error !== error) {
            this._error = error;
            this._target.dispatchEvent(new CustomEvent("wcs-midi:error", { detail: error, bubbles: true }));
        }
        this._commitErrorInfo(error === null ? null : deriveMidiErrorInfo(name, error));
    }
    // errorInfo transitions exactly when error does (no independent same-value
    // guard: a fresh object is built per transition).
    _commitErrorInfo(info) {
        if (this._errorInfo === null && info === null)
            return;
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-midi:error-info-changed", { detail: info, bubbles: true }));
    }
}

// ===========================================================================
// AUTO-GENERATED FILE - DO NOT EDIT.
// Generated from /protocol/upgrade-properties.ts by scripts/sync-protocol-types.mjs.
// Run `node scripts/sync-protocol-types.mjs` after editing the source.
// ===========================================================================
function hasAccessorOnPrototype(target, name) {
    let proto = Object.getPrototypeOf(target);
    while (proto !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (descriptor !== undefined) {
            return typeof descriptor.get === "function" || typeof descriptor.set === "function";
        }
        proto = Object.getPrototypeOf(proto);
    }
    return false;
}
/**
 * `connectedCallback` の先頭で呼ぶ。宣言済み input のうち upgrade 前の代入で
 * accessor をシャドウしている own プロパティを、delete → 再代入で setter に通し直す。
 *
 * - 冪等: 再代入は accessor を通るので own プロパティは残らず、2 回目以降は no-op。
 * - 宣言に `inputs` が無い要素、`wcBindable` を持たない要素では何もしない。
 * - 値の意味は変えない。今まで捨てられていた代入が届くようになる一方向の変化。
 */
function upgradeProperties(element) {
    const declaration = element.constructor?.wcBindable;
    const inputs = declaration?.inputs;
    if (inputs === undefined)
        return;
    for (const input of inputs) {
        const name = input.name;
        if (!Object.prototype.hasOwnProperty.call(element, name))
            continue;
        if (!hasAccessorOnPrototype(element, name))
            continue;
        const record = element;
        const value = record[name];
        delete record[name];
        record[name] = value;
    }
}

/**
 * `<wcs-midi>` — declarative Web MIDI input/output.
 *
 * Nothing happens on connect: `requestMIDIAccess()` can raise a permission
 * prompt, so access is command-driven (`command.request`). Add the `auto`
 * attribute to opt into requesting as soon as the element connects.
 */
class WcsMidi extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static observedAttributes = ["input", "output", "channel"];
    static wcBindable = {
        ...MidiCore.wcBindable,
        inputs: [
            { name: "input", attribute: "input" },
            { name: "output", attribute: "output" },
            { name: "channel", attribute: "channel" },
            { name: "sysex", attribute: "sysex" },
            { name: "auto", attribute: "auto" },
        ],
    };
    _core;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    constructor() {
        super();
        this._core = new MidiCore(null, this);
        this._internals = this._initInternals();
        this._wireStates({
            "wcs-midi:permission": (d) => ({
                granted: d === "granted",
                denied: d === "denied",
                unsupported: d === "unsupported",
            }),
            "wcs-midi:statechange": (d) => ({ connected: d === true }),
            "wcs-midi:error": (d) => ({ error: d !== null }),
        });
    }
    // CSS state reflection (:state()) — debug-only snapshot getter. NOT part of
    // wc-bindable (not a bind target); see README "CSS styling with :state()".
    get debugStates() {
        return this._internals ? [...this._internals.states] : [];
    }
    _initInternals() {
        // never-throw (async-io-node-guidelines.md §3.6): attachInternals is absent
        // in happy-dom / older environments, and pre-125 Chromium rejects non-dashed
        // state names. Either case silently disables reflection.
        try {
            if (typeof this.attachInternals !== "function")
                return null;
            const internals = this.attachInternals();
            internals.states.add("wcs-probe");
            internals.states.delete("wcs-probe");
            return internals;
        }
        catch {
            return null;
        }
    }
    _wireStates(map) {
        if (this._internals === null)
            return;
        const states = this._internals.states;
        for (const [event, toStates] of Object.entries(map)) {
            this.addEventListener(event, (e) => {
                const debug = this.hasAttribute("debug-states");
                for (const [name, on] of Object.entries(toStates(e.detail))) {
                    try {
                        if (on) {
                            states.add(name);
                        }
                        else {
                            states.delete(name);
                        }
                    }
                    catch { /* never-throw */ }
                    if (debug)
                        this.toggleAttribute(`data-wcs-state-${name}`, on);
                }
            });
        }
    }
    // --- Attribute accessors ---
    get input() { return this.getAttribute("input") ?? ""; }
    set input(value) { this.setAttribute("input", value); }
    get output() { return this.getAttribute("output") ?? ""; }
    set output(value) { this.setAttribute("output", value); }
    get channel() {
        const raw = this.getAttribute("channel");
        if (raw === null)
            return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }
    set channel(value) {
        if (value === null) {
            this.removeAttribute("channel");
        }
        else {
            this.setAttribute("channel", String(value));
        }
    }
    get sysex() { return this.hasAttribute("sysex"); }
    set sysex(value) { this.toggleAttribute("sysex", value); }
    get auto() { return this.hasAttribute("auto"); }
    set auto(value) { this.toggleAttribute("auto", value); }
    // --- Core delegated getters ---
    get message() { return this._core.message; }
    get type() { return this._core.type; }
    get note() { return this._core.note; }
    get velocity() { return this._core.velocity; }
    get control() { return this._core.control; }
    get value() { return this._core.value; }
    get devices() { return this._core.devices; }
    get connected() { return this._core.connected; }
    get permission() { return this._core.permission; }
    get granted() { return this._core.granted; }
    get denied() { return this._core.denied; }
    get unsupported() { return this._core.unsupported; }
    get error() { return this._core.error; }
    get errorInfo() { return this._core.errorInfo; }
    /** Headless escape hatch: the Core backing this element. */
    get core() { return this._core; }
    get connectedCallbackPromise() {
        return this._connectedCallbackPromise;
    }
    // --- Commands ---
    request() { return this._core.request(); }
    close() { this._core.close(); }
    send(data, timestamp) { this._core.send(data, timestamp); }
    // --- Internal ---
    _options() {
        return {
            input: this.input,
            output: this.output,
            channel: this.channel,
            sysex: this.sysex,
            auto: this.auto,
        };
    }
    // --- Lifecycle ---
    connectedCallback() {
        // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
        upgradeProperties(this);
        this.style.display = "none";
        this._connectedCallbackPromise = this._core.observe(this._options());
    }
    disconnectedCallback() {
        this._core.dispose();
    }
    attributeChangedCallback(_name, oldValue, newValue) {
        if (oldValue === newValue)
            return;
        // Port selection and channel filtering are live: they re-hook the existing
        // access rather than re-requesting it (no second permission prompt).
        if (this.isConnected)
            this._core.setOptions(this._options());
    }
}

function registerComponents() {
    if (!customElements.get(config.tagNames.midi)) {
        customElements.define(config.tagNames.midi, WcsMidi);
    }
}

function bootstrapMidi(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { MIDI_MESSAGE_TYPES, MidiCore, WCS_MIDI_ERROR_CODE, WcsMidi, bootstrapMidi, deriveMidiErrorInfo, getConfig, parseMessage };
//# sourceMappingURL=index.esm.js.map
