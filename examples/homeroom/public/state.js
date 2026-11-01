// The page's root state (<wcs-state src="./state.js">). Loaded with a normal import(), so relative
// imports work and the module runs once (the inline-script form is evaluated twice — skill §2).
import {
  CATEGORIES, CAT_KEYS, REASONS, catLabel, reasonLabel, formatDay, formatDeadline, formatDayTime, formatSize,
  splitDeadline, joinDeadline, todayJst, safeNext, noticesPath, noticesLinkTo, parsePage, mergeQuestions, checkFile,
  uploadErrorMessage,
} from "./lib/format.js";

// The File objects picked for upload stay out of state (state holds only their metadata rows).
const fileStore = new Map();
let fileSeq = 0;

const TEACHER_ROUTES = ["notice-new", "notice-edit"];
const PARENT_ROUTES = ["absence-new"];
const EMPTY_DRAFT = { title: "", cat: "general", body: "", deadlineDate: "", deadlineTime: "" };
const EMPTY_FORM_ERRORS = { title: "", cat: "", body: "", deadline: "" };
const EMPTY_ABSENCE_ERRORS = { date: "", reason: "", note: "" };

/** @typedef {{ id: string, name: string, role: string, child?: string }} User */
/** @typedef {{ token: string, user: User }} Session */
/** @typedef {{ id: number, title: string, cat: string, postedAt: string, deadline: string | null, read: boolean, attachments: number }} ListItem */
/** @typedef {{ id: number, name: string, size: number, url: string }} Attachment */
/** @typedef {{ id: number, title: string, cat: string, body: string, postedAt: string, deadline: string | null, read: boolean, attachments: Attachment[] }} Notice */
/** @typedef {{ text: string, at: string }} Answer */
/** @typedef {{ id: number, from: string, text: string, at: string, answer: Answer | null }} Question */
/** @typedef {{ id: number, child: string, date: string, reason: string, note: string, createdAt: string }} Absence */
/** @typedef {{ key: number, name: string, size: number, progress: number, status: string, error: string }} PendingFile */
/** @typedef {{ key: string, label: string }} Tab */

export default {
  // ---------------------------------------------------------------- router surface
  path: "/",
  routeName: "",
  /** @type {{ id?: number }} */
  routeParams: {},
  /** @type {{ cat?: string, page?: string, next?: string }} */
  query: {},
  navigateUrl: null,
  replaceUrl: null,
  wsBase: "",

  // ---------------------------------------------------------------- session
  // Persisted by <wcs-storage key="homeroom.session"> (shared by every tab; the route guards read it too).
  /** @type {Session | null} */
  session: null,
  get token() { return this["session.token"] ?? ""; },
  get loggedIn() { return this.token !== ""; },
  get userName() { return this["session.user.name"] ?? ""; },
  get userRole() { return this["session.user.role"] ?? ""; },
  get isTeacher() { return this.userRole === "teacher"; },
  get isParent() { return this.userRole === "parent"; },
  get roleLabel() {
    if (this.isTeacher) return "担任";
    const child = this["session.user.child"];
    return child ? `${child} さんの保護者` : "";
  },
  // null = no Authorization header at all
  get authHeader() { return this.loggedIn ? "Bearer " + this.token : null; },

  // ---------------------------------------------------------------- login
  loginForm: { id: "", password: "" },
  loginBody: null,
  loginTrigger: false,
  loginLoading: false,
  loginError: null,
  loginNotice: "",
  // The login dialog over the current page, shown when a request answers 401 (the token expired):
  // logging in again keeps the page — and the form — where it was.
  reauth: false,
  retryAfterLogin: "",
  loggingOut: false,
  logoutTrigger: false,
  logoutHeader: null,   // the header of the logout request, kept apart: the session is gone in the same turn
  get loginErrorText() {
    const err = this.loginError;
    if (!err) return "";
    if (err.status === 401) return "ユーザーIDかパスワードが違います。";
    return "ログインできませんでした。時間をおいてもう一度お試しください。";
  },
  get reauthText() {
    return this.loggedIn
      ? "ログインの有効期限が切れました。ログインすると、このページの続きから使えます（入力中の内容はそのまま残ります）。"
      : "別のタブでログアウトしました。ログインすると、このページの続きから使えます（入力中の内容はそのまま残ります）。";
  },
  get loginBlocked() { return this.loginLoading || this.offline === true; },
  submitLogin() {
    if (this.loginBlocked) return;
    this.loginError = null;
    this.loginBody = { id: this["loginForm.id"].trim(), password: this["loginForm.password"] };
    this.loginTrigger = true;
  },
  requireLogin(retry) {
    if (!this.session) return;
    if (retry) this.retryAfterLogin = retry;
    if (this.reauth) return;
    this.reauth = true;
    this.loginForm = { id: this["session.user.id"] ?? "", password: "" };
    this.loginError = null;
  },
  logout() {
    if (this.dirty && !confirm("保存していない変更があります。ログアウトしますか？")) return;
    this.discardForms();
    this.loggingOut = true;
    this.logoutHeader = this.authHeader;
    this.logoutTrigger = true;   // the server forgets the token
    this.session = null;         // the token watch leaves for /login
  },

  // ---------------------------------------------------------------- notices list
  /** @type {{ value: { items: ListItem[], page: number, pages: number, total: number } | null, loading: boolean, error: any, status: number }} */
  listFetch: { value: null, loading: false, error: null, status: 0 },
  /** @type {Tab[]} */
  tabs: [{ key: "", label: "すべて" }, ...CATEGORIES],
  get listCat() { const c = this["query.cat"]; return CAT_KEYS.includes(c) ? c : ""; },
  get listPage() { return parsePage(this["query.page"]); },
  get listUrl() {
    if (this.routeName !== "notices" || !this.loggedIn) return null;
    return `/api/notices?cat=${this.listCat}&page=${this.listPage}`;
  },
  get listItems() { return this["listFetch.value.items"] ?? []; },
  get listPages() { return this["listFetch.value.pages"] ?? 1; },
  get listTotal() { return this["listFetch.value.total"] ?? 0; },
  get listLoading() { return this["listFetch.loading"]; },
  get listFailed() { return !this["listFetch.loading"] && this["listFetch.error"] != null && this["listFetch.error.status"] !== 401; },
  get listReady() { return !this["listFetch.loading"] && this["listFetch.error"] == null && this["listFetch.value"] != null; },
  get listEmpty() { return this.listReady && this.listItems.length === 0; },
  get listHasItems() { return this.listReady && this.listItems.length > 0; },
  get emptyText() {
    const label = catLabel(this.listCat);
    return label ? `「${label}」のお知らせはまだありません。` : "お知らせはまだありません。";
  },
  get listHeading() { const label = catLabel(this.listCat); return label ? `お知らせ（${label}）` : "お知らせ"; },
  get listTitle() { return `${this.listHeading} ${this.listPage}ページ — 3年B組 連絡帳`; },
  get "tabs.*.href"() { return noticesPath({ cat: this["tabs.*.key"] }); },
  get "listItems.*.href"() { return "/notices/" + this["listItems.*.id"]; },
  get "listItems.*.catLabel"() { return catLabel(this["listItems.*.cat"]); },
  get "listItems.*.postedText"() { return formatDay(this["listItems.*.postedAt"]); },
  get "listItems.*.deadlineText"() { return formatDeadline(this["listItems.*.deadline"]); },
  get "listItems.*.unread"() { return this["listItems.*.read"] === false; },
  get "listItems.*.attachmentText"() { const n = this["listItems.*.attachments"]; return n > 0 ? `添付 ${n}件` : ""; },
  /** @type {number[]} */
  pageNumbers: [1],
  // the pager's <wcs-link to>: the router marks the shown page
  get "pageNumbers.*.to"() { return noticesLinkTo({ cat: this.listCat, page: this["pageNumbers.*"] }); },
  get "pageNumbers.*.label"() { return `${this["pageNumbers.*"]}ページ`; },
  get hasPrev() { return this.listPage > 1; },
  get hasNext() { return this.listPage < this.listPages; },
  get prevTo() { return noticesLinkTo({ cat: this.listCat, page: this.listPage - 1 }); },
  get nextTo() { return noticesLinkTo({ cat: this.listCat, page: this.listPage + 1 }); },
  get showPager() { return this.listReady && this.listPages > 1; },
  retryList() { this.$command.fetchList.emit(); },

  // ---------------------------------------------------------------- one notice
  /** @type {{ value: Notice | null, loading: boolean, error: any, status: number }} */
  noticeFetch: { value: null, loading: false, error: null, status: 0 },
  get noticeId() { return this["routeParams.id"] ?? null; },
  get onNotice() { return this.routeName === "notice" || this.routeName === "notice-edit"; },
  get noticeUrl() {
    if (!this.onNotice || this.noticeId == null || !this.loggedIn) return null;
    return "/api/notices/" + this.noticeId;
  },
  // Only the notice of the current URL — never the previous one's data while the next loads.
  get notice() {
    const n = this["noticeFetch.value"];
    return this.onNotice && n && n.id === this.noticeId ? n : null;
  },
  get noticeReady() { return this.notice !== null; },
  get noticeLoading() { return this.onNotice && !this.noticeReady && this["noticeFetch.status"] !== 404 && !this.noticeFailed; },
  get noticeMissing() { return this.onNotice && !this["noticeFetch.loading"] && this["noticeFetch.error.status"] === 404; },
  get noticeFailed() {
    const s = this["noticeFetch.error.status"];
    return this.onNotice && !this["noticeFetch.loading"] && this["noticeFetch.error"] != null && s !== 404 && s !== 401;
  },
  get noticeTitleText() { return this.notice?.title ?? ""; },
  get noticeHeading() { return this.notice?.title ?? "お知らせ"; },
  // "← お知らせ一覧へ" returns to the tab and page the reader came from
  lastListPath: "/notices",
  get currentListPath() { return this.routeName === "notices" ? noticesPath({ cat: this.listCat, page: this.listPage }) : null; },
  get backHref() { return this.lastListPath; },
  get noticeBody() { return this.notice?.body ?? ""; },
  get noticeCat() { return this.notice?.cat ?? ""; },
  get noticeCatLabel() { return catLabel(this.notice?.cat); },
  get noticePosted() { return formatDay(this.notice?.postedAt); },
  get noticeDeadline() { return formatDeadline(this.notice?.deadline); },
  get noticeHasDeadline() { return !!this.notice?.deadline; },
  get pageTitleNotice() { return (this.notice ? this.notice.title : "お知らせ") + " — 3年B組 連絡帳"; },
  get noticeAttachments() { return this.notice?.attachments ?? []; },
  get showAttachmentList() { return this["prefs.showAttachments"] !== false && this.noticeAttachments.length > 0; },
  get attachmentsHiddenNote() { return this["prefs.showAttachments"] === false && this.noticeAttachments.length > 0; },
  get "noticeAttachments.*.sizeText"() { return formatSize(this["noticeAttachments.*.size"]); },
  get editHref() { return `/notices/${this.noticeId}/edit`; },
  retryNotice() { this.$command.fetchNotice.emit(); },
  // Opening a notice marks it read.
  readFetch: { url: null },
  get readUrl() { return this.routeName === "notice" && this.noticeId != null ? `/api/notices/${this.noticeId}/read` : null; },

  // ---------------------------------------------------------------- questions and answers (live)
  /** @type {{ value: Question[] | null, loading: boolean, error: any, status: number }} */
  questionsFetch: { value: null, loading: false, error: null, status: 0 },
  get questionsUrl() {
    if (this.routeName !== "notice" || this.noticeId == null || !this.loggedIn) return null;
    return `/api/notices/${this.noticeId}/questions`;
  },
  /** @type {Question[]} */
  questions: [],
  questionsFor: null,
  $listKeys: { questions: "id", pendingFiles: "key" },
  get wsUrl() {
    if (this.routeName !== "notice" || this.noticeId == null || !this.loggedIn || this.reauth || !this.wsBase) return null;
    return `${this.wsBase}/ws/notices/${this.noticeId}?token=${encodeURIComponent(this.token)}`;
  },
  wsConnected: false,
  wsLoading: false,
  wsEverConnected: false,
  get wsDown() { return this.wsEverConnected && !this.wsConnected; },
  get wsStatusText() {
    if (this.wsDown) return "接続が切れました。再接続しています…（再接続すると質問と回答は自動で最新になります）";
    if (!this.wsConnected) return "接続しています…";
    return "";
  },
  get hasQuestions() { return this.questions.length > 0; },
  get "questions.*.atText"() { return formatDayTime(this["questions.*.at"]); },
  get "questions.*.answered"() { return this["questions.*.answer"] != null; },
  get "questions.*.answerText"() { return this["questions.*.answer.text"] ?? ""; },
  get "questions.*.answerAtText"() { return formatDayTime(this["questions.*.answer.at"]); },
  get "questions.*.answering"() { return this.$eqPath("answeringId", "questions.*.id"); },
  get "questions.*.canAnswer"() { return this.isTeacher && this["questions.*.answer"] == null; },
  askText: "",
  pendingAsk: "",
  askError: "",
  get askBlocked() { return !this.wsConnected || this.askText.trim() === "" || this.offline === true; },
  ask() {
    const text = this.askText.trim();
    if (!text || !this.wsConnected) return;
    this.askError = "";
    this.pendingAsk = text;   // cleared when the server sends it back as a question
    this.$command.wsSend.emit(JSON.stringify({ type: "ask", text }));
  },
  answeringId: null,
  answerText: "",
  startAnswer(event, index) {
    this.answeringId = this[`questions.${index}.id`];
    this.answerText = "";
  },
  cancelAnswer() { this.answeringId = null; this.answerText = ""; },
  get answerBlocked() { return !this.wsConnected || this.answerText.trim() === "" || this.offline === true; },
  sendAnswer() {
    const text = this.answerText.trim();
    if (!text || this.answeringId == null || !this.wsConnected) return;
    this.$command.wsSend.emit(JSON.stringify({ type: "answer", questionId: this.answeringId, text }));
  },

  // ---------------------------------------------------------------- notice form (teacher)
  // The seeds spread the constants the resets use (the lint reads a spread of a module constant since 4.11).
  draft: { ...EMPTY_DRAFT },
  original: { ...EMPTY_DRAFT },
  formFor: null,              // "new", a notice id, or null
  formErrors: { ...EMPTY_FORM_ERRORS },
  formMessage: "",
  submitting: false,
  uploading: false,
  // <wcs-upload> (with <wcs-upload-header>, 4.9): one file per upload; `files` is used up by each one
  upload: { url: null, files: null, progress: 0 },
  uploadKey: null,
  uploadNoticeId: null,
  uploadHadError: false,
  /** @type {PendingFile[]} */
  pendingFiles: [],
  saveFetch: { url: null, method: "POST", body: null, trigger: false, loading: false },
  categoryOptions: CATEGORIES,
  get formMode() { return this.routeName === "notice-new" ? "new" : this.routeName === "notice-edit" ? "edit" : null; },
  get formReady() { return this.formMode === "new" || (this.formMode === "edit" && this.formFor === this.noticeId && this.noticeReady); },
  get formHeading() { return this.formMode === "edit" ? "お知らせを編集" : "新しいお知らせ"; },
  get formTitle() { return this.formHeading + " — 3年B組 連絡帳"; },
  get formDirty() {
    if (this.formMode === null) return false;
    return this["draft.title"] !== this["original.title"] || this["draft.cat"] !== this["original.cat"]
      || this["draft.body"] !== this["original.body"] || this["draft.deadlineDate"] !== this["original.deadlineDate"]
      || this["draft.deadlineTime"] !== this["original.deadlineTime"] || this.pendingFiles.length > 0;
  },
  get saving() { return this.submitting || this.uploading || this["saveFetch.loading"]; },
  get saveBlocked() { return this.saving || this.offline === true; },
  get saveLabel() { return this.uploading ? "添付ファイルを送信中…" : this.saving ? "保存中…" : "保存する"; },
  get titleInvalid() { return this["formErrors.title"] ? "true" : null; },
  get bodyInvalid() { return this["formErrors.body"] ? "true" : null; },
  get catInvalid() { return this["formErrors.cat"] ? "true" : null; },
  get deadlineInvalid() { return this["formErrors.deadline"] ? "true" : null; },
  get titleCount() { return `${[...this["draft.title"]].length} / 60`; },
  get existingAttachments() { return this.formMode === "edit" ? this.noticeAttachments : []; },
  get hasExistingAttachments() { return this.existingAttachments.length > 0; },
  get "existingAttachments.*.sizeText"() { return formatSize(this["existingAttachments.*.size"]); },
  get hasPendingFiles() { return this.pendingFiles.length > 0; },
  get "pendingFiles.*.sizeText"() { return formatSize(this["pendingFiles.*.size"]); },
  get "pendingFiles.*.failed"() { return this["pendingFiles.*.error"] !== ""; },
  get "pendingFiles.*.shownProgress"() {
    return this["pendingFiles.*.status"] === "uploading" ? Math.round(this["upload.progress"] ?? 0) : this["pendingFiles.*.progress"];
  },
  get "pendingFiles.*.isUploading"() { return this["pendingFiles.*.status"] === "uploading"; },
  get "pendingFiles.*.statusText"() {
    const s = this["pendingFiles.*.status"];
    if (s === "uploading") return `送信中 ${this["pendingFiles.*.shownProgress"]}%`;
    if (s === "done") return "送信済み";
    if (s === "ready") return "保存時に送信します";
    return "";
  },
  get cancelHref() { return this.formMode === "edit" ? `/notices/${this.noticeId}` : "/notices"; },

  loadDraft(n) {
    const values = n
      ? { title: n.title, cat: n.cat, body: n.body, deadlineDate: splitDeadline(n.deadline).date, deadlineTime: splitDeadline(n.deadline).time }
      : { ...EMPTY_DRAFT };
    this.draft = values;
    this.original = { ...values };
    this.formFor = n ? n.id : "new";
    this.formErrors = { ...EMPTY_FORM_ERRORS };
    this.formMessage = "";
    this.pendingFiles = [];
    fileStore.clear();
  },
  pickFiles(event) {
    const input = event.target;
    const picked = [...(input.files ?? [])];
    if (picked.length === 0) return;
    const rows = picked.map((file) => {
      const key = ++fileSeq;
      fileStore.set(key, file);
      const error = checkFile(file) ?? "";
      return { key, name: file.name, size: file.size, progress: 0, status: error ? "invalid" : "ready", error };
    });
    this.pendingFiles = [...this.pendingFiles, ...rows];
    input.value = "";
  },
  removePending(event, index) {
    if (this.uploading) return;
    fileStore.delete(this[`pendingFiles.${index}.key`]);
    this.pendingFiles = this.pendingFiles.toSpliced(index, 1);
  },
  saveNotice() {
    if (this.saveBlocked || this.formFor === null) return;
    const deadline = joinDeadline(this["draft.deadlineDate"], this["draft.deadlineTime"]);
    if (deadline.error) {
      this.formErrors = { ...EMPTY_FORM_ERRORS, deadline: deadline.error };
      this.formMessage = "入力内容を確認してください。";
      return;
    }
    if (this.pendingFiles.some((f) => f.status === "invalid")) {
      this.formMessage = "添付できないファイルを外してから保存してください。";
      return;
    }
    const isNew = this.formFor === "new";
    this.submitting = true;
    this.formMessage = "";
    // body is one-shot: a new object on every save, the second save included.
    this["saveFetch.url"] = isNew ? "/api/notices" : "/api/notices/" + this.formFor;
    this["saveFetch.method"] = isNew ? "POST" : "PUT";
    this["saveFetch.body"] = {
      title: this["draft.title"], cat: this["draft.cat"], body: this["draft.body"], deadline: deadline.value,
    };
    this["saveFetch.trigger"] = true;
  },
  startUploads(noticeId) {
    this.uploading = true;
    this.uploadNoticeId = noticeId;
    this.uploadHadError = false;
    // a save after a failed upload sends the files that failed again
    this.pendingFiles = this.pendingFiles.map((f) => (f.status === "error" ? { ...f, status: "ready", error: "" } : f));
    this.uploadNext();
  },
  uploadNext() {
    const i = this.pendingFiles.findIndex((f) => f.status === "ready");
    if (i < 0) {
      this.uploading = false;
      this.uploadKey = null;
      if (!this.uploadHadError) { this.finishSave(this.uploadNoticeId); return; }
      this.submitting = false;
      this.formMessage = "保存しましたが、送信できなかった添付ファイルがあります。ファイルを確認してもう一度保存してください。";
      return;
    }
    this.uploadKey = this[`pendingFiles.${i}.key`];
    this[`pendingFiles.${i}.status`] = "uploading";
    this["upload.url"] = `/api/notices/${this.uploadNoticeId}/attachments`;
    this["upload.files"] = [fileStore.get(this.uploadKey)];   // assigning files starts the upload
  },
  uploadRowIndex() { return this.pendingFiles.findIndex((f) => f.key === this.uploadKey); },
  finishSave(noticeId) {
    this.submitting = false;
    fileStore.clear();
    this.pendingFiles = [];
    this.original = { ...this.draft };   // nothing unsaved: leaveConfirm is null in this same update
    if (this.noticeUrl) this.$command.fetchNotice.emit();   // edit → detail keeps the same url
    this.replaceUrl = "/notices/" + noticeId;   // replace: Back does not reopen the saved form
  },
  discardForms() {
    this.original = { ...this.draft };
    this.pendingFiles = [];
    fileStore.clear();
    this.absenceOriginal = { ...this.absence };
  },

  // ---------------------------------------------------------------- absences
  /** @type {{ value: Absence[] | null, loading: boolean, error: any, status: number }} */
  absencesFetch: { value: null, loading: false, error: null, status: 0 },
  get absencesUrl() { return this.routeName === "absences" && this.loggedIn ? "/api/absences" : null; },
  get absences() { return this["absencesFetch.value"] ?? []; },
  get absencesReady() { return !this["absencesFetch.loading"] && this["absencesFetch.value"] != null; },
  get absencesEmpty() { return this.absencesReady && this.absences.length === 0; },
  get absencesHasItems() { return this.absencesReady && this.absences.length > 0; },
  get absencesFailed() { return !this["absencesFetch.loading"] && this["absencesFetch.error"] != null && this["absencesFetch.error.status"] !== 401; },
  get absencesHeading() { return this.isTeacher ? "欠席連絡（全員）" : "欠席連絡"; },
  get "absences.*.dateText"() { return formatDay(this["absences.*.date"] + "T12:00:00+09:00"); },
  get "absences.*.reasonText"() { return reasonLabel(this["absences.*.reason"]); },
  retryAbsences() { this.$command.fetchAbsences.emit(); },
  reasonOptions: REASONS,
  absence: { date: "", reason: "", note: "" },
  absenceOriginal: { date: "", reason: "", note: "" },
  absenceErrors: { ...EMPTY_ABSENCE_ERRORS },
  absenceMessage: "",
  absenceSubmitting: false,
  absenceFetch: { body: null, trigger: false, loading: false },
  get absenceDirty() {
    if (this.routeName !== "absence-new") return false;
    return this["absence.date"] !== this["absenceOriginal.date"] || this["absence.reason"] !== this["absenceOriginal.reason"]
      || this["absence.note"] !== this["absenceOriginal.note"];
  },
  get absenceBlocked() { return this.absenceSubmitting || this["absenceFetch.loading"] || this.offline === true; },
  get absenceSaveLabel() { return this.absenceBlocked && this.offline !== true ? "送信中…" : "送信する"; },
  get absenceDateInvalid() { return this["absenceErrors.date"] ? "true" : null; },
  get absenceReasonInvalid() { return this["absenceErrors.reason"] ? "true" : null; },
  get absenceNoteInvalid() { return this["absenceErrors.note"] ? "true" : null; },
  get absenceChild() { return this["session.user.child"] ?? ""; },
  startAbsence() {
    const fresh = { date: todayJst(), reason: "", note: "" };
    this.absence = fresh;
    this.absenceOriginal = { ...fresh };
    this.absenceErrors = { ...EMPTY_ABSENCE_ERRORS };
    this.absenceMessage = "";
  },
  submitAbsence() {
    if (this.absenceBlocked) return;
    this.absenceSubmitting = true;
    this.absenceMessage = "";
    this["absenceFetch.body"] = { date: this["absence.date"], reason: this["absence.reason"], note: this["absence.note"] };
    this["absenceFetch.trigger"] = true;
  },

  // ---------------------------------------------------------------- settings (this computer only)
  prefs: { textSize: "normal", showAttachments: true },
  // Accessor pair bound to <wcs-storage value#init=element> (storage README "several inputs, one key").
  get savedPrefs() { return { textSize: this["prefs.textSize"], showAttachments: this["prefs.showAttachments"] }; },
  set savedPrefs(v) {
    if (!v || typeof v !== "object") return;   // null on a first visit keeps the defaults
    this.prefs = { textSize: v.textSize === "large" ? "large" : "normal", showAttachments: v.showAttachments !== false };
  },
  get largeText() { return this["prefs.textSize"] === "large"; },

  // ---------------------------------------------------------------- the whole site
  offline: null,
  get dirty() { return this.formDirty || this.absenceDirty; },
  get offlineText() { return this.offline === true ? "オフラインです。接続が戻るまで保存・送信はできません。" : ""; },
  // What the page-level status region says: the login notice, else "loading" while a page waits for its data.
  get pageStatus() {
    if (this.routeName === "login" && this.loginNotice) return this.loginNotice;
    const loading = this["listFetch.loading"] || this.noticeLoading || this["absencesFetch.loading"];
    return loading ? "読み込み中…" : "";
  },
  // Bound to <wcs-router>.leaveConfirm: the question while something is unsaved, null otherwise.
  get discardPrompt() { return this.dirty ? "保存していない変更があります。このページを離れますか？" : null; },
  get showHeader() { return this.loggedIn && this.routeName !== "login"; },
  noop() {},

  reloadCurrent() {
    if (this.listUrl) this.$command.fetchList.emit();
    if (this.noticeUrl) this.$command.fetchNotice.emit();
    if (this.questionsUrl) this.$command.fetchQuestions.emit();
    if (this.absencesUrl) this.$command.fetchAbsences.emit();
  },

  $commandTokens: ["fetchList", "fetchNotice", "fetchQuestions", "fetchAbsences", "markRead", "wsSend", "wsClose"],
  $eventTokens: [
    "loginResponded", "apiFailed", "saveResponded", "saveFailed", "absenceResponded", "absenceFailed",
    "wsReceived", "questionsLoaded", "uploadResponded", "uploadFailed",
  ],
  $on: {
    loginResponded(state, event) {
      const { status, value } = event.detail ?? {};
      if (status !== 200 || !value?.token) return;
      state.session = value;   // the token watch decides where to go
      state.loginForm = { id: "", password: "" };
      state.loginNotice = "";
    },
    // Every GET reports its failures here: a 401 means the token expired.
    apiFailed(state, event) {
      if (event.detail?.status === 401) state.requireLogin("reloadCurrent");
    },
    saveResponded(state, event) {
      const { status, value } = event.detail ?? {};
      if ((status !== 200 && status !== 201) || !value) return;   // failures arrive on saveFailed
      state.formFor = value.id;   // a retry after a failed upload is a PUT now
      if (state.pendingFiles.length === 0) { state.finishSave(value.id); return; }
      state.startUploads(value.id);
    },
    uploadResponded(state, event) {
      if (event.detail?.status !== 201 || state.uploadKey == null) return;
      const i = state.uploadRowIndex();
      if (i >= 0) state.pendingFiles = state.pendingFiles.with(i, { ...state.pendingFiles[i], status: "done", progress: 100 });
      state.uploadNext();
    },
    uploadFailed(state, event) {
      const error = event.detail;
      if (!error || state.uploadKey == null) return;   // the reset to null when an upload starts
      const status = error.status ?? 0;
      const i = state.uploadRowIndex();
      if (i >= 0) state.pendingFiles = state.pendingFiles.with(i, { ...state.pendingFiles[i], status: "error", error: uploadErrorMessage(status) });
      if (status === 401) {
        state.uploading = false;
        state.uploadKey = null;
        state.submitting = false;
        state.requireLogin("saveNotice");
        return;
      }
      state.uploadHadError = true;
      state.uploadNext();
    },
    saveFailed(state, event) {
      const error = event.detail;
      if (!error) return;   // reset to null when a request starts
      state.submitting = false;
      if (error.status === 401) { state.requireLogin("saveNotice"); return; }
      if (error.status === 422) {
        let parsed = null;
        try { parsed = JSON.parse(error.body); } catch { parsed = null; }
        state.formErrors = { ...EMPTY_FORM_ERRORS, ...(parsed?.errors ?? {}) };
        state.formMessage = "入力内容を確認してください。";
      } else if (error.status === 403) {
        state.formMessage = "このアカウントではお知らせを保存できません。";
      } else {
        state.formMessage = "保存できませんでした。通信状態を確認して、もう一度お試しください。";
      }
    },
    absenceResponded(state, event) {
      const { status } = event.detail ?? {};
      if (status !== 201) return;
      state.absenceSubmitting = false;
      state.absenceOriginal = { ...state.absence };
      state.replaceUrl = "/absences";
    },
    absenceFailed(state, event) {
      const error = event.detail;
      if (!error) return;
      state.absenceSubmitting = false;
      if (error.status === 401) { state.requireLogin("submitAbsence"); return; }
      if (error.status === 422) {
        let parsed = null;
        try { parsed = JSON.parse(error.body); } catch { parsed = null; }
        state.absenceErrors = { ...EMPTY_ABSENCE_ERRORS, ...(parsed?.errors ?? {}) };
        state.absenceMessage = "入力内容を確認してください。";
      } else {
        state.absenceMessage = "送信できませんでした。通信状態を確認して、もう一度お試しください。";
      }
    },
    questionsLoaded(state, event) {
      const { status, value } = event.detail ?? {};
      if (status !== 200 || !Array.isArray(value)) return;
      // Merge, never replace: a question that arrived on the socket while this GET was in flight stays.
      const keep = state.questionsFor === state.noticeId ? state.questions : [];
      state.questionsFor = state.noticeId;
      state.questions = mergeQuestions(keep, value);
      if (state.pendingAsk && value.some((q) => q.text === state.pendingAsk && q.from === state.userName)) {
        state.pendingAsk = "";
        state.askText = "";
      }
    },
    wsReceived(state, event) {
      const msg = event.detail;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "auth-error") {
        state.$command.wsClose.emit();   // stop auto-reconnect from retrying with the dead token
        state.requireLogin("");
        return;
      }
      if (state.questionsFor !== state.noticeId) return;
      if (msg.type === "question" && msg.question) {
        state.questions = mergeQuestions(state.questions, [msg.question]);
        if (state.pendingAsk && msg.question.text === state.pendingAsk && msg.question.from === state.userName) {
          state.pendingAsk = "";
          state.askText = "";
        }
      } else if (msg.type === "answer" && msg.answer) {
        state.questions = state.questions.map((q) => (q.id === msg.questionId ? { ...q, answer: msg.answer } : q));
        if (state.answeringId === msg.questionId) { state.answeringId = null; state.answerText = ""; }
      }
    },
  },

  $watch: {
    // Every session change lands here: login, logout, expiry, and the same in another tab.
    token(cur, prev) {
      if (cur === prev) return;
      if (cur) {
        if (this.reauth) {
          this.reauth = false;
          const retry = this.retryAfterLogin;
          this.retryAfterLogin = "";
          // another account may have logged in: leave pages it may not see
          if ((TEACHER_ROUTES.includes(this.routeName) && !this.isTeacher) || (PARENT_ROUTES.includes(this.routeName) && !this.isParent)) {
            this.discardForms();
            this.replaceUrl = "/notices";
            return;
          }
          if (retry === "saveNotice") this.saveNotice();
          else if (retry === "submitAbsence") this.submitAbsence();
          this.reloadCurrent();
          return;
        }
        if (this.routeName === "login") this.replaceUrl = safeNext(this["query.next"]);
        return;
      }
      // logged out — here, or in another tab
      this.reauth = false;
      this.listFetch = { value: null, loading: false, error: null, status: 0 };
      this.questions = [];
      this.questionsFor = null;
      if (this.loggingOut) {
        this.loggingOut = false;
        this.navigateUrl = "/login";
        return;
      }
      if (this.routeName === "login" || this.routeName === "") return;
      this.loginNotice = "別のタブでログアウトしました。もう一度ログインしてください。";
      if (this.dirty) {
        // keep the unsaved form: ask for the login over it instead of leaving
        this.reauth = true;
        this.loginForm = { id: "", password: "" };
        return;
      }
      // location, not this.path: with <wcs-view-transition> the router writes path a frame after the other outputs
      // (router README / timing contract §21.1, 4.10.1), and a session change in that frame would get the page being left
      this.replaceUrl = "/login?next=" + encodeURIComponent(location.pathname + location.search);
    },
    // Another notice (or none): drop the previous one's questions. <wcs-fetch> loads the new url itself.
    // (A watched getter fires whenever something it reads changed, even when its value did not — compare with prev.)
    questionsUrl(cur, prev) {
      if (cur === prev) return;
      this.questionsFor = null;
      this.questions = [];
      this.answeringId = null;
    },
    currentListPath(cur) { if (cur) this.lastListPath = cur; },
    // back online: load again what failed while offline
    offline(cur, prev) { if (prev === true && cur === false) this.reloadCurrent(); },
    reauth(cur) {
      // move focus into the dialog once it is rendered (the watch runs after the bindings applied)
      if (!cur) return;
      let tries = 0;
      const focus = () => {
        const input = document.getElementById("reauth-password");
        if (input) input.focus();
        else if (++tries < 30) requestAnimationFrame(focus);
      };
      requestAnimationFrame(focus);
    },
    notice(cur) {
      if (this.routeName === "notice" && cur && !cur.read) this.$command.markRead.emit();
      if (this.routeName === "notice-edit" && cur && this.formFor !== cur.id) this.loadDraft(cur);
    },
    routeName(cur) {
      if (cur === "notice-new") this.loadDraft(null);
      if (cur === "notice-edit") {
        this.formFor = null;
        if (this.notice) this.loadDraft(this.notice);
      }
      if (cur === "absence-new") this.startAbsence();
      if (cur !== "notice") { this.wsEverConnected = false; this.pendingAsk = ""; this.askError = ""; }
      if (cur !== "login") this.loginNotice = "";
    },
    // Leaving the notice removes <wcs-ws> with the route, which closes the socket. The url also goes away on the
    // notice itself — the login dialog over it, a logout in another tab — and a cleared url does not disconnect
    // (websocket README): close it then (since 4.11 a socket still connecting is closed once it opens).
    wsUrl(cur, prev) {
      if (!cur && prev && this.routeName === "notice") this.$command.wsClose.emit();
    },
    wsConnected(cur, prev) {
      if (cur) {
        // connected (first time too — the socket opens after the first GET) or reconnected: load what was
        // said while we were not listening; the merge by id drops nothing and doubles nothing
        if (this.questionsUrl) this.$command.fetchQuestions.emit();
        this.wsEverConnected = true;
      } else if (prev && this.pendingAsk) {
        this.askError = "接続が切れたため、質問が届いたか確認できません。再接続後に一覧を確認してください。";
      }
    },
    "listFetch.value"(v) {
      if (!v) return;
      this.pageNumbers = Array.from({ length: Math.max(1, v.pages) }, (_, i) => i + 1);
      // a page past the end (a hand-typed URL) is replaced by the last page that exists
      if (this.routeName === "notices" && v.page > v.pages) this.replaceUrl = noticesPath({ cat: this.listCat, page: v.pages });
    },
  },

  $connectedCallback() {
    this.wsBase = location.origin.replace(/^http/, "ws");
  },
};
