/**
 * wcs-synth — a toy modular synthesizer as custom elements (Web Audio API).
 *
 * NOT a published wcstack package: this is a playground experiment exploring
 * how far "declarative tags over a Web platform API" stretches when the API
 * is an audio *graph* rather than a single request/stream.
 *
 * Wiring model
 * ------------
 * - Nesting is the signal chain: a parent tag's audio output feeds each
 *   nested child tag's input, so signal flows *downward* through the markup.
 *       <wcs-osc>            source
 *         <wcs-filter>       ... processed by the filter
 *           <wcs-gain>       ... then the gain, then (leaf) the master out
 * - Routing that nesting cannot express uses ids:
 *       out="bus"            send audio to <wcs-mixer id="bus">'s input
 *       out="vcf.frequency"  drive an AudioParam anywhere by id
 *       param="frequency"    (modulators only) drive the *parent's* param
 * - A leaf tag (no chain children, no out=) connects to the synth master.
 * - <wcs-voice poly="N"> treats its subtree as a patch template and builds a
 *   fresh audio graph per note (polyphony). Outside a voice the graph is
 *   live/monophonic: oscillators with a `note` attribute follow the last
 *   held note and every <wcs-env> gates on note-on/off.
 * - <wcs-keys> (virtual/computer keyboard) and <wcs-midi> (Web MIDI) send
 *   noteOn/noteOff to their nearest <wcs-synth> (or the one named by for=).
 */

// ---------------------------------------------------------------- helpers

const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);

const num = (v, dflt) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
};

const attrNum = (el, name, dflt) => num(el.getAttribute(name), dflt);

const warn = (el, msg) => console.warn(`[wcs-synth] ${msg}`, el);

const AUDIO_TAGS = new Set([
  "WCS-OSC", "WCS-NOISE", "WCS-FILTER", "WCS-GAIN", "WCS-MIXER",
  "WCS-DELAY", "WCS-SHAPER", "WCS-ENV", "WCS-LFO", "WCS-SCOPE",
]);
const CONTROL_TAGS = new Set(["WCS-KEYS", "WCS-MIDI"]);

/** Direct "graph children" of a host element: descend through plain HTML
 *  (div/label/...) but stop at synth tags so they can nest their own chains. */
function collectGraphChildren(host) {
  const found = [];
  const scan = (node) => {
    for (const c of node.children) {
      if (AUDIO_TAGS.has(c.tagName) || c.tagName === "WCS-VOICE") found.push(c);
      else if (!CONTROL_TAGS.has(c.tagName) && c.tagName !== "WCS-SYNTH") scan(c);
    }
  };
  scan(host);
  return found;
}

const isModulatorEl = (el) =>
  el.hasAttribute("param") || el.tagName === "WCS-LFO";

const isMasterScope = (el) =>
  el.tagName === "WCS-SCOPE" && el.hasAttribute("master");

function setOscNote(inst, freq, t, initial) {
  const f = freq * 2 ** ((inst.transpose ?? 0) / 12);
  const p = inst.params.frequency;
  if (initial) {
    p.value = f;
  } else if (inst.glide > 0) {
    p.setTargetAtTime(f, t, inst.glide / 3);
  } else {
    p.setValueAtTime(f, t);
  }
}

// ---------------------------------------------------------------- base class

class WcsAudioEl extends HTMLElement {
  /** attr name -> default value; instance.params[attr] must be an AudioParam */
  static paramAttrs = {};
  /** attr name -> (inst, value) => void */
  static propAttrs = {};
  /** attrs that change the graph topology -> full rebuild */
  static wiringAttrs = ["out", "param", "note", "master"];

  static get observedAttributes() {
    return [
      ...Object.keys(this.paramAttrs),
      ...Object.keys(this.propAttrs),
      ...this.wiringAttrs,
    ];
  }

  connectedCallback() {
    this.closest("wcs-synth")?._scheduleBuild();
  }

  attributeChangedCallback(name, oldV, newV) {
    if (oldV === newV) return;
    const ctor = this.constructor;
    if (name in ctor.paramAttrs) {
      for (const inst of this._instances ?? []) {
        const p = inst.params[name];
        if (p) p.setTargetAtTime(num(newV, ctor.paramAttrs[name]), inst.ctx.currentTime, 0.02);
      }
    } else if (name in ctor.propAttrs) {
      for (const inst of this._instances ?? []) ctor.propAttrs[name](inst, newV);
    } else {
      this.closest("wcs-synth")?._scheduleBuild();
    }
  }

  /** subclass hook: return {input?, output?, params, nodes, sources?, gate?, onDispose?} */
  _build(_ctx) {
    throw new Error("_build not implemented");
  }

  _createInstance(ctx) {
    const inst = this._build(ctx);
    inst.ctx = ctx;
    inst.el = this;
    inst.params ??= {};
    const ctor = this.constructor;
    for (const [name, dflt] of Object.entries(ctor.paramAttrs)) {
      const p = inst.params[name];
      if (p) p.value = attrNum(this, name, dflt);
    }
    for (const name of Object.keys(ctor.propAttrs)) {
      if (this.hasAttribute(name)) ctor.propAttrs[name](inst, this.getAttribute(name));
    }
    (this._instances ??= new Set()).add(inst);
    inst.dispose = () => {
      this._instances.delete(inst);
      inst.onDispose?.();
      for (const s of inst.sources ?? []) { try { s.stop(); } catch { /* already stopped */ } }
      for (const n of inst.nodes ?? []) { try { n.disconnect(); } catch { /* detached */ } }
    };
    return inst;
  }
}

// ---------------------------------------------------------------- sources

class WcsOsc extends WcsAudioEl {
  static paramAttrs = { frequency: 440, detune: 0 };
  static propAttrs = {
    type: (inst, v) => { try { inst.osc.type = v; } catch { /* invalid type */ } },
    glide: (inst, v) => { inst.glide = Math.max(num(v, 0), 0); },
    transpose: (inst, v) => { inst.transpose = num(v, 0); },
  };

  _build(ctx) {
    const osc = ctx.createOscillator();
    osc.start();
    return {
      output: osc, osc,
      params: { frequency: osc.frequency, detune: osc.detune },
      sources: [osc], nodes: [osc],
      glide: 0, transpose: 0,
    };
  }
}

class WcsNoise extends WcsAudioEl {
  static buffers = new WeakMap(); // ctx -> AudioBuffer

  _build(ctx) {
    let buf = WcsNoise.buffers.get(ctx);
    if (!buf) {
      buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      WcsNoise.buffers.set(ctx, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return { output: src, sources: [src], nodes: [src] };
  }
}

// ---------------------------------------------------------------- processors

class WcsFilter extends WcsAudioEl {
  static paramAttrs = { frequency: 1000, q: 1, gain: 0, detune: 0 };
  static propAttrs = {
    type: (inst, v) => { try { inst.filter.type = v; } catch { /* invalid type */ } },
  };

  _build(ctx) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    return {
      input: filter, output: filter, filter,
      params: { frequency: filter.frequency, q: filter.Q, gain: filter.gain, detune: filter.detune },
      nodes: [filter],
    };
  }
}

class WcsGain extends WcsAudioEl {
  static paramAttrs = { gain: 1 };

  _build(ctx) {
    const g = ctx.createGain();
    return { input: g, output: g, params: { gain: g.gain }, nodes: [g] };
  }
}

/** Semantic alias of <wcs-gain>: a named bus that other chains out= into. */
class WcsMixer extends WcsGain {}

class WcsDelay extends WcsAudioEl {
  static paramAttrs = { time: 0.3, feedback: 0.3 };
  static propAttrs = {
    mix: (inst, v) => {
      const m = Math.min(Math.max(num(v, 0.5), 0), 1);
      inst.wet.gain.value = m;
      inst.dry.gain.value = 1 - m;
    },
  };

  _build(ctx) {
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
      input, output, wet, dry,
      params: { time: delay.delayTime, feedback: fb.gain },
      nodes: [input, delay, fb, wet, dry, output],
    };
  }
}

class WcsShaper extends WcsAudioEl {
  static propAttrs = {
    amount: (inst, v) => { inst.shaper.curve = WcsShaper.curve(num(v, 20)); },
  };

  static curve(k) {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return c;
  }

  _build(ctx) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = WcsShaper.curve(20);
    shaper.oversample = "2x";
    return { input: shaper, output: shaper, shaper, nodes: [shaper] };
  }
}

// ---------------------------------------------------------------- modulators

/**
 * ADSR envelope. Two roles, decided by attributes:
 * - in the chain (no param=): a VCA — a GainNode whose gain follows the ADSR.
 * - with param= : a modulator — ConstantSource scaled by depth, ADSR-shaped,
 *   connected to the parent's (or `param="id.name"` target's) AudioParam.
 */
class WcsEnv extends WcsAudioEl {
  static propAttrs = {
    attack: (inst, v) => { inst.adsr.a = Math.max(num(v, 0.01), 0.001); },
    decay: (inst, v) => { inst.adsr.d = Math.max(num(v, 0.1), 0.001); },
    sustain: (inst, v) => { inst.adsr.s = Math.min(Math.max(num(v, 0.7), 0), 1); },
    release: (inst, v) => { inst.adsr.r = Math.max(num(v, 0.3), 0.001); },
    depth: (inst, v) => { inst.adsr.depth = num(v, 1); },
  };

  _build(ctx) {
    const g = ctx.createGain();
    g.gain.value = 0;
    const inst = {
      envParam: g.gain,
      adsr: { a: 0.01, d: 0.1, s: 0.7, r: 0.3, depth: 1 },
      nodes: [g],
    };
    if (isModulatorEl(this)) {
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
  }
}

/** LFO: always a modulator. rate in Hz, depth in the target param's units. */
class WcsLfo extends WcsAudioEl {
  static paramAttrs = { rate: 5, depth: 10 };
  static propAttrs = {
    type: (inst, v) => { try { inst.osc.type = v; } catch { /* invalid type */ } },
  };

  _build(ctx) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g);
    osc.start();
    return {
      output: g, osc,
      params: { rate: osc.frequency, depth: g.gain },
      sources: [osc], nodes: [osc, g],
    };
  }
}

// ---------------------------------------------------------------- scope

class WcsScope extends WcsAudioEl {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        canvas { display: block; width: 100%; height: 100%;
                 background: #0b0f14; border-radius: 6px; }
      </style>
      <canvas width="600" height="120"></canvas>`;
    this._canvas = this.shadowRoot.querySelector("canvas");
  }

  connectedCallback() {
    super.connectedCallback();
    this._raf = requestAnimationFrame(this._draw);
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
  }

  _build(ctx) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    // Keep the analyser inside an always-pulled path: a sink-only analyser
    // can silently drop out of the rendering graph in Chromium (notably when
    // connected while the context is still suspended).
    const mute = ctx.createGain();
    mute.gain.value = 0;
    analyser.connect(mute).connect(ctx.destination);
    this._analyser = analyser; // latest instance wins the display
    return {
      input: analyser, output: analyser, analyser, nodes: [analyser, mute],
      onDispose: () => { if (this._analyser === analyser) this._analyser = null; },
    };
  }

  _draw = () => {
    this._raf = requestAnimationFrame(this._draw);
    const c = this._canvas;
    const g = c.getContext("2d");
    g.fillStyle = "#0b0f14";
    g.fillRect(0, 0, c.width, c.height);
    const an = this._analyser;
    g.strokeStyle = "#3ddc84";
    g.lineWidth = 2;
    if (!an) {
      g.beginPath();
      g.moveTo(0, c.height / 2);
      g.lineTo(c.width, c.height / 2);
      g.stroke();
      return;
    }
    if (this.getAttribute("mode") === "fft") {
      const data = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(data);
      const bars = 64;
      const step = Math.floor(data.length / bars);
      const bw = c.width / bars;
      g.fillStyle = "#3ddc84";
      for (let i = 0; i < bars; i++) {
        const v = data[i * step] / 255;
        g.fillRect(i * bw + 1, c.height * (1 - v), bw - 2, c.height * v);
      }
    } else {
      const data = new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(data);
      g.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * c.width;
        const y = (data[i] / 255) * c.height;
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
  };
}

// ---------------------------------------------------------------- voice

/** Polyphonic voice allocator: its subtree is a patch template, one audio
 *  graph instance per held note. */
class WcsVoice extends HTMLElement {
  _active = [];

  connectedCallback() {
    this.closest("wcs-synth")?._scheduleBuild();
  }

  _noteOn(synth, midi, vel) {
    const ctx = synth.ctx;
    const t = ctx.currentTime;
    for (const v of [...this._active]) {
      if (v.midi === midi && !v.released) this._release(v, t);
    }
    const poly = Math.max(attrNum(this, "poly", 8), 1);
    while (this._active.filter((v) => !v.released).length >= poly) {
      const oldest = this._active.find((v) => !v.released);
      if (!oldest) break;
      this._kill(oldest, ctx);
    }

    const vGain = ctx.createGain();
    const scope = synth._buildScope(this, vGain, true);
    if (scope.defaultDestUsed) vGain.connect(synth.master);
    for (const target of scope.externalTargets) vGain.connect(target);

    const freq = midiToFreq(midi);
    let followers = scope.noteOscs;
    if (followers.length === 0) {
      followers = [...scope.instMap].filter(([el]) => el.tagName === "WCS-OSC").map(([, i]) => i);
    }
    for (const inst of followers) setOscNote(inst, freq, t, true);

    const voice = { midi, scope, vGain, released: false, disposed: false };
    if (scope.gates.length > 0) {
      vGain.gain.value = 1;
      for (const g of scope.gates) g.on(t, vel);
    } else {
      // implicit safety envelope so a gateless patch doesn't sustain forever
      vGain.gain.value = 0;
      vGain.gain.setValueAtTime(0, t);
      vGain.gain.linearRampToValueAtTime(vel, t + 0.005);
    }
    this._active.push(voice);
  }

  _noteOff(synth, midi) {
    const t = synth.ctx.currentTime;
    for (const v of this._active) {
      if (v.midi === midi && !v.released) this._release(v, t);
    }
  }

  _release(v, t) {
    v.released = true;
    let rel = 0.08;
    if (v.scope.gates.length > 0) {
      for (const g of v.scope.gates) g.off(t);
      rel = Math.max(...v.scope.gates.map((g) => g.release()), rel);
    } else {
      v.vGain.gain.setTargetAtTime(0, t, rel / 3);
    }
    setTimeout(() => this._dispose(v), (rel * 3 + 0.3) * 1000);
  }

  _kill(v, ctx) {
    const t = ctx.currentTime;
    v.released = true;
    v.vGain.gain.cancelScheduledValues(t);
    v.vGain.gain.setTargetAtTime(0, t, 0.01);
    setTimeout(() => this._dispose(v), 80);
  }

  _dispose(v) {
    if (v.disposed) return;
    v.disposed = true;
    for (const inst of v.scope.instMap.values()) inst.dispose();
    try { v.vGain.disconnect(); } catch { /* detached */ }
    this._active = this._active.filter((x) => x !== v);
  }

  _panic() {
    for (const v of [...this._active]) this._dispose(v);
  }
}

// ---------------------------------------------------------------- synth root

class WcsSynth extends HTMLElement {
  static get observedAttributes() {
    return ["volume"];
  }

  ctx = null;
  master = null;
  _live = null;
  _voices = [];
  _held = [];

  connectedCallback() {
    if (!this._mo) {
      this._mo = new MutationObserver(() => this._scheduleBuild());
      this._mo.observe(this, { childList: true, subtree: true });
    }
    this._scheduleBuild();
    WcsSynth._hookGesture();
  }

  disconnectedCallback() {
    this._mo?.disconnect();
    this._mo = null;
    this._teardownGraph();
  }

  attributeChangedCallback(name, _o, v) {
    if (name === "volume" && this.master) {
      this.master.gain.setTargetAtTime(num(v, 0.8), this.ctx.currentTime, 0.02);
    }
  }

  /** AudioContext needs a user gesture: resume it on the first one. */
  static _hookGesture() {
    if (WcsSynth._gestureHooked) return;
    WcsSynth._gestureHooked = true;
    const resume = () => WcsSynth._sharedCtx?.resume();
    document.addEventListener("pointerdown", resume, { capture: true });
    document.addEventListener("keydown", resume, { capture: true });
  }

  /** One AudioContext shared by every <wcs-synth> on the page (browsers cap
   *  concurrent contexts); each synth keeps its own master gain + limiter. */
  _ensureCtx() {
    if (this.ctx) return;
    if (!WcsSynth._sharedCtx) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      WcsSynth._sharedCtx = ctx;
      // Edges into an AnalyserNode wired while the context is still suspended
      // can stay silent in Chromium; re-kick the master taps once running.
      ctx.addEventListener("statechange", () => {
        if (ctx.state !== "running") return;
        for (const s of document.querySelectorAll("wcs-synth")) {
          for (const tap of s._masterTaps ?? []) {
            try { s.master.disconnect(tap); } catch { /* not connected */ }
            s.master.connect(tap);
          }
        }
      });
    }
    this.ctx = WcsSynth._sharedCtx;
    this.master = this.ctx.createGain();
    this.master.gain.value = attrNum(this, "volume", 0.8);
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    this.master.connect(comp).connect(this.ctx.destination);
  }

  _scheduleBuild() {
    if (this._buildQueued) return;
    this._buildQueued = true;
    setTimeout(() => {
      this._buildQueued = false;
      if (this.isConnected) this._rebuild();
    }, 0);
  }

  _rebuild() {
    this._ensureCtx();
    this._teardownGraph();
    const scope = this._buildScope(this, this.master, false);
    this._live = scope;
    this._voices = scope.voices;
    this._masterTaps = [];
    for (const [el, inst] of scope.instMap) {
      if (isMasterScope(el)) {
        this.master.connect(inst.input);
        this._masterTaps.push(inst.input);
      }
    }
  }

  _teardownGraph() {
    for (const v of this._voices) v._panic();
    for (const tap of this._masterTaps ?? []) {
      try { this.master.disconnect(tap); } catch { /* already gone */ }
    }
    this._masterTaps = [];
    if (this._live) {
      for (const inst of this._live.instMap.values()) inst.dispose();
    }
    this._live = null;
    this._voices = [];
    this._held = [];
  }

  /**
   * Build an audio graph from the DOM below rootEl (two passes: instantiate
   * along the nesting, then resolve id-based out=/param= wires).
   * In a voice scope, audio leaving the voice is funneled through `dest`
   * (the per-voice gain) so note stealing can fade the whole voice.
   */
  _buildScope(rootEl, dest, isVoice) {
    const ctx = this.ctx;
    const scope = {
      instMap: new Map(),
      gates: [],
      noteOscs: [],
      voices: [],
      defaultDestUsed: false,
      externalTargets: new Set(),
    };
    const wires = [];

    const lookup = (id) => {
      const el = this.querySelector(`#${CSS.escape(id)}`);
      if (!el) return null;
      return { el, inst: scope.instMap.get(el) ?? this._live?.instMap.get(el) ?? null };
    };

    const connectAudioTo = (inst, id, srcEl) => {
      const target = lookup(id);
      if (!target?.inst?.input) {
        warn(srcEl, `out="${id}": no reachable audio input with that id`);
        return;
      }
      const external = isVoice && !scope.instMap.has(target.el);
      if (external) {
        inst.output.connect(dest);
        scope.externalTargets.add(target.inst.input);
      } else {
        inst.output.connect(target.inst.input);
      }
    };

    const connectParamTo = (inst, spec, srcEl) => {
      const dot = spec.indexOf(".");
      const target = lookup(spec.slice(0, dot));
      const p = target?.inst?.params?.[spec.slice(dot + 1)];
      if (!p) {
        warn(srcEl, `"${spec}": no reachable AudioParam with that id.name`);
        return;
      }
      inst.output.connect(p);
    };

    const processEl = (el, parentInst) => {
      if (el.tagName === "WCS-VOICE") {
        if (isVoice) warn(el, "nested <wcs-voice> is not supported; ignored");
        else scope.voices.push(el);
        return;
      }
      const inst = el._createInstance(ctx);
      scope.instMap.set(el, inst);
      const isMod = isModulatorEl(el);
      const masterScope = isMasterScope(el);

      if (!isMod && !masterScope && parentInst?.output && inst.input) {
        parentInst.output.connect(inst.input);
      }

      if (isMod) {
        const spec = el.getAttribute("param");
        if (spec && spec.includes(".")) {
          wires.push(() => connectParamTo(inst, spec, el));
        } else if (spec) {
          const p = parentInst?.params?.[spec];
          if (p) inst.output.connect(p);
          else warn(el, `param="${spec}": parent has no such AudioParam`);
        } else if (!el.hasAttribute("out")) {
          warn(el, "modulator needs param= (or out=\"id.param\")");
        }
      }

      if (inst.gate) scope.gates.push(inst.gate);
      if (el.tagName === "WCS-OSC" && el.hasAttribute("note")) scope.noteOscs.push(inst);

      const kids = collectGraphChildren(el);
      let chainKids = 0;
      for (const k of kids) {
        if (k.tagName !== "WCS-VOICE" && !isModulatorEl(k) && !isMasterScope(k)) chainKids++;
        processEl(k, inst);
      }

      const outAttr = el.getAttribute("out");
      if (outAttr && inst.output) {
        for (const ref of outAttr.trim().split(/\s+/)) {
          if (ref.includes(".")) wires.push(() => connectParamTo(inst, ref, el));
          else wires.push(() => connectAudioTo(inst, ref, el));
        }
      }
      if (!isMod && !masterScope && inst.output && chainKids === 0 && !outAttr) {
        inst.output.connect(dest);
        scope.defaultDestUsed = true;
      }
    };

    for (const child of collectGraphChildren(rootEl)) processEl(child, null);
    for (const wire of wires) wire();
    return scope;
  }

  // ------------------------------------------------------------ note API

  noteOn(midi, vel = 1) {
    this._ensureCtx();
    this.ctx.resume();
    const t = this.ctx.currentTime;
    for (const v of this._voices) v._noteOn(this, midi, vel);
    if (this._live) {
      this._held = this._held.filter((m) => m !== midi);
      this._held.push(midi);
      const freq = midiToFreq(midi);
      for (const inst of this._live.noteOscs) setOscNote(inst, freq, t, false);
      for (const g of this._live.gates) g.on(t, vel);
    }
    this.dispatchEvent(new CustomEvent("wcs-noteon", { detail: { midi, vel } }));
  }

  noteOff(midi) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this._voices) v._noteOff(this, midi);
    if (this._live) {
      const wasTop = this._held[this._held.length - 1] === midi;
      this._held = this._held.filter((m) => m !== midi);
      if (this._held.length === 0) {
        for (const g of this._live.gates) g.off(t);
      } else if (wasTop) {
        const freq = midiToFreq(this._held[this._held.length - 1]);
        for (const inst of this._live.noteOscs) setOscNote(inst, freq, t, false);
      }
    }
    this.dispatchEvent(new CustomEvent("wcs-noteoff", { detail: { midi } }));
  }

  allNotesOff() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this._voices) v._panic();
    for (const g of this._live?.gates ?? []) g.off(t);
    this._held = [];
  }
}

// ---------------------------------------------------------------- keyboard

/** Semitone offsets from the base C for computer-keyboard play (A = C). */
const KEY_OFFSETS = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13,
  KeyL: 14, KeyP: 15, Semicolon: 16,
};
const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11];

class WcsKeys extends HTMLElement {
  static get observedAttributes() {
    return ["octaves", "octave"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._kbShift = 0;
    this._kbHeld = new Map(); // e.code -> midi
    this._ptrHeld = new Map(); // pointerId -> midi
  }

  connectedCallback() {
    this._render();
    if (this.getAttribute("keyboard") !== "off") {
      window.addEventListener("keydown", this._onKeyDown);
      window.addEventListener("keyup", this._onKeyUp);
      window.addEventListener("blur", this._onBlur);
    }
  }

  disconnectedCallback() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._onBlur);
    this._releaseAll();
  }

  attributeChangedCallback(_n, oldV, newV) {
    if (oldV === newV) return;
    this._releaseAll();
    if (this.isConnected) this._render();
  }

  _synth() {
    const id = this.getAttribute("for");
    const target = id ? document.getElementById(id) : this.closest("wcs-synth");
    return target ?? document.querySelector("wcs-synth");
  }

  get _baseMidi() {
    return 12 * (attrNum(this, "octave", 4) + 1);
  }

  _render() {
    const octaves = Math.max(attrNum(this, "octaves", 2), 1);
    const base = this._baseMidi;
    const count = octaves * 12 + 1; // include the top C
    const whites = [];
    const blacks = [];
    let whitesBefore = 0;
    for (let i = 0; i < count; i++) {
      const midi = base + i;
      if (WHITE_SEMIS.includes(i % 12)) {
        whites.push({ midi, label: i % 12 === 0 ? `C${Math.floor(midi / 12) - 1}` : "" });
        whitesBefore++;
      } else {
        blacks.push({ midi, whitesBefore });
      }
    }
    const whiteW = 100 / whites.length;
    const blackW = whiteW * 0.6;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; user-select: none; touch-action: none; }
        .kb { position: relative; display: flex; height: 130px;
              background: #111; border-radius: 6px; padding: 4px; gap: 1px; }
        .key { box-sizing: border-box; cursor: pointer; }
        .key.white { flex: 1; background: linear-gradient(#ffffff, #e8e8e8);
                     border: 1px solid #222; border-radius: 0 0 4px 4px;
                     display: flex; align-items: flex-end; justify-content: center;
                     font: 10px/1.6 system-ui, sans-serif; color: #999; }
        .key.black { position: absolute; top: 4px; height: 58%; background: #1c1c1c;
                     border: 1px solid #000; border-radius: 0 0 3px 3px; z-index: 2; }
        .key.white.active { background: #ffd54f; }
        .key.black.active { background: #ff8f00; }
      </style>
      <div class="kb">
        ${whites.map((k) => `<div class="key white" data-midi="${k.midi}">${k.label}</div>`).join("")}
        ${blacks.map((k) =>
          `<div class="key black" data-midi="${k.midi}" style="left:calc(${(k.whitesBefore * whiteW).toFixed(4)}% - ${(blackW / 2).toFixed(4)}%);width:${blackW.toFixed(4)}%"></div>`,
        ).join("")}
      </div>`;
    const kb = this.shadowRoot.querySelector(".kb");
    kb.addEventListener("pointerdown", this._onPointerDown);
    kb.addEventListener("pointermove", this._onPointerMove);
    kb.addEventListener("pointerup", this._onPointerUp);
    kb.addEventListener("pointercancel", this._onPointerUp);
  }

  _keyAt(x, y) {
    return this.shadowRoot.elementFromPoint(x, y)?.closest?.(".key") ?? null;
  }

  _press(midi) {
    this._synth()?.noteOn(midi, 0.9);
    this._light(midi, true);
  }

  _lift(midi) {
    this._synth()?.noteOff(midi);
    this._light(midi, false);
  }

  _light(midi, on) {
    const key = this.shadowRoot.querySelector(`.key[data-midi="${midi}"]`);
    key?.classList.toggle("active", on);
  }

  _onPointerDown = (e) => {
    const key = this._keyAt(e.clientX, e.clientY);
    if (!key) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const midi = Number(key.dataset.midi);
    this._ptrHeld.set(e.pointerId, midi);
    this._press(midi);
  };

  _onPointerMove = (e) => {
    if (!this._ptrHeld.has(e.pointerId)) return;
    const key = this._keyAt(e.clientX, e.clientY);
    const midi = key ? Number(key.dataset.midi) : null;
    const prev = this._ptrHeld.get(e.pointerId);
    if (midi === prev) return;
    this._lift(prev);
    if (midi !== null) {
      this._ptrHeld.set(e.pointerId, midi);
      this._press(midi);
    } else {
      this._ptrHeld.delete(e.pointerId);
    }
  };

  _onPointerUp = (e) => {
    const midi = this._ptrHeld.get(e.pointerId);
    if (midi === undefined) return;
    this._ptrHeld.delete(e.pointerId);
    this._lift(midi);
  };

  _onKeyDown = (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.code === "KeyZ") { this._shiftOctave(-1); return; }
    if (e.code === "KeyX") { this._shiftOctave(1); return; }
    const offset = KEY_OFFSETS[e.code];
    if (offset === undefined || this._kbHeld.has(e.code)) return;
    const midi = this._baseMidi + 12 * this._kbShift + offset;
    this._kbHeld.set(e.code, midi);
    this._press(midi);
  };

  _onKeyUp = (e) => {
    const midi = this._kbHeld.get(e.code);
    if (midi === undefined) return;
    this._kbHeld.delete(e.code);
    this._lift(midi);
  };

  _onBlur = () => this._releaseAll();

  _shiftOctave(delta) {
    this._kbShift = Math.min(Math.max(this._kbShift + delta, -3), 3);
    this._releaseAll();
  }

  _releaseAll() {
    for (const midi of this._kbHeld.values()) this._lift(midi);
    for (const midi of this._ptrHeld.values()) this._lift(midi);
    this._kbHeld.clear();
    this._ptrHeld.clear();
  }
}

// ---------------------------------------------------------------- MIDI

class WcsMidi extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: inline-block; font: 12px/1.8 system-ui, sans-serif;
                color: #8aa; }
      </style>
      <span></span>`;
  }

  connectedCallback() {
    if (!navigator.requestMIDIAccess) {
      this._status("MIDI: not supported");
      return;
    }
    this._status("MIDI: requesting…");
    navigator.requestMIDIAccess({ sysex: false }).then(
      (access) => {
        this._access = access;
        access.onstatechange = () => this._hookInputs();
        this._hookInputs();
      },
      () => this._status("MIDI: access denied"),
    );
  }

  disconnectedCallback() {
    if (this._access) {
      this._access.onstatechange = null;
      for (const input of this._access.inputs.values()) input.onmidimessage = null;
    }
  }

  _status(text) {
    this.shadowRoot.querySelector("span").textContent = text;
  }

  _synth() {
    const id = this.getAttribute("for");
    const target = id ? document.getElementById(id) : this.closest("wcs-synth");
    return target ?? document.querySelector("wcs-synth");
  }

  _hookInputs() {
    const inputs = [...this._access.inputs.values()];
    for (const input of inputs) input.onmidimessage = (e) => this._onMessage(e);
    this._status(inputs.length === 0 ? "MIDI: no inputs" : `MIDI: ${inputs.map((i) => i.name).join(", ")}`);
  }

  _onMessage(e) {
    const [status, d1, d2] = e.data;
    const cmd = status & 0xf0;
    const channel = this.getAttribute("channel");
    if (channel !== null && (status & 0x0f) !== Number(channel) - 1) return;
    if (cmd === 0x90 && d2 > 0) this._synth()?.noteOn(d1, d2 / 127);
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) this._synth()?.noteOff(d1);
  }
}

// ---------------------------------------------------------------- register

const DEFINITIONS = {
  "wcs-synth": WcsSynth,
  "wcs-voice": WcsVoice,
  "wcs-osc": WcsOsc,
  "wcs-noise": WcsNoise,
  "wcs-filter": WcsFilter,
  "wcs-gain": WcsGain,
  "wcs-mixer": WcsMixer,
  "wcs-delay": WcsDelay,
  "wcs-shaper": WcsShaper,
  "wcs-env": WcsEnv,
  "wcs-lfo": WcsLfo,
  "wcs-scope": WcsScope,
  "wcs-keys": WcsKeys,
  "wcs-midi": WcsMidi,
};

// Chain tags render nothing themselves; display:contents keeps any UI tags
// nested inside them (scope, keys) in normal page flow.
const style = document.createElement("style");
style.textContent =
  "wcs-synth{display:block}" +
  "wcs-voice,wcs-osc,wcs-noise,wcs-filter,wcs-gain,wcs-mixer,wcs-delay,wcs-shaper,wcs-env,wcs-lfo{display:contents}";
document.head.append(style);

for (const [tag, ctor] of Object.entries(DEFINITIONS)) {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}

export {
  WcsSynth, WcsVoice, WcsOsc, WcsNoise, WcsFilter, WcsGain, WcsMixer,
  WcsDelay, WcsShaper, WcsEnv, WcsLfo, WcsScope, WcsKeys, WcsMidi,
};
