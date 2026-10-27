import {
  isValidMonth, currentMonth, todayString, shiftMonth, monthLabel, monthOfDate, formatYen, formatDateLabel, normalizeSort,
  filterAndSort, monthTotal, categorySummaries, toCsv, parseAmount, parseErrorBody, parseFieldErrors, describeError,
  receiptProblem, devParams, withParams, buildQuery, safeNext,
} from "./lib.js";

// The chosen receipt File stays out of the state until the upload starts.
let receiptFile = null;

const noErrors = () => ({ date: "", amount: "", categoryId: "", memo: "" });

function expireOn401(e) {
  if (e && e.status === 401) this.sessionExpired();
}

export default {
  // ---- session (persisted by <wcs-storage key="ledger.session">) ----
  session: null,
  loginForm: { email: "", password: "" },
  loginMessage: "",
  pendingNext: "",
  expiring: false,

  // ---- router surface ----
  routeName: "",
  routeParams: {},
  query: {},
  path: "",
  navigateUrl: null,
  replaceUrl: null,

  // ---- network / live ----
  offline: false,
  liveConnected: false,
  liveDown: false,

  // ---- fetch slots (one <wcs-fetch> per kind of request) ----
  loginFetch: { method: "POST", manual: true, body: null, trigger: false, value: null, error: null, loading: false, status: 0 },
  categoriesFetch: {
    // The lint cannot know the shape of a fetched response: the JSDoc gives the rows of `for: categories` their fields.
    /** @type {{ id: string, name: string, color: string }[] | null} */
    value: null,
    error: null, loading: false, status: 0,
  },
  monthFetch: { value: null, error: null, loading: false, status: 0 },
  budgetsFetch: { value: null, error: null, loading: false, status: 0 },
  entryFetch: { value: null, error: null, loading: false, status: 0 },
  createFetch: { method: "POST", manual: true, body: null, trigger: false, value: null, error: null, loading: false, status: 0 },
  updateFetch: { method: "PUT", manual: true, body: null, trigger: false, value: null, error: null, loading: false, status: 0 },
  deleteFetch: { method: "DELETE", manual: true, trigger: false, value: null, error: null, loading: false, status: 0 },
  budgetSaveFetch: { method: "PUT", manual: true, body: null, trigger: false, value: null, error: null, loading: false, status: 0 },

  // ---- the receipt upload (<wcs-upload manual>; the token goes in its <wcs-upload-header>) ----
  receiptUpload: { files: null, trigger: false, value: null, error: null, loading: false, progress: 0, status: 0 },
  uploadFor: null, // the saved entry whose receipt is going up

  $commandTokens: ["refreshMonth", "refreshBudgets", "copyCsv", "closeLive"],
  $eventTokens: ["liveEvent", "deleteDone", "receiptUploaded"],
  csvMessage: "",

  // ---- settings (persisted by <wcs-storage key="ledger.settings">) ----
  settingsForm: { defaultCategory: "", showMemo: true },
  get settingsSnapshot() {
    return { defaultCategory: this["settingsForm.defaultCategory"], showMemo: this["settingsForm.showMemo"] };
  },
  set settingsSnapshot(v) {
    if (v) this.settingsForm = { ...this.settingsForm, ...v };
  },

  // ---- entry form ----
  form: { date: "", amount: "", categoryId: "", memo: "" },
  orig: "",
  formLoaded: "",
  keepDraft: "",
  version: 0,
  clientId: "",
  // Seeded with every key the form binds. The 4.9 lint would take a `{}` seed with object literals assigned to it,
  // but the diagnostics add-on looks at the value on load: with `{}` it warns [wcs/binding-path-missing] for every
  // fieldErrors.* binding, saying updates will be dropped — they are not (replacing the object updates the bindings).
  fieldErrors: { date: "", amount: "", categoryId: "", memo: "" },
  saveMessage: "",
  conflict: null,
  receiptName: "",
  receiptError: "",
  hasReceiptFile: false,
  serverEntry: null,

  // ---- budgets form ----
  budgetRows: [],
  budgetsDirty: false,
  budgetErrors: {},
  budgetMessage: "",

  // ---- derived: session / router ----
  get authed() { return !!this.session; },
  get userName() { return this["session.user.name"] ?? ""; },
  get authHeader() { return this.session ? "Bearer " + this["session.token"] : null; },
  get isMonth() { return this.routeName === "month"; },
  get isBudgets() { return this.routeName === "budgets"; },
  get isEntryRoute() { return this.routeName === "entry-new" || this.routeName === "entry-edit"; },
  get isEdit() { return this.routeName === "entry-edit"; },
  get month() { return this.routeParams.month ?? null; },
  get monthOk() { return isValidMonth(this.month); },
  get entryId() { return this.routeParams.id ?? null; },
  get devQs() { return devParams(this.query); },
  get here() { return this.path + (Object.keys(this.query).length ? buildQuery(this.query, {}) : ""); },
  get sseUrl() { return this.authed ? "/api/events?token=" + encodeURIComponent(this["session.token"]) : null; },

  // ---- request urls: null until they make sense (and until the token is there) ----
  get "loginFetch.url"() { return withParams("/api/login", this.devQs); },
  get "categoriesFetch.url"() { return this.authed ? withParams("/api/categories", this.devQs) : null; },
  get "monthFetch.url"() {
    return this.authed && this.isMonth && this.monthOk ? withParams("/api/entries?month=" + this.month, this.devQs) : null;
  },
  get "budgetsFetch.url"() {
    return this.authed && (this.isMonth || this.isBudgets) && this.monthOk ? withParams("/api/budgets?month=" + this.month, this.devQs) : null;
  },
  get "entryFetch.url"() {
    return this.authed && this.isEdit && this.entryId ? withParams("/api/entries/" + this.entryId, this.devQs) : null;
  },
  get "createFetch.url"() { return this.authed ? withParams("/api/entries", this.devQs) : null; },
  get "updateFetch.url"() {
    return this.authed && this.isEdit && this.entryId ? withParams("/api/entries/" + this.entryId, this.devQs) : null;
  },
  get "deleteFetch.url"() {
    return this.authed && this.isEdit && this.entryId ? withParams("/api/entries/" + this.entryId, this.devQs) : null;
  },
  get "budgetSaveFetch.url"() {
    return this.authed && this.isBudgets && this.monthOk ? withParams("/api/budgets?month=" + this.month, this.devQs) : null;
  },
  get "receiptUpload.url"() {
    return this.authed && this.uploadFor ? withParams(`/api/entries/${this["uploadFor.id"]}/receipt`, this.devQs) : null;
  },

  // ---- month page ----
  get categories() { return this["categoriesFetch.value"] ?? []; },
  get categoryFilter() { return this.query.category ?? ""; },
  get sortKey() { return normalizeSort(this.query.sort); },
  get monthData() {
    const v = this["monthFetch.value"];
    return v && v.month === this.month ? v : null;
  },
  get budgetData() {
    const v = this["budgetsFetch.value"];
    return v && v.month === this.month ? v.budgets : null;
  },
  get monthEntries() { return this.monthData?.entries ?? []; },
  get shownEntries() { return filterAndSort(this.monthEntries, this.categoryFilter, this.sortKey); },
  get rows() {
    const cats = {};
    for (const c of this.categories) cats[c.id] = c;
    return this.shownEntries.map((e) => ({
      id: e.id,
      dateLabel: formatDateLabel(e.date),
      categoryName: cats[e.categoryId]?.name ?? e.categoryId,
      color: cats[e.categoryId]?.color ?? "#868e96",
      memo: e.memo,
      amountLabel: formatYen(e.amount),
      by: e.createdBy?.name ?? "",
      receiptUrl: e.receiptUrl ?? null,
      noReceipt: !e.receiptUrl,
      editPath: withParams("/entries/" + e.id + "/edit", this.devQs),
    }));
  },
  get totalLabel() { return formatYen(monthTotal(this.monthEntries)); },
  get summaries() {
    // Mapped again into an object literal: the lint does not follow an imported helper, so this literal is where
    // it reads the rows of `for: summaries` from.
    return categorySummaries(this.monthEntries, this.budgetData ?? {}, this.categories).map((s) => ({
      id: s.id, name: s.name, color: s.color, percent: s.percent, over: s.over,
      spentLabel: s.spentLabel, budgetLabel: s.budgetLabel, remainingLabel: s.remainingLabel,
    }));
  },
  get monthTitle() { return monthLabel(this.month); },
  get prevPath() { return this.monthOk ? withParams("/months/" + shiftMonth(this.month, -1), this.devQs) : "/"; },
  get nextPath() { return this.monthOk ? withParams("/months/" + shiftMonth(this.month, 1), this.devQs) : "/"; },
  get newEntryPath() { return withParams("/entries/new?month=" + (this.month ?? ""), this.devQs); },
  get budgetsPath() { return this.monthOk ? withParams("/budgets/" + this.month, this.devQs) : "/"; },
  get monthLoading() {
    return this.isMonth && this.monthOk && !this.monthData && !this["monthFetch.error"];
  },
  get monthFailed() {
    return this.isMonth && !this.monthData && !!this["monthFetch.error"] && !this["monthFetch.loading"];
  },
  get monthErrorText() { return describeError(this["monthFetch.error"]); },
  get monthEmpty() { return !!this.monthData && this.monthEntries.length === 0; },
  get filteredEmpty() { return !!this.monthData && this.monthEntries.length > 0 && this.shownEntries.length === 0; },
  get hideMemo() { return !this["settingsForm.showMemo"]; },
  get liveLost() { return this.authed && this.liveDown && !this.offline; },

  // ---- entry form: derived ----
  get formContext() {
    if (this.routeName === "entry-new") return "new";
    if (this.routeName === "entry-edit") return "edit:" + this.entryId;
    return "";
  },
  get formSnapshot() {
    return JSON.stringify([this["form.date"], this["form.amount"], this["form.categoryId"], this["form.memo"]]);
  },
  get dirty() { return this.isEntryRoute && this.orig !== "" && (this.formSnapshot !== this.orig || this.hasReceiptFile); },
  get discardPrompt() {
    return this.dirty && !this.expiring ? "保存していない変更があります。破棄して移動しますか？" : null;
  },
  get uploading() { return this.uploadFor !== null; },
  get saving() {
    return this["createFetch.loading"] || this["updateFetch.loading"] || this["deleteFetch.loading"] || this.uploading;
  },
  get saveDisabled() { return this.saving || this.offline; },
  get formTitle() { return this.isEdit ? "記録を編集" : "記録を追加"; },
  get formLoading() { return this.isEdit && this.formLoaded !== this.formContext && !this["entryFetch.error"]; },
  get formLoadFailed() { return this.isEdit && this.formLoaded !== this.formContext && !!this["entryFetch.error"] && !this["entryFetch.loading"]; },
  get formHidden() { return this.formLoading || this.formLoadFailed; }, // no empty form to save when the entry could not be loaded
  get formLoadErrorText() {
    const e = this["entryFetch.error"];
    return e && e.status === 404 ? "この記録は見つかりません（削除されたかもしれません）。" : "記録を読み込めませんでした（" + describeError(e) + "）。";
  },
  get returnMonth() {
    if (this.isEdit) return monthOfDate(this["serverEntry.date"], currentMonth());
    return isValidMonth(this.query.month) ? this.query.month : currentMonth();
  },
  get returnPath() { return withParams("/months/" + this.returnMonth, this.devQs); },
  get conflictText() {
    const c = this.conflict;
    if (!c) return "";
    return `サーバーにある最新の内容：${c.date} / ${formatYen(c.amount)} / ${c.memo || "（メモなし）"}`;
  },
  get currentReceiptUrl() { return this["serverEntry.receiptUrl"] ?? null; },
  get noCurrentReceipt() { return !this["serverEntry.receiptUrl"]; },
  get hasSaveMessage() { return this.saveMessage !== ""; },

  // ---- budgets page: derived ----
  get "budgetRows.*.error"() { return this.budgetErrors[this["budgetRows.*.id"]] ?? ""; },
  get budgetsBack() { return withParams("/months/" + (this.month ?? currentMonth()), this.devQs); },
  get budgetsLoading() { return this.isBudgets && !this.budgetData && !this["budgetsFetch.error"]; },
  get budgetsFailed() { return this.isBudgets && !this.budgetData && !!this["budgetsFetch.error"] && !this["budgetsFetch.loading"]; },

  // ---- handlers: auth / month ----
  login() {
    this.loginMessage = "";
    this["loginFetch.body"] = { email: this["loginForm.email"], password: this["loginForm.password"] };
    this["loginFetch.trigger"] = true;
  },
  logout() {
    this.$command.closeLive.emit();
    this.session = null;
    this.navigateUrl = "/login";
  },
  sessionExpired() {
    if (!this.session) return; // already handled by another request
    if (this.isEntryRoute && this.dirty) this.keepDraft = this.formContext;
    this.expiring = true;
    this.$command.closeLive.emit();
    this.session = null;
    this.navigateUrl = "/login?next=" + encodeURIComponent(this.here);
  },
  onFilter(e) { this.navigateUrl = buildQuery(this.query, { category: e.target.value }); },
  onSort(e) { this.navigateUrl = buildQuery(this.query, { sort: e.target.value }); },
  retryMonth() {
    if (this.query.fail) { // the developer switch ?fail=1 is dropped on retry, so the retry can succeed
      this.replaceUrl = buildQuery(this.query, { fail: "" });
      return;
    }
    this.$command.refreshMonth.emit();
    this.$command.refreshBudgets.emit();
  },
  async copyCsv() {
    const cats = {};
    for (const c of this.categories) cats[c.id] = c.name;
    const shown = this.shownEntries;
    const csv = toCsv(shown.map((e) => ({
      date: e.date, categoryName: cats[e.categoryId] ?? e.categoryId, memo: e.memo, amount: e.amount, by: e.createdBy?.name ?? "",
    })));
    try {
      await Promise.all(this.$command.copyCsv.emit(csv));
      this.csvMessage = `${shown.length}件をCSVとしてコピーしました`;
    } catch (err) {
      this.csvMessage = "コピーできませんでした: " + (err?.message ?? err);
    }
  },
  catchUp() {
    if (this.isMonth) this.retryMonth();
    if (this.isBudgets) this.$command.refreshBudgets.emit();
  },

  // ---- handlers: entry form ----
  resetForm(ctx) {
    const cat = this["settingsForm.defaultCategory"] ?? "";
    let date = todayString();
    if (ctx === "new" && isValidMonth(this.query.month) && this.query.month !== currentMonth()) date = this.query.month + "-01";
    this.form = ctx === "new" ? { date, amount: "", categoryId: cat, memo: "" } : { date: "", amount: "", categoryId: "", memo: "" };
    this.orig = ctx === "new" ? JSON.stringify([date, "", cat, ""]) : "";
    this.formLoaded = ctx === "new" ? ctx : "";
    this.version = 0;
    this.clientId = crypto.randomUUID();
    this.fieldErrors = noErrors();
    this.conflict = null;
    this.receiptName = "";
    this.receiptError = "";
    this.hasReceiptFile = false;
    this.serverEntry = null;
    this.expiring = false;
    receiptFile = null;
  },
  loadForm(entry) {
    this.form = { date: entry.date, amount: String(entry.amount), categoryId: entry.categoryId, memo: entry.memo ?? "" };
    this.orig = JSON.stringify([entry.date, String(entry.amount), entry.categoryId, entry.memo ?? ""]);
    this.version = entry.version;
    this.serverEntry = entry;
    this.formLoaded = "edit:" + entry.id;
    this.conflict = null;
    this.fieldErrors = noErrors();
  },
  initForm(ctx) {
    if (this.keepDraft === ctx) { // came back after logging in again: what was typed stays
      this.keepDraft = "";
      this.expiring = false;
      return;
    }
    this.keepDraft = "";
    this.resetForm(ctx);
  },
  onReceipt(e) {
    const f = e.target.files?.[0] ?? null;
    const problem = receiptProblem(f);
    if (problem) {
      receiptFile = null;
      this.receiptError = problem;
      this.receiptName = "";
      this.hasReceiptFile = false;
      e.target.value = "";
      return;
    }
    receiptFile = f;
    this.receiptError = "";
    this.receiptName = f ? f.name : "";
    this.hasReceiptFile = !!f;
  },
  save() {
    if (this.saveDisabled || this.formLoading) return;
    this.fieldErrors = noErrors();
    this.saveMessage = "";
    this.conflict = null;
    const body = {
      date: this["form.date"], amount: parseAmount(this["form.amount"]), categoryId: this["form.categoryId"], memo: this["form.memo"],
    };
    if (this.isEdit) {
      this["updateFetch.body"] = { ...body, version: this.version };
      this["updateFetch.trigger"] = true;
    } else {
      this["createFetch.body"] = { ...body, clientId: this.clientId };
      this["createFetch.trigger"] = true;
    }
  },
  overwrite() {
    if (!this.conflict) return;
    this.version = this.conflict.version;
    this.save();
  },
  reloadTheirs() {
    if (this.conflict) this.loadForm(this.conflict);
  },
  remove() {
    if (this.saveDisabled || !this.isEdit) return;
    if (!window.confirm("この記録を削除しますか？")) return;
    this.saveMessage = "";
    this["deleteFetch.trigger"] = true;
  },
  onSaveError(e) {
    if (!e) return;
    if (e.status === 401) { this.sessionExpired(); return; }
    if (e.status === 422) this.fieldErrors = { ...noErrors(), ...parseFieldErrors(e) };
    else if (e.status === 409) this.conflict = parseErrorBody(e)?.current ?? null;
    else if (e.status === 404) this.saveMessage = "この記録は見つかりません（削除されたかもしれません）。";
    else this.saveMessage = "保存できませんでした（" + describeError(e) + "）。";
  },
  afterSaved(entry) {
    if (!entry || typeof entry.id !== "number") return;
    if (receiptFile) { this.uploadReceipt(entry); return; }
    this.finishSave(entry);
  },
  finishSave(entry) {
    this.orig = this.formSnapshot;
    this.hasReceiptFile = false;
    receiptFile = null;
    this.navigateUrl = withParams("/months/" + monthOfDate(entry.date, currentMonth()), this.devQs);
  },
  uploadReceipt(entry) {
    this.uploadFor = entry; // gives <wcs-upload> its url
    this["receiptUpload.files"] = [receiptFile];
    this["receiptUpload.trigger"] = true;
  },
  uploadFailed(entry, e) {
    if (e.status === 401) { this.sessionExpired(); return; }
    let failure;
    if (e.status === 413) failure = "領収書のサイズが 5MB を超えています。";
    else if (e.status === 415) failure = "領収書は JPEG / PNG / WebP の画像だけ使えます。";
    else failure = "領収書を保存できませんでした（" + describeError(e) + "）。";
    // the entry itself is saved; stay (on its edit page) so the receipt can be tried again
    receiptFile = null;
    this.hasReceiptFile = false;
    this.receiptName = "";
    if (this.isEdit) { this.loadForm({ ...entry, receiptUrl: this["serverEntry.receiptUrl"] }); this.receiptError = failure; }
    else { this.receiptError = failure; this.saveMessage = "記録は保存しました。領収書だけ保存できませんでした。"; this.forceEdit(entry); }
  },
  forceEdit(entry) {
    this.keepDraft = "edit:" + entry.id; // the form is already what the server has; do not reset it
    this.loadForm(entry);
    this.replaceUrl = withParams("/entries/" + entry.id + "/edit", this.devQs);
  },
  afterDelete() {
    this.orig = this.formSnapshot;
    this.hasReceiptFile = false;
    this.navigateUrl = this.returnPath;
  },

  // ---- handlers: budgets ----
  syncBudgetRows() {
    if (!this.isBudgets || this.budgetsDirty || !this.budgetData || !this.categories.length) return;
    const b = this.budgetData;
    this.budgetRows = this.categories.map((c) => ({ id: c.id, name: c.name, color: c.color, value: typeof b[c.id] === "number" ? String(b[c.id]) : "" }));
  },
  onBudgetInput() { this.budgetsDirty = true; this.budgetMessage = ""; },
  saveBudgets() {
    if (this.saveDisabled || this["budgetSaveFetch.loading"]) return;
    this.budgetErrors = {};
    this.budgetMessage = "";
    const budgets = {};
    for (const r of this.budgetRows) {
      const t = String(r.value ?? "").trim();
      if (t !== "") budgets[r.id] = parseAmount(t);
    }
    this["budgetSaveFetch.body"] = { budgets };
    this["budgetSaveFetch.trigger"] = true;
  },

  $on: {
    liveEvent(state, ev) {
      const m = ev.detail;
      if (!m || !m.data) return;
      if (m.event === "budget-updated") {
        if ((state.isMonth || state.isBudgets) && m.data.month === state.month) state.$command.refreshBudgets.emit();
      } else if (m.event === "entry-created" || m.event === "entry-updated" || m.event === "entry-deleted") {
        const month = m.event === "entry-deleted" ? m.data.month : monthOfDate(m.data.date, "");
        if (state.isMonth && month === state.month) state.$command.refreshMonth.emit();
      }
    },
    // every response of the DELETE, the second 204 too (a watch on `status` sees one 204: the same value fires nothing)
    deleteDone(state, ev) {
      const status = ev.detail?.status ?? 0;
      // 404: the other person deleted it first — gone either way
      if ((status >= 200 && status < 300) || status === 404) state.afterDelete();
    },
    // a successful upload (a refused one comes as `error`, below)
    receiptUploaded(state) {
      const entry = state.uploadFor;
      if (!entry) return;
      state.uploadFor = null;
      state.finishSave(entry);
    },
  },

  // ---- reactions ----
  $watch: {
    "loginFetch.error"(e) {
      if (!e) return;
      this.loginMessage = e.status === 401 ? "メールアドレスまたはパスワードが違います。" : "ログインできませんでした（" + describeError(e) + "）。";
    },
    "loginFetch.value"(v) {
      if (!v || !v.token) return;
      this.pendingNext = safeNext(this.query.next) || "/";
      this["loginForm.password"] = "";
      this.session = { token: v.token, expiresAt: v.expiresAt, user: v.user };
    },
    session(s) {
      // by now <wcs-storage> has saved it, so the route guard can see the token
      if (s && this.pendingNext) {
        const to = this.pendingNext;
        this.pendingNext = "";
        this.navigateUrl = to;
      }
    },
    "categoriesFetch.error": expireOn401,
    "monthFetch.error": expireOn401,
    "budgetsFetch.error": expireOn401,
    "entryFetch.error": expireOn401,
    "createFetch.error"(e) { this.onSaveError(e); },
    "updateFetch.error"(e) { this.onSaveError(e); },
    "deleteFetch.error"(e) {
      if (!e || e.status === 404) return; // a 404 is handled with the response (deleteDone)
      this.onSaveError(e);
    },
    "budgetSaveFetch.error"(e) {
      if (!e) return;
      if (e.status === 401) this.sessionExpired();
      else if (e.status === 422) this.budgetErrors = parseFieldErrors(e);
      else this.budgetMessage = "保存できませんでした（" + describeError(e) + "）。";
    },
    "receiptUpload.error"(e) {
      const entry = this.uploadFor;
      if (!e || !entry) return;
      this.uploadFor = null;
      this.uploadFailed(entry, e);
    },
    "createFetch.value"(v) { if (v) this.afterSaved(v); },
    "updateFetch.value"(v) { if (v) this.afterSaved(v); },
    "budgetSaveFetch.value"(v) {
      if (!v) return;
      this.budgetsDirty = false;
      this.budgetMessage = "保存しました";
    },
    "entryFetch.value"(v) {
      if (!v || !this.isEdit || v.id !== this.entryId) return;
      if (this.formLoaded === this.formContext) return; // keep what is in the form
      this.loadForm(v);
    },
    formContext(cur) { if (cur) this.initForm(cur); },
    budgetData() { this.syncBudgetRows(); },
    categories() { this.syncBudgetRows(); },
    isBudgets(cur) { if (cur) { this.budgetsDirty = false; this.budgetErrors = {}; this.budgetMessage = ""; this.syncBudgetRows(); } },
    month() { if (this.isBudgets) { this.budgetsDirty = false; this.syncBudgetRows(); } },
    // <wcs-sse auto-reconnect> opens a stream that gave up again by itself; the page catches up once it is back
    liveConnected(cur) {
      if (cur) {
        if (this.liveDown) { this.liveDown = false; this.catchUp(); }
      } else if (this.authed) {
        this.liveDown = true;
      }
    },
    offline(cur, prev) {
      if (cur === false && prev === true) this.catchUp();
    },
  },
};
