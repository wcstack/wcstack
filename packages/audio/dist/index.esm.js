// A page may only hold a handful of AudioContexts before browsers start
// refusing to create more, so every <wcs-audio> on a page shares one. The
// registry key is a `Symbol.for`, not a module-level variable, so two copies of
// this bundle (a version-mixed CDN page) still converge on a single context
// instead of quietly splitting the page's audio in two.
const SHARED = Symbol.for("@wcstack/audio.context");
/**
 * Default context provider: one lazily created, page-wide `AudioContext`.
 * Returns `null` where Web Audio is absent (SSR, or a browser without it) so the
 * caller can report `"unsupported"` instead of throwing.
 *
 * Resolved at call time, never cached in a field, so tests can swap the global
 * and an unsupported environment is reported honestly.
 */
function defaultCreateContext() {
    const registry = globalThis;
    const existing = registry[SHARED];
    if (existing)
        return existing;
    const Ctor = registry.AudioContext ?? registry.webkitAudioContext;
    if (!Ctor)
        return null;
    const ctx = new Ctor();
    registry[SHARED] = ctx;
    return ctx;
}
/** Drop the shared context (tests, and pages that tear everything down). */
function releaseSharedContext() {
    const registry = globalThis;
    delete registry[SHARED];
}

const _config = {
    tagNames: {
        audio: "wcs-audio",
        voice: "wcs-voice",
        osc: "wcs-osc",
        noise: "wcs-noise",
        biquad: "wcs-biquad",
        gain: "wcs-gain",
        delay: "wcs-delay",
        shaper: "wcs-shaper",
        env: "wcs-env",
        lfo: "wcs-lfo",
        analyser: "wcs-analyser",
    },
    createContext: defaultCreateContext,
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
        // createContext is a function, so it is carried over by reference rather
        // than cloned — deepClone would turn it into an empty object.
        frozenConfig = deepFreeze({
            ...deepClone({ tagNames: _config.tagNames }),
            createContext: _config.createContext,
        });
    }
    return frozenConfig;
}
function setConfig(partialConfig) {
    if (partialConfig.tagNames) {
        Object.assign(_config.tagNames, partialConfig.tagNames);
    }
    if (partialConfig.createContext) {
        _config.createContext = partialConfig.createContext;
    }
    frozenConfig = null;
}

/**
 * audioCapabilities.ts
 *
 * Web Audio 固有の error code(taxonomy)と derivation。汎用の error info 型は
 * `./platformCapability.js`(/io-core/ から copy-distribution される生成ファイル)
 * から import する。
 *
 * この node の失敗経路は 2 つだけ:
 *   1. `AudioContext` コンストラクタ自体が不在(synthetic "unsupported")。
 *   2. `resume()` / `suspend()` の rejection — ほぼ常にユーザージェスチャ不足。
 *
 * グラフ配線の不整合(解決できない `out="..."` 等)は error ではなく **warning** に
 * 出す。1 本の配線ミスでパッチ全体を失敗扱いにすると、鳴らせるはずの残り全部まで
 * 落ちるため(never-throw の精神)。
 */
/** 安定した audio error code(taxonomy)。値は公開キーとして固定。 */
const WCS_AUDIO_ERROR_CODE = {
    /** `AudioContext` / `webkitAudioContext` が不在(synthetic "unsupported")。 */
    CapabilityMissing: "capability-missing",
    /**
     * `NotAllowedError` — ユーザージェスチャ前の `resume()`。ジェスチャ後の再試行で
     * 回復する。
     */
    NotAllowed: "not-allowed",
    /** その他の context 操作失敗。 */
    ContextError: "context-error",
};
/**
 * Web Audio の失敗を serializable な error taxonomy に写す。
 *
 * `name` は呼び出し側が渡す discriminator:
 * - `"unsupported"` — API 不在 → phase="probe" / capability-missing。
 * - `NotAllowedError` — ジェスチャ不足 → phase="start" / not-allowed。recoverable。
 * - それ以外 → phase="execute" / context-error。
 */
function deriveAudioErrorInfo(name, message) {
    if (name === "unsupported") {
        return { code: WCS_AUDIO_ERROR_CODE.CapabilityMissing, phase: "probe", recoverable: false, message };
    }
    if (name === "NotAllowedError") {
        return { code: WCS_AUDIO_ERROR_CODE.NotAllowed, phase: "start", recoverable: true, message };
    }
    return { code: WCS_AUDIO_ERROR_CODE.ContextError, phase: "execute", recoverable: true, message };
}

const nodeKey = (n) => `${n.kind}#${n.key}@${n.id ?? ""}|${(n.out ?? []).join(",")}|${n.param ?? ""}` +
    `|${n.note ? 1 : 0}|${n.master ? 1 : 0}(${(n.children ?? []).map(nodeKey).join(" ")})`;
/**
 * Serialize everything about a patch that affects graph **topology** — kinds,
 * keys, ids, routing, nesting, voice templates — and deliberately nothing about
 * its **values**.
 *
 * That split is what makes `setPatch()` self-classifying: a patch differing only
 * in numbers produces the same key and is applied as a live update, while any
 * structural difference triggers a rebuild. Callers can therefore re-submit the
 * whole patch on any change without deciding which kind of change it was, and a
 * redundant re-submission is free (ADR-14 G5: idempotent `setPatch`).
 */
function structureKey(patch) {
    const nodes = patch.nodes.map(nodeKey).join(" ");
    const voices = (patch.voices ?? [])
        .map((v) => `voice#${v.key}*${v.poly}(${v.nodes.map(nodeKey).join(" ")})`)
        .join(" ");
    return `${nodes}||${voices}`;
}

/** A `<wcs-voice>` template plus the notes currently allocated from it. */
class VoiceAllocator {
    def;
    active = [];
    constructor(def) {
        this.def = def;
    }
    get poly() {
        return Math.max(this.def.poly, 1);
    }
    /** Notes still sounding — a released voice is no longer one of them. */
    get sounding() {
        return this.active.filter((a) => !a.released).length;
    }
    /** Voices still holding audio nodes, released-but-not-yet-reclaimed included. */
    get allocated() {
        return this.active.length;
    }
    add(allocation) {
        this.active.push(allocation);
    }
    /** Voices playing `note` that have not been released yet. */
    matching(note) {
        return this.active.filter((a) => a.note === note && !a.released);
    }
    /** Oldest sounding voice — the one note stealing takes when `poly` is full. */
    oldest() {
        return this.active.find((a) => !a.released);
    }
    /** Begin the release tail. `freeAt` is on the audio clock, never wall-clock. */
    release(allocation, t) {
        allocation.released = true;
        let tail = 0.08;
        if (allocation.gates.length > 0) {
            for (const gate of allocation.gates)
                gate.off(t);
            tail = Math.max(...allocation.gates.map((g) => g.release()), tail);
        }
        else {
            allocation.gain.gain.setTargetAtTime(0, t, tail / 3);
        }
        // setTargetAtTime approaches its target exponentially; three time constants
        // is ~95%, and the extra 0.3s covers the tail below audibility.
        allocation.freeAt = t + tail * 3 + 0.3;
    }
    /** Steal: a fast fade so the reused voice does not click. */
    steal(allocation, t) {
        allocation.released = true;
        allocation.gain.gain.cancelScheduledValues(t);
        allocation.gain.gain.setTargetAtTime(0, t, 0.01);
        allocation.freeAt = t + 0.08;
    }
    /** Reclaim every released voice whose tail has elapsed on the audio clock. */
    sweep(now) {
        for (const allocation of [...this.active]) {
            if (allocation.released && allocation.freeAt <= now)
                this.dispose(allocation);
        }
    }
    dispose(allocation) {
        for (const inst of allocation.instances.values())
            inst.dispose?.();
        try {
            allocation.gain.disconnect();
        }
        catch { /* already detached */ }
        const i = this.active.indexOf(allocation);
        if (i !== -1)
            this.active.splice(i, 1);
    }
    disposeAll() {
        for (const allocation of [...this.active])
            this.dispose(allocation);
    }
}

const num = (v, dflt) => {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : dflt;
};
const isModulator = (node) => node.param != null || node.kind === "lfo";
const isMasterTap = (node) => node.kind === "analyser" && node.master === true;
/** Parameter name → default. Only names listed here are AudioParams. */
const PARAM_DEFAULTS = {
    osc: { frequency: 440, detune: 0 },
    noise: {},
    biquad: { frequency: 1000, q: 1, gain: 0, detune: 0 },
    gain: { gain: 1 },
    delay: { time: 0.3, feedback: 0.3 },
    shaper: {},
    env: {},
    lfo: { rate: 5, depth: 10 },
    analyser: {},
};
/** Soft-clipping transfer curve; `k` is the drive amount. */
function shaperCurve(k) {
    const n = 1024;
    // Backed by a plain ArrayBuffer so the type matches WaveShaperNode.curve,
    // which does not accept a SharedArrayBuffer-backed view.
    const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
    for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
}
// One noise buffer per context: two seconds of white noise, looped. Regenerating
// it per voice would allocate a megabyte on every keypress.
const noiseBuffers = new WeakMap();
function noiseBuffer(ctx) {
    let buffer = noiseBuffers.get(ctx);
    if (!buffer) {
        buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 2)), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++)
            data[i] = Math.random() * 2 - 1;
        noiseBuffers.set(ctx, buffer);
    }
    return buffer;
}
const base = (kind, node) => 
// glide / transpose are always present so the note-setting path needs no
// defaulting branch; only the oscillator ever changes them from 0.
({ key: node.key, kind, params: {}, nodes: [], glide: 0, transpose: 0 });
const BUILDERS = {
    osc(ctx, node) {
        const osc = ctx.createOscillator();
        osc.start();
        return {
            ...base("osc", node), osc, output: osc, sources: [osc], nodes: [osc],
            params: { frequency: osc.frequency, detune: osc.detune },
        };
    },
    noise(ctx, node) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx);
        src.loop = true;
        src.start();
        return { ...base("noise", node), output: src, sources: [src], nodes: [src] };
    },
    biquad(ctx, node) {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        return {
            ...base("biquad", node), filter, input: filter, output: filter, nodes: [filter],
            params: { frequency: filter.frequency, q: filter.Q, gain: filter.gain, detune: filter.detune },
        };
    },
    gain(ctx, node) {
        const g = ctx.createGain();
        return { ...base("gain", node), input: g, output: g, nodes: [g], params: { gain: g.gain } };
    },
    delay(ctx, node) {
        const input = ctx.createGain();
        const delay = ctx.createDelay(5);
        const feedback = ctx.createGain();
        const wet = ctx.createGain();
        const dry = ctx.createGain();
        const output = ctx.createGain();
        input.connect(dry).connect(output);
        input.connect(delay);
        delay.connect(feedback).connect(delay);
        delay.connect(wet).connect(output);
        feedback.gain.value = 0.3;
        wet.gain.value = 0.5;
        dry.gain.value = 0.5;
        return {
            ...base("delay", node), input, output, wet, dry,
            nodes: [input, delay, feedback, wet, dry, output],
            params: { time: delay.delayTime, feedback: feedback.gain },
        };
    },
    shaper(ctx, node) {
        const shaper = ctx.createWaveShaper();
        shaper.curve = shaperCurve(20);
        shaper.oversample = "2x";
        return { ...base("shaper", node), shaper, input: shaper, output: shaper, nodes: [shaper] };
    },
    /**
     * ADSR envelope with two roles decided by the patch: in the chain (no `param`)
     * it is a VCA — a gain whose value follows the envelope. With `param` it is a
     * modulator — a constant source scaled by the same envelope.
     */
    env(ctx, node) {
        const g = ctx.createGain();
        g.gain.value = 0;
        const inst = {
            ...base("env", node),
            envParam: g.gain,
            adsr: { a: 0.01, d: 0.1, s: 0.7, r: 0.3, depth: 1 },
            nodes: [g],
        };
        if (isModulator(node)) {
            const src = ctx.createConstantSource();
            src.offset.value = 1;
            src.start();
            src.connect(g);
            inst.output = g;
            inst.sources = [src];
            inst.nodes.push(src);
        }
        else {
            inst.input = g;
            inst.output = g;
        }
        const adsr = inst.adsr;
        const param = inst.envParam;
        inst.gate = {
            on: (t, velocity) => {
                const peak = adsr.depth * velocity;
                param.cancelScheduledValues(t);
                param.setValueAtTime(param.value, t);
                param.linearRampToValueAtTime(peak, t + adsr.a);
                param.setTargetAtTime(peak * adsr.s, t + adsr.a, adsr.d / 3);
            },
            off: (t) => {
                param.cancelScheduledValues(t);
                param.setValueAtTime(param.value, t);
                param.setTargetAtTime(0, t, adsr.r / 3);
            },
            release: () => adsr.r,
        };
        return inst;
    },
    /** Always a modulator: `rate` in Hz, `depth` in the target parameter's units. */
    lfo(ctx, node) {
        const osc = ctx.createOscillator();
        const depth = ctx.createGain();
        osc.connect(depth);
        osc.start();
        return {
            ...base("lfo", node), osc, output: depth, sources: [osc], nodes: [osc, depth],
            params: { rate: osc.frequency, depth: depth.gain },
        };
    },
    analyser(ctx, node) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.85;
        // Keep the analyser on an always-pulled path: Chromium can silently drop an
        // edge into a sink-only AnalyserNode, notably one wired while the context is
        // still suspended. The keep-alive must terminate at `destination` — routing
        // it back through the master would close a feedback loop — and its gain of 0
        // means it carries no signal, so nothing bypasses the limiter.
        const mute = ctx.createGain();
        mute.gain.value = 0;
        analyser.connect(mute).connect(ctx.destination);
        return {
            ...base("analyser", node), analyser, input: analyser, output: analyser,
            nodes: [analyser, mute],
        };
    },
};
/** Non-AudioParam settings, applied at build time and on every live update. */
const PROPS = {
    osc: {
        type: (i, v) => { try {
            i.osc.type = v;
        }
        catch { /* invalid type */ } },
        glide: (i, v) => { i.glide = Math.max(num(v, 0), 0); },
        transpose: (i, v) => { i.transpose = num(v, 0); },
    },
    noise: {},
    biquad: {
        type: (i, v) => { try {
            i.filter.type = v;
        }
        catch { /* invalid type */ } },
    },
    gain: {},
    delay: {
        mix: (i, v) => {
            const mix = Math.min(Math.max(num(v, 0.5), 0), 1);
            i.wet.gain.value = mix;
            i.dry.gain.value = 1 - mix;
        },
    },
    shaper: {
        amount: (i, v) => { i.shaper.curve = shaperCurve(num(v, 20)); },
    },
    env: {
        attack: (i, v) => { i.adsr.a = Math.max(num(v, 0.01), 0.001); },
        decay: (i, v) => { i.adsr.d = Math.max(num(v, 0.1), 0.001); },
        sustain: (i, v) => { i.adsr.s = Math.min(Math.max(num(v, 0.7), 0), 1); },
        release: (i, v) => { i.adsr.r = Math.max(num(v, 0.3), 0.001); },
        depth: (i, v) => { i.adsr.depth = num(v, 1); },
    },
    lfo: {
        type: (i, v) => { try {
            i.osc.type = v;
        }
        catch { /* invalid type */ } },
    },
    analyser: {
        fft: (i, v) => { try {
            i.analyser.fftSize = num(v, 2048);
        }
        catch { /* not a power of two */ } },
        smoothing: (i, v) => { i.analyser.smoothingTimeConstant = Math.min(Math.max(num(v, 0.85), 0), 1); },
    },
};
/** MIDI note number → frequency in Hz (A4 = 69 = 440 Hz). */
const midiToFreq = (note) => 440 * 2 ** ((note - 69) / 12);
/**
 * Retune an oscillator instance. `initial` writes the value directly (a fresh
 * voice must start in tune); later changes glide or step on the audio clock.
 */
function setOscNote(inst, freq, t, initial) {
    const param = inst.params.frequency;
    const target = freq * 2 ** (inst.transpose / 12);
    if (initial)
        param.value = target;
    else if (inst.glide > 0)
        param.setTargetAtTime(target, t, inst.glide / 3);
    else
        param.setValueAtTime(target, t);
}

const UNSUPPORTED = "unsupported";
const detailOf = (event) => event.detail;
/**
 * Headless Web Audio graph primitive.
 *
 * Takes a **patch** — a plain-object descriptor tree — and turns it into a live
 * audio graph. It never touches the DOM: `<wcs-audio>` walks the markup and
 * hands the result here, but the patch can equally be written by hand, which is
 * what makes this a real headless surface rather than a shell of the element.
 *
 * Two invariants from docs/architecture-hardening/14-handle-graph-wiring.md:
 *
 * - **G1** — the descriptor tree is the source of truth for topology. Topology
 *   is not a value: it is read at build time, never diffed as reactive state.
 * - **G2** — the `AudioNode`s are owned and disposed here and never cross the
 *   protocol boundary, exactly as `worker` / `websocket` / `broadcast` treat
 *   their handles. What is published is values: context state, voice count,
 *   warnings, error.
 *
 * Timing (ADR-14 G4): writes are accepted synchronously and the getters reflect
 * them at once, but **when a write becomes audible is not specified** — that
 * depends on the render quantum and the output latency. The effective value is
 * never read back.
 */
class AudioGraphCore extends EventTarget {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
            { name: "state", event: "wcs-audio:statechange", semantics: "state" },
            { name: "running", event: "wcs-audio:statechange", semantics: "state", getter: (e) => detailOf(e) === "running" },
            { name: "suspended", event: "wcs-audio:statechange", semantics: "state", getter: (e) => detailOf(e) === "suspended" },
            { name: "unsupported", event: "wcs-audio:statechange", semantics: "state", getter: (e) => detailOf(e) === UNSUPPORTED },
            { name: "voices", event: "wcs-audio:voices", semantics: "state" },
            { name: "noteOn", event: "wcs-audio:noteon", semantics: "event" },
            { name: "noteOff", event: "wcs-audio:noteoff", semantics: "event" },
            { name: "warnings", event: "wcs-audio:warnings", semantics: "state" },
            { name: "error", event: "wcs-audio:error", semantics: "state" },
            { name: "errorInfo", event: "wcs-audio:error-info-changed", semantics: "state" },
        ],
        commands: [
            { name: "resume", async: true },
            { name: "suspend", async: true },
            { name: "noteOn" },
            { name: "noteOff" },
            { name: "allNotesOff" },
        ],
    };
    _target;
    _createContext;
    _ctx = null;
    _master = null;
    _limiter = null;
    _masterTaps = [];
    _patch = null;
    _structureKey = null;
    _desired = new Map();
    _instances = new Map();
    _live = null;
    _allocators = [];
    _held = [];
    _volume = 0.8;
    _limiterEnabled = true;
    _state = "suspended";
    _voices = 0;
    _warnings = [];
    _error = null;
    _errorInfo = null;
    // Bumped by every resume()/suspend() and by dispose(): an in-flight transition
    // that settles after a newer one (or after teardown) must not publish.
    _gen = 0;
    _ready = Promise.resolve();
    constructor(options, target) {
        super();
        this._target = target ?? this;
        this._createContext = options?.createContext ?? defaultCreateContext;
    }
    // --- Observable getters ---
    get state() { return this._state; }
    get running() { return this._state === "running"; }
    get suspended() { return this._state === "suspended"; }
    get unsupported() { return this._state === UNSUPPORTED; }
    get voices() { return this._voices; }
    get warnings() { return this._warnings; }
    get error() { return this._error; }
    get errorInfo() { return this._errorInfo; }
    get ready() { return this._ready; }
    /** Sounding notes, released tails excluded. */
    get soundingVoices() {
        return this._allocators.reduce((n, a) => n + a.sounding, 0);
    }
    /** Voices still holding nodes, including tails not yet reclaimed. */
    get allocatedVoices() {
        return this._allocators.reduce((n, a) => n + a.allocated, 0);
    }
    // --- Lifecycle ---
    /**
     * Install a patch and start observing. Idempotent — re-submitting the same
     * structure only applies values.
     */
    observe(patch) {
        this.setPatch(patch);
        return this._ready;
    }
    /**
     * Release every node this Core built. The shared `AudioContext` is left alone:
     * other `<wcs-audio>` elements on the page are still using it.
     *
     * Not terminal. A later `observe()` / `setPatch()` rebuilds from scratch, so
     * an element that is detached and re-attached — or simply moved in the DOM —
     * comes back playing. `PermissionCore` treats its subscription the same way.
     */
    dispose() {
        this._gen++;
        this._teardown();
        const ctx = this._ctx;
        // Detach the shared context's listener: the context outlives this Core, so
        // leaving it attached would keep every disposed instance reachable.
        ctx?.removeEventListener?.("statechange", this._onContextState);
        if (this._master) {
            try {
                this._master.disconnect();
            }
            catch { /* already detached */ }
        }
        if (this._limiter) {
            try {
                this._limiter.disconnect();
            }
            catch { /* already detached */ }
        }
        this._master = null;
        this._limiter = null;
        this._ctx = null;
        // Force the next setPatch() to rebuild rather than compare against a key
        // whose graph no longer exists.
        this._structureKey = null;
    }
    // --- Patch ---
    /**
     * Hand over the whole patch. Returns `true` when the topology changed and the
     * graph was rebuilt, `false` when only values were applied.
     *
     * A rebuild **cuts sounding voices** — that discontinuity is audible, and it
     * is why the structure key deliberately excludes numbers.
     */
    setPatch(patch) {
        if (!this._ensureContext())
            return false;
        this._patch = patch;
        const key = structureKey(patch);
        if (key === this._structureKey) {
            this._applyValues(patch);
            return false;
        }
        this._structureKey = key;
        this._seedDesired(patch);
        this._rebuild();
        return true;
    }
    /** Live parameter update: applies to every instance, sounding voices included. */
    setParam(key, name, value) {
        const v = num(value, NaN);
        if (!Number.isFinite(v))
            return;
        this._desiredFor(key).params.set(name, v);
        if (!this._ctx)
            return;
        for (const inst of this._instances.get(key) ?? []) {
            const param = inst.params[name];
            // A short ramp rather than a step: an instantaneous parameter jump is an
            // audible click.
            if (param)
                param.setTargetAtTime(v, this._ctx.currentTime, 0.02);
        }
    }
    /** Live update of a non-AudioParam setting (`type`, `mix`, ADSR times, …). */
    setProp(key, name, value) {
        this._desiredFor(key).props.set(name, value);
        for (const inst of this._instances.get(key) ?? []) {
            PROPS[inst.kind]?.[name]?.(inst, value);
        }
    }
    /** Master output level. Desired only — the effective gain is never read back. */
    setVolume(value) {
        this._volume = num(value, 0.8);
        if (this._master && this._ctx) {
            this._master.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.02);
        }
    }
    /** Toggle the ear-protection limiter. Rewires the master chain in place. */
    setLimiter(enabled) {
        if (this._limiterEnabled === enabled)
            return;
        this._limiterEnabled = enabled;
        this._wireMaster();
    }
    // --- Context ---
    /** Resume the shared context. Never rejects; failures land on `error`. */
    resume() {
        const ctx = this._ctx;
        if (!ctx || typeof ctx.resume !== "function")
            return Promise.resolve();
        const gen = ++this._gen;
        this._ready = ctx.resume().then(() => {
            if (gen !== this._gen)
                return;
            this._setError(null);
            this._syncState();
            // Chromium can drop an edge into a sink-only AnalyserNode that was wired
            // while the context was suspended. Re-kick the taps once it is running.
            this.rekickTaps();
        }, (error) => {
            if (gen !== this._gen)
                return;
            this._setError(this._messageOf(error), error?.name);
        });
        return this._ready;
    }
    /** Suspend the shared context. Never rejects. */
    suspend() {
        const ctx = this._ctx;
        if (!ctx || typeof ctx.suspend !== "function")
            return Promise.resolve();
        const gen = ++this._gen;
        this._ready = ctx.suspend().then(() => { if (gen === this._gen)
            this._syncState(); }, (error) => {
            if (gen !== this._gen)
                return;
            this._setError(this._messageOf(error), error?.name);
        });
        return this._ready;
    }
    /** Re-attach every master analyser tap (see `resume()`). */
    rekickTaps() {
        const master = this._master;
        if (!master)
            return;
        for (const tap of this._masterTaps) {
            try {
                master.disconnect(tap);
            }
            catch { /* not connected */ }
            master.connect(tap);
        }
    }
    // --- Notes ---
    noteOn(note, velocity = 1) {
        const ctx = this._ctx;
        if (!ctx)
            return;
        const t = ctx.currentTime;
        this.sweep(t);
        for (const allocator of this._allocators)
            this._voiceNoteOn(allocator, note, velocity, t);
        if (this._live) {
            this._held = this._held.filter((n) => n !== note);
            this._held.push(note);
            const freq = midiToFreq(note);
            for (const inst of this._live.noteOscs)
                setOscNote(inst, freq, t, false);
            for (const gate of this._live.gates)
                gate.on(t, velocity);
        }
        this._publishVoices();
        this._target.dispatchEvent(new CustomEvent("wcs-audio:noteon", { detail: { note, velocity }, bubbles: true }));
    }
    noteOff(note) {
        const ctx = this._ctx;
        if (!ctx)
            return;
        const t = ctx.currentTime;
        for (const allocator of this._allocators) {
            for (const allocation of allocator.matching(note))
                allocator.release(allocation, t);
        }
        if (this._live) {
            // Last-note priority: releasing the top note falls back to the one below
            // rather than cutting the line off (monophonic legato).
            const wasTop = this._held[this._held.length - 1] === note;
            this._held = this._held.filter((n) => n !== note);
            if (this._held.length === 0) {
                for (const gate of this._live.gates)
                    gate.off(t);
            }
            else if (wasTop) {
                const freq = midiToFreq(this._held[this._held.length - 1]);
                for (const inst of this._live.noteOscs)
                    setOscNote(inst, freq, t, false);
            }
        }
        this.sweep(t);
        this._publishVoices();
        this._target.dispatchEvent(new CustomEvent("wcs-audio:noteoff", { detail: { note }, bubbles: true }));
    }
    allNotesOff() {
        const ctx = this._ctx;
        if (!ctx)
            return;
        const t = ctx.currentTime;
        for (const allocator of this._allocators)
            allocator.disposeAll();
        for (const gate of this._live.gates)
            gate.off(t);
        this._held = [];
        this._publishVoices();
    }
    /** Reclaim released voices whose tail has elapsed on the audio clock. */
    sweep(now = this._ctx?.currentTime ?? 0) {
        for (const allocator of this._allocators)
            allocator.sweep(now);
    }
    // --- Analyser ---
    /**
     * Read an analyser node. Returns a **freshly allocated** array every call: the
     * producer never hands out a buffer it will later overwrite (producer snapshot
     * contract), so a consumer that retains a frame is safe.
     */
    sample(key, mode = "wave") {
        for (const inst of this._instances.get(key) ?? []) {
            if (!inst.analyser)
                continue;
            const analyser = inst.analyser;
            if (mode === "fft") {
                const data = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(data);
                return data;
            }
            const data = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(data);
            return data;
        }
        return null;
    }
    // --- Internal: context ---
    _ensureContext() {
        if (this._ctx)
            return true;
        const ctx = this._createContext();
        if (!ctx) {
            this._setState(UNSUPPORTED);
            this._setError(UNSUPPORTED, UNSUPPORTED);
            return false;
        }
        this._ctx = ctx;
        this._master = ctx.createGain();
        this._master.gain.value = this._volume;
        this._limiter = ctx.createDynamicsCompressor();
        // -18 dBFS: quiet enough that stacking a chord cannot reach a painful level
        // through headphones, which is the whole point of having it on by default.
        this._limiter.threshold.value = -18;
        this._wireMaster();
        this._syncState();
        ctx.addEventListener?.("statechange", this._onContextState);
        return true;
    }
    _wireMaster() {
        const ctx = this._ctx;
        const master = this._master;
        const limiter = this._limiter;
        if (!ctx || !master || !limiter)
            return;
        try {
            master.disconnect();
        }
        catch { /* not connected */ }
        try {
            limiter.disconnect();
        }
        catch { /* not connected */ }
        if (this._limiterEnabled)
            master.connect(limiter).connect(ctx.destination);
        else
            master.connect(ctx.destination);
        // Master taps hang off the master gain, so they survive the rewire above
        // only if re-attached.
        for (const tap of this._masterTaps)
            master.connect(tap);
    }
    _onContextState = () => { this._syncState(); };
    // Only called with a context in hand.
    _syncState() {
        this._setState(this._ctx.state);
    }
    _messageOf(error) {
        return typeof error?.message === "string" && error.message !== "" ? error.message : "Audio error";
    }
    // --- Internal: patch values ---
    _desiredFor(key) {
        let desired = this._desired.get(key);
        if (!desired)
            this._desired.set(key, (desired = { params: new Map(), props: new Map() }));
        return desired;
    }
    _walk(patch, visit) {
        const descend = (node) => {
            visit(node);
            for (const child of node.children ?? [])
                descend(child);
        };
        for (const node of patch.nodes)
            descend(node);
        for (const voice of patch.voices ?? [])
            for (const node of voice.nodes)
                descend(node);
    }
    _seedDesired(patch) {
        this._desired.clear();
        this._walk(patch, (node) => {
            const desired = this._desiredFor(node.key);
            for (const [name, value] of Object.entries(node.params ?? {}))
                desired.params.set(name, value);
            for (const [name, value] of Object.entries(node.props ?? {}))
                desired.props.set(name, value);
        });
    }
    _applyValues(patch) {
        this._walk(patch, (node) => {
            const desired = this._desiredFor(node.key);
            for (const [name, value] of Object.entries(node.params ?? {})) {
                if (desired.params.get(name) !== value)
                    this.setParam(node.key, name, value);
            }
            for (const [name, value] of Object.entries(node.props ?? {})) {
                if (desired.props.get(name) !== value)
                    this.setProp(node.key, name, value);
            }
        });
    }
    // --- Internal: graph ---
    _warn(message, node) {
        // Fresh array assigned before notifying (producer snapshot contract).
        this._warnings = [...this._warnings, { message, key: node.key }];
        this._target.dispatchEvent(new CustomEvent("wcs-audio:warnings", { detail: this._warnings, bubbles: true }));
    }
    _rebuild() {
        this._teardown();
        const master = this._master;
        const scope = this._buildScope(this._patch.nodes, master, null);
        this._live = scope;
        this._allocators = (this._patch.voices ?? []).map((def) => new VoiceAllocator(def));
        for (const tap of scope.masterTaps) {
            master.connect(tap);
            this._masterTaps.push(tap);
        }
        this._publishVoices();
    }
    _teardown() {
        for (const allocator of this._allocators)
            allocator.disposeAll();
        const master = this._master;
        for (const tap of this._masterTaps) {
            try {
                master?.disconnect(tap);
            }
            catch { /* already gone */ }
        }
        this._masterTaps = [];
        if (this._live)
            for (const inst of this._live.instances.values())
                inst.dispose?.();
        this._live = null;
        this._allocators = [];
        this._held = [];
    }
    _createInstance(node) {
        const build = BUILDERS[node.kind];
        if (!build) {
            this._warn(`unknown node kind "${node.kind}"`, node);
            return null;
        }
        const inst = build(this._ctx, node);
        const desired = this._desired.get(node.key);
        for (const [name, dflt] of Object.entries(PARAM_DEFAULTS[node.kind])) {
            const param = inst.params[name];
            if (param)
                param.value = desired?.params.has(name) ? desired.params.get(name) : dflt;
        }
        for (const name of Object.keys(PROPS[node.kind])) {
            const value = desired?.props.get(name);
            if (value !== undefined)
                PROPS[node.kind][name](inst, value);
        }
        let set = this._instances.get(node.key);
        if (!set)
            this._instances.set(node.key, (set = new Set()));
        set.add(inst);
        inst.dispose = () => {
            set.delete(inst);
            for (const source of inst.sources ?? []) {
                try {
                    source.stop();
                }
                catch { /* already stopped */ }
            }
            for (const n of inst.nodes) {
                try {
                    n.disconnect();
                }
                catch { /* already detached */ }
            }
        };
        return inst;
    }
    /**
     * Build a graph from `nodes`, in two passes: instantiate along the nesting,
     * then resolve the id-based `out` / `param` wires (which may point forward).
     *
     * Inside a voice, audio leaving the voice is funneled through `dest` — the
     * per-voice gain — so note stealing can fade the whole voice at once instead
     * of clicking each node independently.
     */
    _buildScope(nodes, dest, voice) {
        const inVoice = voice !== null;
        const scope = {
            instances: new Map(), byId: new Map(), gates: [], noteOscs: [], masterTaps: [],
            defaultDestUsed: false, externalTargets: new Set(),
        };
        const wires = [];
        const lookup = (id) => scope.byId.get(id) ?? (inVoice ? this._live.byId.get(id) ?? null : null);
        const connectAudioTo = (inst, id, node) => {
            const target = lookup(id);
            if (!target?.input) {
                this._warn(`out="${id}": no reachable audio input with that id`, node);
                return;
            }
            if (inVoice && !scope.byId.has(id)) {
                // Leaving the voice: go through the per-voice gain so stealing can fade
                // this send along with everything else the voice produces.
                inst.output.connect(dest);
                scope.externalTargets.add(target.input);
            }
            else {
                inst.output.connect(target.input);
            }
        };
        const connectParamTo = (inst, spec, node) => {
            const dot = spec.indexOf(".");
            const target = lookup(spec.slice(0, dot));
            const param = target?.params?.[spec.slice(dot + 1)];
            if (!param) {
                this._warn(`"${spec}": no reachable AudioParam with that id.name`, node);
                return;
            }
            inst.output.connect(param);
        };
        const process = (node, parent) => {
            const inst = this._createInstance(node);
            if (!inst)
                return;
            scope.instances.set(node.key, inst);
            if (node.id)
                scope.byId.set(node.id, inst);
            const modulator = isModulator(node);
            const tap = isMasterTap(node);
            // Nesting is the signal chain — but a modulator or a master tap is not in
            // the chain, so it must not take the parent's audio.
            if (!modulator && !tap && parent?.output && inst.input)
                parent.output.connect(inst.input);
            if (modulator) {
                const spec = node.param;
                if (spec && spec.includes(".")) {
                    wires.push(() => connectParamTo(inst, spec, node));
                }
                else if (spec) {
                    const param = parent?.params?.[spec];
                    if (param)
                        inst.output.connect(param);
                    else
                        this._warn(`param="${spec}": parent has no such AudioParam`, node);
                }
                else if (!node.out?.length) {
                    this._warn(`modulator needs param (or out="id.param")`, node);
                }
            }
            if (inst.gate)
                scope.gates.push(inst.gate);
            if (node.kind === "osc" && node.note)
                scope.noteOscs.push(inst);
            if (tap)
                scope.masterTaps.push(inst.input);
            let chainChildren = 0;
            for (const child of node.children ?? []) {
                if (!isModulator(child) && !isMasterTap(child))
                    chainChildren++;
                process(child, inst);
            }
            for (const ref of node.out ?? []) {
                if (ref.includes("."))
                    wires.push(() => connectParamTo(inst, ref, node));
                else
                    wires.push(() => connectAudioTo(inst, ref, node));
            }
            // A leaf with no explicit routing goes to the destination: that is what
            // makes the simplest possible patch audible without any wiring at all.
            if (!modulator && !tap && inst.output && chainChildren === 0 && !node.out?.length) {
                inst.output.connect(dest);
                scope.defaultDestUsed = true;
            }
        };
        for (const node of nodes)
            process(node, null);
        for (const wire of wires)
            wire();
        return scope;
    }
    // --- Internal: voices ---
    _voiceNoteOn(allocator, note, velocity, t) {
        const ctx = this._ctx;
        for (const allocation of allocator.matching(note))
            allocator.release(allocation, t);
        // sounding >= poly guarantees at least one sounding voice to take.
        while (allocator.sounding >= allocator.poly)
            allocator.steal(allocator.oldest(), t);
        const gain = ctx.createGain();
        const scope = this._buildScope(allocator.def.nodes, gain, allocator);
        if (scope.defaultDestUsed)
            gain.connect(this._master);
        for (const target of scope.externalTargets)
            gain.connect(target);
        const freq = midiToFreq(note);
        // A voice with no `note` oscillator would be silent-but-allocated; treat
        // every oscillator as note-following so a minimal patch still plays.
        const followers = scope.noteOscs.length > 0
            ? scope.noteOscs
            : [...scope.instances.values()].filter((i) => i.kind === "osc");
        for (const inst of followers)
            setOscNote(inst, freq, t, true);
        const allocation = {
            note, instances: scope.instances, gates: scope.gates, gain,
            released: false, freeAt: Infinity,
        };
        if (scope.gates.length > 0) {
            gain.gain.value = 1;
            for (const gate of scope.gates)
                gate.on(t, velocity);
        }
        else {
            // No envelope in the patch: a 5ms fade-in stands in, so a gateless voice
            // cannot sustain forever and cannot click on attack.
            gain.gain.value = 0;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(velocity, t + 0.005);
        }
        allocator.add(allocation);
    }
    // --- Internal: state setters ---
    _setState(state) {
        if (this._state === state)
            return;
        this._state = state;
        this._target.dispatchEvent(new CustomEvent("wcs-audio:statechange", { detail: state, bubbles: true }));
    }
    _publishVoices() {
        const voices = this.soundingVoices;
        if (this._voices === voices)
            return;
        this._voices = voices;
        this._target.dispatchEvent(new CustomEvent("wcs-audio:voices", { detail: voices, bubbles: true }));
    }
    _setError(error, name) {
        if (this._error !== error) {
            this._error = error;
            this._target.dispatchEvent(new CustomEvent("wcs-audio:error", { detail: error, bubbles: true }));
        }
        this._commitErrorInfo(error === null ? null : deriveAudioErrorInfo(name, error));
    }
    _commitErrorInfo(info) {
        if (this._errorInfo === null && info === null)
            return;
        this._errorInfo = info;
        this._target.dispatchEvent(new CustomEvent("wcs-audio:error-info-changed", { detail: info, bubbles: true }));
    }
}

const isPatchSource = (el) => typeof el.patchKind === "string";
const isVoice = (el) => el.isAudioVoice === true;
const isRoot = (el) => el.isAudioRoot === true;
/**
 * Direct graph children of `host`: descend through ordinary HTML (a `<div>`, a
 * `<label>`, whatever the page's layout needs) but stop at audio elements so
 * they can nest their own chains, and at a nested root so its patch stays its
 * own.
 *
 * This is what lets a patch be written inline among the controls that drive it
 * rather than in a separate, markup-shaped island.
 */
function graphChildren(host) {
    const found = [];
    const scan = (node) => {
        for (const child of Array.from(node.children)) {
            if (isPatchSource(child) || isVoice(child))
                found.push(child);
            else if (!isRoot(child))
                scan(child);
        }
    };
    scan(host);
    return found;
}
const splitRefs = (value) => {
    if (value === null)
        return undefined;
    const refs = value.trim().split(/\s+/).filter((r) => r !== "");
    return refs.length > 0 ? refs : undefined;
};
function describe(el) {
    const node = {
        kind: el.patchKind,
        key: el.patchKey,
    };
    const id = el.getAttribute("id");
    if (id !== null && id !== "")
        node.id = id;
    const params = el.patchParams();
    if (Object.keys(params).length > 0)
        node.params = params;
    const props = el.patchProps();
    if (Object.keys(props).length > 0)
        node.props = props;
    const out = splitRefs(el.getAttribute("out"));
    if (out)
        node.out = out;
    const param = el.getAttribute("param");
    if (param !== null && param !== "")
        node.param = param;
    if (el.hasAttribute("note"))
        node.note = true;
    if (el.hasAttribute("master"))
        node.master = true;
    const children = [];
    for (const child of graphChildren(el)) {
        // graphChildren only yields voices and patch sources, so anything that is
        // not a voice is describable. A voice can only be a template at the top
        // level of a patch: nesting one inside a chain has no meaning (which graph
        // would it instantiate into?).
        if (!isVoice(child))
            children.push(describe(child));
    }
    if (children.length > 0)
        node.children = children;
    return node;
}
/**
 * Walk the DOM below `root` and produce the patch describing it.
 *
 * The DOM is one authoring surface for a patch, not the patch itself: the
 * descriptor this returns is the thing the Core consumes, and it can equally be
 * written by hand (ADR-14 G1).
 */
function compilePatch(root) {
    const nodes = [];
    const voices = [];
    for (const child of graphChildren(root)) {
        if (isVoice(child)) {
            const el = child;
            voices.push({
                key: el.patchKey,
                poly: el.poly,
                nodes: graphChildren(child).filter(isPatchSource).map(describe),
            });
        }
        else {
            nodes.push(describe(child));
        }
    }
    return { nodes, voices };
}
/**
 * Attributes whose change alters topology rather than a value. Everything else
 * is a live update — see docs/audio-tag-design.md §5.
 */
const STRUCTURAL_ATTRIBUTES = ["id", "out", "param", "note", "master", "poly"];

// Chain tags render nothing themselves, but they must not swallow the layout of
// any UI nested inside them, so they take `display: contents`.
//
// The stylesheet is adopted into the element's own root node — not injected into
// `document.head`. Only `<wcs-head>` writes to the document head, and doing it
// here would both break inside a shadow root and leave residue a page never
// asked for.
const CSS = "wcs-audio{display:block}" +
    "wcs-voice,wcs-osc,wcs-noise,wcs-biquad,wcs-gain,wcs-delay," +
    "wcs-shaper,wcs-env,wcs-lfo,wcs-analyser{display:contents}";
const applied = new WeakSet();
/** Idempotent: repeated roots and repeated calls adopt the sheet exactly once. */
function applyNodeStyles(node) {
    const root = node;
    if (applied.has(root))
        return;
    const target = root;
    if (!Array.isArray(target.adoptedStyleSheets) || typeof CSSStyleSheet !== "function")
        return;
    try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
        applied.add(root);
    }
    catch {
        // never-throw: an environment without constructable stylesheets simply gets
        // no default display rules; the graph still works.
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

/** Tag names of every element whose presence changes the graph's topology. */
const AUDIO_TAG_RE = /^(WCS-OSC|WCS-NOISE|WCS-BIQUAD|WCS-GAIN|WCS-DELAY|WCS-SHAPER|WCS-ENV|WCS-LFO|WCS-ANALYSER|WCS-VOICE)$/;
const isAudioElement = (node) => {
    const el = node;
    if (el.patchKind !== undefined || el.isAudioVoice === true)
        return true;
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
class WcsAudio extends HTMLElement {
    static hasConnectedCallbackPromise = true;
    static observedAttributes = ["volume", "limiter", "resume-on-gesture"];
    static wcBindable = {
        ...AudioGraphCore.wcBindable,
        inputs: [
            { name: "volume", attribute: "volume" },
            { name: "limiter", attribute: "limiter" },
            { name: "resumeOnGesture", attribute: "resume-on-gesture" },
        ],
    };
    /** Marks this element for `findAudioRoot()` (tag names are configurable). */
    isAudioRoot = true;
    _core;
    _observer = null;
    _rebuildQueued = false;
    _connectedCallbackPromise = Promise.resolve();
    _internals = null;
    _gestureBound = false;
    constructor() {
        super();
        // Read through getConfig() at call time rather than capturing the provider,
        // so a setConfig() after construction still takes effect.
        const createContext = () => getConfig().createContext();
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
    // --- Attributes ---
    get volume() {
        const raw = this.getAttribute("volume");
        const n = raw === null ? NaN : parseFloat(raw);
        return Number.isFinite(n) ? n : 0.8;
    }
    set volume(value) { this.setAttribute("volume", String(value)); }
    /** Ear-protection limiter, on unless explicitly turned off. */
    get limiter() { return this.getAttribute("limiter") !== "off"; }
    set limiter(value) { this.setAttribute("limiter", value ? "on" : "off"); }
    /** Resume the context on the first user gesture. On unless turned off. */
    get resumeOnGesture() { return this.getAttribute("resume-on-gesture") !== "off"; }
    set resumeOnGesture(value) { this.setAttribute("resume-on-gesture", value ? "on" : "off"); }
    // --- Core delegated getters ---
    get state() { return this._core.state; }
    get running() { return this._core.running; }
    get suspended() { return this._core.suspended; }
    get unsupported() { return this._core.unsupported; }
    get voices() { return this._core.voices; }
    get warnings() { return this._core.warnings; }
    get error() { return this._core.error; }
    get errorInfo() { return this._core.errorInfo; }
    /** Headless escape hatch, and the surface node tags talk to. */
    get audioCore() { return this._core; }
    get connectedCallbackPromise() { return this._connectedCallbackPromise; }
    /** The patch this element's markup currently describes. */
    get patch() { return compilePatch(this); }
    // --- Commands ---
    resume() { return this._core.resume(); }
    suspend() { return this._core.suspend(); }
    noteOn(note, velocity) { this._core.noteOn(note, velocity); }
    noteOff(note) { this._core.noteOff(note); }
    allNotesOff() { this._core.allNotesOff(); }
    /**
     * Recompile the markup and hand the result to the Core, coalesced onto a
     * microtask so a burst of DOM edits rebuilds once.
     *
     * A microtask, not a task: the cross-cutting contract puts microtasks ahead of
     * tasks precisely so a graph is in place before the first frame that could
     * observe it (timing-and-firing-contract.md §3).
     */
    requestRebuild() {
        if (this._rebuildQueued)
            return;
        this._rebuildQueued = true;
        queueMicrotask(() => {
            this._rebuildQueued = false;
            if (this.isConnected)
                this._core.setPatch(compilePatch(this));
        });
    }
    // --- Lifecycle ---
    connectedCallback() {
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
    disconnectedCallback() {
        this._observer?.disconnect();
        this._observer = null;
        this._unbindGesture();
        this._core.dispose();
    }
    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue)
            return;
        if (name === "volume") {
            this._core.setVolume(this.volume);
            return;
        }
        if (name === "limiter") {
            this._core.setLimiter(this.limiter);
            return;
        }
        if (this.isConnected)
            this._bindGesture();
    }
    // --- Internal ---
    _onMutations = (records) => {
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
    _bindGesture() {
        if (this.resumeOnGesture) {
            if (this._gestureBound)
                return;
            const root = this.getRootNode();
            root.addEventListener("pointerdown", this._onGesture, { capture: true });
            root.addEventListener("keydown", this._onGesture, { capture: true });
            this._gestureBound = true;
            return;
        }
        this._unbindGesture();
    }
    _unbindGesture() {
        if (!this._gestureBound)
            return;
        const root = this.getRootNode();
        root.removeEventListener("pointerdown", this._onGesture, { capture: true });
        root.removeEventListener("keydown", this._onGesture, { capture: true });
        this._gestureBound = false;
    }
    _onGesture = () => { void this._core.resume(); };
}

let nextKey = 0;
/**
 * Nearest enclosing `<wcs-audio>`, hopping shadow hosts on the way up so a patch
 * split across component boundaries still finds its root. Identified by a
 * property rather than a tag name, since the tag name is configurable.
 */
function findAudioRoot(start) {
    let node = start.parentNode;
    while (node) {
        if (node.isAudioRoot === true)
            return node;
        node = node.parentNode ?? node.host ?? null;
    }
    return null;
}
/**
 * Base for every audio node tag.
 *
 * These elements are **descriptors and nothing else**. They hold a key, expose
 * their attributes as patch values, and forward live numeric changes to the
 * root's Core. They never hold an `AudioNode` — which is what makes ADR-14 G2
 * ("handles do not cross the protocol boundary") a structural property of the
 * package rather than a rule someone has to remember.
 *
 * It deliberately declares no `static wcBindable`: each concrete tag declares
 * its own inputs, and the base has no surface of its own.
 */
class AudioNodeShell extends HTMLElement {
    /** Which builder the Core should use. Each concrete tag overrides it. */
    static kind = "gain";
    /** Instance view of `static kind` — this is what the patch compiler reads. */
    get patchKind() {
        return this.constructor.kind;
    }
    /** AudioParam-backed attributes: name → default. */
    static params = {};
    /** Non-AudioParam attributes (`type`, `mix`, ADSR times, …). */
    static props = [];
    static get observedAttributes() {
        return [...Object.keys(this.params), ...this.props, ...STRUCTURAL_ATTRIBUTES];
    }
    /** Stable identity for this element across rebuilds. */
    patchKey = `n${++nextKey}`;
    /** Values written as properties rather than attributes. */
    _values = new Map();
    patchParams() {
        const ctor = this.constructor;
        const params = {};
        for (const [name, dflt] of Object.entries(ctor.params))
            params[name] = this._num(name, dflt);
        return params;
    }
    patchProps() {
        const ctor = this.constructor;
        const props = {};
        for (const name of ctor.props) {
            const value = this.getAttribute(name);
            if (value !== null)
                props[name] = value;
        }
        return props;
    }
    /** Property assignment wins over the attribute, so a binding core writing
     *  `el.frequency = 900` is not overwritten by a stale attribute on rebuild. */
    _num(name, dflt) {
        const own = this._values.get(name);
        if (own !== undefined)
            return own;
        const raw = this.getAttribute(name);
        const n = raw === null ? NaN : parseFloat(raw);
        return Number.isFinite(n) ? n : dflt;
    }
    get root() {
        return findAudioRoot(this);
    }
    /** Live numeric update: goes straight to the Core, no rebuild. */
    _setParam(name, value) {
        this._values.set(name, value);
        this.root?.audioCore?.setParam(this.patchKey, name, value);
    }
    connectedCallback() {
        // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
        upgradeProperties(this);
        this.root?.requestRebuild();
    }
    // No disconnectedCallback: by the time it runs `closest()` no longer reaches
    // the root. Removals are picked up by the root's MutationObserver, which sees
    // the childList mutation on its own subtree.
    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue)
            return;
        const ctor = this.constructor;
        if (name in ctor.params) {
            // An attribute write supersedes an earlier property write for that name.
            this._values.delete(name);
            const value = newValue === null ? ctor.params[name] : parseFloat(newValue);
            if (Number.isFinite(value))
                this.root?.audioCore?.setParam(this.patchKey, name, value);
            return;
        }
        if (ctor.props.includes(name)) {
            if (newValue !== null)
                this.root?.audioCore?.setProp(this.patchKey, name, newValue);
            return;
        }
        // Structural: the topology changed, so the graph has to be rebuilt.
        this.root?.requestRebuild();
    }
}
/**
 * Define numeric accessors mirroring the param attributes, so both
 * `el.frequency = 900` and `frequency="900"` reach the Core.
 */
function defineParamAccessors(ctor) {
    for (const [name, dflt] of Object.entries(ctor.params)) {
        Object.defineProperty(ctor.prototype, name, {
            configurable: true,
            enumerable: true,
            get() { return this._num(name, dflt); },
            set(value) { this._setParam(name, value); },
        });
    }
    for (const name of ctor.props) {
        Object.defineProperty(ctor.prototype, name, {
            configurable: true,
            enumerable: true,
            get() { return this.getAttribute(name) ?? ""; },
            set(value) { this.setAttribute(name, String(value)); },
        });
    }
}
/** wc-bindable `inputs` for a node tag, derived from its declared attributes. */
function nodeInputs(ctor) {
    return [
        ...Object.keys(ctor.params).map((name) => ({ name, attribute: name })),
        ...ctor.props.map((name) => ({ name, attribute: name })),
    ];
}

/**
 * `<wcs-voice poly="N">` — turns its subtree into a patch template.
 *
 * Outside a voice the graph is live and monophonic (last-note priority, legato,
 * optional glide). Inside one, the whole subtree is instantiated afresh per held
 * note, which is what makes "markup as patch template" cheap: polyphony costs a
 * `poly` attribute rather than a second copy of the patch.
 *
 * It deliberately declares no `static wcBindable`. `poly` is **structural** — a
 * change rebuilds the graph and cuts every sounding voice — so advertising it as
 * a bindable input would invite exactly the reactive write that should not
 * happen. Set it in markup, not from state.
 */
class WcsVoice extends HTMLElement {
    static observedAttributes = ["poly"];
    /** Marks this element for the patch compiler (tag names are configurable). */
    isAudioVoice = true;
    patchKey;
    static _next = 0;
    constructor() {
        super();
        this.patchKey = `v${++WcsVoice._next}`;
    }
    get poly() {
        const raw = this.getAttribute("poly");
        const n = raw === null ? NaN : parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : 8;
    }
    set poly(value) {
        this.setAttribute("poly", String(value));
    }
    connectedCallback() {
        // upgrade 前に代入された input を取り込み直す（doc 13 §1.2 / Phase A1）
        upgradeProperties(this);
        findAudioRoot(this)?.requestRebuild();
    }
    attributeChangedCallback(_name, oldValue, newValue) {
        if (oldValue === newValue)
            return;
        findAudioRoot(this)?.requestRebuild();
    }
}

/**
 * The nine audio node tags.
 *
 * Every one is the same shape — a kind, its AudioParam attributes and its
 * non-param settings — so they are declared from one table rather than as nine
 * near-identical files. What differs between an oscillator and a filter lives in
 * the Core's builders, not here; these classes only describe.
 *
 * Each declares its own `static wcBindable` with `properties: []`: a node tag is
 * a pure input surface. It observes nothing, because everything worth observing
 * (context state, voice count, warnings) belongs to the graph as a whole and is
 * published by `<wcs-audio>`.
 */
function defineNode(kind, params, props) {
    class Node extends AudioNodeShell {
        static kind = kind;
        static params = params;
        static props = props;
        static wcBindable = {
            protocol: "wc-bindable",
            version: 1,
            // A node tag produces nothing observable — see the class doc above.
            properties: [],
            inputs: [],
            commands: [],
        };
    }
    Node.wcBindable = { ...Node.wcBindable, inputs: nodeInputs(Node) };
    defineParamAccessors(Node);
    return Node;
}
/** `OscillatorNode`. `note` makes it follow played notes; `transpose` is in semitones. */
class WcsOsc extends defineNode("osc", { frequency: 440, detune: 0 }, ["type", "glide", "transpose"]) {
}
/** Looped white noise (`AudioBufferSourceNode`), shared per context. */
class WcsNoise extends defineNode("noise", {}, []) {
}
/** `BiquadFilterNode`. Named for the node, not for "filter" — which means
 *  something else entirely in `@wcstack/state`. */
class WcsBiquad extends defineNode("biquad", { frequency: 1000, q: 1, gain: 0, detune: 0 }, ["type"]) {
}
/** `GainNode`. Also the named bus other chains route into with `out="…"`. */
class WcsGain extends defineNode("gain", { gain: 1 }, []) {
}
/** `DelayNode` with feedback and a dry/wet mix. */
class WcsDelay extends defineNode("delay", { time: 0.3, feedback: 0.3 }, ["mix"]) {
}
/** `WaveShaperNode` with a soft-clipping curve; `amount` is the drive. */
class WcsShaper extends defineNode("shaper", {}, ["amount"]) {
}
/** ADSR envelope. In the chain it is a VCA; with `param` it shapes a parameter. */
class WcsEnv extends defineNode("env", {}, ["attack", "decay", "sustain", "release", "depth"]) {
}
/** Low-frequency oscillator — always a modulator, never in the signal chain. */
class WcsLfo extends defineNode("lfo", { rate: 5, depth: 10 }, ["type"]) {
}
/**
 * `AnalyserNode`. Produces data only — drawing is the page's job (ADR-14 G6:
 * I/O nodes carry no rendering).
 *
 * The read is a command rather than a stream, so the frame loop closes through
 * the protocols already in place: `<wcs-raf>` ticks → the state fires
 * `command.sample` → this element dispatches `frame`. Nothing here owns a
 * rAF loop, which would duplicate `@wcstack/raf`.
 */
class WcsAnalyser extends defineNode("analyser", {}, ["fft", "smoothing"]) {
    static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        // An occurrence, not a value: every frame is a distinct reading.
        properties: [
            { name: "frame", event: "wcs-analyser:frame", semantics: "event", getter: (e) => e.detail },
        ],
        inputs: [
            { name: "fft", attribute: "fft" },
            { name: "smoothing", attribute: "smoothing" },
        ],
        commands: [{ name: "sample" }],
    };
    /**
     * Read the analyser and publish the frame. Returns a **freshly allocated**
     * array each call — the platform buffer is never handed out, so a consumer
     * that retains a frame is safe (producer snapshot contract).
     */
    sample(mode = "wave") {
        const data = this.root?.audioCore?.sample(this.patchKey, mode) ?? null;
        if (data) {
            this.dispatchEvent(new CustomEvent("wcs-analyser:frame", { detail: data, bubbles: true }));
        }
        return data;
    }
}

function registerComponents() {
    const definitions = [
        [config.tagNames.audio, WcsAudio],
        [config.tagNames.voice, WcsVoice],
        [config.tagNames.osc, WcsOsc],
        [config.tagNames.noise, WcsNoise],
        [config.tagNames.biquad, WcsBiquad],
        [config.tagNames.gain, WcsGain],
        [config.tagNames.delay, WcsDelay],
        [config.tagNames.shaper, WcsShaper],
        [config.tagNames.env, WcsEnv],
        [config.tagNames.lfo, WcsLfo],
        [config.tagNames.analyser, WcsAnalyser],
    ];
    for (const [tag, ctor] of definitions) {
        if (!customElements.get(tag))
            customElements.define(tag, ctor);
    }
}

function bootstrapAudio(userConfig) {
    if (userConfig) {
        setConfig(userConfig);
    }
    registerComponents();
}

export { AudioGraphCore, AudioNodeShell, STRUCTURAL_ATTRIBUTES, VoiceAllocator, WCS_AUDIO_ERROR_CODE, WcsAnalyser, WcsAudio, WcsBiquad, WcsDelay, WcsEnv, WcsGain, WcsLfo, WcsNoise, WcsOsc, WcsShaper, WcsVoice, bootstrapAudio, compilePatch, defaultCreateContext, deriveAudioErrorInfo, findAudioRoot, getConfig, graphChildren, releaseSharedContext, structureKey };
//# sourceMappingURL=index.esm.js.map
