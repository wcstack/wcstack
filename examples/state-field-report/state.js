// state-field-report — the root state (<wcs-state src="./state.js">). A field report from a phone: a title and a
// note (typed or dictated), the position or an address, and short video clips, sent through an outbox.
//
//   permissions  four <wcs-permission> watchers + what each acquiring element reported last
//   capture      <wcs-camera> → (stream, element to element) → <wcs-recorder>; clips are Blobs in state
//   location     <wcs-geo> fills draft.position; refused or unavailable → the address is asked for
//   dictation    <wcs-listen> appends to the note, <wcs-speak> reads it back — never both at once
//   send         <wcs-fetch> creates the report, then one <wcs-upload> per clip; an outbox while offline;
//                <wcs-notify> when everything is sent while the tab is hidden
//   draft        text + position kept by <wcs-storage type="session">; clips cannot be (a Blob is not JSON)
//
// See README.md for the seams and what building it found.

const PERMS = [
  { name: "camera", label: "Camera" },
  { name: "microphone", label: "Microphone" },
  { name: "geolocation", label: "Location" },
  { name: "notifications", label: "Notifications" },
];

const DENIED_HOWTO = {
  camera: "Camera is blocked. Click the lock icon left of the address → Site settings → Camera → Allow. This page follows the change by itself; then open Capture and press Start camera.",
  microphone: "Microphone is blocked. Lock icon → Site settings → Microphone → Allow. Clips are then recorded with sound, and dictation works.",
  geolocation: "Location is blocked. Lock icon → Site settings → Location → Allow — or keep typing the address on the report; it is sent instead of a position.",
  notifications: "Notifications are blocked. Lock icon → Site settings → Notifications → Allow. Without them the outbox still sends; you just get no alert while the tab is hidden.",
};
const PROMPT_TEXT = {
  camera: "Not asked yet. The browser asks when you press Start camera on Capture.",
  microphone: "Not asked yet. Asked together with the camera (clips have sound), or when you dictate.",
  geolocation: "Not asked yet. The browser asks when you press Get position (here or on Capture).",
  notifications: "Not asked yet. Press Allow notifications below.",
};
// "unsupported" (since 4.5): the browser has no such API, the page is not a secure context, or a
// Permissions-Policy (the server's header, or the allow= of the page that embeds this one) turns it off.
// The site settings cannot change any of those.
const UNSUPPORTED_TEXT = {
  camera: "Not available on this page (no camera API, not a secure origin, or the page that embeds this one does not allow it). Capture is off; the report can still carry text and a position.",
  microphone: "Not available on this page. Clips are recorded without sound, and the note is typed.",
  geolocation: "Not available on this page. Type the address on the report instead.",
  notifications: "Not available on this page. Sending still works; you get no alert while the tab is hidden.",
};

// No wcstack element reports page visibility, so a plain listener feeds `pageHidden`.
let visibilityListener = null;
// `leaveConfirm` is one switch for a reload and a route change; uploads survive a route change but not a
// reload, so pending outbox work asks through a plain beforeunload listener.
let unloadListener = null;

export default {
  // ---- router (output-only members are seeded with their real initial values) ----
  routeName: "",
  /** @type {{ id?: number }} */
  routeParams: {},
  routePath: "",
  navigateUrl: null,

  // ---- <wcs-permission> watchers: one per permission, element → state ----
  /** @type {{ camera: string|null, microphone: string|null, geolocation: string|null, notifications: string|null }} */
  perm: { camera: null, microphone: null, geolocation: null, notifications: null },

  // ---- the acquirers' own view of the same permissions (written by the feature nodes) ----
  notifyPermission: null,
  notifyError: null,
  permGeo: { permission: null, error: null, loading: false, latitude: null, longitude: null, accuracy: null },

  // ---- capture ----
  // <wcs-camera> outputs (derived values only — the MediaStream never enters state)
  cam: { active: false, permission: null, audioPermission: null, devices: null, deviceId: null, error: null, errorInfo: null },
  camEndedCount: 0,
  camNotice: "",
  streamAttached: false,
  // <wcs-recorder> outputs + the live elapsed time from <wcs-timer>
  rec: { recording: false, error: null, errorInfo: null, mimeType: null, elapsed: 0 },
  wake: { held: false, error: null },
  /** @type {{ id: number, blob: Blob, url: string, mimeType: string, duration: number, size: number }[]} */
  clips: [],
  clipSeq: 0,

  // ---- the draft + location ----
  /** @type {{ title: string, note: string, position: { latitude: number, longitude: number, accuracy: number } | null, address: string }} */
  draft: { title: "", note: "", position: null, address: "" },
  geo: { position: null, error: null, errorInfo: null, permission: null, loading: false },

  // ---- dictation / read-back ----
  listen: { final: "", interim: "", listening: false, permission: null, unsupported: false, error: null, errorInfo: null },
  speak: { speaking: false, unsupported: false, error: null, errorInfo: null },
  dictationNote: "",

  // ---- send / outbox ----
  offline: null,
  pageHidden: false,
  sendSeq: 0,
  /** @type {{ localId: number, title: string, note: string, position: { latitude: number, longitude: number, accuracy: number } | null, address: string, clips: { id: number, blob: Blob, size: number, type: string }[], reportId: number | null, phase: string, error: string, fieldErrors: { title?: string } }[]} */
  outbox: [],
  /** @type {{ key: string, localId: number, clipId: number, label: string, url: string, blob: Blob, fileName: string, fileType: string, files: File[] | null, trigger: boolean, progress: number, loading: boolean, error: any, value: any, phase: string, network: boolean, cancelled: boolean }[]} */
  uploads: [],
  creatingLocalId: null,
  createBody: null,
  createTrigger: false,
  createLoading: false,
  createError: null,
  /** @type {{ title?: string }} */
  draftFieldErrors: {},
  sentNotice: "",

  // ---- reports, report detail, stored draft ----
  /** @type {{ id: number, title: string, createdAt: string, mediaCount: number }[] | null} */
  reportsList: null,
  reportsLoading: false,
  reportsError: null,
  /** @type {{ id: number, title: string, note: string, position: { latitude: number, longitude: number, accuracy: number } | null, address: string, createdAt: string, media: { id: number, name: string, type: string, size: number, url: string }[] } | null} */
  report: null,
  reportLoading: false,
  reportError: null,
  draftLoaded: false,
  lostClips: 0,

  $connectedCallback() {
    this.pageHidden = document.visibilityState === "hidden";
    visibilityListener = () => { this.pageHidden = document.visibilityState === "hidden"; };
    document.addEventListener("visibilitychange", visibilityListener);
    unloadListener = (event) => { if (this.outboxBusy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unloadListener);
  },
  $disconnectedCallback() {
    if (visibilityListener) document.removeEventListener("visibilitychange", visibilityListener);
    visibilityListener = null;
    if (unloadListener) window.removeEventListener("beforeunload", unloadListener);
    unloadListener = null;
  },

  $commandTokens: ["reloadList", "notifyRequest", "notify", "permLocate", "locate", "listenStart", "listenStop", "speakText", "speakCancel",
    "camStart", "camStop", "camSwitch", "feedRecorder", "recStart", "recStop", "timerStart", "timerStop", "timerReset"],
  $eventTokens: ["gotStream", "onRecorded", "camEnded", "createResponded", "notifyClicked"],
  $on: {
    // The raw MediaStream is forwarded to the recorder as a command argument — never stored.
    gotStream: (state, event) => {
      state.$command.feedRecorder.emit(event.detail);
      state.streamAttached = true;
    },
    // The recorded Blob (typed by the recorder) is a value; the URL is minted here and owned (revoked) by the app,
    // because the recorder revokes its own objectURL on the next clip and on disconnect. A take cut short —
    // the tracks ended, or the route was left — arrives here too.
    onRecorded: (state, event) => {
      const { blob, mimeType, duration } = event.detail;
      if (!blob || blob.size === 0) return;
      const id = state.clipSeq + 1;
      state.clipSeq = id;
      state.clips = state.clips.concat({ id, blob, url: URL.createObjectURL(blob), mimeType: mimeType || blob.type, duration: duration ?? 0, size: blob.size });
    },
    // the create request answered: only a 2xx carries the report id; failures are read from `createError`
    createResponded: (state, event) => {
      const status = event.detail?.status ?? 0;
      if (status < 200 || status >= 300) return;
      const report = event.detail.value;
      const localId = state.creatingLocalId;
      state.creatingLocalId = null;
      const i = state.$getAll("outbox.*.localId", []).indexOf(localId);
      if (i < 0 || !report) return;
      const clips = state[`outbox.${i}.clips`];
      state[`outbox.${i}.reportId`] = report.id;
      state[`outbox.${i}.error`] = "";
      if (!clips.length) { state.reportSent(i); return; }
      state[`outbox.${i}.phase`] = "uploading";
      // one <wcs-upload> per clip, created only now that the id exists (trigger: true in the literal,
      // and `trigger` is the row's last binding, after `url` and `files`)
      state.uploads = state.uploads.concat(clips.map((c) => ({
        key: `${localId}-${c.id}`, localId, clipId: c.id,
        label: `report #${report.id} · clip #${c.id} (${Math.round(c.size / 1024)} kB)`,
        url: `/api/reports/${report.id}/media`,
        blob: c.blob, fileName: `clip-${c.id}.webm`, fileType: c.type,
        files: [new File([c.blob], `clip-${c.id}.webm`, { type: c.type })],
        trigger: true, progress: 0, loading: false, error: null, value: null,
        phase: "uploading", network: false, cancelled: false,
      })));
    },
    notifyClicked: (state, event) => {
      const id = event.detail?.data?.reportId;
      if (id) { window.focus(); state.navigateUrl = `/reports/${id}`; }
    },
    camEnded: (state) => {
      state.camEndedCount = state.camEndedCount + 1;
      state.camNotice = "The camera stopped by itself (the permission was taken away, or the device went away). What was recorded so far is kept as a clip.";
    },
  },
  $watch: {
    createError(err) {
      if (!err) return;
      const localId = this.creatingLocalId;
      this.creatingLocalId = null;
      const i = this.$getAll("outbox.*.localId", []).indexOf(localId);
      if (i < 0) return;
      if (err.status === 422) {
        let fieldErrors = {};
        try { fieldErrors = JSON.parse(err.body ?? "{}").errors ?? {}; } catch { fieldErrors = {}; }
        this[`outbox.${i}.phase`] = "rejected";
        this[`outbox.${i}.fieldErrors`] = fieldErrors;
        this[`outbox.${i}.error`] = "Refused by the server: " + (Object.entries(fieldErrors).map(([k, v]) => `${k} ${v}`).join(", ") || "invalid");
      } else if (err.status) {
        this[`outbox.${i}.phase`] = "failed";
        this[`outbox.${i}.error`] = `The server failed (${err.status}).`;
      } else {
        this[`outbox.${i}.phase`] = this.offline ? "queued" : "failed";
        this[`outbox.${i}.error`] = this.offline ? "Offline — waiting for the connection." : `Could not reach the server (${err.message ?? "network error"}).`;
      }
    },
    createLoading(cur, prev) { if (prev && !cur) this.pump(); },
    offline(cur, prev) { if (cur === false && prev === true) this.pump(); },
    "uploads.*.value"(v, prev, i) {
      if (!v) return;
      this[`uploads.${i}.phase`] = "done";
      this.checkEntry(this[`uploads.${i}.localId`]);
    },
    // a failure is read from `error` — never from `status` (an HTTP error does not publish it) or
    // `progress` (a refused upload can be at 100)
    "uploads.*.error"(err, prev, i) {
      if (!err) return;
      this[`uploads.${i}.network`] = !err.status;
      this[`uploads.${i}.phase`] = "failed";
      this.markEntry(this[`uploads.${i}.localId`]);
    },
    "uploads.*.loading"(cur, prev, i) {
      if (prev && !cur && this[`uploads.${i}.cancelled`] && !this[`uploads.${i}.value`] && !this[`uploads.${i}.error`]) {
        this[`uploads.${i}.phase`] = "cancelled";
        this.markEntry(this[`uploads.${i}.localId`]);
      }
    },
    "rec.recording"(cur, prev) {
      if (cur) { this.$command.timerReset.emit(); this.$command.timerStart.emit(); }
      else if (prev) { this.$command.timerStop.emit(); }
    },
    routeName(cur, prev) {
      // speech is a page-wide singleton that a disconnect does not cancel
      if (prev === "new" && cur !== "new" && this["speak.speaking"]) this.$command.speakCancel.emit();
      if (cur === "home" && prev && prev !== "home") this.$command.reloadList.emit();
    },
    // a dictation session ended: append what was recognised to the note
    "listen.listening"(cur, prev) {
      if (prev && !cur) {
        const said = (this["listen.final"] ?? "").trim();
        if (said) this["draft.note"] = [this["draft.note"], said].filter(Boolean).join(" ");
        this.dictationNote = said ? `Added: "${said}"` : (this["listen.errorInfo"] ? "" : "Nothing was recognised.");
      }
    },
    "geo.position"(p) {
      if (p) this["draft.position"] = { latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy };
    },
    "cam.active"(cur) { if (!cur) this.streamAttached = false; else this.camNotice = ""; },
  },

  // ---- capture ----
  // "blocked" comes from the permission (live); errorInfo describes the last attempt, not the permission now
  get camBlocked() { return this["perm.camera"] === "denied" || this["cam.permission"] === "denied"; },
  get camUnavailable() { return this["cam.permission"] === "unsupported" || this["perm.camera"] === "unsupported" || this["cam.errorInfo"]?.code === "capability-missing"; },
  get camUnavailableText() {
    const why = this["cam.error"]?.message;
    // the reason (a Permissions-Policy, not a secure context, no API) arrives in `error` after a refused start
    return why ? `The camera is not available on this page. ${why}` : "The camera is not available on this page. The site settings cannot change that; the report can still carry text and a position.";
  },
  get camAllowedAgain() { return !this.camBlocked && !this.camUnavailable && !this["cam.active"] && this["cam.errorInfo"]?.code === "not-allowed"; },
  get camStatus() {
    const info = this["cam.errorInfo"];
    if (this["cam.active"]) return this["rec.recording"] ? "Recording." : "Camera live.";
    if (this.camUnavailable) return "Not available on this page.";
    if (info) return `Camera error: ${info.code}${info.message ? " — " + info.message : ""}`;
    return "Camera off.";
  },
  get camStartDisabled() { return this["cam.active"] || this.camUnavailable; },
  get camCanSwitch() {
    const d = this["cam.devices"];
    return Array.isArray(d) && d.filter((x) => x && x.kind === "videoinput").length > 1;
  },
  get recDisabled() { return !this["cam.active"] || !this.streamAttached || this["rec.recording"]; },
  get recElapsedText() {
    const total = Math.floor((this["rec.elapsed"] ?? 0) / 1000);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  },
  get recErrorText() { const i = this["rec.errorInfo"]; return i ? `Recorder: ${i.code}` : ""; },
  get wakeText() { return this["wake.held"] ? "Screen kept awake" : (this["wake.error"] ? `Wake lock refused (${this["wake.error"].name ?? "error"})` : ""); },
  get "clips.*.label"() {
    const d = this["clips.*.duration"];
    return `#${this["clips.*.id"]} · ${d ? (d / 1000).toFixed(1) + " s" : "?"} · ${Math.round(this["clips.*.size"] / 1024)} kB · ${this["clips.*.mimeType"]}`;
  },
  get hasClips() { return this.clips.length > 0; },

  // ---- location ----
  get geoBlocked() { return this["perm.geolocation"] === "denied" || this["geo.permission"] === "denied"; },
  get geoUnavailable() { return this["perm.geolocation"] === "unsupported" || this["geo.permission"] === "unsupported" || this["geo.errorInfo"]?.code === "capability-missing"; },
  get geoUnavailableText() {
    const why = this["geo.error"]?.message;
    return `Location is not available on this page.${why ? ` ${why}` : ""} Type the address below.`;
  },
  get geoFailed() { return !!this["geo.error"] && !this["draft.position"]; },
  get needAddress() { return this.geoBlocked || this.geoFailed || this.geoUnavailable; },
  get positionText() {
    const p = this["draft.position"];
    if (this["geo.loading"]) return "Getting the position…";
    if (!p) return "No position attached.";
    return `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)} (±${Math.round(p.accuracy)} m)`;
  },
  get geoErrorText() {
    const e = this["geo.error"];
    if (!e || this.geoUnavailable) return "";
    const why = e.code === 1 ? "refused" : e.code === 2 ? "unavailable" : e.code === 3 ? "timed out" : "failed";
    return `Location ${why}. Type the address instead${this.geoBlocked ? "; allow Location in the site settings to get the position later" : ""}.`;
  },
  get geoLocateDisabled() { return this.geoBlocked || this.geoUnavailable; },
  get addressHint() { return this.needAddress ? "(needed: no position)" : "(optional)"; },
  get hasPosition() { return this["draft.position"] !== null; },
  locate() { this.$command.locate.emit(); },
  clearPosition() { this["draft.position"] = null; },

  // ---- dictation ----
  // one microphone, two consumers: the recorder (through the camera) and recognition — and the speaker
  // must not be heard by the listener, so dictation and read-back exclude each other.
  get dictateDisabled() { return this["listen.listening"] || this["speak.speaking"] || this["listen.unsupported"] || this["listen.permission"] === "unsupported" || this["perm.microphone"] === "denied"; },
  get readDisabled() { return this["listen.listening"] || this["speak.unsupported"] || !this["draft.note"]; },
  get listenText() {
    if (this["listen.unsupported"] || this["listen.permission"] === "unsupported") return "Dictation is not available on this page — type the note.";
    const i = this["listen.errorInfo"];
    if (i) {
      const why = { "not-allowed": "the microphone is blocked", "network-error": "the speech service could not be reached", "no-speech": "nothing was heard", "not-readable": "the microphone could not be read", "capability-missing": "it is not available on this page", aborted: "it was interrupted" }[i.code] ?? i.code;
      return `Dictation failed: ${why}. Type the note instead.`;
    }
    if (this["listen.listening"]) return `Listening… ${this["listen.interim"] ?? ""}`;
    return this.dictationNote;
  },
  get speakStatus() {
    if (this["speak.unsupported"]) return "Reading aloud is not available in this browser.";
    const i = this["speak.errorInfo"];
    if (i) return `Reading aloud failed: ${i.code}.`;
    return this["speak.speaking"] ? "Reading the note aloud…" : "";
  },
  dictate() { if (!this.dictateDisabled) { this.dictationNote = ""; this.$command.listenStart.emit(); } },
  stopDictation() { this.$command.listenStop.emit(); },
  readBack() { if (!this.readDisabled) this.$command.speakText.emit(this["draft.note"]); },
  stopReading() { this.$command.speakCancel.emit(); },

  // ---- the stored draft, the leave prompt, the reports ----
  // The draft as one stored object (the storage README's accessor pair). Clips are counted, not stored:
  // a Blob is not JSON (the storage element warns [wcs/storage-unserializable]).
  get draftSnapshot() {
    return { title: this["draft.title"], note: this["draft.note"], position: this["draft.position"], address: this["draft.address"], clipCount: this.clips.length };
  },
  set draftSnapshot(v) {
    if (v && typeof v === "object") {
      this.draft = { title: v.title ?? "", note: v.note ?? "", position: v.position ?? null, address: v.address ?? "" };
      if (!this.draftLoaded && v.clipCount > 0 && this.clips.length === 0) this.lostClips = v.clipCount;
    }
    this.draftLoaded = true;
  },
  get lostClipsText() {
    const n = this.lostClips;
    return n ? `${n} clip${n > 1 ? "s" : ""} recorded before the page was reloaded could not be kept — the browser storage cannot hold video. Record ${n > 1 ? "them" : "it"} again.` : "";
  },
  dismissLostClips() { this.lostClips = 0; },
  get leavePrompt() {
    if (this.routeName !== "new") return null;
    if (this["rec.recording"]) return "A clip is being recorded. Leaving stops it; what was recorded so far is kept. Leave?";
    return this.draftEmpty ? null : "This report is not sent yet. Leave the page? (The text is kept; clips are kept until the tab is closed or reloaded.)";
  },
  get reports() { return this.reportsList ?? []; },
  get "reports.*.href"() { return `/reports/${this["reports.*.id"]}`; },
  get "reports.*.when"() { const d = this["reports.*.createdAt"]; return d ? new Date(d).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC" : ""; },
  get reportsEmpty() { return !this.reportsLoading && this.reports.length === 0 && !this.reportsError; },
  get reportUrl() { return this.routeName === "report" ? `/api/reports/${this["routeParams.id"]}` : null; },
  // the fetched value can still be the previous report while the next one loads
  get shownReport() { return this["report.id"] === this["routeParams.id"] && this.routeName === "report" ? this.report : null; },
  get reportNotFound() { return this.routeName === "report" && this["reportError.status"] === 404; },
  get reportFailed() { return this.routeName === "report" && !!this.reportError && this["reportError.status"] !== 404; },
  get reportMedia() { return this["shownReport.media"] ?? []; },
  get reportPositionText() {
    const p = this["shownReport.position"];
    if (p) return `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)} (±${Math.round(p.accuracy)} m)`;
    return this["shownReport.address"] ? `Address: ${this["shownReport.address"]}` : "No position.";
  },
  get "reportMedia.*.isVideo"() { return String(this["reportMedia.*.type"]).startsWith("video/"); },

  // ---- send / outbox ----
  get netText() { return this.offline ? "offline" : this.offline === false ? "online" : ""; },
  get draftEmpty() {
    return !this["draft.title"] && !this["draft.note"] && !this["draft.position"] && !this["draft.address"] && this.clips.length === 0;
  },
  get sendHint() {
    if (this.offline) return "Offline: the report waits in the outbox and goes when the connection is back.";
    return this.draftEmpty ? "Nothing to send yet." : "";
  },
  get titleErrorText() { const t = this["draftFieldErrors.title"]; return t ? `Title: ${t}` : ""; },
  get outboxBusy() { return this.$getAll("outbox.*.phase", []).some((p) => p !== "sent"); },
  get outboxEmpty() { return this.outbox.length === 0; },
  get "outbox.*.isRejected"() { return this["outbox.*.phase"] === "rejected"; },
  get "outbox.*.isFailed"() { return this["outbox.*.phase"] === "failed"; },
  get "outbox.*.isSent"() { return this["outbox.*.phase"] === "sent"; },
  get "outbox.*.label"() { return (this["outbox.*.title"] || "(no title)") + (this["outbox.*.reportId"] ? ` — #${this["outbox.*.reportId"]}` : ""); },
  get "uploads.*.canRetry"() { const p = this["uploads.*.phase"]; return p === "failed" || p === "cancelled"; },
  get "uploads.*.phaseText"() {
    const p = this["uploads.*.phase"];
    if (p === "uploading") return this["uploads.*.loading"] ? `uploading ${this["uploads.*.progress"]}%` : "starting…";
    if (p === "done") return "sent";
    if (p === "cancelled") return "cancelled";
    if (p === "failed") {
      const e = this["uploads.*.error"];
      const st = e?.status;
      if (!st) return this.offline ? "failed: offline — goes again when the connection is back" : `failed: ${e?.message ?? "network error"}`;
      return `failed: ${st === 413 ? "too large for the server" : st === 415 ? "type not accepted" : st === 404 ? "report not found" : "server error " + st}`;
    }
    return p;
  },

  send() {
    if (this.draftEmpty) return;
    const localId = this.sendSeq + 1;
    this.sendSeq = localId;
    const clips = this.clips.map((c) => ({ id: c.id, blob: c.blob, size: c.size, type: c.blob.type }));
    this.clips.forEach((c) => URL.revokeObjectURL(c.url));
    this.outbox = this.outbox.concat({
      localId, title: this["draft.title"], note: this["draft.note"], position: this["draft.position"], address: this["draft.address"],
      clips, reportId: null, phase: "queued", error: this.offline ? "Offline — waiting for the connection." : "", fieldErrors: {},
    });
    this.draft = { title: "", note: "", position: null, address: "" };
    this.clips = [];
    this.draftFieldErrors = {};
    this.sentNotice = "";
    this.pump();
  },
  pump() {
    if (this.offline || this.creatingLocalId !== null || this.createLoading) return;
    const i = this.$getAll("outbox.*.phase", []).indexOf("queued");
    if (i >= 0) {
      this.creatingLocalId = this[`outbox.${i}.localId`];
      this[`outbox.${i}.phase`] = "creating";
      this[`outbox.${i}.error`] = "";
      this.createBody = { title: this[`outbox.${i}.title`], note: this[`outbox.${i}.note`], position: this[`outbox.${i}.position`], address: this[`outbox.${i}.address`] };
      this.createTrigger = true;
      return;
    }
    // uploads that failed because the connection went away go again by themselves
    this.$getAll("uploads.*.phase", []).forEach((p, j) => {
      if (p === "failed" && this[`uploads.${j}.network`]) this.retryUpload(null, j);
    });
  },
  uploadPhasesOf(localId) {
    const ids = this.$getAll("uploads.*.localId", []);
    return this.$getAll("uploads.*.phase", []).filter((_, j) => ids[j] === localId);
  },
  markEntry(localId) {
    const i = this.$getAll("outbox.*.localId", []).indexOf(localId);
    if (i < 0) return;
    if (this.uploadPhasesOf(localId).some((p) => p === "failed" || p === "cancelled")) {
      this[`outbox.${i}.phase`] = "incomplete";
      this[`outbox.${i}.error`] = "Some clips did not go: retry them below.";
    }
  },
  checkEntry(localId) {
    const phases = this.uploadPhasesOf(localId);
    if (phases.length && phases.every((p) => p === "done")) {
      const i = this.$getAll("outbox.*.localId", []).indexOf(localId);
      if (i >= 0) this.reportSent(i);
    }
  },
  reportSent(i) {
    const reportId = this[`outbox.${i}.reportId`];
    const title = this[`outbox.${i}.title`];
    const count = this[`outbox.${i}.clips`].length;
    this[`outbox.${i}.phase`] = "sent";
    this[`outbox.${i}.error`] = "";
    const msg = `Report #${reportId} "${title}" is sent${count ? ` with ${count} clip${count > 1 ? "s" : ""}` : ""}.`;
    this.sentNotice = msg;
    this.$command.reloadList.emit();
    if (this.pageHidden) {
      if (this.notifyPermission === "granted") {
        this.$command.notify.emit("Report sent", { body: msg, tag: `report-${reportId}`, data: { reportId } });
      } else {
        this.sentNotice = msg + " (No notification was shown: notifications are not allowed.)";
      }
    }
  },
  retryEntry(event, i) {
    this[`outbox.${i}.phase`] = "queued";
    this[`outbox.${i}.error`] = "";
    this.pump();
  },
  editRejected(event, i) {
    if (!this.draftEmpty) { this[`outbox.${i}.error`] = "Your draft is not empty: send or clear it first."; return; }
    const clips = this[`outbox.${i}.clips`];
    this.draft = { title: this[`outbox.${i}.title`], note: this[`outbox.${i}.note`], position: this[`outbox.${i}.position`], address: this[`outbox.${i}.address`] };
    this.clips = clips.map((c) => ({ id: c.id, blob: c.blob, url: URL.createObjectURL(c.blob), mimeType: c.type, duration: 0, size: c.size }));
    this.draftFieldErrors = this[`outbox.${i}.fieldErrors`] ?? {};
    this.outbox = this.outbox.toSpliced(i, 1);
    this.navigateUrl = "/new";
  },
  openSent(event, i) { const id = this[`outbox.${i}.reportId`]; if (id) this.navigateUrl = `/reports/${id}`; },
  dismissSent(event, i) {
    const localId = this[`outbox.${i}.localId`];
    this.uploads = this.uploads.filter((u) => u.localId !== localId);
    this.outbox = this.outbox.toSpliced(i, 1);
  },
  retryUpload(event, i) {
    this[`uploads.${i}.cancelled`] = false;
    this[`uploads.${i}.network`] = false;
    this[`uploads.${i}.phase`] = "uploading";
    // An upload uses its `files` up (done or aborted, <wcs-upload> sets them back to null, and the two-way
    // binding carries that into the row), so a retry hands the file over again before `trigger`.
    this[`uploads.${i}.files`] = [new File([this[`uploads.${i}.blob`]], this[`uploads.${i}.fileName`], { type: this[`uploads.${i}.fileType`] })];
    this[`uploads.${i}.trigger`] = true;
    const li = this.$getAll("outbox.*.localId", []).indexOf(this[`uploads.${i}.localId`]);
    if (li >= 0) { this[`outbox.${li}.phase`] = "uploading"; this[`outbox.${li}.error`] = ""; }
  },
  // A command token fans out to every row, so aborting *one* row's upload reaches that row's element from the
  // click (README, "Known limits").
  cancelUpload(event, i) {
    this[`uploads.${i}.cancelled`] = true;
    event?.target?.closest(".upload-row")?.querySelector("wcs-upload")?.abort();
  },

  startCamera() { this.$command.camStart.emit(); },
  stopCamera() { this.$command.camStop.emit(); },
  switchCamera() { this.$command.camSwitch.emit(); },
  startRecording() { if (!this.recDisabled) this.$command.recStart.emit(); },
  stopRecording() { this.$command.recStop.emit(); },
  discardClip(event, index) {
    const clip = this.clips[index];
    if (clip) URL.revokeObjectURL(clip.url);
    this.clips = this.clips.toSpliced(index, 1);
  },

  // ---- the permissions page ----
  get permRows() {
    return PERMS.map((p) => {
      const state = this[`perm.${p.name}`] ?? "checking";
      const advice = state === "granted" ? "Allowed."
        : state === "denied" ? DENIED_HOWTO[p.name]
        : state === "prompt" ? PROMPT_TEXT[p.name]
        : state === "unsupported" ? UNSUPPORTED_TEXT[p.name]
        : "Checking…";
      const acquirer = p.name === "notifications" ? (this.notifyPermission ?? "—")
        : p.name === "geolocation" ? (this["permGeo.permission"] ?? "—")
        : p.name === "camera" ? (this["cam.permission"] ?? "—")
        : (this["cam.audioPermission"] ?? "—");
      return { name: p.name, label: p.label, state, advice, acquirer, isDenied: state === "denied", isGranted: state === "granted" };
    });
  },
  get notifyAskDisabled() { return this["perm.notifications"] === "granted" || this["perm.notifications"] === "denied" || this["perm.notifications"] === "unsupported"; },
  get permGeoText() {
    const lat = this["permGeo.latitude"];
    if (this["permGeo.loading"]) return "Asking for the position…";
    if (this["permGeo.error"]) return `Location failed: ${this["permGeo.error"].message ?? this["permGeo.error"].code}`;
    if (lat == null) return "";
    return `Position ok: ${lat.toFixed(5)}, ${this["permGeo.longitude"].toFixed(5)} (±${Math.round(this["permGeo.accuracy"])} m)`;
  },

  askNotifications() { this.$command.notifyRequest.emit(); },
  askLocation() { this.$command.permLocate.emit(); },
};
