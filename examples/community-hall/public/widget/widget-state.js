// State of one 予約ウィジェット (the root of the widget's shadow root), loaded as
// <wcs-state src="<hall>/widget/widget-state.js?event=12">: the event comes from the module URL's query, the API is
// the origin this module was loaded from (the hall). Since 4.20 each <wcs-state src> evaluates the module, so two
// widgets — even for the same event — never share one state.
import {
  resizeAttendees, removeAttendeeAt, ticketCount, totalPrice, clampCount, bookingBody, splitErrors, EMPTY_ERRORS,
} from "../js/booking-core.js";

const SELF = new URL(import.meta.url);
const EVENT_ID = Number(SELF.searchParams.get("event"));
const API = SELF.origin;

export default {
    $behavior: { enableMustache: false },

    eventId: EVENT_ID,
    /** "loading" | "ready" | "error" */
    load: "loading",
    prices: { adult: 0, child: 0, senior: 0 },
    remaining: 0,
    /** @type {{ event: string, data: { id: number, remaining: number }, lastEventId: string } | null} */
    seatMsg: null,
    streamConnected: false,
    streamWasUp: false,

    tickets: { adult: 0, child: 0, senior: 0 },
    /** @type {{ key: string, type: string, name: string, error: string }[]} */
    attendees: [],
    /** @type {Record<string, { key: string, type: string, name: string, error: string }[]>} */
    stash: {},
    form: { name: "", phone: "", email: "" },
    errors: { name: "", phone: "", email: "", tickets: "", attendees: "" },
    /** "idle" | "sending" | "done" | "soldout" | "failed" */
    status: "idle",
    remainingLeft: 0,
    failCode: 0,
    result: { id: "", total: 0 },

    get loading() { return this.load === "loading"; },
    get loadFailed() { return this.load === "error"; },
    get ready() { return this.load === "ready"; },
    get soldOut() { return this.load === "ready" && this.remaining === 0; },
    get streamLost() { return this.streamWasUp && !this.streamConnected; },
    get hasSeats() { return this.remaining > 0; },
    get streamUrl() { return `${API}/api/seats/stream`; },

    get adultCount() { return String(this["tickets.adult"]); },
    set adultCount(v) { this.setCount("adult", v); },
    get childCount() { return String(this["tickets.child"]); },
    set childCount(v) { this.setCount("child", v); },
    get seniorCount() { return String(this["tickets.senior"]); },
    set seniorCount(v) { this.setCount("senior", v); },

    get count() { return ticketCount({ adult: this["tickets.adult"], child: this["tickets.child"], senior: this["tickets.senior"] }); },
    get total() {
      return totalPrice(
        { adult: this["tickets.adult"], child: this["tickets.child"], senior: this["tickets.senior"] },
        { adult: this["prices.adult"], child: this["prices.child"], senior: this["prices.senior"] },
      );
    },
    get hasTickets() { return this.count > 0; },
    get sending() { return this.status === "sending"; },
    get notSending() { return this.status !== "sending"; },
    get done() { return this.status === "done"; },
    get soldOutAll() { return this.status === "soldout" && this.remainingLeft === 0; },
    get soldOutSome() { return this.status === "soldout" && this.remainingLeft > 0; },
    get failedOffline() { return this.status === "failed" && this.failCode === 0; },
    get failedServer() { return this.status === "failed" && this.failCode !== 0; },
    get blocked() { return this.soldOut || this.status === "sending" || this.count === 0; },
    get nameInvalid() { return this["errors.name"] ? "true" : null; },
    get phoneInvalid() { return this["errors.phone"] ? "true" : null; },
    get emailInvalid() { return this["errors.email"] ? "true" : null; },
    get "attendees.*.number"() { return this.$1 + 1; },
    get "attendees.*.notAdult"() { return this["attendees.*.type"] !== "adult"; },
    get "attendees.*.notChild"() { return this["attendees.*.type"] !== "child"; },
    get "attendees.*.notSenior"() { return this["attendees.*.type"] !== "senior"; },
    get "attendees.*.inputId"() { return `w${EVENT_ID}-attendee-${this["attendees.*.key"]}`; },
    get "attendees.*.invalid"() { return this["attendees.*.error"] ? "true" : null; },

    setCount(type, v) {
      const n = clampCount(v);
      const next = resizeAttendees(this.attendees, this.stash, type, n);
      this[`tickets.${type}`] = n;
      this.attendees = next.attendees;
      this.stash = next.stash;
      this["errors.tickets"] = "";
      this["errors.attendees"] = "";
    },
    removeAttendee(e, index) {
      const next = removeAttendeeAt(this.attendees, this.tickets, index);
      this.attendees = next.attendees;
      this.tickets = next.tickets;
    },

    async loadEvent() {
      try {
        const res = await fetch(`${API}/api/events/${EVENT_ID}`);
        if (!res.ok) throw new Error(String(res.status));
        const ev = await res.json();
        this.prices = ev.prices;
        this.remaining = ev.remaining;
        this.load = "ready";
      } catch {
        this.load = "error";
      }
    },
    retryLoad() {
      this.load = "loading";
      this.loadEvent();
    },

    async submit() {
      if (this.status === "sending" || this.count === 0) return;
      this.status = "sending";
      this.errors = { ...EMPTY_ERRORS };
      for (let i = 0; i < this.attendees.length; i++) this[`attendees.${i}.error`] = "";
      const body = bookingBody(EVENT_ID, this.tickets, this.attendees, this.form);
      let res;
      try {
        res = await fetch(`${API}/api/bookings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      } catch {
        this.failCode = 0;
        this.status = "failed";
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        this.result = { id: String(data.id), total: Number(data.total) };
        this.status = "done";
      } else if (res.status === 422) {
        const { form, attendees } = splitErrors(data.errors);
        this.errors = { ...EMPTY_ERRORS, ...form };
        attendees.forEach((msg, i) => { if (i < this.attendees.length) this[`attendees.${i}.error`] = msg; });
        this.status = "idle";
      } else if (res.status === 409) {
        this.remainingLeft = Number(data.remaining) || 0;
        this.status = "soldout";
      } else {
        this.failCode = res.status;
        this.status = "failed";
      }
    },
    again() {
      this.tickets = { adult: 0, child: 0, senior: 0 };
      this.attendees = [];
      this.stash = {};
      this.form = { name: "", phone: "", email: "" };
      this.errors = { ...EMPTY_ERRORS };
      this.status = "idle";
    },

    $connectedCallback() {
      this.loadEvent();
    },

    $watch: {
      seatMsg(msg) {
        if (msg && msg.event === "seats" && msg.data && msg.data.id === EVENT_ID) this.remaining = msg.data.remaining;
      },
      streamConnected(connected) {
        if (connected) this.streamWasUp = true;
        if (connected && this.load !== "loading") this.loadEvent();
      },
    },
};
