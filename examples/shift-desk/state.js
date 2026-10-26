// shift-desk — the root state. README.md says what each part shows; docs/long-lived-pages.md is the guide this follows
// for what a page left open for a shift needs.
/** @typedef {{ id: number, subject: string, customer: string, priority: string, createdAt: number, slaMinutes: number, claimedBy: string | null, status: string, closedAt: number | null, lastMessageAt: number, messageCount: number }} Ticket */
/** @typedef {{ id: string, from: string, text: string, at: number }} Message */
/** @typedef {{ user: string, token: string, refreshToken: string, expiresAt: number }} Session */

// Not state: bookkeeping no binding reads.
let refreshing = null;            // the refresh in flight, shared by every caller
let streamRetry = null;           // the timer that reopens a stream that gave up
let streamBackoff = 1000;
let pendingEvents = [];           // stream events waiting for the next batch (a reconnect replays many at once)
let flushTimer = null;
let lastTickAt = 0;               // when the 1-second clock last ticked: a long gap means sleep, freeze or throttling
let onWakeEvent = null;           // the listener for the events that end a gap (a listener is not state)
const CAPS = { queueRows: 200, chat: 200, chatKept: 500, activity: 50, samples: 240 };

function pad(n) { return String(n).padStart(2, "0"); }
function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m ${pad(sec)}s`;
}
function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default {
  // ---------------------------------------------------------------- session
  /** @type {Session | null} */
  session: null,
  loginForm: { user: "", password: "" },
  loginBody: null,
  loginRequest: false,
  /** @type {{ token: string, refreshToken: string, expiresAt: number } | null} */
  loginResult: null,
  loginError: null,
  loginLoading: false,
  loginMessage: "",
  appError: "",

  // ---------------------------------------------------------------- router
  routeParams: {},
  routeName: "",
  routeQuery: {},
  navigateUrl: null,
  replaceUrl: null,

  // ---------------------------------------------------------------- the clock: the 1-second <wcs-timer> writes Date.now() here
  now: Date.now(),

  // ---------------------------------------------------------------- the queue
  /** @type {Ticket[]} */
  tickets: [],
  seq: 0,                 // id of the last event applied
  streamSince: null,      // the position the stream's url asks for: fixed while the stream is open
  streamToken: null,      // the token in the stream's url (an EventSource cannot send headers)
  streamTrigger: false,
  sseConnected: false,
  sseErrorInfo: null,
  /** @type {{ seq: number, tickets: Ticket[] } | null} */
  queueSnapshot: null,
  queueError: null,
  queueLoading: false,

  // ---------------------------------------------------------------- the ticket page
  /** @type {(Ticket & { messages: Message[] }) | null} */
  ticketResult: null,
  ticketError: null,
  ticketLoading: false,
  /** @type {Ticket | null} */
  ticketLive: null,
  draft: null,            // <wcs-storage> per ticket: null is what an empty key loads as
  replyMessage: "",
  actionMessage: "",
  sending: false,
  acting: false,

  // ---------------------------------------------------------------- the conversation
  chatToken: null,        // the token in the chat url, taken when the ticket opens
  chatConnected: false,
  chatEverConnected: false,
  chatOutgoing: null,
  chatError: null,
  draftThrottled: "",
  lastTypingSent: "",
  typingPulse: 0,
  typingSettled: 0,
  customerTyping: false,

  // ---------------------------------------------------------------- notifications
  notifyPermission: "prompt",
  pageHidden: false,

  // ---------------------------------------------------------------- presence, the wall, the outbox
  idleUserState: null,    // null until <wcs-idle> started, then "active" / "idle"
  idleError: null,
  offline: false,
  /** @type {{ clientId: string, ticketId: number, text: string, at: number }[] | null} */
  outbox: null,
  flushing: false,
  lastFlushTry: 0,
  wakeHeld: false,
  wakeError: null,
  wallSuspended: false,
  wallFrames: 0,
  wallNow: Date.now(),
  /** @type {{ t: number, open: number }[]} */
  loadSamples: [],

  // ---------------------------------------------------------------- today
  today: { date: "", opened: null, closed: null, breached: null },
  statsRequest: false,
  /** @type {{ date: string, opened: number, closed: number, breached: number } | null} */
  statsResult: null,
  statsError: null,
  statsOtherDay: "",      // the server answered for another day than the page's (around midnight, another time zone)

  // ---------------------------------------------------------------- several tabs
  tabId: crypto.randomUUID(),     // in memory only: a duplicated tab must not share it
  /** @type {{ tabId: string, user: string, open: number | null, claimed: number[], at: number }[]} */
  otherTabs: [],
  tabError: null,
  lastAnnounce: 0,
  prefs: { notifyUrgent: true, notifyMessages: true },

  // ---------------------------------------------------------------- all day
  /** @type {{ seq: number, text: string, at: number }[]} */
  activity: [],
  quietUntil: 0,          // after a wake: what was replayed from the gap is summed up, not notified one by one
  wakes: 0,
  lastWake: "",

  $listKeys: { tickets: "id" },
  $commandTokens: ["reloadQueue", "closeStream", "notify", "requestNotify", "idleRequest", "idleStart", "tabPost", "chatConnect"],
  $eventTokens: ["streamEvent", "queueResponded", "ticketResponded", "clockTick", "chatReceived", "notificationClicked", "wallFrame", "statsTick", "statsResponded", "tabMessage"],

  // ---------------------------------------------------------------- derived: session
  get loggedIn() { return Boolean(this["session.refreshToken"]); },
  get token() { return this["session.token"] ?? null; },
  get authHeader() { return this.token ? `Bearer ${this.token}` : null; },

  // ---------------------------------------------------------------- derived: the queue
  get queueUrl() { return this.loggedIn && this.token ? "/api/tickets?status=open" : null; },
  get streamUrl() {
    if (this.streamSince === null || !this.streamToken) return null;
    return `/api/events?since=${this.streamSince}&token=${this.streamToken}`;
  },
  get queue() {
    return this.tickets.filter((t) => t.status === "open")
      .toSorted((a, b) => (a.createdAt + a.slaMinutes * 60000) - (b.createdAt + b.slaMinutes * 60000));
  },
  get queueCountLabel() { return `(${this.queue.length})`; },
  // only the most urgent rows are rendered: every row re-renders its SLA each second
  /** @returns {Ticket[]} */
  get queueTop() { return this.queue.slice(0, CAPS.queueRows); },
  get queueMoreLabel() {
    const more = this.queue.length - CAPS.queueRows;
    return more > 0 ? `… and ${more} more, further from their deadline` : "";
  },
  get "queueTop.*.href"() { return `/tickets/${this["queueTop.*.id"]}`; },
  get "queueTop.*.deadline"() { return this["queueTop.*.createdAt"] + this["queueTop.*.slaMinutes"] * 60000; },
  get "queueTop.*.left"() { return this["queueTop.*.deadline"] - this.now; },
  get "queueTop.*.breached"() { return this["queueTop.*.left"] < 0; },
  get "queueTop.*.isUrgent"() { return this["queueTop.*.priority"] === "urgent"; },
  get "queueTop.*.slaLabel"() {
    const left = this["queueTop.*.left"];
    return left >= 0 ? fmtDuration(left) : `breached ${fmtDuration(-left)} ago`;
  },
  get "queueTop.*.ageLabel"() { return fmtDuration(this.now - this["queueTop.*.createdAt"]); },
  get "queueTop.*.ownerLabel"() {
    const by = this["queueTop.*.claimedBy"];
    if (!by) return "—";
    return by === this["session.user"] ? "you" : by;
  },
  /** @returns {{ seq: number, text: string, at: number }[]} */
  get recentActivity() { return this.activity.slice(-10).toReversed(); },
  get openElsewhere() {
    const ids = new Set();
    for (const t of this.otherTabs) if (t.user === this["session.user"] && t.open) ids.add(t.open);
    return [...ids];
  },
  get "queueTop.*.elsewhereLabel"() { return this.openElsewhere.includes(this["queueTop.*.id"]) ? "(open in another tab)" : ""; },
  get otherTabsLabel() {
    const n = this.otherTabs.filter((t) => t.user === this["session.user"]).length;
    return n ? `${n} other tab${n === 1 ? "" : "s"} open` : "no other tab";
  },
  get ticketElsewhereLabel() {
    return this.ticketId && this.openElsewhere.includes(this.ticketId) ? "This ticket is open in another tab too — its draft is shared." : "";
  },
  get draftKey() { return this.ticketId ? `shift-desk.draft.${this.ticketId}` : null; },
  get prefsSnapshot() { return { notifyUrgent: this["prefs.notifyUrgent"], notifyMessages: this["prefs.notifyMessages"] }; },
  set prefsSnapshot(v) { if (v && typeof v === "object") this.prefs = { ...this.prefs, ...v }; },
  get connectionLabel() {
    if (!this.loggedIn) return "";
    return this.sseConnected ? "Live" : "Reconnecting…";
  },
  get isLive() { return this.loggedIn && this.sseConnected; },

  // ---------------------------------------------------------------- derived: the ticket page
  get ticketId() { return this.routeName === "ticket" ? (this["routeParams.id"] ?? null) : null; },
  get ticketUrl() { return this.ticketId && this.token ? `/api/tickets/${this.ticketId}` : null; },
  /** @returns {(Ticket & { messages: Message[] }) | null} */
  get ticket() {
    const r = this.ticketResult;
    if (!r || r.id !== this.ticketId) return null;
    const live = this.ticketLive;
    return live && live.id === r.id ? { ...r, ...live } : r;
  },
  get ticketIdLabel() { return this.ticket ? `#${this.ticket.id}` : ""; },
  get ticketTitle() { return this.ticket ? `#${this.ticket.id} ${this.ticket.subject} — Shift desk` : "Ticket — Shift desk"; },
  get ticketMessage() {
    if (!this.ticketError) return "";
    return this.ticketError.status === 404 ? "No such ticket." : "The ticket could not be loaded.";
  },
  get ticketSlaLabel() {
    const t = this.ticket;
    if (!t) return "";
    if (t.status !== "open") return "closed";
    const left = t.createdAt + t.slaMinutes * 60000 - this.now;
    return left >= 0 ? `${fmtDuration(left)} left` : `breached ${fmtDuration(-left)} ago`;
  },
  get ticketOwnerLabel() {
    const t = this.ticket;
    if (!t) return "";
    if (t.status !== "open") return "closed";
    if (!t.claimedBy) return "unclaimed";
    return t.claimedBy === this["session.user"] ? "claimed by you" : `claimed by ${t.claimedBy}`;
  },
  get claimDisabled() {
    const t = this.ticket;
    return !t || this.acting || t.status !== "open" || t.claimedBy === this["session.user"];
  },
  get closeDisabled() {
    const t = this.ticket;
    return !t || this.acting || t.status !== "open";
  },
  get replyDisabled() { return !this.ticket || this.ticket.status !== "open"; },
  /** @returns {{ id: string, from: string, text: string, at: number, mine: boolean, atDate: Date }[]} */
  get conversation() {
    const r = this.ticket;
    if (!r) return [];
    const me = this["session.user"];
    return r.messages.slice(-CAPS.chat).map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.at, mine: m.from === me, atDate: new Date(m.at) }));
  },
  get olderHiddenLabel() {
    const n = (this.ticket?.messages.length ?? 0) - CAPS.chat;
    return n > 0 ? `${n} older messages are not shown` : "";
  },
  get chatUrl() { return this.ticketId && this.chatToken ? `/ws/chat?ticket=${this.ticketId}&token=${this.chatToken}` : null; },
  get chatLabel() {
    if (!this.ticket) return "";
    return this.chatConnected ? "Chat connected" : "Chat reconnecting…";
  },
  get typingLabel() { return this.customerTyping ? "The customer is typing…" : ""; },

  // ---------------------------------------------------------------- derived: the rest
  get notifyAsked() { return this.notifyPermission !== "prompt"; },
  get canNotify() { return this.notifyPermission === "granted"; },
  get presenceOn() { return this.idleUserState !== null; },
  get presenceLabel() { return this.idleUserState === null ? "Presence off" : this.idleUserState === "idle" ? "Away" : "Active"; },
  get isAway() { return this.idleUserState === "idle"; },
  get outboxList() { return Array.isArray(this.outbox) ? this.outbox : []; },
  get outboxEmpty() { return this.outboxList.length === 0; },
  get outboxLabel() {
    const n = this.outboxList.length;
    return `${n} ${n === 1 ? "reply" : "replies"} waiting in the outbox${this.offline ? "" : " — sending…"}`;
  },
  get ticketOutbox() { return this.outboxList.filter((o) => o.ticketId === this.ticketId); },
  get ticketOutboxEmpty() { return this.ticketOutbox.length === 0; },
  get onWall() { return this.routeName === "wall"; },
  // clocks: every one of these reads `now`; a getter that read Date.now() would keep its first value
  get nowDate() { return new Date(this.now); },
  get todayKey() { return dayKey(this.now); },
  get statsUrl() { return this.loggedIn ? "/api/stats/today" : null; },
  get statsNote() {
    if (this.statsError) return "(statistics unavailable — retrying)";
    return this.statsOtherDay ? `(the server is still on ${this.statsOtherDay})` : "";
  },
  get urgentCount() { return this.queue.filter((t) => t.priority === "urgent").length; },
  get breachedCount() { return this.queue.filter((t) => t.createdAt + t.slaMinutes * 60000 < this.now).length; },
  get wakeLabel() {
    if (this.wakeError) return `no (${this.wakeError.name ?? "error"})`;
    return this.wakeHeld ? "yes" : "no";
  },
  get chartPoints() {
    const end = this.wallNow, start = end - 3600000;
    const pts = this.loadSamples.filter((p) => p.t >= start);
    const max = Math.max(10, ...pts.map((p) => p.open));
    return pts.map((p) => `${(((p.t - start) / 3600000) * 600).toFixed(1)},${(195 - (p.open / max) * 185).toFixed(1)}`).join(" ");
  },

  // ---------------------------------------------------------------- lifecycle
  // $connectedCallback does not run again after a sleep, a freeze or a back/forward-cache restore:
  // the events that end such a gap go to one wake handler (docs/long-lived-pages.md, "One wake handler").
  $connectedCallback() {
    this.now = Date.now();
    lastTickAt = this.now;
    this.pageHidden = document.visibilityState === "hidden";
    onWakeEvent = (e) => {
      if (e.type === "visibilitychange") {
        this.pageHidden = document.visibilityState === "hidden";
        if (this.pageHidden) return;
      }
      if (e.type === "pageshow" && !e.persisted) return;
      if (e.type === "pagehide") {
        // tell the other tabs we are gone; a tab closed without this, frozen or asleep stops announcing
        // and the others forget it after 90 s
        this.$command.tabPost.emit({ type: "bye", tabId: this.tabId });
        return;
      }
      this.onWake(e.type);
    };
    for (const type of ["visibilitychange", "resume"]) document.addEventListener(type, onWakeEvent);
    for (const type of ["pageshow", "pagehide", "online"]) window.addEventListener(type, onWakeEvent);
    this.announce(true);
  },
  $disconnectedCallback() {
    for (const type of ["visibilitychange", "resume"]) document.removeEventListener(type, onWakeEvent);
    for (const type of ["pageshow", "pagehide", "online"]) window.removeEventListener(type, onWakeEvent);
  },

  $watch: {
    loginResult(result) {
      if (!result?.token) return;
      this.session = { user: this["loginForm.user"], token: result.token, refreshToken: result.refreshToken, expiresAt: result.expiresAt };
      this["loginForm.password"] = "";
      this.loginMessage = "";
      const next = this["routeQuery.next"];
      this.navigateUrl = next && next.startsWith("/") && !next.startsWith("/login") ? next : "/";
    },
    loginError(err) {
      if (!err) return;
      this.loginMessage = err.status === 401 ? "Wrong user or password." : "The server could not be reached.";
    },
    queueSnapshot(snap) {
      if (!snap) return;
      this.tickets = snap.tickets;
      this.seq = snap.seq;
      // open (or move) the stream to the snapshot's position (sse README, "Catching up after a reconnect")
      this.streamToken = this.token;
      this.streamSince = snap.seq;
    },
    sseErrorInfo(info) {
      if (!info) { streamBackoff = 1000; return; }
      // A stream that gave up (an HTTP error: a 502, a 401 from an expired token in the url) is not retried by the
      // browser: reopen it, with a fresh token. Told from errorInfo, not from readyState (sse README).
      if (info.recoverable === false) { if (this.streamUrl) this.scheduleStreamReopen(); return; }
      // A recoverable failure — a drop, or stale-after noticing a stream that died unclosed — is reconnected by the
      // element; move the url to our position so the new stream asks from there.
      if (this.streamUrl && this.streamSince !== this.seq) this.streamSince = this.seq;
    },
    routeName(name) {
      if (name === "login" && this.loggedIn) this.replaceUrl = "/";
      if (name !== "ticket") { this.ticketLive = null; this.actionMessage = ""; this.replyMessage = ""; }
    },
    ticketId(id) {
      this.ticketLive = null; this.actionMessage = ""; this.replyMessage = "";
      this.chatToken = id ? this.token : null;
      this.chatEverConnected = false;
      this.customerTyping = false;
      this.announce();
    },
    chatConnected(connected) {
      if (!connected) return;
      // a reconnect — after a drop, stale-after, a back/forward-cache restore: what was said meanwhile is not
      // replayed, so load the ticket again
      if (this.chatEverConnected) this.reloadTicket();
      this.chatEverConnected = true;
    },
    chatError(err) {
      // auto-reconnect keeps the url, and the token in it may have expired
      if (err && this.chatToken && this.chatToken !== this.token) this.chatToken = this.token;
    },
    draftThrottled(text) {
      if (!this.chatConnected || !text || text === this.lastTypingSent) return;
      this.lastTypingSent = text;
      this.chatOutgoing = { type: "typing" };
    },
    typingSettled() { this.customerTyping = false; },
    offline(off) { if (!off) this.flushOutbox(); },
    loggedIn(yes) { if (yes) this.pollStats(); },
    statsResult(r) {
      if (!r) return;
      if (r.date !== this.todayKey) { this.statsOtherDay = r.date; setTimeout(() => this.pollStats(), 30000); return; }
      this.statsOtherDay = "";
      this.today = { date: r.date, opened: r.opened, closed: r.closed, breached: r.breached };
    },
    todayKey(key, prev) {
      // local midnight: the counters start again, and the server is asked at once
      if (!prev || key === prev) return;
      this.today = { date: key, opened: 0, closed: 0, breached: 0 };
      this.pollStats();
    },
    session(s) { if (s?.token && !this.outboxEmpty) this.flushOutbox(); },
  },

  $on: {
    clockTick: (state) => {
      state.now = Date.now();
      const gap = state.now - lastTickAt;
      lastTickAt = state.now;
      // a 1-second timer that did not fire for 15 s: the laptop slept, the page was frozen, or the tab was
      // throttled. Its ticks do not say how long — the clock does.
      if (gap > 15000) state.onWake(`gap ${Math.round(gap / 1000)} s`);
      state.wallNow = state.now;                      // the wall's time follows the clock; frames interpolate
      state.refreshIfDue();
      state.sampleLoad();
      if (!state.outboxEmpty && state.now - state.lastFlushTry > 30000) state.flushOutbox();
      if (state.now - state.lastAnnounce > 30000) state.announce();
      state.pruneTabs();
    },
    tabMessage: (state, event) => { state.onTabMessage(event.detail); },
    statsTick: (state) => { state.pollStats(); },
    statsResponded: (state, event) => {
      if (event.detail?.status === 401) state.refreshSession().then((ok) => { if (ok) state.pollStats(); });
    },
    wallFrame: (state, event) => {
      state.wallNow = state.wallNow + event.detail.dt;
      state.wallFrames = event.detail.count;
    },
    streamEvent: (state, event) => {
      // each SSE message is its own task: applied one by one, a 10,000-event replay renders 10,000 times
      pendingEvents.push(event.detail);
      if (!flushTimer) flushTimer = setTimeout(() => {
        flushTimer = null;
        const batch = pendingEvents;
        pendingEvents = [];
        state.applyEvents(batch);
      }, 50);
    },
    queueResponded: (state, event) => {
      if (event.detail?.status === 401) state.refreshThen("queue");
    },
    ticketResponded: (state, event) => {
      if (event.detail?.status === 401) state.refreshThen("ticket");
    },
    chatReceived: (state, event) => { state.onChat(event.detail); },
    notificationClicked: (state, event) => {
      const id = event.detail?.data?.ticketId;
      window.focus();
      state.navigateUrl = Number.isInteger(id) ? `/tickets/${id}` : "/";
    },
  },

  // ---------------------------------------------------------------- session actions
  login() {
    const user = this["loginForm.user"].trim();
    if (!user) { this.loginMessage = "Enter your user name."; return; }
    this.loginBody = { user, password: this["loginForm.password"] };
    this.loginRequest = true;
  },
  logout() {
    this.endSession("");
  },
  endSession(message) {
    this.session = null;
    this.tickets = [];
    this.streamToken = null;
    this.streamSince = null;
    this.$command.closeStream.emit();
    this.loginMessage = message;
    const here = location.pathname + location.search;
    this.navigateUrl = message && !here.startsWith("/login") ? "/login?next=" + encodeURIComponent(here) : "/login";
  },
  async refreshSession() {
    if (!refreshing) {
      refreshing = (async () => {
        const refreshToken = this["session.refreshToken"];
        if (!refreshToken) return false;
        try {
          const res = await fetch("/api/refresh", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken }),
          });
          if (res.ok) {
            const body = await res.json();
            this.session = { ...this.session, token: body.token, expiresAt: body.expiresAt };
            return true;
          }
          if (res.status === 401) { this.endSession("Your session ended. Log in again — your drafts are kept."); }
          return false;
        } catch {
          return false;
        } finally {
          refreshing = null;
        }
      })();
    }
    return refreshing;
  },
  refreshIfDue(wait = false) {
    const exp = this["session.expiresAt"];
    if (exp && exp - this.now < 60000) return wait ? this.refreshSession() : (refreshing ? null : this.refreshSession());
    return null;
  },
  async refreshThen(what) {
    if (!(await this.refreshSession())) return;
    await Promise.resolve();
    if (what === "queue") this.$command.reloadQueue.emit();
    if (what === "ticket") this.reloadTicket();
  },
  reloadTicket() {
    const id = this.ticketId;
    if (!id) return;
    this.api("GET", `/api/tickets/${id}`).then((res) => {
      if (res.status === 200 && res.data?.id === this.ticketId) this.ticketResult = res.data;
    });
  },
  async api(method, path, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = this.token;
      let res;
      try {
        res = await fetch(path, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        return { status: 0, data: null };
      }
      if (res.status === 401 && attempt === 0 && (await this.refreshSession())) continue;
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    }
    return { status: 401, data: null };
  },

  // ---------------------------------------------------------------- the stream
  applyEvents(batch) {
    let seq = this.seq;
    const before = new Map(this.tickets.map((t) => [t.id, t]));
    const after = new Map(before);
    const urgent = [];
    const messages = [];
    const log = [];
    for (const message of batch) {
      const id = Number(message.lastEventId);
      if (id && id <= seq) continue;               // replayed: already applied
      if (id) seq = id;
      /** @type {Ticket} */
      const t = message.data;
      if (!t || typeof t.id !== "number") continue;
      if (t.id === this.ticketId) this.ticketLive = t;
      const prev = after.get(t.id);
      if (message.event === "ticket-created" && !prev && t.priority === "urgent") urgent.push(t);
      if (message.event === "ticket-updated" && prev && t.messageCount > prev.messageCount && t.claimedBy === this["session.user"]) messages.push(t);
      if (message.event === "ticket-closed" || t.status !== "open") after.delete(t.id);
      else after.set(t.id, t);
      log.push({ seq: id, text: `${message.event.replace("ticket-", "")} #${t.id} ${t.subject}`, at: this.now });
    }
    if (seq === this.seq && log.length === 0) return;
    this.seq = seq;
    // keep the order of the rows that stay; new tickets go to the end (the queue getter sorts)
    const next = [];
    for (const t of this.tickets) if (after.has(t.id)) next.push(after.get(t.id));
    for (const [id, t] of after) if (!before.has(id)) next.push(t);
    this.tickets = next;
    this.activity = this.activity.concat(log).slice(-CAPS.activity);
    this.notifyBatch(urgent, messages);
  },
  reopenStream() {
    // from where we were: the url carries the position (a new EventSource sends no Last-Event-ID)
    this.streamToken = this.token;
    this.streamSince = this.seq;
    this.$command.closeStream.emit();
    this.streamTrigger = true;
  },
  scheduleStreamReopen() {
    if (streamRetry || !this.loggedIn) return;
    const wait = streamBackoff;
    streamBackoff = Math.min(streamBackoff * 2, 30000);
    streamRetry = setTimeout(async () => {
      streamRetry = null;
      if (!this.loggedIn) return;
      await this.refreshSession();          // it may have been a 401: an EventSource cannot tell
      if (this.loggedIn) this.reopenStream();
    }, wait);
  },

  // ---------------------------------------------------------------- the chat
  onChat(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "typing" && msg.from === "customer") {
      this.customerTyping = true;
      this.typingPulse = this.typingPulse + 1;
      return;
    }
    if (msg.type !== "message") return;
    if (msg.from === "customer") this.customerTyping = false;
    const r = this.ticketResult;
    if (r && r.id === this.ticketId && !r.messages.some((m) => m.id === msg.id)) {
      this.ticketResult = { ...r, messages: r.messages.concat({ id: msg.id, from: msg.from, text: msg.text, at: msg.at }).slice(-CAPS.chatKept) };
    }
    if (msg.from === "customer" && this.pageHidden && r && this["prefs.notifyMessages"]) {
      this.notify(`${r.customer} wrote`, msg.text, r.id);
    }
  },

  // ---------------------------------------------------------------- presence
  async enablePresence() {
    // inside the click: IdleDetector.requestPermission() needs a user gesture
    const [result] = await Promise.all(this.$command.idleRequest.emit());
    if (result !== "granted") { this.appError = "Presence detection was not allowed."; return; }
    await Promise.all(this.$command.idleStart.emit());
  },

  // ---------------------------------------------------------------- several tabs
  announce(hello = false) {
    if (!this.loggedIn) return;
    const me = this["session.user"];
    const claimed = this.tickets.filter((t) => t.claimedBy === me).map((t) => t.id);
    this.lastAnnounce = this.now;
    this.$command.tabPost.emit({ type: hello ? "hello" : "tab", tabId: this.tabId, user: me, open: this.ticketId, claimed });
  },
  onTabMessage(m) {
    if (!m || typeof m !== "object" || m.tabId === this.tabId) return;
    if (m.type === "bye") { this.otherTabs = this.otherTabs.filter((t) => t.tabId !== m.tabId); return; }
    if (m.type !== "tab" && m.type !== "hello") return;
    const entry = { tabId: m.tabId, user: m.user, open: m.open ?? null, claimed: Array.isArray(m.claimed) ? m.claimed : [], at: Date.now() };
    const i = this.otherTabs.findIndex((t) => t.tabId === m.tabId);
    this.otherTabs = i < 0 ? this.otherTabs.concat(entry) : this.otherTabs.with(i, entry);
    if (m.type === "hello") this.announce();
  },
  pruneTabs() {
    const alive = this.otherTabs.filter((t) => this.now - t.at < 90000);
    if (alive.length !== this.otherTabs.length) this.otherTabs = alive;
  },

  // ---------------------------------------------------------------- today
  pollStats() { if (this.loggedIn) this.statsRequest = true; },

  // ---------------------------------------------------------------- the wall
  sampleLoad() {
    const last = this.loadSamples.at(-1);
    if (last && this.now - last.t < 30000) return;
    const keep = this.loadSamples.filter((p) => p.t >= this.now - 3600000).slice(-(CAPS.samples - 1));
    this.loadSamples = keep.concat({ t: this.now, open: this.queue.length });
  },

  // ---------------------------------------------------------------- the outbox
  enqueue(ticketId, text, clientId = crypto.randomUUID()) {
    this.outbox = this.outboxList.concat({ clientId, ticketId, text, at: Date.now() });
  },
  async flushOutbox() {
    if (this.flushing || this.offline || !this.loggedIn || this.outboxEmpty) return;
    this.flushing = true;
    this.lastFlushTry = Date.now();
    try {
      for (const item of this.outboxList) {
        const res = await this.api("POST", `/api/tickets/${item.ticketId}/replies`, { text: item.text, clientId: item.clientId });
        if (res.status === 0 || res.status === 401 || res.status >= 500) break;     // still unreachable — try later
        this.outbox = this.outboxList.filter((o) => o.clientId !== item.clientId);
        if (res.status === 201) this.addSentMessage(item.ticketId, { id: res.data.id, from: this["session.user"], text: item.text, at: res.data.at });
        else this.appError = `A reply to #${item.ticketId} was not sent (${res.status === 409 ? "the ticket is closed" : "HTTP " + res.status}): “${item.text}”`;
      }
    } finally {
      this.flushing = false;
    }
  },
  addSentMessage(ticketId, msg) {
    const r = this.ticketResult;
    if (r && r.id === ticketId && !r.messages.some((m) => m.id === msg.id)) {
      this.ticketResult = { ...r, messages: r.messages.concat(msg) };
    }
  },

  // ---------------------------------------------------------------- notifications
  enableNotifications() { this.$command.requestNotify.emit(); },
  notify(title, body, ticketId) {
    if (!this.canNotify) return;
    this.$command.notify.emit(title, { body, tag: `ticket-${ticketId}`, data: { ticketId } });
  },
  // What arrives in one batch is told in one notification at most per kind; what happened while the laptop slept
  // (older than 2 minutes, or inside the quiet window after a wake) is summed up, not announced ticket by ticket.
  notifyBatch(urgent, messages) {
    if (!this.pageHidden) return;
    const fresh = (t) => this.now - t.createdAt < 120000 && this.now > this.quietUntil;
    if (this["prefs.notifyUrgent"] && urgent.length) {
      const now = urgent.filter(fresh);
      if (now.length === 1) this.notify(`Urgent: ${now[0].subject}`, `#${now[0].id} · ${now[0].customer}`, now[0].id);
      else if (urgent.length > 1 || now.length === 0) this.notify(`${urgent.length} new urgent ticket${urgent.length === 1 ? "" : "s"}`, "Open the queue to see them.", "urgent");
    }
    const msgs = messages.filter((t) => t.id !== this.ticketId);
    if (this["prefs.notifyMessages"] && msgs.length) {
      if (msgs.length === 1) this.notify(`${msgs[0].customer} wrote`, `#${msgs[0].id} ${msgs[0].subject}`, msgs[0].id);
      else this.notify(`${msgs.length} customers wrote`, msgs.map((t) => `#${t.id}`).join(", "), "messages");
    }
  },

  // ---------------------------------------------------------------- waking up
  // After a sleep, a freeze, a back/forward-cache restore or a long hidden spell: the timers did not run, the token
  // may have expired, and what arrived meanwhile has to be caught up. Several of these events come together after one
  // wake; everything here is safe to run twice.
  async onWake(reason) {
    if (!this.loggedIn) return;
    this.wakes = this.wakes + 1;
    this.lastWake = `${reason} at ${new Date().toLocaleTimeString()}`;
    this.now = Date.now();
    this.quietUntil = this.now + 15000;
    await this.refreshIfDue(true);
    if (!this.loggedIn) return;
    if (reason !== "visibilitychange" || !this.sseConnected) this.reopenStream();
    if (this.ticketId) {
      if (this.chatToken !== this.token) this.chatToken = this.token;
      if (!this.chatConnected) this.$command.chatConnect.emit();
      this.reloadTicket();
    }
    this.pollStats();
    this.announce();
    this.flushOutbox();
  },

  // ---------------------------------------------------------------- ticket actions
  async claim() {
    const t = this.ticket;
    if (!t) return;
    this.acting = true;
    this.actionMessage = "";
    const res = await this.api("POST", `/api/tickets/${t.id}/claim`);
    this.acting = false;
    if (res.status === 200) { if (res.data.id === this.ticketId) this.ticketLive = res.data; return; }
    if (res.status === 409) { this.actionMessage = res.data?.by ? `${res.data.by} claimed it first.` : "The ticket is closed."; return; }
    this.actionMessage = res.status === 0 ? "Offline — try again." : `Could not claim (HTTP ${res.status}).`;
  },
  async closeTicket() {
    const t = this.ticket;
    if (!t) return;
    this.acting = true;
    this.actionMessage = "";
    const res = await this.api("POST", `/api/tickets/${t.id}/close`);
    this.acting = false;
    if (res.status === 200) { if (res.data.id === this.ticketId) this.ticketLive = res.data; return; }
    this.actionMessage = res.status === 0 ? "Offline — try again." : `Could not close (HTTP ${res.status}).`;
  },
  async sendReply() {
    const t = this.ticket;
    const text = (this.draft ?? "").trim();
    if (!t || !text || this.sending) return;
    if (this.offline || !this.outboxEmpty) {          // keep the order: behind what already waits
      this.enqueue(t.id, text);
      this.draft = "";
      this.flushOutbox();
      return;
    }
    this.sending = true;
    this.replyMessage = "";
    const clientId = crypto.randomUUID();
    const res = await this.api("POST", `/api/tickets/${t.id}/replies`, { text, clientId });
    this.sending = false;
    if (res.status === 201) {
      this.draft = "";
      this.addSentMessage(t.id, { id: res.data.id, from: this["session.user"], text, at: res.data.at });
      return;
    }
    if (res.status === 0 || res.status >= 500 || (res.status === 401 && this.loggedIn === false)) {
      // unreachable, or the session ended: the outbox sends it again with the same clientId
      this.enqueue(t.id, text, clientId);
      this.draft = "";
      return;
    }
    if (res.status === 422) { this.replyMessage = res.data?.errors?.text ?? "Check the reply."; return; }
    if (res.status === 409) { this.replyMessage = "The ticket is closed."; return; }
    this.replyMessage = `Could not send (HTTP ${res.status}).`;
  },
};
