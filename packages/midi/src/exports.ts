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
