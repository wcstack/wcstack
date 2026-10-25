// prod-booking v1 — the root state (<wcs-state src="state.js">), as it shipped on @wcstack/* 4.6.2.
// The lines marked "4.6.2:" are what that release needed and 4.7 made unnecessary (v2 has none of them).
const endOf = (start) => String(Number(start.slice(0, 2)) + 1).padStart(2, "0") + ":00";
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

export default {
  // what the split auto entry loads before this state is built (the other entries check it)
  $features: ["temporal", "formats"],

  appVersion: "v1",
  versionTick: 0,
  /** @type {{ app: string } | null} */
  versionInfo: null,
  timer: null,
  today: "",
  tomorrow: "",

  // <wcs-router> outputs and write surface
  routeParams: {},
  routeName: "",
  navigateUrl: null,

  // the rooms; <wcs-fetch>'s value starts as null (the element's own), so read them through roomList
  /** @type {{ id: number, name: string, capacity: number, pricePerHour: number, currency: string, equipment: string[] }[] | null} */
  rooms: null,
  roomsLoading: false,
  roomsError: null,

  // the room page
  /** @type {{ date: string, slots: { start: string, end: string, booked: boolean }[] } | null} */
  slotsData: null,
  slotsError: null,
  rev: 0,
  calendar: { date: "", slots: [], selected: null },
  form: { title: "" },
  createBody: null,
  createTrigger: false,
  createError: null,
  createStatus: 0,
  creating: false,

  // my bookings
  /** @type {{ id: number, roomId: number, date: string, start: string, end: string, title: string }[] | null} */
  myBookings: null,
  cancelId: null,
  cancelTrigger: false,

  // preferences, kept by <wcs-storage key="booking.prefs">: { dayView, currency }. The setters keep the keys
  // they do not know, so what a later version adds survives a write from this one.
  /** @type {{ dayView?: string, currency?: string } | null} */
  prefsStored: null,

  // admin session, kept by <wcs-storage key="booking.admin"> (the guard reads localStorage directly)
  /** @type {{ token: string } | null} */
  adminSession: null,
  /** @type {{ bookings: number, rooms: number } | null} */
  adminStats: null,

  // ---------------------------------------------------------------- derived
  get roomList() { return this.rooms ?? []; },
  get roomsSummary() { return this.roomList.length + " rooms"; },
  get roomId() { return this["routeParams.id"] ?? null; },
  get room() {
    const id = this.roomId;
    return this.roomList.find((r) => r.id === id) ?? null;
  },
  get roomName() { return this.room ? this.room.name : ""; },
  get roomCapacity() { return this.room ? this.room.capacity : 0; },
  get "roomList.*.href"() { return "/rooms/" + this["roomList.*.id"]; },

  get dayView() { return this["prefsStored.dayView"] ?? "today"; },
  set dayView(v) { this.prefsStored = { ...(this.prefsStored ?? {}), dayView: v }; },
  get currencyShown() { return this["prefsStored.currency"] ?? "JPY"; },
  set currencyShown(v) { this.prefsStored = { ...(this.prefsStored ?? {}), currency: v }; },

  get selectedDate() { return this.dayView === "tomorrow" ? this.tomorrow : this.today; },
  // null until $connectedCallback has set the day (4.6.2: the date filter threw on it — index.html wraps it in if:)
  get selectedDateObj() { return this.selectedDate ? new Date(this.selectedDate + "T00:00:00") : null; },

  get slotsUrl() {
    if (this.routeName !== "room" || this.roomId == null || !this.selectedDate) return null;
    return "api/rooms/" + this.roomId + "/slots?date=" + this.selectedDate + "&rev=" + this.rev;
  },
  get myBookingsUrl() { return this.routeName === "bookings" ? "api/bookings?mine=1&rev=" + this.rev : null; },
  get cancelUrl() { return this.cancelId == null ? null : "api/bookings/" + this.cancelId; },
  get versionUrl() { return "api/version?t=" + this.versionTick; },
  get serverVersion() { return this["versionInfo.app"] ?? ""; },
  get updateAvailable() {
    const deployed = this["versionInfo.app"];
    return !!deployed && deployed !== this.appVersion;
  },

  get bookingRows() {
    const rooms = this.roomList;
    return (this.myBookings ?? []).map((b) => ({
      id: b.id, title: b.title, start: b.start, end: b.end,
      when: new Date(b.date + "T00:00:00"),
      roomName: (rooms.find((r) => r.id === b.roomId) ?? { name: "#" + b.roomId }).name,
    }));
  },
  get noBookings() { return this.bookingRows.length === 0; },

  /** @returns {{ title?: string, start?: string }} */
  get fieldErrors() {
    const e = this.createError;
    if (!e || !e.body) return {};
    try { return JSON.parse(e.body).errors ?? {}; } catch { return {}; }
  },
  get createMessage() {
    const s = this.createStatus;
    if (s === 201) return "Booked.";
    if (s === 409) return "That slot is already taken.";
    if (s === 422) return "Please fix the fields marked.";
    if (s >= 500) return "The server failed (" + s + "). Try again.";
    if (s === 0 && this.createError) return "Network error. Try again.";
    return "";
  },
  get selectedLabel() { return this["calendar.selected"] ?? "none"; },

  get authHeader() { const t = this["adminSession.token"]; return t ? "Bearer " + t : null; },
  get adminStatsUrl() { return this.routeName === "admin" && this["adminSession.token"] ? "api/admin/stats" : null; },

  // ---------------------------------------------------------------- handlers
  book() {
    const start = this["calendar.selected"];
    this.createBody = {
      roomId: this.roomId, date: this.selectedDate, start, end: start ? endOf(start) : null,
      title: this["form.title"],
    };
    this.createTrigger = true;
  },
  cancel() {
    this.cancelId = this["bookingRows.*.id"];
    this.cancelTrigger = true;
  },
  async login() {
    this.adminSession = { token: "admin" };
    await new Promise((r) => setTimeout(r, 0));   // <wcs-storage> saves it before the guard reads it
    this.navigateUrl = "/admin";
  },
  logout() { this.adminSession = null; this.adminStats = null; },
  // 4.6.2: <wcs-router> took a reload the page asked for as a route change — take the router out first
  reload() { document.querySelector("wcs-router")?.remove(); location.reload(); },

  $watch: {
    slotsData(cur) {
      this.calendar = { date: cur ? cur.date : "", slots: cur ? cur.slots : [], selected: null };
    },
    createTrigger(cur, prev) {
      if (prev === true && cur === false) {
        if (this.createStatus === 201) this["form.title"] = "";
        this.rev = this.rev + 1;
      }
    },
    cancelTrigger(cur, prev) {
      if (prev === true && cur === false) this.rev = this.rev + 1;
    },
  },

  $connectedCallback() {
    const now = new Date();
    this.today = ymd(now);
    this.tomorrow = ymd(new Date(now.getTime() + 86400000));
    this.timer = setInterval(() => { this.versionTick = this.versionTick + 1; }, 3000);
  },
  $disconnectedCallback() { clearInterval(this.timer); },
};
