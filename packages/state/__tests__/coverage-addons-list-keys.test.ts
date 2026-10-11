import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, listKeys } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([listKeys]);
  bootstrapState();
});

async function host(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-list-keys-${seq++}`);
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

const lis = (root: ShadowRoot) => Array.from(root.querySelectorAll("li"));

describe("$listKeys の宣言", () => {
  it.each<[unknown, string]>([
    [null, "$listKeys must be an object mapping list paths to a key field or function."],
    ["id", "$listKeys must be an object mapping list paths to a key field or function."],
    [{ items: 1 }, '$listKeys "items" must be a field name or a function.'],
    [{ items: null }, '$listKeys "items" must be a field name or a function.'],
  ])("不正な宣言 %j を拒む", (decl, message) => {
    expect(() => new Engine({ items: [], $listKeys: decl }, new DirtyStrategy())).toThrow(message);
  });
});

describe("$listKeys の突き合わせ", () => {
  it("行がプレーンなオブジェクトでなければ書き込みを拒み、何も変えない", async () => {
    const { root, el } = await host(`<ul><template data-wcs="for: items"><li>{{ .id }}</li></template></ul>`, {
      items: [{ id: 1 }],
      $listKeys: { items: "id" },
    });
    expect(() => el.createState("writable", (s: any) => { s.items = [{ id: 1 }, 2]; })).toThrow('$listKeys "items": rows must be plain objects.');
    expect(() => el.createState("writable", (s: any) => { s.items = [null]; })).toThrow('$listKeys "items": rows must be plain objects.');
    await flush();
    expect(lis(root).map((li) => li.textContent)).toEqual(["1"]);
  });

  it("配列でなかったリストへの書き込みと、同じ配列の書き戻しはそのままの書き込み", async () => {
    const { root, el, write } = await host(`<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul><p>{{ items.length }}</p>`, {
      items: null,
      $listKeys: { items: "id" },
    });
    expect(lis(root)).toEqual([]);
    const first = [{ id: 1, name: "a" }];
    await write((s) => { s.items = first; });
    expect(lis(root).map((li) => li.textContent)).toEqual(["a"]);
    const kept = lis(root)[0];
    let stored: unknown;
    el.createState("readonly", (s: any) => { stored = s.items; });
    // stored as is (nothing to merge with)
    expect(stored).toBe(first);
    expect(root.querySelector("p")!.textContent).toBe("1");
    // written back as the same array: not merged with itself (which would be a no-op refresh)
    // but written as is, so what reads the path sees the write
    await write((s) => {
      const arr = s.items;
      arr.push({ id: 2, name: "b" });
      s.items = arr;
    });
    expect(root.querySelector("p")!.textContent).toBe("2");
    expect(lis(root)[0]).toBe(kept);
  });
});
