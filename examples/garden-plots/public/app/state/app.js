// みどり市 市民農園 区画管理 — the root state. It holds what every page shares (the router's outputs, the parts'
// readiness, the live connection, the toasts) and what wcstack allows only on a root: $watch, $listKeys, the
// tokens and $on (skill state-binding.md §2). Each such declaration says which feature it belongs to.
// The features' own data and methods are in the volumes: map.js, plot.js, waiting.js, faq.js, settings.js.
import { countStatuses, STATUSES } from "../../parts/lib/counts.js";

const PART_TAGS = ["garden-card", "area-block", "plot-tile", "tenant-editor", "faq-node",
  "midori-badge", "midori-toggle", "midori-pager", "midori-tabs", "midori-dialog", "midori-toast"];

export default {
  // ── the router's outputs (<wcs-router data-wcs="…">) ──
  routeName: "",
  routeParams: {},
  routeQuery: {},
  routePath: "",
  navigateUrl: null,

  // ── the parts (<wcs-defined>) ──
  partsPending: PART_TAGS,
  partsMissing: [],
  // workaround: a command-token emit before <midori-toast> is defined is dropped (skill SKILL.md §2, "never
  // replayed"); toasts asked for meanwhile wait here and are shown when the part arrives.
  toastQueue: [],

  // ── the live connection (<wcs-sse>) ──
  liveConnected: false,
  liveEverConnected: false,
  /** "<plot id>:<version>" of the changes this tab made itself — their live echo is not announced */
  ownChanges: [],
  /** the plot events that arrived while a save of this tab was in flight: judged once its answer is in (remember) */
  heldPlots: [],

  appError: "",
  // the dialogs' titles (a designers' part takes its `title` through a binding, so it needs a path)
  titles: { assign: "利用開始", return: "区画を返還", add: "待機者を追加", delete: "待機者を削除" },
  followedUrl: "",

  // ── header ──
  // Every status read by path, so a live change of one plot (written by path, deep in the tree) re-counts. Reading
  // this["map.gardens"] as a whole would depend on the array only (skill §6, "Dependency tracking boundaries").
  get statuses() { return this.$getAll("map.gardens.*.areas.*.plots.*.status", []); },
  get freeNow() { return countStatuses(this.statuses).free; },
  get freeNowText() { return this["map.loaded"] ? String(this.freeNow) : "—"; },
  get liveLabel() { return this.liveConnected ? "● 自動更新中" : "○ 自動更新が止まっています"; },
  get liveOff() { return !this.liveConnected && this.liveEverConnected; },
  get partsMissingText() {
    return this.partsMissing.length ? `部品を読み込めませんでした（${this.partsMissing.join("、")}）。この画面の一部が使えません。ページを再読み込みしてください。` : "";
  },
  get partsBroken() { return this.partsMissing.length > 0; },

  // ── map (区画マップ) ──
  // The city's free plots and the matches: what the <garden-card>s derive (their exported getters), summed.
  get mapCityFree() { return this.$getAll("map.gardens.*.freeCount", []).reduce((a, b) => a + (b ?? 0), 0); },
  get mapMatchTotal() { return this.$getAll("map.gardens.*.matchCount", []).reduce((a, b) => a + (b ?? 0), 0); },
  get mapFiltered() { return this["map.view.filter"] !== "all"; },
  get mapStatusCounts() { return countStatuses(this.statuses); },
  /** @returns {{ key: string, label: string, n: number, to: string }[]} */
  get mapFilterLinks() {
    const c = this.mapStatusCounts;
    return [{ key: "all", label: "すべて", n: c.total }, ...STATUSES.map((s) => ({ key: s.key, label: s.label, n: c[s.key] }))]
      .map((l) => ({ ...l, to: l.key === "all" ? "/?" : `/?status=${l.key}` }));
  },
  get mapFilterLabel() { return this.mapFilterLinks.find((l) => l.key === this["map.view.filter"])?.label ?? "すべて"; },
  get mapHasSelection() { return Boolean(this["map.selectedPlot"]); },

  // ── plot (区画) ──
  get plotDocTitle() { return `${this["plot.title"]} — みどり市 市民農園 区画管理`; },

  // ── toasts ──
  $commandTokens: ["toast"],
  /** Turn a feature's result into a toast, as the settings ask. */
  report(result) {
    if (!result || result.quiet || !result.text) return;
    if (result.ok && !this["settings.notifySaved"]) return;
    const seconds = result.kind === "error" ? (this["settings.stickyErrors"] ? 0 : 8) : 4;
    this.showToast({ kind: result.kind ?? (result.ok ? "success" : "error"), text: result.text, seconds });
  },
  showToast(message) {
    if (this.partsPending.includes("midori-toast")) {
      this.toastQueue = this.toastQueue.concat(message);
      return;
    }
    this.$command.toast.emit(message);
  },

  // ── plot page actions (the volume does the work; the root announces it) ──
  remember(result) {
    if (result?.plot) {
      this.ownChanges = this.ownChanges.slice(-19).concat(`${result.plot.id}:${result.plot.version}`);
      this["map.applyPlot"](result.plot);
    }
    this.report(result);
    // the events kept while the save was in flight: its answer has now said which change was this tab's
    const held = this.heldPlots;
    if (held.length > 0) {
      this.heldPlots = [];
      for (const plot of held) this.livePlot(plot);
    }
    return result;
  },
  /** A plot changed on the server (the event stream): the map follows, and another member's change is announced. */
  livePlot(plot) {
    const own = this.ownChanges.includes(`${plot.id}:${plot.version}`);
    const changed = this["map.applyPlot"](plot);
    const onPage = this.routeName === "plot" && this["plot.liveChange"](plot);
    if (changed && !own && this["settings.notifyLive"] && onPage) {
      this.showToast({ kind: "info", text: `区画 ${plot.no} が他の職員によって変更されました`, seconds: 6 });
    }
  },
  async plotSave() { this.remember(await this["plot.save"]()); },
  async plotSaveMine() { this.remember(await this["plot.save"](true)); },
  plotTakeTheirs() { this["plot.takeTheirs"](); },
  async plotReload() { this.report(await this["plot.load"](this["plot.id"])); },
  async plotOpenAssign() { this.report(await this["plot.openAssign"]()); },
  async plotAssign() { this.remember(await this["plot.assign"]()); },
  async plotReturn() { this.remember(await this["plot.doReturn"]()); },

  // ── waiting list actions ──
  async waitingSaveRow(event, i) { this.report(await this["waiting.saveRow"](i)); },
  async waitingUp(event, i) { this.report(await this["waiting.move"](i, "up")); },
  async waitingDown(event, i) { this.report(await this["waiting.move"](i, "down")); },
  async waitingDelete() { this.report(await this["waiting.confirmDelete"]()); },
  async waitingAdd() { this.report(await this["waiting.add"]()); },
  async waitingReload() {
    const r = await this["waiting.load"]();
    this.report(r.ok ? { ok: true, kind: "info", text: "待機者を読み込み直しました" } : r);
  },
  sortByApplied() { this["waiting.page"] = 1; this["waiting.sort"] = "applied"; },
  sortByPriority() { this["waiting.page"] = 1; this["waiting.sort"] = "priority"; },

  /**
   * The router reports the first route before the volumes' files have arrived, and the root's code runs without a
   * volume that is not there yet (its methods are missing, its keys throw). A volume's connectedCallbackPromise
   * resolves once it has grafted: wait for every volume element of the page before calling into one.
   */
  async volumesReady() {
    await Promise.all([...document.querySelectorAll("wcs-state[mount]")].map((el) => el.connectedCallbackPromise));
  },

  /** The URL decides what each page shows: called when the path or the query changes. */
  async followRoute() {
    await this.volumesReady();
    const name = this.routeName;
    const q = this.routeQuery ?? {};
    // routePath and routeQuery both change on a navigation that changes both: follow each URL once.
    const key = `${this.routePath}?${new URLSearchParams(q)}`;
    if (key === this.followedUrl) return;
    this.followedUrl = key;
    if (name === "map") this["map.setFilter"](q.status ?? "all");
    if (name === "plot") this.report(await this["plot.load"](this.routeParams?.id));
    if (name === "waiting") {
      this["waiting.page"] = Math.max(1, Number.parseInt(q.page, 10) || 1);
      this["waiting.sort"] = q.sort === "priority" ? "priority" : "applied";
      this.report(await this["waiting.load"]());
    }
    if (name === "help") this.report(await this["faq.load"]());
  },

  // ── live updates ──
  $eventTokens: ["serverEvent"],
  $on: {
    // map + plot + waiting: another member of staff changed something
    serverEvent(state, event) {
      const message = event.detail ?? {};
      if (message.event === "plot" && message.data?.id) {
        // This tab's own save comes back on the stream too, and the server writes the event before the answer: an
        // echo can be here first. While a save is in flight the event waits for the answer (remember).
        if (state["plot.saving"]) state.heldPlots = state.heldPlots.concat(message.data);
        else state.livePlot(message.data);
      }
      if (message.event === "waiting" && state.routeName === "waiting") state["waiting.load"]();
    },
  },

  // ── declarations a volume may not hold ──
  $listKeys: { "waiting.items": "id" }, // waiting: a reload keeps the rows (and their open editors) in place

  $watch: {
    // router → every page
    routePath() { return this.followRoute(); },
    routeQuery() { if (this.routeName !== "plot") return this.followRoute(); },
    // waiting: the pager and the sort buttons write the volume; the URL follows (Back steps through the pages)
    "waiting.page"(page) { this.waitingToUrl(); },
    "waiting.sort"(sort) { this.waitingToUrl(); },
    // plot: the 休止 switch
    async "plot.pausedView"(paused) {
      if (this.routeName !== "plot" || !this["plot.ready"]) return;
      this.remember(await this["plot.setPaused"](paused));
    },
    // settings: apply to every part on the page (the parts read the tokens from <html>). Saving them is
    // <wcs-storage>'s: it is bound to settings.stored, which reads every field
    "settings.theme"(theme) { document.documentElement.dataset.theme = theme; },
    "settings.density"(density) { document.documentElement.dataset.density = density; },
    // the live connection: after a gap, what changed meanwhile was not sent — load it again
    liveConnected(now) {
      if (!now) return;
      if (this.liveEverConnected) {
        this["map.load"]();
        if (this.routeName === "plot") this["plot.load"](this["plot.id"]);
        if (this.routeName === "waiting") this["waiting.load"]();
      }
      this.liveEverConnected = true;
    },
    // the parts: flush the toasts that waited for <midori-toast>
    partsPending(pending) {
      if (pending.includes("midori-toast") || this.toastQueue.length === 0) return;
      const queue = this.toastQueue;
      this.toastQueue = [];
      for (const m of queue) this.$command.toast.emit(m);
    },
  },
  waitingToUrl() {
    // Only once the URL itself has been read: the volume's graft fires these watches with its defaults, which would
    // otherwise rewrite ?sort=priority to the default before followRoute() had applied it.
    if (this.routeName !== "waiting" || !this.followedUrl.startsWith("/waiting")) return;
    const page = this["waiting.page"];
    const sort = this["waiting.sort"];
    const q = this.routeQuery ?? {};
    if (String(q.page ?? "1") === String(page) && (q.sort ?? "applied") === sort) return;
    this.navigateUrl = `?page=${page}&sort=${sort}`;
  },

  $connectedCallback() {
    // settings: what was saved may have arrived before the watches started. Not awaited (the page binds meanwhile),
    // and not read at once: a volume's keys are not there before its file has arrived.
    this.volumesReady().then(() => {
      this["map.load"](); // the header count and the map need the gardens on every route
      if (this["settings.theme"]) document.documentElement.dataset.theme = this["settings.theme"];
      if (this["settings.density"]) document.documentElement.dataset.density = this["settings.density"];
    });
  },

  $errorCallback(error, { path }) {
    this.appError = `表示の一部でエラーが起きました（${path}: ${error?.message ?? error}）`;
    reportError(error); // keep it visible to the console and the tests (state README, "$errorCallback")
  },
};
