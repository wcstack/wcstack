/**
 * Phase B PoC — AudioGraphCore.
 *
 * Proves the ADR-14 G1 decision: the patch is a plain-object descriptor tree and
 * the Core never touches the DOM. Ported from examples/synth-playground's
 * `_buildScope`, with the DOM walk lifted out into the caller.
 *
 * Throwaway: packages/audio/src/core/AudioGraphCore.ts supersedes this in Phase C.
 * See docs/audio-tag-design.md and docs/audio-impl-plan.md.
 */

const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);

const num = (v, dflt) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
};

const isModulator = (node) => node.param != null || node.kind === "lfo";
const isMasterTap = (node) => node.kind === "analyser" && node.master === true;

/** Param name -> default. Only names listed here are AudioParams on the instance. */
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

function shaperCurve(k) {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}

const noiseBuffers = new WeakMap();

const BUILDERS = {
  osc(ctx) {
    const osc = ctx.createOscillator();
    osc.start();
    return {
      output: osc, osc, sources: [osc], nodes: [osc], glide: 0, transpose: 0,
      params: { frequency: osc.frequency, detune: osc.detune },
    };
  },

  noise(ctx) {
    let buf = noiseBuffers.get(ctx);
    if (!buf) {
      buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 2)), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseBuffers.set(ctx, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return { output: src, sources: [src], nodes: [src], params: {} };
  },

  biquad(ctx) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    return {
      input: filter, output: filter, filter, nodes: [filter],
      params: { frequency: filter.frequency, q: filter.Q, gain: filter.gain, detune: filter.detune },
    };
  },

  gain(ctx) {
    const g = ctx.createGain();
    return { input: g, output: g, nodes: [g], params: { gain: g.gain } };
  },

  delay(ctx) {
    const input = ctx.createGain();
    const delay = ctx.createDelay(5);
    const fb = ctx.createGain();
    const wet = ctx.createGain();
    const dry = ctx.createGain();
    const output = ctx.createGain();
    input.connect(dry).connect(output);
    input.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(output);
    fb.gain.value = 0.3;
    wet.gain.value = 0.5;
    dry.gain.value = 0.5;
    return {
      input, output, wet, dry, nodes: [input, delay, fb, wet, dry, output],
      params: { time: delay.delayTime, feedback: fb.gain },
    };
  },

  shaper(ctx) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = shaperCurve(20);
    shaper.oversample = "2x";
    return { input: shaper, output: shaper, shaper, nodes: [shaper], params: {} };
  },

  /** ADSR. In the chain (no param=) it is a VCA; with param= it is a modulator. */
  env(ctx, node) {
    const g = ctx.createGain();
    g.gain.value = 0;
    const inst = {
      envParam: g.gain,
      adsr: { a: 0.01, d: 0.1, s: 0.7, r: 0.3, depth: 1 },
      nodes: [g], params: {},
    };
    if (isModulator(node)) {
      const src = ctx.createConstantSource();
      src.offset.value = 1;
      src.start();
      src.connect(g);
      inst.output = g;
      inst.sources = [src];
      inst.nodes.push(src);
    } else {
      inst.input = g;
      inst.output = g;
    }
    inst.gate = {
      on: (t, vel = 1) => {
        const p = inst.envParam;
        const { a, d, s, depth } = inst.adsr;
        const peak = depth * vel;
        p.cancelScheduledValues(t);
        p.setValueAtTime(p.value, t);
        p.linearRampToValueAtTime(peak, t + a);
        p.setTargetAtTime(peak * s, t + a, d / 3);
      },
      off: (t) => {
        const p = inst.envParam;
        p.cancelScheduledValues(t);
        p.setValueAtTime(p.value, t);
        p.setTargetAtTime(0, t, inst.adsr.r / 3);
      },
      release: () => inst.adsr.r,
    };
    return inst;
  },

  lfo(ctx) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g);
    osc.start();
    return {
      output: g, osc, sources: [osc], nodes: [osc, g],
      params: { rate: osc.frequency, depth: g.gain },
    };
  },

  analyser(ctx) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    // Keep the analyser in an always-pulled path: a sink-only analyser can drop
    // out of Chromium's rendering graph (notably when wired while suspended).
    // The tap must reach `destination`, not `master` — routing it back into
    // master would close a feedback loop. Gain 0 means it carries no signal, so
    // nothing bypasses the limiter.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    analyser.connect(mute).connect(ctx.destination);
    return {
      input: analyser, output: analyser, analyser, mute,
      nodes: [analyser, mute], params: {},
    };
  },
};

/** Non-AudioParam settings, applied at build time and on live updates. */
const PROPS = {
  osc: {
    type: (i, v) => { try { i.osc.type = v; } catch { /* invalid type */ } },
    glide: (i, v) => { i.glide = Math.max(num(v, 0), 0); },
    transpose: (i, v) => { i.transpose = num(v, 0); },
  },
  biquad: {
    type: (i, v) => { try { i.filter.type = v; } catch { /* invalid type */ } },
  },
  delay: {
    mix: (i, v) => {
      const m = Math.min(Math.max(num(v, 0.5), 0), 1);
      i.wet.gain.value = m;
      i.dry.gain.value = 1 - m;
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
    type: (i, v) => { try { i.osc.type = v; } catch { /* invalid type */ } },
  },
  noise: {}, gain: {}, analyser: {},
};

function setOscNote(inst, freq, t, initial) {
  const f = freq * 2 ** ((inst.transpose ?? 0) / 12);
  const p = inst.params.frequency;
  if (!p) return;
  if (initial) p.value = f;
  else if (inst.glide > 0) p.setTargetAtTime(f, t, inst.glide / 3);
  else p.setValueAtTime(f, t);
}

/**
 * Serialize everything that affects graph topology. Values (params / props) are
 * deliberately excluded: a patch that differs only in numbers is a live update,
 * never a rebuild. This is what lets a caller re-submit the whole patch on any
 * change and have the Core decide (ADR-14 G5, idempotent setPatch).
 */
function structureKey(patch) {
  const node = (n) =>
    `${n.kind}#${n.key}@${n.id ?? ""}|${(n.out ?? []).join(",")}|${n.param ?? ""}|${n.note ? 1 : 0}|${n.master ? 1 : 0}(${(n.children ?? []).map(node).join(" ")})`;
  const voices = (patch.voices ?? [])
    .map((v) => `voice#${v.key}*${v.poly ?? 8}(${(v.nodes ?? []).map(node).join(" ")})`)
    .join(" ");
  return `${(patch.nodes ?? []).map(node).join(" ")}||${voices}`;
}

export class AudioGraphCore extends EventTarget {
  /** @param {{context: BaseAudioContext, target?: EventTarget}} options */
  constructor({ context, target } = {}) {
    super();
    this._ctx = context;
    this._target = target ?? this;
    this._instances = new Map();   // key -> Set<inst>  (a voice key has one inst per sounding note)
    this._desired = new Map();     // key -> { params: Map, props: Map }
    this._patch = null;
    this._structureKey = null;
    this._live = null;
    this._voices = [];
    this._held = [];
    this._masterTaps = [];
    this._disposed = false;
    /** Diagnostics instead of exceptions (never-throw). */
    this.warnings = [];

    const ctx = context;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -18;
    this.master.connect(this.limiter).connect(ctx.destination);
  }

  get context() { return this._ctx; }

  /** Number of voices currently sounding (released ones still count until swept). */
  get activeVoices() {
    return this._voices.reduce((n, v) => n + v.active.filter((a) => !a.released).length, 0);
  }

  /** Voices still holding audio nodes, including released-but-not-yet-reclaimed. */
  get allocatedVoices() {
    return this._voices.reduce((n, v) => n + v.active.length, 0);
  }

  setVolume(v) {
    this.master.gain.setTargetAtTime(num(v, 0.8), this._ctx.currentTime, 0.02);
  }

  // -------------------------------------------------------------- patch

  /**
   * Hand the Core the whole patch. Returns true if it rebuilt the graph
   * (structure changed), false if it only applied values.
   */
  setPatch(patch) {
    if (this._disposed) return false;
    const key = structureKey(patch);
    this._patch = patch;
    if (key === this._structureKey) {
      this._applyValues(patch);
      return false;
    }
    this._structureKey = key;
    this._seedDesired(patch);
    this._rebuild();
    return true;
  }

  /** Live parameter update. Applies to every instance of `key`, sounding voices included. */
  setParam(key, name, value) {
    const v = num(value, undefined);
    if (v === undefined) return;
    this._desiredFor(key).params.set(name, v);
    for (const inst of this._instances.get(key) ?? []) {
      const p = inst.params?.[name];
      if (p) p.setTargetAtTime(v, this._ctx.currentTime, 0.02);
    }
  }

  /** Live non-AudioParam update (type, mix, ADSR times, ...). */
  setProp(key, name, value) {
    this._desiredFor(key).props.set(name, value);
    for (const inst of this._instances.get(key) ?? []) {
      PROPS[inst.kind]?.[name]?.(inst, value);
    }
  }

  _desiredFor(key) {
    let d = this._desired.get(key);
    if (!d) this._desired.set(key, (d = { params: new Map(), props: new Map() }));
    return d;
  }

  _walk(patch, fn) {
    const visit = (n) => { fn(n); for (const c of n.children ?? []) visit(c); };
    for (const n of patch.nodes ?? []) visit(n);
    for (const v of patch.voices ?? []) for (const n of v.nodes ?? []) visit(n);
  }

  _seedDesired(patch) {
    this._desired.clear();
    this._walk(patch, (n) => {
      const d = this._desiredFor(n.key);
      for (const [name, v] of Object.entries(n.params ?? {})) d.params.set(name, num(v, v));
      for (const [name, v] of Object.entries(n.props ?? {})) d.props.set(name, v);
    });
  }

  /** Same structure, possibly different numbers: apply only what actually changed. */
  _applyValues(patch) {
    this._walk(patch, (n) => {
      const d = this._desiredFor(n.key);
      for (const [name, v] of Object.entries(n.params ?? {})) {
        if (d.params.get(name) !== num(v, v)) this.setParam(n.key, name, v);
      }
      for (const [name, v] of Object.entries(n.props ?? {})) {
        if (d.props.get(name) !== v) this.setProp(n.key, name, v);
      }
    });
  }

  // -------------------------------------------------------------- graph

  _warn(msg, node) {
    this.warnings.push({ message: msg, key: node?.key ?? null });
    this._target.dispatchEvent(new CustomEvent("wcs-audio:warn", { detail: { message: msg, key: node?.key ?? null } }));
  }

  _rebuild() {
    this._teardown();
    const scope = this._buildScope(this._patch.nodes ?? [], this.master, null);
    this._live = scope;
    this._voices = (this._patch.voices ?? []).map((def) => ({ def, active: [] }));
    for (const tap of scope.masterTaps) {
      this.master.connect(tap);
      this._masterTaps.push(tap);
    }
  }

  _teardown() {
    for (const v of this._voices) for (const a of [...v.active]) this._disposeVoice(v, a);
    for (const tap of this._masterTaps) {
      try { this.master.disconnect(tap); } catch { /* already gone */ }
    }
    this._masterTaps = [];
    if (this._live) for (const inst of this._live.instances.values()) inst.dispose();
    this._live = null;
    this._voices = [];
    this._held = [];
  }

  _createInstance(node) {
    const build = BUILDERS[node.kind];
    if (!build) {
      this._warn(`unknown node kind "${node.kind}"`, node);
      return null;
    }
    const inst = build(this._ctx, node);
    inst.key = node.key;
    inst.kind = node.kind;
    inst.params ??= {};

    const d = this._desired.get(node.key);
    for (const [name, dflt] of Object.entries(PARAM_DEFAULTS[node.kind] ?? {})) {
      const p = inst.params[name];
      if (p) p.value = d?.params.has(name) ? d.params.get(name) : dflt;
    }
    for (const [name, setter] of Object.entries(PROPS[node.kind] ?? {})) {
      const v = d?.props.get(name);
      if (v !== undefined) setter(inst, v);
    }

    let set = this._instances.get(node.key);
    if (!set) this._instances.set(node.key, (set = new Set()));
    set.add(inst);
    inst.dispose = () => {
      set.delete(inst);
      for (const s of inst.sources ?? []) { try { s.stop(); } catch { /* already stopped */ } }
      for (const n of inst.nodes ?? []) { try { n.disconnect(); } catch { /* detached */ } }
    };
    return inst;
  }

  /**
   * Two passes: instantiate along the nesting, then resolve id-based wires.
   * In a voice scope, audio leaving the voice is funneled through `dest` (the
   * per-voice gain) so note stealing can fade the whole voice at once.
   */
  _buildScope(nodes, dest, voice) {
    const isVoice = voice !== null;
    const scope = {
      instances: new Map(), byId: new Map(), gates: [], noteOscs: [], masterTaps: [],
      defaultDestUsed: false, externalTargets: new Set(),
    };
    const wires = [];

    const lookup = (id) =>
      scope.byId.get(id) ?? (isVoice ? this._live?.byId.get(id) ?? null : null);

    const connectAudioTo = (inst, id, node) => {
      const targetInst = lookup(id);
      if (!targetInst?.input) {
        this._warn(`out="${id}": no reachable audio input with that id`, node);
        return;
      }
      if (isVoice && !scope.byId.has(id)) {
        // Leaving the voice: go through the per-voice gain so stealing can fade it.
        inst.output.connect(dest);
        scope.externalTargets.add(targetInst.input);
      } else {
        inst.output.connect(targetInst.input);
      }
    };

    const connectParamTo = (inst, spec, node) => {
      const dot = spec.indexOf(".");
      const targetInst = lookup(spec.slice(0, dot));
      const p = targetInst?.params?.[spec.slice(dot + 1)];
      if (!p) {
        this._warn(`"${spec}": no reachable AudioParam with that id.name`, node);
        return;
      }
      inst.output.connect(p);
    };

    const process = (node, parentInst) => {
      const inst = this._createInstance(node);
      if (!inst) return;
      scope.instances.set(node.key, inst);
      if (node.id) scope.byId.set(node.id, inst);

      const mod = isModulator(node);
      const tap = isMasterTap(node);

      if (!mod && !tap && parentInst?.output && inst.input) parentInst.output.connect(inst.input);

      if (mod) {
        const spec = node.param;
        if (spec && spec.includes(".")) {
          wires.push(() => connectParamTo(inst, spec, node));
        } else if (spec) {
          const p = parentInst?.params?.[spec];
          if (p) inst.output.connect(p);
          else this._warn(`param="${spec}": parent has no such AudioParam`, node);
        } else if (!node.out) {
          this._warn(`modulator needs param= (or out="id.param")`, node);
        }
      }

      if (inst.gate) scope.gates.push(inst.gate);
      if (node.kind === "osc" && node.note) scope.noteOscs.push(inst);
      if (tap) scope.masterTaps.push(inst.input);

      let chainKids = 0;
      for (const child of node.children ?? []) {
        if (!isModulator(child) && !isMasterTap(child)) chainKids++;
        process(child, inst);
      }

      for (const ref of node.out ?? []) {
        if (ref.includes(".")) wires.push(() => connectParamTo(inst, ref, node));
        else wires.push(() => connectAudioTo(inst, ref, node));
      }

      if (!mod && !tap && inst.output && chainKids === 0 && !node.out?.length) {
        inst.output.connect(dest);
        scope.defaultDestUsed = true;
      }
    };

    for (const node of nodes) process(node, null);
    for (const wire of wires) wire();
    return scope;
  }

  // -------------------------------------------------------------- notes

  noteOn(note, velocity = 1) {
    if (this._disposed) return;
    const t = this._ctx.currentTime;
    this.sweep();
    for (const v of this._voices) this._voiceNoteOn(v, note, velocity, t);
    if (this._live) {
      this._held = this._held.filter((n) => n !== note);
      this._held.push(note);
      const freq = midiToFreq(note);
      for (const inst of this._live.noteOscs) setOscNote(inst, freq, t, false);
      for (const g of this._live.gates) g.on(t, velocity);
    }
    this._target.dispatchEvent(new CustomEvent("wcs-audio:noteon", { detail: { note, velocity }, bubbles: true }));
  }

  noteOff(note) {
    if (this._disposed) return;
    const t = this._ctx.currentTime;
    for (const v of this._voices) {
      for (const a of v.active) if (a.note === note && !a.released) this._release(v, a, t);
    }
    if (this._live) {
      const wasTop = this._held[this._held.length - 1] === note;
      this._held = this._held.filter((n) => n !== note);
      if (this._held.length === 0) {
        for (const g of this._live.gates) g.off(t);
      } else if (wasTop) {
        const freq = midiToFreq(this._held[this._held.length - 1]);
        for (const inst of this._live.noteOscs) setOscNote(inst, freq, t, false);
      }
    }
    this.sweep();
    this._target.dispatchEvent(new CustomEvent("wcs-audio:noteoff", { detail: { note }, bubbles: true }));
  }

  allNotesOff() {
    if (this._disposed) return;
    const t = this._ctx.currentTime;
    for (const v of this._voices) for (const a of [...v.active]) this._disposeVoice(v, a);
    for (const g of this._live?.gates ?? []) g.off(t);
    this._held = [];
  }

  _voiceNoteOn(v, note, velocity, t) {
    const ctx = this._ctx;
    for (const a of [...v.active]) if (a.note === note && !a.released) this._release(v, a, t);

    const poly = Math.max(num(v.def.poly, 8), 1);
    while (v.active.filter((a) => !a.released).length >= poly) {
      const oldest = v.active.find((a) => !a.released);
      if (!oldest) break;
      this._steal(v, oldest, t);
    }

    const vGain = ctx.createGain();
    const scope = this._buildScope(v.def.nodes ?? [], vGain, v);
    if (scope.defaultDestUsed) vGain.connect(this.master);
    for (const target of scope.externalTargets) vGain.connect(target);

    const freq = midiToFreq(note);
    let followers = scope.noteOscs;
    if (followers.length === 0) {
      followers = [...scope.instances.values()].filter((i) => i.kind === "osc");
    }
    for (const inst of followers) setOscNote(inst, freq, t, true);

    const alloc = { note, scope, vGain, released: false, freeAt: Infinity };
    if (scope.gates.length > 0) {
      vGain.gain.value = 1;
      for (const g of scope.gates) g.on(t, velocity);
    } else {
      // Implicit safety envelope so a gateless patch cannot sustain forever.
      vGain.gain.value = 0;
      vGain.gain.setValueAtTime(0, t);
      vGain.gain.linearRampToValueAtTime(velocity, t + 0.005);
    }
    v.active.push(alloc);
  }

  _release(v, alloc, t) {
    alloc.released = true;
    let rel = 0.08;
    if (alloc.scope.gates.length > 0) {
      for (const g of alloc.scope.gates) g.off(t);
      rel = Math.max(...alloc.scope.gates.map((g) => g.release()), rel);
    } else {
      alloc.vGain.gain.setTargetAtTime(0, t, rel / 3);
    }
    // Reclaim on the audio clock, never on a wall-clock timer: background tabs
    // throttle timers to ~1/min while audio keeps rendering (design §6-1).
    alloc.freeAt = t + rel * 3 + 0.3;
  }

  _steal(v, alloc, t) {
    alloc.released = true;
    alloc.vGain.gain.cancelScheduledValues(t);
    alloc.vGain.gain.setTargetAtTime(0, t, 0.01);
    alloc.freeAt = t + 0.08;
  }

  _disposeVoice(v, alloc) {
    for (const inst of alloc.scope.instances.values()) inst.dispose();
    try { alloc.vGain.disconnect(); } catch { /* detached */ }
    v.active = v.active.filter((a) => a !== alloc);
  }

  /** Reclaim released voices whose tail has elapsed on the audio clock. */
  sweep(now = this._ctx.currentTime) {
    for (const v of this._voices) {
      for (const a of [...v.active]) if (a.released && a.freeAt <= now) this._disposeVoice(v, a);
    }
  }

  // -------------------------------------------------------------- analyser

  /** Returns a freshly allocated array every call (producer snapshot contract). */
  sample(key, mode = "wave") {
    const inst = [...(this._instances.get(key) ?? [])].find((i) => i.analyser);
    if (!inst) return null;
    const an = inst.analyser;
    if (mode === "fft") {
      const data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      return data;
    }
    const data = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(data);
    return data;
  }

  /** Re-kick master taps: Chromium can drop edges into a sink-only analyser
   *  that was wired while the context was suspended. */
  rekickTaps() {
    for (const tap of this._masterTaps) {
      try { this.master.disconnect(tap); } catch { /* not connected */ }
      this.master.connect(tap);
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._teardown();
    this._structureKey = null;
    try { this.master.disconnect(); } catch { /* detached */ }
    try { this.limiter.disconnect(); } catch { /* detached */ }
  }
}

export { structureKey, midiToFreq };
