/**
 * integration.recursionGetAll.test.ts — Phase C（`$getAll(path, [])` の全深さ合併）の
 * 実挙動を固定する統合テスト（docs/state-recursive-path-impl-plan.md §5）。
 *
 * Phase B までは `**` が「いま評価している深さ」に束縛される省略形しか無かった。
 * Phase C が足すのは **合併形** — `$getAll("nodes.**.value", [])` で、アンカー配下の
 * **全深さ**を 1 本の呼びで列挙する。省略形との違いは意味論であって最適化ではない。
 *
 *  - 省略形 `$getAll(p)` … `**` を評価深さに束縛し、そこから先は既存の固定 arity 走査。
 *    再帰集計 `total = 自分の value + 直下の子の total` が正しく畳まれるのはこの形。
 *  - 合併形 `$getAll(p, [])` … 深さそのものを走査する。返る添字タプルの長さが結果ごとに
 *    変わるので **値の配列しか返さない**（`$resolve` への往復は保証しない。設計書 §7-2）。
 *
 * このファイルが固定する契約は 12 個。
 *  1. 受け入れ値（実装計画 §5）— 三段の鎖 1 → 2 → 3 で total が 6 / 5 / 3、全 value の合計が 6。
 *     独立した検算として、`**` を使わない深さごとの読みを連結した多重集合とも突き合わせる。
 *  2. 順序 — 深さ優先・行きがけ・添字昇順。**兄弟を先に全部出してから降りる**（幅優先まがい）
 *     に退化したら赤くなる非対称な木で測る。
 *  3. 省略形と合併形の書き分け（設計書 §6-2）。合併形を集計 getter に使うと孫が二重計上される
 *     という設計書 §7-1 の警告そのものを、手で畳んだ値で固定する。
 *  4. 構造変更への追従（描画あり・なしの両方）。結果が「先に合併を読んだかどうか」に
 *     依存しないことも対で固定する（各 it 冒頭の読みは #324 までは `$resolve` の前提で、
 *     合併の側の都合ではなかった ── 偶然の救済の除外）。
 *  5. 空の枝への依存 — 一度読んだ空の children に初めて子が入ったら次の読みで現れる。
 *  6. 依存の登録 — `**` は依存グラフに載らないので、**触れた具体パス**が載る。対照として
 *     木に触らない書き込みでは再評価しないこと（無効化が一律でないこと）も置く。
 *  7. E6（D12）の診断 — 同じ配列インスタンスの共有と循環。対照としてノードオブジェクトだけの
 *     共有（children が空）は安全。
 *  8. 接尾辞にワイルドカードが残る形（`nodes.**.tags.*`）。
 *  9. 境界 — 空の木・深さ 1・存在しないプロパティ・木より深い接尾辞・接尾辞なし・
 *     配列でない子リスト（`children` の書き忘れ）。
 * 10. 形の診断 — 非空接頭辞は `[wcs/recursion-getall-form]`、宣言外のアンカーは
 *     `[wcs/recursion-anchor]`。トップレベル（再帰文脈の外）からの `[]` は成立する
 *     （省略形と違って深さを要求しないため）。
 * 11. イベントハンドラ（state のメソッド）からの読み — `for` の行からでも行の外からでも
 *     同じ列。行ハンドラでも行に束縛されない。
 * 12. `for` で描画したときに、DOM と `$getAll` が同じ木を語ること。
 *
 * `$setAll` の再帰形は Phase D なのでここでは触らない。
 *
 * 期待値はすべて実行して確かめたもの。手で畳んだ算術（`131 = 1 + (10 + 100) + 20`）は、
 * 二重計上が起きていないことの独立した検算として併記してある。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import {
  flush, forest, makeMount, node, read, recursionState as baseRecursionState, UNION_TOTAL, UNION_VALUES, write, writeError, type TNode,
} from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("recursion-getall-host");

/**
 * 標準の再帰 state（helpers/recursionTestUtils の基本形）に、ルートの**合併形**
 * `treeTotal` / `treeValues` を足したもの。`extra` で「合併形を集計に使ってしまった getter」などを足せる。
 */
function recursionState(
  nodes: TNode[],
  extra: Record<string, PropertyDescriptor> = {},
  recursion?: unknown,
): any {
  return baseRecursionState(nodes, { treeValues: UNION_VALUES, treeTotal: UNION_TOTAL, ...extra }, recursion);
}

/** 深さ d の value / total パス */
const valueAt = (d: number) => "nodes.*" + ".children.*".repeat(d) + ".value";
const totalAt = (d: number) => "nodes.*" + ".children.*".repeat(d) + ".total";

/** `for` も data-wcs も持たない（描画ゼロ） */
const NO_RENDER_HTML = `<div></div>`;

/** 3 段の `for` でツリーを描く（各段の value を表示する） */
const TREE_HTML =
  `<div><span class="sum">{{ treeTotal }}</span>` +
  `<template data-wcs="for: nodes">` +
  `<div><span class="v0">{{ .value }}</span>` +
  `<template data-wcs="for: nodes.*.children">` +
  `<div><span class="v1">{{ .value }}</span>` +
  `<template data-wcs="for: nodes.*.children.*.children">` +
  `<div><span class="v2">{{ .value }}</span></div>` +
  `</template></div></template></div></template></div>`;

const texts = (sr: ShadowRoot, sel: string) =>
  Array.from(sr.querySelectorAll(sel)).map((e) => e.textContent!.trim());
const treeDom = (sr: ShadowRoot) => ({
  sum: texts(sr, ".sum")[0],
  v0: texts(sr, ".v0"),
  v1: texts(sr, ".v1"),
  v2: texts(sr, ".v2"),
});

// ===========================================================================
// 1. 受け入れ値（実装計画 §5）
// ===========================================================================

describe("合併形 $getAll(path, []): 受け入れ値", () => {
  it("三段の鎖 1 → 2 → 3 で total が 6 / 5 / 3、value の合併が [1, 2, 3] になること", async () => {
    // 実装計画 §5 の受け入れ値そのもの。手で畳むと 3 / 2+3=5 / 1+5=6。
    const { host, stateEl } = await mount(
      recursionState([node(1, [node(2, [node(3)])])]), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", [])), "全深さの total")
      .toEqual([6, 5, 3]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", [])), "全深さの value")
      .toEqual([1, 2, 3]);
    host.remove();
  });

  it("getter の中の [] 合併で組んだ treeTotal が 6 になること", async () => {
    const { host, stateEl } = await mount(
      recursionState([node(1, [node(2, [node(3)])])]), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.treeTotal), "1 + 2 + 3").toBe(6);
    host.remove();
  });

  it("深さ 3 の木で、合併の合計とルート total の合計が一致すること", async () => {
    // 133 = 1 + 10 + 100 + 20 + 2 = 131 + 2。合併が孫を落としても重ねても崩れる。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", [])), "全 value")
      .toEqual([1, 10, 100, 20, 2]);
    expect(read(stateEl, (s: any) => s.treeTotal), "合併の合計").toBe(133);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []) as number[])
      .reduce((a, b) => a + b, 0), "ルート total の合計").toBe(133);
    host.remove();
  });

  it("合併の中身が、深さごとの固定 arity 読みを全部集めたものと一致すること", async () => {
    // 独立した検算。`**` を一切使わずに深さ 0/1/2 を別々に読んで連結すると、
    // 合併と**同じ多重集合**になる（落とさない・重ねない）。ただし並びは違う
    // ── 連結は「深さごと」、合併は「行きがけ」。
    // 深さごとにワイルドカードの本数が変わることが、合併が値の配列しか返さない
    // （`$resolve` への往復を保証しない）理由でもある（設計書 §7-2）。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    const byDepth: number[] = [];
    for (let d = 0; d < 3; d++) {
      byDepth.push(...read(stateEl, (s: any) => s.$getAll(valueAt(d), [])));
    }
    const values: number[] = read(stateEl, (s: any) => s.$getAll("nodes.**.value", []));

    expect(byDepth, "深さ 0 → 1 → 2 の順に連結").toEqual([1, 2, 10, 20, 100]);
    expect(values, "合併は行きがけ").toEqual([1, 10, 100, 20, 2]);
    expect([...values].sort((a, b) => a - b), "多重集合としては同じ")
      .toEqual([...byDepth].sort((a, b) => a - b));
    expect(values, "並びは別").not.toEqual(byDepth);
    host.remove();
  });
});

// ===========================================================================
// 2. 順序 — 深さ優先・行きがけ・添字昇順
// ===========================================================================

/**
 * 枝の数も深さも揃っていない木。深さ優先の行きがけ順と、幅優先まがいの
 * 「兄弟を先に全部出してから降りる」順が**全く違う列**になるように組んである。
 *
 *   10 ─┬─ 11 ── 12
 *       └─ 13
 *   20
 *   30 ─── 31 ─┬─ 32
 *              └─ 33
 */
const asymmetric = (): TNode[] => [
  node(10, [node(11, [node(12)]), node(13)]),
  node(20),
  node(30, [node(31, [node(32), node(33)])]),
];

/** 深さ優先・行きがけ・添字昇順 */
const PREORDER = [10, 11, 12, 13, 20, 30, 31, 32, 33];
/** 兄弟を先に全部出してから降りる（幅優先まがい） */
const LEVEL_ORDER = [10, 20, 30, 11, 13, 31, 12, 32, 33];

describe("合併形の順序: 深さ優先・行きがけ・添字昇順", () => {
  it("非対称な木で、手で書いた行きがけ順の列と一致すること", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", []))).toEqual(PREORDER);
    host.remove();
  });

  it("兄弟を先に全部出してから降りる順ではないこと（退化の反証）", async () => {
    // この 2 つの列は同じ集合の別の並びなので、集合だけを見るテストでは区別が付かない。
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const values = read(stateEl, (s: any) => s.$getAll("nodes.**.value", []));
    expect([...values].sort((a: number, b: number) => a - b), "集合としては同じ")
      .toEqual([...LEVEL_ORDER].sort((a, b) => a - b));
    expect(values, "並びは行きがけであって幅優先ではない").not.toEqual(LEVEL_ORDER);
    host.remove();
  });

  it("親が子より先に出ること（行きがけであって帰りがけではない）", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const values: number[] = read(stateEl, (s: any) => s.$getAll("nodes.**.value", []));
    expect(values.indexOf(10), "親 10 は子 11 より先").toBeLessThan(values.indexOf(11));
    expect(values.indexOf(11), "親 11 は子 12 より先").toBeLessThan(values.indexOf(12));
    expect(values.indexOf(30), "親 30 は孫 32 より先").toBeLessThan(values.indexOf(32));
    host.remove();
  });

  it("total の合併も同じ順序で並ぶこと", async () => {
    // 手で畳んだ total: 12 / 11+12=23 / 13 / 10+23+13=46 / 20 / 32 / 33 / 31+32+33=96 / 30+96=126
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", [])))
      .toEqual([46, 23, 12, 13, 20, 126, 96, 32, 33]);
    // 合計は全 value の合計と一致する（= 二重計上なし）
    expect(read(stateEl, (s: any) => s.treeTotal)).toBe(192);
    host.remove();
  });

  it("兄弟は添字昇順で、逆順の木では列も逆になること", async () => {
    const { host, stateEl } = await mount(recursionState([
      node(3, [node(31), node(32)]), node(1), node(2),
    ]), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", [])), "値の大小ではなく添字順")
      .toEqual([3, 31, 32, 1, 2]);
    host.remove();
  });
});

// ===========================================================================
// 3. 省略形と合併形の書き分け（設計書 §6-2 / §7-1）
// ===========================================================================

describe("省略形と合併形は別の操作であること", () => {
  it("同じ getter の中で、省略形は直下の子・合併形は全深さになること", async () => {
    // forest() = [1[10[100], 20], 2]。深さ 0 の getter から見て
    //   省略形 … 自分の直下の子（node 1 なら 10 と 20 / node 2 なら無し）
    //   合併形 … 全ノードの直下の子（10, 20 と、10 の子 100）
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.**.childValues": {
        get(this: any) {
          return {
            scoped: this.$getAll("nodes.**.children.*.value"),
            union: this.$getAll("nodes.**.children.*.value", []),
          };
        },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.childValues", []))).toEqual([
      { scoped: [10, 20], union: [10, 20, 100] },
      { scoped: [], union: [10, 20, 100] },
    ]);
    host.remove();
  });

  it("合併形は呼び出し元の行に束縛されないこと（深さ 1 から読んでも同じ列）", async () => {
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.**.childValues": {
        get(this: any) {
          return {
            scoped: this.$getAll("nodes.**.children.*.value"),
            union: this.$getAll("nodes.**.children.*.value", []),
          };
        },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.children.*.childValues", []))).toEqual([
      { scoped: [100], union: [10, 20, 100] },  // node 10
      { scoped: [], union: [10, 20, 100] },     // node 20
    ]);
    host.remove();
  });

  it("合併形を集計 getter に使うと孫が二重計上されること（設計書 §7-1 の警告）", async () => {
    // `$getAll("nodes.**.children.*.total", [])` は「全ノードの直下の子の total」なので
    //   110（= 10 + 100） + 20 + 100 = 230
    // となり、100 が「110 の内訳」としても「合併の要素」としても数えられる。
    // 正しい省略形なら 110 + 20 = 130 で、ルートは 1 + 130 = 131。
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.**.wrongTotal": {
        get(this: any) {
          return this["nodes.**.value"] +
            this.$getAll("nodes.**.children.*.total", []).reduce((a: number, b: number) => a + b, 0);
        },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.children.*.total", [])), "合併の中身")
      .toEqual([110, 20, 100]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.wrongTotal", [])), "1 + 230 / 2 + 230")
      .toEqual([231, 232]);
    // 対照: 省略形で畳んだ正しい total
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), [])), "正しい集計").toEqual([131, 2]);
    host.remove();
  });

  it("二重計上は深い行から読んでも同じ量（230）で乗ること", async () => {
    // 合併形は文脈に束縛されないので、どの深さの行から読んでも同じ 230 が足される。
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.**.wrongTotal": {
        get(this: any) {
          return this["nodes.**.value"] +
            this.$getAll("nodes.**.children.*.total", []).reduce((a: number, b: number) => a + b, 0);
        },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.children.*.wrongTotal", [])), "10 + 230 / 20 + 230")
      .toEqual([240, 250]);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(1), [])), "正しい集計").toEqual([110, 20]);
    host.remove();
  });
});

// ===========================================================================
// 4. 構造変更への追従
// ===========================================================================

/**
 * 構造変更を測るための木。中間に「子を持つ枝」と「葉」が混在していて、
 * 削除・並べ替えのどれもが合併の**列**を変える。
 *
 *   1 ─┬─ 10 ── 100
 *      ├─ 20            （children が空 = 追加の受け皿）
 *      └─ 30 ── 300
 *   2
 *
 * 行きがけ順 = [1, 10, 100, 20, 30, 300, 2]、合計 463。
 */
const structural = (): TNode[] => [
  node(1, [node(10, [node(100)]), node(20), node(30, [node(300)])]),
  node(2),
];
const STRUCTURAL_VALUES = [1, 10, 100, 20, 30, 300, 2];
const STRUCTURAL_TOTAL = 463;

const union = (stateEl: State) => read(stateEl, (s: any) => s.$getAll("nodes.**.value", []));
const sum = (stateEl: State) => read(stateEl, (s: any) => s.treeTotal);

describe("合併形が構造変更に追従すること（描画ゼロ）", () => {
  it("初期状態（基準）", async () => {
    const { host, stateEl } = await mount(recursionState(structural()), NO_RENDER_HTML);

    expect(union(stateEl)).toEqual(STRUCTURAL_VALUES);
    expect(sum(stateEl)).toBe(STRUCTURAL_TOTAL);
    host.remove();
  });

  it("葉の更新が合併と集計に反映されること", async () => {
    const { host, stateEl } = await mount(recursionState(structural()), NO_RENDER_HTML);
    expect(union(stateEl)).toEqual(STRUCTURAL_VALUES);

    write(stateEl, (s: any) => { s.$resolve(valueAt(2), [0, 0, 0], 500); });
    await flush();

    expect(union(stateEl)).toEqual([1, 10, 500, 20, 30, 300, 2]);
    expect(sum(stateEl), "463 - 100 + 500").toBe(863);
    host.remove();
  });

  it("末端の空の枝に子を足すと、その位置に現れること", async () => {
    const { host, stateEl } = await mount(recursionState(structural()), NO_RENDER_HTML);
    expect(union(stateEl)).toEqual(STRUCTURAL_VALUES);

    // node 20（children が空）に子を足す
    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children", [0, 1], [node(21)]);
    });
    await flush();

    expect(union(stateEl), "20 の直後に 21").toEqual([1, 10, 100, 20, 21, 30, 300, 2]);
    expect(sum(stateEl)).toBe(STRUCTURAL_TOTAL + 21);
    host.remove();
  });

  it("中間の枝を削除すると、その部分木ごと消えること", async () => {
    const { host, stateEl } = await mount(recursionState(structural()), NO_RENDER_HTML);
    expect(union(stateEl)).toEqual(STRUCTURAL_VALUES);

    // 3 兄弟の真ん中（node 20）を落とす。残る 2 本は同じノードオブジェクトのまま。
    write(stateEl, (s: any) => {
      const kids = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [kids[0], kids[2]]);
    });
    await flush();

    expect(union(stateEl)).toEqual([1, 10, 100, 30, 300, 2]);
    expect(sum(stateEl), "463 - 20").toBe(443);
    host.remove();
  });

  it("子を持つ枝を削除すると、その子孫も消えること", async () => {
    const { host, stateEl } = await mount(recursionState(structural()), NO_RENDER_HTML);
    expect(union(stateEl)).toEqual(STRUCTURAL_VALUES);

    // 先頭の node 10（子 100 を持つ）を落とす
    write(stateEl, (s: any) => {
      const kids = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [kids[1], kids[2]]);
    });
    await flush();

    expect(union(stateEl)).toEqual([1, 20, 30, 300, 2]);
    expect(sum(stateEl), "463 - 10 - 100").toBe(353);
    host.remove();
  });

  it("兄弟の順序変更が合併の順序に出ること", async () => {
    const { host, stateEl } = await mount(recursionState(structural()), NO_RENDER_HTML);
    expect(union(stateEl)).toEqual(STRUCTURAL_VALUES);

    write(stateEl, (s: any) => {
      const kids = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [kids[2], kids[1], kids[0]]);
    });
    await flush();

    expect(union(stateEl), "部分木ごと並べ替わる").toEqual([1, 30, 300, 20, 10, 100, 2]);
    expect(sum(stateEl), "合計は変わらない").toBe(STRUCTURAL_TOTAL);
    host.remove();
  });

  it("親リストの置換に追従すること", async () => {
    const { host, stateEl } = await mount(recursionState(structural()), NO_RENDER_HTML);
    expect(union(stateEl)).toEqual(STRUCTURAL_VALUES);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1], s.nodes[0]]; });
    await flush();

    expect(union(stateEl)).toEqual([2, 1, 10, 100, 20, 30, 300]);
    expect(sum(stateEl)).toBe(STRUCTURAL_TOTAL);
    host.remove();
  });

  it("同一バッチの複数変更がまとめて反映されること", async () => {
    const { host, stateEl } = await mount(recursionState(structural()), NO_RENDER_HTML);
    expect(union(stateEl)).toEqual(STRUCTURAL_VALUES);

    write(stateEl, (s: any) => {
      s.$resolve(valueAt(2), [0, 0, 0], 500);                               // 葉の更新
      s.$resolve("nodes.*.children.*.children", [0, 1], [node(21)]);        // 空の枝へ追加
      s.nodes = [s.nodes[1], s.nodes[0]];                                   // 親リストの置換
    });
    await flush();

    expect(union(stateEl)).toEqual([2, 1, 10, 500, 20, 21, 30, 300]);
    expect(sum(stateEl), "463 - 100 + 500 + 21").toBe(884);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 4'. 上の各 it が書き込みの**前に**合併を読んでいることの説明と対照
//
// 【偶然の救済に注意】この節の it はどれも冒頭で `union(stateEl)` を読んでいる。
// これは合併の側の都合ではなく、#324 までは **`$resolve` の前提**（Phase A の A1）だった
// ── cold な state で深い `$resolve` を撃つと ListIndex 台帳が無くて落ちた。
// つまり「読みを挟まないと結果が変わる」のではなく「読みを挟まないと書けない」だった。
// いまは cold な `$resolve` が台帳をその場で生やすので、読みを挟まずに書ける（①の it）。
// そのうえで、②合併を読まなくても書ける経路（素のプロパティ代入）と
// ③合併**以外**の読みで温めた経路でも固定する。どれも結果は同じでなければ
// ならない（読みの有無・読みの種類が結果を変えないこと）。
// ---------------------------------------------------------------------------

describe("合併の結果が「先に合併を読んだか」に依存しないこと", () => {
  it("cold な state で深い $resolve を撃っても書けて、合併は冒頭で読んだ場合と同じになること", async () => {
    const { host, stateEl } = await mount(recursionState(structural()), NO_RENDER_HTML);

    // Fixed by #324 (a list with no ledger grows one on the spot, diffed against the state-side baseline)
    //   — was: throw "[@wcstack/state] ListIndexes not found: nodes"
    expect(writeError(stateEl, (s: any) => { s.$resolve(valueAt(2), [0, 0, 0], 500); })).toBe("");
    await flush();

    // 「葉の更新」の it（冒頭で合併を読む綴り）と同じ値
    expect(union(stateEl)).toEqual([1, 10, 500, 20, 30, 300, 2]);
    expect(sum(stateEl)).toBe(863);
    host.remove();
  });

  it("親リストの置換は何も読まずに書けて、そのあとの合併が正しいこと", async () => {
    // 素のプロパティ代入は台帳を要求しない。合併を一度も読まないまま書き込んでも、
    // 直後の合併は「読んでから書いた」場合と同じ列になる。
    const { host, stateEl } = await mount(recursionState(structural()), NO_RENDER_HTML);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1], s.nodes[0]]; });
    await flush();

    expect(union(stateEl)).toEqual([2, 1, 10, 100, 20, 30, 300]);
    expect(sum(stateEl)).toBe(STRUCTURAL_TOTAL);
    host.remove();
  });

  it("固定 arity の読みだけで温めてから葉を更新しても、合併は同じになること", async () => {
    // 温めるのに使うのは `**` を含まない普通の読み。合併の走査が自分で温めた台帳に
    // 依存しているわけではないことが、これで分かる。
    const { host, stateEl } = await mount(recursionState(structural()), NO_RENDER_HTML);
    read(stateEl, (s: any) => {
      s.$getAll(valueAt(0), []); s.$getAll(valueAt(1), []); s.$getAll(valueAt(2), []);
    });

    write(stateEl, (s: any) => { s.$resolve(valueAt(2), [0, 0, 0], 500); });
    await flush();

    // 「葉の更新」の it（冒頭で合併を読む綴り）と同じ値
    expect(union(stateEl)).toEqual([1, 10, 500, 20, 30, 300, 2]);
    expect(sum(stateEl)).toBe(863);
    host.remove();
  });
});

describe("合併形が構造変更に追従すること（`for` で描画）", () => {
  // `{{ treeTotal }}` は合併形を使った getter のバインド。描画経路でも同じ列・同じ
  // 合計になることを、DOM と `$getAll` の両方で見る。
  it("初期描画で合併の合計が出ること（基準）", async () => {
    const { host, shadowRoot, stateEl } = await mount(recursionState(structural()), TREE_HTML);

    expect(treeDom(shadowRoot)).toEqual({
      sum: "463", v0: ["1", "2"], v1: ["10", "20", "30"], v2: ["100", "300"],
    });
    expect(union(stateEl)).toEqual(STRUCTURAL_VALUES);
    host.remove();
  });

  it("葉の更新が描画と合併の両方に出ること", async () => {
    const { host, shadowRoot, stateEl } = await mount(recursionState(structural()), TREE_HTML);

    write(stateEl, (s: any) => { s.$resolve(valueAt(2), [0, 0, 0], 500); });
    await flush();

    expect(treeDom(shadowRoot)).toEqual({
      sum: "863", v0: ["1", "2"], v1: ["10", "20", "30"], v2: ["500", "300"],
    });
    expect(union(stateEl)).toEqual([1, 10, 500, 20, 30, 300, 2]);
    host.remove();
  });

  it("末端の空の枝への追加が行の追加になること", async () => {
    const { host, shadowRoot, stateEl } = await mount(recursionState(structural()), TREE_HTML);

    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children", [0, 1], [node(21)]);
    });
    await flush();

    expect(treeDom(shadowRoot)).toEqual({
      sum: "484", v0: ["1", "2"], v1: ["10", "20", "30"], v2: ["100", "21", "300"],
    });
    expect(union(stateEl)).toEqual([1, 10, 100, 20, 21, 30, 300, 2]);
    host.remove();
  });

  it("中間の枝の削除が行の削除になること", async () => {
    const { host, shadowRoot, stateEl } = await mount(recursionState(structural()), TREE_HTML);

    write(stateEl, (s: any) => {
      const kids = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [kids[0], kids[2]]);
    });
    await flush();

    expect(treeDom(shadowRoot)).toEqual({
      sum: "443", v0: ["1", "2"], v1: ["10", "30"], v2: ["100", "300"],
    });
    expect(union(stateEl)).toEqual([1, 10, 100, 30, 300, 2]);
    host.remove();
  });

  it("子を持つ枝の削除が、行ごと子孫ごと消えること", async () => {
    // 描画ゼロ側と同じ操作（node 10 とその子 100 を落とす）を `for` 付きで。
    const { host, shadowRoot, stateEl } = await mount(recursionState(structural()), TREE_HTML);

    write(stateEl, (s: any) => {
      const kids = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [kids[1], kids[2]]);
    });
    await flush();

    expect(treeDom(shadowRoot)).toEqual({
      sum: "353", v0: ["1", "2"], v1: ["20", "30"], v2: ["300"],
    });
    expect(union(stateEl), "463 - 10 - 100").toEqual([1, 20, 30, 300, 2]);
    host.remove();
  });

  it("兄弟の順序変更が描画と合併の両方で並べ替わること", async () => {
    const { host, shadowRoot, stateEl } = await mount(recursionState(structural()), TREE_HTML);

    write(stateEl, (s: any) => {
      const kids = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [kids[2], kids[1], kids[0]]);
    });
    await flush();

    expect(treeDom(shadowRoot)).toEqual({
      sum: "463", v0: ["1", "2"], v1: ["30", "20", "10"], v2: ["300", "100"],
    });
    expect(union(stateEl)).toEqual([1, 30, 300, 20, 10, 100, 2]);
    host.remove();
  });

  it("親リストの置換が描画と合併の両方で入れ替わること", async () => {
    const { host, shadowRoot, stateEl } = await mount(recursionState(structural()), TREE_HTML);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1], s.nodes[0]]; });
    await flush();

    expect(treeDom(shadowRoot)).toEqual({
      sum: "463", v0: ["2", "1"], v1: ["10", "20", "30"], v2: ["100", "300"],
    });
    expect(union(stateEl)).toEqual([2, 1, 10, 100, 20, 30, 300]);
    host.remove();
  });

  it("同一バッチの複数変更が 1 回の描画にまとまること", async () => {
    const { host, shadowRoot, stateEl } = await mount(recursionState(structural()), TREE_HTML);

    write(stateEl, (s: any) => {
      s.$resolve(valueAt(2), [0, 0, 0], 500);
      s.$resolve("nodes.*.children.*.children", [0, 1], [node(21)]);
      s.nodes = [s.nodes[1], s.nodes[0]];
    });
    await flush();

    expect(treeDom(shadowRoot)).toEqual({
      sum: "884", v0: ["2", "1"], v1: ["10", "20", "30"], v2: ["500", "21", "300"],
    });
    expect(union(stateEl)).toEqual([2, 1, 10, 500, 20, 21, 30, 300]);
    host.remove();
  });
});

// ===========================================================================
// 6. 空の枝への依存
// ===========================================================================

describe("空の枝への依存が残ること", () => {
  it("一度読んだ空の children に初めて子を足すと、次の読みで現れること", async () => {
    // 走査は「その深さの子リストが空」で止まる。止まった先の**空リストにも依存が
    // 残っていない**と、初めて入った子を誰も検出できない。
    const { host, stateEl } = await mount(
      recursionState([node(1, [node(10)]), node(2)]), NO_RENDER_HTML);
    expect(union(stateEl), "最初の読みで空の children を 2 本踏む").toEqual([1, 10, 2]);

    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children", [0, 0], [node(100)]);
    });
    await flush();

    expect(union(stateEl), "空だった枝の先が現れる").toEqual([1, 10, 100, 2]);
    host.remove();
  });

  it("空の枝への追加が、合併形を使う getter のキャッシュを落とすこと", async () => {
    const { host, stateEl } = await mount(
      recursionState([node(1, [node(10)]), node(2)]), NO_RENDER_HTML);
    expect(sum(stateEl)).toBe(13);

    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children", [0, 0], [node(100)]);
    });
    await flush();

    expect(sum(stateEl), "13 + 100").toBe(113);
    host.remove();
  });

  it("ルートの空リストに初めてノードを足しても現れること", async () => {
    const { host, stateEl } = await mount(recursionState([]), NO_RENDER_HTML);
    expect(union(stateEl), "空の木").toEqual([]);
    expect(sum(stateEl)).toBe(0);

    write(stateEl, (s: any) => { s.nodes = [node(5, [node(6)])]; });
    await flush();

    expect(union(stateEl)).toEqual([5, 6]);
    expect(sum(stateEl)).toBe(11);
    host.remove();
  });

  it("葉を空にしてから戻しても追従すること", async () => {
    const { host, stateEl } = await mount(
      recursionState([node(1, [node(10, [node(100)])])]), NO_RENDER_HTML);
    expect(union(stateEl)).toEqual([1, 10, 100]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.children", [0, 0], []); });
    await flush();
    expect(union(stateEl), "空にした").toEqual([1, 10]);

    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children", [0, 0], [node(200)]);
    });
    await flush();
    expect(union(stateEl), "また入れた").toEqual([1, 10, 200]);
    host.remove();
  });
});

// ===========================================================================
// 7. 依存の登録 — `**` は依存グラフに載らず、触れた具体パスが載る
// ===========================================================================

/** 評価回数を数える `treeTotal` を持つ state（`extra` で他のキーも足せる） */
function countingState(
  nodes: TNode[],
  extra: Record<string, PropertyDescriptor> = {},
): { state: any; evals: () => number } {
  let count = 0;
  const state = recursionState(nodes, {
    ...extra,
    treeTotal: {
      get(this: any) {
        count++;
        return this.$getAll("nodes.**.value", []).reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    },
  });
  return { state, evals: () => count };
}

/** 再帰と無関係な素のデータプロパティ（`extra` は descriptor 受けなので値で足す） */
const plainProperty = (value: unknown): PropertyDescriptor =>
  ({ value, writable: true, enumerable: true, configurable: true });

describe("合併形を使う getter の依存登録", () => {
  it("深い葉への書き込みで再評価されること（キャッシュが落ちる）", async () => {
    const { state, evals } = countingState(forest());
    const { host, stateEl } = await mount(state, NO_RENDER_HTML);

    expect(sum(stateEl)).toBe(133);
    const afterFirst = evals();
    expect(sum(stateEl), "2 回目はキャッシュ").toBe(133);
    expect(evals(), "書き込みが無ければ再評価しない").toBe(afterFirst);

    write(stateEl, (s: any) => { s.$resolve(valueAt(2), [0, 0, 0], 500); });
    await flush();

    expect(sum(stateEl)).toBe(533);
    expect(evals(), "深い葉の書き込みで再評価された").toBeGreaterThan(afterFirst);
    host.remove();
  });

  it("触れた具体パスが依存グラフに載ること（`**` は載らない）", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    read(stateEl, (s: any) => s.treeTotal);

    const deps = (stateEl as any).dynamicDependency as Map<string, string[]>;
    expect(deps.get(valueAt(0)), "深さ 0 の具体パス").toContain("treeTotal");
    expect(deps.get(valueAt(1)), "深さ 1 の具体パス").toContain("treeTotal");
    expect(deps.get(valueAt(2)), "深さ 2 の具体パス").toContain("treeTotal");
    expect(Array.from(deps.keys()).filter((k) => k.includes("**")), "`**` は載らない")
      .toEqual([]);
    host.remove();
  });

  it("木が深くなったら、新しい深さの具体パスも依存に載ること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    read(stateEl, (s: any) => s.treeTotal);
    const deps = (stateEl as any).dynamicDependency as Map<string, string[]>;
    expect(deps.get(valueAt(3)) ?? [], "まだ深さ 3 は無い").not.toContain("treeTotal");

    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children.*.children", [0, 0, 0], [node(1000)]);
    });
    await flush();

    expect(sum(stateEl), "133 + 1000").toBe(1133);
    expect(deps.get(valueAt(3)), "深さ 3 が載った").toContain("treeTotal");
    host.remove();
  });

  it("兄弟の追加でも再評価されること（同じ深さの行の増減）", async () => {
    const { state, evals } = countingState(forest());
    const { host, stateEl } = await mount(state, NO_RENDER_HTML);

    expect(sum(stateEl)).toBe(133);
    const afterFirst = evals();

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children", [1], [node(7)]); });
    await flush();

    expect(sum(stateEl), "133 + 7").toBe(140);
    expect(evals()).toBeGreaterThan(afterFirst);
    host.remove();
  });

  it("対照: 無関係なプロパティへの書き込みでは再評価しないこと（無効化は依存駆動）", async () => {
    // これが無いと「再評価された」系の it は空虚になる ── 更新のたびに一律で
    // キャッシュが落ちるなら、どんな書き込みでも再評価されてしまい、依存が
    // 登録されている証拠にならない。
    const { state, evals } = countingState(forest(), { other: plainProperty(1) });
    const { host, stateEl } = await mount(state, NO_RENDER_HTML);

    expect(sum(stateEl)).toBe(133);
    const afterFirst = evals();

    write(stateEl, (s: any) => { s.other = 2; });
    await flush();

    expect(read(stateEl, (s: any) => s.other), "書き込み自体は効いている").toBe(2);
    expect(sum(stateEl)).toBe(133);
    expect(evals(), "木に触っていないので再評価しない").toBe(afterFirst);
    host.remove();
  });
});

// ===========================================================================
// 8. E6（D12）— 同じ配列インスタンスの共有と循環
// ===========================================================================

/**
 * 台帳 `listIndexesByList` はリスト**配列の identity** だけをキーにしていて親を持たない。
 * 同じ配列に 2 つの親から到達できると ListIndex の親が先着に固定され、行 getter が
 * 別名化した値を返す — throw も警告も無しに。だから走査は拒否する（設計書 D12）。
 * 拒否の条件は「DAG」ではなく**同じ配列インスタンスが 2 つ以上の親から到達可能**。
 */
describe("同じ配列インスタンスの共有と循環を拒否すること", () => {
  it("兄弟が同じ children 配列を共有していると [wcs/recursion-shared-list] になること", async () => {
    const shared = [node(9)];
    const { host, stateEl } = await mount(
      recursionState([node(1, shared), node(2, shared)]), NO_RENDER_HTML);

    expect(() => union(stateEl)).toThrow(/\[wcs\/recursion-shared-list\]/);
    host.remove();
  });

  it("対照: 中身が同じでも別インスタンスなら通ること（判定は identity）", async () => {
    // 上の it と**同じ形・同じ値**の木を、`children` だけ別々の配列で組む。
    // これが通ることで、拒否の原因が「中身が等しい」ではなく「同じ配列インスタンス」
    // だと確定する（設計書 D12 の条件そのもの）。
    const { host, stateEl } = await mount(
      recursionState([node(1, [node(9)]), node(2, [node(9)])]), NO_RENDER_HTML);

    expect(union(stateEl)).toEqual([1, 9, 2, 9]);
    expect(sum(stateEl)).toBe(21);
    host.remove();
  });

  it("共有の診断が、どのリストパスで・何を直せばよいかを言うこと", async () => {
    const shared = [node(9)];
    const { host, stateEl } = await mount(
      recursionState([node(1, shared), node(2, shared)]), NO_RENDER_HTML);

    let message = "";
    try { union(stateEl); } catch (e: any) { message = e.message; }
    expect(message).toContain('"nodes.*.children" is the same array instance as a list reached from another node');
    expect(message).toContain('The recursion on "nodes.*" needs a tree');
    expect(message).toContain('give each node its own "children" array');
    host.remove();
  });

  it("深さの違う 2 箇所から同じ配列に到達しても拒否されること", async () => {
    // node 1（深さ 0）と node 3（深さ 1）の children が同一インスタンス。
    const shared = [node(9)];
    const { host, stateEl } = await mount(
      recursionState([node(1, shared), node(2, [node(3, shared)])]), NO_RENDER_HTML);

    let message = "";
    try { union(stateEl); } catch (e: any) { message = e.message; }
    expect(message).toContain("[wcs/recursion-shared-list]");
    expect(message, "検出は 2 段目の走査で起きる")
      .toContain('"nodes.*.children.*.children"');
    host.remove();
  });

  it("ノードオブジェクトだけを共有し children が空なら安全なこと（対照）", async () => {
    // 同じ葉オブジェクトを 2 箇所に置く。`children` が空なので走査は降りず、
    // 共有された配列に「2 つの親から到達」する状況が生じない（設計書 A14）。
    const leaf = node(9);
    const { host, stateEl } = await mount(
      recursionState([node(1, [leaf]), node(2, [leaf])]), NO_RENDER_HTML);

    expect(union(stateEl)).toEqual([1, 9, 2, 9]);
    expect(sum(stateEl)).toBe(21);
    host.remove();
  });

  it("同じノードオブジェクトでも children が空でなければ拒否されること（境界の反対側）", async () => {
    const leaf = node(9, [node(90)]);
    const { host, stateEl } = await mount(
      recursionState([node(1, [leaf]), node(2, [leaf])]), NO_RENDER_HTML);

    expect(() => union(stateEl)).toThrow(/\[wcs\/recursion-shared-list\]/);
    host.remove();
  });

  it("自己参照の循環が [wcs/recursion-cycle] になること", async () => {
    // a.children に a 自身が入っている。走査は 2 段目で「祖先が持つ配列」に当たる。
    const a: TNode = node(1);
    a.children = [a];
    const { host, stateEl } = await mount(recursionState([a]), NO_RENDER_HTML);

    expect(() => union(stateEl)).toThrow(/\[wcs\/recursion-cycle\]/);
    host.remove();
  });

  it("循環の診断が「祖先が既に持つリスト」だと言うこと", async () => {
    const a: TNode = node(1);
    a.children = [a];
    const { host, stateEl } = await mount(recursionState([a]), NO_RENDER_HTML);

    let message = "";
    try { union(stateEl); } catch (e: any) { message = e.message; }
    expect(message).toContain("is reachable from itself");
    expect(message).toContain('the recursion on "nodes.*" walked into a list that one of its own ancestors already owns');
    expect(message).toContain("The data contains a cycle, which this version does not support");
    host.remove();
  });

  it("2 段の輪（a → b → a）も [wcs/recursion-cycle] になること", async () => {
    // 単純な自己参照ではなく、1 つ挟んだ輪。祖先を遡る判定でしか捕まらない。
    const a: TNode = node(1);
    const b: TNode = node(2);
    a.children = [b];
    b.children = [a];
    const { host, stateEl } = await mount(recursionState([a]), NO_RENDER_HTML);

    expect(() => union(stateEl)).toThrow(/\[wcs\/recursion-cycle\]/);
    host.remove();
  });

  it("合併形を使う getter の中で起きた診断もそのまま届くこと", async () => {
    const shared = [node(9)];
    const { host, stateEl } = await mount(
      recursionState([node(1, shared), node(2, shared)]), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.treeTotal))
      .toThrow(/\[wcs\/recursion-shared-list\]/);
    host.remove();
  });
});

// ===========================================================================
// 9. 接尾辞にワイルドカードが残る形
// ===========================================================================

type TagNode = { value: number; tags: string[]; children: TagNode[] };
const tagNode = (value: number, tags: string[], children: TagNode[] = []): TagNode =>
  ({ value, tags, children });

/**
 *   1 ["a","b"] ─┬─ 10 ["c"] ── 100 ["d","e"]
 *                └─ 20 []
 *   2 ["f"]
 */
const tagForest = (): TagNode[] => [
  tagNode(1, ["a", "b"], [tagNode(10, ["c"], [tagNode(100, ["d", "e"])]), tagNode(20, [])]),
  tagNode(2, ["f"]),
];
const tagState = (nodes: TagNode[]) => recursionState(nodes as unknown as TNode[]);

describe("接尾辞にワイルドカードが残る合併形（nodes.**.tags.*）", () => {
  it("深さ方向と接尾辞方向の両方が展開されること", async () => {
    // ノードは行きがけ順、各ノードの中では接尾辞の添字昇順。
    const { host, stateEl } = await mount(tagState(tagForest()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.tags.*", [])))
      .toEqual(["a", "b", "c", "d", "e", "f"]);
    host.remove();
  });

  it("接尾辞の配列が空のノードは、列に穴を残さず詰められること", async () => {
    // node 20 の tags は空。`undefined` を 1 個置くのでも、そのノードごと落とすのでもない。
    // 同じ木で node 20 だけに tag を持たせた対照と比べると、空の側は**その位置が
    // 詰まっている**ことがはっきりする（"e" と "f" の間に何も無い）。
    const withTag = (): TagNode[] => [
      tagNode(1, ["a", "b"], [tagNode(10, ["c"], [tagNode(100, ["d", "e"])]), tagNode(20, ["z"])]),
      tagNode(2, ["f"]),
    ];
    const empty = await mount(tagState(tagForest()), NO_RENDER_HTML);
    const filled = await mount(tagState(withTag()), NO_RENDER_HTML);

    const tags = read(empty.stateEl, (s: any) => s.$getAll("nodes.**.tags.*", []));
    expect(tags).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(tags.every((t: unknown) => typeof t === "string"), "undefined の穴が無い").toBe(true);
    expect(read(filled.stateEl, (s: any) => s.$getAll("nodes.**.tags.*", [])), "空でなければ入る位置")
      .toEqual(["a", "b", "c", "d", "e", "z", "f"]);
    empty.host.remove();
    filled.host.remove();
  });

  it("接尾辞側の配列を書き換えると合併に反映されること", async () => {
    const { host, stateEl } = await mount(tagState(tagForest()), NO_RENDER_HTML);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.tags.*", [])))
      .toEqual(["a", "b", "c", "d", "e", "f"]);

    // 空だった node 20 の tags に足す（深さ 1・添字 1）
    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.tags", [0, 1], ["z"]); });
    await flush();

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.tags.*", [])))
      .toEqual(["a", "b", "c", "d", "e", "z", "f"]);
    host.remove();
  });

  it("接尾辞が再帰のリストを指す形（nodes.**.children.*.value）も両方向に展開されること", async () => {
    // forest() = [1[10[100], 20], 2]。各ノードの**直下の子**を全深さぶん集める。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.children.*.value", [])))
      .toEqual([10, 20, 100]);
    host.remove();
  });
});

// ===========================================================================
// 10. 境界
// ===========================================================================

describe("合併形の境界", () => {
  it("空の木では空配列になること", async () => {
    const { host, stateEl } = await mount(recursionState([]), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", []))).toEqual([]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", []))).toEqual([]);
    expect(read(stateEl, (s: any) => s.treeTotal)).toBe(0);
    host.remove();
  });

  it("深さ 1 の木（子がまったく無い）では、ルートだけが並ぶこと", async () => {
    const { host, stateEl } = await mount(recursionState([node(1), node(2), node(3)]), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", []))).toEqual([1, 2, 3]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", [])), "子が無いので total = value")
      .toEqual([1, 2, 3]);
    expect(read(stateEl, (s: any) => s.treeTotal)).toBe(6);
    host.remove();
  });

  it("アンカー配下に存在しないプロパティは undefined で埋まること（既存の寛容規約）", async () => {
    // 「親が居ないパスの読みは undefined」を再帰でも継ぐ。件数はノード数のまま。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.missing", [])))
      .toEqual([undefined, undefined, undefined, undefined, undefined]);
    host.remove();
  });

  it("木より深い接尾辞は、届いたぶんだけを返すこと", async () => {
    // forest() で「孫」を指す接尾辞。孫を持つのは node 1 だけ。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.children.*.children.*.value", [])))
      .toEqual([100]);
    host.remove();
  });

  it("木より深い接尾辞が 1 件も届かなければ空配列になること", async () => {
    const { host, stateEl } = await mount(recursionState([node(1), node(2)]), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.children.*.value", []))).toEqual([]);
    host.remove();
  });

  it("接尾辞なし（nodes.**）はノードそのものを行きがけ順に並べること", async () => {
    // アンカーそのものを合併する形。値ではなくノードオブジェクトが並ぶ。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    const nodes = read(stateEl, (s: any) => s.$getAll("nodes.**", []));
    expect(nodes).toHaveLength(5);
    expect(nodes.map((n: any) => n.value)).toEqual([1, 10, 100, 20, 2]);
    host.remove();
  });

  it("children を持たないノードは葉として扱われること（配列でない子リスト）", async () => {
    // 走査は「その深さの子リストが配列でない」でも止まる。`children` を書き忘れた
    // ノードで throw せず、葉として扱う（既存の寛容規約と同じ側に倒す）。
    const nodes = [
      { value: 1, children: [{ value: 10 }] },  // 深さ 1 のノードに children が無い
      { value: 2 },                             // ルートにも無い
    ] as unknown as TNode[];
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", []))).toEqual([1, 10, 2]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", [])), "10 は葉なので total = value")
      .toEqual([11, 10, 2]);
    expect(read(stateEl, (s: any) => s.treeTotal)).toBe(13);
    host.remove();
  });

  it("children が null のノードも葉として扱われること", async () => {
    const nodes = [{ value: 1, children: null }, { value: 2, children: [] }] as unknown as TNode[];
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", []))).toEqual([1, 2]);
    host.remove();
  });
});

// ===========================================================================
// 11. 形の診断 — 非空接頭辞は定義できない / トップレベルの [] は成立する
// ===========================================================================

describe("合併形の形", () => {
  it("添字が配列でない（null 等）のは生の TypeError ではなく [wcs/recursion-getall-form] になること", async () => {
    // Fixed by post-landing review — was: `indexes.length` を null ガード無しで触り、
    // `Cannot read properties of null (reading 'length')` になっていた。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    let message = "";
    try { read(stateEl, (s: any) => s.$getAll("nodes.**.value", null)); }
    catch (e: any) { message = e.message; }
    expect(message).toContain("[wcs/recursion-getall-form]");
    expect(message).toContain("takes either no indexes");
    expect(message).toContain("or [] (to walk every depth) — got null");
    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.**.value", 0)))
      .toThrow(/\[wcs\/recursion-getall-form\].*got number/);
    host.remove();
  });

  it("接尾辞が整形されていない `**` パス（`nodes.**.` / `nodes.**..x` / `nodes.**.*`）は [wcs/recursion-anchor] になること", async () => {
    // Fixed by cycle-4 review — was: `$getAll("nodes.**.", [])` が `[undefined×5]` を返していた
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    for (const path of ["nodes.**.", "nodes.**..value", "nodes.**.*", "nodes.**.*.value"]) {
      expect(() => read(stateEl, (s: any) => s.$getAll(path, [])), path).toThrow(/\[wcs\/recursion-anchor\]/);
      expect(() => read(stateEl, (s: any) => s.$getAll(path)), `${path}（省略形）`).toThrow(/\[wcs\/recursion-anchor\]/);
    }
    // 対照: 接尾辞側で `*` が後ろに来る形（`nodes.**.tags.*`）は正当
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.tags.*", []))).toEqual([]);
    host.remove();
  });

  it("アンカー照合が添字の形の検査より先であること（静的側と同じ判定順）", async () => {
    // Fixed by post-landing review — was: `$getAll("bogus.**.x", [0])` が runtime では
    // `recursion-getall-form`、静的側では `recursion-anchor` と別コードになっていた。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    let message = "";
    try { read(stateEl, (s: any) => s.$getAll("bogus.**.x", [0])); }
    catch (e: any) { message = e.message; }
    expect(message).toContain("[wcs/recursion-anchor]");
    expect(message).not.toContain("[wcs/recursion-getall-form]");
    host.remove();
  });

  it("非空の接頭辞は [wcs/recursion-getall-form] で拒否されること", async () => {
    // `**` のどの深さの何段目を指すのか言えないので、部分接頭辞は定義できない（設計書 §7-2）。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.**.value", [0])))
      .toThrow(/\[wcs\/recursion-getall-form\]/);
    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.**.value", [0, 1])))
      .toThrow(/\[wcs\/recursion-getall-form\]/);
    host.remove();
  });

  it("その診断が、なぜ定義できないかと 2 つの正しい形を示すこと", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    let message = "";
    try { read(stateEl, (s: any) => s.$getAll("nodes.**.value", [0])); }
    catch (e: any) { message = e.message; }
    expect(message).toContain('takes no partial prefix: a prefix cannot say which depth it applies to');
    expect(message).toContain("Omit the indexes to read the depth of the recursive getter being evaluated");
    expect(message).toContain("or pass [] to walk every depth");
    host.remove();
  });

  it("宣言に無いアンカーの合併は [wcs/recursion-anchor] になること", async () => {
    // 深さを解決しない合併形でも、アンカー照合は同じように先に行う。「宣言が無い」
    // （recursion-unsupported）とも「文脈が無い」（recursion-context）とも別の診断。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    let message = "";
    try { read(stateEl, (s: any) => s.$getAll("other.**.value", [])); }
    catch (e: any) { message = e.message; }
    expect(message).toContain("[wcs/recursion-anchor]");
    expect(message).toContain('"other.**.value" does not match the declared recursion anchor "nodes.**"');
    expect(message).toContain("This version supports exactly one anchor per state");
    host.remove();
  });

  it("再帰 getter の中の非空接頭辞も同じ診断になること", async () => {
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.**.bad": {
        get(this: any) { return this.$getAll("nodes.**.value", [0]); },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.*.bad", [])))
      .toThrow(/\[wcs\/recursion-getall-form\]/);
    host.remove();
  });

  it("トップレベル（再帰文脈の外）からでも [] の合併は成立すること", async () => {
    // 省略形は「いま評価している深さ」を必要とするのでトップレベルでは診断になるが、
    // 合併形は深さを要求しないので同じ場所から読める。この対比が書き分けの実体。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.**.value")), "省略形は文脈が要る")
      .toThrow(/\[wcs\/recursion-context\]/);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", [])), "合併形は要らない")
      .toEqual([1, 10, 100, 20, 2]);
    host.remove();
  });

  it("再帰でない通常の行 getter の中からでも合併形が読めること", async () => {
    // 深さの解決を経ないので、再帰文脈かどうかに関係なく成立する。
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.*.share": {
        get(this: any) {
          return this["nodes.*.value"] /
            this.$getAll("nodes.**.value", []).reduce((a: number, b: number) => a + b, 0);
        },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.share", []))).toEqual([1 / 133, 2 / 133]);
    host.remove();
  });

  it("writable なセッションの中でも合併形が読めること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    let before: number[] = [];
    let after: number[] = [];
    write(stateEl, (s: any) => {
      // 合併形の走査そのものが ListIndex 台帳を温める。cold な `$resolve` は
      // 第 1 相（走査）を持たない唯一の API なので、先に撃つとここで落ちる（Phase A の A1）。
      before = s.$getAll("nodes.**.value", []);
      s.$resolve(valueAt(2), [0, 0, 0], 500);
      after = s.$getAll("nodes.**.value", []);
    });
    await flush();

    expect(before, "書き込み前").toEqual([1, 10, 100, 20, 2]);
    expect(after, "同じセッションの中で書き込みが見える").toEqual([1, 10, 500, 20, 2]);
    expect(union(stateEl)).toEqual([1, 10, 500, 20, 2]);
    host.remove();
  });

  it("合併形の throw のあとも、同じ state の通常の読みが壊れないこと", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    const out = read(stateEl, (s: any) => {
      const log: any = {};
      try { s.$getAll("nodes.**.value", [0]); }
      catch (e: any) { log.first = e.message.includes("[wcs/recursion-getall-form]"); }
      log.union = s.$getAll("nodes.**.value", []);
      log.d0 = s.$getAll(totalAt(0), []);
      return log;
    });
    expect(out).toEqual({ first: true, union: [1, 10, 100, 20, 2], d0: [131, 2] });
    host.remove();
  });
});

// ===========================================================================
// 12. イベントハンドラ（state のメソッド）から読む
//
// getter の外から呼ぶ経路。ハンドラは `for` の行に紐づいていることも、そうでない
// こともあり、どちらでもアドレススタックの中身が getter とは違う（行ハンドラなら
// ループのリストパス、行の外なら null）。合併形はどちらでも同じ列を返す
// ── 深さも行も要求しないという性質の、いちばん実務に近い形。
// ===========================================================================

/** `data-wcs="onclick: …"` で呼ばれた回数と、そのとき読めた合併を記録する state */
function handlerState(nodes: TNode[], handlers: Record<string, (this: any, ...args: any[]) => void>) {
  return recursionState(nodes, Object.fromEntries(
    Object.entries(handlers).map(([name, fn]) => [name, {
      value: fn, writable: true, enumerable: true, configurable: true,
    }]),
  ));
}

describe("イベントハンドラから合併形を読む", () => {
  it("`for` の外のハンドラから読めること（ループ文脈が無い）", async () => {
    const seen: number[][] = [];
    const state = handlerState(forest(), {
      pickTop(this: any) { seen.push(this.$getAll("nodes.**.value", [])); },
    });
    const { host, shadowRoot } = await mount(state, `<button id="b" data-wcs="onclick: pickTop"></button>`);

    (shadowRoot.getElementById("b") as HTMLElement).dispatchEvent(new Event("click"));
    await flush();

    expect(seen).toEqual([[1, 10, 100, 20, 2]]);
    host.remove();
  });

  it("`for` の行のハンドラから読めて、行の添字に束縛されないこと", async () => {
    // ハンドラは行の添字（[1] = node 2 の行）を受け取っているのに、合併は木全体のまま。
    const seen: { idx: number[]; values: number[] }[] = [];
    const state = handlerState(forest(), {
      pickRow(this: any, _e: Event, ...idx: number[]) {
        seen.push({ idx, values: this.$getAll("nodes.**.value", []) });
      },
    });
    const { host, shadowRoot } = await mount(state,
      `<template data-wcs="for: nodes"><button class="b" data-wcs="onclick: pickRow"></button></template>`);

    const buttons = shadowRoot.querySelectorAll("button.b");
    expect(buttons.length, "ルートは 2 行").toBe(2);
    (buttons[1] as HTMLElement).dispatchEvent(new Event("click"));
    await flush();

    expect(seen).toEqual([{ idx: [1], values: [1, 10, 100, 20, 2] }]);
    host.remove();
  });

  it("入れ子の `for` の行から、そのループ自身のリストを合併しても読めること", async () => {
    // ハンドラが居るのは `for: nodes.*.children` の行。そこから
    // `nodes.**.children` を合併すると、深さ 0 の具体パスが**いま居るループの
    // パスと同じ**になる（自分自身への依存は張らない）。
    const seen: { idx: number[]; sizes: number[] }[] = [];
    const state = handlerState(forest(), {
      pickKid(this: any, _e: Event, ...idx: number[]) {
        seen.push({ idx, sizes: this.$getAll("nodes.**.children", []).map((a: TNode[]) => a.length) });
      },
    });
    const { host, shadowRoot } = await mount(state,
      `<template data-wcs="for: nodes"><div>` +
      `<template data-wcs="for: nodes.*.children">` +
      `<button class="k" data-wcs="onclick: pickKid"></button>` +
      `</template></div></template>`);

    const buttons = shadowRoot.querySelectorAll("button.k");
    expect(buttons.length, "node 1 の子 2 つ").toBe(2);
    (buttons[0] as HTMLElement).dispatchEvent(new Event("click"));
    await flush();

    // 行きがけ順に [1, 10, 100, 20, 2] の children の長さ
    expect(seen).toEqual([{ idx: [0, 0], sizes: [2, 1, 0, 0, 0] }]);
    host.remove();
  });
});

// ===========================================================================
// イベントハンドラから**束縛形**を読む（README「an event handler bound to such a row」の根拠）
//
// `setLoopContext` がループのリストパス（`nodes.*.children.*`）のアドレスをスタックへ積むので、
// `currentRecursionDepth` の `depthOfConcretePathPrefix` がそこから深さ 1 を取り出せる。
// 合併形（上の describe）は深さを要求しないが、束縛形はここで初めて「行のハンドラ」が
// 再帰文脈になることを固定する。
// ===========================================================================

describe("イベントハンドラから束縛形を読む", () => {
  it("入れ子の `for` の行ハンドラでは、ループのアドレスから深さが束縛されること", async () => {
    const seen: { idx: number[]; kids: number[]; own: number }[] = [];
    const state = handlerState(forest(), {
      pickKid(this: any, _e: Event, ...idx: number[]) {
        seen.push({
          idx,
          // 省略形＝この行（node 10・深さ 1）の直下の子だけ
          kids: this.$getAll("nodes.**.children.*.value"),
          // `**` の直接読みも同じ深さに束縛される
          own: this["nodes.**.value"],
        });
      },
    });
    const { host, shadowRoot } = await mount(state,
      `<template data-wcs="for: nodes"><div>` +
      `<template data-wcs="for: nodes.*.children">` +
      `<button class="k" data-wcs="onclick: pickKid"></button>` +
      `</template></div></template>`);

    const buttons = shadowRoot.querySelectorAll("button.k");
    (buttons[0] as HTMLElement).dispatchEvent(new Event("click"));
    await flush();

    expect(seen).toEqual([{ idx: [0, 0], kids: [100], own: 10 }]);
    host.remove();
  });

  it("`for` の外のハンドラでは束縛形は [wcs/recursion-context] になること（束縛する深さが無い）", async () => {
    const seen: string[] = [];
    const state = handlerState(forest(), {
      pickTop(this: any) {
        try { this.$getAll("nodes.**.children.*.value"); seen.push("ok"); }
        catch (e: any) { seen.push(String(e.message)); }
      },
    });
    const { host, shadowRoot } = await mount(state, `<button id="b" data-wcs="onclick: pickTop"></button>`);

    (shadowRoot.getElementById("b") as HTMLElement).dispatchEvent(new Event("click"));
    await flush();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("[wcs/recursion-context]");
    host.remove();
  });
});
