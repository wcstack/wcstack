/**
 * integration.directIndexUnrenderedList.test.ts — `for` で描いていないリストの行を、添字の
 * 付いたパス（`this["items.0.v"]`）で読み書きする（#324）。
 *
 * README の「Direct index access」は、`this["users.0.name"]` がループの文脈なしで
 * `users[0].name` に解決されると約束している（v1.2.0 で README に入った）。vscode-wcs の
 * `wcs/nested-assign` / `wcs/array-index-assign` もこの書き方を勧める。ところが約束が成立して
 * いたのは、`for` が描いた（または `$getAll` / `$setAll` / 依存ウォークが走査した）リストだけ
 * だった。添字のパスは各ワイルドカード段の行集合を台帳（listIndexesByList）から引き、台帳を
 * 作るのは差分（createListDiff）だけなので、それ以外のリストでは読みも書きも
 * `ListIndex not found: <リスト>` で投げていた（走査を経ていない `$resolve` は
 * `ListIndexes not found: <リスト>`）。
 *
 * いまは台帳が無ければその場で差分を取って生やす（src/proxy/methods/getListIndexesByAddress.ts）。
 * 旧リストには `$getAll` の第 1 相と同じ state 側の基準を渡すので、行の再利用は `$getAll` と
 * 同じ規則になる — 空を基準に行を鋳造すると、`$getAll` で観測済みのリストを中身の同じ写しに
 * 置き換えた後で、直接添字が書いた値が `$getAll` からも直接添字の読みからも見えなくなる
 * （下の「台帳の同一性」の 3 本目。空を基準にした試作で実測した）。
 *
 * 範囲外: マークアップの数値パス（`textContent: items.0.v`）が直接添字の書き込みに追従しない件は
 * 別の問題で、ここでは扱わない。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { getListIndexesByList } from "../src/list/listIndexesByList";
import { flush, makeMount, read, write, writeCount, writeError } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("direct-index-host");

const items = () => [{ v: 1 }, { v: 2 }];
const groups = () => [
  { name: "g0", items: [{ v: 1 }, { v: 2 }] },
  { name: "g1", items: [{ v: 3 }] },
];
const txt = (root: ShadowRoot, selector: string) =>
  Array.from(root.querySelectorAll(selector)).map((n) => n.textContent);
const raw = (stateEl: any) => stateEl._state;

// ---------------------------------------------------------------------------
// Issue の表の 4 形
// ---------------------------------------------------------------------------

describe("Issue の 4 形: 添字のパスで読み書きできる", () => {
  it("最上位のリスト items を for で描かないとき", async () => {
    const { host, stateEl } = await mount({ items: items() }, `<span data-wcs="textContent: items.length"></span>`);
    expect(getListIndexesByList(raw(stateEl).items), "mount の時点では台帳が無い").toBeNull();

    // 修正前: どちらも "[@wcstack/state] ListIndex not found: items"
    expect(read(stateEl, (s) => s["items.0.v"])).toBe(1);
    expect(writeError(stateEl, (s) => { s["items.0.v"] = 5; })).toBe("");
    expect(raw(stateEl).items[0].v).toBe(5);
    expect(read(stateEl, (s) => s["items.0.v"])).toBe(5);
    // 要素そのもののパスも同じ
    expect(read(stateEl, (s) => s["items.0"])).toEqual({ v: 5 });
    write(stateEl, (s) => { s["items.1"] = { v: 9 }; });
    expect(raw(stateEl).items[1]).toEqual({ v: 9 });
    host.remove();
  });

  it("groups は for で描くが groups.*.items は描かないとき", async () => {
    const { host, stateEl, shadowRoot } = await mount({ groups: groups() },
      `<template data-wcs="for: groups"><b class="n" data-wcs="textContent: .name"></b></template>`);
    expect(txt(shadowRoot, ".n")).toEqual(["g0", "g1"]);
    expect(getListIndexesByList(raw(stateEl).groups[0].items)).toBeNull();

    // 修正前: "[@wcstack/state] ListIndex not found: groups.*.items"
    expect(read(stateEl, (s) => s["groups.0.items.1.v"])).toBe(2);
    expect(writeError(stateEl, (s) => { s["groups.1.items.0.v"] = 30; })).toBe("");
    expect(raw(stateEl).groups[1].items[0].v).toBe(30);
    expect(read(stateEl, (s) => s["groups.1.items.0.v"])).toBe(30);
    host.remove();
  });

  it("groups も groups.*.items も描かないとき", async () => {
    const { host, stateEl } = await mount({ groups: groups() });

    // 修正前: "[@wcstack/state] ListIndex not found: groups"
    expect(read(stateEl, (s) => s["groups.0.items.1.v"])).toBe(2);
    expect(writeError(stateEl, (s) => { s["groups.0.items.1.v"] = 20; })).toBe("");
    expect(raw(stateEl).groups[0].items[1].v).toBe(20);
    expect(read(stateEl, (s) => s["groups.0.items.1.v"])).toBe(20);
    host.remove();
  });

  it("要素がプリミティブのリストでも、要素のパスで読み書きできる（array-mutation 設計書の V10/V11）", async () => {
    const { host, stateEl } = await mount({ items: [1, 2] });
    // 修正前: どちらも "[@wcstack/state] ListIndex not found: items"
    expect(writeError(stateEl, (s) => { s["items.0"] += 1; })).toBe("");
    expect(raw(stateEl).items).toEqual([2, 2]);
    expect(writeError(stateEl, (s) => { s["items.0"] = s.items[0] + 1; })).toBe("");
    expect(raw(stateEl).items).toEqual([3, 2]);
    expect(read(stateEl, (s) => s["items.0"])).toBe(3);
    host.remove();
  });

  it("対照: 両方を for で描くとき（修正前から通っていた形）、書き込みが描画に届く", async () => {
    const { host, stateEl, shadowRoot } = await mount({ groups: groups() },
      `<template data-wcs="for: groups"><template data-wcs="for: .items">` +
      `<i class="v" data-wcs="textContent: .v"></i></template></template>`);
    expect(read(stateEl, (s) => s["groups.0.items.0.v"])).toBe(1);
    write(stateEl, (s) => { s["groups.0.items.0.v"] = 5; });
    await flush();
    expect(txt(shadowRoot, ".v")).toEqual(["5", "2", "3"]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// Issue の再現 HTML と createState
// ---------------------------------------------------------------------------

describe("Issue の再現", () => {
  it("メソッドが最初の書き込みで止まらず、count も進む", async () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args); });
    try {
      const { host, stateEl, shadowRoot } = await mount({
        items: items(),
        count: 0,
        bump(this: any) { this["items.0.v"] = 7; this.count++; },
      }, `<p class="c">{{ count }}</p><button data-wcs="onclick: bump">bump</button>`);
      expect(txt(shadowRoot, ".c")).toEqual(["0"]);

      (shadowRoot.querySelector("button") as HTMLButtonElement).click();
      await flush();
      await flush();

      // 修正前: count は 0 のまま・items[0].v は 1 のまま、コンソールに
      // `"bump" rejected. [@wcstack/state] ListIndex not found: items`
      expect(raw(stateEl).items[0].v).toBe(7);
      expect(txt(shadowRoot, ".c")).toEqual(["1"]);
      expect(errors).toEqual([]);
      host.remove();
    } finally {
      spy.mockRestore();
    }
  });

  it("createState の writable / readonly からも読み書きできる（Issue の 2 つ目の再現）", async () => {
    const { host, stateEl } = await mount({ items: items() });
    let got: unknown;
    stateEl.createState("writable", (s: any) => { s["items.0.v"] = 5; });
    stateEl.createState("readonly", (s: any) => { got = s["items.0.v"]; });
    expect(got).toBe(5);
    expect(raw(stateEl).items[0].v).toBe(5);
    host.remove();
  });

  it("描いていないリストの行への書き込みが $watch に届く", async () => {
    const log: unknown[] = [];
    const { host, stateEl } = await mount({
      items: items(),
      $watch: { "items.*.v"(cur: unknown, prev: unknown, i: unknown) { log.push([cur, prev, i]); } },
    });
    write(stateEl, (s) => { s["items.0.v"] = 5; });
    await flush();
    expect(log).toEqual([[5, 1, 0]]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 走査を経ていない $resolve / $postUpdate
// ---------------------------------------------------------------------------

describe("走査を経ていないリストへの $resolve / $postUpdate", () => {
  it("cold な $resolve で読み書きできる", async () => {
    const { host, stateEl } = await mount({ items: items(), groups: groups() });

    // 修正前: "[@wcstack/state] ListIndexes not found: items"（…: groups）
    expect(read(stateEl, (s) => s.$resolve("items.*.v", [1]))).toBe(2);
    expect(writeError(stateEl, (s) => { s.$resolve("items.*.v", [0], 5); })).toBe("");
    expect(raw(stateEl).items[0].v).toBe(5);
    expect(read(stateEl, (s) => s.$resolve("groups.*.items.*.v", [1, 0]))).toBe(3);
    write(stateEl, (s) => { s.$resolve("groups.*.items.*.v", [1, 0], 33); });
    expect(raw(stateEl).groups[1].items[0].v).toBe(33);
    host.remove();
  });

  it("$postUpdate(\"items.0.v\") が投げず、生データを直接変えた値を getter に読み直させる", async () => {
    const state: any = { items: items() };
    Object.defineProperty(state, "first", {
      get(this: any) { return this["items.0.v"]; }, enumerable: true, configurable: true,
    });
    const { host, stateEl, shadowRoot } = await mount(state, `<span class="f" data-wcs="textContent: first"></span>`);
    expect(txt(shadowRoot, ".f")).toEqual(["1"]);

    raw(stateEl).items[0].v = 9; // proxy を通らない変異
    // 修正前: "[@wcstack/state] ListIndex not found: items"
    expect(writeError(stateEl, (s) => { s.$postUpdate("items.0.v"); })).toBe("");
    await flush();
    expect(txt(shadowRoot, ".f")).toEqual(["9"]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 台帳の同一性
// ---------------------------------------------------------------------------

describe("その場で生やした台帳の同一性", () => {
  it("描いていないリストに添字で書いた後で for が描き始めると、その行を採用して正しく描く", async () => {
    const { host, stateEl, shadowRoot } = await mount({ show: false, items: items() },
      `<template data-wcs="if: show"><template data-wcs="for: items">` +
      `<i class="v" data-wcs="textContent: .v"></i></template></template>`);
    const list = raw(stateEl).items;
    expect(getListIndexesByList(list)).toBeNull();

    write(stateEl, (s) => { s["items.0.v"] = 5; });
    const rowsBefore = getListIndexesByList(list)!;
    expect(rowsBefore).toHaveLength(2);

    write(stateEl, (s) => { s.show = true; });
    await flush();
    expect(txt(shadowRoot, ".v")).toEqual(["5", "2"]);
    // for は差分を取り直して別の行を鋳造せず、直接添字が生やした台帳をそのまま使う
    const rowsAfter = getListIndexesByList(list)!;
    expect(rowsAfter).toBe(rowsBefore);
    expect(rowsAfter[0]).toBe(rowsBefore[0]);
    expect(rowsAfter[1]).toBe(rowsBefore[1]);

    // 描き始めた後も、添字の書き込み・$resolve・並べ替えが描画に届く
    write(stateEl, (s) => { s["items.1.v"] = 6; s.$resolve("items.*.v", [0], 7); });
    await flush();
    expect(txt(shadowRoot, ".v")).toEqual(["7", "6"]);
    write(stateEl, (s) => { s.items = [...s.items].reverse(); });
    await flush();
    expect(txt(shadowRoot, ".v")).toEqual(["6", "7"]);
    write(stateEl, (s) => { s["items.0.v"] = 60; });
    await flush();
    expect(txt(shadowRoot, ".v")).toEqual(["60", "7"]);
    host.remove();
  });

  it("入れ子: groups を描いたまま groups.*.items を後から描くと、先に書いた値で描く", async () => {
    const { host, stateEl, shadowRoot } = await mount({ show: false, groups: groups() },
      `<template data-wcs="for: groups"><b data-wcs="textContent: .name"></b>` +
      `<template data-wcs="if: show"><template data-wcs="for: .items">` +
      `<i class="v" data-wcs="textContent: .v"></i></template></template></template>`);
    const inner = raw(stateEl).groups[1].items;

    write(stateEl, (s) => { s["groups.1.items.0.v"] = 30; });
    const rowsBefore = getListIndexesByList(inner)!;
    // その場で生やした行は、描かれている親の行のもとにある
    expect(rowsBefore[0].parentListIndex).toBe(getListIndexesByList(raw(stateEl).groups)![1]);

    write(stateEl, (s) => { s.show = true; });
    await flush();
    expect(txt(shadowRoot, ".v")).toEqual(["1", "2", "30"]);
    expect(getListIndexesByList(inner)![0]).toBe(rowsBefore[0]);

    write(stateEl, (s) => { s["groups.0.items.1.v"] = 20; });
    await flush();
    expect(txt(shadowRoot, ".v")).toEqual(["1", "20", "30"]);
    host.remove();
  });

  it("$getAll で観測済みのリストを中身の同じ写しに置き換えた後でも、添字の書き込みが $getAll と添字の読みに見える", async () => {
    // 空を基準に行を鋳造すると、この形で後の $getAll が台帳ごと基準側の行へ差し替え、
    // 書き込みが載った行のキャッシュが置き去りになる（$getAll は [1, 2]、添字の読みは 1 を返した）。
    const { host, stateEl } = await mount({ items: items() });
    expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([1, 2]);
    const observedRows = getListIndexesByList(raw(stateEl).items)!;

    write(stateEl, (s) => { s.items = [...s.items]; });
    await flush();
    const copy = raw(stateEl).items;
    expect(getListIndexesByList(copy), "置換は台帳を作らない（描画も依存も無い）").toBeNull();

    write(stateEl, (s) => { s["items.0.v"] = 5; });
    await flush();
    const rows = getListIndexesByList(copy)!;

    expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([5, 2]);
    expect(read(stateEl, (s) => s["items.0.v"])).toBe(5);
    expect(getListIndexesByList(copy), "$getAll は台帳を差し替えない").toBe(rows);
    // 基準（$getAll が観測した配列）と同じ要素の行は、$getAll と同じ規則で再利用される
    expect(rows[0]).toBe(observedRows[0]);
    expect(rows[1]).toBe(observedRows[1]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 配列を丸ごと置換した後
// ---------------------------------------------------------------------------

describe("配列を丸ごと置換した後の添字アクセス", () => {
  it("置換した配列でも添字で読み書きでき、$getAll と一致する", async () => {
    const { host, stateEl } = await mount({ items: items() });
    write(stateEl, (s) => { s["items.0.v"] = 5; });
    expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([5, 2]);
    const rowsBefore = getListIndexesByList(raw(stateEl).items)!;

    write(stateEl, (s) => { s.items = [{ v: 7 }, ...s.items]; });
    await flush();
    // 修正前: 置換後の配列には台帳が無く、"[@wcstack/state] ListIndex not found: items"
    write(stateEl, (s) => { s["items.2.v"] = 22; });
    const rowsAfter = getListIndexesByList(raw(stateEl).items)!;
    // 残った要素の行は再利用され、位置だけが進む
    expect(rowsAfter[1]).toBe(rowsBefore[0]);
    expect(rowsAfter[2]).toBe(rowsBefore[1]);
    expect(rowsAfter.map((r) => r.index)).toEqual([0, 1, 2]);

    expect(raw(stateEl).items.map((x: any) => x.v)).toEqual([7, 5, 22]);
    expect(read(stateEl, (s) => [s["items.0.v"], s["items.1.v"], s["items.2.v"]])).toEqual([7, 5, 22]);
    expect(read(stateEl, (s) => s.$getAll("items.*.v", []))).toEqual([7, 5, 22]);
    host.remove();
  });

  it("$setAll の後に置換した配列でも添字で読み書きできる", async () => {
    const { host, stateEl } = await mount({ items: items() });
    expect(writeCount(stateEl, (s) => s.$setAll("items.*.v", [], 3))).toBe(2);
    write(stateEl, (s) => { s.items = [{ v: 10 }, { v: 20 }]; });
    await flush();
    expect(read(stateEl, (s) => s["items.0.v"])).toBe(10);
    write(stateEl, (s) => { s["items.0.v"] = 11; });
    expect(raw(stateEl).items[0].v).toBe(11);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// トップレベル getter が添字のパスを読む
// ---------------------------------------------------------------------------

describe("トップレベル getter が添字のパスを読む", () => {
  const withFirst = () => {
    const state: any = { items: items() };
    Object.defineProperty(state, "first", {
      get(this: any) { return this["items.0.v"]; }, enumerable: true, configurable: true,
    });
    return state;
  };

  it("for より前に置いた binding が初期表示し、書き込み・配列置換に追従する", async () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args); });
    try {
      // binding は文書順に適用されるので、getter は for がリストを描くより前に評価される
      const { host, stateEl, shadowRoot } = await mount(withFirst(),
        `<span class="f" data-wcs="textContent: first"></span>` +
        `<template data-wcs="for: items"><i class="v" data-wcs="textContent: .v"></i></template>`);
      await flush();
      // 修正前: 空のまま、`binding "prop: first" failed to apply` が console.error に出た
      expect(txt(shadowRoot, ".f")).toEqual(["1"]);
      expect(txt(shadowRoot, ".v")).toEqual(["1", "2"]);

      write(stateEl, (s) => { s["items.0.v"] = 42; });
      await flush();
      expect(txt(shadowRoot, ".f")).toEqual(["42"]);
      expect(txt(shadowRoot, ".v")).toEqual(["42", "2"]);

      write(stateEl, (s) => { s.$resolve("items.*.v", [0], 43); });
      await flush();
      expect(txt(shadowRoot, ".f")).toEqual(["43"]);

      write(stateEl, (s) => { s.items = [{ v: 100 }, ...s.items]; });
      await flush();
      expect(txt(shadowRoot, ".f")).toEqual(["100"]);
      expect(txt(shadowRoot, ".v")).toEqual(["100", "43", "2"]);
      expect(errors).toEqual([]);
      host.remove();
    } finally {
      spy.mockRestore();
    }
  });

  it("対照: for の後に置いた binding（修正前から表示できていた形）も同じに表示・追従する", async () => {
    // for が先にリストを描くので、getter が読むときには台帳がもうある
    const { host, stateEl, shadowRoot } = await mount(withFirst(),
      `<template data-wcs="for: items"><i class="v" data-wcs="textContent: .v"></i></template>` +
      `<span class="f" data-wcs="textContent: first"></span>`);
    await flush();
    expect(txt(shadowRoot, ".f")).toEqual(["1"]);
    write(stateEl, (s) => { s["items.0.v"] = 42; });
    await flush();
    expect(txt(shadowRoot, ".f")).toEqual(["42"]);
    expect(txt(shadowRoot, ".v")).toEqual(["42", "2"]);
    host.remove();
  });

  it("for が無くても表示し、書き込み・配列置換に追従する", async () => {
    const { host, stateEl, shadowRoot } = await mount(withFirst(), `<span class="f" data-wcs="textContent: first"></span>`);
    await flush();
    expect(txt(shadowRoot, ".f")).toEqual(["1"]);

    write(stateEl, (s) => { s["items.0.v"] = 9; });
    await flush();
    expect(txt(shadowRoot, ".f")).toEqual(["9"]);

    write(stateEl, (s) => { s.items = [{ v: 100 }]; });
    await flush();
    expect(txt(shadowRoot, ".f")).toEqual(["100"]);

    write(stateEl, (s) => { s["items.0.v"] = 101; });
    await flush();
    expect(txt(shadowRoot, ".f")).toEqual(["101"]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 行が無い添字
// ---------------------------------------------------------------------------

describe("行が無い添字は、描いていないリストでも index 付きで投げる", () => {
  it("範囲外の添字（直接の読み・書き・$resolve）", async () => {
    const { host, stateEl } = await mount({ items: items() });
    const message = "[@wcstack/state] ListIndex not found at index 5 of items";
    // 修正前（描いていないリスト）: "ListIndex not found: items" / "ListIndexes not found: items"
    expect(() => read(stateEl, (s) => s["items.5.v"])).toThrow(message);
    expect(writeError(stateEl, (s) => { s["items.5.v"] = 1; })).toBe(message);
    expect(() => read(stateEl, (s) => s.$resolve("items.*.v", [5]))).toThrow(message);
    expect(raw(stateEl).items).toEqual([{ v: 1 }, { v: 2 }]);
    host.remove();
  });

  it("配列でない値（null・文字列）と空配列は、行が 1 つも無いものとして index 0 で投げる", async () => {
    const { host, stateEl } = await mount({ items: null, text: "abc", empty: [] as unknown[] });
    const nullMessage = "[@wcstack/state] ListIndex not found at index 0 of items";
    expect(() => read(stateEl, (s) => s["items.0.v"])).toThrow(nullMessage);
    expect(writeError(stateEl, (s) => { s["items.0.v"] = 1; })).toBe(nullMessage);
    expect(() => read(stateEl, (s) => s.$resolve("items.*.v", [0]))).toThrow(nullMessage);
    expect(raw(stateEl).items).toBeNull();
    // 文字列は配列として扱わない（"abc"[0] を返さない）
    expect(() => read(stateEl, (s) => s["text.0"])).toThrow("[@wcstack/state] ListIndex not found at index 0 of text");
    expect(() => read(stateEl, (s) => s["empty.0"])).toThrow("[@wcstack/state] ListIndex not found at index 0 of empty");
    host.remove();
  });

  it("入れ子の段が配列でない（undefined）ときは、その段のパスを名指しする", async () => {
    const { host, stateEl } = await mount({ groups: [{ name: "g0" }] });
    const message = "[@wcstack/state] ListIndex not found at index 0 of groups.*.items";
    expect(() => read(stateEl, (s) => s["groups.0.items.0.v"])).toThrow(message);
    expect(() => read(stateEl, (s) => s.$resolve("groups.*.items.*.v", [0, 0]))).toThrow(message);
    host.remove();
  });
});

/**
 * 生やした台帳は、state 側の基準も確定する（`$getAll` と同じ）。確定しないと、描いていないリストは
 * 依存ウォークも差分を取らないので、写し替えても生やした行が退役せず、子リストの台帳が古い行に
 * ぶら下がる — 後から描いた行の集計 getter が、葉の書き込みに恒久的に追従しなくなっていた。
 */
describe("添字で触れた後にリストを写し替えても、行の集計が追従する", () => {
  const MARKUP = `<template data-wcs="if: show"><template data-wcs="for: groups">`
    + `<b class="t" data-wcs="textContent: .total"></b>`
    + `<template data-wcs="for: .items"><i class="v" data-wcs="textContent: .v"></i></template></template></template>`;
  const init = (): any => {
    const state: any = { show: false, groups: [{ items: [{ v: 1 }, { v: 2 }] }, { items: [{ v: 3 }] }] };
    Object.defineProperty(state, "groups.*.total", {
      get(this: any) { return this.$getAll("groups.*.items.*.v").reduce((a: number, b: number) => a + b, 0); },
      enumerable: true,
      configurable: true,
    });
    return state;
  };
  const texts = (root: ShadowRoot, selector: string) =>
    Array.from(root.querySelectorAll(selector)).map((node) => node.textContent);

  for (const [label, touch] of [
    ["読むだけ", (s: any) => { void s["groups.0.items.0.v"]; }],
    ["書き込み", (s: any) => { s["groups.0.items.0.v"] = 10; }],
    ["$resolve の読み", (s: any) => { void s.$resolve("groups.*.items.*.v", [0, 0]); }],
  ] as const) {
    for (const [copyLabel, copy] of [
      ["map で写す", (s: any) => { s.groups = s.groups.map((g: any) => ({ ...g })); }],
      ["slice で写す", (s: any) => { s.groups = [...s.groups]; }],
    ] as const) {
      it(`${label} → ${copyLabel} → 表示 → 葉の書き込み`, async () => {
        const { host, stateEl, shadowRoot } = await mount(init(), MARKUP);
        if (label === "読むだけ" || label === "$resolve の読み") {
          read(stateEl, touch);
        } else {
          write(stateEl, touch);
        }
        write(stateEl, copy);
        await flush();
        write(stateEl, (s) => { s.show = true; });
        await flush();
        const first = label === "書き込み" ? 10 : 1;
        expect(texts(shadowRoot, ".t")).toEqual([String(first + 2), "3"]);

        write(stateEl, (s) => { s["groups.0.items.1.v"] = 50; });
        await flush();
        expect(texts(shadowRoot, ".t")).toEqual([String(first + 50), "3"]);
        expect(texts(shadowRoot, ".v")).toEqual([String(first), "50", "3"]);
        host.remove();
      });
    }
  }
});
