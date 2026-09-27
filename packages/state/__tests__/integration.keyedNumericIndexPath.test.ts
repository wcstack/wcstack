/**
 * integration.keyedNumericIndexPath.test.ts — `$eq` 系の path に数値の添字（`$eq("items.0.v", key)`）を
 * 書いても、要素の差し替えと葉の書き込みに追従する（#366）。
 *
 * 旧挙動: その getter は最初の値のまま止まった。`$eq` は評価中の getter を path の**綴りのまま**
 * （`items.0.v`・祖先は `items.0` / `items`）鍵付き購読に載せるが、書き込みは数値の添字をワイルドカードに
 * した綴り（`items.*.v` / `items.*`）で鍵付き購読に知らせるので、どちらの書き込みも届かなかった。
 * 同じページに数値の添字の束縛（`{{ items.0.v }}`）があると、その束縛が state に足すアクセサで
 * `items.0.v` が getter のパスになり、getter 由来の path として追跡付きの読みに落ちるので追従した。
 *
 * いまは数値の添字を含む path も、getter 由来の path と同じく追跡付きの読みに落とす
 * （src/proxy/traps/get.ts の derivesFromGetter）。README「鍵付き選択」の fallback の段に並べて書いてある。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { countKeyedSubscriptions, getKeyedLedgerView } from "../src/dependency/keyedDependency";
import { flush, makeMount, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("keyed-numeric-index-path");

const txt = (root: ShadowRoot, selector: string) =>
  Array.from(root.querySelectorAll(selector)).map((n) => n.textContent);
const flushTimes = async (n = 3) => {
  for (let i = 0; i < n; i++) await flush();
};

const VARIANTS: [string, string][] = [
  ["for で描かない", ""],
  ["for で描く", `<ul><template data-wcs="for: items"><li>{{ .v }}</li></template></ul>`],
  // 束縛のアクセサが items.0.v を getter のパスにするので、前から追跡付きの読みに落ちて追従していた
  ["対照: 同じ数値のパスの束縛がある", `<i>{{ items.0.v }}</i>`],
];

const STEPS: [string, (s: any) => void, string][] = [
  ["items.0 = { v: \"b\" }", (s) => { s["items.0"] = { v: "b" }; }, "Y"],
  ["items.0 = { v: \"a\" }", (s) => { s["items.0"] = { v: "a" }; }, "n"],
  ["items.0.v = \"b\"", (s) => { s["items.0.v"] = "b"; }, "Y"],
  ["items.0.v = \"a\"", (s) => { s["items.0.v"] = "a"; }, "n"],
  ["items = [{ v: \"b\" }]", (s) => { s.items = [{ v: "b" }]; }, "Y"],
];

describe("数値の添字の path を $eq に渡す", () => {
  it.each(VARIANTS)("要素の差し替え・葉の書き込み・一覧の置換に追従する（%s）", async (_label, extra) => {
    const { host, stateEl, shadowRoot } = await mount({
      items: [{ v: "a" }, { v: "c" }],
      sel: { id: "a" },
      get isB() { return (this as any).$eq("items.0.v", "b") ? "Y" : "n"; },
      get selB() { return (this as any).$eq("sel.id", "b") ? "Y" : "n"; },
    }, `<p class="b">{{ isB }}</p><p class="s">{{ selB }}</p>` + extra);
    expect(txt(shadowRoot, ".b")).toEqual(["n"]);

    const seen: string[] = [];
    for (const [, step] of STEPS) {
      write(stateEl, step);
      await flushTimes();
      seen.push(txt(shadowRoot, ".b")[0]! + read(stateEl, (s) => s.isB));
    }
    // 旧（対照以外）: ["nn", "nn", "nn", "nn", "YY"]（一覧の置換だけが届いた）
    expect(seen).toEqual(STEPS.map(([, , expected]) => expected + expected));

    // 対照: 数値の添字の無い path は今までどおり鍵付きで購読する
    write(stateEl, (s) => { s.sel = { id: "b" }; });
    await flushTimes();
    expect(txt(shadowRoot, ".s")).toEqual(["Y"]);
    expect(countKeyedSubscriptions(stateEl as any, "sel.id")).toBe(1);
    host.remove();
  });

  it("プリミティブの一覧（$eq(\"items.0\", \"b\")）も要素の書き込みに追従する", async () => {
    const { host, stateEl, shadowRoot } = await mount({
      items: ["a", "c"],
      get isB() { return (this as any).$eq("items.0", "b") ? "Y" : "n"; },
    }, `<p class="b">{{ isB }}</p>`);
    write(stateEl, (s) => { s["items.0"] = "b"; });
    await flushTimes();
    expect(txt(shadowRoot, ".b")).toEqual(["Y"]); // 旧: ["n"]
    write(stateEl, (s) => { s["items.0"] = "a"; });
    await flushTimes();
    expect(txt(shadowRoot, ".b")).toEqual(["n"]);
    host.remove();
  });

  it("$eqPath / $eqIndex の path も同じく追従する", async () => {
    const { host, stateEl, shadowRoot } = await mount({
      items: [{ v: "a" }, { v: 1 }],
      key: "b",
      rows: [{ id: 0 }, { id: 1 }],
      get byPath() { return (this as any).$eqPath("items.0.v", "key") ? "Y" : "n"; },
      get "rows.*.cur"() { return (this as any).$eqIndex("items.1.v") ? "Y" : "n"; },
    }, `<p class="p">{{ byPath }}</p><ul><template data-wcs="for: rows"><li class="r">{{ .cur }}</li></template></ul>`);
    expect([txt(shadowRoot, ".p"), txt(shadowRoot, ".r")]).toEqual([["n"], ["n", "Y"]]);

    write(stateEl, (s) => { s["items.0"] = { v: "b" }; s["items.1.v"] = 0; });
    await flushTimes();
    // 旧: [["n"], ["n", "Y"]]
    expect([txt(shadowRoot, ".p"), txt(shadowRoot, ".r")]).toEqual([["Y"], ["Y", "n"]]);
    host.remove();
  });

  // 追跡付きの読みに落ちた `$eqIndex` の答えは行の index で変わるので、getter を index 依存に記録しないと
  // 位置だけが変わった行（並べ替え・先頭への挿入・削除）で評価し直されない。getter の path（curG）は
  // #366 の前から同じ壊れ方をしていた
  it.each([
    ["数値の添字の path（cur.0）", { cur: [0] }, "cur.0"],
    ["getter の path（curG）", { c: 0 }, "curG"],
    ["対照: 普通の path（curIdx）", { curIdx: 0 }, "curIdx"],
  ])("$eqIndex の追跡付きの読みが行の移動に追従する（%s）", async (_label, extra, path) => {
    const state: any = { rows: ["a", "b", "c"], ...extra };
    // getter は spread で値に化けないよう defineProperty で足す
    Object.defineProperty(state, "curG", { get(this: any) { return this.c; }, enumerable: true, configurable: true });
    Object.defineProperty(state, "rows.*.on", {
      get(this: any) { return this.$eqIndex(path) ? "Y" : "n"; }, enumerable: true, configurable: true,
    });
    const { host, stateEl, shadowRoot } = await mount(state, `<ul><template data-wcs="for: rows"><li class="r">{{ .on }}</li></template></ul>`);
    const seen = [txt(shadowRoot, ".r").join("|")];
    for (const step of [
      (s: any) => { s.rows = ["c", "a", "b"]; },
      (s: any) => { s.rows = ["z", ...s.rows]; },
      (s: any) => { s.rows = s.rows.slice(1); },
      (s: any) => { s.rows = s.rows.slice(1); },
    ]) {
      write(stateEl, step);
      await flushTimes();
      seen.push(txt(shadowRoot, ".r").join("|"));
    }
    // 旧（cur.0 は #366 の修正後、curG は前から）: 1 回目の並べ替えで "n|Y|n" — 移動した行が前の答えのまま
    expect(seen).toEqual(["Y|n|n", "Y|n|n", "Y|n|n|n", "Y|n|n", "Y|n"]);
    host.remove();
  });

  it("DevTools の要約: 数値の添字の path は鍵付きの購読を持たず、追跡付きの読みに落ちた印が付く", async () => {
    const { host, stateEl } = await mount({
      items: [{ v: "a" }],
      get isB() { return (this as any).$eq("items.0.v", "b"); },
    }, `<p>{{ isB }}</p>`);
    expect(countKeyedSubscriptions(stateEl as any, "items.0.v")).toBe(0); // 旧: 1（届かない購読）
    expect(getKeyedLedgerView(stateEl as any)!.tracked.has("items.0.v")).toBe(true);
    host.remove();
  });
});
