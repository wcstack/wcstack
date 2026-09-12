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
 *    共有者が 3 行いても、追従するのは残ったうちの 1 行だけ（行集合は 1 組しかない）。
 *  - **外した行そのもののオブジェクトが戻ってくれば、持ち主も戻る。** 同じ配列インスタンス／
 *    同じ行を並べた新しい配列／違う位置、のいずれでも返る。判定は行が表しているリスト要素の
 *    identity で、添字でも配列インスタンスでもない。
 *  - **全ての行を作り直す綴り**（`map(n => ({...n}))`）ではどの要素も一致しないので、行集合は
 *    持ち主が居た**位置を占める行**に付く。1 行だけ作り直した場合は、生き残った行の方に付く。
 *  - 持ち主が戻ったあとの「親を読む行 getter の文脈」は、外した行が戻ってくる綴りなら main と
 *    一致する。集計がどの行を追従するかは、**同じ配列インスタンスで戻した綴りだけ** main と
 *    一致し、それ以外の綴りでは branch だけが追従する（main は両方の行が凍る）。
 *
 * 併記した main の数字は実測（`git archive main` で取り出した木に同じ fixture を
 * 流した結果）。DOM と `$getAll` の両方を見る —— 描画だけの話ではないため。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { flush, makeMount, read, write, writeCount } from "./helpers/recursionTestUtils";

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

  /**
   * 行を戻す**普通のやり方**。新しい配列に同じ行オブジェクトを並べ直すと、差分は行 0 の
   * ListIndex を作り直すので、行オブジェクトの identity では「戻ってきた」と言えない。
   * それでも持ち主が返るのは、行が表している**リスト要素**で判定しているから。
   * main はこの綴りでは行集合が退役した行にぶら下がったままなので、両方の行が凍る。
   */
  it("新しい配列に同じ行オブジェクトを並べて戻しても、持ち主はその行へ返ること", async () => {
    const RESTORES: [string, (s: any, n0: any, n1: any) => void][] = [
      ["同じ行オブジェクトを並べた新しい配列", (s, n0, n1) => { s.nodes = [n0, n1]; }],
      ["先頭に足して残りを spread", (s, n0) => { s.nodes = [n0, ...s.nodes]; }],
    ];
    for (const [label, restore] of RESTORES) {
      const { state } = plainFixture();
      const n0 = state.nodes[0];
      const n1 = state.nodes[1];
      const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR);
      const totals = () => read(stateEl, (s: any) => s.$getAll("nodes.*.total", []));

      write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
      await flush();
      write(stateEl, (s: any) => { restore(s, n0, n1); });
      await flush();
      expect(texts(shadowRoot, ".rt"), `${label}: 戻したところ（main と同じ）`).toEqual(["31", "32"]);

      // 追従するのは戻した行 0。main 実測: どちらの書き込みでも ["31","32"] のまま凍る
      for (const [v, t0] of [[99, 120], [111, 132]] as [number, number][]) {
        write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], v); });
        await flush();
        expect(texts(shadowRoot, ".rt"), `${label}: 葉に ${v}`).toEqual([String(t0), "32"]);
        expect(totals(), `${label}: 葉に ${v}（$getAll も同じ）`).toEqual([t0, 32]);
      }
      host.remove();
    }
  });

  /**
   * 戻すときに順序を入れ替えた形。持ち主は「添字 0 の行」ではなく**行オブジェクト**へ返る。
   */
  it("順序を入れ替えて戻すと、持ち主は添字ではなく行オブジェクトへ返ること", async () => {
    const { state } = plainFixture();
    const n0 = state.nodes[0];
    const n1 = state.nodes[1];
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
    await flush();
    write(stateEl, (s: any) => { s.nodes = [n1, n0]; });
    await flush();
    expect(texts(shadowRoot, ".rt"), "並びは [n1, n0]（main と同じ）").toEqual(["32", "31"]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], 99); });
    await flush();
    // 追従するのは持ち主の行オブジェクト n0（いまは添字 1）。main 実測: ["32","31"]
    expect(texts(shadowRoot, ".rt")).toEqual(["32", "120"]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([32, 120]);
    host.remove();
  });

  /**
   * 戻す綴りのうち**ここだけ**持ち主が戻らない。`{...n0}` は別の行オブジェクトなので、
   * 「外した行が戻ってきた」ことにはならない（main も別の行として扱う）。
   */
  it("行オブジェクトごと作り直して戻した行は別の行なので、持ち主が戻らないこと", async () => {
    const { state } = plainFixture();
    const n0 = state.nodes[0];
    const n1 = state.nodes[1];
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
    await flush();
    write(stateEl, (s: any) => { s.nodes = [{ ...n0 }, n1]; });
    await flush();
    expect(texts(shadowRoot, ".rt"), "戻したところ（main と同じ）").toEqual(["31", "32"]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], 99); });
    await flush();
    // 持ち主は画面に残っていた行 1 のまま（2 + 99 + 20）。main 実測: ["31","32"]（両方凍る）
    expect(texts(shadowRoot, ".rt")).toEqual(["31", "121"]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([31, 121]);
    host.remove();
  });

  /**
   * 全ての行を作り直す綴り（#256 の見出しの更新そのもの）。どの行も home に一致しないので、
   * 行集合は持ち主が居た位置を占める行に付き、その行が追従する。main 実測: ["31","32"]（両方凍る）。
   */
  it("全ての行を作り直して戻すと、持ち主は元の位置を占める行に付くこと", async () => {
    const { state } = plainFixture();
    const n0 = state.nodes[0];
    const n1 = state.nodes[1];
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
    await flush();
    write(stateEl, (s: any) => { s.nodes = [n0, n1].map((n) => ({ ...n })); });
    await flush();

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], 99); });
    await flush();
    expect(texts(shadowRoot, ".rt"), "位置 0 の行が追従する").toEqual(["120", "32"]);
    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], 111); });
    await flush();
    expect(texts(shadowRoot, ".rt")).toEqual(["132", "32"]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([132, 32]);
    host.remove();
  });

  /**
   * 同じく全て作り直し、順序も入れ替える。位置 0 に来るのは**生き残っていた行**の複製なので、
   * 追従するのはその行（2 + 99 + 20 = 121）。持ち主が行ではなく位置に付くことの証拠。
   * main 実測: ["32","31"]。
   */
  it("全て作り直して順序も入れ替えると、追従するのは位置 0 に来た行であること", async () => {
    const { state } = plainFixture();
    const n0 = state.nodes[0];
    const n1 = state.nodes[1];
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
    await flush();
    write(stateEl, (s: any) => { s.nodes = [{ ...n1 }, { ...n0 }]; });
    await flush();

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], 99); });
    await flush();
    expect(texts(shadowRoot, ".rt")).toEqual(["121", "31"]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([121, 31]);
    host.remove();
  });
  it("新しい配列で戻しても、親を読む getter の文脈は main と同じに戻ること", async () => {
    const { state } = upwardFixture();
    const n0 = state.nodes[0];
    const n1 = state.nodes[1];
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR_W);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
    await flush();
    write(stateEl, (s: any) => { s.nodes = [n0, n1]; });
    await flush();
    // main 実測: ["10","20","10","20"]
    expect(texts(shadowRoot, ".cw"), "持ち主（行 0・value 1）の文脈へ戻る")
      .toEqual(["10", "20", "10", "20"]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], 99); });
    await flush();
    // 文脈は main と同じ（["99","20","99","20"]）。違うのは集計がどの行を追従するかだけで、
    // main 実測は rt ["31","32"]。
    expect(texts(shadowRoot, ".cw")).toEqual(["99", "20", "99", "20"]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.children.*.weighted", [])))
      .toEqual([99, 20, 99, 20]);
    expect(texts(shadowRoot, ".rt")).toEqual(["120", "32"]);
    host.remove();
  });

  it("1 行だけ作り直して戻した場合は、親を読む getter の文脈も戻らないこと", async () => {
    const { state } = upwardFixture();
    const n0 = state.nodes[0];
    const n1 = state.nodes[1];
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR_W);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
    await flush();
    write(stateEl, (s: any) => { s.nodes = [{ ...n0 }, n1]; });
    await flush();
    // main 実測: ["10","20","10","20"]（退役した行 0 の文脈のまま）
    expect(texts(shadowRoot, ".cw"), "残った行 1（value 2）の文脈のまま")
      .toEqual(["20", "40", "20", "40"]);
    host.remove();
  });

  /**
   * 「画面に残っている行が追従する」は**単数**。共有者が 3 行いて持ち主を外すと、
   * 行集合は 1 組しかないので残った 2 行のうち 1 行だけが追従し、もう 1 行は凍る。
   */
  it("3 行が共有していると、持ち主を外したあと追従するのは残った 1 行だけであること", async () => {
    const kids = [NODE(10), NODE(20)];
    const state: any = { nodes: [NODE(1, kids), NODE(2, kids), NODE(3, kids)] };
    Object.defineProperty(state, "nodes.*.total", {
      get(this: any) {
        return this["nodes.*.value"] +
          this.$getAll("nodes.*.children.*.value").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR);
    expect(texts(shadowRoot, ".rt")).toEqual(["31", "32", "33"]);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1], s.nodes[2]]; });
    await flush();
    expect(texts(shadowRoot, ".rt")).toEqual(["32", "33"]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], 99); });
    await flush();
    // 追従するのは 1 行目だけ（2 + 99 + 20）。main 実測: ["32","33"]（どちらも凍る）
    expect(texts(shadowRoot, ".rt")).toEqual(["121", "33"]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [1, 1], 77); });
    await flush();
    // 2 行目の経路から書いても、追従するのは同じ 1 行目（2 + 99 + 77）。main 実測: ["32","33"]
    expect(texts(shadowRoot, ".rt")).toEqual(["178", "33"]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([178, 33]);
    host.remove();
  });

  /**
   * 持ち主を外したあとの `$setAll`。書いたスロット数も値も main と同じで、
   * 違うのは集計が追従するかどうかだけ。
   */
  it("持ち主を外したあとの $setAll は、件数も値も main と同じで、集計だけが追従すること", async () => {
    const { state } = plainFixture();
    const { host, shadowRoot, stateEl } = await mount(state, NESTED_FOR);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1]]; });
    await flush();
    const count = writeCount(stateEl, (s: any) =>
      s.$setAll("nodes.*.children.*.value", [], (c: number) => c + 1));
    await flush();

    expect(count, "書いたスロット数（main も 2）").toBe(2);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.children.*.value", [])), "値も main と同じ")
      .toEqual([11, 21]);
    expect(texts(shadowRoot, ".cv")).toEqual(["11", "21"]);
    // 集計だけが共有データを追従する（2 + 11 + 21）。main 実測: ["32"] のまま凍る
    expect(texts(shadowRoot, ".rt")).toEqual(["34"]);
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
