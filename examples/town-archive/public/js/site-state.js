// State of the public site (一覧 / 写真 / お気に入り). Loaded by <wcs-state src="js/site-state.js">.
import {
  PAGE_SIZE, filterKey, emptyFeed, plan, mergePage, holds, windowStartFor, decadeOf, DECADES,
  listSearch, apiQuery,
} from "./lib/feed.js";
import {
  columnsFor, columnWidth, thumbSizeFor, dprFromQueries, leadingSpan, computeLayout, rowOf, itemsOfRows, rowsFor,
  thumbHeight,
} from "./lib/grid.js";
import { SeenBatcher, isSeen, SEEN_BATCH_SOON } from "./lib/seen.js";

/**
 * @typedef {{ id: number, title: string, year: number, month: number, area: string, tags: string[],
 *   w: number, h: number, color: string, donor: string, fav: boolean, near: boolean }} Photo
 */
/**
 * @typedef {{ id: number, title: string, year: number, month: number, area: string,
 *   w: number, h: number, color: string, at: number }} Favorite
 */
/**
 * @typedef {{ code: string, name: string }} Area
 */
/**
 * @typedef {{ id: number, title: string, year: number, month: number, area: string, tags: string[],
 *   w: number, h: number, color: string, donor: string, description: string, seen: number }} PhotoDetail
 */

// Things the page keeps that nothing renders and no getter reads: kept out of the state so that
// no binding or getter can come to depend on them by accident. Rebuilt in $connectedCallback.
function makeRuntime() {
  return {
    seen: new SeenBatcher(),
    visibleIds: new Set(), // ids of cards intersecting the screen
    cardEls: new Map(), // id → card element, learnt from the intersection entries
    idIndex: new Map(), // id → index in `photos`
    favIds: new Set(), // ids in the favourites, as last applied to the rows
    gen: 0, // bumped by every reset of the list; a page asked for another generation is dropped
    upAnchor: null, // { id, rowTop } of a card on the screen, taken before an earlier page is merged
    pendingFocus: null, // a card to focus once it is rendered
    rawById: new Map(), // id → the photo object in `photos` (for rows that are not rendered)
    onHide: null,
    neighborCache: new Map(), // neighbour answers by url (a walk back and forth asks nothing again)
    lastPhotoPos: null,
    reqGen: -1,
    walkFrom: null, // { from, to, delta } of the last 前へ / 次へ
    queuedStep: 0, // a ← / → pressed while the previous step was still navigating
    reqOffset: -1,
  };
}
// One page, one state: the module is evaluated once per page (and anew for each test mount).
const rt = makeRuntime();

// The card element of a photo: from the observer entries when we have it (a selector over tens of
// thousands of nodes on every intersection event is what made a long list slow), else from the DOM.
const card = (id) => {
  const el = rt.cardEls.get(id);
  if (el && el.isConnected) return el;
  return document.querySelector(".grid")?.querySelector(`.card[data-id="${id}"]`) ?? null;
};
const headerBottom = () => document.querySelector(".site-header")?.getBoundingClientRect().bottom ?? 0;
/**
 * Run `fn` now and once more when the navigation in progress has finished.
 * The router hands scrolling and focus to the browser (Navigation API `scroll` / `focusReset:
 * "after-transition"`; the fallback path scrolls after the commit). Content kept outside the route
 * bodies (the list here, the documented exception) is placed and focused by the page, and the
 * browser's reset, which comes after the route change, would undo it. A list that keeps its rows in
 * the document navigates to the row's fragment instead (the router README); this one renders a
 * window of its rows, so the row to come back to may not be in the document.
 */
function afterNavigation(fn) {
  fn();
  const nav = globalThis.navigation;
  if (nav?.transition) nav.transition.finished.then(fn, () => {});
  else requestAnimationFrame(fn);
}
/** Focus card `id` if it is rendered; otherwise once it is (the shownPhotos watch). */
function focusCard(id) {
  const el = card(id);
  if (!el) { rt.pendingFocus = id; return; }
  rt.pendingFocus = null;
  if (!el.contains(document.activeElement)) el.querySelector(".card-link")?.focus({ preventScroll: true });
}
/**
 * By hand: no wcstack element reports the scroll position, and the windowed grid must follow it
 * (docs/long-lists.md §4). A passive scroll / resize listener reports, once per frame, where the window
 * is over the grid as a "viewport" event on .grid-viewport, which state hears (`onviewport:`).
 */
function reportViewport() {
  const vp = document.querySelector(".grid-viewport");
  if (!vp || vp.closest("[hidden]")) return;
  const r = vp.getBoundingClientRect();
  vp.dispatchEvent(new CustomEvent("viewport", { detail: { top: -r.top, height: innerHeight } }));
}
let viewportQueued = false;
function queueViewport() {
  if (viewportQueued) return;
  viewportQueued = true;
  requestAnimationFrame(() => { viewportQueued = false; reportViewport(); });
}

export default {
  // ---- router (outputs) and navigation (inputs)
  routeName: "",
  routeParams: {},
  query: {},
  navigateUrl: null,
  replaceUrl: null,

  // ---- filters in the header
  searchText: "",
  searchSettled: "",
  searchDirty: false, // the user typed since the last settled value
  searchPushed: false, // the current history entry was made by typing in the search box
  /** @type {Area[] | null} */
  areasValue: null,
  panelOpen: true,

  // ---- the list (a window of one result, growing at both ends)
  /** @type {Photo[]} */
  photos: [],
  feedKey: "",
  feedQ: "",
  feedArea: "",
  feedSort: "old",
  feedStart: 0,
  feedOrigin: 0, // where this window started: cards keep column (index − origin) % cols as it grows upwards
  /** @type {number | null} */
  feedTotal: null,
  /** @type {number[]} */
  feedPages: [],
  reqOffset: 0,
  reqLimit: PAGE_SIZE,
  reqPending: false, // a page request is on its way (asked, not answered)
  reqDir: "",
  /** @type {{ offset: number, limit: number, dir: string } | null} */
  pageError: null,
  pageLoading: false,
  nearEnd: false,
  nearStart: false,
  listShown: false,
  viewTop: 0, // the window over the grid, in grid coordinates (from reportViewport)
  viewHeight: 1000,
  /** @type {{ id: number, top: number | null, focus: boolean } | null} */
  pendingScroll: null,
  /** @type {{ id: number, top: number, focus: boolean } | null} */
  leaveAnchor: null,
  /** @type {number | null} */
  returnTo: null,
  currentDecade: 0,
  firstScreenVisible: true,
  delayQs: "",
  thumbQs: "",

  // ---- position requests (decade jumps, a photo's place)
  posUrlValue: "",
  /** @type {{ kind: string, decade?: number, id?: number, top?: number | null, focus?: boolean } | null} */
  posPurpose: null,

  // ---- columns and thumbnails
  gridWidth: 0,
  over1: false,
  over15: false,
  over2: false,
  over3: false,
  thumbSize: 0, // the largest size needed so far (0: not measured yet)

  // ---- 見た写真
  seenWaiting: 0,
  seenSending: false,
  /** @type {{ ids: number[] } | null} */
  seenBody: null,
  seenSend: false,

  // ---- お気に入り (localStorage, shared by the tabs)
  /** @type {Favorite[] | null} */
  favStore: null,

  // ---- where the list was (sessionStorage): for a reload and for coming back from another site
  /** @type {{ key: string, id: number, top: number } | null} */
  anchorStore: null,
  // ---- the list a photo was opened from (sessionStorage)
  /** @type {{ key: string, q: string, area: string, sort: string, walk: Record<string, number>, id: number } | null} */
  ctxStore: null,

  // ---- the photo page
  /** @type {PhotoDetail | null} */
  photoValue: null,
  photoLoading: false,
  photoError: null,
  /** @type {number | null} */
  prevId: null,
  /** @type {number | null} */
  nextId: null,
  /** @type {number | null} */
  photoIndex: null,
  neighborUrlValue: "",
  photoPosUrlValue: "",

  $commandTokens: ["loadPage", "rearm", "loadPos"],
  $eventTokens: ["pageArrived", "endSentinel", "startSentinel", "cardVisibility", "posArrived",
    "seenDue", "seenResponded", "neighborsArrived", "photoPosArrived"],

  // =========================================================== derived: routing and filters
  get isList() { return this.routeName === "list"; },
  get isPhoto() { return this.routeName === "photo"; },
  get isFavorites() { return this.routeName === "favorites"; },
  get isNotFound() { return this.routeName === "notfound"; },
  get filterQ() { return this["query.q"] ?? ""; },
  get filterArea() { return this["query.area"] ?? ""; },
  get filterSort() {
    const s = this["query.sort"];
    return s === "new" || s === "title" ? s : "old";
  },
  get listKey() { return filterKey({ q: this.filterQ, area: this.filterArea, sort: this.filterSort }); },
  get hasFilter() { return this.filterQ !== "" || this.filterArea !== "" || this.filterSort !== "old"; },
  /** @returns {Area[]} */
  get areaList() { return this.areasValue ?? []; },
  get "areaList.*.selected"() { return this[".code"] === this.filterArea; },
  get areaNames() {
    const m = {};
    for (const a of this.areaList) m[a.code] = a.name;
    return m;
  },

  // =========================================================== derived: the list
  get pageUrl() {
    const qs = apiQuery({ q: this.feedQ, area: this.feedArea, sort: this.feedSort });
    return `/api/photos?${qs}&offset=${this.reqOffset}&limit=${this.reqLimit}${this.delayQs}`;
  },
  get shownCount() { return this.photos.length; },
  get totalText() { return this.feedTotal === null ? "" : this.feedTotal.toLocaleString("ja-JP"); },
  get shownText() { return this.photos.length.toLocaleString("ja-JP"); },
  get hasTotal() { return this.feedTotal !== null && this.feedTotal > 0; },
  get isEmpty() { return this.feedTotal === 0; },
  get isAtEnd() {
    return this.feedTotal !== null && this.feedTotal > 0 && this.feedStart + this.photos.length >= this.feedTotal;
  },
  get showLoading() { return this.reqPending && this.pageError === null; },
  get showError() { return this.pageError !== null; },
  get hasEarlier() { return this.feedTotal !== null && this.feedStart > 0; },
  // <wcs-resize> reports 0 while the list is hidden (another page is shown): keep the last real
  // width, so the columns — and the place of every card — are the same when the list comes back.
  get gridWidthRaw() { return this.gridWidth; },
  set gridWidthRaw(v) { if (v > 0) this.gridWidth = v; },
  get cols() { return columnsFor(this.gridWidth); },
  get gridTemplate() { return `repeat(${this.cols}, minmax(0, 1fr))`; },
  get colW() { return columnWidth(this.gridWidth, this.cols); },
  /** The column of the first loaded card: every card keeps column (index − origin) % cols. */
  get leadAll() { return leadingSpan(this.feedStart - this.feedOrigin, this.cols); },
  /** Where every row of the loaded window is (computed from the photo shapes, no DOM). */
  get layout() {
    return computeLayout(this.photos.map((p) => p.h / p.w), { cols: this.cols, colW: this.colW, lead: this.leadAll });
  },
  /** The rows near the screen: [first, end). */
  get renderRows() { return rowsFor(this.layout, this.viewTop, this.viewHeight, { margin: this.viewHeight }); },
  get shownRange() { return itemsOfRows(this.layout, this.renderRows[0], this.renderRows[1], this.photos.length); },
  /**
   * The cards in the document: only the rows near the screen (windowed rendering).
   * @returns {Photo[]}
   */
  get shownPhotos() { return this.photos.slice(this.shownRange[0], this.shownRange[1]); },
  get shownTopCss() { return `${this.layout.rowTop[this.renderRows[0]] ?? 0}px`; },
  get gridHeightCss() { return `${this.layout.total}px`; },
  get leadSpan() { return this.renderRows[0] === 0 ? this.leadAll : 0; },
  get leadSpanCss() { return this.leadSpan > 0 ? `1 / span ${this.leadSpan}` : null; },
  get noLeadSpan() { return this.leadSpan === 0; },
  get dpr() { return dprFromQueries({ over1: this.over1, over15: this.over15, over2: this.over2, over3: this.over3 }); },
  // 0 until the grid has been measured: no thumbnail is asked for at a size that is only a guess
  get neededThumb() { return this.gridWidth > 0 ? thumbSizeFor(columnWidth(this.gridWidth, this.cols), this.dpr) : 0; },
  get "shownPhotos.*.href"() { return `/photos/${this[".id"]}`; },
  get "shownPhotos.*.thumbH"() { return `${thumbHeight(this[".h"] / this[".w"], this.colW)}px`; },
  get "shownPhotos.*.thumbSrc"() { return this[".near"] && this.thumbSize > 0 ? `/img/${this[".id"]}?w=${this.thumbSize}${this.thumbQs}` : null; },
  get "shownPhotos.*.starText"() { return this[".fav"] ? "★" : "☆"; },
  get "shownPhotos.*.starLabel"() { return this[".fav"] ? "お気に入りから外す" : "お気に入りに追加"; },
  get "shownPhotos.*.favText"() { return this[".fav"] ? "true" : "false"; },
  get decadesActive() { return this.filterSort !== "title"; },
  get decadeList() { return DECADES.map((d) => ({ decade: d, label: `${d}年代` })); },
  get "decadeList.*.current"() { return this.decadesActive && this[".decade"] === this.currentDecade; },
  get posUrl() { return this.posUrlValue; },
  get showToTop() { return this.listShown && !this.firstScreenVisible && this.photos.length > 0; },

  // =========================================================== derived: お気に入り
  /** @returns {Favorite[]} */
  get favorites() { return this.favStore ?? []; },
  get favCount() { return this.favorites.length; },
  get hasFavorites() { return this.favorites.length > 0; },
  get "favorites.*.href"() { return `/photos/${this[".id"]}`; },
  get "favorites.*.ratio"() { return `${this[".w"]} / ${this[".h"]}`; },
  get "favorites.*.thumbSrc"() { return `/img/${this[".id"]}?w=320${this.thumbQs}`; },

  // =========================================================== derived: 写真
  get photoId() { return this.routeName === "photo" ? (this["routeParams.id"] ?? null) : null; },
  get photoUrl() { return this.photoId ? `/api/photos/${this.photoId}${this.delayQs ? `?${this.delayQs.slice(1)}` : ""}` : ""; },
  /** @returns {PhotoDetail | null} */
  get photo() {
    const v = this.photoValue;
    return v && v.id === this.photoId ? v : null;
  },
  get photoMissing() { return this.isPhoto && this.photoError !== null && !this.photoLoading; },
  get photoTitle() { return this.photo ? this.photo.title : (this.photoMissing ? "写真が見つかりません" : "読み込み中…"); },
  get docTitle() { return `${this.photoTitle} — みどり市 まちの記憶アーカイブ`; },
  get photoDate() { return this.photo ? `${this.photo.year}年${this.photo.month}月` : ""; },
  get photoArea() { return this.photo ? (this.areaNames[this.photo.area] ?? this.photo.area) : ""; },
  get photoSrc() { return this.photo ? `/img/${this.photo.id}?w=1280${this.thumbQs}` : null; },
  get photoRatio() { return this.photo ? `${this.photo.w} / ${this.photo.h}` : null; },
  get photoColor() { return this.photo ? this.photo.color : null; },
  get photoTags() { return this.photo ? this.photo.tags.map((t) => ({ tag: t, href: `/?q=${encodeURIComponent(t)}` })) : []; },
  get photoFav() { return this.photoId !== null && this.favorites.some((f) => f.id === this.photoId); },
  get photoStarText() { return this.photoFav ? "★ お気に入り" : "☆ お気に入りに追加"; },
  get photoFavText() { return this.photoFav ? "true" : "false"; },
  get noPrev() { return this.prevId === null; },
  get noNext() { return this.nextId === null; },
  get neighborUrl() { return this.neighborUrlValue; },
  get photoPosUrl() { return this.photoPosUrlValue; },
  get ctxSearch() {
    const c = this.ctxStore;
    return c ? listSearch(c) : "";
  },

  // =========================================================== lifecycle
  $connectedCallback() {
    const sp = new URLSearchParams(location.search);
    const d = Number(sp.get("delay"));
    if (d > 0) this.delayQs = `&delay=${d}`;
    const td = Number(sp.get("thumbDelay"));
    if (td > 0) this.thumbQs = `&delay=${td}`;
    this.searchText = this.filterQ;
    this.searchSettled = this.filterQ;
    for (const f of this.favorites) rt.favIds.add(f.id);
    // By hand: no wcstack element sends a beacon or hears `pagehide`; the waiting 見た写真
    // batch is handed to navigator.sendBeacon when the page goes away.
    const flushBeacon = () => {
      if (!rt) return;
      for (const ids of rt.seen.drainForBeacon()) {
        navigator.sendBeacon("/api/seen", new Blob([JSON.stringify({ ids })], { type: "application/json" }));
      }
    };
    rt.onHide = () => { if (document.visibilityState === "hidden") flushBeacon(); };
    addEventListener("pagehide", flushBeacon);
    document.addEventListener("visibilitychange", rt.onHide);
    history.scrollRestoration = "manual"; // the list restores its own place (it may be rebuilt)
    addEventListener("scroll", queueViewport, { passive: true }); // see reportViewport
    addEventListener("resize", queueViewport);
    queueViewport();
  },

  // =========================================================== the list: loading
  /** Start the list over for the current filter, at `start` (0 = its top). */
  resetFeed(start = 0, scroll = null) {
    rt.gen++;
    rt.idIndex = new Map();
    rt.visibleIds.clear();
    rt.cardEls.clear();
    rt.rawById.clear();
    rt.upAnchor = null;
    rt.pendingFocus = null;
    this.feedQ = this.filterQ;
    this.feedArea = this.filterArea;
    this.feedSort = this.filterSort;
    this.feedKey = this.listKey;
    this.feedStart = start;
    this.feedOrigin = start;
    this.feedTotal = null;
    this.feedPages = [];
    this.photos = [];
    this.pageError = null;
    this.reqPending = false;
    this.pendingScroll = scroll;
    if (!scroll) scrollTo(0, 0);
    this.schedule();
  },
  feedSnapshot() {
    return { key: this.feedKey, start: this.feedStart, items: this.photos, total: this.feedTotal, pages: this.feedPages };
  },
  /** Ask for the next page if one is due. One request at a time. */
  schedule() {
    if (!this.listShown) return;
    // not before the list is set up for this filter (a photo's place may still be on its way)
    if (this.feedKey !== this.listKey || this.posPurpose?.kind === "id") return;
    const r = plan(this.feedSnapshot(), {
      wantDown: this.nearEnd, wantUp: this.nearStart, busy: this.reqPending, failed: this.pageError !== null,
    });
    if (r) this.request(r);
  },
  request(r) {
    this.reqPending = true;
    this.reqDir = r.dir;
    rt.reqGen = rt.gen;
    rt.reqOffset = r.offset;
    this.reqOffset = r.offset;
    this.reqLimit = r.limit;
    // The command carries this page's url: a command runs before the bindings of its update, so the url the
    // element holds is still the page before (4.24: <wcs-fetch>'s fetch(url)).
    this.$command.loadPage.emit(this.pageUrl);
  },
  retryPage() {
    if (!this.pageError) return;
    const r = this.pageError;
    this.pageError = null;
    this.request(r);
  },

  // =========================================================== the list: position and scroll
  /**
   * Measure the first card on the screen (to keep it in place, or to come back to it). `top` is from the
   * bottom of the sticky header, whose height changes between pages (no filters on お気に入り).
   */
  measureTopCard() {
    const top = headerBottom();
    let best = null;
    for (const id of rt.visibleIds) {
      const i = rt.idIndex.get(id);
      if (i === undefined) continue;
      if (best === null || i < best.i) best = { i, id };
    }
    if (!best) return null;
    const el = card(best.id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.bottom < top) {
      // the first intersecting card is hidden under the header; take the next one if any
      const next = this.photos[best.i + this.cols];
      if (next && card(next.id)) return { id: next.id, top: card(next.id).getBoundingClientRect().top - top };
    }
    return { id: best.id, top: r.top - top };
  },
  /** Put card `id` at `top` px below the header's bottom (default 8), focus it. */
  scrollToCard(id, top, focus) {
    const k = rt.idIndex.get(id);
    if (k === undefined) return false;
    const rowTop = this.layout.rowTop[rowOf(this.layout, k)] ?? 0;
    afterNavigation(() => { // see afterNavigation
      const vp = document.querySelector(".grid-viewport");
      if (!vp) return;
      const want = headerBottom() + (top ?? 8);
      const el = card(id); // rendered: measure it; not rendered: where the layout puts it
      const y = el ? el.getBoundingClientRect().top : vp.getBoundingClientRect().top + rowTop;
      if (Math.abs(y - want) >= 1) scrollBy(0, y - want);
      if (focus) focusCard(id);
      queueViewport();
    });
    return true;
  },
  /** The window reports where it is over the grid (see reportViewport). */
  onViewport(event) {
    const d = event.detail;
    if (!d) return;
    // in steps, so that a small scroll writes nothing (the rendered rows reach a screen beyond)
    this.viewTop = Math.round(d.top / 160) * 160;
    this.viewHeight = Math.max(400, Math.ceil(d.height / 200) * 200);
  },
  /** Find the place of a photo (or a decade) in the current result. */
  askPosition(purpose, qs) {
    this.posPurpose = { ...purpose, key: this.listKey };
    const url = `/api/photos/position?${apiQuery({ q: this.filterQ, area: this.filterArea, sort: this.filterSort })}&${qs}${this.delayQs}`;
    this.posUrlValue = url;
    this.$command.loadPos.emit(url); // as in request(): the command carries the url
  },
  jumpDecade(event, index) {
    if (!this.decadesActive) return;
    const d = this.decadeList[index].decade;
    this.askPosition({ kind: "decade", decade: d }, `decade=${d}`);
  },
  toTop() {
    if (this.feedStart > 0) this.resetFeed(0);
    else scrollTo({ top: 0 });
    document.querySelector(".card-link")?.focus({ preventScroll: true });
  },

  /** Make the list right for the current filter; called when the list route is shown. */
  syncList(restore, returnTo = null) {
    if (this.posPurpose?.kind === "id" && this.posPurpose.key === this.listKey) return true; // a restore is under way
    if (this.listKey !== this.feedKey || this.feedTotal === null && !this.reqPending) {
      if (returnTo !== null) {
        // 一覧へ戻る to a list that is not loaded (a photo opened directly): start it at that photo
        this.askPosition({ kind: "id", id: returnTo, top: null, focus: true, center: true }, `id=${returnTo}`);
        return true;
      }
      const a = this.anchorStore;
      if (restore && a && a.key === this.listKey && a.id) {
        // a reload or a visit from another site: come back to where the list was
        this.askPosition({ kind: "id", id: a.id, top: a.top, focus: false }, `id=${a.id}`);
        return true;
      }
      this.resetFeed(0);
      return true;
    }
    return false;
  },

  // =========================================================== filters
  navigateList(search, replace) {
    const target = `/${search}`;
    if (replace) this.replaceUrl = target; else this.navigateUrl = target;
  },
  filterWith(changes, replace = false) {
    const f = { q: this.filterQ, area: this.filterArea, sort: this.filterSort, ...changes };
    this.navigateList(listSearch(f), replace);
  },
  applySearch(text) {
    const q = String(text ?? "").trim();
    if (q === this.filterQ) return;
    // Typing leaves one history entry: the first change of a search pushes, the next replace.
    this.filterWith({ q }, this.searchPushed);
    this.searchPushed = true;
  },
  // Not a two-way binding: it would write every step of an IME composition to the state (forms.md
  // §2), and the search would run on half-converted kana. The text is taken when it is final.
  onSearchInput(event) {
    if (event.isComposing) return;
    this.searchDirty = true;
    this.searchText = event.target.value;
  },
  noop() {},
  onSearchKey(event) {
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    this.searchDirty = false;
    this.applySearch(event.target.value);
  },
  onAreaChange(event) { this.searchPushed = false; this.filterWith({ area: event.target.value }); },
  onSortChange(event) { this.searchPushed = false; this.filterWith({ sort: event.target.value }); },
  clearFilters() {
    this.searchPushed = false;
    this.searchText = "";
    this.navigateList("", false);
  },
  togglePanel() { this.panelOpen = !this.panelOpen; },

  // =========================================================== cards
  openPhoto(event, index) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const p = this.shownPhotos[index]; // index: the row among the rendered cards
    if (!p) return;
    const el = card(p.id);
    this.leaveAnchor = { id: p.id, top: el ? el.getBoundingClientRect().top - headerBottom() : 0, focus: true };
    const i = this.feedStart + rt.idIndex.get(p.id);
    this.ctxStore = { key: this.feedKey, q: this.feedQ, area: this.feedArea, sort: this.feedSort, walk: { [p.id]: i }, id: p.id };
    this.navigateUrl = `/photos/${p.id}`;
  },
  toggleStar(event, index) {
    const p = this.shownPhotos[index];
    if (p) this.toggleFavorite(p);
  },
  toggleFavorite(p) {
    const list = this.favorites;
    if (list.some((f) => f.id === p.id)) {
      this.favStore = list.filter((f) => f.id !== p.id);
    } else {
      const f = { id: p.id, title: p.title, year: p.year, month: p.month, area: p.area, w: p.w, h: p.h, color: p.color, at: Date.now() };
      this.favStore = [f, ...list];
    }
  },
  /** Bring the rows' ★ in line with the favourites: only rows whose id changed are written. */
  applyFavorites() {
    const now = new Set(this.favorites.map((f) => f.id));
    const changed = [];
    for (const id of now) if (!rt.favIds.has(id)) changed.push(id);
    for (const id of rt.favIds) if (!now.has(id)) changed.push(id);
    rt.favIds = now;
    // Only the rows whose id changed are written: a rendered row through its path (its bindings
    // follow), a row that is not rendered on its object (read when it is rendered).
    const shown = this.shownPhotos;
    const from = this.shownRange[0];
    for (const id of changed) {
      const k = rt.idIndex.get(id);
      if (k === undefined) continue;
      const j = k - from;
      if (j >= 0 && j < shown.length && shown[j].id === id) this.$update("shownPhotos.*.fav", [j], () => now.has(id));
      // `shownPhotos` is a slice of `photos`: a row that is not rendered has no binding to update, so
      // its object is changed directly and the row reads it when it is rendered again.
      else { const raw = rt.rawById.get(id); if (raw) raw.fav = now.has(id); }
    }
  },

  // =========================================================== お気に入り page
  removeFavorite(event, index) {
    const f = this.favorites[index];
    if (f) this.favStore = this.favorites.filter((x) => x.id !== f.id);
  },
  clearFavorites() {
    if (!this.hasFavorites) return;
    if (!confirm(`お気に入り ${this.favCount} 件をすべて外しますか？`)) return;
    this.favStore = [];
  },
  openFavorite(event, index) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const f = this.favorites[index];
    if (f) this.navigateUrl = `/photos/${f.id}`;
  },
  goFavorites(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.navigateUrl = "/favorites";
  },
  goHome(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.navigateUrl = `/${listSearch({ q: this.filterQ, area: this.filterArea, sort: this.filterSort })}`;
  },

  // =========================================================== 写真 page
  enterPhoto() {
    const id = this.photoId;
    if (!id) return;
    this.prevId = null;
    this.nextId = null;
    this.photoIndex = null;
    let c = this.ctxStore;
    if (!c || c.walk?.[id] === undefined) {
      // opened directly (a link someone sent): the whole archive in the default order
      c = { key: filterKey({}), q: "", area: "", sort: "old", walk: {}, id };
      this.ctxStore = c;
      const url = `/api/photos/position?${apiQuery({})}&id=${id}${this.delayQs}`;
      // <wcs-fetch> does not fetch the url it fetched last again: the page keeps its last answer
      if (url === this.photoPosUrlValue && rt.lastPhotoPos) this.applyPhotoPos(rt.lastPhotoPos);
      else this.photoPosUrlValue = url;
      return;
    }
    if (c.id !== id) this.ctxStore = { ...c, id };
    // the photo we came from by 前へ / 次へ is a neighbour already known: ← → work at once
    const w = rt.walkFrom;
    rt.walkFrom = null;
    if (w && w.to === id) { if (w.delta > 0) this.prevId = w.from; else this.nextId = w.from; }
    this.resolveNeighbors(c.walk[id]);
    this.runQueuedStep();
  },
  resolveNeighbors(index) {
    this.photoIndex = index;
    const c = this.ctxStore;
    if (!c) return;
    // From the list in memory when it holds them (no request), from the server otherwise.
    if (c.key === this.feedKey && holds(this.feedSnapshot(), index)) {
      const prevOk = index === 0 || holds(this.feedSnapshot(), index - 1);
      const nextOk = (this.feedTotal !== null && index + 1 >= this.feedTotal) || holds(this.feedSnapshot(), index + 1);
      if (prevOk && nextOk) {
        this.prevId = index > 0 ? this.photos[index - 1 - this.feedStart].id : null;
        this.nextId = this.feedTotal !== null && index + 1 < this.feedTotal ? this.photos[index + 1 - this.feedStart].id : null;
        return;
      }
    }
    const offset = Math.max(0, index - 1);
    const url = `/api/photos?${apiQuery(c)}&offset=${offset}&limit=${index === 0 ? 2 : 3}${this.delayQs}`;
    // <wcs-fetch> does not fetch the url it fetched last again (its auto-fetch guard): the page answers
    // from the earlier response
    const cached = rt.neighborCache.get(url);
    if (cached) this.applyNeighbors(cached);
    else this.neighborUrlValue = url;
  },
  applyNeighbors(v) {
    const index = this.photoIndex;
    if (index === null) return;
    const at = (i) => v.items[i - v.offset];
    if (at(index)?.id !== this.photoId) return; // an answer about another photo (the user walked on)
    // a late answer asked for a neighbour may hold this photo but not both sides: set only what it holds
    if (index === 0) this.prevId = null; else if (at(index - 1)) this.prevId = at(index - 1).id;
    if (index + 1 >= v.total) this.nextId = null; else if (at(index + 1)) this.nextId = at(index + 1).id;
    this.runQueuedStep();
  },
  applyPhotoPos(v) {
    const id = this.photoId;
    const c = this.ctxStore;
    if (!id || !c) return;
    this.ctxStore = { ...c, walk: { ...c.walk, [id]: v.offset }, id };
    this.resolveNeighbors(v.offset);
  },
  runQueuedStep() {
    const d = rt.queuedStep;
    if (!d) return;
    const target = d < 0 ? this.prevId : this.nextId;
    if (target === null) return; // not known yet (asked from the server), or the end
    rt.queuedStep = 0;
    this.walkTo(target, d);
  },
  walkTo(id, delta) {
    const c = this.ctxStore;
    if (!c || id === null || this.photoIndex === null) return;
    rt.walkFrom = { from: this.photoId, to: id, delta };
    this.ctxStore = { ...c, walk: { ...c.walk, [id]: this.photoIndex + delta }, id };
    this.navigateUrl = `/photos/${id}`;
  },
  goPrev() { this.walkTo(this.prevId, -1); },
  goNext() { this.walkTo(this.nextId, 1); },
  backToList(event) {
    if (event && (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
    event?.preventDefault();
    const c = this.ctxStore;
    this.returnTo = this.photoId;
    this.navigateUrl = `/${c ? listSearch(c) : ""}`;
  },
  onPageKey(event) {
    if (!this.isPhoto) return;
    const t = event.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    // a key pressed while the previous step is still navigating is kept and done once it lands
    if (this.navigateUrl !== null || rt.walkFrom) { rt.queuedStep = delta; return; }
    if (delta < 0) this.goPrev(); else this.goNext();
  },
  togglePhotoStar() {
    const p = this.photo;
    if (p) this.toggleFavorite(p);
  },
  openTag(event, index) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    this.searchPushed = false;
    this.navigateUrl = `/${listSearch({ q: this.photoTags[index].tag })}`;
  },

  // =========================================================== 見た写真
  flushSeen() {
    if (this.seenSending || rt.seen.waiting === 0) return;
    const ids = rt.seen.take();
    if (!ids.length) return;
    this.seenSending = true;
    this.seenBody = { ids }; // a new object each time: the body is used up by each request
    this.seenSend = true;
  },

  // =========================================================== element events
  $on: {
    pageArrived: (state, event) => {
      if (!state.reqPending || rt.reqGen !== rt.gen) return; // asked for a filter that is gone
      const status = event.detail?.status ?? 0;
      const v = event.detail?.value;
      if (status < 200 || status >= 300 || !v || !Array.isArray(v.items)) {
        state.pageError = { offset: rt.reqOffset, limit: state.reqLimit, dir: state.reqDir };
        state.reqPending = false;
        return;
      }
      if (v.offset !== rt.reqOffset) return; // not the page asked for
      for (const p of v.items) p.fav = rt.favIds.has(p.id); // plain objects not yet in the state
      const before = state.feedSnapshot();
      if (v.offset < before.start && before.items.length) {
        // keep what the user looks at in place: remember where a card on the screen is in the
        // layout; after the merge the window scrolls by how far that row moved down
        const m = state.measureTopCard();
        const k = m ? rt.idIndex.get(m.id) : undefined;
        if (k !== undefined) rt.upAnchor = { id: m.id, rowTop: state.layout.rowTop[rowOf(state.layout, k)] };
      }
      const next = mergePage(before, v, state.feedKey);
      state.reqPending = false;
      // What the sentinels said before this page is out of date once its rows are in: forget it,
      // and let the re-armed sentinels (the photos watch) report where they are now.
      state.nearEnd = false;
      state.nearStart = false;
      if (next === before) return;
      if (next.start !== before.start || !before.items.length) {
        rt.idIndex = new Map(next.items.map((p, i) => [p.id, i]));
      } else {
        for (let i = before.items.length; i < next.items.length; i++) rt.idIndex.set(next.items[i].id, i);
      }
      for (const p of v.items) rt.rawById.set(p.id, p);
      state.feedStart = next.start;
      state.feedTotal = next.total;
      state.feedPages = next.pages;
      state.photos = next.items;
    },
    endSentinel: (state, event) => {
      state.nearEnd = event.detail?.isIntersecting === true;
      if (state.nearEnd) state.schedule();
    },
    startSentinel: (state, event) => {
      state.nearStart = event.detail?.isIntersecting === true;
      if (state.nearStart) state.schedule();
    },
    cardVisibility: (state, event, index) => {
      const entry = event.detail;
      const p = state.shownPhotos[index];
      if (!p || !entry) return;
      if (entry.target) rt.cardEls.set(p.id, entry.target);
      if (entry.isIntersecting) rt.visibleIds.add(p.id); else rt.visibleIds.delete(p.id);
      if (isSeen(entry) && rt.seen.add(p.id)) {
        state.seenWaiting = rt.seen.waiting;
        if (rt.seen.waiting >= SEEN_BATCH_SOON) state.flushSeen();
      }
      // the decade on screen, and where the list is (for a reload)
      // the first card on the screen that is not hidden under the sticky header
      let top = null;
      const hb = headerBottom();
      // A card that left the window was removed with its observer, which says nothing more: forget
      // every id outside the rendered rows.
      const [from, to] = state.shownRange;
      for (const id of rt.visibleIds) {
        const i = rt.idIndex.get(id);
        if (i === undefined || i < from || i >= to) rt.visibleIds.delete(id);
      }
      if (rt.cardEls.size > 400) { // drop the elements of rows that were removed (no leak)
        for (const [id, el] of rt.cardEls) if (!el.isConnected) rt.cardEls.delete(id);
      }
      const order = [...rt.visibleIds].map((id) => rt.idIndex.get(id)).sort((a, b) => a - b);
      for (const i of order) {
        const el = card(state.photos[i].id);
        if (el && el.getBoundingClientRect().bottom > hb + 1) { top = i; break; }
      }
      if (top !== null && state.listShown) {
        const tp = state.photos[top];
        state.currentDecade = decadeOf(tp.year);
        const a = state.anchorStore;
        if (!a || a.id !== tp.id || a.key !== state.feedKey) {
          const el = card(tp.id);
          state.anchorStore = { key: state.feedKey, id: tp.id, top: el ? Math.round(el.getBoundingClientRect().top - hb) : 0 };
        }
      }
    },
    posArrived: (state, event) => {
      const purpose = state.posPurpose;
      state.posPurpose = null;
      if (!purpose) return;
      const status = event.detail?.status ?? 0;
      const offset = event.detail?.value?.offset;
      if (purpose.key !== state.listKey) { state.resetFeed(0); return; } // the filter changed meanwhile
      if (status !== 200 || typeof offset !== "number") {
        if (purpose.kind === "id") state.resetFeed(0); // the photo is no longer in this result
        return;
      }
      if (state.listKey !== state.feedKey) {
        // the window is for another filter: start the filter's list where the photo/decade is
        if (purpose.kind === "decade") state.resetFeed(offset, { id: null, top: null, focus: false, first: true });
        else state.resetFeed(windowStartFor(offset), { id: purpose.id, top: purpose.top ?? null, focus: !!purpose.focus, center: !!purpose.center });
        return;
      }
      const snap = state.feedSnapshot();
      if (holds(snap, offset)) {
        const p = state.photos[offset - snap.start];
        state.scrollToCard(p.id, purpose.kind === "decade" ? null : (purpose.top ?? null), purpose.kind !== "decade" && !!purpose.focus);
        if (purpose.kind === "decade") state.currentDecade = purpose.decade;
        return;
      }
      if (purpose.kind === "decade") state.resetFeed(offset, { id: null, top: null, focus: false, first: true });
      else state.resetFeed(windowStartFor(offset), { id: purpose.id, top: purpose.top ?? null, focus: !!purpose.focus, center: !!purpose.center });
    },
    seenDue: (state) => { state.flushSeen(); },
    seenResponded: (state, event) => {
      const status = event.detail?.status ?? 0;
      if (status >= 200 && status < 300) rt.seen.done(); else rt.seen.failed();
      state.seenSending = false;
      state.seenWaiting = rt.seen.waiting;
    },
    neighborsArrived: (state, event) => {
      const v = event.detail?.value;
      if ((event.detail?.status ?? 0) !== 200 || !v) return;
      rt.neighborCache.set(state.neighborUrlValue, v);
      if (rt.neighborCache.size > 100) rt.neighborCache.delete(rt.neighborCache.keys().next().value);
      state.applyNeighbors(v);
    },
    photoPosArrived: (state, event) => {
      const v = event.detail?.value;
      if ((event.detail?.status ?? 0) !== 200 || !v) return;
      rt.lastPhotoPos = v;
      state.applyPhotoPos(v);
    },
  },

  // =========================================================== watches
  $watch: {
    routeName(cur, prev) {
      if (prev === "list" && cur !== "list") {
        // Measure while the list is still on the screen, then hide it (kept in the document,
        // so Back shows it again without asking the server for it).
        if (!this.leaveAnchor || this.leaveAnchor.focus === false) {
          const m = this.measureTopCard();
          this.leaveAnchor = m ? { ...m, focus: false } : null;
        }
        this.listShown = false;
      }
      if (cur === "list") {
        const first = prev === "" || prev === undefined;
        this.listShown = true;
        const reset = this.syncList(first, this.returnTo);
        if (!reset && this.returnTo !== null) {
          const id = this.returnTo;
          if (rt.idIndex.has(id)) this.pendingScroll = { id, top: null, focus: true, center: true };
          else this.askPosition({ kind: "id", id, top: null, focus: true, center: true }, `id=${id}`);
        } else if (!reset && this.leaveAnchor) {
          this.pendingScroll = { ...this.leaveAnchor };
        }
        this.returnTo = null;
        if (!reset) this.leaveAnchor = null;
      }
    },
    photoId(cur, prev) {
      if (!cur) return;
      this.enterPhoto();
      // Keyboard users land on the photo's heading, or stay on 前へ / 次へ when they walked with them
      // (← → reach <main>'s handler from either). See afterNavigation.
      const had = document.activeElement;
      const keep = prev && had && had.closest?.(".photo-nav") ? had : null;
      afterNavigation(() => {
        const target = keep && keep.isConnected ? keep : document.getElementById("photo-title");
        if (target && document.activeElement !== target) target.focus({ preventScroll: true });
      });
    },
    listKey() {
      // a filter that came from elsewhere (Back, a tag link, クリア) shows in the search box;
      // what the user is typing is left alone
      if (this.filterQ !== String(this.searchSettled).trim()) this.searchText = this.filterQ;
      if (this.routeName === "list") this.syncList(false);
    },
    searchSettled(cur) {
      if (!this.searchDirty) return; // the debounce's first cycle, or a value we put there
      this.searchDirty = false;
      if (this.routeName === "list") this.applySearch(cur);
    },
    listShown(cur) {
      if (cur) {
        this.schedule();
        this.$command.rearm.emit();
        queueViewport();
      }
    },
    shownPhotos() {
      if (rt.pendingFocus !== null && card(rt.pendingFocus)) focusCard(rt.pendingFocus);
    },
    photos(cur, prev) {
      // after the rows are rendered: keep what the user looks at in place, then re-arm the
      // sentinels so a page that left the end on the screen asks for the next one.
      if (rt.upAnchor) {
        const a = rt.upAnchor;
        rt.upAnchor = null;
        const k = rt.idIndex.get(a.id);
        if (k !== undefined) {
          const delta = this.layout.rowTop[rowOf(this.layout, k)] - a.rowTop;
          if (delta) {
            scrollBy(0, delta);
            this.viewTop = Math.round((this.viewTop + delta) / 160) * 160; // render the rows now there
          }
        }
      }
      const ps = this.pendingScroll;
      if (ps && this.listShown) {
        if (ps.first && this.photos.length) {
          this.pendingScroll = null;
          this.scrollToCard(this.photos[0].id, null, false);
          this.currentDecade = decadeOf(this.photos[0].year);
        } else if (ps.id !== null && rt.idIndex.has(ps.id)) {
          this.pendingScroll = null;
          this.scrollToCard(ps.id, ps.center ? Math.max(8, innerHeight / 3 - headerBottom()) : ps.top, ps.focus);
        }
      }
      this.$command.rearm.emit();
    },
    pendingScroll(cur) {
      // coming back to a list that is already loaded: the rows are there, only the scroll moves
      if (!cur || !this.listShown || cur.first || cur.id === null || !rt.idIndex.has(cur.id)) return;
      this.pendingScroll = null;
      this.scrollToCard(cur.id, cur.center ? Math.max(8, innerHeight / 3 - headerBottom()) : cur.top, cur.focus);
    },
    favStore() { this.applyFavorites(); },
    neededThumb(cur) { if (cur > this.thumbSize) this.thumbSize = cur; },
  },
};
