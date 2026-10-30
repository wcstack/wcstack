// The city-library root state. The dictionary and the formatters are ES
// modules (docs/i18n-design.md): getters import them; templates read the
// dictionary through the i18n volume.
import { t, lang } from "./i18n/catalog.js";
import {
  fmt, pluralText, number, yen, timeReader, dateTimeTokyo,
  relativeFrom, tokyoInstant, zoneNameTokyo, readerZone, LIBRARY_ZONE, isolate,
} from "./i18n/format.js";

const SORT_KEYS = { title: "title", "-year": "yearDesc", year: "yearAsc" };
const BRANCH_IDS = ["central", "riverside", "hilltop"];
// "YYYY-MM-DD" of an instant in Tokyo.
const TOKYO_YMD = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
const PER = 10;
const HOLD_FIELDS = ["branch", "notify", "phone"];
// Where each field of the 422 summary links to (an in-page fragment link).
const HOLD_TARGETS = { branch: "#hold-branch", notify: "#hold-notify-email", phone: "#hold-phone" };

function nameOf(branches, id) {
  return branches.find((b) => b.id === id)?.name ?? id;
}

/** "/search?q=…" from a set of search parameters (empty ones left out). */
function searchPath(params) {
  const p = new URLSearchParams();
  for (const key of ["q", "type", "branch", "sort", "page"]) {
    const v = params[key];
    if (v === undefined || v === null || v === "") continue;
    if (key === "sort" && v === "title") continue;
    if (key === "page" && Number(v) <= 1) continue;
    p.set(key, String(v));
  }
  const s = p.toString();
  return s ? "/search?" + s : "/search";
}

/**
 * "?q=…&page=N" for a pager link, which always names its page. A <wcs-link>
 * whose `to` has a query is the current page when the URL has every parameter
 * of `to` with the same value (router 4.10), and parameters the link does not
 * name are allowed: a page-1 link without `page` — the clean URL a new search
 * gets — would say "current page" on every page.
 */
function pageQuery(params, page) {
  const p = new URLSearchParams();
  for (const key of ["q", "type", "branch", "sort"]) {
    const v = params[key];
    if (v === undefined || v === null || v === "") continue;
    if (key === "sort" && v === "title") continue;
    p.set(key, String(v));
  }
  p.set("page", String(page));
  return "?" + p;
}

/** A `next` target is followed only when it is a path inside this app. */
function safeNext(next) {
  if (typeof next !== "string" || !next.startsWith("/")) return "/account";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/account";
  return next;
}

/**
 * The page the reader is on, from the URL (without the language's basename).
 * Not the router's `path`: with <wcs-view-transition> the router sends `path`
 * once the route's content is drawn, a frame after `routeName` — a 401 that
 * lands in that frame (leaving Fees for Holds) read the page being left, and
 * the login sent the reader back to Fees.
 */
function addressNow() {
  return location.pathname.slice(("/" + lang).length) + location.search;
}

function parseBody(error) {
  if (!error?.body) return {};
  try { return JSON.parse(error.body) ?? {}; } catch { return {}; }
}

export default {
  // ---- router surface ------------------------------------------------------
  path: "/",
  routeName: "",
  /** @type {{ id?: number }} */
  routeParams: {},
  /** @type {{ q?: string, type?: string, branch?: string, sort?: string, page?: string, next?: string }} */
  query: {},
  /** @type {{ item: { id: number, title: string, author: string, year: number, type: string, available: number, holds: number, description: string, copies: { branch: string, status: string, dueAt: string | null }[] } | null, missing: boolean } | null} */
  routeData: null,
  navigateUrl: null,
  replaceUrl: null,

  get queryString() {
    const s = new URLSearchParams(this.query).toString();
    return s ? "?" + s : "";
  },

  // ---- clock -------------------------------------------------------------------
  // <wcs-timer> ticks are not time (throttled when hidden, lost asleep): each
  // tick only says "read the clock again".
  now: Date.now(),
  clockTick: 0,

  // ---- session (persisted by <wcs-storage>, shared by every tab) --------------
  /** @type {{ token: string, name: string, card: string } | null} */
  session: null,
  sessionEndReason: "",
  get token() { return this["session.token"] ?? ""; },
  get loggedIn() { return this.token !== ""; },
  get greeting() { return fmt(t.nav.hello, { name: this["session.name"] ?? "" }); },
  get authHeader() { return this.loggedIn ? "Bearer " + this.token : null; },
  get loginHref() {
    const here = this.path + this.queryString;
    return this.routeName === "login" || this.path === "/" ? "/login" : "/login?next=" + encodeURIComponent(here);
  },
  get onMemberPage() { return ["account", "fees", "hold"].includes(this.routeName); },

  loginForm: { card: "", pin: "" },
  loginBody: null,
  loginTrigger: false,
  loginLoading: false,
  loginError: null,
  get loginErrorMessage() {
    const e = this.loginError;
    if (!e) return "";
    return parseBody(e).error?.message ?? t.site.error;
  },
  login() {
    this.loginBody = { card: this["loginForm.card"], pin: this["loginForm.pin"] };
    this.loginTrigger = true;
  },
  get loginUrl() { return "/api/login?lang=" + lang; },
  logout() {
    this.sessionEndReason = "logout";
    this.session = null;
  },
  // Where a session change goes next is decided in the $watch on `token`, as
  // examples/router-auth does.

  // ---- language ---------------------------------------------------------------------
  // Switching language is a real navigation to the other basename, keeping
  // the page and its query.
  langPref: null,
  get langHref() {
    const rest = this.path + this.queryString;
    return { ja: "/ja" + rest, en: "/en" + rest, ar: "/ar" + rest };
  },
  get langCurrent() {
    return { ja: lang === "ja" ? "true" : null, en: lang === "en" ? "true" : null, ar: lang === "ar" ? "true" : null };
  },
  // The click only marks the switch: writing langPref here (the <wcs-storage>
  // value) saved the new language even when the reader then declined the
  // leave prompt and stayed — the page cannot tell what the reader answered.
  // The next page's head script commits it (the router README's recipe, 4.10).
  chooseLang(event) {
    const chosen = event.target.closest("a[hreflang]")?.getAttribute("hreflang");
    if (!chosen) return;
    try { sessionStorage.setItem("city-library.switching", chosen); } catch {}
  },

  // ---- preferences (persisted by <wcs-storage>) -----------------------------------
  /** @type {{ motion: string } | null} */
  prefs: null,
  get motionPref() { return this["prefs.motion"] ?? "system"; },
  set motionPref(v) { this.prefs = { ...(this.prefs ?? {}), motion: v === "off" ? "off" : "system" }; },
  get animationsOff() { return this.motionPref === "off"; },
  systemReducedMotion: false,
  systemDark: false,
  get systemMotionText() {
    return fmt(t.settings.systemMotion, { value: this.systemReducedMotion ? t.settings.reduce : t.settings.noPreference });
  },
  get systemSchemeText() {
    return fmt(t.settings.systemScheme, { value: this.systemDark ? t.settings.dark : t.settings.light });
  },

  // ---- branches --------------------------------------------------------------
  /** @type {{ value: { id: string, name: string, timeZone: string }[] | null, loading: boolean, error: any, status: number }} */
  branchesFetch: { value: null, loading: false, error: null, status: 0 },
  get branchesUrl() { return "/api/branches?lang=" + lang; },
  get branches() { return this["branchesFetch.value"] ?? []; },

  // ---- opening hours (always in the library's zone, Asia/Tokyo) ----------------
  /** @type {{ central: { timeZone: string, days: { date: string, opens: string | null, closes: string | null }[] } | null, riverside: { timeZone: string, days: { date: string, opens: string | null, closes: string | null }[] } | null, hilltop: { timeZone: string, days: { date: string, opens: string | null, closes: string | null }[] } | null }} */
  hours: { central: null, riverside: null, hilltop: null },
  get hoursFrom() {
    const from = this["query.from"] ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : "";
  },
  get hoursUrls() {
    const need = this.routeName === "hours" || this.routeName === "home";
    const from = this.routeName === "hours" && this.hoursFrom ? "&from=" + this.hoursFrom : "";
    const url = (id) => (need ? `/api/hours?branch=${id}&lang=${lang}${from}` : null);
    return { central: url("central"), riverside: url("riverside"), hilltop: url("hilltop") };
  },
  // Rows of instants: the template formats the day and the times with the
  // date / time filters in Tokyo's zone (`time(,short,Asia/Tokyo)`, state 4.10).
  // Up to 4.9 the filters took no zone and formatted in the reader's, so these
  // were Intl.DateTimeFormat(lang, { timeZone: "Asia/Tokyo" }) strings.
  get hoursTables() {
    const branches = this.branches;
    return BRANCH_IDS.map((id) => {
      const data = this[`hours.${id}`];
      const days = (data?.days ?? []).map((d) => {
        const day = tokyoInstant(d.date, "12:00");
        if (!d.opens || !d.closes) return { day, opens: null, closes: null, closedText: t.hours.closed, readerText: "—" };
        const opens = tokyoInstant(d.date, d.opens);
        const closes = tokyoInstant(d.date, d.closes);
        return {
          day,
          opens,
          closes,
          closedText: "",
          // The reader's own time is a getter still: a filter's style is a whole
          // date or a whole time, and this column needs the weekday with the
          // time (Thursday 09:00 in Tokyo is Wednesday 17:00 in Los Angeles)
          // and the zone's name.
          readerText: fmt(t.hours.yourRange, { opens: timeReader.format(opens), closes: timeReader.format(closes) }),
        };
      });
      const name = nameOf(branches, id);
      return { id, name, caption: fmt(t.hours.caption, { name, zone: zoneNameTokyo }), days };
    });
  },
  get todayHours() {
    const branches = this.branches;
    const now = this.now;
    const today = TOKYO_YMD.format(new Date(now));
    return BRANCH_IDS.map((id) => {
      const name = nameOf(branches, id);
      const day = (this[`hours.${id}.days`] ?? []).find((d) => d.date === today);
      if (day && day.opens && day.closes) {
        const opens = tokyoInstant(day.date, day.opens);
        const closes = tokyoInstant(day.date, day.closes);
        const open = now >= opens.getTime() && now < closes.getTime();
        return { id, name, opens, closes, closedToday: false, stateText: open ? t.home.open : t.home.closed };
      }
      // Closed today, or the week not loaded yet (no text).
      return { id, name, opens: null, closes: null, closedToday: true, stateText: day ? t.home.closedToday : "" };
    });
  },
  get hoursZoneNote() { return fmt(t.hours.zoneNote, { zone: zoneNameTokyo }); },
  get showReaderZone() { return readerZone !== LIBRARY_ZONE; },
  get hoursReaderNote() { return fmt(t.hours.readerNote, { zone: readerZone }); },
  get readerColumn() { return fmt(t.hours.yours, { zone: readerZone }); },

  // ---- search ----------------------------------------------------------------
  form: { q: "", type: "", branch: "", sort: "title" },
  // <wcs-debounce>'s settled value (the element is its authority).
  settledQ: undefined,
  // Set while the reader types in the results page's box, cleared when the
  // debounce settles: the URL watch keeps what is being typed, and only a typed
  // value is written to the URL — the debounce's first settle on a deep link
  // would write its "" over `?q=` (the router README's search recipe, 4.10).
  typing: false,
  lastSearch: "/search",
  searchStatus: "",
  // The page-level announcer's text (a region outside the router, always in
  // the page); emptied when the reader leaves the results, so the same count is
  // a change again when they come back. With <wcs-view-transition> a region in
  // the route body was inserted with its text and never announced (Chromium).
  searchAnnounce: "",

  /** @type {{ value: { total: number, page: number, per: number, items: { id: number, title: string, author: string, year: number, type: string, available: number, holds: number }[] } | null, loading: boolean, error: any, status: number }} */
  catalogFetch: { value: null, loading: false, error: null, status: 0 },

  get searchQ() { return this["query.q"] ?? ""; },
  get searchType() { return this["query.type"] ?? ""; },
  get searchBranch() { return this["query.branch"] ?? ""; },
  get searchSort() { return SORT_KEYS[this["query.sort"]] ? this["query.sort"] : "title"; },
  get searchPage() { return Math.max(1, Number(this["query.page"] ?? 1) || 1); },

  get catalogUrl() {
    if (this.routeName !== "search") return null;
    const p = new URLSearchParams({
      lang, q: this.searchQ, type: this.searchType, branch: this.searchBranch,
      sort: this.searchSort, page: String(this.searchPage), per: String(PER),
    });
    return "/api/catalog?" + p;
  },

  get results() {
    const v = this["catalogFetch.value"];
    return (v?.items ?? []).map((it) => ({
      id: it.id,
      title: it.title,
      author: it.author,
      href: "/items/" + it.id,
      yearText: fmt(t.search.year, { year: String(it.year) }),
      typeText: t.search.types[it.type] ?? it.type,
      availText: it.available > 0 ? pluralText(t.search.available, it.available) : t.search.noneAvailable,
    }));
  },
  get totalPages() {
    const v = this["catalogFetch.value"];
    return v ? Math.max(1, Math.ceil(v.total / v.per)) : 1;
  },
  get hasPrev() { return this.searchPage > 1; },
  get hasNext() { return this.searchPage < this.totalPages; },
  get searchNow() { return { q: this.searchQ, type: this.searchType, branch: this.searchBranch, sort: this.searchSort }; },
  get prevHref() { return pageQuery(this.searchNow, this.searchPage - 1); },
  get nextHref() { return pageQuery(this.searchNow, this.searchPage + 1); },
  // One link per page. The shown page's link is this URL as it is — the clean
  // URL of a new search has no `page`, and a link naming `page=1` would not be
  // current there — and every other page's link names its number (pageQuery).
  get pageLinks() {
    const shown = this.searchPage;
    const pages = [...Array(this.totalPages).keys()].map((i) => i + 1);
    return pages.map((page) => ({
      page,
      text: number.format(page),
      href: page === shown ? "/search" + this.queryString : pageQuery(this.searchNow, page),
    }));
  },
  get pageOfText() {
    return fmt(t.search.pageOf, { page: number.format(this.searchPage), total: number.format(this.totalPages) });
  },
  get noResults() {
    const v = this["catalogFetch.value"];
    return !this["catalogFetch.loading"] && v != null && v.total === 0;
  },
  // The sentence a screen reader hears after a search or a refinement. It
  // names the query, the filters and the sort, so two searches with the same
  // count still change the text (a polite region announces changes only).
  statusFor(value) {
    if (!value) return t.site.error;
    const type = this.searchType ? fmt(t.search.statusType, { label: t.search.types[this.searchType] ?? "" }) : "";
    const branch = this.searchBranch ? fmt(t.search.statusBranch, { label: nameOf(this.branches, this.searchBranch) }) : "";
    const pages = Math.max(1, Math.ceil(value.total / value.per));
    return fmt(this.searchQ ? t.search.status : t.search.statusAll, {
      q: isolate(this.searchQ), type, branch,
      count: pluralText(t.search.count, value.total),
      sort: t.search.sorts[SORT_KEYS[this.searchSort]],
      page: fmt(t.search.pageOf, { page: number.format(value.page), total: number.format(pages) }),
    });
  },
  get searchTitle() {
    return this.searchQ ? fmt(t.title.searchFor, { q: isolate(this.searchQ) }) : t.title.search;
  },

  typedQuery() { this.typing = true; },
  submitSearch() {
    this.typing = false;
    this.navigateUrl = searchPath({ q: this["form.q"], type: this["form.type"], branch: this["form.branch"], sort: this["form.sort"] });
  },
  applyFilters() {
    this.navigateUrl = searchPath({ q: this["form.q"], type: this["form.type"], branch: this["form.branch"], sort: this["form.sort"] });
  },

  // ---- item page ---------------------------------------------------------------
  get itemTitle() {
    if (this["routeData.missing"]) return t.title.itemMissing;
    return fmt(t.title.item, { title: isolate(this["routeData.item.title"]) });
  },
  get itemYearText() { return fmt(t.search.year, { year: String(this["routeData.item.year"] ?? "") }); },
  get itemTypeText() { return t.search.types[this["routeData.item.type"]] ?? ""; },
  get itemHoldsText() { return pluralText(t.item.holds, this["routeData.item.holds"] ?? 0); },
  get copies() {
    const list = this["routeData.item.copies"] ?? [];
    const branches = this.branches;
    return list.map((c) => ({
      branchName: nameOf(branches, c.branch),
      statusText: t.item.statuses[c.status] ?? c.status,
      // An instant; the template shows its Tokyo date (the date filter's zone).
      due: c.dueAt ? new Date(c.dueAt) : null,
    }));
  },
  get backToSearchHref() { return this.lastSearch; },
  get holdHref() { return "/items/" + (this["routeParams.id"] ?? "") + "/hold"; },
  get holdLinkText() { return this.loggedIn ? t.item.placeHold : t.item.loginToHold; },

  // ---- placing a hold -------------------------------------------------------------
  holdForm: { branch: "", notify: "", phone: "" },
  holdBody: null,
  holdTrigger: false,
  holdLoading: false,
  holdError: null,
  get holdPostUrl() { return "/api/holds?lang=" + lang; },
  get holdTitle() { return fmt(t.title.hold, { title: isolate(this["routeData.item.title"]) }); },
  get holdErrors() {
    const e = this.holdError;
    if (!e || e.status !== 422) return {};
    return parseBody(e).errors ?? {};
  },
  get holdConflict() {
    const e = this.holdError;
    if (!e || e.status === 422) return "";
    return parseBody(e).error?.message ?? t.site.error;
  },
  get holdErrorText() {
    const errs = this.holdErrors;
    return { branch: errs.branch?.message ?? "", notify: errs.notify?.message ?? "", phone: errs.phone?.message ?? "" };
  },
  get holdInvalid() {
    const errs = this.holdErrors;
    return { branch: errs.branch ? "true" : null, notify: errs.notify ? "true" : null, phone: errs.phone ? "true" : null };
  },
  get holdDescribedBy() {
    const errs = this.holdErrors;
    return {
      branch: errs.branch ? "hold-branch-error" : null,
      notify: errs.notify ? "hold-notify-error" : null,
      phone: errs.phone ? "hold-phone-hint hold-phone-error" : "hold-phone-hint",
    };
  },
  get holdErrorSummary() {
    const n = Object.keys(this.holdErrors).length;
    return n ? pluralText(t.hold.errorsSummary, n) : "";
  },
  // The summary lists each problem as a link to its field. Rendered with for:,
  // it makes the 422 a structural update — which, with <wcs-view-transition>,
  // is applied inside the transition a frame later (see the $watch below).
  get holdErrorList() {
    const errs = this.holdErrors;
    return HOLD_FIELDS.filter((k) => errs[k]).map((k) => ({ field: k, href: HOLD_TARGETS[k], message: errs[k].message }));
  },
  get holdDirty() {
    return this.routeName === "hold" && (this["holdForm.branch"] !== "" || this["holdForm.notify"] !== "" || this["holdForm.phone"] !== "");
  },
  // While the hold form has input, a navigation asks first (in the page's language).
  get discardPrompt() { return this.holdDirty ? t.hold.leave : null; },
  submitHold() {
    this.holdBody = {
      itemId: this["routeParams.id"],
      branch: this["holdForm.branch"],
      notify: this["holdForm.notify"],
      phone: this["holdForm.phone"],
    };
    this.holdTrigger = true;
  },

  // ---- my holds -------------------------------------------------------------------
  /** @type {{ value: { id: number, itemId: number, title: string, branch: string, status: string, position: number, readyUntil: string | null }[] | null, loading: boolean, error: any, status: number }} */
  holdsFetch: { value: null, loading: false, error: null, status: 0 },
  get holdsUrl() { return this.loggedIn && this.routeName === "account" ? "/api/me/holds?lang=" + lang : null; },
  get holds() {
    const list = this["holdsFetch.value"] ?? [];
    const branches = this.branches;
    const now = this.now;
    return list.map((h) => {
      let detailText = "";
      if (h.status === "waiting") detailText = fmt(t.account.position, { n: number.format(h.position) });
      else if (h.status === "ready" && h.readyUntil) {
        // Formatted here, not with the datetime filter: the date sits inside a
        // sentence the dictionary orders ("{date} まで取り置き（{relative}）"),
        // and a binding filters one value, not a part of a sentence.
        const until = new Date(h.readyUntil);
        detailText = fmt(t.account.readyUntil, { date: dateTimeTokyo.format(until), relative: relativeFrom(now, until) });
      }
      return {
        id: h.id,
        title: h.title,
        href: "/items/" + h.itemId,
        isReady: h.status === "ready",
        statusText: t.account.statuses[h.status] ?? h.status,
        detailText,
        pickupText: fmt(t.account.pickupAt, { branch: nameOf(branches, h.branch) }),
        cancelLabel: fmt(t.account.cancelLabel, { title: isolate(h.title) }),
      };
    });
  },
  get holdsCountText() {
    const list = this["holdsFetch.value"];
    if (!list) return "";
    return list.length ? pluralText(t.account.holdsCount, list.length) : t.account.noHolds;
  },
  // A message that outlives a navigation ("hold placed"): written to the
  // page-level status region once the navigation has finished (path fires
  // last), because a region inserted with the route body together with its
  // text is not announced — the router README says so since 4.10, and the
  // lint reports it (wcs/live-region-inserted).
  flash: "",
  pendingFlash: "",

  // The cancel dialog.
  /** @type {{ id: number, title: string } | null} */
  cancelTarget: null,
  cancelUrl: null,
  cancelTrigger: false,
  cancelError: null,
  get cancelBody() { return this.cancelTarget ? fmt(t.account.dialogBody, { title: isolate(this["cancelTarget.title"]) }) : ""; },
  askCancel(event, index) {
    const h = this.holds[index];
    this.cancelTarget = { id: h.id, title: h.title };
  },
  dismissCancel() { this.$command.closeCancel.emit(); },
  confirmCancel() {
    const target = this.cancelTarget;
    if (!target) return;
    this.cancelUrl = `/api/holds/${target.id}?lang=${lang}`;
    this.cancelTrigger = true;
    this.$command.closeCancel.emit();
    // The dialog gives the focus back to the button in the row, and the row is
    // about to go (the focus would fall to <body>): move it to the list's
    // heading instead — still the page's to do (router README, 4.10).
    this.$command.focusHoldsHeading.emit();
  },

  // ---- fees -------------------------------------------------------------------------
  /** @type {{ value: { currency: string, items: { id: number, reason: string, amount: number, date: string }[] } | null, loading: boolean, error: any, status: number }} */
  feesFetch: { value: null, loading: false, error: null, status: 0 },
  get feesUrl() { return this.loggedIn && this.routeName === "fees" ? "/api/me/fees?lang=" + lang : null; },
  get fees() {
    const items = this["feesFetch.value.items"] ?? [];
    return items.map((f) => ({
      id: f.id,
      reason: f.reason,
      amount: f.amount,
      // The day the fee was charged, a Tokyo date: midnight there is the day
      // before in Los Angeles, so the template formats it in Tokyo's zone.
      date: new Date(f.date + "T00:00:00+09:00"),
    }));
  },
  get hasFees() { return this.fees.length > 0; },
  get feesSummary() {
    const v = this["feesFetch.value"];
    if (!v) return "";
    if (v.items.length === 0) return t.account.noFees;
    const total = v.items.reduce((sum, f) => sum + f.amount, 0);
    return fmt(pluralText(t.account.feesCount, v.items.length), { total: yen.format(total) });
  },
  get feesTitle() { return t.account.feesHeading + " — " + t.site.name; },

  // ---- server events -------------------------------------------------------------
  get streamUrl() { return this.loggedIn ? `/api/stream?token=${this.token}&lang=${lang}` : null; },
  streamConnected: false,
  /** @type {{ key: string, text: string }[]} */
  notices: [],
  seenEvents: [],

  $commandTokens: ["refreshHolds", "openCancel", "closeCancel", "closeStream", "focusBranch", "focusNotify", "focusPhone", "focusHoldsHeading"],
  $eventTokens: ["catalogResponded", "loginResponded", "memberResponded", "holdResponded", "cancelResponded", "holdEvent"],
  $on: {
    // The result count is written from the response event, never derived from
    // `value` and the current query (the region said the new query with the
    // previous total first) — the router README's search recipe since 4.10. Both
    // the visible line and the page-level announcer (a region in the route body
    // is inserted with its text, and is not announced) get it.
    catalogResponded(state, event) {
      const { status, value } = event.detail ?? {};
      const text = status === 200 ? state.statusFor(value) : t.site.error;
      state.searchStatus = text;
      state.searchAnnounce = text;
    },
    loginResponded(state, event) {
      const { status, value } = event.detail ?? {};
      if (status !== 200 || !value?.token) return;
      state.session = value;
      state.loginForm = { card: "", pin: "" };
    },
    memberResponded(state, event) {
      if (event.detail?.status === 401) {
        state.sessionEndReason = "expired";
        state.session = null;
      }
    },
    holdResponded(state, event) {
      const { status, value } = event.detail ?? {};
      if (status !== 201) return;
      state.holdForm = { branch: "", notify: "", phone: "" };
      state.pendingFlash = fmt(t.hold.placed, { title: isolate(value?.title) });
      state.navigateUrl = "/account";
    },
    cancelResponded(state, event) {
      const status = event.detail?.status;
      if (status !== 204) return;
      const title = state["cancelTarget.title"] ?? "";
      state.cancelTarget = null;
      state.flash = fmt(t.account.cancelled, { title: isolate(title) });
      state.$command.refreshHolds.emit();
    },
    holdEvent(state, event) {
      const m = event.detail;
      const d = m?.data;
      if (!d || typeof d !== "object") return;
      // The server may send the same news twice; a reader hears it once.
      const key = `${d.id}:${d.status}:${d.readyUntil ?? ""}`;
      if (state.seenEvents.includes(key)) return;
      state.seenEvents = [...state.seenEvents.slice(-49), key];
      state.notices = [...state.notices.slice(-4), { key: String(m.lastEventId || key), text: d.message }];
      if (state.routeName === "account") state.$command.refreshHolds.emit();
    },
  },

  $watch: {
    // The URL is the source of the search; the form follows it (Back /
    // Forward, a link), but never overwrites what the reader is typing.
    query(cur) {
      const q = cur?.q ?? "";
      this.form = {
        q: this.typing ? this["form.q"] : q,
        type: cur?.type ?? "",
        branch: cur?.branch ?? "",
        sort: SORT_KEYS[cur?.sort] ? cur.sort : "title",
      };
      if (this.routeName === "search") this.lastSearch = "/search" + this.queryString;
    },
    // Typing on the results page refines the search in place: replaceUrl, so
    // the history does not record every keystroke (router README).
    settledQ(cur) {
      if (!this.typing) return;
      this.typing = false;
      if (this.routeName !== "search") return;
      if ((cur ?? "") === this.searchQ) return;
      this.replaceUrl = searchPath({ q: cur, type: this.searchType, branch: this.searchBranch, sort: this.searchSort });
    },
    clockTick() { this.now = Date.now(); },
    // A navigation finished: say what the previous page left to say, or
    // clear the region (so the same message next time is a change again).
    path() {
      this.flash = this.pendingFlash;
      this.pendingFlash = "";
    },
    // Every session change lands here, in this tab or another (storage event),
    // as examples/router-auth does. The guards read the session from
    // localStorage, which <wcs-storage> writes when its binding is applied: with
    // <wcs-view-transition>, $watch runs after the bindings the transition
    // applies (state 4.10), so the session is saved before this navigates. Up to
    // 4.9 the watch ran first and the guard sent the reader back to the login.
    token(cur, prev) {
      if (cur === prev) return;
      if (prev) {
        // A session ended or changed: drop the member's data and close the
        // stream (clearing its url does not close it), and leave a member page.
        this["holdsFetch.value"] = null;
        this["feesFetch.value"] = null;
        this.notices = [];
        this.seenEvents = [];
        this.$command.closeStream.emit();
        const reason = this.sessionEndReason;
        this.sessionEndReason = "";
        if (reason === "logout") { this.navigateUrl = "/"; return; }
        if (this.onMemberPage) { this.replaceUrl = "/login?next=" + encodeURIComponent(addressNow()); return; }
      }
      // Logged in (here, or in another tab while this one shows the form).
      if (cur && this.routeName === "login") this.replaceUrl = safeNext(this["query.next"]);
    },
    routeName(cur) {
      if (cur !== "login") this.loginError = null;
      if (cur !== "search") this.searchAnnounce = "";
      if (cur !== "hold") this.holdError = null;
    },
    // A cancel target set → the dialog's text is already applied (watches run
    // after the bindings of the same update): open it now.
    cancelTarget(cur) {
      if (cur) this.$command.openCancel.emit();
    },
    // A 422 → move the focus to the first wrong field. The summary's list makes
    // the update structural, so with <wcs-view-transition> its bindings —
    // aria-invalid and aria-describedby among them — are applied inside the
    // transition, a frame later; $watch runs after them (state 4.10). Up to 4.9
    // it ran first, and the field was focused before it was marked invalid.
    holdErrors(errs) {
      const first = HOLD_FIELDS.find((k) => errs?.[k]);
      if (first === "branch") this.$command.focusBranch.emit();
      else if (first === "notify") this.$command.focusNotify.emit();
      else if (first === "phone") this.$command.focusPhone.emit();
    },
  },
};
