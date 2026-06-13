export { bootstrapSpeech } from "./bootstrapSpeech.js";
export { getConfig } from "./config.js";
export { SpeakCore } from "./core/SpeakCore.js";
export { WcsSpeak } from "./components/Speak.js";
export { ListenCore } from "./core/ListenCore.js";
export { WcsListen } from "./components/Listen.js";

export type {
  IWritableConfig, IWritableTagNames, SpeechVoiceInfo, SpeakOptions, WcsSpeakErrorDetail,
  WcsSpeakCoreValues, WcsSpeakValues, WcsSpeakInputs, WcsSpeakCoreCommands, WcsSpeakCommands,
  ListenPermissionState, ListenOptions, WcsListenAlternative, WcsListenResultDetail, WcsListenErrorDetail,
  WcsListenCoreValues, WcsListenValues, WcsListenInputs, WcsListenCoreCommands, WcsListenCommands
} from "./types.js";
