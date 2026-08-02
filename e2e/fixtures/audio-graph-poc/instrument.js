/**
 * Records the connection topology of any BaseAudioContext-like object while
 * still performing the real calls. Works over a real (Offline)AudioContext and
 * over FakeAudioContext alike, which is what makes the mock/real isomorphism
 * check of Phase B possible (audio-impl-plan.md §B-3-5).
 *
 * Nodes are labeled in creation order, so two runs of the same Core over two
 * different contexts produce comparable edge sets.
 */

const KINDS = {
  createOscillator: "osc",
  createGain: "gain",
  createBiquadFilter: "biquad",
  createDelay: "delay",
  createWaveShaper: "shaper",
  createConstantSource: "const",
  createBufferSource: "bufsrc",
  createAnalyser: "analyser",
  createDynamicsCompressor: "comp",
};

/** AudioParam property names per factory — explicit beats duck-typing here. */
const PARAMS_OF = {
  createOscillator: ["frequency", "detune"],
  createGain: ["gain"],
  createBiquadFilter: ["frequency", "Q", "gain", "detune"],
  createDelay: ["delayTime"],
  createWaveShaper: [],
  createConstantSource: ["offset"],
  createBufferSource: ["playbackRate", "detune"],
  createAnalyser: [],
  createDynamicsCompressor: ["threshold", "knee", "ratio", "attack", "release"],
};

export function instrument(ctx) {
  const edges = new Set();
  const labels = new WeakMap();
  const paramLabels = new WeakMap();
  const counts = Object.create(null);

  labels.set(ctx.destination, "destination");

  const targetLabel = (dest) =>
    labels.get(dest) ?? paramLabels.get(dest) ?? "unknown";

  const wrap = (node, kind, method) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    const label = `${kind}#${counts[kind]}`;
    labels.set(node, label);
    for (const name of PARAMS_OF[method] ?? []) {
      const p = node[name];
      if (p) paramLabels.set(p, `${label}.${name}`);
    }
    const connect = node.connect.bind(node);
    const disconnect = node.disconnect.bind(node);
    node.connect = (dest, ...rest) => {
      edges.add(`${label} -> ${targetLabel(dest)}`);
      return connect(dest, ...rest);
    };
    node.disconnect = (...args) => {
      if (args.length > 0) edges.delete(`${label} -> ${targetLabel(args[0])}`);
      else for (const e of [...edges]) if (e.startsWith(`${label} -> `)) edges.delete(e);
      return disconnect(...args);
    };
    return node;
  };

  for (const [method, kind] of Object.entries(KINDS)) {
    if (typeof ctx[method] !== "function") continue;
    const orig = ctx[method].bind(ctx);
    ctx[method] = (...args) => wrap(orig(...args), kind, method);
  }

  return {
    context: ctx,
    edges,
    /** Stable, comparable snapshot of the current topology. */
    snapshot: () => [...edges].sort(),
  };
}
