// State of the music room keyboard. Loaded with <wcs-state src="./state.js"> (index.html).
import * as M from "./lib/music.js";

const isPlayer = (src) => src === "qwerty" || src === "screen" || src.startsWith("midi:");
const SEQ_NOTES = [72, 71, 70, 69, 68, 67, 66, 65, 64, 63, 62, 61, 60]; // top row = highest
const SEQ_STEPS = 16;
const CLICK_ACCENT = 96; // C7 — the first beat of the bar
const CLICK_BEAT = 84;   // C6
const DETAIL_FIELDS = [
  { key: "wave", label: "波形", unit: "" }, { key: "detune", label: "デチューン", unit: " セント" },
  { key: "cutoff", label: "カットオフ", unit: " Hz" }, { key: "resonance", label: "レゾナンス", unit: "" },
  { key: "attack", label: "アタック", unit: " 秒" }, { key: "decay", label: "ディケイ", unit: " 秒" },
  { key: "sustain", label: "サステイン", unit: "" }, { key: "release", label: "リリース", unit: " 秒" },
  { key: "vibratoRate", label: "ビブラートの速さ", unit: " Hz" }, { key: "delayMix", label: "エコー", unit: "" },
  { key: "volume", label: "音量", unit: "" },
];

/** @typedef {{ id: number, name: string, values: { wave: string, detune: number, cutoff: number, resonance: number, attack: number, decay: number, sustain: number, release: number, vibratoRate: number, delayMix: number, volume: number } }} ServerSound */
/** @typedef {{ id: string, name: string, values: { wave: string, detune: number, cutoff: number, resonance: number, attack: number, decay: number, sustain: number, release: number, vibratoRate: number, delayMix: number, volume: number } }} LocalSound */
/** @typedef {{ id: number, name: string, bpm: number, length: number, createdAt: string }} TakeSummary */
/** @typedef {{ t: number, type: string, note: number, velocity: number }} TakeEvent */
/** @typedef {{ id: number, name: string, bpm: number, events: TakeEvent[] }} Take */
/** @typedef {{ id: string, name: string, manufacturer: string, direction: string, state: string }} MidiDevice */

const fieldErrorsOf = (error) => {
  if (!error?.body) return {};
  try { return JSON.parse(error.body).errors ?? {}; } catch { return {}; }
};
const requestMessage = (error, what) => {
  if (!error) return "";
  if (!error.status) return `サーバーにつながりませんでした。${what}もう一度ためしてください。`;
  if (error.status === 403) return "先生の鍵がちがいます。";
  if (error.status === 413) return "演奏が長すぎます（5000イベントまで）。";
  if (error.status === 422) return "入力をなおしてください。";
  return `${what}できませんでした（エラー ${error.status}）。もう一度ためしてください。`;
};

export default {
  // ---- router ------------------------------------------------------------
  routeName: "",
  routeParams: {},
  query: {},
  navigateUrl: null,
  replaceUrl: null,

  // ---- audio -------------------------------------------------------------
  audioRunning: false,
  audioUnsupported: false,
  voices: 0,
  level: 0,
  sound: { ...M.DEFAULT_SOUND },
  settledSoundQuery: "",
  bend: 0,      // -1..1 from the pitch-bend wheel
  modWheel: 0,  // 0..127 from the modulation wheel (CC1)
  notes: M.EMPTY_NOTES,
  qwertyOctave: 4,

  // ---- MIDI --------------------------------------------------------------
  /** @type {MidiDevice[]} */
  midiDevices: [],
  midiPermission: "prompt",
  midiError: null,
  midiAsked: false,

  // ---- settings (saved in localStorage through <wcs-storage>) ------------
  settings: { midiInput: "", midiOutput: "", qwerty: true, masterVolume: 0.8, click: true, midiWanted: false },

  // ---- sounds ------------------------------------------------------------
  /** @type {ServerSound[] | null} */
  soundsList: null,
  soundsLoading: false,
  soundsError: null,
  /** @type {ServerSound | null} */
  soundDetail: null,
  soundDetailLoading: false,
  soundDetailError: null,
  /** @type {LocalSound[] | null} */
  localSounds: null,
  localName: "",
  localMessage: "",
  editingId: null,
  editName: "",
  editError: "",
  teacher: { name: "", key: "" },
  soundSaveBody: null,
  soundSaveTrigger: false,
  soundSaveError: null,
  soundSaveLoading: false,
  soundSaveMessage: "",

  // ---- practice ----------------------------------------------------------
  bpm: 100,
  beatsPerBar: 4,
  metronomeOn: false,
  seqOn: false,
  clockOn: false,
  clockT0: 0,
  lastBeat: -1,
  lastStep: -1,
  currentBeat: -1,
  currentStep: -1,
  clickNote: null,
  /** @type {{ note: number, label: string, cells: { on: boolean }[] }[]} */
  seqRows: SEQ_NOTES.map((note) => ({ note, label: M.noteName(note), cells: Array.from({ length: SEQ_STEPS }, () => ({ on: false })) })),
  recActive: false,
  recT0: 0,
  /** @type {TakeEvent[]} */
  recEvents: [],
  recMessage: "",
  /** @type {{ bpm: number, events: TakeEvent[], length: number } | null} */
  draft: null,
  draftName: "",
  pbActive: false,
  pbName: "",
  pbT0: 0,
  pbIndex: 0,
  /** @type {TakeEvent[]} */
  pbEvents: [],
  /** @type {TakeSummary[] | null} */
  takesList: null,
  takesLoading: false,
  takesError: null,
  openTakeId: null,
  /** @type {Take | null} */
  openTake: null,
  openTakeLoading: false,
  openTakeError: null,
  takeSaveBody: null,
  takeSaveTrigger: false,
  takeSaveError: null,
  takeSaveLoading: false,
  takeSaveMessage: "",

  offline: false,
  appError: "",
  status: "",

  $commandTokens: [
    "synthOn", "synthOff", "synthPanic", "clickOn", "clickOff", "clickPanic", "sampleMeter",
    "midiRequest", "midiSend", "reloadSounds", "reloadSoundDetail", "reloadTakes", "reloadOpenTake",
    "clockStart", "clockStop",
  ],
  $eventTokens: ["onMidi", "qwertyNote", "qwertyLost", "screenNote", "meterTick", "meterFrame", "clockTick", "soundSaved", "takeSaved"],

  $on: {
    onMidi: (s, e) => s.handleMidi(e.detail),
    qwertyNote: (s, e) => (e.detail.on ? s.noteDown(e.detail.note, e.detail.velocity, "qwerty") : s.noteUp(e.detail.note, "qwerty")),
    screenNote: (s, e) => (e.detail.on ? s.noteDown(e.detail.note, e.detail.velocity, "screen") : s.noteUp(e.detail.note, "screen")),
    qwertyLost: (s, e) => s.focusLost(e.detail),
    meterTick: (s) => { s.$command.sampleMeter.emit("wave"); },
    meterFrame: (s, e) => s.updateLevel(e.detail),
    clockTick: (s) => s.onClock(performance.now()),
    soundSaved: (s, e) => {
      if (e.detail.status === 201) {
        s.soundSaveMessage = `「${e.detail.value.name}」を先生の音として保存しました。`;
        s["teacher.name"] = "";
        s.$command.reloadSounds.emit();
      }
    },
    takeSaved: (s, e) => {
      if (e.detail.status === 201) {
        s.takeSaveMessage = `「${e.detail.value.name}」を保存しました。`;
        s.draftName = "";
        s.$command.reloadTakes.emit();
      }
    },
  },

  $watch: {
    routeName(name, prev) {
      if (prev && prev !== name) {
        // Leaving a page never leaves a note sounding by itself.
        this.releaseWhere(isPlayer, true);
        this.level = 0;
        if (prev === "practice") this.stopPractice();
        this.status = "";
      }
      if (name === "play") this.syncFromQuery(this.query);
    },
    query(q) {
      if (this.routeName === "play") this.syncFromQuery(q);
    },
    settledSoundQuery(q) {
      if (this.routeName !== "play" || !q) return;
      if (q !== this.canonicalQuery) this.replaceUrl = "?" + q;
    },
    bpm(cur, prev) {
      const clamped = M.clampBpm(cur);
      if (clamped !== cur) { this.bpm = clamped; return; }
      if ((this.metronomeOn || this.seqOn) && typeof prev === "number") {
        this.clockT0 = M.retime({ bpm: prev, t0: this.clockT0 }, cur, performance.now()).t0;
      }
    },
    midiDevices(list) {
      const live = new Set((list ?? []).filter((d) => d.direction === "input" && d.state === "connected").map((d) => d.id));
      // A keyboard unplugged while a key (or the pedal) was down: let go of what it held.
      this.releaseWhere((src) => src.startsWith("midi:") && !live.has(src.slice(5)), true);
      if (live.size === 0) this.resetControllers();
    },
    midiPermission(p) {
      if (p !== "granted") { this.releaseWhere((src) => src.startsWith("midi:"), true); this.resetControllers(); }
      if (p === "granted" && !this["settings.midiWanted"]) this["settings.midiWanted"] = true;
    },
    "settings.midiInput"(id) {
      if (id) this.releaseWhere((src) => src.startsWith("midi:") && src !== "midi:" + id, true);
    },
  },

  $connectedCallback() {
    // A student who allowed MIDI once gets it again without a click (no prompt: the grant is kept).
    if (this["settings.midiWanted"]) this.$command.midiRequest.emit();
  },

  $errorCallback(error, { path }) {
    this.appError = `表示の一部でエラーが起きました（${path}）: ${error.message}`;
    reportError(error);
  },

  // ---- settings ----------------------------------------------------------
  get savedSettings() {
    return {
      midiInput: this["settings.midiInput"],
      midiOutput: this["settings.midiOutput"],
      qwerty: this["settings.qwerty"],
      masterVolume: this["settings.masterVolume"],
      click: this["settings.click"],
      midiWanted: this["settings.midiWanted"],
    };
  },
  set savedSettings(v) {
    if (!v || typeof v !== "object") return;
    const cur = this.settings;
    const vol = Number(v.masterVolume);
    this.settings = {
      midiInput: typeof v.midiInput === "string" ? v.midiInput : cur.midiInput,
      midiOutput: typeof v.midiOutput === "string" ? v.midiOutput : cur.midiOutput,
      qwerty: typeof v.qwerty === "boolean" ? v.qwerty : cur.qwerty,
      masterVolume: Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : cur.masterVolume,
      click: typeof v.click === "boolean" ? v.click : cur.click,
      midiWanted: typeof v.midiWanted === "boolean" ? v.midiWanted : cur.midiWanted,
    };
  },
  get masterVolumePercent() { return Math.round(this["settings.masterVolume"] * 100); },

  // ---- sound -------------------------------------------------------------
  get currentSound() {
    return {
      wave: this["sound.wave"], detune: this["sound.detune"], cutoff: this["sound.cutoff"],
      resonance: this["sound.resonance"], attack: this["sound.attack"], decay: this["sound.decay"],
      sustain: this["sound.sustain"], release: this["sound.release"], vibratoRate: this["sound.vibratoRate"],
      delayMix: this["sound.delayMix"], volume: this["sound.volume"],
    };
  },
  get soundQuery() { return M.soundToQuery(this.currentSound); },
  get canonicalQuery() { return M.queryHasSound(this.query) ? M.soundToQuery(M.soundFromQuery(this.query)) : ""; },
  get soundLink() { return `${location.origin}/play?${this.soundQuery}`; },
  get waveLabel() { return M.WAVE_LABELS[this["sound.wave"]] ?? ""; },
  get osc1Detune() { return -this["sound.detune"] / 2 + this.bend * 200; },
  get osc2Detune() { return this["sound.detune"] / 2 + this.bend * 200; },
  get vibratoDepth() { return Math.round((this.modWheel / 127) * 40 * 10) / 10; }, // cents
  get bendText() { return this.bend === 0 ? "0" : `${this.bend > 0 ? "+" : ""}${(this.bend * 2).toFixed(2)}`; },

  syncFromQuery(q) {
    if (!M.queryHasSound(q)) {
      // /play with no sound in the URL: put the current sound there (no new history entry).
      this.replaceUrl = "?" + this.soundQuery;
      return;
    }
    const next = M.soundFromQuery(q);
    if (!M.sameSound(next, this.currentSound)) this.sound = next;
    const raw = M.SOUND_KEYS.map((k) => `${k}=${encodeURIComponent(q[k] ?? "")}`).join("&");
    if (raw !== M.soundToQuery(next)) this.replaceUrl = "?" + M.soundToQuery(next);
  },
  goPlay(values) {
    this.navigateUrl = "/play?" + M.soundToQuery(values);
  },
  resetSound() { this.sound = { ...M.DEFAULT_SOUND }; },

  // ---- notes -------------------------------------------------------------
  get pressedNotes() { return M.soundingNotes(this.notes); },
  get qwertyBase() { return 12 * (this.qwertyOctave + 1); },
  get pianoBase() { return this.qwertyBase - 12; },
  get qwertyRange() { return `${M.noteName(this.qwertyBase)}〜${M.noteName(this.qwertyBase + 12)}`; },
  get pedalDown() { return this["notes.pedal"]; },

  applyActions(actions) {
    for (const a of actions) {
      if (a[0] === "on") this.$command.synthOn.emit(a[1], a[2]);
      else this.$command.synthOff.emit(a[1]);
      if (this.midiOutReady) this.$command.midiSend.emit(M.midiNoteBytes(a[0], a[1], a[2] ?? 0));
    }
  },
  noteDown(note, velocity, src) {
    const r = M.pressNote(this.notes, note, velocity, src);
    this.notes = r.ns;
    this.applyActions(r.actions);
    if (isPlayer(src)) this.capture("on", note, velocity);
  },
  noteUp(note, src) {
    const r = M.releaseNote(this.notes, note, src);
    if (r.ns === this.notes) return;
    this.notes = r.ns;
    this.applyActions(r.actions);
    if (isPlayer(src)) this.capture("off", note, 0);
  },
  setPedal(down) {
    if (down === this["notes.pedal"]) return;
    const r = M.setPedal(this.notes, down);
    this.notes = r.ns;
    this.applyActions(r.actions);
  },
  togglePedal() { this.setPedal(!this["notes.pedal"]); },
  releaseWhere(match, ignorePedal) {
    const r = M.releaseSources(this.notes, match, { ignorePedal });
    if (r.ns === this.notes) return;
    this.notes = r.ns;
    this.applyActions(r.actions);
    for (const a of r.actions) this.capture("off", a[1], 0);
  },
  resetControllers() {
    if (this["notes.pedal"]) this.setPedal(false);
    this.bend = 0;
  },
  focusLost(reason) {
    // The window lost focus: keys held there will never send keyup. A hidden tab: let go of everything played.
    if (reason === "hidden") {
      this.releaseWhere(isPlayer, true);
      this.resetControllers();
    } else {
      this.releaseWhere((src) => src === "qwerty" || src === "screen", false);
    }
  },
  panic() {
    this.notes = M.EMPTY_NOTES;
    this.bend = 0;
    this.$command.synthPanic.emit();
    this.$command.clickPanic.emit();
    if (this.midiOutReady) this.$command.midiSend.emit([0xb0, 123, 0]);
    this.stopPractice();
    this.status = "すべての音を止めました。";
  },
  handleMidi(m) {
    const src = "midi:" + m.port;
    switch (m.type) {
      case "noteon": this.noteDown(m.note, m.velocity, src); break;
      case "noteoff": this.noteUp(m.note, src); break;
      case "controlchange":
        if (m.control === 64) this.setPedal(m.value >= 64);
        else if (m.control === 1) this.modWheel = m.value;
        else if (m.control === 120 || m.control === 123) this.releaseWhere((s) => s === src, true);
        if (this.midiOutReady) this.$command.midiSend.emit(Array.from(m.data));
        break;
      case "pitchbend":
        this.bend = m.value;
        if (this.midiOutReady) this.$command.midiSend.emit(Array.from(m.data));
        break;
      default: break;
    }
  },
  updateLevel(frame) {
    if (!frame || !frame.length) return;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) { const x = (frame[i] - 128) / 128; sum += x * x; }
    const rms = Math.sqrt(sum / frame.length);
    const level = Math.min(1, Math.round(rms * 2 * 100) / 100);
    if (level !== this.level) this.level = level;
  },

  // ---- MIDI --------------------------------------------------------------
  /** @type {{ id: string, label: string }[]} */
  get midiInputs() { return M.portOptions(this.midiDevices, "input"); },
  /** @type {{ id: string, label: string }[]} */
  get midiOutputs() { return M.portOptions(this.midiDevices, "output"); },
  get midiInputAttr() { return this["settings.midiInput"] || null; },
  get midiOutputAttr() { return this["settings.midiOutput"] || null; },
  get midiOutReady() {
    const id = this["settings.midiOutput"];
    return !!id && this.midiPermission === "granted" && this.midiOutputs.some((o) => o.id === id);
  },
  get midiGranted() { return this.midiPermission === "granted"; },
  get midiCanAsk() { return this.midiPermission === "prompt" || this.midiPermission === "denied"; },
  get midiStatus() {
    switch (this.midiPermission) {
      case "unsupported":
        return "このブラウザでは MIDI キーボードが使えません（Chrome や Edge で使えます）。画面のけんばんとコンピューターのキーボードで弾けます。";
      case "denied":
        return "MIDI の使用が許可されていません。ブラウザのサイトの設定で MIDI を許可してから「MIDI キーボードをつなぐ」を押してください。画面とコンピューターのキーボードでは弾けます。";
      case "granted": {
        const n = this.midiInputs.length;
        return n === 0 ? "MIDI は使えます。MIDI キーボードをつないでください。" : `MIDI キーボード ${n} 台がつながっています。`;
      }
      default:
        return this.midiAsked
          ? "ブラウザが MIDI を使ってよいか聞いています。ブラウザの確認で「許可」を選んでください（Firefox ではアドオンの追加を求められます）。"
          : "MIDI キーボードを使うときは「MIDI キーボードをつなぐ」を押してください。";
    }
  },
  get midiDeviceNames() { return this.midiInputs.map((o) => o.label).join("、"); },
  connectMidi() {
    this.midiAsked = true;
    this["settings.midiWanted"] = true;
    this.$command.midiRequest.emit();
  },

  // ---- server: sounds ----------------------------------------------------
  get apiSuffix() {
    const d = this["query.delay"];
    return d ? "?delay=" + encodeURIComponent(d) : "";
  },
  get soundSaveUrl() { return "/api/sounds" + this.apiSuffix; },
  get takeSaveUrl() { return "/api/takes" + this.apiSuffix; },
  get soundsUrl() { return "/api/sounds" + this.apiSuffix; },
  get serverSounds() { return this.soundsList ?? []; },
  get "serverSounds.*.href"() { return "/sounds/" + this["serverSounds.*.id"]; },
  get "serverSounds.*.waveLabel"() { return M.WAVE_LABELS[this["serverSounds.*.values"]?.wave] ?? ""; },
  get soundsErrorText() { return requestMessage(this.soundsError, "先生の音を読みこみ"); },
  playServerSound(e, i) { this.goPlay(this.serverSounds[i].values); },
  retrySounds() { this.$command.reloadSounds.emit(); },

  get mySounds() { return this.localSounds ?? []; },
  get "mySounds.*.href"() { return "/sounds/" + this["mySounds.*.id"]; },
  get "mySounds.*.editing"() { return this.$eqPath("editingId", "mySounds.*.id"); },
  get "mySounds.*.waveLabel"() { return M.WAVE_LABELS[this["mySounds.*.values"]?.wave] ?? ""; },
  playMySound(e, i) { this.goPlay(M.normalizeSound(this.mySounds[i].values)); },
  saveLocal() {
    const err = M.validName(this.localName);
    if (err) { this.localMessage = err; return; }
    const name = this.localName.trim();
    this.localSounds = [...this.mySounds, { id: M.newLocalId(), name, values: M.normalizeSound(this.currentSound) }];
    this.localName = "";
    this.localMessage = `「${name}」をこのコンピューターに保存しました。`;
  },
  startRename(e, i) {
    this.editingId = this.mySounds[i].id;
    this.editName = this.mySounds[i].name;
    this.editError = "";
  },
  cancelRename() { this.editingId = null; this.editError = ""; },
  commitRename(e, i) {
    const err = M.validName(this.editName);
    if (err) { this.editError = err; return; }
    const id = this.mySounds[i].id;
    const name = this.editName.trim();
    this.localSounds = this.mySounds.map((s) => (s.id === id ? { ...s, name } : s));
    this.editingId = null;
    this.status = `名前を「${name}」に変えました。`;
  },
  deleteMySound(e, i) {
    const s = this.mySounds[i];
    if (!confirm(`「${s.name}」を消しますか？`)) return;
    this.localSounds = this.mySounds.filter((x) => x.id !== s.id);
    this.status = `「${s.name}」を消しました。`;
  },

  // /sounds/:id — a teacher sound (number) or one of mine (my-…)
  get detailId() { return this.routeName === "sound" ? String(this["routeParams.id"] ?? "") : ""; },
  get detailIsLocal() { return M.isLocalId(this.detailId); },
  get soundDetailUrl() {
    const id = this.detailId;
    return /^\d+$/.test(id) ? "/api/sounds/" + id + this.apiSuffix : null;
  },
  get detail() {
    const id = this.detailId;
    if (!id) return null;
    if (this.detailIsLocal) {
      const s = this.mySounds.find((x) => x.id === id);
      return s ? { name: s.name, values: M.normalizeSound(s.values), owner: "このコンピューターの音" } : null;
    }
    const v = this.soundDetail;
    return v && String(v.id) === id ? { name: v.name, values: M.normalizeSound(v.values), owner: "先生の音" } : null;
  },
  get detailRows() {
    const v = this.detail?.values;
    if (!v) return [];
    return DETAIL_FIELDS.map((f) => ({ label: f.label, value: f.key === "wave" ? M.WAVE_LABELS[v.wave] : String(v[f.key]) + f.unit }));
  },
  get detailTitle() { return this.detail?.name ?? "音"; },
  get detailState() {
    if (this.detail) return "ready";
    if (this.detailIsLocal) return "missing";
    if (this.soundDetailLoading) return "loading";
    if (this.soundDetailError) return this.soundDetailError.status === 404 ? "missing" : "error";
    return "loading";
  },
  get detailErrorText() { return requestMessage(this.soundDetailError, "音を読みこみ"); },
  playDetail() { if (this.detail) this.goPlay(this.detail.values); },
  retryDetail() { this.$command.reloadSoundDetail.emit(); },

  // teacher save (POST /api/sounds)
  get soundSaveErrorText() { return requestMessage(this.soundSaveError, "保存"); },
  // The server checks the values; its messages go next to the controls (a 422 body: { errors: { field: message } }).
  /** @type {{ name: string, wave: string, detune: string, cutoff: string, resonance: string, attack: string, decay: string, sustain: string, release: string, vibratoRate: string, delayMix: string, volume: string }} */
  get soundFieldErrors() { return fieldErrorsOf(this.soundSaveError); },
  saveTeacherSound() {
    this.soundSaveMessage = "";
    this.soundSaveBody = { name: this["teacher.name"], values: this.currentSound };
    this.soundSaveTrigger = true;
  },

  // ---- practice: clock ---------------------------------------------------
  get transportRunning() { return this.metronomeOn || this.seqOn; },
  get beatDots() {
    return [...Array(this.beatsPerBar).keys()].map((i) => ({
      n: i + 1, on: this.transportRunning && i === this.currentBeat, accent: i === 0,
    }));
  },
  get metronomeLabel() { return this.metronomeOn ? "メトロノームを止める" : "メトロノームを始める"; },
  get seqLabel() { return this.seqOn ? "シーケンサーを止める" : "シーケンサーを始める"; },
  get "seqRows.*.cells.*.current"() { return this.$eqIndex("currentStep", 2); },
  get stepNumbers() { return Array.from({ length: SEQ_STEPS }, (_, i) => ({ n: i + 1, beat: i % 4 === 0 })); },
  get "stepNumbers.*.current"() { return this.$eqIndex("currentStep"); },

  startTransport() {
    if (this.transportRunning) return;
    this.clockT0 = performance.now();
    this.lastBeat = -1;
    this.lastStep = -1;
    this.currentBeat = -1;
    this.currentStep = -1;
  },
  updateClock() {
    const need = this.transportRunning || this.pbActive;
    if (need && !this.clockOn) { this.clockOn = true; this.$command.clockStart.emit(); }
    else if (!need && this.clockOn) { this.clockOn = false; this.$command.clockStop.emit(); }
    if (!this.transportRunning) { this.currentBeat = -1; this.currentStep = -1; }
  },
  toggleMetronome() {
    if (this.metronomeOn) {
      this.metronomeOn = false;
      if (this.recActive) this.stopRecording();
    } else {
      this.startTransport();
      this.metronomeOn = true;
    }
    this.updateClock();
  },
  toggleSequencer() {
    if (this.seqOn) {
      this.seqOn = false;
      this.releaseWhere((s) => s === "seq", true);
    } else {
      this.startTransport();
      this.seqOn = true;
    }
    this.updateClock();
  },
  toggleCell(e, row, col) {
    this.$update("seqRows.*.cells.*.on", [row, col], (on) => !on);
  },
  clearSequence() {
    this.seqRows = this.seqRows.map((r) => ({ ...r, cells: r.cells.map(() => ({ on: false })) }));
  },
  onClock(now) {
    if (this.clickNote !== null) { this.$command.clickOff.emit(this.clickNote); this.clickNote = null; }
    if (this.transportRunning) {
      const a = M.advance({ bpm: this.bpm, t0: this.clockT0 }, now, { beat: this.lastBeat, step: this.lastStep });
      if (a.newBeat !== null) {
        this.lastBeat = a.newBeat;
        this.currentBeat = a.newBeat % this.beatsPerBar;
        if (this.metronomeOn && this["settings.click"]) {
          const accent = this.currentBeat === 0;
          this.clickNote = accent ? CLICK_ACCENT : CLICK_BEAT;
          this.$command.clickOn.emit(this.clickNote, accent ? 1 : 0.6);
        }
      }
      if (a.newStep !== null) {
        this.lastStep = a.newStep;
        this.currentStep = a.newStep % SEQ_STEPS;
        if (this.seqOn) {
          this.releaseWhere((s) => s === "seq", true);
          const col = this.currentStep;
          for (const row of this.seqRows) if (row.cells[col].on) this.noteDown(row.note, 0.8, "seq");
        }
      }
    }
    if (this.pbActive) this.playbackTick(now);
    if (this.recActive && this.recEvents.length >= M.MAX_TAKE_EVENTS) {
      this.stopRecording();
      this.recMessage = "録音は5000イベントまでです。ここで止めました。";
    }
  },
  stopPractice() {
    if (this.recActive) this.stopRecording();
    this.metronomeOn = false;
    this.seqOn = false;
    this.releaseWhere((s) => s === "seq", true);
    this.stopPlayback();
    this.updateClock();
  },

  // ---- practice: recording a take ----------------------------------------
  get recLabel() { return this.recActive ? "録音を止める" : "録音する"; },
  get recCount() { return this.recEvents.length; },
  capture(type, note, velocity) {
    if (!this.recActive) return;
    const t = Math.round(performance.now() - this.recT0);
    this.recEvents = this.recEvents.concat({ t, type, note, velocity });
  },
  toggleRecording() {
    if (this.recActive) { this.stopRecording(); return; }
    if (!this.metronomeOn) this.toggleMetronome();
    this.stopPlayback();
    this.recEvents = [];
    this.recT0 = performance.now();
    this.recActive = true;
    this.recMessage = "録音中です。弾いてください。";
    this.takeSaveMessage = "";
  },
  stopRecording() {
    const end = Math.round(performance.now() - this.recT0);
    const events = M.closeTake(this.recEvents, end);
    this.recActive = false;
    this.recEvents = [];
    if (events.length === 0) { this.recMessage = "何も弾かれませんでした。"; this.draft = null; return; }
    this.draft = { bpm: this.bpm, events, length: end };
    this.recMessage = `録音しました（${M.formatMs(end)}、${events.length} イベント）。`;
  },
  get draftLength() { return this.draft ? M.formatMs(this.draft.length) : ""; },
  get takeSaveErrorText() { return requestMessage(this.takeSaveError, "保存"); },
  /** @type {{ name: string }} */
  get takeFieldErrors() { return fieldErrorsOf(this.takeSaveError); },
  saveDraft() {
    if (!this.draft) return;
    this.takeSaveMessage = "";
    this.takeSaveBody = { name: this.draftName, bpm: this["draft.bpm"], events: this["draft.events"] };
    this.takeSaveTrigger = true;
  },
  playDraft() { if (this.draft) this.startPlayback(this["draft.events"], "いま録音した演奏"); },

  get takesUrl() { return "/api/takes" + this.apiSuffix; },
  get takes() { return this.takesList ?? []; },
  get "takes.*.lengthText"() { return M.formatMs(this["takes.*.length"]); },
  get "takes.*.open"() { return this.$eqPath("openTakeId", "takes.*.id"); },
  get takesErrorText() { return requestMessage(this.takesError, "演奏の一覧を読みこみ"); },
  retryTakes() { this.$command.reloadTakes.emit(); },
  openTakeAt(e, i) { this.openTakeId = this.takes[i].id; },
  get openTakeUrl() { return this.openTakeId ? `/api/takes/${this.openTakeId}${this.apiSuffix}` : null; },
  get openedTake() { const v = this.openTake; return v && v.id === this.openTakeId ? v : null; },
  get openTakeErrorText() { return requestMessage(this.openTakeError, "演奏を読みこみ"); },
  retryOpenTake() { this.$command.reloadOpenTake.emit(); },
  playOpenedTake() { const t = this.openedTake; if (t) this.startPlayback(t.events, t.name); },

  // ---- practice: playback ------------------------------------------------
  get pbLabel() { return this.pbActive ? `「${this.pbName}」を再生中` : ""; },
  startPlayback(events, name) {
    this.stopPlayback();
    this.pbEvents = [...events].sort((a, b) => a.t - b.t);
    this.pbIndex = 0;
    this.pbName = name;
    this.pbT0 = performance.now();
    this.pbActive = true;
    this.updateClock();
  },
  stopPlayback() {
    if (!this.pbActive) return;
    this.pbActive = false;
    this.releaseWhere((s) => s === "take", true);
    this.updateClock();
  },
  playbackTick(now) {
    const t = now - this.pbT0;
    const { due, next } = M.dueEvents(this.pbEvents, this.pbIndex, t);
    for (const e of due) {
      if (e.type === "on") this.noteDown(e.note, e.velocity, "take"); else this.noteUp(e.note, "take");
    }
    if (next !== this.pbIndex) this.pbIndex = next;
    if (next >= this.pbEvents.length && t > M.takeLength(this.pbEvents) + 100) this.stopPlayback();
  },
};
