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

// Error taxonomy: `errorInfo` is an additive wc-bindable property on both Cores,
// so its value type and the stable code constants are public (no lane — speak is
// momentary and recognition has no competing async operation). The generic
// `WcsIoErrorInfo` type comes from the shared io-core; each Core has its own code
// set (SpeechRecognition vs SpeechSynthesis error enums).
export type { WcsIoErrorInfo, WcsIoErrorPhase } from "./core/platformCapability.js";
export { WCS_LISTEN_ERROR_CODE, WCS_SPEAK_ERROR_CODE } from "./core/speechCapabilities.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-speak")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/speech"` or a tsconfig `types` entry).
import type { WcsSpeak } from "./components/Speak.js";
import type { WcsListen } from "./components/Listen.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-speak": WcsSpeak;
    "wcs-listen": WcsListen;
  }
}
