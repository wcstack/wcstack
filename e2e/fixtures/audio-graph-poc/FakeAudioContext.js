/**
 * Minimal headless stand-in for a BaseAudioContext, covering exactly the API
 * surface AudioGraphCore touches. Records AudioParam automation so envelope /
 * glide behavior can be asserted as a schedule rather than as a waveform.
 *
 * Phase C promotes this to packages/audio/__tests__/helpers/FakeAudioContext.ts.
 */

export class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }
  setValueAtTime(v, t) { this.calls.push(["setValueAtTime", v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.calls.push(["linearRampToValueAtTime", v, t]); this.value = v; return this; }
  setTargetAtTime(v, t, tau) { this.calls.push(["setTargetAtTime", v, t, tau]); this.value = v; return this; }
  cancelScheduledValues(t) { this.calls.push(["cancelScheduledValues", t]); return this; }
}

class FakeNode {
  constructor(ctx) {
    this.context = ctx;
    this.outgoing = new Set();
  }
  connect(dest) { this.outgoing.add(dest); return dest; }
  disconnect(dest) {
    if (dest === undefined) this.outgoing.clear();
    else this.outgoing.delete(dest);
  }
}

class FakeSource extends FakeNode {
  constructor(ctx) { super(ctx); this.started = false; this.stopped = false; }
  start() { this.started = true; }
  stop() {
    if (this.stopped) throw new Error("already stopped");
    this.stopped = true;
  }
}

export class FakeAudioContext {
  constructor({ sampleRate = 48000 } = {}) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = "suspended";
    this.destination = new FakeNode(this);
  }

  /** Tests drive the audio clock by hand — no timers, fully deterministic. */
  advance(seconds) { this.currentTime += seconds; return this.currentTime; }

  createGain() {
    const n = new FakeNode(this);
    n.gain = new FakeAudioParam(1);
    return n;
  }

  createOscillator() {
    const n = new FakeSource(this);
    n.type = "sine";
    n.frequency = new FakeAudioParam(440);
    n.detune = new FakeAudioParam(0);
    return n;
  }

  createBiquadFilter() {
    const n = new FakeNode(this);
    n.type = "lowpass";
    n.frequency = new FakeAudioParam(350);
    n.Q = new FakeAudioParam(1);
    n.gain = new FakeAudioParam(0);
    n.detune = new FakeAudioParam(0);
    return n;
  }

  createDelay(max = 1) {
    const n = new FakeNode(this);
    n.maxDelayTime = max;
    n.delayTime = new FakeAudioParam(0);
    return n;
  }

  createWaveShaper() {
    const n = new FakeNode(this);
    n.curve = null;
    n.oversample = "none";
    return n;
  }

  createConstantSource() {
    const n = new FakeSource(this);
    n.offset = new FakeAudioParam(1);
    return n;
  }

  createBufferSource() {
    const n = new FakeSource(this);
    n.buffer = null;
    n.loop = false;
    n.playbackRate = new FakeAudioParam(1);
    n.detune = new FakeAudioParam(0);
    return n;
  }

  createAnalyser() {
    const n = new FakeNode(this);
    n.fftSize = 2048;
    n.smoothingTimeConstant = 0.8;
    Object.defineProperty(n, "frequencyBinCount", { get: () => n.fftSize / 2 });
    n.getByteTimeDomainData = (a) => a.fill(128);
    n.getByteFrequencyData = (a) => a.fill(0);
    return n;
  }

  createDynamicsCompressor() {
    const n = new FakeNode(this);
    n.threshold = new FakeAudioParam(-24);
    n.knee = new FakeAudioParam(30);
    n.ratio = new FakeAudioParam(12);
    n.attack = new FakeAudioParam(0.003);
    n.release = new FakeAudioParam(0.25);
    return n;
  }

  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (i) => data[i] };
  }
}
