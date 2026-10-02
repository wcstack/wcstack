/**
 * integration.elementWriteRowCacheCost.test.ts — 要素の書き込み（`this["items.0"] = …`）の費用が、行の下で
 * 読んだパスの数に比例しない（#389）。
 *
 * 旧挙動（#364 の修正の後・#389 の前）: 行の下の値をキャッシュに載せるたびに、そのパスを要素パスからの
 * 静的な辺に載せていた（`items.*` → `items.*.m` → `items.*.m.k123`）。要素の書き込みの依存ウォークは
 * この辺をすべて辿るので、行の下を動的なキー（`$resolve("items.*.m.k" + i, [0])`）で 1 万個読むと、
 * 要素の書き込み 1 回が約 5 ms かかった（修正前は 0.06 ms）。辺は読まなくなっても外れなかった。
 *
 * いまは子のパスを辺に載せず、行（ListIndex）の印で無効にする（src/cache/cacheEntryByAbsoluteStateAddress.ts）。
 * 子のパスを読む getter へは、同じ行の親からも依存の辺を張る（src/components/State.ts の addDynamicDependency）。
 * 費用は機械の速さに依らない量 — 静的な辺の数と、1 回の書き込みが更新に積んだアドレスの数 — で固定する。
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { IAbsoluteStateAddress } from "../src/address/types";
import { registerUpdateBatchListener, unregisterUpdateBatchListener } from "../src/updater/updater";
import { flush, makeMount, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("element-write-row-cache-cost");

const K = 1000;
const keys = (): Record<string, number> => {
  const m: Record<string, number> = {};
  for (let i = 0; i < K; i++) m["k" + i] = i;
  return m;
};

/** バッチごとの更新アドレスのパス（drain の後に届く） */
let batches: string[][] = [];
const listener = (batch: ReadonlySet<IAbsoluteStateAddress>) => {
  batches.push(Array.from(batch, (address) => address.absolutePathInfo.pathInfo.path));
};
const writeAndCollect = async (stateEl: any, fn: (s: any) => void): Promise<string[]> => {
  batches = [];
  registerUpdateBatchListener(listener);
  try {
    write(stateEl, fn);
    for (let i = 0; i < 3; i++) await flush();
  } finally {
    unregisterUpdateBatchListener(listener);
  }
  return batches.flat();
};

afterEach(() => {
  unregisterUpdateBatchListener(listener);
});

const VARIANTS: [string, string][] = [
  ["for で描かない", "<p>x</p>"],
  ["行の中で子を描かない for", `<template data-wcs="for: items"><p>x</p></template>`],
];

describe("行の下を動的なキーで読んでも、要素の書き込みの依存ウォークはキーの数に比例しない", () => {
  for (const [variant, html] of VARIANTS) {
    it(`キーを ${K} 個読んだ後も静的な辺は増えず、要素の書き込みが積むのは要素のアドレスだけ（${variant}）`, async () => {
      const { host, stateEl } = await mount({ items: [{ m: keys() }, { m: keys() }] }, html);
      read(stateEl, (s) => { for (let i = 0; i < K; i++) s.$resolve("items.*.m.k" + i, [0]); });
      // 旧: items.*.m → k0…k999 の 1000 本、items.* → items.*.m
      expect(stateEl.staticDependency.get("items.*.m")).toBeUndefined();
      expect(stateEl.staticDependency.get("items.*")).toBeUndefined();
      // リストの連なりは残る（リストへの代入・`$postUpdate("items")` が行へ届く）
      expect(stateEl.staticDependency.get("items")).toEqual(["items.*"]);

      // 同じオブジェクトをその場で書き換えて知らせる
      const paths = await writeAndCollect(stateEl, (s) => { const o = s["items.0"]; o.m.k500 = -1; s["items.0"] = o; });
      expect(paths).toEqual(["items.*"]); // 旧: 1002 個（items.* / items.*.m / k0…k999）
      // 積まなくても、行の下のキャッシュは外れている
      expect(read(stateEl, (s) => [s.$resolve("items.*.m.k500", [0]), s.$resolve("items.*.m.k0", [0]), s["items.0.m.k500"]]))
        .toEqual([-1, 0, -1]);
      // 別の行は外れない
      expect(read(stateEl, (s) => s.$resolve("items.*.m.k500", [1]))).toBe(500);
      host.remove();
    });
  }

  it("getter が行の下を動的なキーで読んでいても、要素の書き込みはキーを 1 つずつ訪ねずに getter へ届く", async () => {
    const { host, stateEl, shadowRoot } = await mount({
      items: [{ m: keys() }],
      get sum() {
        let total = 0;
        for (let i = 0; i < K; i++) total += (this as any).$resolve("items.*.m.k" + i, [0]);
        return total;
      },
    }, `<b>{{ sum }}</b>`);
    const shown = () => shadowRoot.querySelector("b")!.textContent;
    expect(shown()).toBe(String((K * (K - 1)) / 2));
    expect(stateEl.staticDependency.get("items.*.m")).toBeUndefined();

    const paths = await writeAndCollect(stateEl, (s) => { const o = s["items.0"]; o.m.k1 = 1001; s["items.0"] = o; });
    expect(paths.sort()).toEqual(["items.*", "sum"]); // 旧: 1003 個
    expect(shown()).toBe(String((K * (K - 1)) / 2 + 1000));

    // 新しいオブジェクトへの差し替え（新しい行）でも届く
    await writeAndCollect(stateEl, (s) => { s["items.0"] = { m: { ...keys(), k0: 5 } }; });
    expect(shown()).toBe(String((K * (K - 1)) / 2 + 5));
    host.remove();
  });
});

describe("途中の値の書き込み・$postUpdate は、その下の子のパスのキャッシュを外す（行の印）", () => {
  const initial = () => ({
    items: [{ m: { k5: 1 }, name: "a" }, { m: { k5: 2 }, name: "b" }],
    get all() { return (this as any).$getAll("items.*.m.k5", []).join(","); },
    // `all` が行 0 を先にキャッシュに載せるので、g の読みはキャッシュに当たり、親（items.*.m）を辿らない
    get g() { return (this as any)["items.0.m.k5"]; },
  });

  for (const [variant, html] of VARIANTS) {
    it(`途中の値の書き込みの後、添字の読み・$getAll・キャッシュに当たった getter が新しい値になる（${variant}）`, async () => {
      const { host, stateEl, shadowRoot } = await mount(initial(), `<b>{{ all }}</b><i>{{ g }}</i>` + html);
      const shown = () => [shadowRoot.querySelector("b")!.textContent, shadowRoot.querySelector("i")!.textContent];
      expect(shown()).toEqual(["1,2", "1"]);

      write(stateEl, (s) => { s["items.0.m"] = { k5: 99 }; });
      for (let i = 0; i < 3; i++) await flush();
      expect(read(stateEl, (s) => [s["items.0.m.k5"], s.$resolve("items.*.m.k5", [0])])).toEqual([99, 99]);
      expect(shown()).toEqual(["99,2", "99"]);

      write(stateEl, (s) => { s["items.0.m"].k5 = 7; s.$postUpdate("items.0.m"); });
      for (let i = 0; i < 3; i++) await flush();
      expect(read(stateEl, (s) => s["items.0.m.k5"])).toBe(7);
      expect(shown()).toEqual(["7,2", "7"]);
      host.remove();
    });
  }
});

describe("行の印は要素のパス（items.*）自身のキャッシュを外さない", () => {
  let id = 0;
  const mk = () => { id++; return { name: "n" + id, m: { k: id }, tags: [{ v: id * 10 }, { v: id * 10 + 1 }] }; };
  const rowText = (it: any) => `${it.name}|${it.m.k}|${it.tags.map((t: any) => t.v).join("")}`;

  it("1 つの更新でリストを 2 回代入しても、入れ子の for が別の行の要素を描かない", async () => {
    const ops: [string, (s: any) => void][] = [
      ["push → reverse", (s) => { s.items = [...s.items, mk()]; s.items = [...s.items].reverse(); }],
      ["push → 先頭を削除", (s) => { s.items = [...s.items, mk()]; s.items = s.items.filter((_: any, i: number) => i !== 0); }],
    ];
    for (const [, op] of ops) {
      id = 0;
      const raw: any = { items: [mk(), mk(), mk()] };
      const { host, shadowRoot, stateEl } = await mount(raw,
        `<template data-wcs="for: items"><p>{{ .name }}|{{ .m.k }}|<template data-wcs="for: .tags"><u>{{ .v }}</u></template></p></template>`);
      write(stateEl, op);
      for (let i = 0; i < 3; i++) await flush();
      // 旧挙動（#389 の修正の途中）: push → reverse の先頭の行が `n4|4|1011`（n1 の tags）、push → 先頭を削除の
      // 最後の行が `n4|4|`。行の途中の値（.m）の印が要素のキャッシュまで外し、並べ替えをまだ振り直していない
      // 行の位置を添字で読み直した
      expect(Array.from(shadowRoot.querySelectorAll("p"), (p) => p.textContent)).toEqual(raw.items.map(rowText));
      host.remove();
    }
  });

  for (const [variant, html] of VARIANTS) {
    it(`途中の値を書いた後に要素を入れ替えても、入れ子の行が退役した行の位置を読まない（${variant}）`, async () => {
      const { host, stateEl } = await mount({
        items: [{ m: { k: 1 }, tags: [{ v: 10 }, { v: 11 }] }, { m: { k: 2 }, tags: [{ v: 20 }, { v: 21 }] }, { m: { k: 3 }, tags: [{ v: 30 }, { v: 31 }] }],
      }, html);
      read(stateEl, (s) => [s.$getAll("items.*.tags.*.v", []), s.$getAll("items.*.m.k", [])]);
      write(stateEl, (s) => { s["items.0.m"] = { k: 50 }; });
      for (let i = 0; i < 3; i++) await flush();
      write(stateEl, (s) => { const arr = s.items; const a = arr[2], b = arr[0]; s["items.2"] = b; s["items.0"] = a; });
      for (let i = 0; i < 3; i++) await flush();
      // 旧挙動（#389 の修正の途中）: `30,31,20,21,30,31`（最後の行が、退役した行の位置 0 の新しい要素を読んだ）
      expect(read(stateEl, (s) => [s.$getAll("items.*.tags.*.v", []), s.$resolve("items.*.tags.*.v", [2, 0])]))
        .toEqual([[30, 31, 20, 21, 10, 11], 10]);
      host.remove();
    });

    it(`途中の値を書いた後も、リストの代入で既存の行の行 getter を評価し直さず、行の $watch も発火しない（${variant}）`, async () => {
      let evals = 0;
      let fired = 0;
      const { host, stateEl } = await mount({
        items: [{ id: 1, m: { k: 1 } }, { id: 2, m: { k: 2 } }, { id: 3, m: { k: 3 } }],
        get sum() { return (this as any).$getAll("items.*.m.k", []).reduce((a: number, b: number) => a + b, 0); },
        get "items.*.label"() { evals++; return "L" + (this as any)["items.*.m.k"] + (this as any)["items.*.id"]; },
        $watch: { "items.*.label"() { fired++; } },
      }, `<b>{{ sum }}</b>` + html);
      read(stateEl, (s) => s.$getAll("items.*.label", []));
      write(stateEl, (s) => { s["items.1.m"] = { k: 7 }; });
      for (let i = 0; i < 3; i++) await flush();
      expect(read(stateEl, (s) => s.$getAll("items.*.label", []))).toEqual(["L11", "L72", "L33"]);
      evals = 0;
      fired = 0;
      write(stateEl, (s) => { s.items = [...s.items, { id: 4, m: { k: 4 } }]; });
      for (let i = 0; i < 3; i++) await flush();
      // 旧挙動（#389 の修正の途中）: 行の印で要素（items.*）が外れた label の読みが親の連鎖をリストまで上り、
      // リスト → 行 getter の辺を張った。以後のリストの代入で、既存の行の label を評価し直して $watch が発火した
      // 評価と発火は増えた行の分だけ（for で描かない行の $watch は発火しない — S13）
      expect([evals, fired]).toEqual(html.includes("for:") ? [1, 1] : [0, 0]);
      host.remove();
    });
  }
});
