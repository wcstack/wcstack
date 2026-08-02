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
