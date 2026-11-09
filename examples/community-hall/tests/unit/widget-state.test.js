// The partner widget's state (public/widget/widget-state.js): one module instance per event, named in its URL.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, settle, fire } from "@wcstack/testing";

// keep the query: it is how the module knows its event
const resolveModule = (url) => new URL("../../public" + url.pathname + url.search, import.meta.url);

let app;
afterEach(() => { app?.unmount(); vi.unstubAllGlobals(); });

describe("予約ウィジェット state", () => {
  it("loads its event, follows the stream for its own event only, and books", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).endsWith("/api/events/3")) {
        return new Response(JSON.stringify({ id: 3, prices: { adult: 500, child: 300, senior: 400 }, remaining: 4 }), { status: 200 });
      }
      if (init?.method === "POST") return new Response(JSON.stringify({ id: "MH-9", total: 800 }), { status: 201 });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    app = await mount(`
      <wcs-state src="/widget/widget-state.js?event=3"></wcs-state>
      <b id="left" data-wcs="textContent: remaining"></b>
      <form id="f" data-wcs="onsubmit#prevent: submit">
        <select id="a" data-wcs="value: adultCount"><option value="0">0</option><option value="1">1</option></select>
        <select id="c" data-wcs="value: childCount"><option value="0">0</option><option value="1">1</option></select>
        <template data-wcs="for: attendees"><input class="n" data-wcs="value: .name"></template>
        <input id="name" data-wcs="value: form.name"><input id="phone" data-wcs="value: form.phone"><input id="email" data-wcs="value: form.email">
        <button id="go" data-wcs="disabled: blocked">go</button>
      </form>
      <p id="done" data-wcs="hidden: done|not"><span id="bid" data-wcs="textContent: result.id"></span></p>`, { resolveModule });
    await settle(); await settle();
    expect(app.root.querySelector("#left").textContent).toBe("4");

    await app.state().write((s) => { s.seatMsg = { event: "seats", data: { id: 5, remaining: 0 }, lastEventId: "" }; });
    await settle();
    expect(app.root.querySelector("#left").textContent).toBe("4");      // another event's message
    await app.state().write((s) => { s.seatMsg = { event: "seats", data: { id: 3, remaining: 2 }, lastEventId: "" }; });
    await settle();
    expect(app.root.querySelector("#left").textContent).toBe("2");

    const a = app.root.querySelector("#a"); a.value = "1"; fire(a, "change");
    const c = app.root.querySelector("#c"); c.value = "1"; fire(c, "change");
    await settle();
    const names = app.root.querySelectorAll(".n");
    expect(names).toHaveLength(2);
    for (const [el, v] of [[names[0], "大人"], [names[1], "子"], [app.root.querySelector("#name"), "宿泊者"], [app.root.querySelector("#phone"), "0277-11-2222"], [app.root.querySelector("#email"), "a@b.jp"]]) {
      el.value = v; fire(el, "input");
    }
    await settle();
    expect(app.root.querySelector("#go").disabled).toBe(false);
    fire(app.root.querySelector("#f"), "submit");
    await settle(); await settle();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post[1].body)).toMatchObject({ eventId: 3, tickets: { adult: 1, child: 1, senior: 0 }, attendees: ["大人", "子"] });
    expect(app.root.querySelector("#bid").textContent).toBe("MH-9");
  });
});
