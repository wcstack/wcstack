export { bootstrapMidi } from "./bootstrapMidi.js";
export { getConfig } from "./config.js";
export { MidiCore } from "./core/MidiCore.js";
export { WcsMidi } from "./components/Midi.js";
export { parseMessage, MIDI_MESSAGE_TYPES } from "./midi/parseMessage.js";
export { WCS_MIDI_ERROR_CODE, deriveMidiErrorInfo } from "./core/midiCapabilities.js";

export type {
  IWritableConfig, IWritableTagNames, IMidiDevice, IMidiMessage, IMidiOptions,
  IMidiParsed, MidiMessageType, MidiPermissionState, WcsIoErrorInfo,
  WcsMidiCoreValues, WcsMidiValues, WcsMidiInputs
} from "./types.js";

// Typed element lookups (docs/typescript.md §3): `document.querySelector("wcs-midi")`
// resolves to the element class. Default tag names only — a page that renames tags via
// `IWritableTagNames` is outside this map. Declared here so the augmentation ships in
// dist/index.d.ts; it applies once this package's types are in the consuming program
// (`import "@wcstack/midi"` or a tsconfig `types` entry).
import type { WcsMidi } from "./components/Midi.js";
declare global {
  interface HTMLElementTagNameMap {
    "wcs-midi": WcsMidi;
  }
}
