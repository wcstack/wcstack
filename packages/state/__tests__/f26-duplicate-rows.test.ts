/**
 * F26 の (a)（#365）: 1 つの一覧の 2 つの位置に同じオブジェクトがあるとき、片方の行の下への書き込みは、
 * もう片方の行の束縛・行 getter・`$getAll` にも届く。配列が同じオブジェクトを 2 回持つかは、行の下への
 * 書き込みが初めて要るときに配列ごとに 1 回だけ調べ（以後の書き込みは O(1)）、要素をその場で書くと
 * 調べ直す。getter が結ばない 2 つの配列にある同じオブジェクト（#401、(b)）は既知の制限のまま
 * （issues2-lists.test.ts の it.fails）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState, getBindingsReady } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  bootstrapState();
});

async function page(html: string, state: Record<string, any>) {
  const h = document.createElement(`f26-dup-page-${seq++}`);
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
    await flush();
  };
  return { root, write };
}

const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);

describe("F26 (a) 同じ一覧の 2 つの位置にある同じオブジェクト", () => {
  it("片方の行の下への書き込みが、もう片方の行と $getAll に届くこと", async () => {
    const o = { name: "a" };
    const { root, write } = await page(
      `<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul><p>{{ all }}</p>`,
      { items: [o, { name: "b" }, o], get all() { return (this as any).$getAll("items.*.name", []).join("/"); } },
    );
    await write((s) => { s["items.0.name"] = "z"; });
    expect(texts(root, "li")).toEqual(["z", "b", "z"]);
    expect(texts(root, "p")).toEqual(["z/b/z"]);
    // a second write into the same array (the answer is kept)
    await write((s) => { s["items.2.name"] = "y"; });
    expect(texts(root, "li")).toEqual(["y", "b", "y"]);
  });

  it("要素をその場で書いて重複ができた後の書き込みも届くこと（調べ直す）", async () => {
    const o = { name: "a" };
    const { root, write } = await page(`<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`,
      { items: [o, { name: "b" }] });
    // no duplicate yet: the array is looked at once, and the answer kept
    await write((s) => { s["items.1.name"] = "B"; });
    expect(texts(root, "li")).toEqual(["a", "B"]);
    // an element write puts `o` at position 1 too
    await write((s) => { s["items.1"] = o; });
    await write((s) => { s["items.0.name"] = "z"; });
    expect(texts(root, "li")).toEqual(["z", "z"]);
  });

  it("$postUpdate で行を配列に合わせ直した後の書き込みも届くこと", async () => {
    const o = { name: "a" };
    const items = [o, { name: "b" }];
    const { root, write } = await page(`<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`, { items });
    await write((s) => { s["items.0.name"] = "a0"; });
    // changed in place, and announced on the row
    await write((s) => { items[1] = o; s.$postUpdate("items.1"); });
    await write((s) => { s["items.1.name"] = "z"; });
    expect(texts(root, "li")).toEqual(["z", "z"]);
  });

  it("新しい配列でも、重複が無ければ片方の行だけが変わること", async () => {
    const { root, write } = await page(`<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`,
      { items: [{ name: "a" }, { name: "a" }] });
    await write((s) => { s["items.0.name"] = "z"; });
    expect(texts(root, "li")).toEqual(["z", "a"]);
  });
});
