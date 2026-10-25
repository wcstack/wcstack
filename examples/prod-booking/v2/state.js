// prod-booking v2 — the root state (<wcs-state src="state.js">).
// New in v2: attendees on a booking (with a default kept in the preferences) and the /help route.
const endOf = (start) => String(Number(start.slice(0, 2)) + 1).padStart(2, "0") + ":00";
const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

export default {
  // what the split auto entry loads before this state is built (the other entries check it)
  $features: ["temporal", "formats"],

  appVersion: "v2",
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
  form: { title: "", attendees: 1 },
  createBody: null,
  createTrigger: false,
  createError: null,
  createStatus: 0,
  creating: false,

  // my bookings
  /** @type {{ id: number, roomId: number, date: string, start: string, end: string, title: string, attendees?: number }[] | null} */
  myBookings: null,
  cancelId: null,
  cancelTrigger: false,

  // preferences, kept by <wcs-storage key="booking.prefs">. v1 stored { dayView, currency }; v2 keeps those
  // keys and adds { version: 2, attendees }, so a v1 tab still open during the deploy reads what v2 writes,
  // and v2 keeps what v1 writes (docs/seam-apps.md, prod-booking: a stored value outlives a deploy).
  /** @type {{ version?: number, dayView?: string, currency?: string, attendees?: number } | null} */
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
  set dayView(v) { this.prefsStored = { ...(this.prefsStored ?? {}), version: 2, dayView: v }; },
  get currencyShown() { return this["prefsStored.currency"] ?? "JPY"; },
  set currencyShown(v) { this.prefsStored = { ...(this.prefsStored ?? {}), version: 2, currency: v }; },
  get defaultAttendees() { return this["prefsStored.attendees"] ?? 1; },
  set defaultAttendees(v) { this.prefsStored = { ...(this.prefsStored ?? {}), version: 2, attendees: v }; },

  get selectedDate() { return this.dayView === "tomorrow" ? this.tomorrow : this.today; },
  // null until $connectedCallback has set the day: the date filter renders nothing for it (4.7)
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
      id: b.id, title: b.title, start: b.start, end: b.end, attendees: b.attendees ?? null,
      when: new Date(b.date + "T00:00:00"),
      roomName: (rooms.find((r) => r.id === b.roomId) ?? { name: "#" + b.roomId }).name,
    }));
  },
  get noBookings() { return this.bookingRows.length === 0; },

  /** @returns {{ title?: string, start?: string, attendees?: string }} */
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
      title: this["form.title"], attendees: this["form.attendees"],
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
  reload() { location.reload(); },

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
    defaultAttendees(cur) { this["form.attendees"] = cur; },
  },

  $connectedCallback() {
    const now = new Date();
    this.today = ymd(now);
    this.tomorrow = ymd(new Date(now.getTime() + 86400000));
    this.timer = setInterval(() => { this.versionTick = this.versionTick + 1; }, 3000);
  },
  $disconnectedCallback() { clearInterval(this.timer); },
};
