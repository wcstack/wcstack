import { Patch } from "../src/types";

/** osc → gain, the smallest patch that makes a sound. */
export const SIMPLE: Patch = {
  nodes: [{
    kind: "osc", key: "o1", params: { frequency: 440 }, props: { type: "sine" },
    children: [{ kind: "gain", key: "g1", params: { gain: 0.5 } }],
  }],
  voices: [],
};

/**
 * Everything the compiler has to handle at once: a named bus with an effect, a
 * master analyser tap, and a polyphonic voice whose oscillators route by id,
 * whose LFO modulates a parameter and whose envelope sends outside the voice.
 */
export const FULL: Patch = {
  nodes: [
    {
      kind: "gain", key: "bus", id: "bus", params: { gain: 0.8 },
      children: [{ kind: "delay", key: "fx", params: { time: 0.2, feedback: 0.3 }, props: { mix: "0.25" } }],
    },
    { kind: "analyser", key: "scope", master: true },
  ],
  voices: [{
    key: "v1", poly: 2,
    nodes: [
      { kind: "osc", key: "o1", note: true, out: ["vcf"] },
      { kind: "noise", key: "n1", out: ["vcf"] },
      {
        kind: "biquad", key: "vcf", id: "vcf", params: { frequency: 1200 },
        children: [
          { kind: "lfo", key: "lfo1", param: "frequency", params: { rate: 4, depth: 200 } },
          { kind: "env", key: "amp", props: { release: "0.2" }, out: ["bus"] },
        ],
      },
    ],
  }],
};

/** A voice with an envelope, for release / reclaim timing. */
export const VOICE: Patch = {
  nodes: [],
  voices: [{
    key: "v1", poly: 2,
    nodes: [{
      kind: "osc", key: "vo", note: true,
      children: [{ kind: "env", key: "ve", props: { release: "0.2" } }],
    }],
  }],
};

/** A voice with no envelope, exercising the implicit safety ramp. */
export const GATELESS: Patch = {
  nodes: [],
  voices: [{ key: "v1", poly: 2, nodes: [{ kind: "osc", key: "vo", note: true }] }],
};
