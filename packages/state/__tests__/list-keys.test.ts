import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, listKeys, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([listKeys, temporal]); // temporal: the $watch of one test
  bootstrapState();
});

async function host(html: string, state: Record<string, any>) {
  const h = document.createElement(`list-keys-test-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
  };
  return { root, el, write };
}

describe("$listKeys", () => {
  it("キーの合う行は、行オブジェクトも行の DOM もそのまま（新しいオブジェクトの配列を取り直しても）", async () => {
    let stored: unknown[] = [];
    const { root, el, write } = await host(`<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`, {
      items: [{ id: 1, name: "a" }, { id: 2, name: "b" }],
      $listKeys: { items: "id" },
    });
    const lis = Array.from(root.querySelectorAll("li"));
    el.createState("readonly", (s: any) => { stored = s.items; });
    const fresh = [{ id: 2, name: "B" }, { id: 1, name: "a" }];
    await write((s) => { s.items = fresh; });
    const after = Array.from(root.querySelectorAll("li"));
    expect(after.map((li) => li.textContent)).toEqual(["B", "a"]);
    expect(after).toEqual([lis[1], lis[0]]);
    el.createState("readonly", (s: any) => {
      expect(s.items).not.toBe(fresh);
      expect(s.items[0]).toBe(stored[1]);
    });
  });

  it("入れ子のリストも、関数のキーで突き合わせる", async () => {
    const { root, write } = await host(`<ul><template data-wcs="for: groups"><li><template data-wcs="for: .items"><b>{{ .v }}</b></template></li></template></ul>`, {
      groups: [{ gid: "g", items: [{ uid: "x", v: 1 }, { uid: "y", v: 2 }] }],
      $listKeys: { groups: "gid", "groups.*.items": (row: any) => row.uid },
    });
    const bs = Array.from(root.querySelectorAll("b"));
    await write((s) => { s.groups = [{ gid: "g", items: [{ uid: "y", v: 20 }, { uid: "x", v: 1 }] }]; });
    const after = Array.from(root.querySelectorAll("b"));
    expect(after.map((b) => b.textContent)).toEqual(["20", "1"]);
    expect(after).toEqual([bs[1], bs[0]]);
  });

  it.each([
    [[{ id: 1 }, { id: 1 }], "duplicate key"],
    [[{ name: "no key" }], "a row has no key"],
    [[new (class Row { id = 1; })()], "rows must be plain objects"],
  ])("キーの重複・欠落・素でない行は投げる（%#）", async (rows, message) => {
    const { el } = await host("", { items: [{ id: 9 }], $listKeys: { items: "id" } });
    expect(() => el.createState("writable", (s: any) => { s.items = rows; })).toThrow(message);
  });

  it("項目だけが変わる取り直しも、一覧を読む getter に届く（行は作り直さない）", async () => {
    const { root, write } = await host(
      `<ul id="new"><template data-wcs="for: newCards"><li>{{ .t }}</li></template></ul>
       <ul id="done"><template data-wcs="for: doneCards"><li>{{ .t }}</li></template></ul>
       <p id="counts">{{ newCount }}/{{ doneCount }}</p>
       <ol><template data-wcs="for: cards"><li>{{ .t }}</li></template></ol>`,
      {
        cards: [{ id: 1, status: "new", t: "a" }, { id: 2, status: "new", t: "b" }, { id: 3, status: "done", t: "c" }],
        $listKeys: { cards: "id" },
        get newCards() { return this.cards.filter((c: any) => c.status === "new"); },
        get doneCards() { return this.cards.filter((c: any) => c.status === "done"); },
        get newCount() { return this.newCards.length; },
        get doneCount() { return this.doneCards.length; },
      },
    );
    const texts = (sel: string) => Array.from(root.querySelectorAll(`${sel} li`)).map((li) => li.textContent);
    const rows = Array.from(root.querySelectorAll("ol li"));
    // the same rows in the same order: only card 2's status and text differ
    await write((s) => { s.cards = [{ id: 1, status: "new", t: "a" }, { id: 2, status: "done", t: "b2" }, { id: 3, status: "done", t: "c" }]; });
    expect(texts("#new")).toEqual(["a"]);
    expect(texts("#done")).toEqual(["b2", "c"]);
    expect(root.querySelector("#counts")!.textContent).toBe("1/2");
    expect(Array.from(root.querySelectorAll("ol li"))).toEqual(rows);
    // and back: the card returns to its column
    await write((s) => { s.cards = [{ id: 1, status: "new", t: "a" }, { id: 2, status: "new", t: "b3" }, { id: 3, status: "done", t: "c" }]; });
    expect(texts("#new")).toEqual(["a", "b3"]);
    expect(texts("#done")).toEqual(["c"]);
    expect(root.querySelector("#counts")!.textContent).toBe("2/1");
    expect(Array.from(root.querySelectorAll("ol li"))).toEqual(rows);
  });

  it("何も変わらない取り直しは、一覧の $watch も鳴らさない", async () => {
    const seen: unknown[] = [];
    const { write } = await host("", {
      cards: [{ id: 1, t: "a" }],
      $listKeys: { cards: "id" },
      $watch: { cards() { seen.push("cards"); } },
    });
    await write((s) => { s.cards = [{ id: 1, t: "a" }]; });
    expect(seen).toEqual([]);
    await write((s) => { s.cards = [{ id: 1, t: "b" }]; });
    expect(seen).toEqual(["cards"]);
  });

  it("宣言していないリストは参照の差し替えのまま", async () => {
    const { el, write } = await host("", { items: [{ id: 1 }], other: [{ id: 1 }], $listKeys: { items: "id" } });
    const fresh = [{ id: 1 }];
    await write((s) => { s.other = fresh; });
    el.createState("readonly", (s: any) => expect(s.other).toBe(fresh));
  });
});

describe("$listKeys が getter を名指す（wcs/list-keys-getter、4.33 — docs/seam-apps.md counter-assist）", () => {
  it("getter（継承したものも）を名指す宣言は、宣言を受け取るたびに 1 回知らせる。データのパスには言わない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      class Base { get "groups.*.items"() { return []; } }
      const state = Object.create(Base.prototype, Object.getOwnPropertyDescriptors({
        rows: [{ id: 1 }],
        get visible() { return (this as any).rows; },
        groups: [{ items: [] }],
        $listKeys: { visible: "id", rows: "id", "groups.*.items": "id" },
      }));
      await host("", state);
      const said = warn.mock.calls.map((c) => String(c[0])).filter((w) => w.includes("[wcs/list-keys-getter]"));
      expect(said).toEqual([
        `[@wcstack/state] [wcs/list-keys-getter] $listKeys "visible" names a getter: rows are kept when an array is assigned to the path, and a getter's list is never assigned, so the declaration does nothing. Name the path the list is assigned to (the one the getter reads).`,
        expect.stringContaining(`$listKeys "groups.*.items" names a getter`),
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
