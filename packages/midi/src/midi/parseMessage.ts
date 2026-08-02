import { IMidiParsed, MidiMessageType } from "../types.js";

// Channel voice message commands (high nibble of the status byte).
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const POLY_AFTERTOUCH = 0xa0;
const CONTROL_CHANGE = 0xb0;
const PROGRAM_CHANGE = 0xc0;
const AFTERTOUCH = 0xd0;
const SYSTEM = 0xf0;

const SYSEX_START = 0xf0;

const EMPTY: IMidiParsed = {
  type: "other", channel: null, note: null, velocity: null, control: null, value: null,
};

/**
 * Decode a raw MIDI message into the fields bindings actually want.
 *
 * Two normalizations are deliberate, because every consumer would otherwise
 * repeat them:
 *
 * - **A note-on with velocity 0 is reported as `"noteoff"`.** Many controllers
 *   send running-status note-ons and never emit 0x8n at all; treating them as
 *   note-ons leaves stuck notes. The raw status byte is still available in
 *   `data[0]` for callers that care.
 * - **Velocity is normalized to 0-1**, so it multiplies straight into a gain
 *   without the caller knowing about the 7-bit MIDI range. Controller values
 *   stay raw 0-127 (`value`), since their meaning is per-controller.
 *
 * Never throws: a truncated or nonsensical buffer decodes to `type: "other"`
 * with every field `null` (async-io-node-guidelines.md §3.6).
 */
export function parseMessage(data: Uint8Array | number[]): IMidiParsed {
  const status = data[0];
  if (typeof status !== "number") return EMPTY;

  const d1 = typeof data[1] === "number" ? data[1] : 0;
  const d2 = typeof data[2] === "number" ? data[2] : 0;

  // System messages (0xF0-0xFF) carry no channel nibble.
  if (status >= SYSTEM) {
    return { ...EMPTY, type: status === SYSEX_START ? "sysex" : "other" };
  }
  // Below 0x80 is a data byte, not a status byte: the buffer is malformed or
  // running-status (which the Web MIDI API already expands for us).
  if (status < NOTE_OFF) return EMPTY;

  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;

  switch (command) {
    case NOTE_OFF:
      return { type: "noteoff", channel, note: d1, velocity: d2 / 127, control: null, value: null };
    case NOTE_ON:
      // velocity 0 == note off (see doc comment).
      return d2 > 0
        ? { type: "noteon", channel, note: d1, velocity: d2 / 127, control: null, value: null }
        : { type: "noteoff", channel, note: d1, velocity: 0, control: null, value: null };
    case POLY_AFTERTOUCH:
      return { type: "polyaftertouch", channel, note: d1, velocity: null, control: null, value: d2 };
    case CONTROL_CHANGE:
      return { type: "controlchange", channel, note: null, velocity: null, control: d1, value: d2 };
    case PROGRAM_CHANGE:
      return { type: "programchange", channel, note: null, velocity: null, control: null, value: d1 };
    case AFTERTOUCH:
      return { type: "aftertouch", channel, note: null, velocity: null, control: null, value: d1 };
    default:
      // 0xE0 pitch bend — the only high nibble left between 0x80 and 0xEF once
      // the six cases above are taken. 14-bit little-endian, centered at 8192,
      // normalized to -1..1.
      return {
        type: "pitchbend", channel, note: null, velocity: null, control: null,
        value: (((d2 << 7) | d1) - 8192) / 8192,
      };
  }
}

/** Message kinds a caller may want to filter on, exported for tooling. */
export const MIDI_MESSAGE_TYPES: readonly MidiMessageType[] = [
  "noteon", "noteoff", "polyaftertouch", "controlchange",
  "programchange", "aftertouch", "pitchbend", "sysex", "other",
];
