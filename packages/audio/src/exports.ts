export { bootstrapAudio } from "./bootstrapAudio.js";
export { getConfig } from "./config.js";
export { AudioGraphCore } from "./core/AudioGraphCore.js";
export { VoiceAllocator } from "./core/VoiceAllocator.js";
export { defaultCreateContext, releaseSharedContext } from "./core/audioContext.js";
export { WCS_AUDIO_ERROR_CODE, deriveAudioErrorInfo } from "./core/audioCapabilities.js";
export { compilePatch, graphChildren, STRUCTURAL_ATTRIBUTES } from "./patch/compilePatch.js";
export { structureKey } from "./patch/structureKey.js";
export { WcsAudio } from "./components/Audio.js";
export { WcsVoice } from "./components/Voice.js";
export { AudioNodeShell, findAudioRoot } from "./components/AudioNodeShell.js";
export {
  WcsAnalyser, WcsBiquad, WcsDelay, WcsEnv, WcsGain, WcsLfo, WcsNoise, WcsOsc,
  WcsShaper,
} from "./components/nodes.js";

export type {
  IWritableConfig, IWritableTagNames, AudioNodeKind, AudioContextState,
  IAudioWarning, Patch, PatchNode, PatchVoice, WcsIoErrorInfo,
  WcsAudioCoreValues, WcsAudioValues, WcsAudioInputs
} from "./types.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-audio")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/audio"` or a tsconfig `types` entry).
import type { WcsAudio } from "./components/Audio.js";
import type { WcsVoice } from "./components/Voice.js";
import type { WcsOsc, WcsNoise, WcsBiquad, WcsGain, WcsDelay, WcsShaper, WcsEnv, WcsLfo, WcsAnalyser } from "./components/nodes.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-audio": WcsAudio;
    "wcs-voice": WcsVoice;
    "wcs-osc": WcsOsc;
    "wcs-noise": WcsNoise;
    "wcs-biquad": WcsBiquad;
    "wcs-gain": WcsGain;
    "wcs-delay": WcsDelay;
    "wcs-shaper": WcsShaper;
    "wcs-env": WcsEnv;
    "wcs-lfo": WcsLfo;
    "wcs-analyser": WcsAnalyser;
  }
}
