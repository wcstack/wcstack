/**
 * Headless stand-in for a BaseAudioContext, covering exactly the surface
 * AudioGraphCore touches. happy-dom implements no Web Audio at all.
 *
 * Two things it does that a bare stub would not:
 *
 * - **records the connection topology**, so a test can assert the shape of the
 *   graph rather than poke at internals. The Phase B PoC verified that the edge
 *   set produced here is identical to the one a real `OfflineAudioContext`
 *   produces from the same patch, which is what licenses using it for structure
 *   and leaving audible signal to the browser tests.
 * - **records AudioParam automation**, so an envelope is asserted as a schedule
 *   of calls rather than as a waveform.
 */

let nextId = 0;

export class FakeAudioParam {
  value: number;
  readonly calls: [string, ...number[]][] = [];
  readonly label: string;

  constructor(value = 0, label = "") {
    this.value = value;
    this.label = label;
  }

  setValueAtTime(v: number, t: number): this { this.calls.push(["setValueAtTime", v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v: number, t: number): this { this.calls.push(["linearRampToValueAtTime", v, t]); this.value = v; return this; }
  setTargetAtTime(v: number, t: number, tau: number): this { this.calls.push(["setTargetAtTime", v, t, tau]); this.value = v; return this; }
  cancelScheduledValues(t: number): this { this.calls.push(["cancelScheduledValues", t]); return this; }

  /** Names of the automation methods called, in order. */
  get names(): string[] { return this.calls.map((c) => c[0]); }
}

export class FakeNode {
  readonly label: string;
  readonly context: FakeAudioContext;
  readonly outgoing = new Set<FakeNode | FakeAudioParam>();
  disconnected = false;

  constructor(ctx: FakeAudioContext, kind: string) {
    this.context = ctx;
    this.label = `${kind}#${++nextId}`;
  }

  connect<T extends FakeNode | FakeAudioParam>(dest: T): T {
    this.outgoing.add(dest);
    this.context.edges.add(`${this.label} -> ${(dest as any).label}`);
    return dest;
  }

  disconnect(dest?: FakeNode | FakeAudioParam): void {
    if (dest === undefined) {
      for (const d of this.outgoing) this.context.edges.delete(`${this.label} -> ${(d as any).label}`);
      this.outgoing.clear();
      this.disconnected = true;
      return;
    }
    this.outgoing.delete(dest);
    this.context.edges.delete(`${this.label} -> ${(dest as any).label}`);
  }
}

export class FakeSource extends FakeNode {
  started = false;
  stopped = false;
  start(): void { this.started = true; }
  stop(): void {
    // The real API throws when a source is stopped twice; the Core relies on
    // that being swallowed.
    if (this.stopped) throw new Error("already stopped");
    this.stopped = true;
  }
}

export class FakeAudioContext {
  readonly sampleRate: number;
  currentTime = 0;
  state: "suspended" | "running" | "closed" = "suspended";
  readonly destination: FakeNode;
  /** Every live connection, as `"osc#1 -> gain#2"` / `"lfo#3 -> biquad#4.frequency"`. */
  readonly edges = new Set<string>();
  readonly created: FakeNode[] = [];

  private _listeners = new Map<string, Set<() => void>>();
  /** Set to reject the next resume(), as a browser does before a gesture. */
  resumeRejection: Error | null = null;
  suspendRejection: Error | null = null;

  constructor({ sampleRate = 48000 }: { sampleRate?: number } = {}) {
    this.sampleRate = sampleRate;
    this.destination = new FakeNode(this, "destination");
  }

  /** Tests drive the audio clock by hand — no timers, fully deterministic. */
  advance(seconds: number): number {
    this.currentTime += seconds;
    return this.currentTime;
  }

  addEventListener(type: string, fn: () => void): void {
    let set = this._listeners.get(type);
    if (!set) this._listeners.set(type, (set = new Set()));
    set.add(fn);
  }

  removeEventListener(type: string, fn: () => void): void {
    this._listeners.get(type)?.delete(fn);
  }

  /** Flip the state and notify, as the real context does. */
  setState(state: "suspended" | "running" | "closed"): void {
    this.state = state;
    for (const fn of this._listeners.get("statechange") ?? []) fn();
  }

  resume(): Promise<void> {
    if (this.resumeRejection) return Promise.reject(this.resumeRejection);
    this.setState("running");
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    if (this.suspendRejection) return Promise.reject(this.suspendRejection);
    this.setState("suspended");
    return Promise.resolve();
  }

  private _track<T extends FakeNode>(node: T): T {
    this.created.push(node);
    return node;
  }

  createGain(): any {
    const n = this._track(new FakeNode(this, "gain")) as any;
    n.gain = new FakeAudioParam(1, `${n.label}.gain`);
    return n;
  }

  createOscillator(): any {
    const n = this._track(new FakeSource(this, "osc")) as any;
    n.type = "sine";
    n.frequency = new FakeAudioParam(440, `${n.label}.frequency`);
    n.detune = new FakeAudioParam(0, `${n.label}.detune`);
    return n;
  }

  createBiquadFilter(): any {
    const n = this._track(new FakeNode(this, "biquad")) as any;
    n.type = "lowpass";
    n.frequency = new FakeAudioParam(350, `${n.label}.frequency`);
    n.Q = new FakeAudioParam(1, `${n.label}.Q`);
    n.gain = new FakeAudioParam(0, `${n.label}.gain`);
    n.detune = new FakeAudioParam(0, `${n.label}.detune`);
    return n;
  }

  createDelay(max = 1): any {
    const n = this._track(new FakeNode(this, "delay")) as any;
    n.maxDelayTime = max;
    n.delayTime = new FakeAudioParam(0, `${n.label}.delayTime`);
    return n;
  }

  createWaveShaper(): any {
    const n = this._track(new FakeNode(this, "shaper")) as any;
    n.curve = null;
    n.oversample = "none";
    return n;
  }

  createConstantSource(): any {
    const n = this._track(new FakeSource(this, "const")) as any;
    n.offset = new FakeAudioParam(1, `${n.label}.offset`);
    return n;
  }

  createBufferSource(): any {
    const n = this._track(new FakeSource(this, "bufsrc")) as any;
    n.buffer = null;
    n.loop = false;
    return n;
  }

  createAnalyser(): any {
    const n = this._track(new FakeNode(this, "analyser")) as any;
    n.fftSize = 2048;
    n.smoothingTimeConstant = 0.8;
    Object.defineProperty(n, "frequencyBinCount", { get: () => n.fftSize / 2 });
    n.getByteTimeDomainData = (a: Uint8Array) => a.fill(128);
    n.getByteFrequencyData = (a: Uint8Array) => a.fill(7);
    return n;
  }

  createDynamicsCompressor(): any {
    const n = this._track(new FakeNode(this, "comp")) as any;
    n.threshold = new FakeAudioParam(-24, `${n.label}.threshold`);
    return n;
  }

  createBuffer(channels: number, length: number, sampleRate: number): any {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (i: number) => data[i] };
  }

  /** Stable, comparable snapshot of the current topology. */
  snapshot(): string[] {
    return [...this.edges].sort();
  }

  /** Every node of a kind, in creation order. */
  nodesOf(kind: string): FakeNode[] {
    return this.created.filter((n) => n.label.startsWith(`${kind}#`));
  }
}

/** Reset labels so each test's edge snapshot starts from `#1`. */
export function resetNodeIds(): void {
  nextId = 0;
}
