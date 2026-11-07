/**
 * The ear-protection limiter each `<wcs-audio>` root puts between its master gain
 * and the destination, unless `limiter="off"` (4.17; it was a bare compressor with
 * only its threshold set, which let the README's 8-voice patch peak above 0 dBFS):
 *
 *   compressor → makeup compensation → soft clip (4x oversampled) → hard clip
 *
 * - **Compression from -18 dBFS**, 4:1, hard knee. A `DynamicsCompressorNode`
 *   adds an automatic makeup gain of `(1 / curve(1.0)) ^ 0.6` (Web Audio,
 *   "DynamicsCompressorNode" processing). With a hard knee the curve at 0 dBFS
 *   is `threshold * (1 - 1 / ratio)` dB, so the makeup is
 *   `-0.6 * threshold * (1 - 1 / ratio)` dB — +8.1 dB here, which would push a
 *   quiet patch louder than its gains say. The gain after the compressor takes it
 *   back out: a signal under the threshold leaves at the level it came in.
 *   (Chromium, Firefox and Safari share the compressor's code; measured exact in
 *   Chromium and Firefox.)
 * - **A ceiling at -6 dBFS** (amplitude 0.501). The compressor reacts in
 *   milliseconds, so an attack or a burst gets past it. A curve clamped to the
 *   ceiling and run without oversampling bounds every sample exactly; an
 *   oversampled clipper does not (its down-sampling filter rings past the clamp —
 *   measured +2.4 dB over it on a burst). So the soft stage, oversampled to keep
 *   the clipping it does free of aliasing, rounds the peaks off first, and the
 *   hard stage only trims the little the soft stage's filter lets past.
 */

/** Where compression starts, in dBFS. */
export const LIMITER_THRESHOLD = -18;
/** The compression ratio above the threshold. */
export const LIMITER_RATIO = 4;
/** -6 dBFS as an amplitude (a hair under 10^(-6/20)): no sample leaves the limiter above it. */
export const LIMITER_CEILING = 0.501;

/** Where the soft stage starts to bend, as an amplitude (-9 dBFS). Below it the stage is transparent. */
const SOFT_KNEE = 0.355;
// Odd, so input 0 lands on a point (0 out: no offset).
const CURVE_POINTS = 2049;

/** The linear gain that cancels the compressor's automatic makeup gain. */
export const MAKEUP_COMPENSATION = 10 ** ((0.6 * LIMITER_THRESHOLD * (1 - 1 / LIMITER_RATIO)) / 20);

let softCurve: Float32Array<ArrayBuffer> | null = null;
let hardCurve: Float32Array<ArrayBuffer> | null = null;

/** A WaveShaper curve over [-1, 1]; an input beyond it takes the end value, so the bound holds for any input. */
function makeCurve(shape: (x: number) => number): Float32Array<ArrayBuffer> {
  // Backed by a plain ArrayBuffer so the type matches WaveShaperNode.curve.
  const curve = new Float32Array(new ArrayBuffer(CURVE_POINTS * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = (i / (CURVE_POINTS - 1)) * 2 - 1;
    curve[i] = Math.sign(x) * shape(Math.abs(x));
  }
  return curve;
}

/** Transparent up to the knee, then bends smoothly (slope 1 at the knee) towards the ceiling. */
export function softClipCurve(): Float32Array<ArrayBuffer> {
  return softCurve ??= makeCurve((a) => a <= SOFT_KNEE
    ? a
    : SOFT_KNEE + (LIMITER_CEILING - SOFT_KNEE) * Math.tanh((a - SOFT_KNEE) / (LIMITER_CEILING - SOFT_KNEE)));
}

/** The identity, clamped to the ceiling. Linear interpolation between points never exceeds it. */
export function hardClipCurve(): Float32Array<ArrayBuffer> {
  return hardCurve ??= makeCurve((a) => Math.min(a, LIMITER_CEILING));
}

/**
 * Build the limiter's stages, in signal order. They are not connected: the root
 * wires master → stages → destination, and rewires around them for `limiter="off"`.
 * The curves are shared: a WaveShaperNode copies the array it is given.
 */
export function buildLimiter(ctx: BaseAudioContext): AudioNode[] {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = LIMITER_THRESHOLD;
  compressor.knee.value = 0;
  compressor.ratio.value = LIMITER_RATIO;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  const makeup = ctx.createGain();
  makeup.gain.value = MAKEUP_COMPENSATION;
  const soft = ctx.createWaveShaper();
  soft.curve = softClipCurve();
  soft.oversample = "4x";
  const hard = ctx.createWaveShaper();
  hard.curve = hardClipCurve();
  hard.oversample = "none";
  return [compressor, makeup, soft, hard];
}
