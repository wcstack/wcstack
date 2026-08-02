import { AudioNodeKind, PatchNode } from "../types.js";

/**
 * One live instance of a patch node. `input` / `output` are the graph endpoints;
 * `params` maps the patch's parameter names onto the real `AudioParam`s.
 *
 * These objects — and every `AudioNode` inside them — stay inside the Core. They
 * are never published through wc-bindable (ADR-14 G2).
 */
export interface NodeInstance {
  key: string;
  kind: AudioNodeKind;
  input?: AudioNode;
  output?: AudioNode;
  params: Record<string, AudioParam>;
  nodes: AudioNode[];
  sources?: AudioScheduledSourceNode[];
  /** Note gate, present on `env`. */
  gate?: { on: (t: number, velocity: number) => void; off: (t: number) => void; release: () => number };
  /** Per-kind extras the prop setters need. */
  osc?: OscillatorNode;
  filter?: BiquadFilterNode;
  shaper?: WaveShaperNode;
  analyser?: AnalyserNode;
  wet?: GainNode;
  dry?: GainNode;
  envParam?: AudioParam;
  adsr?: { a: number; d: number; s: number; r: number; depth: number };
  glide: number;
  transpose: number;
  dispose?: () => void;
}

const num = (v: unknown, dflt: number): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : dflt;
};

export const isModulator = (node: PatchNode): boolean =>
  node.param != null || node.kind === "lfo";

export const isMasterTap = (node: PatchNode): boolean =>
  node.kind === "analyser" && node.master === true;

/** Parameter name → default. Only names listed here are AudioParams. */
export const PARAM_DEFAULTS: Record<AudioNodeKind, Record<string, number>> = {
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
export function shaperCurve(k: number): Float32Array<ArrayBuffer> {
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
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 2)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

export type Builder = (ctx: BaseAudioContext, node: PatchNode) => NodeInstance;

const base = (kind: AudioNodeKind, node: PatchNode): Pick<NodeInstance, "key" | "kind" | "params" | "nodes" | "glide" | "transpose"> =>
  // glide / transpose are always present so the note-setting path needs no
  // defaulting branch; only the oscillator ever changes them from 0.
  ({ key: node.key, kind, params: {}, nodes: [], glide: 0, transpose: 0 });

export const BUILDERS: Record<AudioNodeKind, Builder> = {
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
    const inst: NodeInstance = {
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
    } else {
      inst.input = g;
      inst.output = g;
    }
    const adsr = inst.adsr!;
    const param = inst.envParam!;
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

export type PropSetter = (inst: NodeInstance, value: string) => void;

/** Non-AudioParam settings, applied at build time and on every live update. */
export const PROPS: Record<AudioNodeKind, Record<string, PropSetter>> = {
  osc: {
    type: (i, v) => { try { i.osc!.type = v as OscillatorType; } catch { /* invalid type */ } },
    glide: (i, v) => { i.glide = Math.max(num(v, 0), 0); },
    transpose: (i, v) => { i.transpose = num(v, 0); },
  },
  noise: {},
  biquad: {
    type: (i, v) => { try { i.filter!.type = v as BiquadFilterType; } catch { /* invalid type */ } },
  },
  gain: {},
  delay: {
    mix: (i, v) => {
      const mix = Math.min(Math.max(num(v, 0.5), 0), 1);
      i.wet!.gain.value = mix;
      i.dry!.gain.value = 1 - mix;
    },
  },
  shaper: {
    amount: (i, v) => { i.shaper!.curve = shaperCurve(num(v, 20)); },
  },
  env: {
    attack: (i, v) => { i.adsr!.a = Math.max(num(v, 0.01), 0.001); },
    decay: (i, v) => { i.adsr!.d = Math.max(num(v, 0.1), 0.001); },
    sustain: (i, v) => { i.adsr!.s = Math.min(Math.max(num(v, 0.7), 0), 1); },
    release: (i, v) => { i.adsr!.r = Math.max(num(v, 0.3), 0.001); },
    depth: (i, v) => { i.adsr!.depth = num(v, 1); },
  },
  lfo: {
    type: (i, v) => { try { i.osc!.type = v as OscillatorType; } catch { /* invalid type */ } },
  },
  analyser: {
    fft: (i, v) => { try { i.analyser!.fftSize = num(v, 2048); } catch { /* not a power of two */ } },
    smoothing: (i, v) => { i.analyser!.smoothingTimeConstant = Math.min(Math.max(num(v, 0.85), 0), 1); },
  },
};

/** MIDI note number → frequency in Hz (A4 = 69 = 440 Hz). */
export const midiToFreq = (note: number): number => 440 * 2 ** ((note - 69) / 12);

/**
 * Retune an oscillator instance. `initial` writes the value directly (a fresh
 * voice must start in tune); later changes glide or step on the audio clock.
 */
export function setOscNote(inst: NodeInstance, freq: number, t: number, initial: boolean): void {
  const param = inst.params.frequency;
  const target = freq * 2 ** (inst.transpose / 12);
  if (initial) param.value = target;
  else if (inst.glide > 0) param.setTargetAtTime(target, t, inst.glide / 3);
  else param.setValueAtTime(target, t);
}

export { num };
