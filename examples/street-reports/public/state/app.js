// @ts-check
// The root state of the whole app — one object, because a state composed with `...spread` from several
// modules is not checked by @wcstack/lint at all (friction-log F-09). Sections are named after the React files
// they replace, in the order a React developer would look for them.
//
// React → here, in one line each:
//   useState in a component  → a key in this object (it does NOT reset when the page is left: see "route lifecycle")
//   useMemo / derived values → a getter (`get listItems()`, row getters `get "listItems.*.href"()`)
//   useEffect                → $watch (on the value it depended on) or the route lifecycle ($watch on routeName)
//   useFetch                 → a <wcs-fetch manual> in index.html + a $watch on the page's url getter
//   contexts                 → top-level keys every page reads by path (no provider)
//   useReducer               → plain methods that write the keys (the reducer's cases)
// defineState only types `this` for tsc / wcs-tsc (no runtime work); the import map points it at the pinned file.
import { defineState } from '@wcstack/state/define';
import { api } from '../lib/api.js';
import { buildQuery } from '../lib/api.js';
import { formatDate, formatDateTime, formatRelative, toIsoDay } from '../lib/format.js';
import {
  CATEGORIES, CATEGORY_LABELS, DISTRICTS, PRIORITIES, PRIORITY_LABELS, SORTS, STATUSES, STATUS_LABELS, SUBCATEGORIES,
  pageTitle, staffName, stepStatus,
} from '../lib/labels.js';
import {
  DESCRIPTION_MAX, EMPTY_REPORT, REPORT_FIELDS, isReportDirty, toReportPayload, validateReport,
} from '../lib/validation.js';
import {
  LOADING_DELAY_MS, MAX_VISIBLE_TOASTS, NAV_ITEMS, NOW_INTERVAL_MS, PER_PAGE, TOAST_DURATION,
  byPriorityThenUpdate, clearDraft, initialForm, isNavActive, isTypingTarget, nextSearch, readLastSeen, saveDraft,
  toCard, trapTab, upsert, writeLastSeen,
} from './helpers.js';

// ---- things that are not state (React kept them in refs or in effect closures) ----
const toastTimers = new Map(); // toast id → timeout id (ToastContext: Toast's useEffect)
let nextToastId = 1; // ToastContext nextId ref
const loadingTimers = {}; // useDelayedFlag's timeouts, per page
let nowTimer = null; // useNow's interval
let lightboxOpener = null; // Lightbox returnFocusTo
let leaveResolver = null; // the pending leave-guard promise (useBlocker's blocker.proceed / reset)
let leavePendingHref = null; // a nav link click held back by the leave dialog
let beforeUnloadOn = false; // useBeforeUnloadGuard
/** workaround: the stats page's code is imported when its route is first entered (React.lazy). A getter may not
 *  read a module variable (it would never recompute), so `statsReady` (state) gates every read of it. */
let statsLib = null;

function onBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = '';
}

function onSlashKey(event) {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
  event.preventDefault();
  document.getElementById('list-search')?.focus();
}

function focusFirstError(errorMap) {
  const first = REPORT_FIELDS.find((field) => errorMap[field] && document.getElementById(`f-${field}`));
  if (first) document.getElementById(`f-${first}`).focus();
}

/**
 * @typedef {{ id: number, url: string, alt: string }} Photo
 * @typedef {{ id: number, title: string, category: string, subcategory: string, status: string, priority: number,
 *   district: string, address: string, description: string, reportedAt: string, updatedAt: string,
 *   assigneeId: number | null, anonymous: boolean, reporterName: string, reporterPhone: string,
 *   photos: Photo[], version: number, prevId: number | null, nextId: number | null }} Report
 * @typedef {{ id: number, reportId: number, authorId: number, body: string, createdAt: string }} Comment
 * @typedef {{ title: string, category: string, subcategory: string, district: string, address: string,
 *   description: string, reporterName: string, reporterPhone: string }} FieldStrings
 */

const isIsoDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

export default defineState({
  // =====================================================================================================
  // router.jsx — the router's outputs (useLocation / useParams / useSearchParams) and its inputs (navigate)
  // =====================================================================================================
  path: '',
  routeName: '',
  routeParams: {},
  query: {},
  navigateUrl: null,
  replaceUrl: null,

  /** ReportListPage.jsx updateParams() / StatsPage.jsx setRange(): push (or replace) a new query string. */
  updateParams(changes, replace = false) {
    const qs = nextSearch(this.query, changes);
    const target = qs ? `?${qs}` : `${this.path}`;
    if (replace) this.replaceUrl = target;
    else this.navigateUrl = target;
  },

  // =====================================================================================================
  // ErrorBoundary.jsx — $errorCallback is the boundary; a change of pathname resets it, as resetKey did
  // =====================================================================================================
  pageError: false,
  get pageOk() {
    return !this.pageError;
  },
  resetError() {
    this.pageError = false;
  },
  $errorCallback(error, info) {
    console.error('[street-reports] a binding failed:', info?.path, error);
    this.pageError = true;
  },

  // =====================================================================================================
  // context/ThemeContext.jsx (+ useLocalStorage → <wcs-storage key="street-reports:theme">)
  // =====================================================================================================
  themeStored: null,
  systemTheme: 'light',
  get theme() {
    const stored = this.themeStored;
    return stored === 'dark' || stored === 'light' ? stored : this.systemTheme;
  },
  get themeLabel() {
    return `テーマ: ${this.theme === 'dark' ? 'ダーク' : 'ライト'}`;
  },
  toggleTheme() {
    this.themeStored = this.theme === 'dark' ? 'light' : 'dark';
  },

  // =====================================================================================================
  // context/StaffContext.jsx (useFetch('/api/staff') + useLocalStorage('street-reports:staffId'))
  // =====================================================================================================
  staffFetch: { value: null, error: null },
  staffIdStored: null,
  get staff() {
    return this['staffFetch.value'] ?? [];
  },
  get currentStaff() {
    const staff = this.staff;
    const id = this.staffIdStored;
    return staff.find((s) => s.id === id) ?? staff[0] ?? null;
  },
  get currentStaffId() {
    return this.currentStaff?.id ?? null;
  },
  /** Layout.jsx StaffSelect: <select value={currentStaffId ?? ''} onChange={… Number(event.target.value)}> */
  get currentStaffIdInput() {
    return this.currentStaffId == null ? '' : String(this.currentStaffId);
  },
  set currentStaffIdInput(value) {
    this.staffIdStored = Number(value);
  },

  // =====================================================================================================
  // context/ToastContext.jsx — the queue (was a useReducer), at most 3 visible, a 4 s timer per visible toast
  // =====================================================================================================
  /** @type {{ id: number, message: string }[]} */
  toasts: [],
  get visibleToasts() {
    return this.toasts.slice(0, MAX_VISIBLE_TOASTS);
  },
  showToast(message) {
    this.toasts = this.toasts.concat({ id: nextToastId++, message });
    this.armToastTimers();
  },
  dismissToastById(id) {
    clearTimeout(toastTimers.get(id));
    toastTimers.delete(id);
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.armToastTimers();
  },
  dismissToast(event, index) {
    const toast = this.visibleToasts[index];
    if (toast) this.dismissToastById(toast.id);
  },
  /** The timer starts when a toast becomes visible, so queued toasts get their full 4 s. */
  armToastTimers() {
    for (const toast of this.toasts.slice(0, MAX_VISIBLE_TOASTS)) {
      if (!toastTimers.has(toast.id)) {
        toastTimers.set(toast.id, setTimeout(() => this.dismissToastById(toast.id), TOAST_DURATION));
      }
    }
  },

  // =====================================================================================================
  // context/ReportsStore.jsx — the summary behind the header badge, its whole-session event stream
  // =====================================================================================================
  summaryFetch: { value: null, error: null },
  summary: null,
  get badgeText() {
    return this.summary ? `新規 ${this['summary.new']} 件` : '';
  },
  refreshSummary() {
    // A new request on the same <wcs-fetch> aborts the previous one (the AbortController of ReportsStore).
    this.$command.loadSummary.emit('/api/reports/summary');
  },
  statusChanged(from, to, count = 1) {
    if (!this.summary || from === to) return;
    const summary = { ...this.summary };
    summary[from] = Math.max(0, summary[from] - count);
    summary[to] += count;
    this.summary = summary;
  },

  // =====================================================================================================
  // components/Layout.jsx — the nav (aria-current follows NAV_ITEMS.isActive)
  // =====================================================================================================
  navItems: NAV_ITEMS.map((item) => ({ ...item })),
  get 'navItems.*.current'() {
    return isNavActive(this['.to'], this.path) ? 'page' : null;
  },
  followNav(event) {
    // workaround: <Link> for the nav — see index.html. A plain click navigates in the app; a modified click is
    // left to the browser (new tab).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const href = event.target.closest('a').getAttribute('href');
    if (this.formBlocking && href !== '/reports/new') {
      // useBlocker for a link: hold the navigation until the dialog is answered (a guard would push first and
      // could only redirect back, leaving a duplicate history entry — friction-log F-14)
      leavePendingHref = href;
      this.leaveDialogOpen = true;
      return;
    }
    this.navigateUrl = href;
  },

  // Shared option lists (the `.map(s => <option …>)` of every select)
  statusOptions: STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
  categoryOptions: CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
  sortOptions: SORTS.map((s) => ({ value: s.value, label: s.label })),
  priorityOptions: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })),
  districtOptions: [...DISTRICTS],

  // =====================================================================================================
  // pages/ReportListPage.jsx
  // =====================================================================================================
  /** @type {{ value: { items: Report[], total: number, page: number, per: number } | null, loading: boolean, error: any, status: number }} */
  listFetch: { value: null, loading: false, error: null, status: 0 },
  listShowLoading: false, // useDelayedFlag(loading, 250)
  listText: '', // the search box (local while typing)
  listTextSettled: null, // useDebouncedValue(text, 300) — <wcs-debounce> writes it
  listLastSeen: null, // useLastSeen()
  /** @type {{ key: string, ids: number[] }} */
  listSelection: { key: '', ids: [] }, // selection, keyed by the filters it belongs to
  listBulkBusy: false,

  get listStatus() {
    return this['query.status'] ?? '';
  },
  get listCategory() {
    return this['query.category'] ?? '';
  },
  get listQ() {
    return this['query.q'] ?? '';
  },
  get listSort() {
    return this['query.sort'] ?? SORTS[0].value;
  },
  get listPage() {
    return Math.max(1, Number.parseInt(this['query.page'] ?? '1', 10) || 1);
  },
  get listUrl() {
    if (this.routeName !== 'list') return null;
    return `/api/reports${buildQuery({
      status: this.listStatus, category: this.listCategory, q: this.listQ, sort: this.listSort, page: this.listPage, per: PER_PAGE,
    })}`;
  },
  get listData() {
    return this['listFetch.value'];
  },
  get listError() {
    return !this['listFetch.loading'] && this['listFetch.error'] != null;
  },
  get listBusyAttr() {
    return this['listFetch.loading'] ? 'true' : 'false';
  },
  get listItems() {
    return this['listFetch.value.items'] ?? [];
  },
  get listTotalPages() {
    const data = this.listData;
    return data ? Math.max(1, Math.ceil(data.total / data.per)) : 1;
  },
  get listShowEmpty() {
    return Boolean(this.listData) && !this.listError && !this['listFetch.loading'] && this.listItems.length === 0;
  },
  get listShowPagination() {
    return Boolean(this.listData) && !this.listError && this.listTotalPages > 1;
  },
  /** <Pagination onPageChange={(p) => updateParams({ page: p === 1 ? null : p })}>: the part's page change is an event. */
  choosePage(page) {
    const p = Number(page);
    if (p && p !== this.listPage) this.updateParams({ page: p === 1 ? null : p });
  },
  get listHasFilters() {
    return Boolean(this.listStatus || this.listCategory || this.listQ || this['query.sort'] || this['query.page']);
  },
  get listClearDisabled() {
    return !this.listHasFilters && !this.listText;
  },
  changeStatusFilter(event) {
    this.updateParams({ status: event.target.value, page: null });
  },
  changeCategoryFilter(event) {
    this.updateParams({ category: event.target.value, page: null });
  },
  changeSortFilter(event) {
    const value = event.target.value;
    this.updateParams({ sort: value === SORTS[0].value ? null : value, page: null });
  },
  clearFilters() {
    this.listText = '';
    this.navigateUrl = '/reports';
  },
  reloadList() {
    if (this.listUrl) this.$command.loadList.emit(this.listUrl);
  },

  // rows
  get 'listItems.*.href'() {
    return `/reports/${this['.id']}`;
  },
  get 'listItems.*.checkLabel'() {
    return `「${this['.title']}」を選択`;
  },
  get 'listItems.*.categoryLabel'() {
    return CATEGORY_LABELS[this['.category']];
  },
  get 'listItems.*.statusClass'() {
    return `status status-${this['.status']}`;
  },
  get 'listItems.*.statusLabel'() {
    return STATUS_LABELS[this['.status']];
  },
  get 'listItems.*.priorityLabel'() {
    return PRIORITY_LABELS[this['.priority']];
  },
  get 'listItems.*.dateText'() {
    return formatDate(this['.reportedAt']);
  },
  get 'listItems.*.assigneeName'() {
    return staffName(this.staff, this['.assigneeId']);
  },
  get 'listItems.*.isNew'() {
    const lastSeen = this.listLastSeen;
    return lastSeen !== null && Date.parse(this['.reportedAt']) > lastSeen;
  },

  // selection — derived from the filter key, so changing filters or the page clears it without an effect
  get listFilterKey() {
    return `${this.listStatus}|${this.listCategory}|${this.listQ}|${this.listSort}|${this.listPage}`;
  },
  get listSelectedIds() {
    return this['listSelection.key'] === this.listFilterKey ? this['listSelection.ids'] : [];
  },
  get 'listItems.*.selected'() {
    return this.listSelectedIds.includes(this['.id']);
  },
  get listSelectedOnPageCount() {
    const ids = this.listSelectedIds;
    return this.listItems.filter((r) => ids.includes(r.id)).length;
  },
  get listAllSelected() {
    return this.listItems.length > 0 && this.listSelectedOnPageCount === this.listItems.length;
  },
  get listSomeSelected() {
    return this.listSelectedOnPageCount > 0 && !this.listAllSelected;
  },
  get listNoItems() {
    return this.listItems.length === 0;
  },
  get listHasSelection() {
    return this.listSelectedIds.length > 0;
  },
  get listSelectedCount() {
    return this.listSelectedIds.length;
  },
  get listAssignDisabled() {
    return this.listBulkBusy || this.currentStaffId == null;
  },
  setSelected(ids) {
    this.listSelection = { key: this.listFilterKey, ids };
  },
  toggleRow(event, index) {
    const id = this.listItems[index].id;
    const ids = this.listSelectedIds;
    this.setSelected(ids.includes(id) ? ids.filter((x) => x !== id) : ids.concat(id));
  },
  toggleAll() {
    this.setSelected(this.listAllSelected ? [] : this.listItems.map((r) => r.id));
  },
  mutateList(update) {
    const data = this['listFetch.value'];
    if (data) this['listFetch.value'] = { ...data, items: data.items.map(update) };
  },
  bulkAssignToMe() {
    return this.runBulk({ assigneeId: this.currentStaffId });
  },
  bulkComplete() {
    return this.runBulk({ status: 'done' });
  },
  async runBulk(patch) {
    const ids = this.listSelectedIds;
    const targets = this.listItems.filter((r) => ids.includes(r.id));
    if (targets.length === 0) return;
    const before = new Map(targets.map((r) => [r.id, r]));
    const moves = patch.status ? targets.filter((r) => r.status !== patch.status) : [];
    this.mutateList((r) => (before.has(r.id) ? { ...r, ...patch } : r));
    moves.forEach((r) => this.statusChanged(r.status, patch.status));
    this.listBulkBusy = true;
    try {
      const { updated } = await api.bulkUpdate([...before.keys()], patch);
      const byId = new Map(updated.map((r) => [r.id, r]));
      this.mutateList((r) => byId.get(r.id) ?? r);
      this.setSelected([]);
      this.showToast(`${updated.length} 件を更新しました`);
    } catch {
      this.mutateList((r) => before.get(r.id) ?? r);
      moves.forEach((r) => this.statusChanged(patch.status, r.status));
      this.showToast('更新に失敗しました');
    } finally {
      this.listBulkBusy = false;
    }
  },

  // =====================================================================================================
  // pages/ReportDetailPage.jsx (ReportDetail, ReportView, Comments)
  // =====================================================================================================
  detailFetch: { value: null, loading: false, error: null, status: 0 },
  commentsFetch: { value: null, error: null, status: 0 },
  detailHttpStatus: 0,
  /** @type {Report | null} */
  report: null, // the report shown (the fetched one, then the optimistic edits — useFetch's mutate)
  /** @type {Comment[] | null} */
  comments: null,
  detailSaving: false,
  detailConflict: false,
  lightbox: null, // { index }
  now: Date.now(), // useNow(10000), ticking while a detail page is shown

  get detailId() {
    return this.routeName === 'detail' ? (this['routeParams.id'] ?? null) : null;
  },
  get detailValid() {
    return this.detailId !== null && /^\d+$/.test(this.detailId);
  },
  get detailUrl() {
    return this.detailValid ? `/api/reports/${this.detailId}` : null;
  },
  get detailNotFound() {
    return this.routeName === 'detail' && (!this.detailValid || this.detailHttpStatus === 404);
  },
  get detailError() {
    return !this.report && !this['detailFetch.loading'] && this['detailFetch.error'] != null && this.detailHttpStatus !== 404;
  },
  get detailLoading() {
    return !this.report;
  },
  get detailTitle() {
    const report = this.report;
    if (report) return pageTitle(`${report.title} - 通報 #${report.id}`);
    // What the React app ends with: NotFound's useDocumentTitle wins after a 404 (it mounts later), while for a
    // non-numeric id both effects run at once and ReportDetail's (the parent's) runs last.
    if (this.detailHttpStatus === 404) return pageTitle('通報が見つかりません');
    return pageTitle(`通報 #${this.detailId ?? ''}`);
  },
  /** DetailNav. While a report loads, ids are assumed contiguous so users can keep flipping. */
  get detailNav() {
    const report = this.report;
    if (report) {
      return {
        prevHref: report.prevId != null ? `/reports/${report.prevId}` : null,
        nextHref: report.nextId != null ? `/reports/${report.nextId}` : null,
      };
    }
    const n = Number(this.detailId);
    return { prevHref: n > 1 ? `/reports/${n - 1}` : null, nextHref: `/reports/${n + 1}` };
  },
  get detailNumber() {
    return `通報 #${this['report.id']}`;
  },
  get detailStatusValue() {
    return this['report.status'] ?? '';
  },
  get detailAssigneeValue() {
    const id = this['report.assigneeId'];
    return id == null ? '' : String(id);
  },
  get detailPriorityValue() {
    const p = this['report.priority'];
    return p == null ? '' : String(p);
  },
  get detailCategoryText() {
    const report = this.report;
    return report ? `${CATEGORY_LABELS[report.category]}（${report.subcategory}）` : '';
  },
  get detailReportedText() {
    const at = this['report.reportedAt'];
    return at ? formatDateTime(at) : '';
  },
  get detailUpdatedText() {
    const at = this['report.updatedAt'];
    return at ? formatDateTime(at) : '';
  },
  get detailReporterText() {
    const r = this.report;
    if (!r) return '';
    return r.anonymous ? '匿名' : `${r.reporterName}${r.reporterPhone ? `（${r.reporterPhone}）` : ''}`;
  },
  get detailPhotos() {
    return this['report.photos'] ?? [];
  },
  get detailHasPhotos() {
    return this.detailPhotos.length > 0;
  },
  get 'detailPhotos.*.openLabel'() {
    return `写真 ${this.$1 + 1} を拡大`;
  },
  reloadDetail() {
    if (this.detailUrl) this.$command.loadDetail.emit(this.detailUrl);
  },
  changeStatus(event) {
    return this.changeField('status', event.target.value);
  },
  changeAssignee(event) {
    const v = event.target.value;
    return this.changeField('assigneeId', v === '' ? null : Number(v));
  },
  changePriority(event) {
    return this.changeField('priority', Number(event.target.value));
  },
  /** ReportView change(field, value): optimistic, rolled back on failure, the server's values on a 409. */
  async changeField(field, value) {
    const previous = this.report;
    if (!previous || previous[field] === value) return;
    this.report = { ...previous, [field]: value };
    if (field === 'status') this.statusChanged(previous.status, value);
    this.detailSaving = true;
    this.detailConflict = false;
    try {
      const updated = await api.patchReport(previous.id, previous.version, { [field]: value });
      if (this['report.id'] === previous.id) this.report = { ...this.report, ...updated };
    } catch (err) {
      if (field === 'status') this.statusChanged(value, previous.status);
      if (this['report.id'] !== previous.id) return; // the user has moved on to another report
      if (err.status === 409 && err.data?.report) {
        this.report = { ...this.report, ...err.data.report };
        this.detailConflict = true;
        this.refreshSummary();
      } else {
        this.report = { ...this.report, [field]: previous[field], version: previous.version };
        this.showToast('更新に失敗しました');
      }
    } finally {
      this.detailSaving = false;
    }
  },

  // Comments
  get commentsUrl() {
    const id = this['report.id'];
    return id != null ? `/api/reports/${id}/comments` : null;
  },
  /** @returns {Comment[]} */
  get commentList() {
    return this.comments ?? [];
  },
  get commentsEmpty() {
    return Array.isArray(this.comments) && this.comments.length === 0;
  },
  get commentsAny() {
    return Array.isArray(this.comments) && this.comments.length > 0;
  },
  get 'commentList.*.authorName'() {
    return staffName(this.staff, this['.authorId']);
  },
  get 'commentList.*.createdText'() {
    return formatDateTime(this['.createdAt']);
  },
  get 'commentList.*.relative'() {
    return formatRelative(this['.createdAt'], new Date(this.now));
  },
  /** CommentForm's onSubmit(body): the part asks (event token), we answer with a command. */
  async addComment(body) {
    const reportId = this['report.id'];
    try {
      const comment = await api.addComment(reportId, this.currentStaffId, body);
      if (this['report.id'] === reportId) this.comments = (this.comments ?? []).concat(comment);
      this.$command.commentSent.emit();
    } catch {
      this.$command.commentFailed.emit();
    }
  },

  // Lightbox
  get lightboxOpen() {
    return this.lightbox !== null;
  },
  /** @returns {Photo | null} */
  get lightboxPhoto() {
    const index = this['lightbox.index'];
    return index == null ? null : (this.detailPhotos[index] ?? null);
  },
  get lightboxTitle() {
    const index = this['lightbox.index'];
    return index == null ? '' : `写真 ${index + 1} / ${this.detailPhotos.length}`;
  },
  openLightbox(event, index) {
    lightboxOpener = event.target.closest('button');
    this.lightbox = { index };
  },
  closeLightbox() {
    this.lightbox = null;
  },
  lightboxGo(delta) {
    const n = this.detailPhotos.length;
    if (n === 0 || this.lightbox === null) return;
    this.lightbox = { index: (this['lightbox.index'] + delta + n) % n };
  },
  lightboxPrev() {
    this.lightboxGo(-1);
  },
  lightboxNext() {
    this.lightboxGo(1);
  },
  lightboxKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.closeLightbox();
    } else if (event.key === 'Tab') {
      trapTab(event, event.target.closest('[role="dialog"]'));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.lightboxGo(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.lightboxGo(-1);
    }
  },
  /** Modal.jsx: a mousedown on the backdrop itself closes the dialog that is open. */
  modalBackdropDown(event) {
    if (!event.target.classList?.contains('modal-backdrop')) return;
    if (this.leaveDialogOpen) this.cancelLeave();
    else this.closeLightbox();
  },

  // =====================================================================================================
  // pages/BoardPage.jsx
  // =====================================================================================================
  boardFetch: { value: null, loading: false, error: null },
  boardCards: null,
  boardMineOnly: false,
  boardPendingFocus: null, // { id, direction } — focusCardButton after the card has moved (was flushSync + refs)
  boardColumns: STATUSES.map((status) => ({ status, label: STATUS_LABELS[status], headingId: `column-${status}` })),

  get boardUrl() {
    return this.routeName === 'board' ? '/api/reports/board' : null;
  },
  get boardEventsUrl() {
    return this.routeName === 'board' ? '/api/events' : null;
  },
  get boardShowLoading() {
    return !this.boardCards && !this['boardFetch.error'];
  },
  get 'boardColumns.*.cards'() {
    const status = this['.status'];
    const mineOnly = this.boardMineOnly;
    const me = this.currentStaffId;
    return (this.boardCards ?? [])
      .filter((c) => c.status === status && (!mineOnly || c.assigneeId === me))
      .toSorted(byPriorityThenUpdate);
  },
  get 'boardColumns.*.countText'() {
    return `${this['.cards'].length} 件`;
  },
  get 'boardColumns.*.cards.*.headingId'() {
    return `card-${this['.id']}`;
  },
  get 'boardColumns.*.cards.*.href'() {
    return `/reports/${this['.id']}`;
  },
  get 'boardColumns.*.cards.*.assigneeText'() {
    return `担当: ${staffName(this.staff, this['.assigneeId'])}`;
  },
  get 'boardColumns.*.cards.*.priorityClass'() {
    return `priority priority-${this['.priority']}`;
  },
  get 'boardColumns.*.cards.*.priorityText'() {
    return `優先度 ${PRIORITY_LABELS[this['.priority']]}`;
  },
  get 'boardColumns.*.cards.*.atStart'() {
    return !stepStatus(this['.status'], -1);
  },
  get 'boardColumns.*.cards.*.atEnd'() {
    return !stepStatus(this['.status'], 1);
  },
  reloadBoard() {
    if (this.boardUrl) this.$command.loadBoard.emit(this.boardUrl);
  },
  /** Writes the cards. workaround: a card whose object is replaced gets a new row, and its focused button is
   *  gone (React kept the element by key={card.id}); put the focus back on the same button of the new row. */
  setBoardCards(next) {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedCard = active?.dataset.card ? Number(active.dataset.card) : null;
    this.boardCards = next;
    if (focusedCard !== null) this.boardPendingFocus = { id: focusedCard, direction: Number(active.dataset.dir) };
  },
  replaceCard(id, update) {
    this.setBoardCards((this.boardCards ?? []).map((c) => (c.id === id ? update(c) : c)));
  },
  moveCardBack(event) {
    return this.moveCard(event, -1);
  },
  moveCardForward(event) {
    return this.moveCard(event, 1);
  },
  async moveCard(event, direction) {
    const id = Number(/** @type {HTMLElement} */ (event.target.closest('button')).dataset.card);
    const card = (this.boardCards ?? []).find((c) => c.id === id);
    if (!card) return;
    const to = stepStatus(card.status, direction);
    if (!to) return;
    this.replaceCard(id, (c) => ({ ...c, status: to }));
    this.boardPendingFocus = { id, direction };
    this.statusChanged(card.status, to);
    try {
      const updated = await api.patchReport(card.id, card.version, { status: to });
      if (this.boardCards) this.setBoardCards(upsert(this.boardCards, toCard(updated)));
    } catch (err) {
      this.statusChanged(to, card.status);
      if (err.status === 409 && err.data?.report) {
        this.replaceCard(id, () => toCard(err.data.report));
        this.refreshSummary();
        this.showToast('他の職員が更新しました');
      } else {
        this.replaceCard(id, (c) => ({ ...c, status: card.status, version: card.version }));
        this.showToast('更新に失敗しました');
      }
      this.boardPendingFocus = { id, direction };
    }
  },

  // =====================================================================================================
  // pages/StatsPage.jsx (+ DailyChart → the <sr-daily-chart> part)
  // =====================================================================================================
  statsReady: false, // React.lazy: the code has arrived
  statsFetch: { value: null, loading: false, error: null },
  statsToday: '', // toIsoDay(new Date()) — taken when the page is entered (a getter may not read the clock)
  statsSort: { key: null, direction: 'ascending' },
  statsPresetDefs: [{ days: 7 }, { days: 30 }, { days: 90 }],
  statsColumns: [...STATUSES.map((s) => ({ key: s, label: STATUS_LABELS[s] })), { key: 'total', label: '合計' }],

  /** `if (searchParams.get('boom') === '1') throw …` — the error boundary's test hook. */
  get statsHeading() {
    if (this['query.boom'] === '1') throw new Error('統計の描画に失敗しました（テスト用）');
    return '統計';
  },
  get statsFallback() {
    return this.statsReady && this.statsToday ? statsLib.presetRange(30, this.statsToday) : { from: '', to: '' };
  },
  get statsFrom() {
    return this['query.from'] ?? this['statsFallback.from'];
  },
  get statsTo() {
    return this['query.to'] ?? this['statsFallback.to'];
  },
  get statsInverted() {
    return isIsoDay(this.statsFrom) && isIsoDay(this.statsTo) && this.statsFrom > this.statsTo;
  },
  get statsValid() {
    return isIsoDay(this.statsFrom) && isIsoDay(this.statsTo) && !this.statsInverted;
  },
  get statsUrl() {
    if (this.routeName !== 'stats' || !this.statsReady || !this.statsValid || this['query.boom'] === '1') return null;
    return `/api/reports/export${buildQuery({ from: this.statsFrom, to: this.statsTo })}`;
  },
  get stats() {
    const data = this['statsFetch.value'];
    if (!this.statsReady || !data || !this.statsValid) return null;
    return statsLib.aggregate(data, this.statsFrom, this.statsTo);
  },
  get statsShowLoading() {
    return this.statsValid && Boolean(this['statsFetch.loading']) && !this.stats;
  },
  get statsBusyAttr() {
    return this['statsFetch.loading'] ? 'true' : 'false';
  },
  get statsInvalidAttr() {
    return this.statsInverted ? 'true' : null;
  },
  get statsDescribedBy() {
    return this.statsInverted ? 'stats-from-error' : null;
  },
  get 'statsPresetDefs.*.label'() {
    return `${this['.days']}日`;
  },
  get 'statsPresetDefs.*.pressed'() {
    if (!this.statsReady || !this.statsToday) return 'false';
    const range = statsLib.presetRange(this['.days'], this.statsToday);
    return String(range.from === this.statsFrom && range.to === this.statsTo);
  },
  get statsTotalText() {
    return `${this['stats.total']} 件`;
  },
  get statsAverageText() {
    return this.statsReady ? statsLib.formatAverageDays(this['stats.averageDays']) : '';
  },
  get statsByStatus() {
    const stats = this.stats;
    return stats ? STATUSES.map((s) => ({ label: STATUS_LABELS[s], countText: `${stats.byStatus[s]} 件` })) : [];
  },
  get statsBars() {
    const stats = this.stats;
    if (!stats) return [];
    const max = Math.max(1, ...Object.values(stats.byCategory));
    return Object.entries(stats.byCategory).map(([category, count]) => ({
      label: CATEGORY_LABELS[category], countText: `${count} 件`, widthPct: (count / max) * 100,
    }));
  },
  get statsPerDay() {
    return this.stats ? this['stats.perDay'] : [];
  },
  get statsRows() {
    const stats = this.stats;
    return stats ? statsLib.sortRows(stats.rows, this['statsSort.key'], this['statsSort.direction']) : [];
  },
  get 'statsRows.*.label'() {
    return CATEGORY_LABELS[this['.category']];
  },
  get 'statsRows.*.cells'() {
    const row = this['.'];
    return this.statsColumns.map((col) => String(row[col.key]));
  },
  get 'statsColumns.*.ariaSort'() {
    return this['statsSort.key'] === this['.key'] ? this['statsSort.direction'] : null;
  },
  get 'statsColumns.*.arrow'() {
    if (this['statsSort.key'] !== this['.key']) return '';
    return this['statsSort.direction'] === 'ascending' ? ' ▲' : ' ▼';
  },
  choosePreset(event, index) {
    const range = statsLib.presetRange(this.statsPresetDefs[index].days, this.statsToday);
    this.updateParams({ from: range.from, to: range.to });
  },
  changeStatsFrom(event) {
    const value = event.target.value;
    if (value) this.updateParams({ from: value, to: this.statsTo }, true);
  },
  changeStatsTo(event) {
    const value = event.target.value;
    if (value) this.updateParams({ from: this.statsFrom, to: value }, true);
  },
  toggleStatsSort(event, index) {
    const key = this.statsColumns[index].key;
    const prev = this.statsSort;
    this.statsSort = prev.key === key
      ? { key, direction: prev.direction === 'ascending' ? 'descending' : 'ascending' }
      : { key, direction: 'ascending' };
  },
  reloadStats() {
    if (this.statsUrl) this.$command.loadStats.emit(this.statsUrl);
  },

  // =====================================================================================================
  // pages/NewReportPage.jsx — the reducer's state as keys, its cases as methods
  // =====================================================================================================
  form: { ...EMPTY_REPORT },
  formTouched: {},
  formSubmitAttempted: false,
  formServerErrors: {},
  formRestored: false,
  formSubmitting: false,
  formLeaving: false, // leavingRef: set once we navigate away on purpose
  formSnapshotSettled: null, // useDebouncedValue(values, 400) — <wcs-debounce> writes it
  leaveDialogOpen: false,

  /** Every field read by its path, so this re-evaluates on each keystroke (this.form.title would not). */
  get formValues() {
    return {
      title: this['form.title'],
      category: this['form.category'],
      subcategory: this['form.subcategory'],
      district: this['form.district'],
      address: this['form.address'],
      description: this['form.description'],
      priority: this['form.priority'],
      anonymous: this['form.anonymous'],
      reporterName: this['form.reporterName'],
      reporterPhone: this['form.reporterPhone'],
    };
  },
  get formSnapshot() {
    return this.formValues;
  },
  get formValidation() {
    return validateReport(this.formValues);
  },
  get formDirty() {
    return isReportDirty(this.formValues);
  },
  /** fieldError(field) for every field: the server's message, or the client's once touched / submitted. */
  /** @returns {FieldStrings} */
  get formErrors() {
    const errors = this.formValidation;
    const touched = this.formTouched;
    const attempted = this.formSubmitAttempted;
    const server = this.formServerErrors;
    const out = {};
    for (const field of REPORT_FIELDS) {
      out[field] = server[field] ?? ((touched[field] || attempted) ? errors[field] : undefined) ?? '';
    }
    return /** @type {FieldStrings} */ (out);
  },
  /** @returns {FieldStrings} */
  get formInvalid() {
    const errors = this.formErrors;
    return /** @type {FieldStrings} */ (Object.fromEntries(REPORT_FIELDS.map((f) => [f, errors[f] ? 'true' : null])));
  },
  /** @returns {FieldStrings} */
  get formDescribedBy() {
    const errors = this.formErrors;
    const describedBy = { description: ['f-description-counter'], reporterPhone: ['f-phone-hint'] };
    return /** @type {FieldStrings} */ (Object.fromEntries(REPORT_FIELDS.map((f) => {
      const ids = [...(describedBy[f] ?? []), errors[f] ? `f-${f}-error` : null].filter(Boolean);
      return [f, ids.length ? ids.join(' ') : null];
    })));
  },
  get formDescriptionCounter() {
    return `${(this['form.description'] ?? '').length} / ${DESCRIPTION_MAX}`;
  },
  get formSubcategories() {
    return SUBCATEGORIES[this['form.category']] ?? [];
  },
  get formNoCategory() {
    return !this['form.category'];
  },
  get formShowReporter() {
    return !this['form.anonymous'];
  },
  get formSubmitLabel() {
    return this.formSubmitting ? '送信中…' : '登録';
  },
  /** case 'change' for category: the subcategory is reset with it. */
  get formCategoryInput() {
    return this['form.category'];
  },
  set formCategoryInput(value) {
    this['form.category'] = value;
    this['form.subcategory'] = '';
  },
  get formBlocking() {
    return this.routeName === 'new' && this.formDirty && !this.formLeaving;
  },
  get formBeforeUnloadActive() {
    return this.routeName === 'new' && this.formDirty && !this.formSubmitting;
  },
  /** initForm() — run whenever the page is entered (React mounted the page afresh each time). */
  resetForm() {
    const { values, restored } = initialForm();
    this.form = values;
    this.formTouched = {};
    this.formSubmitAttempted = false;
    this.formServerErrors = {};
    this.formRestored = restored;
    this.formSubmitting = false;
    this.formLeaving = false;
  },
  blurField(event) {
    const field = event.target.name;
    if (field && !this.formTouched[field]) this.formTouched = { ...this.formTouched, [field]: true };
  },
  discardDraft() {
    clearDraft();
    this.form = { ...EMPTY_REPORT };
    this.formTouched = {};
    this.formSubmitAttempted = false;
    this.formServerErrors = {};
    this.formRestored = false;
  },
  async submitForm() {
    if (this.formSubmitting) return; // submittingRef: a double click sends one POST
    const errors = this.formValidation;
    if (Object.keys(errors).length > 0) {
      this.formSubmitAttempted = true;
      focusFirstError(errors);
      return;
    }
    this.formSubmitting = true;
    try {
      const report = await api.createReport(toReportPayload(this.formValues));
      this.formLeaving = true;
      clearDraft();
      this.refreshSummary();
      this.showToast('通報を登録しました');
      this.navigateUrl = `/reports/${report.id}`;
    } catch (err) {
      this.formSubmitting = false;
      if (err.status === 422 && err.data?.errors) {
        this.formSubmitAttempted = true;
        this.formServerErrors = err.data.errors;
        focusFirstError(err.data.errors);
      } else {
        this.showToast('登録に失敗しました');
      }
    }
  },

  // ---- the leave guard (useBlocker + ConfirmDialog) ----
  /** Called by the route guards in index.html (workaround: a guard cannot see state, so the page publishes this
   *  function on window). Resolves true to let the navigation go on, or redirects back to the form. */
  leaveGuard(to, from) {
    if (from !== '/reports/new' || to === from || !this.formBlocking) return true;
    this.leaveDialogOpen = true;
    return new Promise((resolve) => {
      leaveResolver = resolve;
    });
  },
  cancelLeave() {
    this.leaveDialogOpen = false;
    leavePendingHref = null;
    if (leaveResolver) {
      // workaround: a guard can only let a navigation in or redirect it (a redirect replaces the history entry,
      // so the next Back would land on a duplicate of this page). To stay, step history forward again — that
      // navigation overtakes the one waiting for this guard, which the router then drops — and leave the guard's
      // promise unsettled until then (settling it first would commit or redirect the old navigation).
      const resolve = leaveResolver;
      leaveResolver = null;
      window.history.go(1);
      setTimeout(() => resolve(false), 1000);
    }
  },
  confirmLeave() {
    this.formLeaving = true;
    clearDraft();
    this.leaveDialogOpen = false;
    const href = leavePendingHref;
    leavePendingHref = null;
    if (href) this.navigateUrl = href;
    const resolve = leaveResolver;
    leaveResolver = null;
    if (resolve) resolve(true);
  },
  leaveDialogKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.cancelLeave();
    } else if (event.key === 'Tab') {
      trapTab(event, event.target.closest('[role="dialog"]'));
    }
  },

  // =====================================================================================================
  // Route lifecycle — what mounting and unmounting a page did in React. A route body here is NOT rebuilt when it
  // is entered again (the same nodes go back), and this state lives on, so each page resets what React forgot.
  // =====================================================================================================
  enterRoute(name) {
    if (name === 'list') {
      this.listLastSeen = readLastSeen();
      this.listSelection = { key: '', ids: [] };
      this.listText = this.listQ;
      document.addEventListener('keydown', onSlashKey);
    } else if (name === 'new') {
      this.resetForm();
    } else if (name === 'detail') {
      this.now = Date.now();
      clearInterval(nowTimer);
      nowTimer = setInterval(() => {
        this.now = Date.now();
      }, NOW_INTERVAL_MS);
    } else if (name === 'board') {
      this.boardMineOnly = false;
    } else if (name === 'stats') {
      this.statsToday = toIsoDay(new Date());
      this.statsSort = { key: null, direction: 'ascending' };
      if (!statsLib) {
        import('../lib/stats.js').then((module) => {
          statsLib = module;
          this.statsReady = true;
        });
      }
    }
  },
  leaveRoute(name) {
    if (name === 'list') {
      writeLastSeen();
      document.removeEventListener('keydown', onSlashKey);
      this['listFetch.value'] = null; // a fresh mount had no data
    } else if (name === 'detail') {
      clearInterval(nowTimer);
      nowTimer = null;
      this.lightbox = null;
    } else if (name === 'new') {
      if (leaveResolver) this.cancelLeave();
    }
  },

  $commandTokens: [
    'loadSummary', 'loadList', 'abortList', 'loadDetail', 'abortDetail', 'loadComments', 'abortComments',
    'loadBoard', 'abortBoard', 'loadStats', 'abortStats', 'commentSent', 'commentFailed',
  ],
  $eventTokens: ['commentRequested', 'pageChosen', 'summaryEvent', 'boardEvent'],
  $on: {
    // ReportsStore: useEventSource('/api/events', 'report', refreshSummary) — <wcs-sse>, open for the whole session
    summaryEvent(state) {
      state.refreshSummary();
    },
    // BoardPage: its own subscription while the board is shown (<wcs-sse url: boardEventsUrl>)
    boardEvent(state, event) {
      const report = event.detail?.data;
      if (report && typeof report === 'object' && state.boardCards) state.setBoardCards(upsert(state.boardCards, report));
    },
    pageChosen(state, event) {
      state.choosePage(event.detail);
    },
    commentRequested(state, event) {
      const body = event.detail?.body;
      if (typeof body === 'string') state.addComment(body);
    },
  },

  $connectedCallback() {
    this.systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = this.theme;
    this.refreshSummary();
    /** @type {any} */ (window).streetReportsLeaveGuard = (to, from) => this.leaveGuard(to, from);
  },


  $watch: {
    // ---- route lifecycle ----
    routeName(cur, prev) {
      if (cur === prev) return;
      if (prev) this.leaveRoute(prev);
      if (cur) this.enterRoute(cur);
    },
    // ErrorBoundary resetKey={pathname}
    path(cur, prev) {
      if (prev !== undefined && cur !== prev) this.pageError = false;
    },
    // ThemeContext: useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
    theme(cur) {
      document.documentElement.dataset.theme = cur;
    },
    'summaryFetch.value'(value) {
      if (value) this.summary = value;
    },

    // ---- list ----
    listUrl(cur, prev) {
      if (cur === prev) return;
      if (cur) this.$command.loadList.emit(cur);
      else this.$command.abortList.emit();
    },
    'listFetch.loading'(loading) {
      clearTimeout(loadingTimers.list);
      if (loading) {
        loadingTimers.list = setTimeout(() => {
          if (this['listFetch.loading']) this.listShowLoading = true;
        }, LOADING_DELAY_MS);
      } else {
        this.listShowLoading = false;
      }
    },
    // the URL's q changed from outside (Back, 条件をクリア): the box follows
    listQ(cur, prev) {
      if (this.routeName === 'list' && cur !== prev && cur !== this.listText) this.listText = cur;
    },
    // once the text settles, it goes to the URL (replace, page reset)
    listTextSettled(settled) {
      if (this.routeName !== 'list' || settled == null) return;
      if (settled === this.listText && settled !== this.listQ) this.updateParams({ q: settled, page: null }, true);
    },

    // ---- detail ----
    detailUrl(cur, prev) {
      if (cur === prev) return;
      // <ReportDetail key={id}>: a new id starts from a clean slate and aborts the old request
      this.report = null;
      this.comments = null;
      this.detailHttpStatus = 0;
      this.detailConflict = false;
      this.detailSaving = false;
      this.lightbox = null;
      this.$command.abortComments.emit();
      if (cur) this.$command.loadDetail.emit(cur);
      else this.$command.abortDetail.emit();
    },
    'detailFetch.status'(status) {
      this.detailHttpStatus = status ?? 0;
    },
    'detailFetch.value'(value) {
      if (value && String(value.id) === this.detailId) this.report = value;
    },
    commentsUrl(cur, prev) {
      if (cur === prev) return;
      if (cur) this.$command.loadComments.emit(cur);
    },
    'commentsFetch.value'(value) {
      if (Array.isArray(value) && this.report && value.every((c) => c.reportId === this['report.id'])) this.comments = value;
    },
    lightboxOpen(open, wasOpen) {
      if (open && !wasOpen) {
        document.body.dataset.prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        /** @type {HTMLElement | null} */ (document.querySelector('.lightbox .lightbox-close'))?.focus();
      } else if (!open && wasOpen) {
        document.body.style.overflow = document.body.dataset.prevOverflow ?? '';
        if (lightboxOpener?.isConnected) lightboxOpener.focus();
        lightboxOpener = null;
      }
    },
    leaveDialogOpen(open) {
      if (open) /** @type {HTMLElement | null} */ (document.querySelector('.leave-cancel'))?.focus();
    },

    // ---- board ----
    boardUrl(cur, prev) {
      if (cur === prev) return;
      if (cur) {
        this.boardCards = null;
        this.$command.loadBoard.emit(cur);
      } else {
        this.$command.abortBoard.emit();
      }
    },
    'boardFetch.value'(value) {
      if (Array.isArray(value) && this.routeName === 'board') this.boardCards = value;
    },
    boardPendingFocus(target) {
      if (!target) return;
      const preferred = /** @type {HTMLButtonElement | null} */ (document.querySelector(`button[data-card="${target.id}"][data-dir="${target.direction}"]`));
      const fallback = /** @type {HTMLButtonElement | null} */ (document.querySelector(`button[data-card="${target.id}"][data-dir="${-target.direction}"]`));
      (preferred && !preferred.disabled ? preferred : fallback)?.focus();
    },

    // ---- stats ----
    statsUrl(cur, prev) {
      if (cur === prev) return;
      if (cur) this.$command.loadStats.emit(cur);
      else this.$command.abortStats.emit();
    },

    // ---- new report ----
    formSnapshotSettled(values) {
      if (!values || this.routeName !== 'new' || this.formLeaving) return;
      saveDraft(values);
    },
    // case 'change': a field's server error goes away when the field changes
    formValues(cur, prev) {
      if (!prev || !cur) return;
      const changed = REPORT_FIELDS.filter((f) => cur[f] !== prev[f] && this.formServerErrors[f]);
      if (changed.length) {
        const next = { ...this.formServerErrors };
        for (const f of changed) delete next[f];
        this.formServerErrors = next;
      }
    },
    formBeforeUnloadActive(active) {
      if (active && !beforeUnloadOn) window.addEventListener('beforeunload', onBeforeUnload);
      if (!active && beforeUnloadOn) window.removeEventListener('beforeunload', onBeforeUnload);
      beforeUnloadOn = Boolean(active);
    },
  },
});
