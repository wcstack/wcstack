import { AudioNodeKind, IWcBindable } from "../types.js";
import { AudioNodeShell, defineParamAccessors, nodeInputs } from "./AudioNodeShell.js";

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
function defineNode(
  kind: AudioNodeKind,
  params: Record<string, number>,
  props: readonly string[],
): typeof AudioNodeShell {
  class Node extends AudioNodeShell {
    static kind = kind;
    static params = params;
    static props = props;
    static wcBindable: IWcBindable = {
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
export class WcsOsc extends defineNode(
  "osc",
  { frequency: 440, detune: 0 },
  ["type", "glide", "transpose"],
) {}

/** Looped white noise (`AudioBufferSourceNode`), shared per context. */
export class WcsNoise extends defineNode("noise", {}, []) {}

/** `BiquadFilterNode`. Named for the node, not for "filter" — which means
 *  something else entirely in `@wcstack/state`. */
export class WcsBiquad extends defineNode(
  "biquad",
  { frequency: 1000, q: 1, gain: 0, detune: 0 },
  ["type"],
) {}

/** `GainNode`. Also the named bus other chains route into with `out="…"`. */
export class WcsGain extends defineNode("gain", { gain: 1 }, []) {}

/** `DelayNode` with feedback and a dry/wet mix. */
export class WcsDelay extends defineNode(
  "delay",
  { time: 0.3, feedback: 0.3 },
  ["mix"],
) {}

/** `WaveShaperNode` with a soft-clipping curve; `amount` is the drive. */
export class WcsShaper extends defineNode("shaper", {}, ["amount"]) {}

/** ADSR envelope. In the chain it is a VCA; with `param` it shapes a parameter. */
export class WcsEnv extends defineNode(
  "env",
  {},
  ["attack", "decay", "sustain", "release", "depth"],
) {}

/** Low-frequency oscillator — always a modulator, never in the signal chain. */
export class WcsLfo extends defineNode(
  "lfo",
  { rate: 5, depth: 10 },
  ["type"],
) {}

/**
 * `AnalyserNode`. Produces data only — drawing is the page's job (ADR-14 G6:
 * I/O nodes carry no rendering).
 *
 * The read is a command rather than a stream, so the frame loop closes through
 * the protocols already in place: `<wcs-raf>` ticks → the state fires
 * `command.sample` → this element dispatches `frame`. Nothing here owns a
 * rAF loop, which would duplicate `@wcstack/raf`.
 */
export class WcsAnalyser extends defineNode("analyser", {}, ["fft", "smoothing"]) {
  static wcBindable: IWcBindable = {
    protocol: "wc-bindable",
    version: 1,
    // An occurrence, not a value: every frame is a distinct reading.
    properties: [
      { name: "frame", event: "wcs-analyser:frame", semantics: "event", getter: (e: Event) => (e as CustomEvent).detail },
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
  sample(mode: "wave" | "fft" = "wave"): Uint8Array | null {
    const data = this.root?.audioCore?.sample(this.patchKey, mode) ?? null;
    if (data) {
      this.dispatchEvent(new CustomEvent("wcs-analyser:frame", { detail: data, bubbles: true }));
    }
    return data;
  }
}
