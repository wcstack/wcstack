import { describe, it, expect } from "vitest";
import * as M from "../../public/lib/music.js";

describe("sound values", () => {
  it("normalizes strings from the URL into numbers, clamped into range", () => {
    const s = M.soundFromQuery({ wave: "square", cutoff: "1800", resonance: "99", attack: "-1", detune: "abc" });
    expect(s.wave).toBe("square");
    expect(s.cutoff).toBe(1800);
    expect(typeof s.cutoff).toBe("number");
    expect(s.resonance).toBe(20);
    expect(s.attack).toBe(0);
    expect(s.detune).toBe(M.DEFAULT_SOUND.detune);
  });
  it("fills a value an older saved sound does not have (no delayMix)", () => {
    const { delayMix, ...old } = M.DEFAULT_SOUND;
    const s = M.normalizeSound({ ...old, cutoff: 900 });
    expect(s.delayMix).toBe(M.DEFAULT_SOUND.delayMix);
    expect(s.cutoff).toBe(900);
  });
  it("round-trips through the query string", () => {
    const s = { ...M.DEFAULT_SOUND, wave: "triangle", cutoff: 1234, release: 1.25 };
    const q = Object.fromEntries(new URLSearchParams(M.soundToQuery(s)));
    expect(M.soundFromQuery(q)).toEqual(s);
    expect(M.sameSound(s, M.soundFromQuery(q))).toBe(true);
  });
  it("knows whether a query carries a sound", () => {
    expect(M.queryHasSound({})).toBe(false);
    expect(M.queryHasSound({ delay: "3000" })).toBe(false);
    expect(M.queryHasSound({ wave: "sine" })).toBe(true);
  });
  it("rejects names that are empty or longer than 30 characters", () => {
    expect(M.validName("  ")).not.toBe("");
    expect(M.validName("あ".repeat(31))).not.toBe("");
    expect(M.validName("あ".repeat(30))).toBe("");
  });
});

describe("notes and the sustain pedal", () => {
  const press = (ns, n, src = "a") => M.pressNote(ns, n, 0.8, src);
  it("plays and releases a note", () => {
    let r = press(M.EMPTY_NOTES, 60);
    expect(r.actions).toEqual([["on", 60, 0.8]]);
    r = M.releaseNote(r.ns, 60, "a");
    expect(r.actions).toEqual([["off", 60]]);
    expect(M.soundingNotes(r.ns)).toEqual([]);
  });
  it("strikes a note again when pressed before it was released", () => {
    let r = press(M.EMPTY_NOTES, 60);
    r = press(r.ns, 60);
    expect(r.actions).toEqual([["off", 60], ["on", 60, 0.8]]);
    r = M.releaseNote(r.ns, 60, "a");
    expect(r.actions).toEqual([["off", 60]]);
  });
  it("keeps a note held by two sources until both let go", () => {
    let r = press(M.EMPTY_NOTES, 60, "qwerty");
    r = press(r.ns, 60, "screen");
    r = M.releaseNote(r.ns, 60, "qwerty");
    expect(r.actions).toEqual([]);
    r = M.releaseNote(r.ns, 60, "screen");
    expect(r.actions).toEqual([["off", 60]]);
  });
  it("holds notes under the pedal across chords and releases them on pedal up", () => {
    let ns = M.setPedal(M.EMPTY_NOTES, true).ns;
    for (const n of [60, 64, 67]) ns = press(ns, n).ns;
    for (const n of [60, 64, 67]) {
      const r = M.releaseNote(ns, n, "a");
      expect(r.actions).toEqual([]);
      ns = r.ns;
    }
    for (const n of [62, 65]) ns = press(ns, n).ns; // the next chord while the pedal is down
    expect(M.soundingNotes(ns)).toEqual([60, 62, 64, 65, 67]);
    const up = M.setPedal(ns, false);
    expect(up.actions.map((a) => a[1]).sort()).toEqual([60, 64, 67]); // 62 and 65 are still held
    expect(M.soundingNotes(up.ns)).toEqual([62, 65]);
  });
  it("re-striking a pedalled note takes it off the pedal list", () => {
    let ns = M.setPedal(M.EMPTY_NOTES, true).ns;
    ns = M.releaseNote(press(ns, 60).ns, 60, "a").ns;
    const r = press(ns, 60);
    expect(r.actions).toEqual([["off", 60], ["on", 60, 0.8]]);
    expect(r.ns.sustained).toEqual([]);
  });
  it("releases every note of one source (unplugged keyboard), even under the pedal", () => {
    let ns = M.setPedal(M.EMPTY_NOTES, true).ns;
    ns = press(ns, 60, "midi:a").ns;
    ns = press(ns, 62, "midi:b").ns;
    const r = M.releaseSources(ns, (s) => s === "midi:a", { ignorePedal: true });
    expect(r.actions).toEqual([["off", 60]]);
    expect(M.soundingNotes(r.ns)).toEqual([62]);
  });
});

describe("the practice clock", () => {
  it("counts beats and 16th steps from the start", () => {
    const t = { bpm: 120, t0: 1000 };
    const a = M.advance(t, 1000 + 1100, { beat: -1, step: -1 });
    expect(a.beat).toBe(2);
    expect(a.step).toBe(8);
    expect(a.newBeat).toBe(2);
  });
  it("keeps the beat position when the tempo changes", () => {
    const t = { bpm: 100, t0: 0 };
    const now = 3000; // 5 beats at 100 BPM
    const next = M.retime(t, 200, now);
    expect(M.beatPosition(next, now)).toBeCloseTo(5);
    expect(M.beatPosition(next, now + 300)).toBeCloseTo(6);
  });
  it("clamps the tempo to 40–208", () => {
    expect(M.clampBpm(10)).toBe(40);
    expect(M.clampBpm(500)).toBe(208);
    expect(M.clampBpm("abc")).toBe(100);
  });
  it("plays only the latest step after a late tick (a throttled tab)", () => {
    const a = M.advance({ bpm: 120, t0: 0 }, 5000, { beat: 1, step: 4 });
    expect(a.newStep).toBe(40);
    expect(a.skippedSteps).toBe(35);
  });
});

describe("takes", () => {
  it("closes the notes still held at the end of a recording", () => {
    const ev = M.closeTake([{ t: 0, type: "on", note: 60, velocity: 1 }, { t: 10, type: "on", note: 62, velocity: 1 }, { t: 20, type: "off", note: 60, velocity: 0 }], 99);
    expect(ev.at(-1)).toEqual({ t: 99, type: "off", note: 62, velocity: 0 });
  });
  it("finds the events due", () => {
    const events = [{ t: 0 }, { t: 100 }, { t: 200 }];
    expect(M.dueEvents(events, 0, 150)).toEqual({ due: [{ t: 0 }, { t: 100 }], next: 2 });
    expect(M.dueEvents(events, 2, 150).due).toEqual([]);
  });
});

describe("MIDI helpers", () => {
  it("numbers two ports of the same model", () => {
    const devices = [
      { id: "a", name: "Keystation", direction: "input", state: "connected" },
      { id: "b", name: "Keystation", direction: "input", state: "connected" },
      { id: "c", name: "Gone", direction: "input", state: "disconnected" },
      { id: "d", name: "Out", direction: "output", state: "connected" },
    ];
    expect(M.portOptions(devices, "input")).toEqual([{ id: "a", label: "Keystation (1)" }, { id: "b", label: "Keystation (2)" }]);
    expect(M.portOptions(devices, "output")).toEqual([{ id: "d", label: "Out" }]);
  });
  it("turns a 0–1 velocity into MIDI bytes", () => {
    expect(M.midiNoteBytes("on", 60, 1)).toEqual([0x90, 60, 127]);
    expect(M.midiNoteBytes("on", 60, 0.001)).toEqual([0x90, 60, 1]);
    expect(M.midiNoteBytes("off", 60)).toEqual([0x80, 60, 0]);
  });
});
