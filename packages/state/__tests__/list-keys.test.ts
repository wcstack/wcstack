import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, listKeys } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([listKeys]);
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

  it("宣言していないリストは参照の差し替えのまま", async () => {
    const { el, write } = await host("", { items: [{ id: 1 }], other: [{ id: 1 }], $listKeys: { items: "id" } });
    const fresh = [{ id: 1 }];
    await write((s) => { s.other = fresh; });
    el.createState("readonly", (s: any) => expect(s.other).toBe(fresh));
  });
});
