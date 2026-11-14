// State of the みどり市民駅伝 entry wizard (@wcstack/state 4.23.0).
import * as L from "./lib/entry-logic.js";
import { ime } from "./lib/ime.js";

const newId = () => "r" + Math.random().toString(36).slice(2, 10);
const fresh = () => L.emptyEntry(newId);
const init = fresh();
const DRAFT_VERSION = 1;
const touched = new WeakSet();   // fields the user has typed in (for "check a field when the user leaves it")

function emptyErrs() {
  return {
    team: { name: "", kana: "", division: "" },
    rep: { name: { family: "", given: "" }, kana: { family: "", given: "" }, birth: "", postal: "", prefecture: "",
      city: "", street: "", building: "", phone: "", email: "", emailConfirm: "" },
    runners: "",
    options: { parking: "", lunchJa: "", lunchWestern: "", message: "", receiptName: "", payment: "", transferName: "", store: "" },
  };
}
const NO_RUNNER_ERR = { name: "", kana: "", birth: "", sex: "", best: "", shirt: "", emergencyPhone: "", notes: "", consentId: "" };
const NO_UPLOAD = { slot: -1, loading: false, progress: 0, error: "", canRetry: false };
const TOP_PATHS = [
  "team.name", "team.kana", "team.division",
  "rep.name.family", "rep.name.given", "rep.kana.family", "rep.kana.given", "rep.birth", "rep.postal", "rep.prefecture",
  "rep.city", "rep.street", "rep.building", "rep.phone", "rep.email", "rep.emailConfirm",
  "options.parking", "options.lunchJa", "options.lunchWestern", "options.message", "options.receiptName",
  "options.receiptTouched", "options.payment", "options.transferName", "options.store",
  "kanaTouched.team", "kanaTouched.repFamily", "kanaTouched.repGiven",
];
const RUNNER_FIELDS = ["name", "kana", "kanaTouched", "birth", "sex", "best", "shirt", "emergencyPhone", "notes", "consentId", "consentName"];
const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const fieldOf = (el) => el?.closest?.("[data-path]") ?? null;
const rowIdOf = (el) => el?.closest?.("[data-runner-id]")?.dataset.runnerId ?? null;
const isMidori = (el) => el?.tagName?.startsWith("MIDORI-");
const later = (fn) => setTimeout(fn, 0);

export default {
  // ---------------- the entry ----------------
  // Written out as literals (not `init.team`) so that the lint checks every bound path: a member of a value it
  // cannot read is unknown to it (`wcs/path-dynamic-unknown`). Keep in step with emptyEntry() in entry-logic.js.
  team: { name: "", kana: "", division: "" },
  rep: { name: { family: "", given: "" }, kana: { family: "", given: "" }, birth: "", postal: "", prefecture: "",
    city: "", street: "", building: "", phone: "", email: "", emailConfirm: "" },
  /** @type {{ id: string, name: string, kana: string, kanaTouched: boolean, birth: string, sex: string, best: string, shirt: string, emergencyPhone: string, notes: string, consentId: string, consentName: string, detailsOpen: boolean }[]} */
  runners: init.runners,
  options: { parking: 0, lunchJa: 0, lunchWestern: 0, message: "", receiptName: "", receiptTouched: false, payment: "",
    transferName: "", store: "" },
  kanaTouched: { team: false, repFamily: false, repGiven: false },

  // ---------------- messages ----------------
  errs: {
    team: { name: "", kana: "", division: "" },
    rep: { name: { family: "", given: "" }, kana: { family: "", given: "" }, birth: "", postal: "", prefecture: "",
      city: "", street: "", building: "", phone: "", email: "", emailConfirm: "" },
    runners: "",
    options: { parking: "", lunchJa: "", lunchWestern: "", message: "", receiptName: "", payment: "", transferName: "", store: "" },
  },
  /** @type {Record<string, Record<string, string>>} */
  runnerErrs: {},
  generalErrors: "",
  agreed: false,
  agreeError: "",
  sendMessage: "",
  postalMessage: "",
  status: "",

  // ---------------- router ----------------
  routeName: "",
  routePath: "",
  /** @type {Record<string, string>} */
  searchParams: {},
  navigateUrl: null,
  replaceUrl: null,
  pendingFocus: "",
  /** The last wizard step the user was on (the router also visits "landing" and "done", which are not steps). */
  lastStep: "team",

  // ---------------- I/O ----------------
  /** @type {{ value: { code: string, name: string }[] | null, error: any, loading: boolean, status: number, trigger: boolean }} */
  prefFetch: { value: null, error: null, loading: false, status: 0, trigger: false },
  postalLookupCode: "",
  /** @type {{ code: string, prefecture: string, city: string, street: string } | null} */
  postalSnapshot: null,
  postalFetch: { value: null, error: null, loading: false, status: 0 },
  /** What the last lookup put in the address fields (a field still holding it may be replaced by the next lookup). */
  lookupFilled: { prefecture: "", city: "", street: "" },
  teamNameCommitted: "",
  teamNameSettled: null,
  /** @type {{ value: { available: boolean } | null, error: any, loading: boolean, status: number }} */
  availFetch: { value: null, error: null, loading: false, status: 0 },
  /** @type {{ runnerId: string, files: File[] | null, file: File | null, fileName: string, progress: number, loading: boolean, result: { id: string, name: string } | null, error: any, status: number }[]} */
  uploads: [],
  /** @type {{ body: object | null, trigger: boolean, value: { id: string, total: number } | null, error: any, loading: boolean, status: number }} */
  submitReq: { body: null, trigger: false, value: null, error: null, loading: false, status: 0 },
  sending: false,
  /** @type {{ id: string, total: number, team: string } | null} */
  receipt: null,

  $listKeys: { runners: "id" },
  $eventTokens: ["postalResponded"],

  // ================= draft (one localStorage key, shared by every tab) =================
  get "runners.*.saved"() {
    return {
      id: this[".id"], name: this[".name"], kana: this[".kana"], kanaTouched: this[".kanaTouched"], birth: this[".birth"],
      sex: this[".sex"], best: this[".best"], shirt: this[".shirt"], emergencyPhone: this[".emergencyPhone"],
      notes: this[".notes"], consentId: this[".consentId"], consentName: this[".consentName"],
    };
  },
  get draft() {
    return {
      version: DRAFT_VERSION,
      step: this.lastStep,
      team: { name: this["team.name"], kana: this["team.kana"], division: this["team.division"] },
      rep: {
        name: { family: this["rep.name.family"], given: this["rep.name.given"] },
        kana: { family: this["rep.kana.family"], given: this["rep.kana.given"] },
        birth: this["rep.birth"], postal: this["rep.postal"], prefecture: this["rep.prefecture"], city: this["rep.city"],
        street: this["rep.street"], building: this["rep.building"], phone: this["rep.phone"], email: this["rep.email"],
        emailConfirm: this["rep.emailConfirm"],
      },
      runners: this.$getAll("runners.*.saved", []),
      options: {
        parking: this["options.parking"], lunchJa: this["options.lunchJa"], lunchWestern: this["options.lunchWestern"],
        message: this["options.message"], receiptName: this["options.receiptName"],
        receiptTouched: this["options.receiptTouched"], payment: this["options.payment"],
        transferName: this["options.transferName"], store: this["options.store"],
      },
      kanaTouched: { team: this["kanaTouched.team"], repFamily: this["kanaTouched.repFamily"], repGiven: this["kanaTouched.repGiven"] },
    };
  },
  set draft(v) {
    if (!v || v.version !== DRAFT_VERSION) return;   // null on a first visit; another shape: ignore
    // (a field being composed here is not written until its composition is over — @wcstack/state 4.23's forms
    // add-on — and what the user types meanwhile is saved again: the last writer wins)
    if (["team", "runners", "options", "confirm"].includes(v.step) && v.step !== this.lastStep) this.lastStep = v.step;
    for (const path of TOP_PATHS) {
      const next = getPath(v, path);
      if (next !== undefined && this[path] !== next) this[path] = next;
    }
    const current = new Map(this.runners.map((r) => [r.id, r]));
    const rows = (Array.isArray(v.runners) ? v.runners : []).filter((r) => r && typeof r.id === "string").map((saved) => {
      const old = current.get(saved.id);
      const row = { ...L.newRunner(saved.id), ...saved, detailsOpen: old?.detailsOpen ?? false };
      return row;
    });
    if (rows.length) this.runners = rows;   // $listKeys: rows are matched by id, only changed fields are written
  },

  // ================= derived =================
  get fee() {
    return L.feeBreakdown({
      division: this["team.division"], runnerCount: this["runners.length"], parking: this["options.parking"],
      lunchJa: this["options.lunchJa"], lunchWestern: this["options.lunchWestern"],
    });
  },
  get feeText() { return L.formatYen(this.fee.total); },
  get feeDetail() {
    const f = this.fee;
    const parts = [];
    if (f.base) parts.push(`参加料 ${L.formatYen(f.base)}`);
    if (f.reserveFee) parts.push(`補欠 ${f.reserves}人 ${L.formatYen(f.reserveFee)}`);
    if (f.parkingFee) parts.push(`駐車券 ${L.formatYen(f.parkingFee)}`);
    if (f.lunchFee) parts.push(`弁当 ${L.formatYen(f.lunchFee)}`);
    return parts.join(" ＋ ") || "部門を選ぶと参加料が表示されます";
  },
  get completion() { return L.completedSteps(this.draft); },
  get stepHasError() {
    const e = this.errs;
    const any = (o) => Object.values(o).some((v) => (typeof v === "object" ? any(v) : Boolean(v)));
    return {
      team: any(e.team) || any(e.rep),
      runners: Boolean(e.runners) || Object.values(this.runnerErrs).some((o) => any(o)),
      options: any(e.options),
    };
  },
  get steps() {
    const done = this.completion; const err = this.stepHasError; const cur = this.routeName;
    return L.STEPS.map((s, i) => ({
      key: s.key, label: s.label, num: i + 1,
      current: s.key === cur,
      complete: cur === "done" ? true : Boolean(done[s.key]),
      error: Boolean(err[s.key]),
      ariaCurrent: s.key === cur ? "step" : null,
      state: err[s.key] ? "エラーあり" : s.key === cur ? "現在のステップ" : (cur === "done" || done[s.key]) ? "完了" : "",
    }));
  },
  get stepTitle() { return L.STEPS.find((s) => s.key === this.routeName)?.label ?? ""; },
  get fromConfirm() { return this.searchParams?.from === "confirm"; },
  get nextLabel() { return this.fromConfirm ? "確認に戻る" : "次へ"; },
  get isTeamStep() { return this.routeName === "team"; },

  // step 1
  get teamNameCount() { return `${L.charCount(this["team.name"])} / 20文字`; },
  get teamNameOver() { return L.charCount(this["team.name"]) > 20; },
  get repPostalText() { return L.formatPostal(this["rep.postal"]); },
  get repPhoneText() { return L.formatPhone(this["rep.phone"]); },
  get prefectures() { return this["prefFetch.value"] ?? []; },
  get "prefectures.*.selected"() { return this.$eqPath("rep.prefecture", "prefectures.*.code"); },
  get prefLoadFailed() { return Boolean(this["prefFetch.error"]) && !this["prefFetch.loading"]; },
  get availUrl() {
    const n = this.teamNameSettled;
    return n && n.trim() && L.charCount(n) <= 20 ? `/api/teams/available?name=${encodeURIComponent(n)}` : "";
  },
  get nameCheckText() {
    const name = this["team.name"];
    if (!name.trim() || this.teamNameSettled !== name) return "";
    if (this["availFetch.loading"]) return "使えるか確認しています…";
    if (this["availFetch.error"]) return "チーム名を確認できませんでした。";
    const v = this["availFetch.value"];
    if (!v) return "";
    return v.available ? "このチーム名は使えます。" : "このチーム名はすでに使われています。";
  },
  get nameTaken() { return this["availFetch.value"]?.available === false && this.teamNameSettled === this["team.name"]; },
  get postalUrl() { return this.postalLookupCode ? `/api/postal/${this.postalLookupCode}` : ""; },
  get postalLooking() { return this["postalFetch.loading"] && Boolean(this.postalLookupCode); },
  get postalStatusText() { return this.postalLooking ? "住所を調べています…" : this.postalMessage; },

  // step 2
  get "runners.*.leg"() { return L.legLabel(this.$1); },
  get "runners.*.isReserve"() { return this.$1 >= L.LEGS; },
  get "runners.*.isFirst"() { return this.$1 === 0; },
  get "runners.*.isLast"() { return this.$1 === this["runners.length"] - 1; },
  get "runners.*.bestText"() { return L.formatTime(this[".best"]); },
  get "runners.*.emergencyText"() { return L.formatPhone(this[".emergencyPhone"]); },
  get "runners.*.needsConsent"() { return L.needsConsent(this[".birth"]); },
  get "runners.*.hasConsent"() { return Boolean(this[".consentId"]); },
  /** @returns {{ name: string, kana: string, birth: string, sex: string, best: string, shirt: string, emergencyPhone: string, notes: string, consentId: string }} */
  get "runners.*.err"() {
    const e = this.runnerErrs[this[".id"]];
    return e ? { ...NO_RUNNER_ERR, ...e } : NO_RUNNER_ERR;
  },
  get "runners.*.ids"() {
    const id = this[".id"];
    const f = (k) => `r-${id}-${k}`;
    return {
      name: f("name"), kana: f("kana"), birth: f("birth"), sex: f("sex"), best: f("best"), shirt: f("shirt"),
      emergencyPhone: f("emergency"), notes: f("notes"), consent: f("consent"),
      nameErr: f("name-err"), kanaErr: f("kana-err"), birthErr: f("birth-err"), sexErr: f("sex-err"), bestErr: f("best-err"),
      shirtErr: f("shirt-err"), emergencyErr: f("emergency-err"), notesErr: f("notes-err"), consentErr: f("consent-err"),
      legend: f("legend"),
    };
  },
  get "runners.*.up"() {
    const id = this[".id"];
    const i = this.uploads.findIndex((u) => u.runnerId === id);
    if (i < 0) return NO_UPLOAD;
    const error = this[`uploads.${i}.error`];
    const status = this[`uploads.${i}.status`];
    let msg = "";
    if (error) msg = status === 413 ? "ファイルが大きすぎます（5MBまで）。" : status === 415 ? "PDF・JPEG・PNG のファイルを選んでください。" : "アップロードできませんでした。";
    return { slot: i, loading: this[`uploads.${i}.loading`], progress: this[`uploads.${i}.progress`] ?? 0, error: msg,
      canRetry: Boolean(error) && Boolean(this[`uploads.${i}.file`]) && status !== 413 && status !== 415 };
  },
  get canAddRunner() { return this["runners.length"] < L.MAX_RUNNERS; },
  get runnerCountText() {
    const n = this["runners.length"];
    return `走者 ${Math.min(n, L.LEGS)}人 ＋ 補欠 ${Math.max(0, n - L.LEGS)}人（最大${L.MAX_RUNNERS}人）`;
  },

  // step 3
  get messageCount() { return `${L.charCount(this["options.message"])} / 400文字`; },
  get messageOver() { return L.charCount(this["options.message"]) > 400; },
  get receiptNameField() { return this["options.receiptTouched"] ? this["options.receiptName"] : this["team.name"]; },
  set receiptNameField(v) { this["options.receiptTouched"] = true; this["options.receiptName"] = v; },
  get isTransfer() { return this["options.payment"] === "transfer"; },
  get isKonbini() { return this["options.payment"] === "konbini"; },
  get stores() { return L.STORES.map((name) => ({ name })); },

  // step 4
  get confirmView() {
    const d = this.draft; const api = L.toApiEntry(d);
    const pref = (this["prefFetch.value"] ?? L.PREFECTURES).find((p) => p.code === d.rep.prefecture)?.name ?? d.rep.prefecture;
    const pay = L.PAYMENTS.find((p) => p.value === d.options.payment)?.label ?? "";
    return {
      teamName: d.team.name, teamKana: d.team.kana, division: d.team.division,
      repName: `${d.rep.name.family}　${d.rep.name.given}`, repKana: `${d.rep.kana.family}　${d.rep.kana.given}`,
      repBirth: L.formatDateJa(d.rep.birth), postal: d.rep.postal ? `〒${L.formatPostal(d.rep.postal)}` : "",
      address: `${pref}${d.rep.city}${d.rep.street}${d.rep.building ? "　" + d.rep.building : ""}`,
      phone: L.formatPhone(d.rep.phone), email: d.rep.email,
      parking: `${d.options.parking}枚`, lunchJa: `${d.options.lunchJa}個`, lunchWestern: `${d.options.lunchWestern}個`,
      message: d.options.message || "（なし）", receiptName: api.options.receiptName,
      payment: pay + (d.options.payment === "transfer" ? `（振込名義：${d.options.transferName}）` : d.options.payment === "konbini" ? `（${d.options.store}）` : ""),
      total: L.formatYen(this.fee.total), detail: this.feeDetail,
    };
  },
  get runnersView() {
    return this.$getAll("runners.*.saved", []).map((r, i) => ({
      key: r.id, leg: L.legLabel(i), name: r.name, kana: r.kana, birth: L.formatDateJa(r.birth),
      age: L.ageOn(r.birth) ?? "", sex: L.SEXES.find((s) => s.value === r.sex)?.label ?? "",
      best: L.formatTime(r.best), shirt: r.shirt, emergencyPhone: L.formatPhone(r.emergencyPhone) || "（なし）",
      notes: r.notes || "（なし）", consent: L.needsConsent(r.birth) ? (r.consentName || "未提出") : "不要",
    }));
  },
  get receiptTotal() { return this.receipt ? L.formatYen(this.receipt.total) : ""; },

  // ================= field plumbing =================
  readField(el) {
    const f = fieldOf(el); const path = f?.dataset.path;
    if (!path) return undefined;
    if (!path.includes("*")) return this[path];
    const idx = this.runners.findIndex((r) => r.id === rowIdOf(f));
    return idx < 0 ? undefined : this.$resolve(path, [idx]);
  },
  writeField(el, value) {
    const f = fieldOf(el); const path = f?.dataset.path;
    if (!path) return;
    if (!path.includes("*")) { if (this[path] !== value) this[path] = value; return; }
    const idx = this.runners.findIndex((r) => r.id === rowIdOf(f));
    if (idx >= 0 && this.$resolve(path, [idx]) !== value) this.$resolve(path, [idx], value);
  },
  /**
   * Normalise a formatting field (phone / 〒 / time): keep digits, show them formatted, keep the caret.
   * These fields are bound `value#ro:` and written here: formatting while the user types and keeping the caret
   * is the page's to do (docs/forms.md, "A field that changes what is typed").
   */
  formatField(el) {
    if (ime.isComposing(el)) return;   // never rewrite a field under the IME
    const raw = el.value;
    const focused = document.activeElement === el;
    const previous = this.readField(el);
    const r = L.reformat(el.dataset.format, raw, focused ? el.selectionStart ?? raw.length : raw.length, typeof previous === "string" ? previous : null);
    if (raw !== r.text) {
      el.value = r.text;
      if (focused) el.setSelectionRange(r.caret, r.caret);
    }
    this.writeField(el, r.digits);
    if (el.dataset.format === "postal" && f_isRepPostal(el)) this.postalChanged(r.digits);
  },
  /** A kana field: hiragana and half-width katakana become full-width katakana, outside composition. */
  kanaField(el, fromUser) {
    if (fromUser) this.writeTouched(el);
    if (ime.isComposing(el)) return;
    const raw = el.value;
    const focused = document.activeElement === el;
    const r = L.toKatakanaWithCaret(raw, focused ? el.selectionStart ?? raw.length : raw.length);
    if (raw !== r.text) { el.value = r.text; if (focused) el.setSelectionRange(r.caret, r.caret); }
    this.writeField(el, r.text);
  },
  writeTouched(el) {
    const flag = fieldOf(el)?.dataset.touchedPath;
    if (!flag) return;
    if (!flag.includes("*")) { this[flag] = true; return; }
    const idx = this.runners.findIndex((r) => r.id === rowIdOf(el));
    if (idx >= 0) this.$resolve(flag, [idx], true);
  },
  /** The フリガナ of a name field: a reading committed by the IME, or kana typed directly, is appended. */
  appendKana(nameEl, text) {
    const f = fieldOf(nameEl);
    const kanaPath = f?.dataset.kanaPath; const touchedPath = f?.dataset.kanaTouchedPath;
    if (!kanaPath || !text) return;
    const idx = kanaPath.includes("*") ? this.runners.findIndex((r) => r.id === rowIdOf(f)) : -1;
    const read = (p) => (p.includes("*") ? this.$resolve(p, [idx]) : this[p]);
    const write = (p, v) => (p.includes("*") ? this.$resolve(p, [idx], v) : (this[p] = v));
    if (kanaPath.includes("*") && idx < 0) return;
    if (read(touchedPath)) return;   // the user edited the フリガナ: leave it alone
    write(kanaPath, read(kanaPath) + L.toKatakana(text));
  },
  clearKanaIfNameEmpty(nameEl) {
    const f = fieldOf(nameEl);
    const kanaPath = f?.dataset.kanaPath; const touchedPath = f?.dataset.kanaTouchedPath;
    if (!kanaPath || nameEl.value !== "") return;
    const idx = kanaPath.includes("*") ? this.runners.findIndex((r) => r.id === rowIdOf(f)) : -1;
    if (kanaPath.includes("*")) { if (idx >= 0 && !this.$resolve(touchedPath, [idx])) this.$resolve(kanaPath, [idx], ""); }
    else if (!this[touchedPath]) this[kanaPath] = "";
  },

  // ---- form-level event handlers (one set per step form) ----
  onInput(e) {
    const el = e.target;
    const f = fieldOf(el);
    if (!f) return;
    touched.add(f);
    const role = f.dataset.role;
    if (role === "format") { if (!e.isComposing) this.formatField(el); }
    else if (role === "kana") this.kanaField(el, true);
    else if (role === "name" && !e.isComposing && !ime.isComposing(el)) {
      // Kana typed without the IME (or committed text in browsers that send no composition) adds to the フリガナ.
      if (e.inputType === "insertText" && e.data && (L.isKana(e.data))) this.appendKana(el, e.data);
      this.clearKanaIfNameEmpty(el);
      if (f.dataset.path === "team.name") this.teamNameCommitted = el.value;
    }
    this.recheck(f);
  },
  onCompositionEnd(e) {
    const el = e.target;
    const f = fieldOf(el);
    if (!f || f !== el) return;
    const role = f.dataset.role;
    if (role === "format") this.formatField(el);
    else if (role === "kana") this.kanaField(el, true);
    else if (role === "name") {
      // the binding already wrote the committed text; the reading comes from ime.js
      this.appendKana(el, ime.takeReading(el));
      if (f.dataset.path === "team.name") this.teamNameCommitted = el.value;
      // a binding that wrote while composing may have written a value the IME then changed: write it again
      this.writeField(el, el.value);
    }
    this.recheck(f);
  },
  onChange(e) {
    // A value that arrives with `change` alone (some password managers). Since 4.23 state hears it for the fields
    // it binds two ways; the fields this page writes itself (`value#ro:`) are pulled here, and both are checked.
    const f = fieldOf(e.target);
    if (!f) return;
    this.pull(f);
    this.recheck(f);
  },
  onFocusOut(e) {
    const f = fieldOf(e.target);
    if (!f) return;
    const to = e.relatedTarget;
    if (to && (to === f || f.contains(to))) return;   // still inside the same control (the parts of <midori-date>)
    if (!ime.isComposing(f)) this.pull(f);
    if (touched.has(f) || this.errorOf(f)) this.check(f);
  },
  onKeydown(e) {
    // Alt+↑ / Alt+↓ in a runner's row moves the row, keeping the focus where it is.
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const id = rowIdOf(e.target);
      const i = id ? this.runners.findIndex((r) => r.id === id) : -1;
      if (i >= 0) { e.preventDefault(); this.moveRunner(i, e.key === "ArrowUp" ? i - 1 : i + 1); }
      return;
    }
    if (e.key !== "Enter") return;
    // The Enter that confirms an IME conversion is not "next": isComposing in Chromium / Firefox, keyCode 229 in Safari.
    if (e.isComposing || e.keyCode === 229) return;
    const t = e.target;
    const tag = t.tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON" || tag === "A" || tag === "SELECT" || tag === "SUMMARY") return;
    if (tag === "INPUT" && ["checkbox", "radio", "file", "button", "submit", "reset", "image"].includes(t.type)) return;
    e.preventDefault();
    this.next();
  },
  /**
   * Pull what is in the DOM into the entry (autofill that sends no event at all, a `change` only).
   * Which state path a field is bound to is repeated in its `data-path` attribute: a handler cannot ask wcstack
   * which path an element is bound to, and `data-wcs` is removed from row elements.
   */
  pull(f) {
    if (!f?.dataset?.path || ime.isComposing(f)) return;
    if (f.matches("[role=radiogroup], fieldset")) return;   // radio groups are bound with radio:
    if (!/^(INPUT|SELECT|TEXTAREA|MIDORI-DATE|MIDORI-STEPPER)$/.test(f.tagName) || f.type === "file") return;
    // A <select> whose options have not arrived (or failed) shows "" while the entry holds the real value:
    // an empty select never overwrites the entry (autofill always sets a real option).
    if (f.tagName === "SELECT" && f.value === "") return;
    const role = f.dataset.role;
    if (role === "format") { this.formatField(f); return; }
    if (role === "kana") { this.kanaField(f, false); return; }
    this.writeField(f, f.value);
    if (f.dataset.path === "team.name") this.teamNameCommitted = f.value;
  },
  pullAll() {
    for (const f of document.querySelectorAll("main form [data-path]")) this.pull(f);
  },

  // ---- errors ----
  errorOf(f) {
    const path = f?.dataset?.err ?? f?.dataset?.path;
    if (!path) return "";
    if (!path.includes("*")) return getPath(this.errs, path) ?? "";
    const id = rowIdOf(f); const field = path.split(".").pop();
    return this.runnerErrs[id]?.[field] ?? "";
  },
  setErrorOf(f, msg) {
    const path = f.dataset.err ?? f.dataset.path;
    if (!path.includes("*")) { if ((getPath(this.errs, path) ?? "") !== msg) this["errs." + path] = msg; return; }
    const id = rowIdOf(f); const field = path.split(".").pop();
    const cur = this.runnerErrs[id] ?? {};
    if ((cur[field] ?? "") === msg) return;
    const next = { ...cur, [field]: msg };
    if (!msg) delete next[field];
    this.runnerErrs = { ...this.runnerErrs, [id]: next };
  },
  /** The message for one field from the step's rules (the control's own message for <midori-*>). */
  messageFor(f) {
    const path = f.dataset.err ?? f.dataset.path;
    const step = L.stepOfPath(path);
    const x = L.STEP_VALIDATORS[step](this.draft);
    let key = path;
    if (path.includes("*")) {
      const idx = this.runners.findIndex((r) => r.id === rowIdOf(f));
      key = path.replace("*", String(idx));
    }
    let msg = x[key] ?? "";
    if (msg && isMidori(f) && !f.validity.valid && f.validationMessage) msg = f.validationMessage;
    return msg;
  },
  check(f) { this.setErrorOf(f, this.messageFor(f)); },
  /** A message goes away (or changes) as soon as its field is corrected. */
  recheck(f) { if (this.errorOf(f)) this.check(f); },

  applyErrors(placed, steps) {
    const errs = this.errs;
    const next = emptyErrs();
    // keep the messages of the steps not being replaced
    if (!steps.includes("team")) { next.team = errs.team; next.rep = errs.rep; }
    if (!steps.includes("runners")) next.runners = errs.runners;
    if (!steps.includes("options")) next.options = errs.options;
    for (const [path, msg] of Object.entries(placed.fields)) {
      const parts = path.split(".");
      let o = next;
      for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== "object" || o[parts[i]] === null) { o = null; break; } o = o[parts[i]]; }
      if (o && parts.at(-1) in o) o[parts.at(-1)] = msg; else placed.unplaced[path] = msg;
    }
    this.errs = next;
    if (steps.includes("runners")) {
      this.runnerErrs = placed.byRunner;
      // a message in the folded section opens it
      const open = new Set(Object.entries(placed.byRunner).filter(([, e]) => e.emergencyPhone || e.notes).map(([id]) => id));
      if (open.size) this.runners = this.runners.map((r) => (open.has(r.id) && !r.detailsOpen ? { ...r, detailsOpen: true } : r));
    }
    this.generalErrors = Object.values(placed.unplaced).join(" ");
  },
  validateStep(step) {
    const x = L.STEP_VALIDATORS[step](this.draft);
    const placed = L.placeErrors(x, this.runners);
    this.applyErrors(placed, [step]);
    return Object.keys(x).length === 0;
  },
  /** Focus the first field marked invalid, once the page shows it. */
  focusFirstError() {
    later(() => {
      const el = document.querySelector('main form [aria-invalid="true"]');
      if (!el) return;
      const target = el.matches("[role=radiogroup], fieldset") ? (el.querySelector("input:checked") ?? el.querySelector("input")) : el;
      target?.focus();
    });
  },

  // ================= navigation =================
  next(e) {
    e?.preventDefault?.();
    if (this.sending) return;
    this.pullAll();
    const step = this.routeName;
    if (!L.STEP_VALIDATORS[step]) return;
    if (!this.validateStep(step)) {
      // the <midori-*> controls know better why a date is wrong
      for (const f of document.querySelectorAll("main form [data-path]")) {
        if (isMidori(f) && this.errorOf(f) && !f.validity.valid && f.validationMessage) this.setErrorOf(f, f.validationMessage);
      }
      this.status = "入力内容を確認してください。";
      this.focusFirstError();
      return;
    }
    this.status = "";
    const order = ["team", "runners", "options", "confirm"];
    let target = order[order.indexOf(step) + 1];
    if (this.fromConfirm) target = L.firstIncompleteStep(this.draft);
    this.navigateUrl = `/entry/${target}`;
  },
  restart() {
    if (!confirm("入力した内容をすべて消して、最初からやり直しますか？")) return;
    for (const u of this.uploads) if (u.result?.id) fetch(`/api/consents/${u.result.id}`, { method: "DELETE" }).catch(() => {});
    this.resetEntry();
    this.status = "入力内容を消去しました。";
    this.navigateUrl = "/entry/team";
  },
  resetEntry() {
    const f = fresh();
    this.team = f.team; this.rep = f.rep; this.runners = f.runners; this.options = f.options;
    this.kanaTouched = { team: false, repFamily: false, repGiven: false };
    this.errs = emptyErrs(); this.runnerErrs = {}; this.generalErrors = ""; this.uploads = [];
    this.agreed = false; this.agreeError = ""; this.sendMessage = ""; this.postalMessage = "";
    this.teamNameCommitted = ""; this.postalLookupCode = ""; this.postalSnapshot = null;
    this.lookupFilled = { prefecture: "", city: "", street: "" };
  },

  // ================= step 1: address lookup =================
  postalChanged(digits) {
    if (digits.length !== 7) { this.postalLookupCode = ""; this.postalSnapshot = null; this.postalMessage = ""; return; }
    if (digits === this.postalLookupCode) return;
    this.postalSnapshot = { code: digits, prefecture: this["rep.prefecture"], city: this["rep.city"], street: this["rep.street"] };
    this.postalMessage = "";
    this.postalLookupCode = digits;
  },
  $on: {
    postalResponded(state, event) {
      const snap = state.postalSnapshot;
      // an answer for an older code (or after the code was changed) is ignored
      if (!snap || snap.code !== state.postalLookupCode || snap.code !== state["rep.postal"]) return;
      state.postalSnapshot = null;
      const { value, status } = event.detail ?? {};
      if (status === 404) { state.postalMessage = "この郵便番号の住所は見つかりませんでした。住所を入力してください。"; return; }
      if (status !== 200 || !value) { state.postalMessage = "住所を調べられませんでした。住所を入力してください。"; return; }
      const before = state.lookupFilled;
      // Never overwrite what the user typed in these fields since the lookup started — nor what the user (or the
      // browser's autofill) put there before: only an empty field or one still holding the last lookup's answer.
      const fill = (key, path, v) => {
        const now = state[path];
        if (!v || now !== snap[key]) return;
        if (now !== "" && now !== before[key]) return;
        state[path] = v;
      };
      fill("prefecture", "rep.prefecture", value.prefecture);
      fill("city", "rep.city", value.city);
      fill("street", "rep.street", value.town);
      state.lookupFilled = { prefecture: state["rep.prefecture"], city: state["rep.city"], street: state["rep.street"] };
      state.postalMessage = "住所を入力しました。町域のあとに番地を入力してください。";
      for (const p of ["rep.prefecture", "rep.city", "rep.street"]) if (getPath(state.errs, p)) state["errs." + p] = "";
    },
  },
  retryPrefectures() { this["prefFetch.trigger"] = true; },

  // ================= step 2: runners =================
  addRunner() {
    if (!this.canAddRunner) return;
    const row = L.newRunner(newId());
    this.runners = this.runners.concat(row);
    later(() => document.getElementById(`r-${row.id}-name`)?.focus());
  },
  removeRunner(e, i) {
    const r = this.runners[i];
    if (!r) return;
    const filled = RUNNER_FIELDS.some((k) => k !== "kanaTouched" && r[k]);
    if (filled && !confirm(`${L.legLabel(i)}の走者「${r.name || "（氏名なし）"}」を削除しますか？`)) return;
    this.runners = this.runners.toSpliced(i, 1);
    this.uploads = this.uploads.filter((u) => u.runnerId !== r.id);
    if (this.runnerErrs[r.id]) { const { [r.id]: _gone, ...rest } = this.runnerErrs; this.runnerErrs = rest; }
    this.status = `${L.legLabel(i)}の走者を削除しました。`;
    later(() => {
      const rows = document.querySelectorAll("[data-runner-id]");
      (rows[Math.min(i, rows.length - 1)]?.querySelector("input") ?? document.querySelector("#add-runner"))?.focus();
    });
  },
  moveRunner(i, to) {
    if (to < 0 || to >= this.runners.length) return;
    const active = document.activeElement;
    this.runners = L.moveRow(this.runners, i, to);
    this.status = `${L.legLabel(i)}の走者を${L.legLabel(to)}に移動しました。`;
    // A moved row keeps its focus only where the browser has moveBefore(); in Safari the focused element is
    // taken out and put back, which drops the focus. Put it back.
    later(() => { if (active && active.isConnected && document.activeElement !== active) active.focus(); });
  },
  moveUp(e, i) { this.moveRunner(i, i - 1); },
  moveDown(e, i) { this.moveRunner(i, i + 1); },
  sortRunners() {
    const active = document.activeElement;
    this.runners = L.sortByBest(this.runners);
    this.status = "ベストタイムの速い順に並べ替えました。";
    later(() => { if (active && active.isConnected && document.activeElement !== active) active.focus(); });
  },
  copyRep(e, i) {
    const r = this.runners[i];
    if (!r) return;
    if ((r.name || r.kana || r.birth) && !confirm(`${L.legLabel(i)}の入力済みの氏名・フリガナ・生年月日を代表者の内容で上書きしますか？`)) return;
    const name = [this["rep.name.family"], this["rep.name.given"]].filter(Boolean).join("　");
    const kana = [this["rep.kana.family"], this["rep.kana.given"]].filter(Boolean).join("　");
    this.$resolve("runners.*.name", [i], name);
    this.$resolve("runners.*.kana", [i], kana);
    this.$resolve("runners.*.kanaTouched", [i], false);
    this.$resolve("runners.*.birth", [i], this["rep.birth"]);
    const id = r.id;
    if (this.runnerErrs[id]) {
      const { name: _n, kana: _k, birth: _b, ...rest } = this.runnerErrs[id];
      this.runnerErrs = { ...this.runnerErrs, [id]: rest };
    }
    this.status = `${L.legLabel(i)}に代表者の氏名・フリガナ・生年月日をコピーしました。`;
  },
  onDetailsToggle(e, i) {
    const open = e.target.open;
    if (this.runners[i] && this.runners[i].detailsOpen !== open) this.$resolve("runners.*.detailsOpen", [i], open);
  },
  onConsentChosen(e, i) {
    const input = e.target;
    const file = input.files?.[0];
    const r = this.runners[i];
    if (!file || !r) return;
    input.value = "";
    let msg = "";
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) msg = "PDF・JPEG・PNG のファイルを選んでください。";
    else if (file.size > 5 * 1024 * 1024) msg = "ファイルが大きすぎます（5MBまで）。";
    if (msg) { this.runnerErrs = { ...this.runnerErrs, [r.id]: { ...(this.runnerErrs[r.id] ?? {}), consentId: msg } }; return; }
    const slot = { runnerId: r.id, files: [file], file, fileName: file.name, progress: 0, loading: true, result: null, error: null, status: 0 };
    this.uploads = this.uploads.filter((u) => u.runnerId !== r.id).concat(slot);
  },
  retryUpload(e, i) {
    const r = this.runners[i];
    const j = this.uploads.findIndex((u) => u.runnerId === r?.id);
    if (j < 0) return;
    const file = this[`uploads.${j}.file`];
    // `files` is used up by every upload (upload README): assign it again to retry
    this[`uploads.${j}.error`] = null;
    this[`uploads.${j}.files`] = [file];
  },
  removeConsent(e, i) {
    const r = this.runners[i];
    if (!r) return;
    if (r.consentId) fetch(`/api/consents/${encodeURIComponent(r.consentId)}`, { method: "DELETE" }).catch(() => {});
    this.$resolve("runners.*.consentId", [i], "");
    this.$resolve("runners.*.consentName", [i], "");
    this.uploads = this.uploads.filter((u) => u.runnerId !== r.id);
    later(() => document.getElementById(`r-${r.id}-consent`)?.focus());
  },

  // ================= step 4: sending =================
  submit() {
    if (this.sending) return;   // 申し込む cannot send twice
    if (!this.agreed) { this.agreeError = "規約に同意してください。"; later(() => document.getElementById("agree")?.focus()); return; }
    this.agreeError = "";
    const first = L.firstIncompleteStep(this.draft);
    if (first !== "confirm") { this.navigateUrl = `/entry/${first}`; return; }
    this.sendMessage = "";
    this.sending = true;
    // A new object every time (a retry included). A JSON *string* is a primitive: the same entry sent again is the
    // same string, the same-value guard drops the write, and <wcs-fetch> — which reset its one-shot body to null —
    // sends no body at all (since 4.23 it warns: [wcs/fetch-body-gone]).
    this["submitReq.body"] = L.toApiEntry(this.draft);
    this["submitReq.trigger"] = true;
  },
  settleSubmit() {
    const status = this["submitReq.status"];
    this.sending = false;
    if (status === 201) {
      const v = this["submitReq.value"];
      this.receipt = { id: v.id, total: v.total, team: this["team.name"] };
      this.resetEntry();
      this.replaceUrl = "/entry/done";
      return;
    }
    if (status === 409) {
      this.errs = { ...emptyErrs(), team: { ...emptyErrs().team, name: "このチーム名は、入力中に他のチームが申し込みました。別の名前にしてください。" } };
      this.goToErrors(["team"]);
      return;
    }
    if (status === 422) {
      let errors = {};
      try { errors = JSON.parse(this["submitReq.error"]?.body ?? "{}").errors ?? {}; } catch { errors = {}; }
      const placed = L.placeErrors(errors, this.runners);
      this.applyErrors(placed, ["team", "runners", "options"]);
      this.goToErrors(placed.steps.length ? placed.steps : ["team"]);
      return;
    }
    this.sendMessage = status === 0
      ? "通信できませんでした。インターネット接続を確認して、もう一度「申し込む」を押してください。入力内容は残っています。"
      : `申し込みを受け付けられませんでした（エラー ${status}）。しばらくしてから、もう一度「申し込む」を押してください。入力内容は残っています。`;
  },
  goToErrors(steps) {
    const order = ["team", "runners", "options"];
    const first = order.find((s) => steps.includes(s)) ?? "team";
    this.status = "申し込み内容に確認が必要な項目があります。";
    this.pendingFocus = "first-error";
    this.navigateUrl = `/entry/${first}`;
  },

  $watch: {
    routeName(cur) {
      if (["team", "runners", "options", "confirm"].includes(cur)) this.lastStep = cur;
    },
    "submitReq.loading"(cur, prev) { if (prev === true && cur === false) this.settleSubmit(); },
    "uploads.*.result"(cur, _prev, j) {
      if (!cur?.id) return;
      const runnerId = this[`uploads.${j}.runnerId`];
      const i = this.runners.findIndex((r) => r.id === runnerId);
      if (i < 0) return;
      this.$resolve("runners.*.consentId", [i], cur.id);
      this.$resolve("runners.*.consentName", [i], cur.name);
      if (this.runnerErrs[runnerId]?.consentId) {
        const { consentId: _c, ...rest } = this.runnerErrs[runnerId];
        this.runnerErrs = { ...this.runnerErrs, [runnerId]: rest };
      }
    },
    routePath(cur, prev) {
      if (!prev) return;   // the landing page: the browser decides
      // Focus after the route's content is in the page: the first error after a refusal, else the step's heading.
      // `path` is the router's "navigation finished" signal (router-and-scaffold.md §5).
      const want = this.pendingFocus;
      this.pendingFocus = "";
      later(() => {
        if (want === "first-error") {
          const el = document.querySelector('main form [aria-invalid="true"]');
          if (el) { (el.matches("[role=radiogroup], fieldset") ? el.querySelector("input") : el).focus(); return; }
        }
        document.querySelector("main h2")?.focus();
      });
    },
  },
};

function f_isRepPostal(el) { return fieldOf(el)?.dataset.path === "rep.postal"; }
