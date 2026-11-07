// Pure logic for the music room app: no DOM, no wcstack. The state (../state.js) calls these,
// and the unit tests exercise them directly.

export const WAVES = ["sine", "triangle", "sawtooth", "square"];
export const WAVE_LABELS = { sine: "サイン波", triangle: "三角波", sawtooth: "のこぎり波", square: "矩形波" };

/** Ranges of the sound values, as the server checks them. [min, max, step] */
export const RANGES = {
  detune: [0, 50, 1],
  cutoff: [80, 12000, 1],
  resonance: [0.1, 20, 0.1],
  attack: [0, 2, 0.005],
  decay: [0, 2, 0.01],
  sustain: [0, 1, 0.01],
  release: [0, 4, 0.01],
  vibratoRate: [0.1, 12, 0.1],
  delayMix: [0, 1, 0.01],
  volume: [0, 1, 0.01],
};
export const SOUND_KEYS = ["wave", ...Object.keys(RANGES)];

export const DEFAULT_SOUND = Object.freeze({
  wave: "sawtooth", detune: 8, cutoff: 2400, resonance: 2, attack: 0.01, decay: 0.3,
  sustain: 0.6, release: 0.4, vibratoRate: 5, delayMix: 0.2, volume: 0.8,
});

const decimals = (step) => (String(step).split(".")[1] ?? "").length;

/** A number snapped to the control's step and clamped into its range. */
export function clampValue(key, n) {
  const [min, max, step] = RANGES[key];
  const v = Math.min(max, Math.max(min, n));
  return Number(v.toFixed(Math.max(decimals(step), 3)));
}

/**
 * Normalize anything (a stored sound, a sound from the server, an older saved sound without
 * `delayMix`) into a complete, valid sound. Missing or broken values take the default.
 */
export function normalizeSound(values) {
  const v = values && typeof values === "object" ? values : {};
  const out = { wave: WAVES.includes(v.wave) ? v.wave : DEFAULT_SOUND.wave };
  for (const key of Object.keys(RANGES)) {
    const n = typeof v[key] === "string" ? Number(v[key]) : v[key];
    out[key] = typeof n === "number" && Number.isFinite(n) ? clampValue(key, n) : DEFAULT_SOUND[key];
  }
  return out;
}

/** Does a router `searchParams` object carry any sound value? */
export function queryHasSound(query) {
  return !!query && SOUND_KEYS.some((k) => typeof query[k] === "string" && query[k] !== "");
}

/** URL query (strings) → sound (numbers). */
export function soundFromQuery(query) {
  return normalizeSound(query);
}

/** sound → canonical query string (no leading "?"). The key order is fixed so equal sounds give equal strings. */
export function soundToQuery(sound) {
  const s = normalizeSound(sound);
  return SOUND_KEYS.map((k) => `${k}=${encodeURIComponent(String(s[k]))}`).join("&");
}

export function sameSound(a, b) {
  return soundToQuery(a) === soundToQuery(b);
}

// ---- notes ----------------------------------------------------------------

const NAMES = ["ド", "ド♯", "レ", "レ♯", "ミ", "ファ", "ファ♯", "ソ", "ソ♯", "ラ", "ラ♯", "シ"];
const LETTERS = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const noteName = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
export const noteLetter = (n) => `${LETTERS[n % 12]}${Math.floor(n / 12) - 1}`;
export const isBlack = (n) => [1, 3, 6, 8, 10].includes(n % 12);

/**
 * Which notes are sounding, and why. Plain data so the state can replace it as one value.
 *   held:      { [note]: string[] }   sources holding the note down (qwerty, screen, midi:<port>, seq, take)
 *   sustained: number[]               notes released while the pedal was down, still sounding
 *   pedal:     boolean                the sustain pedal (CC64)
 */
export const EMPTY_NOTES = Object.freeze({ held: Object.freeze({}), sustained: Object.freeze([]), pedal: false });

const isSounding = (ns, note) => (ns.held[note]?.length ?? 0) > 0 || ns.sustained.includes(note);
const withHeld = (held, note, list) => {
  const next = { ...held };
  if (list.length) next[note] = list; else delete next[note];
  return next;
};

/**
 * Press `note` from `src`. A note that is already sounding (held by another source, held again by
 * the same source, or ringing on the pedal) is struck again: off, then on — so the voice count
 * stays one per note and the attack is heard again.
 * Returns { ns, actions } where actions are ["on", note, velocity] / ["off", note].
 */
export function pressNote(ns, note, velocity, src) {
  const actions = [];
  if (isSounding(ns, note)) actions.push(["off", note]);
  actions.push(["on", note, velocity]);
  const list = (ns.held[note] ?? []).filter((s) => s !== src).concat(src);
  return {
    ns: { held: withHeld(ns.held, note, list), sustained: ns.sustained.filter((n) => n !== note), pedal: ns.pedal },
    actions,
  };
}

/** Release `note` from `src`. Sounds on while another source holds it, or while the pedal is down. */
export function releaseNote(ns, note, src, { ignorePedal = false } = {}) {
  const before = ns.held[note] ?? [];
  if (!before.includes(src)) return { ns, actions: [] };
  const list = before.filter((s) => s !== src);
  const held = withHeld(ns.held, note, list);
  if (list.length) return { ns: { ...ns, held }, actions: [] };
  if (ns.pedal && !ignorePedal) {
    return { ns: { held, sustained: ns.sustained.includes(note) ? ns.sustained : [...ns.sustained, note], pedal: true }, actions: [] };
  }
  return { ns: { ...ns, held }, actions: [["off", note]] };
}

/** Sustain pedal down / up. Up releases every note the pedal kept and nobody holds. */
export function setPedal(ns, down) {
  if (down) return { ns: { ...ns, pedal: true }, actions: [] };
  const actions = ns.sustained.filter((n) => !(ns.held[n]?.length)).map((n) => ["off", n]);
  return { ns: { held: ns.held, sustained: [], pedal: false }, actions };
}

/**
 * Release every note held by a source matching `match(src)` — a window that lost focus (qwerty),
 * an unplugged keyboard (midi:<port>), a page left. `ignorePedal` drops them even under the pedal.
 */
export function releaseSources(ns, match, { ignorePedal = false } = {}) {
  let cur = ns;
  const actions = [];
  for (const [noteKey, srcs] of Object.entries(ns.held)) {
    for (const src of srcs) {
      if (!match(src)) continue;
      const r = releaseNote(cur, Number(noteKey), src, { ignorePedal });
      cur = r.ns;
      actions.push(...r.actions);
    }
  }
  return { ns: cur, actions };
}

/** Every note that is sounding (held or on the pedal), sorted. */
export function soundingNotes(ns) {
  const set = new Set([...Object.keys(ns.held).map(Number), ...ns.sustained]);
  return [...set].sort((a, b) => a - b);
}

// ---- the practice clock ---------------------------------------------------

export const BPM_MIN = 40;
export const BPM_MAX = 208;
export const clampBpm = (bpm) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(Number(bpm) || 100)));
export const beatMs = (bpm) => 60000 / clampBpm(bpm);

/** Position in beats since the transport started. */
export function beatPosition(transport, now) {
  return (now - transport.t0) / beatMs(transport.bpm);
}

/** A new tempo, keeping the current beat position (so the bar does not jump). */
export function retime(transport, bpm, now) {
  const pos = beatPosition(transport, now);
  const next = clampBpm(bpm);
  return { ...transport, bpm: next, t0: now - pos * beatMs(next) };
}

/**
 * What happened on the clock since the last tick. A tick that comes late (a throttled background
 * tab) does not replay every missed beat and step: only the latest one is played.
 */
export function advance(transport, now, last) {
  const pos = beatPosition(transport, now);
  const beat = Math.floor(pos);
  const step = Math.floor(pos * 4); // 16th notes
  return {
    beat, step,
    newBeat: beat > last.beat ? beat : null,
    newStep: step > last.step ? step : null,
    skippedSteps: Math.max(0, step - last.step - 1),
  };
}

// ---- recording ------------------------------------------------------------

export const MAX_TAKE_EVENTS = 5000;

/** Events of a take that are due between `from` (exclusive index) and time `t` (ms). */
export function dueEvents(events, fromIndex, t) {
  let i = fromIndex;
  const due = [];
  while (i < events.length && events[i].t <= t) due.push(events[i++]);
  return { due, next: i };
}

export function takeLength(events) {
  return events.reduce((m, e) => Math.max(m, e.t), 0);
}

/** Close a recording: every note still on gets an off at the end, so a take never leaves a note hanging. */
export function closeTake(events, endT) {
  const on = new Set();
  for (const e of events) {
    if (e.type === "on") on.add(e.note); else on.delete(e.note);
  }
  return [...events, ...[...on].map((note) => ({ t: endT, type: "off", note, velocity: 0 }))];
}

export const formatMs = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ---- MIDI -----------------------------------------------------------------

/** Ports of one direction, connected only, with duplicate names numbered so two of one model can be told apart. */
export function portOptions(devices, direction) {
  const list = (devices ?? []).filter((d) => d.direction === direction && d.state === "connected");
  const count = {};
  for (const d of list) count[d.name] = (count[d.name] ?? 0) + 1;
  const seen = {};
  return list.map((d) => {
    seen[d.name] = (seen[d.name] ?? 0) + 1;
    const label = count[d.name] > 1 ? `${d.name || "MIDI"} (${seen[d.name]})` : (d.name || "MIDI");
    return { id: d.id, label };
  });
}

/** Note on / off bytes for the MIDI output, velocity 0–1 → 1–127. */
export function midiNoteBytes(type, note, velocity) {
  if (type === "on") return [0x90, note, Math.max(1, Math.min(127, Math.round(velocity * 127)))];
  return [0x80, note, 0];
}

// ---- local sounds ---------------------------------------------------------

export const newLocalId = () => "my-" + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
export const isLocalId = (id) => typeof id === "string" && id.startsWith("my-");

export function validName(name) {
  const n = String(name ?? "").trim();
  if (!n) return "名前を入力してください。";
  if ([...n].length > 30) return "名前は30文字以内にしてください。";
  return "";
}
