import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { mount, settle, fire } from "@wcstack/testing";

// Stand-ins for <wcs-audio> / <wcs-midi>: they record the commands the state sends them.
const calls = [];
class FakeInstrument extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable", version: 1, properties: [],
    commands: [{ name: "noteOn" }, { name: "noteOff" }, { name: "allNotesOff" }, { name: "send" }, { name: "request" }],
  };
  noteOn(note, velocity) { calls.push([this.id, "on", note, velocity]); }
  noteOff(note) { calls.push([this.id, "off", note]); }
  allNotesOff() { calls.push([this.id, "panic"]); }
  send(bytes) { calls.push([this.id, "send", bytes]); }
  request() { calls.push([this.id, "request"]); }
}
beforeAll(() => customElements.define("fake-instrument", FakeInstrument));

const resolveModule = (url) => new URL("../../public" + url.pathname, import.meta.url);
const HTML = `
  <wcs-state src="./state.js"></wcs-state>
  <fake-instrument id="synth" data-wcs="command.noteOn: $command.synthOn; command.noteOff: $command.synthOff; command.allNotesOff: $command.synthPanic"></fake-instrument>
  <fake-instrument id="click" data-wcs="command.noteOn: $command.clickOn; command.noteOff: $command.clickOff; command.allNotesOff: $command.clickPanic"></fake-instrument>
  <fake-instrument id="midi" data-wcs="command.send: $command.midiSend; command.request: $command.midiRequest"></fake-instrument>
  <p class="pressed" data-wcs="textContent: pressedNotes|join(',')"></p>
  <p class="detune" data-wcs="textContent: osc2Detune"></p>
  <p class="vibrato" data-wcs="textContent: vibratoDepth"></p>
  <p class="status" data-wcs="textContent: midiStatus"></p>
  <button class="panic" data-wcs="onclick: panic">stop</button>
`;

let app;
const start = async () => {
  calls.length = 0;
  app = await mount(HTML, { resolveModule });
  await settle();
  calls.length = 0;
};
afterEach(() => app?.unmount());
const text = (sel) => app.root.querySelector(sel).textContent;
const synth = () => calls.filter((c) => c[0] === "synth").map((c) => c.slice(1));
const midiMsg = (m) => ({ port: "in-1", data: new Uint8Array([0]), ...m });

describe("state: playing", () => {
  it("plays a note from the computer keyboard and releases it", async () => {
    await start();
    await app.state().write((s) => s.noteDown(60, 0.8, "qwerty"));
    await settle();
    expect(synth()).toEqual([["on", 60, 0.8]]);
    expect(text(".pressed")).toBe("60");
    await app.state().write((s) => s.noteUp(60, "qwerty"));
    await settle();
    expect(synth().at(-1)).toEqual(["off", 60]);
    expect(text(".pressed")).toBe("");
  });

  it("passes MIDI velocity (already 0–1) straight to the synth", async () => {
    await start();
    await app.state().write((s) => s.handleMidi(midiMsg({ type: "noteon", note: 64, velocity: 0.5 })));
    await app.state().write((s) => s.handleMidi(midiMsg({ type: "noteoff", note: 64, velocity: 0 })));
    await settle();
    expect(synth()).toEqual([["on", 64, 0.5], ["off", 64]]);
  });

  it("keeps a chord under the sustain pedal and lets it go on pedal up", async () => {
    await start();
    const midi = (m) => app.state().write((s) => s.handleMidi(midiMsg(m)));
    await midi({ type: "controlchange", control: 64, value: 127 });
    for (const n of [60, 64, 67]) await midi({ type: "noteon", note: n, velocity: 0.8 });
    for (const n of [60, 64, 67]) await midi({ type: "noteoff", note: n, velocity: 0 });
    await settle();
    expect(synth().filter((c) => c[0] === "off")).toEqual([]);
    expect(text(".pressed")).toBe("60,64,67");
    await midi({ type: "controlchange", control: 64, value: 0 });
    await settle();
    expect(synth().filter((c) => c[0] === "off").map((c) => c[1]).sort()).toEqual([60, 64, 67]);
  });

  it("bends ±2 semitones and maps the modulation wheel to vibrato depth", async () => {
    await start();
    await app.state().write((s) => { s["sound.detune"] = 10; });
    await app.state().write((s) => s.handleMidi(midiMsg({ type: "pitchbend", value: 1 })));
    await app.state().write((s) => s.handleMidi(midiMsg({ type: "controlchange", control: 1, value: 127 })));
    await settle();
    expect(Number(text(".detune"))).toBe(5 + 200);
    expect(Number(text(".vibrato"))).toBe(40);
  });

  it("releases what an unplugged keyboard held", async () => {
    await start();
    await app.state().write((s) => { s.midiPermission = "granted"; s.midiDevices = [{ id: "in-1", name: "K", manufacturer: "", direction: "input", state: "connected" }]; });
    await app.state().write((s) => s.handleMidi(midiMsg({ type: "noteon", note: 60, velocity: 1 })));
    await app.state().write((s) => { s.midiDevices = [{ id: "in-1", name: "K", manufacturer: "", direction: "input", state: "disconnected" }]; });
    await settle();
    expect(synth().at(-1)).toEqual(["off", 60]);
    expect(text(".pressed")).toBe("");
  });

  it("silences everything with 音を止める", async () => {
    await start();
    await app.state().write((s) => { s.noteDown(60, 1, "qwerty"); s.noteDown(62, 1, "screen"); });
    fire(app.root.querySelector(".panic"), "click");
    await settle();
    expect(calls.some((c) => c[0] === "synth" && c[1] === "panic")).toBe(true);
    expect(text(".pressed")).toBe("");
  });

  it("sends played notes to the MIDI output only when one is chosen and present", async () => {
    await start();
    await app.state().write((s) => s.noteDown(60, 1, "qwerty"));
    expect(calls.filter((c) => c[0] === "midi" && c[1] === "send")).toEqual([]);
    await app.state().write((s) => {
      s.midiPermission = "granted";
      s.midiDevices = [{ id: "out-1", name: "Module", manufacturer: "", direction: "output", state: "connected" }];
      s["settings.midiOutput"] = "out-1";
    });
    await app.state().write((s) => s.noteUp(60, "qwerty"));
    await settle();
    expect(calls.filter((c) => c[0] === "midi" && c[1] === "send").map((c) => c[2])).toEqual([[0x80, 60, 0]]);
  });

  it("explains a browser without Web MIDI", async () => {
    await start();
    await app.state().write((s) => { s.midiPermission = "unsupported"; });
    await settle();
    expect(text(".status")).toContain("使えません");
  });
});

describe("state: sound link", () => {
  it("takes a sound from the URL query (strings) as numbers", async () => {
    await start();
    await app.state().write((s) => {
      s.routeName = "play";
      s.query = { wave: "square", cutoff: "1800", detune: "4", resonance: "1", attack: "0.01", decay: "0.2", sustain: "0.5", release: "0.3", vibratoRate: "5", delayMix: "0.1", volume: "0.7" };
    });
    await settle();
    const sound = app.state().read((s) => s.currentSound);
    expect(sound.wave).toBe("square");
    expect(sound.cutoff).toBe(1800);
    expect(typeof sound.cutoff).toBe("number");
  });
});

describe("state: recording", () => {
  it("records only what the student plays, with its timing", async () => {
    await start();
    await app.state().write((s) => s.toggleRecording());
    await app.state().write((s) => { s.noteDown(60, 0.8, "qwerty"); s.noteDown(67, 0.8, "seq"); });
    await new Promise((r) => setTimeout(r, 30));
    await app.state().write((s) => { s.noteUp(60, "qwerty"); s.toggleRecording(); });
    await settle();
    const draft = app.state().read((s) => s.draft);
    expect(draft.events.map((e) => [e.type, e.note])).toEqual([["on", 60], ["off", 60]]);
    expect(draft.events[1].t).toBeGreaterThanOrEqual(draft.events[0].t);
    await app.state().write((s) => s.stopPractice());
  });
});
