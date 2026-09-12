/**
 * integration.sharedListRowRevival.test.ts — 1 本の `children` 配列を 2 つの行が
 * **共有**しているページで、行を削除・復元したときに「その配列の行集合が誰に
 * ぶら下がるか」（#256）。
 *
 * 台帳は 1 本の配列につき行集合 1 組なので、その行集合は常にどれか 1 つの行に
 * ぶら下がる（＝持ち主）。#256 の修理は持ち主を「退役した行」から「生きた行」へ
 * 移すもので、ここで固定するのは移った先と、**戻り**:
 *
 *  - 2 行が両方リストに居る間は main と同じ。どちらの経路から読んでも同じ値で、
 *    親を読む行 getter は持ち主（最初にその配列を展開した行）の文脈で評価される。
 *  - 持ち主をリストから外すと、行集合は画面に残っている行へ移る。**ここは main と
 *    違う**（main は退役した行にぶら下がったままなので、残った行の集計が凍る）。
 *  - **外した行を戻すと持ち主も戻る。** 退役の印は差分ごとに付け直されるので、
 *    削除の履歴によって持ち主が変わったまま固定されることはない。ここは main と一致する。
 *
 * 併記した main の数字は実測（`git archive main` で取り出した木に同じ fixture を
 * 流した結果）。DOM と `$getAll` の両方を見る —— 描画だけの話ではないため。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { flush, makeMount, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("sharedrevival-host");
const NODE = (value: number, children: any[] = []) => ({ value, children });

/** 2 行が 1 本の `children` 配列を共有。集計は **親を読まない**（自分の value + 子の value）。 */
function plainFixture() {
  const kids = [NODE(10), NODE(20)];
  const state: any = { nodes: [NODE(1, kids), NODE(2, kids)] };
  Object.defineProperty(state, "nodes.*.total", {
    get(this: any) {
      return this["nodes.*.value"] +
        this.$getAll("nodes.*.children.*.value").reduce((a: number, b: number) => a + b, 0);
    },
    enumerable: true, configurable: true,
  });
  return { kids, state };
}

/** 同じ共有に、**親を読む** 行 getter（weighted = 親の value × 自分の value）を足したもの。 */
function upwardFixture() {
  const kids = [NODE(10), NODE(20)];
  const state: any = { nodes: [NODE(1, kids), NODE(2, kids)] };
  Object.defineProperty(state, "nodes.*.children.*.weighted", {
    get(this: any) { return this["nodes.*.value"] * this["nodes.*.children.*.value"]; },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(state, "nodes.*.total", {
    get(this: any) {
      return this["nodes.*.value"] +
        this.$getAll("nodes.*.children.*.value").reduce((a: number, b: number) => a + b, 0);
    },
    enumerable: true, configurable: true,
  });
  return { kids, state };
}

const NESTED_FOR =
  `<div><template data-wcs="for: nodes"><div class="row">` +
  `<b class="rt">{{ .total }}</b>` +
  `<template data-wcs="for: nodes.*.children"><i class="cv">{{ .value }}</i></template>` +
  `</div></template></div>`;
const NESTED_FOR_W =
  `<div><template data-wcs="for: nodes"><div class="row">` +
  `<b class="rt">{{ .total }}</b>` +
  `<template data-wcs="for: nodes.*.children"><i class="cv">{{ .value }}</i>` +
  `<i class="cw">{{ .weighted }}</i></template>` +
  `</div></template></div>`;

const texts = (sr: ShadowRoot, sel: string) =>
  Array.from(sr.querySelectorAll(sel)).map((e) => e.textContent);

describe("共有した children 配列の持ち主（#256）", () => {
  /**
   * T1 の形。行 0 を落として**元の配列を戻し**、葉に何度も書く。
   * 行集合は行 0 → 行 1 → 行 0 と動いて元に戻るので、書き込みの追従は main と一致する。
   */
  it("行を削除して戻したあとの葉の書き込みは、main と同じ行を追従させること", async () => {
    const { state } = plainFixture();
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR);
    const original = state.nodes;
    const totals = () => read(stateEl, (s: any) => s.$getAll("nodes.*.total", []));

    expect(texts(shadowRoot, ".rt")).toEqual(["31", "32"]);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
    await flush();
    expect(shadowRoot.querySelectorAll(".row"), "行 0 を落とした").toHaveLength(1);

    write(stateEl, (s: any) => { s.nodes = original; });
    await flush();
    expect(texts(shadowRoot, ".rt"), "戻したところ（main と同じ）").toEqual(["31", "32"]);
    expect(totals()).toEqual([31, 32]);

    // 葉（共有配列の 0 番）に 3 回書く。追従するのは行 0（＝持ち主が戻っている）。
    // main 実測: 120 / 132 / 243 ── 1 文字も違わない。
    for (const [v, t0] of [[99, 120], [111, 132], [222, 243]] as [number, number][]) {
      write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], v); });
      await flush();
      expect(texts(shadowRoot, ".rt"), `葉に ${v}`).toEqual([String(t0), "32"]);
      expect(totals(), `葉に ${v}（$getAll も同じ）`).toEqual([t0, 32]);
    }
    // 行 1 の経路から書いても、追従するのは持ち主の行 0（main 実測: 278）
    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [1, 1], 55); });
    await flush();
    expect(texts(shadowRoot, ".rt")).toEqual(["278", "32"]);
    expect(totals()).toEqual([278, 32]);
    // 行 0 自身の value を書く（main 実測: 284）
    write(stateEl, (s: any) => { s.$resolve("nodes.*.value", [0], 7); });
    await flush();
    expect(texts(shadowRoot, ".rt")).toEqual(["284", "32"]);
    expect(totals()).toEqual([284, 32]);
    // 共有なので、2 行の子セルは常に同じ値を映す
    expect(texts(shadowRoot, ".cv")).toEqual(["222", "55", "222", "55"]);
    host.remove();
  });

  /**
   * 持ち主を外したまま（戻さない）。**ここだけは main と違う**。
   * 画面に残っているのは行 1 だけで、その集計は共有データを追従する（2 + 99 + 20 = 121）。
   * main は行集合が退役した行 0 にぶら下がったままなので "32"（= 2 + 10 + 20）で凍る。
   */
  it("持ち主を外している間は、画面に残った行の集計が共有データを追従すること（main は凍る）", async () => {
    const { state } = plainFixture();
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
    await flush();
    expect(texts(shadowRoot, ".rt")).toEqual(["32"]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], 99); });
    await flush();
    expect(texts(shadowRoot, ".cv"), "葉は書けている").toEqual(["99", "20"]);
    expect(texts(shadowRoot, ".rt"), "2 + 99 + 20（main 実測: 32 のまま）").toEqual(["121"]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", [])), "$getAll も同じ")
      .toEqual([121]);
    host.remove();
  });

  /**
   * 親を読む行 getter でも同じ。外している間は残った行の文脈（2 × 10 / 2 × 20）、
   * 戻せば持ち主の文脈（1 × …）に戻り main と一致する。
   */
  it("親を読む行 getter は、持ち主が外れている間だけ残った行の文脈で評価されること", async () => {
    const { state } = upwardFixture();
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR_W);
    expect(texts(shadowRoot, ".cw"), "初期は持ち主（行 0・value 1）の文脈")
      .toEqual(["10", "20", "10", "20"]);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
    await flush();
    // main 実測: ["10","20"]（退役した行 0 の文脈のまま）
    expect(texts(shadowRoot, ".cw"), "残った行 1（value 2）の文脈").toEqual(["20", "40"]);
    host.remove();
  });

  it("持ち主を戻せば、親を読む getter の文脈も main と同じに戻ること", async () => {
    const { state } = upwardFixture();
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR_W);
    const original = state.nodes;

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
    await flush();
    write(stateEl, (s: any) => { s.nodes = original; });
    await flush();
    // main 実測: ["10","20","10","20"] / rt ["31","32"]
    expect(texts(shadowRoot, ".cw"), "持ち主（行 0）の文脈へ戻る").toEqual(["10", "20", "10", "20"]);
    expect(texts(shadowRoot, ".rt")).toEqual(["31", "32"]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], 99); });
    await flush();
    // main 実測: cw ["99","20","99","20"] / rt ["120","32"]
    expect(texts(shadowRoot, ".cw")).toEqual(["99", "20", "99", "20"]);
    expect(texts(shadowRoot, ".rt")).toEqual(["120", "32"]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.children.*.weighted", [])))
      .toEqual([99, 20, 99, 20]);
    host.remove();
  });

  /**
   * 出荷文の「2 行は必ず同じ値で一致する」の固定。1 本の配列には行集合が 1 組しか
   * 無い ＝ 1 スロットに絶対アドレスが 1 本しか無いので、どちらの経路から書いても
   * どちらの経路から読んでも食い違わない（main と同じ）。
   */
  it("生きている 2 行は、どちらの経路から読んでも同じ値で一致すること", async () => {
    const { state } = plainFixture();
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], 99); });
    await flush();
    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [1, 1], 77); });
    await flush();

    const viaRow0 = read(stateEl, (s: any) => s.$getAll("nodes.*.children.*.value", [0]));
    const viaRow1 = read(stateEl, (s: any) => s.$getAll("nodes.*.children.*.value", [1]));
    expect(viaRow0, "行 0 から読む").toEqual([99, 77]);
    expect(viaRow1, "行 1 から読む ── 一致する").toEqual(viaRow0);
    expect(texts(shadowRoot, ".cv"), "描画も 2 行とも同じ").toEqual(["99", "77", "99", "77"]);
    host.remove();
  });
});

/**
 * 出荷文「行の identity で持っているものは残る」の**境界**。素の入れ子 `for` では、
 * 親の行オブジェクトが作り直されると、その行が描いている子リストの DOM は作り直される
 * （外側の行 DOM はプールから使い回され、内側の子セルは別ノードになる）。**main でも同じ**
 * ―― 同じ fixture を main の src に流して実測（行ノードは 2/2 が使い回され、子セルは 0/3）。
 * ここで固定するのは「#256 の修理がこの境界を動かしていない」こと。
 */
describe("置換で残るもの・残らないもの（素の入れ子 for・main と同じ）", () => {
  it("map-spread のあと、外側の行 DOM は使い回され、子リストの DOM は作り直されること", async () => {
    const state: any = { nodes: [NODE(1, [NODE(10), NODE(20)]), NODE(2, [NODE(30)])] };
    Object.defineProperty(state, "nodes.*.total", {
      get(this: any) {
        return this["nodes.*.value"] +
          this.$getAll("nodes.*.children.*.value").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR);
    const rowsBefore = Array.from(shadowRoot.querySelectorAll(".row"));
    const kidsBefore = Array.from(shadowRoot.querySelectorAll(".cv"));
    expect(kidsBefore.map((n) => n.textContent)).toEqual(["10", "20", "30"]);

    write(stateEl, (s: any) => { s.nodes = s.nodes.map((n: any) => ({ ...n })); });
    await flush();

    const rowsAfter = Array.from(shadowRoot.querySelectorAll(".row"));
    const kidsAfter = Array.from(shadowRoot.querySelectorAll(".cv"));
    expect(
      rowsAfter.filter((n) => rowsBefore.some((b) => b === n)),
      "外側の行 DOM はプールから使い回される（位置は入れ替わりうる）",
    ).toHaveLength(2);
    expect(kidsAfter.map((n) => n.textContent), "子セルの中身は同じ").toEqual(["10", "20", "30"]);
    expect(
      kidsAfter.filter((n) => kidsBefore.some((b) => b === n)),
      "子セルは作り直される（main でも同じ）",
    ).toHaveLength(0);
    host.remove();
  });
});
