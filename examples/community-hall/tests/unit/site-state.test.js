// The root state of the hall's pages (public/js/site.js), headless: @wcstack/testing mounts markup like the
// templates' and drives it through the state and DOM events.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, settle, fire } from "@wcstack/testing";

const resolveModule = (url) => new URL("../../public" + url.pathname, import.meta.url);
const seed = (data) => `<script type="application/json" id="page-seed">${JSON.stringify(data)}</script>`;

let app;
afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.unstubAllGlobals();
});

const CARD = (id) => `
  <li class="card" data-event-id="${id}">
    <span class="seats" data-wcs="class.soldout: soldOut.e${id}">
      <span class="left" data-wcs="hidden: soldOut.e${id}">残り <b data-wcs="textContent: seats.e${id}"></b> 席</span>
      <span class="full" data-wcs="hidden: hasSeats.e${id}">満席</span>
    </span>
    <button type="button" class="star" data-wcs="onclick: toggleStar; textContent: starIcon.e${id}; attr.aria-pressed: starPressed.e${id}">☆</button>
  </li>`;

describe("マイリスト and 空席", () => {
  it("stars a card, counts it, and shows the seats the page was given", async () => {
    app = await mount(`${seed({ seats: { e1: 5, e2: 0 } })}
      <wcs-state src="/js/site.js"></wcs-state>
      <span id="count" data-wcs="textContent: starCountLabel"></span>
      <ul>${CARD(1)}${CARD(2)}</ul>`, { resolveModule });
    await settle();
    const card1 = app.root.querySelector('[data-event-id="1"]');
    const card2 = app.root.querySelector('[data-event-id="2"]');
    expect(card1.querySelector("b").textContent).toBe("5");
    expect(card2.querySelector(".seats").classList.contains("soldout")).toBe(true);
    expect(card2.querySelector(".left").hidden).toBe(true);
    expect(card2.querySelector(".full").hidden).toBe(false);

    fire(card1.querySelector(".star"), "click");
    await settle();
    expect(card1.querySelector(".star").textContent).toBe("★");
    expect(card1.querySelector(".star").getAttribute("aria-pressed")).toBe("true");
    expect(app.root.querySelector("#count").textContent).toBe("1");
    expect(app.state().read((s) => s.mylist)).toEqual([1]);

    fire(card1.querySelector(".star"), "click");
    await settle();
    expect(app.root.querySelector("#count").textContent).toBe("");
  });

  it("applies the stream's seat messages, and refetches the seats when the stream (re)connects", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ 1: 9, 2: 4 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    app = await mount(`${seed({ seats: { e1: 5, e2: 0 } })}
      <wcs-state src="/js/site.js"></wcs-state><ul>${CARD(1)}${CARD(2)}</ul>`, { resolveModule });
    await app.state().write((s) => { s.seatMsg = { event: "seats", data: { id: 1, remaining: 0 }, lastEventId: "" }; });
    await settle();
    const card1 = app.root.querySelector('[data-event-id="1"]');
    expect(card1.querySelector(".full").hidden).toBe(false);

    await app.state().write((s) => { s.streamConnected = true; });
    await settle(); await settle();
    expect(fetchMock).toHaveBeenCalledWith("/api/seats");
    expect(card1.querySelector("b").textContent).toBe("9");
    expect(app.root.querySelector('[data-event-id="2"] .left').hidden).toBe(false);
  });
});

describe("/my", () => {
  it("lists only the events still starred, and removes one", async () => {
    app = await mount(`${seed({ seats: { e1: 5, e3: 2 } })}
      <wcs-state src="/js/site.js"></wcs-state>
      <ul id="list"><template data-wcs="for: myRows"><li class="row"><span class="t" data-wcs="textContent: .title"></span>
        <b data-wcs="textContent: .seat"></b><button class="rm" data-wcs="onclick: removeStar">外す</button></li></template></ul>
      <p id="empty" data-wcs="hidden: myEmpty|not">empty</p>`, { resolveModule });
    expect(app.state().read((s) => s.myUrl)).toBe("");
    await app.state().write((s) => { s.mylist = [3, 1]; });
    await settle();
    expect(app.state().read((s) => s.myUrl)).toBe("/api/events?ids=1,3");
    await app.state().write((s) => {
      s.myEvents = [
        { id: 1, title: "ピアノ", category: "音楽", date: "2026-12-01T14:00:00+09:00", venue: "大ホール", remaining: 5 },
        { id: 3, title: "工作", category: "子ども", date: "2026-12-02T10:00:00+09:00", venue: "小ホール", remaining: 2 },
      ];
    });
    await settle();
    expect([...app.root.querySelectorAll(".row .t")].map((e) => e.textContent)).toEqual(["ピアノ", "工作"]);
    fire(app.root.querySelectorAll(".rm")[0], "click");
    await settle();
    expect(app.state().read((s) => s.mylist)).toEqual([3]);
    expect([...app.root.querySelectorAll(".row .t")].map((e) => e.textContent)).toEqual(["工作"]);
  });
});

describe("絞り込み", () => {
  it("is seeded from the URL, counts the filters and flags an impossible range", async () => {
    app = await mount(`${seed({ seats: {}, filter: { q: "", cat: "音楽", from: "2026-12-10", to: "", available: true, sort: "date" } })}
      <wcs-state src="/js/site.js"></wcs-state>
      <form id="f" data-wcs="attr.data-invalid: filterInvalidAttr">
        <input type="radio" name="cat" value="" data-wcs="radio: filter.cat"><input type="radio" name="cat" value="音楽" data-wcs="radio: filter.cat">
        <input id="from" type="date" data-wcs="value: filter.from"><input id="to" type="date" data-wcs="value: filter.to">
      </form>`, { resolveModule });
    await settle();
    expect(app.root.querySelector('input[value="音楽"]').checked).toBe(true);
    expect(app.root.querySelector("#from").value).toBe("2026-12-10");
    expect(app.state().read((s) => s.filterCount)).toBe(3);
    const to = app.root.querySelector("#to");
    to.value = "2026-12-01";
    fire(to, "input");
    await settle();
    expect(app.state().read((s) => s.filterInvalid)).toBe(true);
    expect(app.root.querySelector("#f").getAttribute("data-invalid")).toBe("1");
  });
});

const BOOKING = `
  <form id="bf" data-wcs="onsubmit#prevent: bookingSubmit; attr.data-dirty: booking.dirtyAttr">
    <select id="adult" data-wcs="value: booking.adultCount">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}</option>`).join("")}</select>
    <select id="child" data-wcs="value: booking.childCount">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}">${n}</option>`).join("")}</select>
    <p id="total"><!--@@: booking.total|locale--></p>
    <ol id="names"><template data-wcs="for: booking.attendees"><li><input class="n" data-wcs="value: .name">
      <span class="err" data-wcs="textContent: .error"></span><button type="button" class="rm" data-wcs="onclick: bookingRemoveAttendee">x</button></li></template></ol>
    <input id="name" data-wcs="value: booking.form.name"><input id="phone" data-wcs="value: booking.form.phone"><input id="email" data-wcs="value: booking.form.email">
    <span id="phone-err" data-wcs="textContent: booking.errors.phone"></span>
    <p id="some" data-wcs="hidden: booking.soldOutSome|not">残り <!--@@: booking.remainingLeft--> 席</p>
    <button id="send" type="submit" data-wcs="disabled: bookingBlocked">予約する</button>
  </form>
  <p id="done" data-wcs="hidden: booking.done|not"><b id="bid" data-wcs="textContent: booking.result.id"></b></p>`;

async function mountBooking(seats = { e7: 10 }) {
  return mount(`${seed({ seats, booking: { eventId: 7, prices: { adult: 1500, child: 500, senior: 1000 } } })}
    <wcs-state src="/js/site.js"></wcs-state>${BOOKING}`, { resolveModule });
}
function choose(select, value) {
  select.value = String(value);
  fire(select, "change");
}
function type(input, value) {
  input.value = value;
  fire(input, "input");
}

describe("予約", () => {
  it("adds name fields as counts change, totals, keeps names when one in the middle is removed", async () => {
    app = await mountBooking();
    const root = app.root;
    expect(root.querySelector("#send").disabled).toBe(true);
    choose(root.querySelector("#adult"), 3);
    await settle();
    choose(root.querySelector("#child"), 1);
    await settle();
    expect(root.querySelector("#total").textContent).toBe("5,000");
    let names = [...root.querySelectorAll(".n")];
    expect(names).toHaveLength(4);
    ["一", "二", "三", "子"].forEach((v, i) => type(names[i], v));
    await settle();
    expect(root.querySelector("#bf").getAttribute("data-dirty")).toBe("1");

    fire(root.querySelectorAll(".rm")[1], "click");
    await settle();
    names = [...root.querySelectorAll(".n")];
    expect(names.map((n) => n.value)).toEqual(["一", "三", "子"]);
    expect(root.querySelector("#adult").value).toBe("2");
    expect(root.querySelector("#total").textContent).toBe("3,500");

    choose(root.querySelector("#adult"), 1);
    await settle();
    choose(root.querySelector("#adult"), 2);
    await settle();
    expect([...root.querySelectorAll(".n")].map((n) => n.value)).toEqual(["一", "三", "子"]);
    expect(root.querySelector("#send").disabled).toBe(false);
  });

  it("shows the 422 errors by their fields, then confirms; a second submit while sending does nothing", async () => {
    let resolveFirst;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ id: "MH-7", total: 1500 }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    app = await mountBooking();
    const root = app.root;
    choose(root.querySelector("#adult"), 1);
    await settle();
    type(root.querySelector("#name"), "太郎");
    type(root.querySelector("#phone"), "12");
    type(root.querySelector("#email"), "t@example.jp");
    await settle();
    fire(root.querySelector("#bf"), "submit");
    fire(root.querySelector("#bf"), "submit");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(root.querySelector("#send").disabled).toBe(true);
    resolveFirst(new Response(JSON.stringify({ errors: { phone: "電話番号の形式が正しくありません", "attendees.0": "参加者のお名前を入力してください" } }), { status: 422 }));
    await settle(); await settle();
    expect(root.querySelector("#phone-err").textContent).toBe("電話番号の形式が正しくありません");
    expect(root.querySelector(".err").textContent).toBe("参加者のお名前を入力してください");

    type(root.querySelector(".n"), "太郎");
    type(root.querySelector("#phone"), "0277-12-3456");
    await settle();
    fire(root.querySelector("#bf"), "submit");
    await settle(); await settle();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ eventId: 7, attendees: ["太郎"], phone: "0277-12-3456" });
    expect(root.querySelector("#done").hidden).toBe(false);
    expect(root.querySelector("#bid").textContent).toBe("MH-7");
    expect(root.querySelector("#bf").hasAttribute("data-dirty")).toBe(false);
  });

  it("says how many seats are left on a 409, and blocks the button when the event sells out live", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "sold-out", remaining: 1 }), { status: 409 })));
    app = await mountBooking();
    const root = app.root;
    choose(root.querySelector("#adult"), 2);
    await settle();
    fire(root.querySelector("#bf"), "submit");
    await settle(); await settle();
    expect(root.querySelector("#some").hidden).toBe(false);
    expect(root.querySelector("#some").textContent).toContain("1");
    await app.state().write((s) => { s.seatMsg = { event: "seats", data: { id: 7, remaining: 0 }, lastEventId: "" }; });
    await settle();
    expect(root.querySelector("#send").disabled).toBe(true);
  });
});
