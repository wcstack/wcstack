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
interface IWritableTagNames {
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
interface IConfig {
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
interface IWritableConfig {
    tagNames?: IWritableTagNames;
    createContext?: () => BaseAudioContext | null;
}

/** Every node kind the graph compiler can instantiate. */
type AudioNodeKind = "osc" | "noise" | "biquad" | "gain" | "delay" | "shaper" | "env" | "lfo" | "analyser";
/**
 * One node of a patch.
 *
 * A patch is a **descriptor**, not state: it is read once when the graph is
 * built, never diffed as a value. That distinction is what keeps a live audio
 * graph out of the reactive store — see
 * docs/architecture-hardening/14-handle-graph-wiring.md (gate G1).
 */
interface PatchNode {
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
interface PatchVoice {
    readonly key: string;
    readonly poly: number;
    readonly nodes: readonly PatchNode[];
}
/** The complete graph description handed to `AudioGraphCore.setPatch()`. */
interface Patch {
    readonly nodes: readonly PatchNode[];
    readonly voices?: readonly PatchVoice[];
}
/** `AudioContext.state`, plus `"unsupported"` where Web Audio is absent. */
type AudioContextState = "suspended" | "running" | "closed" | "unsupported";
/** A diagnostic the graph compiler emitted instead of throwing. */
interface IAudioWarning {
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
interface WcsAudioCoreValues {
    state: AudioContextState;
    running: boolean;
    voices: number;
    warnings: IAudioWarning[];
    error: string | null;
    errorInfo: WcsIoErrorInfo | null;
}
/** Observable surface of the root Shell (`<wcs-audio>`) — the Core's, verbatim. */
type WcsAudioValues = WcsAudioCoreValues;
/** Settable input surface of the root Shell (`<wcs-audio>`). */
interface WcsAudioInputs {
    volume: number;
    limiter: boolean;
    resumeOnGesture: boolean;
}

declare function bootstrapAudio(userConfig?: IWritableConfig): void;

declare function getConfig(): IConfig;

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
declare class AudioGraphCore extends EventTarget {
    static wcBindable: IWcBindable;
    private _target;
    private _createContext;
    private _ctx;
    private _master;
    private _limiter;
    private _masterTaps;
    private _patch;
    private _structureKey;
    private _desired;
    private _instances;
    private _live;
    private _allocators;
    private _held;
    private _volume;
    private _limiterEnabled;
    private _state;
    private _voices;
    private _warnings;
    private _error;
    private _errorInfo;
    private _gen;
    private _ready;
    constructor(options?: {
        createContext?: () => BaseAudioContext | null;
    } | null, target?: EventTarget);
    get state(): AudioContextState;
    get running(): boolean;
    get suspended(): boolean;
    get unsupported(): boolean;
    get voices(): number;
    get warnings(): IAudioWarning[];
    get error(): string | null;
    get errorInfo(): WcsIoErrorInfo | null;
    get ready(): Promise<void>;
    /** Sounding notes, released tails excluded. */
    get soundingVoices(): number;
    /** Voices still holding nodes, including tails not yet reclaimed. */
    get allocatedVoices(): number;
    /**
     * Install a patch and start observing. Idempotent — re-submitting the same
     * structure only applies values.
     */
    observe(patch: Patch): Promise<void>;
    /**
     * Release every node this Core built. The shared `AudioContext` is left alone:
     * other `<wcs-audio>` elements on the page are still using it.
     *
     * Not terminal. A later `observe()` / `setPatch()` rebuilds from scratch, so
     * an element that is detached and re-attached — or simply moved in the DOM —
     * comes back playing. `PermissionCore` treats its subscription the same way.
     */
    dispose(): void;
    /**
     * Hand over the whole patch. Returns `true` when the topology changed and the
     * graph was rebuilt, `false` when only values were applied.
     *
     * A rebuild **cuts sounding voices** — that discontinuity is audible, and it
     * is why the structure key deliberately excludes numbers.
     */
    setPatch(patch: Patch): boolean;
    /** Live parameter update: applies to every instance, sounding voices included. */
    setParam(key: string, name: string, value: number): void;
    /** Live update of a non-AudioParam setting (`type`, `mix`, ADSR times, …). */
    setProp(key: string, name: string, value: string): void;
    /** Master output level. Desired only — the effective gain is never read back. */
    setVolume(value: number): void;
    /** Toggle the ear-protection limiter. Rewires the master chain in place. */
    setLimiter(enabled: boolean): void;
    /** Resume the shared context. Never rejects; failures land on `error`. */
    resume(): Promise<void>;
    /** Suspend the shared context. Never rejects. */
    suspend(): Promise<void>;
    /** Re-attach every master analyser tap (see `resume()`). */
    rekickTaps(): void;
    noteOn(note: number, velocity?: number): void;
    noteOff(note: number): void;
    allNotesOff(): void;
    /** Reclaim released voices whose tail has elapsed on the audio clock. */
    sweep(now?: number): void;
    /**
     * Read an analyser node. Returns a **freshly allocated** array every call: the
     * producer never hands out a buffer it will later overwrite (producer snapshot
     * contract), so a consumer that retains a frame is safe.
     */
    sample(key: string, mode?: "wave" | "fft"): Uint8Array | null;
    private _ensureContext;
    private _wireMaster;
    private _onContextState;
    private _syncState;
    private _messageOf;
    private _desiredFor;
    private _walk;
    private _seedDesired;
    private _applyValues;
    private _warn;
    private _rebuild;
    private _teardown;
    private _createInstance;
    /**
     * Build a graph from `nodes`, in two passes: instantiate along the nesting,
     * then resolve the id-based `out` / `param` wires (which may point forward).
     *
     * Inside a voice, audio leaving the voice is funneled through `dest` — the
     * per-voice gain — so note stealing can fade the whole voice at once instead
     * of clicking each node independently.
     */
    private _buildScope;
    private _voiceNoteOn;
    private _setState;
    private _publishVoices;
    private _setError;
    private _commitErrorInfo;
}

/**
 * One live instance of a patch node. `input` / `output` are the graph endpoints;
 * `params` maps the patch's parameter names onto the real `AudioParam`s.
 *
 * These objects — and every `AudioNode` inside them — stay inside the Core. They
 * are never published through wc-bindable (ADR-14 G2).
 */
interface NodeInstance {
    key: string;
    kind: AudioNodeKind;
    input?: AudioNode;
    output?: AudioNode;
    params: Record<string, AudioParam>;
    nodes: AudioNode[];
    sources?: AudioScheduledSourceNode[];
    /** Note gate, present on `env`. */
    gate?: {
        on: (t: number, velocity: number) => void;
        off: (t: number) => void;
        release: () => number;
    };
    /** Per-kind extras the prop setters need. */
    osc?: OscillatorNode;
    filter?: BiquadFilterNode;
    shaper?: WaveShaperNode;
    analyser?: AnalyserNode;
    wet?: GainNode;
    dry?: GainNode;
    envParam?: AudioParam;
    adsr?: {
        a: number;
        d: number;
        s: number;
        r: number;
        depth: number;
    };
    glide: number;
    transpose: number;
    dispose?: () => void;
}

/** One sounding (or releasing) note and the graph instance backing it. */
interface VoiceAllocation {
    note: number;
    instances: Map<string, NodeInstance>;
    gates: NonNullable<NodeInstance["gate"]>[];
    gain: GainNode;
    released: boolean;
    /**
     * Audio-clock time at which this voice may be reclaimed. Deliberately not a
     * timer: background tabs throttle `setTimeout` to roughly once a minute while
     * audio keeps rendering, so a timer-based reclaim leaks voices exactly when a
     * page is left playing in the background.
     */
    freeAt: number;
}
/** A `<wcs-voice>` template plus the notes currently allocated from it. */
declare class VoiceAllocator {
    readonly def: PatchVoice;
    readonly active: VoiceAllocation[];
    constructor(def: PatchVoice);
    get poly(): number;
    /** Notes still sounding — a released voice is no longer one of them. */
    get sounding(): number;
    /** Voices still holding audio nodes, released-but-not-yet-reclaimed included. */
    get allocated(): number;
    add(allocation: VoiceAllocation): void;
    /** Voices playing `note` that have not been released yet. */
    matching(note: number): VoiceAllocation[];
    /** Oldest sounding voice — the one note stealing takes when `poly` is full. */
    oldest(): VoiceAllocation | undefined;
    /** Begin the release tail. `freeAt` is on the audio clock, never wall-clock. */
    release(allocation: VoiceAllocation, t: number): void;
    /** Steal: a fast fade so the reused voice does not click. */
    steal(allocation: VoiceAllocation, t: number): void;
    /** Reclaim every released voice whose tail has elapsed on the audio clock. */
    sweep(now: number): void;
    dispose(allocation: VoiceAllocation): void;
    disposeAll(): void;
}

/**
 * Default context provider: one lazily created, page-wide `AudioContext`.
 * Returns `null` where Web Audio is absent (SSR, or a browser without it) so the
 * caller can report `"unsupported"` instead of throwing.
 *
 * Resolved at call time, never cached in a field, so tests can swap the global
 * and an unsupported environment is reported honestly.
 */
declare function defaultCreateContext(): BaseAudioContext | null;
/** Drop the shared context (tests, and pages that tear everything down). */
declare function releaseSharedContext(): void;

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
declare const WCS_AUDIO_ERROR_CODE: {
    /** `AudioContext` / `webkitAudioContext` が不在(synthetic "unsupported")。 */
    readonly CapabilityMissing: "capability-missing";
    /**
     * `NotAllowedError` — ユーザージェスチャ前の `resume()`。ジェスチャ後の再試行で
     * 回復する。
     */
    readonly NotAllowed: "not-allowed";
    /** その他の context 操作失敗。 */
    readonly ContextError: "context-error";
};
/**
 * Web Audio の失敗を serializable な error taxonomy に写す。
 *
 * `name` は呼び出し側が渡す discriminator:
 * - `"unsupported"` — API 不在 → phase="probe" / capability-missing。
 * - `NotAllowedError` — ジェスチャ不足 → phase="start" / not-allowed。recoverable。
 * - それ以外 → phase="execute" / context-error。
 */
declare function deriveAudioErrorInfo(name: string | undefined, message: string): WcsIoErrorInfo;

/**
 * Direct graph children of `host`: descend through ordinary HTML (a `<div>`, a
 * `<label>`, whatever the page's layout needs) but stop at audio elements so
 * they can nest their own chains, and at a nested root so its patch stays its
 * own.
 *
 * This is what lets a patch be written inline among the controls that drive it
 * rather than in a separate, markup-shaped island.
 */
declare function graphChildren(host: Element): Element[];
/**
 * Walk the DOM below `root` and produce the patch describing it.
 *
 * The DOM is one authoring surface for a patch, not the patch itself: the
 * descriptor this returns is the thing the Core consumes, and it can equally be
 * written by hand (ADR-14 G1).
 */
declare function compilePatch(root: Element): Patch;
/**
 * Attributes whose change alters topology rather than a value. Everything else
 * is a live update — see docs/audio-tag-design.md §5.
 */
declare const STRUCTURAL_ATTRIBUTES: readonly ["id", "out", "param", "note", "master", "poly"];

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
declare function structureKey(patch: Patch): string;

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
declare class WcsAudio extends HTMLElement {
    static hasConnectedCallbackPromise: boolean;
    static observedAttributes: string[];
    static wcBindable: IWcBindable;
    /** Marks this element for `findAudioRoot()` (tag names are configurable). */
    readonly isAudioRoot = true;
    private _core;
    private _observer;
    private _rebuildQueued;
    private _connectedCallbackPromise;
    private _internals;
    private _gestureBound;
    constructor();
    get debugStates(): string[];
    private _initInternals;
    private _wireStates;
    get volume(): number;
    set volume(value: number);
    /** Ear-protection limiter, on unless explicitly turned off. */
    get limiter(): boolean;
    set limiter(value: boolean);
    /** Resume the context on the first user gesture. On unless turned off. */
    get resumeOnGesture(): boolean;
    set resumeOnGesture(value: boolean);
    get state(): AudioContextState;
    get running(): boolean;
    get suspended(): boolean;
    get unsupported(): boolean;
    get voices(): number;
    get warnings(): IAudioWarning[];
    get error(): string | null;
    get errorInfo(): WcsIoErrorInfo | null;
    /** Headless escape hatch, and the surface node tags talk to. */
    get audioCore(): AudioGraphCore;
    get connectedCallbackPromise(): Promise<void>;
    /** The patch this element's markup currently describes. */
    get patch(): Patch;
    resume(): Promise<void>;
    suspend(): Promise<void>;
    noteOn(note: number, velocity?: number): void;
    noteOff(note: number): void;
    allNotesOff(): void;
    /**
     * Recompile the markup and hand the result to the Core, coalesced onto a
     * microtask so a burst of DOM edits rebuilds once.
     *
     * A microtask, not a task: the cross-cutting contract puts microtasks ahead of
     * tasks precisely so a graph is in place before the first frame that could
     * observe it (timing-and-firing-contract.md §3).
     */
    requestRebuild(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
    private _onMutations;
    private _bindGesture;
    private _unbindGesture;
    private _onGesture;
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
declare class WcsVoice extends HTMLElement {
    static observedAttributes: string[];
    /** Marks this element for the patch compiler (tag names are configurable). */
    readonly isAudioVoice = true;
    readonly patchKey: string;
    private static _next;
    constructor();
    get poly(): number;
    set poly(value: number);
    connectedCallback(): void;
    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void;
}

/** The part of the root Shell a node needs, without importing it (cycle-free). */
interface AudioRootLike extends HTMLElement {
    readonly isAudioRoot: true;
    readonly audioCore: {
        setParam(key: string, name: string, value: number): void;
        setProp(key: string, name: string, value: string): void;
        sample(key: string, mode?: "wave" | "fft"): Uint8Array | null;
    } | null;
    requestRebuild(): void;
}
/**
 * Nearest enclosing `<wcs-audio>`, hopping shadow hosts on the way up so a patch
 * split across component boundaries still finds its root. Identified by a
 * property rather than a tag name, since the tag name is configurable.
 */
declare function findAudioRoot(start: Element): AudioRootLike | null;
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
declare class AudioNodeShell extends HTMLElement {
    /** Which builder the Core should use. Each concrete tag overrides it. */
    static kind: AudioNodeKind;
    /** Instance view of `static kind` — this is what the patch compiler reads. */
    get patchKind(): AudioNodeKind;
    /** AudioParam-backed attributes: name → default. */
    static params: Record<string, number>;
    /** Non-AudioParam attributes (`type`, `mix`, ADSR times, …). */
    static props: readonly string[];
    static get observedAttributes(): string[];
    /** Stable identity for this element across rebuilds. */
    readonly patchKey: string;
    /** Values written as properties rather than attributes. */
    private _values;
    patchParams(): Record<string, number>;
    patchProps(): Record<string, string>;
    /** Property assignment wins over the attribute, so a binding core writing
     *  `el.frequency = 900` is not overwritten by a stale attribute on rebuild. */
    protected _num(name: string, dflt: number): number;
    protected get root(): AudioRootLike | null;
    /** Live numeric update: goes straight to the Core, no rebuild. */
    protected _setParam(name: string, value: number): void;
    connectedCallback(): void;
    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void;
}

declare const WcsOsc_base: typeof AudioNodeShell;
/** `OscillatorNode`. `note` makes it follow played notes; `transpose` is in semitones. */
declare class WcsOsc extends WcsOsc_base {
}
declare const WcsNoise_base: typeof AudioNodeShell;
/** Looped white noise (`AudioBufferSourceNode`), shared per context. */
declare class WcsNoise extends WcsNoise_base {
}
declare const WcsBiquad_base: typeof AudioNodeShell;
/** `BiquadFilterNode`. Named for the node, not for "filter" — which means
 *  something else entirely in `@wcstack/state`. */
declare class WcsBiquad extends WcsBiquad_base {
}
declare const WcsGain_base: typeof AudioNodeShell;
/** `GainNode`. Also the named bus other chains route into with `out="…"`. */
declare class WcsGain extends WcsGain_base {
}
declare const WcsDelay_base: typeof AudioNodeShell;
/** `DelayNode` with feedback and a dry/wet mix. */
declare class WcsDelay extends WcsDelay_base {
}
declare const WcsShaper_base: typeof AudioNodeShell;
/** `WaveShaperNode` with a soft-clipping curve; `amount` is the drive. */
declare class WcsShaper extends WcsShaper_base {
}
declare const WcsEnv_base: typeof AudioNodeShell;
/** ADSR envelope. In the chain it is a VCA; with `param` it shapes a parameter. */
declare class WcsEnv extends WcsEnv_base {
}
declare const WcsLfo_base: typeof AudioNodeShell;
/** Low-frequency oscillator — always a modulator, never in the signal chain. */
declare class WcsLfo extends WcsLfo_base {
}
declare const WcsAnalyser_base: typeof AudioNodeShell;
/**
 * `AnalyserNode`. Produces data only — drawing is the page's job (ADR-14 G6:
 * I/O nodes carry no rendering).
 *
 * The read is a command rather than a stream, so the frame loop closes through
 * the protocols already in place: `<wcs-raf>` ticks → the state fires
 * `command.sample` → this element dispatches `frame`. Nothing here owns a
 * rAF loop, which would duplicate `@wcstack/raf`.
 */
declare class WcsAnalyser extends WcsAnalyser_base {
    static wcBindable: IWcBindable;
    /**
     * Read the analyser and publish the frame. Returns a **freshly allocated**
     * array each call — the platform buffer is never handed out, so a consumer
     * that retains a frame is safe (producer snapshot contract).
     */
    sample(mode?: "wave" | "fft"): Uint8Array | null;
}

export { AudioGraphCore, AudioNodeShell, STRUCTURAL_ATTRIBUTES, VoiceAllocator, WCS_AUDIO_ERROR_CODE, WcsAnalyser, WcsAudio, WcsBiquad, WcsDelay, WcsEnv, WcsGain, WcsLfo, WcsNoise, WcsOsc, WcsShaper, WcsVoice, bootstrapAudio, compilePatch, defaultCreateContext, deriveAudioErrorInfo, findAudioRoot, getConfig, graphChildren, releaseSharedContext, structureKey };
export type { AudioContextState, AudioNodeKind, IAudioWarning, IWritableConfig, IWritableTagNames, Patch, PatchNode, PatchVoice, WcsAudioCoreValues, WcsAudioInputs, WcsAudioValues, WcsIoErrorInfo };
