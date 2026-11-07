// Independent check that the page really makes sound: every node the page connects to the
// speakers (an AudioDestinationNode) is also connected to this probe's own AnalyserNode.
// The probe does not use the app's meter or any wcstack API, so "the level rose" means signal
// actually reached the output. window.__audioProbe.peak() → the max |sample| of the last frame.
(() => {
  const probes = new Map(); // context -> analyser
  const realConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const result = realConnect.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) {
      let a = probes.get(dest.context);
      if (!a) {
        a = dest.context.createAnalyser();
        a.fftSize = 2048;
        probes.set(dest.context, a);
      }
      realConnect.call(this, a);
    }
    return result;
  };
  const frame = new Float32Array(2048);
  window.__audioProbe = {
    contexts: () => probes.size,
    state: () => [...probes.keys()].map((c) => c.state),
    peak() {
      let peak = 0;
      for (const a of probes.values()) {
        a.getFloatTimeDomainData(frame);
        for (const x of frame) peak = Math.max(peak, Math.abs(x));
      }
      return peak;
    },
  };
})();
