// The page's root state — one per document, re-created on every boosted navigation (htmx swaps the body).
//
// Every island lives in this one state under its own key (seats/マイリスト at the top, `filter.*` on /events,
// `booking.*` on an event's page) — one root per page, in the body htmx swaps (docs/islands.md). Each boosted
// navigation's root evaluates this module anew (4.20: a later <wcs-state src> imports it under another fragment).
// What the CMS knows about the page (the seats it rendered, the URL's filters, the event's id and prices) comes in
// <script type="application/json" id="page-seed">, read in $connectedCallback.
//
// No wording here: the templates hold every sentence; this state holds values and the flags they switch on.
// Seat and star maps are keyed "e<id>": numeric keys under a plain object cannot be read from the script.
import {
  resizeAttendees, removeAttendeeAt, ticketCount, totalPrice, clampCount, bookingBody, splitErrors, EMPTY_ERRORS,
} from "./booking-core.js";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
function dateLabel(iso) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day}（${WEEK[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday)]}）${p.hour}:${p.minute}`;
}

export default {
    $behavior: { enableMustache: false },

    // ==== マイリスト and 空席 (every page) =============================================================================
    /** The starred event ids — <wcs-storage key="midori-hall:mylist"> (null until it loads, or when empty). */
    /** @type {number[] | null} */
    mylist: null,
    /** Seats by "e<id>": the CMS's snapshot first, then GET /api/seats and the stream. */
    /** @type {Record<string, number>} */
    seats: {},
    /** The stream's latest message (<wcs-sse> `message`). */
    /** @type {{ event: string, data: { id: number, remaining: number }, lastEventId: string } | null} */
    seatMsg: null,
    streamConnected: false,

    get starred() { return Array.isArray(this.mylist) ? this.mylist : []; },
    get starCount() { return this.starred.length; },
    get starCountLabel() { return this.starCount > 0 ? String(this.starCount) : ""; },
    /** @returns {Record<string, boolean>} */
    get soldOut() { return Object.fromEntries(Object.entries(this.seats).map(([k, n]) => [k, n === 0])); },
    /** @returns {Record<string, boolean>} */
    get hasSeats() { return Object.fromEntries(Object.entries(this.seats).map(([k, n]) => [k, n > 0])); },
    /** @returns {Record<string, string>} */
    get starIcon() {
      const on = new Set(this.starred.map((id) => `e${id}`));
      return Object.fromEntries(Object.keys(this.seats).map((k) => [k, on.has(k) ? "★" : "☆"]));
    },
    /** @returns {Record<string, string>} */
    get starPressed() {
      const on = new Set(this.starred.map((id) => `e${id}`));
      return Object.fromEntries(Object.keys(this.seats).map((k) => [k, on.has(k) ? "true" : "false"]));
    },

    toggleStar(e) {
      const el = e.target.closest("[data-event-id]");
      if (!el) return;
      const id = Number(el.dataset.eventId);
      this.mylist = this.starred.includes(id) ? this.starred.filter((x) => x !== id) : [...this.starred, id];
    },

    async refreshSeats() {
      try {
        const res = await fetch("/api/seats");
        if (!res.ok) return;
        const all = await res.json();
        this.seats = { ...this.seats, ...Object.fromEntries(Object.entries(all).map(([id, n]) => [`e${id}`, n])) };
      } catch {
        // offline: the stream's reconnect brings us here again
      }
    },

    // ==== /my ========================================================================================================
    /** The starred events' details (<wcs-fetch> `value`). */
    /** @type {{ id: number, title: string, category: string, date: string, venue: string, remaining: number }[] | null} */
    myEvents: null,
    myLoading: false,
    myError: null,

    get myUrl() {
      return this.starred.length ? `/api/events?ids=${this.starred.toSorted((a, b) => a - b).join(",")}` : "";
    },
    get myRows() {
      const list = Array.isArray(this.myEvents) ? this.myEvents : [];
      const seats = this.seats;
      return list
        .filter((e) => this.starred.includes(e.id))
        .map((e) => ({
          id: e.id, title: e.title, category: e.category, venue: e.venue, href: `/events/${e.id}`,
          dateLabel: dateLabel(e.date), seat: seats[`e${e.id}`] ?? e.remaining, soldOut: (seats[`e${e.id}`] ?? e.remaining) === 0,
        }));
    },
    get myEmpty() { return this.starred.length === 0; },
    get myShowError() { return Boolean(this.myError); },
    get myShowLoading() { return !this.myError && this.myLoading && this.myRows.length === 0; },
    removeStar(e, index) {
      const id = this.myRows[index]?.id;
      if (id != null) this.mylist = this.starred.filter((x) => x !== id);
    },

    // ==== 絞り込み (/events) ===========================================================================================
    // What the URL says (seeded by the CMS). The inputs are bound two-way and are also what htmx sends.
    filter: { q: "", cat: "", from: "", to: "", available: false, sort: "date" },
    get filterCount() {
      return [this["filter.cat"], this["filter.from"], this["filter.to"], this["filter.available"]].filter(Boolean).length
        + (this["filter.sort"] === "title" ? 1 : 0);
    },
    get filterNone() { return this.filterCount === 0; },
    get filterHasDates() { return Boolean(this["filter.from"] || this["filter.to"]); },
    get filterSortTitle() { return this["filter.sort"] === "title"; },
    get filterInvalid() {
      const from = this["filter.from"];
      const to = this["filter.to"];
      return Boolean(from && to && from > to);
    },
    // the form carries data-invalid while the range is impossible (null removes the attribute)
    get filterInvalidAttr() { return this.filterInvalid ? "1" : null; },

    // ==== 予約 (an event's page; the markup comes in the htmx fragment /events/:id/booking) ===========================
    booking: {
      eventId: 0,
      prices: { adult: 0, child: 0, senior: 0 },
      tickets: { adult: 0, child: 0, senior: 0 },
      /** @type {{ key: string, type: string, name: string, error: string }[]} */
      attendees: [],
      /** @type {Record<string, { key: string, type: string, name: string, error: string }[]>} */
      stash: {},
      form: { name: "", phone: "", email: "" },
      errors: { name: "", phone: "", email: "", tickets: "", attendees: "" },
      /** "idle" | "sending" | "done" | "soldout" | "failed" */
      status: "idle",
      /** 409: the seats the server says are left; failed: the HTTP status (0 = no response) */
      remainingLeft: 0,
      failCode: 0,
      result: { id: "", total: 0 },
    },

    // The selects write strings; a path accessor pair per ticket type turns them into counts and resizes the names.
    get "booking.adultCount"() { return String(this["booking.tickets.adult"]); },
    set "booking.adultCount"(v) { this.bookingSetCount("adult", v); },
    get "booking.childCount"() { return String(this["booking.tickets.child"]); },
    set "booking.childCount"(v) { this.bookingSetCount("child", v); },
    get "booking.seniorCount"() { return String(this["booking.tickets.senior"]); },
    set "booking.seniorCount"(v) { this.bookingSetCount("senior", v); },

    get "booking.count"() {
      return ticketCount({ adult: this["booking.tickets.adult"], child: this["booking.tickets.child"], senior: this["booking.tickets.senior"] });
    },
    get "booking.total"() {
      return totalPrice(
        { adult: this["booking.tickets.adult"], child: this["booking.tickets.child"], senior: this["booking.tickets.senior"] },
        { adult: this["booking.prices.adult"], child: this["booking.prices.child"], senior: this["booking.prices.senior"] },
      );
    },
    get "booking.hasTickets"() { return this["booking.count"] > 0; },
    get "booking.sending"() { return this["booking.status"] === "sending"; },
    get "booking.notSending"() { return this["booking.status"] !== "sending"; },
    get "booking.done"() { return this["booking.status"] === "done"; },
    get "booking.soldOutAll"() { return this["booking.status"] === "soldout" && this["booking.remainingLeft"] === 0; },
    get "booking.soldOutSome"() { return this["booking.status"] === "soldout" && this["booking.remainingLeft"] > 0; },
    get "booking.failedOffline"() { return this["booking.status"] === "failed" && this["booking.failCode"] === 0; },
    get "booking.failedServer"() { return this["booking.status"] === "failed" && this["booking.failCode"] !== 0; },
    // hall.js asks before leaving a half-filled form; it reads this attribute (null removes it)
    get "booking.dirty"() {
      if (this["booking.status"] === "done") return false;
      return this["booking.count"] > 0 || this["booking.form.name"] !== "" || this["booking.form.phone"] !== "" || this["booking.form.email"] !== "";
    },
    get "booking.dirtyAttr"() { return this["booking.dirty"] ? "1" : null; },
    get "booking.nameInvalid"() { return this["booking.errors.name"] ? "true" : null; },
    get "booking.phoneInvalid"() { return this["booking.errors.phone"] ? "true" : null; },
    get "booking.emailInvalid"() { return this["booking.errors.email"] ? "true" : null; },
    get "booking.attendees.*.number"() { return this.$1 + 1; },
    get "booking.attendees.*.notAdult"() { return this["booking.attendees.*.type"] !== "adult"; },
    get "booking.attendees.*.notChild"() { return this["booking.attendees.*.type"] !== "child"; },
    get "booking.attendees.*.notSenior"() { return this["booking.attendees.*.type"] !== "senior"; },
    get "booking.attendees.*.inputId"() { return `attendee-${this["booking.attendees.*.key"]}`; },
    get "booking.attendees.*.errorId"() { return `attendee-${this["booking.attendees.*.key"]}-error`; },
    get "booking.attendees.*.invalid"() { return this["booking.attendees.*.error"] ? "true" : null; },
    // what the root knows that the form does not: the live seats
    get bookingSoldOut() { return this.soldOut[`e${this["booking.eventId"]}`] === true; },
    get bookingBlocked() { return this.bookingSoldOut || this["booking.sending"] || !this["booking.hasTickets"]; },

    bookingSetCount(type, v) {
      const n = clampCount(v);
      const next = resizeAttendees(this["booking.attendees"], this["booking.stash"], type, n);
      this[`booking.tickets.${type}`] = n;
      this["booking.attendees"] = next.attendees;
      this["booking.stash"] = next.stash;
      this["booking.errors.tickets"] = "";
      this["booking.errors.attendees"] = "";
    },
    bookingRemoveAttendee(e, index) {
      const next = removeAttendeeAt(this["booking.attendees"], this["booking.tickets"], index);
      this["booking.attendees"] = next.attendees;
      this["booking.tickets"] = next.tickets;
    },
    async bookingSubmit() {
      if (this["booking.status"] === "sending" || this["booking.count"] === 0) return;   // a second click while sending does nothing
      this["booking.status"] = "sending";
      this["booking.errors"] = { ...EMPTY_ERRORS };
      const attendees = this["booking.attendees"];
      for (let i = 0; i < attendees.length; i++) this[`booking.attendees.${i}.error`] = "";
      const body = bookingBody(this["booking.eventId"], this["booking.tickets"], this["booking.attendees"], this["booking.form"]);
      let res;
      try {
        res = await fetch("/api/bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      } catch {
        this["booking.failCode"] = 0;
        this["booking.status"] = "failed";
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        this["booking.result"] = { id: String(data.id), total: Number(data.total) };
        this["booking.status"] = "done";
      } else if (res.status === 422) {
        const { form, attendees: perRow } = splitErrors(data.errors);
        this["booking.errors"] = { ...EMPTY_ERRORS, ...form };
        const n = this["booking.attendees"].length;
        perRow.forEach((msg, i) => { if (i < n) this[`booking.attendees.${i}.error`] = msg; });
        this["booking.status"] = "idle";
      } else if (res.status === 409) {
        this["booking.remainingLeft"] = Number(data.remaining) || 0;
        this["booking.status"] = "soldout";
      } else {
        this["booking.failCode"] = res.status;
        this["booking.status"] = "failed";
      }
    },
    bookingAgain() {
      this["booking.tickets"] = { adult: 0, child: 0, senior: 0 };
      this["booking.attendees"] = [];
      this["booking.stash"] = {};
      this["booking.form"] = { name: "", phone: "", email: "" };
      this["booking.errors"] = { ...EMPTY_ERRORS };
      this["booking.status"] = "idle";
    },

    // ==== lifecycle ===================================================================================================
    $connectedCallback() {
      const el = document.getElementById("page-seed");
      if (!el) return;
      const seed = JSON.parse(el.textContent);
      if (seed.seats) this.seats = seed.seats;
      if (seed.filter) this.filter = { ...this.filter, ...seed.filter };
      if (seed.booking) {
        this["booking.eventId"] = seed.booking.eventId;
        this["booking.prices"] = seed.booking.prices;
      }
    },

    $watch: {
      seatMsg(msg) {
        if (msg && msg.event === "seats" && msg.data) {
          this.seats = { ...this.seats, [`e${msg.data.id}`]: msg.data.remaining };
        }
      },
      // (re)connected — after a server restart the changes made while the stream was down are not replayed
      streamConnected(connected) {
        if (connected) this.refreshSeats();
      },
    },
};
