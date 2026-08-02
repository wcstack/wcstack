import {
  AudioContextState, IAudioWarning, IWcBindable, Patch, PatchNode, PatchVoice,
} from "../types.js";
import type { WcsIoErrorInfo } from "./platformCapability.js";
import { deriveAudioErrorInfo } from "./audioCapabilities.js";
import { defaultCreateContext } from "./audioContext.js";
import { structureKey } from "../patch/structureKey.js";
import { VoiceAllocation, VoiceAllocator } from "./VoiceAllocator.js";
import {
  BUILDERS, NodeInstance, PARAM_DEFAULTS, PROPS, isMasterTap, isModulator,
  midiToFreq, num, setOscNote,
} from "./builders.js";

const UNSUPPORTED = "unsupported";

const detailOf = (event: Event): any => (event as CustomEvent).detail;

/** Everything one build pass produced, for the whole patch or for one voice. */
interface Scope {
  instances: Map<string, NodeInstance>;
  byId: Map<string, NodeInstance>;
  gates: NonNullable<NodeInstance["gate"]>[];
  noteOscs: NodeInstance[];
  masterTaps: AudioNode[];
  defaultDestUsed: boolean;
  externalTargets: Set<AudioNode>;
}

/** Desired values, layered over the patch so a rebuilt voice starts in tune. */
interface Desired {
  params: Map<string, number>;
  props: Map<string, string>;
}

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
export class AudioGraphCore extends EventTarget {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    properties: [
      { name: "state", event: "wcs-audio:statechange", semantics: "state" },
      { name: "running", event: "wcs-audio:statechange", semantics: "state", getter: (e: Event) => detailOf(e) === "running" },
      { name: "suspended", event: "wcs-audio:statechange", semantics: "state", getter: (e: Event) => detailOf(e) === "suspended" },
      { name: "unsupported", event: "wcs-audio:statechange", semantics: "state", getter: (e: Event) => detailOf(e) === UNSUPPORTED },
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

  private _target: EventTarget;
  private _createContext: () => BaseAudioContext | null;

  private _ctx: BaseAudioContext | null = null;
  private _master: GainNode | null = null;
  private _limiter: DynamicsCompressorNode | null = null;
  private _masterTaps: AudioNode[] = [];

  private _patch: Patch | null = null;
  private _structureKey: string | null = null;
  private _desired = new Map<string, Desired>();
  private _instances = new Map<string, Set<NodeInstance>>();
  private _live: Scope | null = null;
  private _allocators: VoiceAllocator[] = [];
  private _held: number[] = [];

  private _volume = 0.8;
  private _limiterEnabled = true;

  private _state: AudioContextState = "suspended";
  private _voices = 0;
  private _warnings: IAudioWarning[] = [];
  private _error: string | null = null;
  private _errorInfo: WcsIoErrorInfo | null = null;

  // Bumped by every resume()/suspend() and by dispose(): an in-flight transition
  // that settles after a newer one (or after teardown) must not publish.
  private _gen = 0;
  private _ready: Promise<void> = Promise.resolve();

  constructor(options?: { createContext?: () => BaseAudioContext | null } | null, target?: EventTarget) {
    super();
    this._target = target ?? this;
    this._createContext = options?.createContext ?? defaultCreateContext;
  }

  // --- Observable getters ---

  get state(): AudioContextState { return this._state; }
  get running(): boolean { return this._state === "running"; }
  get suspended(): boolean { return this._state === "suspended"; }
  get unsupported(): boolean { return this._state === UNSUPPORTED; }
  get voices(): number { return this._voices; }
  get warnings(): IAudioWarning[] { return this._warnings; }
  get error(): string | null { return this._error; }
  get errorInfo(): WcsIoErrorInfo | null { return this._errorInfo; }
  get ready(): Promise<void> { return this._ready; }

  /** Sounding notes, released tails excluded. */
  get soundingVoices(): number {
    return this._allocators.reduce((n, a) => n + a.sounding, 0);
  }

  /** Voices still holding nodes, including tails not yet reclaimed. */
  get allocatedVoices(): number {
    return this._allocators.reduce((n, a) => n + a.allocated, 0);
  }

  // --- Lifecycle ---

  /**
   * Install a patch and start observing. Idempotent — re-submitting the same
   * structure only applies values.
   */
  observe(patch: Patch): Promise<void> {
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
  dispose(): void {
    this._gen++;
    this._teardown();
    const ctx = this._ctx as AudioContext | null;
    // Detach the shared context's listener: the context outlives this Core, so
    // leaving it attached would keep every disposed instance reachable.
    ctx?.removeEventListener?.("statechange", this._onContextState);
    if (this._master) {
      try { this._master.disconnect(); } catch { /* already detached */ }
    }
    if (this._limiter) {
      try { this._limiter.disconnect(); } catch { /* already detached */ }
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
  setPatch(patch: Patch): boolean {
    if (!this._ensureContext()) return false;
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
  setParam(key: string, name: string, value: number): void {
    const v = num(value, NaN);
    if (!Number.isFinite(v)) return;
    this._desiredFor(key).params.set(name, v);
    if (!this._ctx) return;
    for (const inst of this._instances.get(key) ?? []) {
      const param = inst.params[name];
      // A short ramp rather than a step: an instantaneous parameter jump is an
      // audible click.
      if (param) param.setTargetAtTime(v, this._ctx.currentTime, 0.02);
    }
  }

  /** Live update of a non-AudioParam setting (`type`, `mix`, ADSR times, …). */
  setProp(key: string, name: string, value: string): void {
    this._desiredFor(key).props.set(name, value);
    for (const inst of this._instances.get(key) ?? []) {
      PROPS[inst.kind]?.[name]?.(inst, value);
    }
  }

  /** Master output level. Desired only — the effective gain is never read back. */
  setVolume(value: number): void {
    this._volume = num(value, 0.8);
    if (this._master && this._ctx) {
      this._master.gain.setTargetAtTime(this._volume, this._ctx.currentTime, 0.02);
    }
  }

  /** Toggle the ear-protection limiter. Rewires the master chain in place. */
  setLimiter(enabled: boolean): void {
    if (this._limiterEnabled === enabled) return;
    this._limiterEnabled = enabled;
    this._wireMaster();
  }

  // --- Context ---

  /** Resume the shared context. Never rejects; failures land on `error`. */
  resume(): Promise<void> {
    const ctx = this._ctx;
    if (!ctx || typeof (ctx as AudioContext).resume !== "function") return Promise.resolve();
    const gen = ++this._gen;
    this._ready = (ctx as AudioContext).resume().then(
      () => {
        if (gen !== this._gen) return;
        this._setError(null);
        this._syncState();
        // Chromium can drop an edge into a sink-only AnalyserNode that was wired
        // while the context was suspended. Re-kick the taps once it is running.
        this.rekickTaps();
      },
      (error: any) => {
        if (gen !== this._gen) return;
        this._setError(this._messageOf(error), error?.name);
      },
    );
    return this._ready;
  }

  /** Suspend the shared context. Never rejects. */
  suspend(): Promise<void> {
    const ctx = this._ctx as AudioContext | null;
    if (!ctx || typeof ctx.suspend !== "function") return Promise.resolve();
    const gen = ++this._gen;
    this._ready = ctx.suspend().then(
      () => { if (gen === this._gen) this._syncState(); },
      (error: any) => {
        if (gen !== this._gen) return;
        this._setError(this._messageOf(error), error?.name);
      },
    );
    return this._ready;
  }

  /** Re-attach every master analyser tap (see `resume()`). */
  rekickTaps(): void {
    const master = this._master;
    if (!master) return;
    for (const tap of this._masterTaps) {
      try { master.disconnect(tap); } catch { /* not connected */ }
      master.connect(tap);
    }
  }

  // --- Notes ---

  noteOn(note: number, velocity = 1): void {
    const ctx = this._ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.sweep(t);
    for (const allocator of this._allocators) this._voiceNoteOn(allocator, note, velocity, t);
    if (this._live) {
      this._held = this._held.filter((n) => n !== note);
      this._held.push(note);
      const freq = midiToFreq(note);
      for (const inst of this._live.noteOscs) setOscNote(inst, freq, t, false);
      for (const gate of this._live.gates) gate.on(t, velocity);
    }
    this._publishVoices();
    this._target.dispatchEvent(new CustomEvent("wcs-audio:noteon", { detail: { note, velocity }, bubbles: true }));
  }

  noteOff(note: number): void {
    const ctx = this._ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const allocator of this._allocators) {
      for (const allocation of allocator.matching(note)) allocator.release(allocation, t);
    }
    if (this._live) {
      // Last-note priority: releasing the top note falls back to the one below
      // rather than cutting the line off (monophonic legato).
      const wasTop = this._held[this._held.length - 1] === note;
      this._held = this._held.filter((n) => n !== note);
      if (this._held.length === 0) {
        for (const gate of this._live.gates) gate.off(t);
      } else if (wasTop) {
        const freq = midiToFreq(this._held[this._held.length - 1]);
        for (const inst of this._live.noteOscs) setOscNote(inst, freq, t, false);
      }
    }
    this.sweep(t);
    this._publishVoices();
    this._target.dispatchEvent(new CustomEvent("wcs-audio:noteoff", { detail: { note }, bubbles: true }));
  }

  allNotesOff(): void {
    const ctx = this._ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const allocator of this._allocators) allocator.disposeAll();
    for (const gate of this._live!.gates) gate.off(t);
    this._held = [];
    this._publishVoices();
  }

  /** Reclaim released voices whose tail has elapsed on the audio clock. */
  sweep(now = this._ctx?.currentTime ?? 0): void {
    for (const allocator of this._allocators) allocator.sweep(now);
  }

  // --- Analyser ---

  /**
   * Read an analyser node. Returns a **freshly allocated** array every call: the
   * producer never hands out a buffer it will later overwrite (producer snapshot
   * contract), so a consumer that retains a frame is safe.
   */
  sample(key: string, mode: "wave" | "fft" = "wave"): Uint8Array | null {
    for (const inst of this._instances.get(key) ?? []) {
      if (!inst.analyser) continue;
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

  private _ensureContext(): boolean {
    if (this._ctx) return true;
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
    (ctx as AudioContext).addEventListener?.("statechange", this._onContextState);
    return true;
  }

  private _wireMaster(): void {
    const ctx = this._ctx;
    const master = this._master;
    const limiter = this._limiter;
    if (!ctx || !master || !limiter) return;
    try { master.disconnect(); } catch { /* not connected */ }
    try { limiter.disconnect(); } catch { /* not connected */ }
    if (this._limiterEnabled) master.connect(limiter).connect(ctx.destination);
    else master.connect(ctx.destination);
    // Master taps hang off the master gain, so they survive the rewire above
    // only if re-attached.
    for (const tap of this._masterTaps) master.connect(tap);
  }

  private _onContextState = (): void => { this._syncState(); };

  // Only called with a context in hand.
  private _syncState(): void {
    this._setState(this._ctx!.state as AudioContextState);
  }

  private _messageOf(error: any): string {
    return typeof error?.message === "string" && error.message !== "" ? error.message : "Audio error";
  }

  // --- Internal: patch values ---

  private _desiredFor(key: string): Desired {
    let desired = this._desired.get(key);
    if (!desired) this._desired.set(key, (desired = { params: new Map(), props: new Map() }));
    return desired;
  }

  private _walk(patch: Patch, visit: (node: PatchNode) => void): void {
    const descend = (node: PatchNode): void => {
      visit(node);
      for (const child of node.children ?? []) descend(child);
    };
    for (const node of patch.nodes) descend(node);
    for (const voice of patch.voices ?? []) for (const node of voice.nodes) descend(node);
  }

  private _seedDesired(patch: Patch): void {
    this._desired.clear();
    this._walk(patch, (node) => {
      const desired = this._desiredFor(node.key);
      for (const [name, value] of Object.entries(node.params ?? {})) desired.params.set(name, value);
      for (const [name, value] of Object.entries(node.props ?? {})) desired.props.set(name, value);
    });
  }

  private _applyValues(patch: Patch): void {
    this._walk(patch, (node) => {
      const desired = this._desiredFor(node.key);
      for (const [name, value] of Object.entries(node.params ?? {})) {
        if (desired.params.get(name) !== value) this.setParam(node.key, name, value);
      }
      for (const [name, value] of Object.entries(node.props ?? {})) {
        if (desired.props.get(name) !== value) this.setProp(node.key, name, value);
      }
    });
  }

  // --- Internal: graph ---

  private _warn(message: string, node: PatchNode): void {
    // Fresh array assigned before notifying (producer snapshot contract).
    this._warnings = [...this._warnings, { message, key: node.key }];
    this._target.dispatchEvent(new CustomEvent("wcs-audio:warnings", { detail: this._warnings, bubbles: true }));
  }

  private _rebuild(): void {
    this._teardown();
    const master = this._master!;
    const scope = this._buildScope(this._patch!.nodes, master, null);
    this._live = scope;
    this._allocators = (this._patch!.voices ?? []).map((def: PatchVoice) => new VoiceAllocator(def));
    for (const tap of scope.masterTaps) {
      master.connect(tap);
      this._masterTaps.push(tap);
    }
    this._publishVoices();
  }

  private _teardown(): void {
    for (const allocator of this._allocators) allocator.disposeAll();
    const master = this._master;
    for (const tap of this._masterTaps) {
      try { master?.disconnect(tap); } catch { /* already gone */ }
    }
    this._masterTaps = [];
    if (this._live) for (const inst of this._live.instances.values()) inst.dispose?.();
    this._live = null;
    this._allocators = [];
    this._held = [];
  }

  private _createInstance(node: PatchNode): NodeInstance | null {
    const build = BUILDERS[node.kind];
    if (!build) {
      this._warn(`unknown node kind "${node.kind}"`, node);
      return null;
    }
    const inst = build(this._ctx!, node);
    const desired = this._desired.get(node.key);
    for (const [name, dflt] of Object.entries(PARAM_DEFAULTS[node.kind])) {
      const param = inst.params[name];
      if (param) param.value = desired?.params.has(name) ? desired.params.get(name)! : dflt;
    }
    for (const name of Object.keys(PROPS[node.kind])) {
      const value = desired?.props.get(name);
      if (value !== undefined) PROPS[node.kind][name](inst, value);
    }

    let set = this._instances.get(node.key);
    if (!set) this._instances.set(node.key, (set = new Set()));
    set.add(inst);
    inst.dispose = () => {
      set!.delete(inst);
      for (const source of inst.sources ?? []) {
        try { source.stop(); } catch { /* already stopped */ }
      }
      for (const n of inst.nodes) {
        try { n.disconnect(); } catch { /* already detached */ }
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
  private _buildScope(nodes: readonly PatchNode[], dest: AudioNode, voice: VoiceAllocator | null): Scope {
    const inVoice = voice !== null;
    const scope: Scope = {
      instances: new Map(), byId: new Map(), gates: [], noteOscs: [], masterTaps: [],
      defaultDestUsed: false, externalTargets: new Set(),
    };
    const wires: (() => void)[] = [];

    const lookup = (id: string): NodeInstance | null =>
      scope.byId.get(id) ?? (inVoice ? this._live!.byId.get(id) ?? null : null);

    const connectAudioTo = (inst: NodeInstance, id: string, node: PatchNode): void => {
      const target = lookup(id);
      if (!target?.input) {
        this._warn(`out="${id}": no reachable audio input with that id`, node);
        return;
      }
      if (inVoice && !scope.byId.has(id)) {
        // Leaving the voice: go through the per-voice gain so stealing can fade
        // this send along with everything else the voice produces.
        inst.output!.connect(dest);
        scope.externalTargets.add(target.input);
      } else {
        inst.output!.connect(target.input);
      }
    };

    const connectParamTo = (inst: NodeInstance, spec: string, node: PatchNode): void => {
      const dot = spec.indexOf(".");
      const target = lookup(spec.slice(0, dot));
      const param = target?.params?.[spec.slice(dot + 1)];
      if (!param) {
        this._warn(`"${spec}": no reachable AudioParam with that id.name`, node);
        return;
      }
      inst.output!.connect(param);
    };

    const process = (node: PatchNode, parent: NodeInstance | null): void => {
      const inst = this._createInstance(node);
      if (!inst) return;
      scope.instances.set(node.key, inst);
      if (node.id) scope.byId.set(node.id, inst);

      const modulator = isModulator(node);
      const tap = isMasterTap(node);

      // Nesting is the signal chain — but a modulator or a master tap is not in
      // the chain, so it must not take the parent's audio.
      if (!modulator && !tap && parent?.output && inst.input) parent.output.connect(inst.input);

      if (modulator) {
        const spec = node.param;
        if (spec && spec.includes(".")) {
          wires.push(() => connectParamTo(inst, spec, node));
        } else if (spec) {
          const param = parent?.params?.[spec];
          if (param) inst.output!.connect(param);
          else this._warn(`param="${spec}": parent has no such AudioParam`, node);
        } else if (!node.out?.length) {
          this._warn(`modulator needs param (or out="id.param")`, node);
        }
      }

      if (inst.gate) scope.gates.push(inst.gate);
      if (node.kind === "osc" && node.note) scope.noteOscs.push(inst);
      if (tap) scope.masterTaps.push(inst.input!);

      let chainChildren = 0;
      for (const child of node.children ?? []) {
        if (!isModulator(child) && !isMasterTap(child)) chainChildren++;
        process(child, inst);
      }

      for (const ref of node.out ?? []) {
        if (ref.includes(".")) wires.push(() => connectParamTo(inst, ref, node));
        else wires.push(() => connectAudioTo(inst, ref, node));
      }

      // A leaf with no explicit routing goes to the destination: that is what
      // makes the simplest possible patch audible without any wiring at all.
      if (!modulator && !tap && inst.output && chainChildren === 0 && !node.out?.length) {
        inst.output.connect(dest);
        scope.defaultDestUsed = true;
      }
    };

    for (const node of nodes) process(node, null);
    for (const wire of wires) wire();
    return scope;
  }

  // --- Internal: voices ---

  private _voiceNoteOn(allocator: VoiceAllocator, note: number, velocity: number, t: number): void {
    const ctx = this._ctx!;
    for (const allocation of allocator.matching(note)) allocator.release(allocation, t);
    // sounding >= poly guarantees at least one sounding voice to take.
    while (allocator.sounding >= allocator.poly) allocator.steal(allocator.oldest()!, t);

    const gain = ctx.createGain();
    const scope = this._buildScope(allocator.def.nodes, gain, allocator);
    if (scope.defaultDestUsed) gain.connect(this._master!);
    for (const target of scope.externalTargets) gain.connect(target);

    const freq = midiToFreq(note);
    // A voice with no `note` oscillator would be silent-but-allocated; treat
    // every oscillator as note-following so a minimal patch still plays.
    const followers = scope.noteOscs.length > 0
      ? scope.noteOscs
      : [...scope.instances.values()].filter((i) => i.kind === "osc");
    for (const inst of followers) setOscNote(inst, freq, t, true);

    const allocation: VoiceAllocation = {
      note, instances: scope.instances, gates: scope.gates, gain,
      released: false, freeAt: Infinity,
    };
    if (scope.gates.length > 0) {
      gain.gain.value = 1;
      for (const gate of scope.gates) gate.on(t, velocity);
    } else {
      // No envelope in the patch: a 5ms fade-in stands in, so a gateless voice
      // cannot sustain forever and cannot click on attack.
      gain.gain.value = 0;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(velocity, t + 0.005);
    }
    allocator.add(allocation);
  }

  // --- Internal: state setters ---

  private _setState(state: AudioContextState): void {
    if (this._state === state) return;
    this._state = state;
    this._target.dispatchEvent(new CustomEvent("wcs-audio:statechange", { detail: state, bubbles: true }));
  }

  private _publishVoices(): void {
    const voices = this.soundingVoices;
    if (this._voices === voices) return;
    this._voices = voices;
    this._target.dispatchEvent(new CustomEvent("wcs-audio:voices", { detail: voices, bubbles: true }));
  }

  private _setError(error: string | null, name?: string): void {
    if (this._error !== error) {
      this._error = error;
      this._target.dispatchEvent(new CustomEvent("wcs-audio:error", { detail: error, bubbles: true }));
    }
    this._commitErrorInfo(error === null ? null : deriveAudioErrorInfo(name, error));
  }

  private _commitErrorInfo(info: WcsIoErrorInfo | null): void {
    if (this._errorInfo === null && info === null) return;
    this._errorInfo = info;
    this._target.dispatchEvent(new CustomEvent("wcs-audio:error-info-changed", { detail: info, bubbles: true }));
  }
}
