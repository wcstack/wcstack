/**
 * integration.recursionSetAll.test.ts — Phase D（`$setAll(path, [], value)` の全深さ
 * ブロードキャスト）の実挙動を固定する統合テスト（docs/state-recursive-path-impl-plan.md §6、
 * docs/state-recursive-path-design.md §7-3 / D8）。
 *
 * 読み（Phase C の合併形）と書きは**同じ列挙**を共有する。違うのは引数の側で、書き側が
 * 受け付けるのは `[]` のブロードキャストだけ:
 *
 *  - **mapper** は深さごとに添字の本数が変わるのでそのまま渡せない。
 *  - **`{ spread: true }`** は木に 1 次元配列を配る形で、作者が走査順を知らないと使えない。
 *  - **添字の省略** は「書き込み API に暗黙の文脈依存を持たせない」という `$setAll` の
 *    既存の決定（docs/state-set-all-design.md の D4）を継いで受け付けない。
 *
 * このファイルが固定する契約は 10 個。
 *  1. ブロードキャストの基本 — 非対称な木の全深さに書けること、件数、書き込み後に
 *     合併集計（`treeTotal`）と各深さの再帰 getter（`total`）が追従すること。
 *  2. 順序 — 読み（`$getAll(path, [])`）と書きが同じ列挙順を使うこと。**setter を持つ
 *     プロパティに書いて呼ばれ順を記録**し、深さ優先・行きがけ・添字昇順であること、
 *     幅優先まがいの順に退化していないこと、構造変更後も両者が揃うことまで見る。
 *  3. 値の種類 — `undefined` スキップ / `null` クリア / 配列は**配分されず**ブロードキャスト
 *     される（＝全ノードが同じ 1 本の配列を共有する）/ オブジェクトも同一参照で入る。
 *     共有が生まれた**あと**に何が起きるかまで実測して固定してある（§3-2 に詳細）。
 *  4. 形の拒否 — mapper / spread / 添字省略 / 非空接頭辞 / 構造への書き込み（ノード自身・
 *     子リスト・子ノード）/ 再帰 getter / 宣言外アンカー。診断コードと文面、そして
 *     **1 件も書かれていないこと**を前後の生データの突き合わせで固定する。その突き合わせが
 *     鈍感でないこと（通る形なら false に転ぶこと）も 1 件置く。さらに 4-2 で、
 *     **列挙が必ず失敗するデータ**（循環・共有 children）を使って「形の検査が列挙より前」
 *     を診断の出方で確定させる — 生データを見るだけでは検査の順序は分からないため。
 *  5. 列挙が失敗する場合（共有配列・循環・深さ超過）でも 1 件も書かれないこと。対照として
 *     「列挙を通過したあとにユーザー setter が落ちた場合はロールバックしない」も置く
 *     （2 相構成が保証するのは第 1 相の失敗であって、第 2 相の中断ではない）。
 *  6. 境界 — 空の木 / 深さ 1 / 存在しないプロパティ / 木より深い接尾辞 / アンカーが配列でない。
 *  7. cold — 走査を一度も経ていない state で、最初の操作が合併形の `$setAll` でも成立すること
 *     （Phase A の A1 の対）。対照として cold な `$resolve` は落ちることも置く。
 *  8. 描画あり — 3 段の `for` で描いた木にブロードキャストすると DOM が追従すること
 *     （葉の値・合併集計の表示・**行ごとの再帰 getter** の 3 系統）。描画が浅くても
 *     （`for` が 1 段でも）全深さに書けることも対で置く。
 *  9. 回帰の対照 — 通常の `*` パスの `$setAll`（mapper / spread / 接頭辞）が、再帰宣言の
 *     ある state でもそのまま動くこと。宣言の無い state との対照も置く。
 * 10. readonly セッション — **現状の記録**。`createState("readonly", …)` の中でも
 *     `$setAll` は素通りして実データを書き換える（Phase A の X1 の既存欠陥）。
 *
 * 期待値はすべて実行して確かめたもの。手で畳んだ算術（`28 = 7 + (7 + 7) + 7`）は、
 * 集計が二重計上していないことの独立した検算として併記してある。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import {
  flush, makeMount, node, read, recursionState as baseRecursionState, UNION_TOTAL, write, writeCount, writeError, type TNode,
} from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("recursion-setall-host");

// ---------------------------------------------------------------------------
// 木と再帰 state（helpers/recursionTestUtils の node / recursionState を使う）
// ---------------------------------------------------------------------------

/**
 * 枝の数も深さも揃っていない木（Phase C の順序テストと同じ形）。
 * 深さ優先の行きがけ順と、幅優先まがいの順が**全く違う列**になる。
 *
 *   10 ─┬─ 11 ── 12
 *       └─ 13
 *   20
 *   30 ─── 31 ─┬─ 32
 *              └─ 33
 */
const asymmetric = (mk: (v: number, c?: TNode[]) => TNode = node): TNode[] => [
  mk(10, [mk(11, [mk(12)]), mk(13)]),
  mk(20),
  mk(30, [mk(31, [mk(32), mk(33)])]),
];

/** 深さ優先・行きがけ・添字昇順 */
const PREORDER = [10, 11, 12, 13, 20, 30, 31, 32, 33];
/** 兄弟を先に全部出してから降りる（幅優先まがい） */
const LEVEL_ORDER = [10, 20, 30, 11, 13, 31, 12, 32, 33];

/**
 * 標準の再帰 state。`nodes.**.total` は**省略形**で子を畳む（正しい形）、
 * `treeTotal` はルートに置いた**合併形**。
 *
 * オブジェクトリテラルの getter として書くと、この関数の外で spread された時に
 * 本体が評価されてしまう。descriptor で足して事故を防ぐ。
 */
function recursionState(nodes: any, extra: Record<string, PropertyDescriptor> = {}): any {
  return baseRecursionState(nodes, { treeTotal: UNION_TOTAL, ...extra });
}

/**
 * 書き込みの**呼ばれ順**を記録するノード工場。`sel` をアクセサにしてあるので、
 * `$setAll` が実際にそのノードへ書いた瞬間にノードの `value` がログへ積まれる。
 * （同値ガードに当たった書き込みは setter まで到達しない ── それも契約なので測る。）
 */
function loggingNode(log: number[], initial: unknown = 0) {
  return (value: number, children: TNode[] = []): TNode => {
    const created: TNode = { value, children } as TNode;
    let store: unknown = initial;
    Object.defineProperty(created, "sel", {
      get() { return store; },
      set(next: unknown) { log.push(value); store = next; },
      enumerable: true,
      configurable: true,
    });
    return created;
  };
}

/** 生データの深いコピー。書き込みの有無を前後で突き合わせるために使う（循環には使えない）。 */
const snap = (nodes: unknown) => JSON.parse(JSON.stringify(nodes));

/** そのキーを持つノードの数（循環した木でも数えられる）。 */
function countKey(nodes: TNode[], key: string): number {
  let count = 0;
  const seen: Set<TNode> = new Set();
  const walk = (n: TNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    if (key in n) count++;
    (Array.isArray(n.children) ? n.children : []).forEach(walk);
  };
  nodes.forEach(walk);
  return count;
}

/** 深さ d の value パス */
const valueAt = (d: number) => "nodes.*" + ".children.*".repeat(d) + ".value";

/** `for` も data-wcs も持たない（描画ゼロ） */
const NO_RENDER_HTML = `<div></div>`;

/** 3 段の `for` でツリーを描く（各段の value と mark を表示する） */
const TREE_HTML =
  `<div><span class="sum">{{ treeTotal }}</span>` +
  `<template data-wcs="for: nodes">` +
  `<div><span class="v0">{{ .value }}</span><span class="m0">{{ .mark }}</span>` +
  `<template data-wcs="for: nodes.*.children">` +
  `<div><span class="v1">{{ .value }}</span><span class="m1">{{ .mark }}</span>` +
  `<template data-wcs="for: nodes.*.children.*.children">` +
  `<div><span class="v2">{{ .value }}</span><span class="m2">{{ .mark }}</span></div>` +
  `</template></div></template></div></template></div>`;

/** 3 段の `for` で、各行に**その深さの再帰 getter**（`.total`）を出す */
const TOTAL_HTML =
  `<div><template data-wcs="for: nodes">` +
  `<div><span class="t0">{{ .total }}</span>` +
  `<template data-wcs="for: nodes.*.children">` +
  `<div><span class="t1">{{ .total }}</span>` +
  `<template data-wcs="for: nodes.*.children.*.children">` +
  `<div><span class="t2">{{ .total }}</span></div>` +
  `</template></div></template></div></template></div>`;

const texts = (sr: ShadowRoot, sel: string) =>
  Array.from(sr.querySelectorAll(sel)).map((e) => e.textContent!.trim());

/** 全ノードに `mark` を持たせる（描画テスト用の初期値） */
function seedMark(nodes: TNode[], value = "-"): TNode[] {
  const walk = (n: TNode) => { n.mark = value; (n.children ?? []).forEach(walk); };
  nodes.forEach(walk);
  return nodes;
}

const union = (stateEl: State, path = "nodes.**.value") =>
  read(stateEl, (s: any) => s.$getAll(path, []));

// ===========================================================================
// 1. ブロードキャストの基本
// ===========================================================================

describe("ブロードキャスト $setAll(path, [], value): 基本", () => {
  it("非対称な木の全深さに書けて、件数がノード数と一致すること", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.selected", [], true));
    await flush();

    expect(count, "9 ノード").toBe(9);
    expect(union(stateEl, "nodes.**.selected")).toEqual(
      [true, true, true, true, true, true, true, true, true]);
    expect(union(stateEl), "木の形は変わらない").toEqual(PREORDER);
    host.remove();
  });

  it("書き込み後に各深さの再帰 getter と合併集計が追従すること", async () => {
    // 全 value を 7 にすると、手で畳んだ total は
    //   12→7 / 11→7+7=14 / 13→7 / 10→7+14+7=28 / 20→7 / 32→7 / 33→7 / 31→7+7+7=21 / 30→7+21=28
    // 合計は 9 × 7 = 63（＝二重計上なし）。
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);
    expect(read(stateEl, (s: any) => s.treeTotal), "初期の合計").toBe(192);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.value", [], 7));
    await flush();

    expect(count).toBe(9);
    expect(union(stateEl)).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 7]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", [])), "全深さの total")
      .toEqual([28, 14, 7, 7, 7, 28, 21, 7, 7]);
    expect(read(stateEl, (s: any) => s.treeTotal), "9 × 7").toBe(63);
    host.remove();
  });

  it("同じセッションの中で、書き込みが直後の合併に見えること", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    let before: number[] = [];
    let after: number[] = [];
    let count = -1;
    write(stateEl, (s: any) => {
      before = s.$getAll("nodes.**.value", []);
      count = s.$setAll("nodes.**.value", [], 3);
      after = s.$getAll("nodes.**.value", []);
    });
    await flush();

    expect(before).toEqual(PREORDER);
    expect(count).toBe(9);
    expect(after).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3]);
    host.remove();
  });

  it("戻り値は書き込み対象アドレスの数で、同値ガードで実書き込みが省かれても減らないこと", async () => {
    // 既存の `$setAll` と同じ規約。件数は「何件に配ったか」であって「何件が実際に
    // 変化したか」ではない。setter ログが空なのに 9 が返るのがその証拠。
    const log: number[] = [];
    const { host, stateEl } = await mount(
      recursionState(asymmetric(loggingNode(log, false))), NO_RENDER_HTML);

    const same = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.sel", [], false));
    await flush();
    expect(same, "全ノードが既に false").toBe(9);
    expect(log, "同値ガードで setter まで到達しない").toEqual([]);

    const changed = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.sel", [], true));
    await flush();
    expect(changed).toBe(9);
    expect(log, "値が変わるときは 9 回呼ばれる").toHaveLength(9);
    host.remove();
  });

  it("children を持たないノードも葉として書けること", async () => {
    // 走査は「その深さの子リストが配列でない」でも止まる（既存の寛容規約）。
    const nodes = [
      { value: 1, children: [{ value: 10 }] },  // 深さ 1 のノードに children が無い
      { value: 2 },                             // ルートにも無い
    ] as unknown as TNode[];
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.mark", [], "*"));
    await flush();

    expect(count).toBe(3);
    expect(union(stateEl, "nodes.**.mark")).toEqual(["*", "*", "*"]);
    expect(snap(nodes)).toEqual([
      { value: 1, children: [{ value: 10, mark: "*" }], mark: "*" },
      { value: 2, mark: "*" },
    ]);
    host.remove();
  });
});

// ===========================================================================
// 2. 順序 — 読みと書きが同じ列挙を使う
// ===========================================================================

describe("ブロードキャストの順序が読みと同じであること", () => {
  it("setter の呼ばれ順が $getAll(path, []) の列と一致すること", async () => {
    const log: number[] = [];
    const { host, stateEl } = await mount(
      recursionState(asymmetric(loggingNode(log))), NO_RENDER_HTML);
    const readOrder = union(stateEl);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.sel", [], 1));
    await flush();

    expect(count).toBe(9);
    expect(readOrder, "読みは深さ優先・行きがけ・添字昇順").toEqual(PREORDER);
    expect(log, "書きも同じ列").toEqual(readOrder);
    host.remove();
  });

  it("兄弟を先に全部出してから降りる順ではないこと（退化の反証）", async () => {
    // この 2 つの列は同じ集合の別の並びなので、集合だけを見るテストでは区別が付かない。
    const log: number[] = [];
    const { host, stateEl } = await mount(
      recursionState(asymmetric(loggingNode(log))), NO_RENDER_HTML);

    write(stateEl, (s: any) => { s.$setAll("nodes.**.sel", [], 1); });
    await flush();

    expect([...log].sort((a, b) => a - b), "集合としては同じ")
      .toEqual([...LEVEL_ORDER].sort((a, b) => a - b));
    expect(log, "並びは行きがけであって幅優先ではない").not.toEqual(LEVEL_ORDER);
    expect(log.indexOf(10), "親 10 は子 11 より先").toBeLessThan(log.indexOf(11));
    expect(log.indexOf(30), "親 30 は孫 32 より先").toBeLessThan(log.indexOf(32));
    host.remove();
  });

  it("構造を変更したあとも、読みと書きが同じ新しい順序になること", async () => {
    const log: number[] = [];
    const { host, stateEl } = await mount(
      recursionState(asymmetric(loggingNode(log))), NO_RENDER_HTML);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[2], s.nodes[0], s.nodes[1]]; });
    await flush();
    const readOrder = union(stateEl);

    write(stateEl, (s: any) => { s.$setAll("nodes.**.sel", [], 1); });
    await flush();

    expect(readOrder, "部分木ごと並べ替わる").toEqual([30, 31, 32, 33, 10, 11, 12, 13, 20]);
    expect(log, "書きも同じ").toEqual(readOrder);
    host.remove();
  });
});

// ===========================================================================
// 3. 値の種類
// ===========================================================================

describe("ブロードキャストする値の種類", () => {
  it("undefined は 0 件で、値を変えないこと", async () => {
    // 既存の `$setAll` の規約を継ぐ（設計 §5）。mapper の return 忘れで木を潰さないため。
    const nodes = asymmetric();
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);
    const before = snap(nodes);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.value", [], undefined));
    await flush();

    expect(count).toBe(0);
    expect(union(stateEl)).toEqual(PREORDER);
    expect(snap(nodes), "生データも不変").toEqual(before);
    host.remove();
  });

  it("undefined の 0 件が「そもそも書けない形だった」ではないこと", async () => {
    // 上の 0 件は、アドレスが 1 件も確定しなくても同じ数字になる。**同じ state・同じパス**で
    // 実値を渡すと 9 件届くことを続けて見て、「確定はしているが書かない」を確定させる。
    // setter ログが空 ⟹ 値の書き込み自体が起きていない（同値ガードですらない）。
    const log: number[] = [];
    const { host, stateEl } = await mount(
      recursionState(asymmetric(loggingNode(log))), NO_RENDER_HTML);

    const skipped = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.sel", [], undefined));
    await flush();
    expect(skipped).toBe(0);
    expect(log, "setter は 1 回も呼ばれない").toEqual([]);

    const written = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.sel", [], 1));
    await flush();
    expect(written, "同じパスに実値なら全件届く").toBe(9);
    expect(log).toEqual(PREORDER);
    host.remove();
  });

  it("null は全件クリアになること（件数はノード数）", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.mark", [], null));
    await flush();

    expect(count).toBe(9);
    expect(union(stateEl, "nodes.**.mark"))
      .toEqual([null, null, null, null, null, null, null, null, null]);
    host.remove();
  });

  it("配列は配分されず、全ノードが同じ 1 本の配列を受け取ること", async () => {
    // `{ spread: true }` は `**` では拒否されるので、配列は必ずブロードキャストになる。
    const arr = ["x", "y"];
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.tags", [], arr));
    await flush();

    const tags = union(stateEl, "nodes.**.tags");
    expect(count).toBe(9);
    expect(tags).toHaveLength(9);
    expect(tags.every((t: unknown) => t === arr), "同一参照が 9 箇所に入る").toBe(true);
    host.remove();
  });

  it("オブジェクトも同一参照で全ノードに入り、その後の深さ方向の走査は通ること", async () => {
    const obj = { a: 0 };
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.meta", [], obj));
    await flush();

    expect(count).toBe(9);
    expect(union(stateEl, "nodes.**.meta").every((m: unknown) => m === obj)).toBe(true);
    // 共有が生まれても、再帰の走査そのもの（children を降りる経路）は影響を受けない。
    // D12 のガードが見ているのは**子リストの配列**であって、葉に置かれた値ではない。
    expect(union(stateEl), "走査は拒否しない").toEqual(PREORDER);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 3-2. 共有が生まれたあとに何が起きるか（**現状の記録**）
//
// 【仕様の穴】ブロードキャストは同じ参照を全ノードへ配るので、値が配列やオブジェクトなら
// そこに「共有」が生まれる。設計書 D12 のガード（[wcs/recursion-shared-list]）が見るのは
// **再帰の子リスト**だけなので、この共有は検出されない。帰結は 2 つ:
//
//   (a) 共有オブジェクトの中へ一括で書くと、9 件書いたつもりが 1 つのオブジェクトに乗る。
//   (b) 共有配列を接尾辞のワイルドカードで展開しようとすると、**再帰の診断ではなく**
//       [wcs/wildcard-rank] で落ちる。しかも書き側は列挙を通過してから落ちるので、
//       共有配列は既に書き換わっている（＝この形では「1 件も書かない」が成立しない）。
//
// (b) の原因が「ブロードキャストで作った」ことではなく「共有」であることを、
// ノードごとに別配列を入れた対照で確定させてある。
// ---------------------------------------------------------------------------

describe("ブロードキャストが生む共有の帰結（現状の記録）", () => {
  it("共有オブジェクトの中への一括書き込みは、9 件が 1 つのオブジェクトに乗ること", async () => {
    const obj: any = { a: 0 };
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    write(stateEl, (s: any) => { s.$setAll("nodes.**.meta", [], obj); });
    await flush();
    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.meta.a", [], 1));
    await flush();

    expect(count, "件数はノード数のまま").toBe(9);
    expect(union(stateEl, "nodes.**.meta").every((m: unknown) => m === obj),
      "9 箇所が指しているのは同じ 1 つのオブジェクト").toBe(true);
    expect(obj, "書き込み先は 1 つ").toEqual({ a: 1 });
    expect(union(stateEl, "nodes.**.meta.a")).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    host.remove();
  });

  it("対照: ノードごとに別の配列なら nodes.**.tags.* は読めるし書けること", async () => {
    // 各ノードが自分の `tags` を持つ木。接尾辞のワイルドカードは深さ方向と両方に展開される。
    const tagNode = (value: number, tags: string[], children: TNode[] = []): TNode =>
      ({ value, tags, children } as TNode);
    const tree = [
      tagNode(1, ["a", "b"], [tagNode(10, ["c"], [tagNode(100, ["d", "e"])]), tagNode(20, [])]),
      tagNode(2, ["f"]),
    ];
    const { host, stateEl } = await mount(recursionState(tree), NO_RENDER_HTML);
    expect(union(stateEl, "nodes.**.tags.*")).toEqual(["a", "b", "c", "d", "e", "f"]);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.tags.*", [], "z"));
    await flush();

    expect(count, "tags の要素の総数（空の tags は 0 件）").toBe(6);
    expect(union(stateEl, "nodes.**.tags.*")).toEqual(["z", "z", "z", "z", "z", "z"]);
    expect(snap(tree)[0].children[1].tags, "空の配列は空のまま").toEqual([]);
    host.remove();
  });

  it("配列をブロードキャストしたあと nodes.**.tags.* を読むと [wcs/wildcard-rank] で落ちること", async () => {
    // should be: 共有を作った時点か、遅くとも読みの時点で、共有だと分かる診断
    //            （[wcs/recursion-shared-list] の系統）になるべき。
    // いまは台帳（listIndexesByList）が配列インスタンスだけをキーにしているため、
    // 2 つ目のノードの行 ListIndex が先着の親に別名化し、親の解決に失敗した所で
    // 「ループが 1 段足りない」という無関係な診断が出る。
    const arr = ["a", "b"];
    const { host, stateEl } = await mount(
      recursionState([node(1, [node(10)]), node(2)]), NO_RENDER_HTML);
    write(stateEl, (s: any) => { s.$setAll("nodes.**.tags", [], arr); });
    await flush();

    let message = "";
    try { union(stateEl, "nodes.**.tags.*"); } catch (e: any) { message = e.message; }

    expect(message).toContain("[wcs/wildcard-rank]");
    expect(message).toContain('path "nodes.*" needs 1 enclosing loop level(s)');
    expect(message, "共有だとは言わない").not.toContain("[wcs/recursion-shared-list]");
    expect(arr, "読みは値を変えない").toEqual(["a", "b"]);
    // 深さ方向の走査（子リストを降りる経路）は変わらず通る
    expect(union(stateEl)).toEqual([1, 10, 2]);
    host.remove();
  });

  it("同じ形への書き込みは、落ちる前に共有配列を書き換えてしまうこと", async () => {
    // should be: 落ちるなら第 1 相（列挙）で落ちて 0 件。いまは列挙を通過してしまうので、
    //            第 2 相の途中で落ちる ＝ 部分書き込みが残る。
    const arr = ["a", "b"];
    const { host, stateEl } = await mount(
      recursionState([node(1, [node(10)]), node(2)]), NO_RENDER_HTML);
    write(stateEl, (s: any) => { s.$setAll("nodes.**.tags", [], arr); });
    await flush();

    const message = writeError(stateEl, (s: any) => { s.$setAll("nodes.**.tags.*", [], "z"); });

    expect(message).toContain("[wcs/wildcard-rank]");
    expect(arr, "throw したのに書き換わっている").toEqual(["z", "z"]);
    host.remove();
  });
});

// ===========================================================================
// 4. 形の拒否 — 列挙より前に throw し、1 件も書かない
// ===========================================================================

/**
 * 形の拒否は**すべて列挙より前**に行う（設計 §7-3）。だから「throw したこと」だけでなく
 * 「生データが 1 バイトも変わっていないこと」を毎回突き合わせる。
 */
async function rejects(
  spell: (s: any) => void,
): Promise<{ message: string; unchanged: boolean; host: HTMLElement }> {
  const nodes = asymmetric();
  const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);
  const before = snap(nodes);
  const message = writeError(stateEl, spell);
  await flush();
  return { message, unchanged: JSON.stringify(snap(nodes)) === JSON.stringify(before), host };
}

describe("ブロードキャストが受け付けない形", () => {
  it("mapper は拒否されること（深さごとに添字の本数が変わる）", async () => {
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("nodes.**.selected", [], (current: boolean) => !current));

    expect(message).toContain('$setAll("nodes.**.selected") with "**" does not take a mapper yet');
    expect(message).toContain("the index tuple has a different length at each depth");
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();
  });

  it("{ spread: true } は拒否されること（木に 1 次元配列を配る形）", async () => {
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("nodes.**.selected", [], [1, 2, 3], { spread: true }));

    expect(message).toContain('$setAll("nodes.**.selected") with "**" does not take { spread: true }');
    expect(message).toContain("needs the author to know the walk order, which is not a usable contract");
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();
  });

  it("非空の接頭辞は [wcs/recursion-setall-form] で拒否されること", async () => {
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("nodes.**.selected", [0], true));

    expect(message).toContain("[wcs/recursion-setall-form]");
    expect(message).toContain("takes no partial prefix: a prefix cannot say which depth it applies to");
    expect(message).toContain("Pass [] to broadcast to every depth");
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();
  });

  it("添字の省略は拒否されること（書き込み API に暗黙の文脈を持たせない）", async () => {
    // 読み側には省略形（文脈束縛）があるが、書き側には対応物を置かない（D4 を継ぐ）。
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("nodes.**.selected", undefined, true));

    expect(message).toContain('$setAll("nodes.**.selected") with "**" requires an explicit empty indexes array ([])');
    expect(message).toContain("the write API takes no context");
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();
  });

  it("ノード自身（nodes.**）への書き込みは [wcs/recursion-structural-write] になること", async () => {
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("nodes.**", [], node(0)));

    expect(message).toContain("[wcs/recursion-structural-write]");
    expect(message).toContain('"nodes.**" writes the recursion structure itself (a node, its "children" list or that list\'s length, or an object on the way to that list)');
    expect(message).toContain("This version broadcasts to leaf properties only");
    expect(message).toContain("replacing a node would invalidate the child addresses already resolved for this write");
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();
  });

  it("子リスト（nodes.**.children）への書き込みも拒否されること", async () => {
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("nodes.**.children", [], []));

    expect(message).toContain("[wcs/recursion-structural-write]");
    expect(message).toContain('"nodes.**.children" writes the recursion structure itself');
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();
  });

  it("子ノード（nodes.**.children.*）への書き込みも拒否されること", async () => {
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("nodes.**.children.*", [], node(0)));

    expect(message).toContain("[wcs/recursion-structural-write]");
    expect(message).toContain('"nodes.**.children.*" writes the recursion structure itself');
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();
  });

  it("反復語が何段重なっても構造は構造として拒否されること", async () => {
    const deeper = await rejects((s) => s.$setAll("nodes.**.children.*.children", [], []));
    expect(deeper.message).toContain("[wcs/recursion-structural-write]");
    expect(deeper.unchanged).toBe(true);
    deeper.host.remove();

    const deepest = await rejects((s) => s.$setAll("nodes.**.children.*.children.*", [], node(0)));
    expect(deepest.message).toContain("[wcs/recursion-structural-write]");
    expect(deepest.unchanged).toBe(true);
    deepest.host.remove();
  });

  it("多段の反復サブパス（branch.children.*）では、子リストへ至る途中のオブジェクトへの書き込みも構造として拒否されること", async () => {
    // 着地後レビューで実測した穴（実装計画 §7-3）: 反復単位を剥がした残りが `.branch` のとき、
    // `"." + repeatList`（`.branch.children`）との完全一致だけを見ていたので素通りし、深さ 0 の
    // `branch` を置き換えた瞬間に、この書き込みが確定済みの深さ 1 のアドレス
    // （`nodes.*.branch.children.*.branch`）が宙に浮いていた（2 件書いて深さ 1 のノードが消えた）。
    const nodes: any[] = [{ value: 1, branch: { children: [{ value: 10, branch: { children: [] } }] } }];
    const { host, stateEl } = await mount({ nodes, $recursion: { "nodes.*": "branch.children.*" } }, NO_RENDER_HTML);
    const before = JSON.stringify(nodes);

    for (const path of ["nodes.**.branch", "nodes.**.branch.children.*.branch", "nodes.**.branch.children"]) {
      const message = writeError(stateEl, (s: any) => { s.$setAll(path, [], { children: [] }); });
      expect(message, path).toContain("[wcs/recursion-structural-write]");
      expect(message, path).toContain(`"${path}" writes the recursion structure itself`);
      expect(message, path).toContain('(a node, its "branch.children" list or that list\'s length, or an object on the way to that list)');
      expect(JSON.stringify(nodes), `${path}: 1 件も書かれていない`).toBe(before);
    }

    // 対照: 葉は通る（綴りが接頭辞に似ていても、セグメント境界で一致しなければ構造ではない）
    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.**.value", [], 7); })).toBe("");
    expect(nodes[0].value).toBe(7);
    expect(nodes[0].branch.children[0].value).toBe(7);
    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.**.branchX", [], 1); })).toBe("");
    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.**.branch.note", [], "x"); })).toBe("");
    expect(nodes[0].branch.note).toBe("x");
    host.remove();
  });

  it("子リストの length（nodes.**.children.length）への書き込みも構造として拒否されること", async () => {
    // Fixed by post-landing review (P4) — was: `.length` を見ておらず `written=5` で通過し、
    // 全深さの `children` が `[]` に切り詰められ、集計は `[131, 2]` のまま stale に残った
    // （リストを置き換えるのと同じく、この書き込みが確定した深い側のアドレスを消す）。
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("nodes.**.children.length", [], 0));

    expect(message).toContain("[wcs/recursion-structural-write]");
    expect(message).toContain('"nodes.**.children.length" writes the recursion structure itself');
    expect(message).toContain("or that list's length");
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();

    // 反復語が重なっても同じ。多段の反復サブパスではリスト側の length だけが構造
    // （途中のオブジェクトの `length` は素のプロパティ）。
    const deeper = await rejects((s) => s.$setAll("nodes.**.children.*.children.length", [], 0));
    expect(deeper.message).toContain("[wcs/recursion-structural-write]");
    expect(deeper.unchanged).toBe(true);
    deeper.host.remove();

    const nodes: any[] = [{ value: 1, branch: { children: [{ value: 10, branch: { children: [] } }] } }];
    const nested = await mount({ nodes, $recursion: { "nodes.*": "branch.children.*" } }, NO_RENDER_HTML);
    expect(writeError(nested.stateEl, (s: any) => { s.$setAll("nodes.**.branch.children.length", [], 0); }))
      .toContain("[wcs/recursion-structural-write]");
    expect(nodes[0].branch.children).toHaveLength(1);
    expect(writeError(nested.stateEl, (s: any) => { s.$setAll("nodes.**.branch.length", [], 3); })).toBe("");
    expect(nodes[0].branch.length).toBe(3);
    nested.host.remove();
  });

  it("接尾辞の添字綴り（nodes.**.children.0 など）も畳んで構造・読み取り専用として拒否されること", async () => {
    // Fixed by cycle-2 review — was: 添字畳みは `**` を経ない綴り（recursiveGetterOwning）にしか
    // 掛かっておらず、`**` パス自身の接尾辞は素の文字列一致のままだった。
    // `nodes.**.children.0` は `written=5` で子 0 を置換したうえ空 children の行に子 0 を生やし
    // 集計は stale、`nodes.**.children.0.children` は行 0 の孫を消してから空 children の行で生の
    // `Reflect.set called on non-object`（部分書き込み＋診断でない例外）になっていた。
    const child = await rejects((s) => s.$setAll("nodes.**.children.0", [], { value: 999, children: [] }));
    expect(child.message).toContain("[wcs/recursion-structural-write]");
    expect(child.message).toContain('"nodes.**.children.0" writes the recursion structure itself');
    expect(child.unchanged, "1 件も書かれていない").toBe(true);
    child.host.remove();

    const grandList = await rejects((s) => s.$setAll("nodes.**.children.0.children", [], []));
    expect(grandList.message).toContain("[wcs/recursion-structural-write]");
    expect(grandList.unchanged, "部分書き込みも無い").toBe(true);
    grandList.host.remove();

    const length = await rejects((s) => s.$setAll("nodes.**.children.0.children.length", [], 0));
    expect(length.message).toContain("[wcs/recursion-structural-write]");
    expect(length.unchanged).toBe(true);
    length.host.remove();

    // getter の展開形（空の木でも第 1 相の前に落ちる）
    const total = await rejects((s) => s.$setAll("nodes.**.children.0.total", [], 5));
    expect(total.message).toContain('[wcs/recursion-readonly] "nodes.**.children.0.total" writes into the recursive getter "nodes.**.total"');
    expect(total.unchanged).toBe(true);
    total.host.remove();
    const { host, stateEl } = await mount(recursionState([]), NO_RENDER_HTML);
    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.**.children.0.total", [], 5); }))
      .toContain("[wcs/recursion-readonly]");
    host.remove();
  });

  it("反復語ぶんずれた展開形の値の内側（nodes.**.children.*.total.x）も列挙より前に [wcs/recursion-readonly] になること", async () => {
    // Fixed by cycle-4 review — was: `conflictingRecursiveGetter` が `sameFamily`（全体）と
    // `startsWith(def + ".")` しか見ず、反復語ぶんずれた展開形の値の内側をすり抜けて走査を実行し
    // （基準 commit 済み）、第 2 相の `setByAddressCore` で初めて具体パスを名指す readonly になっていた。
    // §7-3「形の拒否はすべて列挙より前」に揃え、`.` 境界の各接頭辞に `sameFamily` を掛ける。
    for (const path of ["nodes.**.children.*.total.x", "nodes.**.children.*.children.*.total.x.y"]) {
      const { message, unchanged, host } = await rejects((s) => s.$setAll(path, [], 1));
      expect(message, path).toContain(`[wcs/recursion-readonly] "${path}" writes into the recursive getter "nodes.**.total"`);
      expect(unchanged, path).toBe(true);
      host.remove();
    }
  });

  it("接尾辞が整形されていない `**` パス（空セグメント・`**` 直後の `*`）は [wcs/recursion-anchor] で拒否されること", async () => {
    // Fixed by cycle-4 review — was: `$setAll("nodes.**..x", [], 1)` が生の
    // `Reflect.set called on non-object`、`$getAll("nodes.**.", [])` が `[undefined×5]` になっていた。
    for (const path of ["nodes.**.", "nodes.**..x", "nodes.**.*", "nodes.**.*.x", "nodes.**.a..b"]) {
      const { message, unchanged, host } = await rejects((s) => s.$setAll(path, [], 1));
      expect(message, path).toContain("[wcs/recursion-anchor]");
      expect(message, path).toContain("well-formed suffix");
      expect(unchanged, path).toBe(true);
      host.remove();
    }
  });

  it("再帰 getter を名指す接尾辞は [wcs/recursion-readonly] になること", async () => {
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("nodes.**.total", [], 0));

    expect(message).toContain("[wcs/recursion-readonly]");
    expect(message).toContain('writes into the recursive getter "nodes.**.total"');
    expect(message).toContain("Write the values it derives from instead");
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();
  });

  it("反復語の整数倍だけ違う綴りも同じ getter 族として拒否されること", async () => {
    // Fixed by Phase D review — was: 完全一致しか見ていなかったので素通りしていた。
    // `nodes.**.children.*.total` は深さ k+1 で `nodes.**.total` と同じ具体パスになる。
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("nodes.**.children.*.total", [], 0));

    expect(message).toContain("[wcs/recursion-readonly]");
    expect(message).toContain('writes into the recursive getter "nodes.**.total"');
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();
  });

  it("再帰 getter の下（派生値の中）への書き込みも拒否されること", async () => {
    // Fixed by Phase D review — was: setByAddress が getter を評価して返った
    // オブジェクトへ Reflect.set し、キャッシュを汚したまま「書けた」と数えていた。
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("nodes.**.total.x", [], 0));

    expect(message).toContain("[wcs/recursion-readonly]");
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();
  });

  it("宣言に無いアンカーは [wcs/recursion-anchor] になること", async () => {
    const { message, unchanged, host } = await rejects(
      (s) => s.$setAll("other.**.value", [], 0));

    expect(message).toContain("[wcs/recursion-anchor]");
    expect(message).toContain('"other.**.value" does not match the declared recursion anchor "nodes.**"');
    expect(message).toContain("This version supports exactly one anchor per state");
    expect(unchanged, "1 件も書かれていない").toBe(true);
    host.remove();
  });

  it("対照: 構造でない接尾辞なら、反復語を含んでいても通ること", async () => {
    // `nodes.**.children.*.value` は「全深さの、各ノードの直下の子の value」。
    // 構造（ノード・子リスト・子ノード）ではないので拒否されない。
    const nodes = asymmetric();
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.children.*.value", [], 0));
    await flush();

    expect(count, "ルート 3 つ以外の 6 ノード").toBe(6);
    expect(union(stateEl)).toEqual([10, 0, 0, 0, 20, 30, 0, 0, 0]);
    host.remove();
  });

  it("対照: { spread: false } を明示しても通ること（拒否するのは true だけ）", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const count = writeCount(stateEl,
      (s: any) => s.$setAll("nodes.**.mark", [], "*", { spread: false }));
    await flush();

    expect(count).toBe(9);
    expect(union(stateEl, "nodes.**.mark")).toEqual(["*", "*", "*", "*", "*", "*", "*", "*", "*"]);
    host.remove();
  });

  it("検査の感度: この前後突き合わせは実際の書き込みを検出できること", async () => {
    // 上の 10 件が主張する「1 件も書かれていない」は、突き合わせが鈍感なら無条件に
    // 通ってしまう。同じ helper に**通る形**を渡して、`unchanged` が false に転ぶことを
    // 見ておく（＝生データの変化を検出できている）。
    const probe = await rejects((s) => { s.$setAll("nodes.**.mark", [], "*"); });

    expect(probe.message, "正しい形なので throw しない").toBe("");
    expect(probe.unchanged, "書けば検出される").toBe(false);
    probe.host.remove();
  });
});

// ---------------------------------------------------------------------------
// 4-2. 形の検査が列挙より前であること
//
// 「1 件も書かない」は、形の検査を**列挙の前**に置くことで保証されている（設計 §7-3）。
// 生データが変わらないことを見るだけでは、検査が列挙の後にあっても（列挙が成功して
// 第 2 相に入る前に落ちれば）同じ結果になる。そこで **列挙が必ず失敗するデータ**
// （循環・共有 children）を使い、どちらの診断が出るかで順序を確定させる。
// ---------------------------------------------------------------------------

describe("形の検査が列挙より前であること", () => {
  it("循環した木でも、形が不正なら循環ではなく形の診断が出ること", async () => {
    const a: TNode = node(1);
    a.children = [a];
    const nodes = [a];
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    const structural = writeError(stateEl, (s: any) => { s.$setAll("nodes.**", [], node(0)); });
    const mapper = writeError(stateEl,
      (s: any) => { s.$setAll("nodes.**.sel", [], (current: number) => current + 1); });
    const prefix = writeError(stateEl, (s: any) => { s.$setAll("nodes.**.sel", [1], 1); });

    expect(structural).toContain("[wcs/recursion-structural-write]");
    expect(mapper).toContain('$setAll("nodes.**.sel") with "**" does not take a mapper yet');
    expect(prefix).toContain("[wcs/recursion-setall-form]");
    for (const message of [structural, mapper, prefix]) {
      expect(message, "列挙まで進んでいない").not.toContain("[wcs/recursion-cycle]");
    }

    // 対照: 同じデータでも形が正しければ列挙まで進み、そこで循環が見つかる。
    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.**.sel", [], 1); }))
      .toContain("[wcs/recursion-cycle]");
    expect(countKey(nodes, "sel"), "どの形でも 1 件も書かれていない").toBe(0);
    expect(nodes[0].value, "ノードの差し替えも起きていない").toBe(1);
    host.remove();
  });

  it("兄弟が children を共有していても、形が不正なら共有ではなく形の診断が出ること", async () => {
    const shared = [node(9)];
    const nodes = [node(1, shared), node(2, shared)];
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    const spread = writeError(stateEl,
      (s: any) => { s.$setAll("nodes.**.sel", [], [1], { spread: true }); });
    const noIndexes = writeError(stateEl, (s: any) => { s.$setAll("nodes.**.sel", undefined, 1); });
    const readonlyGetter = writeError(stateEl, (s: any) => { s.$setAll("nodes.**.total", [], 0); });

    expect(spread).toContain('$setAll("nodes.**.sel") with "**" does not take { spread: true }');
    expect(noIndexes).toContain(
      '$setAll("nodes.**.sel") with "**" requires an explicit empty indexes array ([])');
    expect(readonlyGetter).toContain("[wcs/recursion-readonly]");
    for (const message of [spread, noIndexes, readonlyGetter]) {
      expect(message, "列挙まで進んでいない").not.toContain("[wcs/recursion-shared-list]");
    }

    // 対照: 形が正しければ列挙まで進み、そこで共有が見つかる。
    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.**.sel", [], 1); }))
      .toContain("[wcs/recursion-shared-list]");
    expect(countKey(nodes, "sel"), "どの形でも 1 件も書かれていない").toBe(0);
    host.remove();
  });
});

// ===========================================================================
// 5. 列挙が失敗する場合 — 1 件も書かれない
// ===========================================================================

describe("列挙が失敗したときに 1 件も書かれないこと", () => {
  it("兄弟が同じ children 配列を共有していると、書かずに [wcs/recursion-shared-list] になること", async () => {
    const shared = [node(9)];
    const nodes = [node(1, shared), node(2, shared)];
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    const message = writeError(stateEl, (s: any) => { s.$setAll("nodes.**.selected", [], true); });
    await flush();

    expect(message).toContain("[wcs/recursion-shared-list]");
    expect(countKey(nodes, "selected"), "1 件も書かれていない").toBe(0);
    host.remove();
  });

  it("循環している木では、書かずに [wcs/recursion-cycle] になること", async () => {
    const a: TNode = node(1);
    a.children = [a];
    const nodes = [a];
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    const message = writeError(stateEl, (s: any) => { s.$setAll("nodes.**.selected", [], true); });
    await flush();

    expect(message).toContain("[wcs/recursion-cycle]");
    expect(countKey(nodes, "selected"), "1 件も書かれていない").toBe(0);
    host.remove();
  });

  it("深さ上限を超える木では、書かずに [wcs/recursion-depth-exceeded] になること", async () => {
    // 129 段の鎖。走査は葉の 1 段先を投機的に読まないので、128 段ちょうどは通る（次の it）。
    const build = (n: number): TNode => n === 0 ? node(0) : node(n, [build(n - 1)]);
    const nodes = [build(128)];
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    const message = writeError(stateEl, (s: any) => { s.$setAll("nodes.**.mark", [], "*"); });

    expect(message).toContain("[wcs/recursion-depth-exceeded]");
    expect(message).toContain('Recursion on "nodes.*" reached depth 128');
    expect(message).toContain("the limit is 128");
    expect(countKey(nodes, "mark"), "浅い側にも 1 件も書かれていない").toBe(0);
    host.remove();
  });

  it("対照: 深さ 128 ちょうどの鎖には全段書けること", async () => {
    const build = (n: number): TNode => n === 0 ? node(0) : node(n, [build(n - 1)]);
    const nodes = [build(127)];
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.mark", [], "*"));

    expect(count).toBe(128);
    expect(countKey(nodes, "mark")).toBe(128);
    host.remove();
  });

  it("対照: 列挙を通過したあと（第 2 相）にユーザー setter が落ちる場合はロールバックしないこと", async () => {
    // 2 相構成が保証するのは「列挙が失敗したら 0 件」であって、書き込みの原子性ではない
    // （実装計画 §1-3）。落ちた時点までの書き込みは残る。
    const log: number[] = [];
    const mk = (value: number, children: TNode[] = []): TNode => {
      const created: TNode = { value, children } as TNode;
      let store: unknown = false;
      Object.defineProperty(created, "sel", {
        get() { return store; },
        set(next: unknown) {
          log.push(value);
          if (value === 10) throw new Error("boom");
          store = next;
        },
        enumerable: true, configurable: true,
      });
      return created;
    };
    const nodes = [mk(1, [mk(10), mk(11)]), mk(2)];
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    const message = writeError(stateEl, (s: any) => { s.$setAll("nodes.**.sel", [], true); });
    await flush();

    expect(message).toContain("boom");
    expect(log, "行きがけ順に 1 → 10 まで進んで止まる").toEqual([1, 10]);
    expect([nodes[0].sel, nodes[0].children[0].sel, nodes[0].children[1].sel, nodes[1].sel],
      "落ちる前の書き込みは残る").toEqual([true, false, false, false]);
    host.remove();
  });
});

// ===========================================================================
// 6. 境界
// ===========================================================================

describe("ブロードキャストの境界", () => {
  it("空の木では 0 件で、throw しないこと", async () => {
    const { host, stateEl } = await mount(recursionState([]), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.mark", [], "*"));
    await flush();

    expect(count).toBe(0);
    expect(union(stateEl, "nodes.**.mark")).toEqual([]);
    host.remove();
  });

  it("同じバッチでルートを差し込んでから書けること", async () => {
    const { host, stateEl } = await mount(recursionState([]), NO_RENDER_HTML);

    let count = -1;
    write(stateEl, (s: any) => {
      s.nodes = [node(1, [node(10)])];
      count = s.$setAll("nodes.**.mark", [], "*");
    });
    await flush();

    expect(count, "差し込んだ 2 ノード").toBe(2);
    expect(union(stateEl, "nodes.**.mark")).toEqual(["*", "*"]);
    host.remove();
  });

  it("深さ 1 の木（子がまったく無い）ではルートだけが書かれること", async () => {
    const { host, stateEl } = await mount(recursionState([node(1), node(2)]), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.selected", [], true));
    await flush();

    expect(count).toBe(2);
    expect(union(stateEl, "nodes.**.selected")).toEqual([true, true]);
    host.remove();
  });

  it("存在しないプロパティへの書き込みは、全ノードにそのプロパティを生やすこと", async () => {
    // 読みの「親が居ないパスは undefined」（寛容規約）の書き側。件数はノード数のまま。
    const nodes = asymmetric();
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);
    expect(union(stateEl, "nodes.**.missing"), "書く前は undefined で埋まる")
      .toEqual([undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined]);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.missing", [], 5));
    await flush();

    expect(count).toBe(9);
    expect(union(stateEl, "nodes.**.missing")).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5]);
    expect(snap(nodes)[1], "生データにも生える").toEqual({ value: 20, children: [], missing: 5 });
    host.remove();
  });

  it("木より深い接尾辞は、届いたぶんだけ書かれること", async () => {
    const { host, stateEl } = await mount(
      recursionState([node(1, [node(10)]), node(2)]), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.children.*.value", [], 99));
    await flush();

    expect(count, "子を持つのは node 1 だけ").toBe(1);
    expect(union(stateEl)).toEqual([1, 99, 2]);
    host.remove();
  });

  it("木より深い接尾辞が 1 件も届かなければ 0 件になること", async () => {
    const { host, stateEl } = await mount(recursionState([node(1), node(2)]), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.children.*.value", [], 99));
    await flush();

    expect(count).toBe(0);
    expect(union(stateEl)).toEqual([1, 2]);
    host.remove();
  });

  it("アンカーが配列でなければ 0 件で、throw しないこと", async () => {
    const { host, stateEl } = await mount(recursionState(null), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.mark", [], "*"));

    expect(count).toBe(0);
    expect(union(stateEl, "nodes.**.mark"), "読みも空で揃う").toEqual([]);
    host.remove();
  });
});

// ===========================================================================
// 7. cold — 走査を一度も経ていない state
// ===========================================================================

describe("cold な state でも合併形の $setAll が成立すること", () => {
  it("最初の操作がブロードキャストでも全深さに書けること（Phase A の A1 の対）", async () => {
    // 読みも描画も一度も走っていない state。`$setAll` は第 1 相（走査）を自分で持つので、
    // ListIndex 台帳をその場で作って書ける。
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.selected", [], true));
    await flush();

    expect(count).toBe(9);
    expect(union(stateEl, "nodes.**.selected"))
      .toEqual([true, true, true, true, true, true, true, true, true]);
    host.remove();
  });

  it("対照: cold な $resolve は台帳が無くて落ちること（第 1 相を持たない唯一の API）", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    expect(() => write(stateEl, (s: any) => { s.$resolve(valueAt(2), [0, 0, 0], 500); }))
      .toThrow(/ListIndexes not found/);
    host.remove();
  });

  it("cold なままブロードキャストしてから読んでも、木の形が壊れていないこと", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);
    write(stateEl, (s: any) => { s.$setAll("nodes.**.mark", [], "*"); });
    await flush();

    // 書き込みは読みの差分基準を動かさない（commitDiffBaseline: false）。その後の
    // 構造変更も、読みから見れば普通に検出できる。
    expect(union(stateEl)).toEqual(PREORDER);
    write(stateEl, (s: any) => { s.nodes = [s.nodes[2], s.nodes[0], s.nodes[1]]; });
    await flush();

    expect(union(stateEl)).toEqual([30, 31, 32, 33, 10, 11, 12, 13, 20]);
    expect(writeCount(stateEl, (s: any) => s.$setAll("nodes.**.value", [], 5)),
      "並べ替え後も全件に届く").toBe(9);
    host.remove();
  });
});

// ===========================================================================
// 8. 描画あり
// ===========================================================================

describe("描画した木へのブロードキャスト", () => {
  it("3 段の for で描いた全行の表示が追従すること", async () => {
    const { host, shadowRoot, stateEl } = await mount(
      recursionState(seedMark(asymmetric())), TREE_HTML);
    expect(texts(shadowRoot, ".m0"), "初期表示").toEqual(["-", "-", "-"]);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.mark", [], "*"));
    await flush();

    expect(count).toBe(9);
    expect({
      v0: texts(shadowRoot, ".v0"), v1: texts(shadowRoot, ".v1"), v2: texts(shadowRoot, ".v2"),
      m0: texts(shadowRoot, ".m0"), m1: texts(shadowRoot, ".m1"), m2: texts(shadowRoot, ".m2"),
    }).toEqual({
      v0: ["10", "20", "30"], v1: ["11", "13", "31"], v2: ["12", "32", "33"],
      m0: ["*", "*", "*"], m1: ["*", "*", "*"], m2: ["*", "*", "*"],
    });
    host.remove();
  });

  it("値のブロードキャストが、各行の表示と合併集計の表示の両方に出ること", async () => {
    const { host, shadowRoot, stateEl } = await mount(
      recursionState(seedMark(asymmetric())), TREE_HTML);
    expect(texts(shadowRoot, ".sum")[0], "初期の合計").toBe("192");

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.value", [], 1));
    await flush();

    expect(count).toBe(9);
    expect(texts(shadowRoot, ".sum")[0], "9 × 1").toBe("9");
    expect(texts(shadowRoot, ".v0")).toEqual(["1", "1", "1"]);
    expect(texts(shadowRoot, ".v1")).toEqual(["1", "1", "1"]);
    expect(texts(shadowRoot, ".v2")).toEqual(["1", "1", "1"]);
    host.remove();
  });

  it("行ごとの再帰 getter（.total）の表示が、全深さで作り直されること", async () => {
    // 合併集計（`treeTotal`）は state の 1 箇所だけを見ればよいが、こちらは**行ごとに
    // 別の getter インスタンス**。ブロードキャストが各深さの依存を落としているかは、
    // 深い行の表示が古いままにならないかで分かる。
    //   初期: 12→12 / 11→11+12=23 / 13→13 / 10→10+23+13=46 / 20→20
    //         32→32 / 33→33 / 31→31+32+33=96 / 30→30+96=126
    //   7 一律: 12→7 / 11→14 / 13→7 / 10→28 / 20→7 / 32→7 / 33→7 / 31→21 / 30→28
    const { host, shadowRoot, stateEl } = await mount(
      recursionState(asymmetric()), TOTAL_HTML);
    expect({
      t0: texts(shadowRoot, ".t0"), t1: texts(shadowRoot, ".t1"), t2: texts(shadowRoot, ".t2"),
    }, "初期表示").toEqual({
      t0: ["46", "20", "126"], t1: ["23", "13", "96"], t2: ["12", "32", "33"],
    });

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.value", [], 7));
    await flush();

    expect(count).toBe(9);
    expect({
      t0: texts(shadowRoot, ".t0"), t1: texts(shadowRoot, ".t1"), t2: texts(shadowRoot, ".t2"),
    }).toEqual({
      t0: ["28", "7", "28"], t1: ["14", "7", "21"], t2: ["7", "7", "7"],
    });
    host.remove();
  });

  it("描画が 1 段しか無くても全深さに書けること（描画は書き込みの前提ではない）", async () => {
    const nodes = seedMark([node(1, [node(10, [node(100)])]), node(2)]);
    const { host, shadowRoot, stateEl } = await mount(recursionState(nodes),
      `<template data-wcs="for: nodes"><span class="m">{{ .mark }}</span></template>`);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.**.mark", [], "*"));
    await flush();

    expect(count, "描かれていない深さも含めて 4 ノード").toBe(4);
    expect(texts(shadowRoot, ".m"), "描かれているのはルートの 2 行だけ").toEqual(["*", "*"]);
    expect(union(stateEl, "nodes.**.mark")).toEqual(["*", "*", "*", "*"]);
    host.remove();
  });
});

// ===========================================================================
// 9. 回帰の対照 — 通常の `*` パスは従来どおり
// ===========================================================================

describe("回帰: 再帰宣言のある state でも ** を含まないパスは従来どおりであること", () => {
  it("接頭辞を省いた [] の一括書き込みが、その深さだけに届くこと", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.*.children.*.value", [], 0));
    await flush();

    expect(count, "深さ 1 の 3 ノードだけ（孫は含まない）").toBe(3);
    expect(union(stateEl)).toEqual([10, 0, 12, 0, 20, 30, 0, 32, 33]);
    host.remove();
  });

  it("非空の接頭辞で行を絞れること", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const count = writeCount(stateEl, (s: any) => s.$setAll("nodes.*.children.*.value", [0], 0));
    await flush();

    expect(count, "node 10 の子だけ").toBe(2);
    expect(union(stateEl)).toEqual([10, 0, 12, 0, 20, 30, 31, 32, 33]);
    host.remove();
  });

  it("mapper が第一級のまま使えること（添字も渡る）", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const count = writeCount(stateEl,
      (s: any) => s.$setAll("nodes.*.value", [], (current: number, i: number) => current + i));
    await flush();

    expect(count).toBe(3);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.value", [])), "10+0 / 20+1 / 30+2")
      .toEqual([10, 21, 32]);
    host.remove();
  });

  it("{ spread: true } がマッチ順に配れること", async () => {
    const { host, stateEl } = await mount(recursionState(asymmetric()), NO_RENDER_HTML);

    const count = writeCount(stateEl,
      (s: any) => s.$setAll("nodes.*.value", [], [7, 8, 9], { spread: true }));
    await flush();

    expect(count).toBe(3);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.value", []))).toEqual([7, 8, 9]);
    host.remove();
  });

  it("対照: 再帰宣言の無い state でも mapper / spread は同じであること", async () => {
    const { host, stateEl } = await mount(
      { users: [{ n: 1 }, { n: 2 }, { n: 3 }] }, NO_RENDER_HTML);

    const mapped = writeCount(stateEl,
      (s: any) => s.$setAll("users.*.n", [], (current: number, i: number) => current * 10 + i));
    await flush();
    expect(mapped).toBe(3);
    expect(read(stateEl, (s: any) => s.$getAll("users.*.n", []))).toEqual([10, 21, 32]);

    const spread = writeCount(stateEl,
      (s: any) => s.$setAll("users.*.n", [], [4, 5, 6], { spread: true }));
    await flush();
    expect(spread).toBe(3);
    expect(read(stateEl, (s: any) => s.$getAll("users.*.n", []))).toEqual([4, 5, 6]);
    host.remove();
  });

  it("対照: 宣言の無い state に ** を渡すと [wcs/recursion-unsupported] になること", async () => {
    // 再帰の入口（setAllRecursive）にすら入らない。`**` は PathInfo の intern で弾かれる。
    const nodes = [node(1, [node(10)])];
    const { host, stateEl } = await mount({ nodes }, NO_RENDER_HTML);

    const message = writeError(stateEl, (s: any) => { s.$setAll("nodes.**.value", [], 9); });

    expect(message).toContain("[wcs/recursion-unsupported]");
    expect(message).toContain('"nodes.**.value" uses "**", which is not accepted here');
    expect(message).toContain("only when the state declares a $recursion anchor");
    expect(snap(nodes), "1 件も書かれていない").toEqual(
      [{ value: 1, children: [{ value: 10, children: [] }] }]);
    host.remove();
  });
});

// ===========================================================================
// 10. readonly セッション — 現状の記録（Phase A の X1）
// ===========================================================================

// ---------------------------------------------------------------------------
// 9'. `**` を経ない入口からの、再帰 getter の展開形への書き込み
// ---------------------------------------------------------------------------

describe("具体パス綴りでの再帰 getter への書き込み（`**` を経ない入口）", () => {
  // Fixed by post-landing review (P18) — was: `$setAll("nodes.*.children.*.total", [], 5)` は
  // `**` を含まないので `setAllRecursive` の読み取り専用検査を通らず、未実体化なら
  // `setByAddress` の fast path が「親オブジェクトの未存在キー」として行オブジェクトへ
  // `total: 5` を書き（`written=2`・例外なし）、代入値を `dirty:false` でキャッシュに載せて
  // 以後 getter が評価されなかった（`$getAll("nodes.**.total", [])` が `[11, 5, 100, 5, 2]`）。
  // 実体化後は `Reflect.set` が false を返すだけの無言 no-op。読み側の遅延実体化（E5）と
  // 対称に、書き側は `setByAddress` の入口で `wcs/recursion-readonly` にする。
  const concrete = (s: any) => s.$setAll("nodes.*.children.*.total", [], 5);
  /** 深さ 3 の木（total は 131 / 110 / 100 / 20 / 2） */
  const forest = (): TNode[] => [node(1, [node(10, [node(100)]), node(20)]), node(2)];

  it("未実体化（cold）の展開形への $setAll が [wcs/recursion-readonly] で拒否され、ノードが汚れないこと", async () => {
    const nodes = forest();
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);
    const before = snap(nodes);

    const message = writeError(stateEl, concrete);
    expect(message).toContain("[wcs/recursion-readonly]");
    expect(message).toContain('"nodes.*.children.*.total" writes into the recursive getter "nodes.**.total"');
    expect(message).toContain("Write the values it derives from instead");
    expect(snap(nodes), "行オブジェクトに total が生えていない").toEqual(before);
    // 集計は汚れていない（代入値がキャッシュに固定されていない）
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", []))).toEqual([131, 110, 100, 20, 2]);
    host.remove();
  });

  it("実体化後（warm）も同じ診断になること（無言の no-op にしない）", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    read(stateEl, (s: any) => s.$getAll("nodes.**.total", []));

    expect(writeError(stateEl, concrete)).toContain("[wcs/recursion-readonly]");
    host.remove();
  });

  it("直接代入・値付き $resolve・展開形の値の内側も同じ入口で止まること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    read(stateEl, (s: any) => s.$getAll("nodes.**.total", []));

    expect(writeError(stateEl, (s: any) => { s["nodes.1.total"] = 9; }))
      .toContain('[wcs/recursion-readonly] "nodes.*.total" writes into the recursive getter "nodes.**.total"');
    expect(writeError(stateEl, (s: any) => { s.$resolve("nodes.*.total", [1], 9); }))
      .toContain("[wcs/recursion-readonly]");
    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.*.total.x", [], 9); }))
      .toContain('[wcs/recursion-readonly] "nodes.*.total.x" writes into the recursive getter "nodes.**.total"');
    host.remove();
  });

  it("API のパス引数の添字綴り（nodes.1.total）も同じ入口で止まり、行オブジェクトが汚れないこと", async () => {
    // Fixed by post-landing review (round 3) — was: `$setAll("nodes.1.total", [], 9)` /
    // `$resolve("nodes.0.children.0.total", [], 1)` は set トラップと違って getResolvedAddress の
    // 正規化を経ないので `nodes.*` で始まらず、読み取り専用検査を素通りして `nodes[1].total = 9`
    // が生の行オブジェクトへ書かれていた（getter は勝ち続けるので集計は壊れないが、
    // `$getAll("nodes.1.total", [])` がその汚れた値を返す）。
    const nodes = forest();
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);
    const before = snap(nodes);

    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.1.total", [], 9); }))
      .toContain('[wcs/recursion-readonly] "nodes.1.total" writes into the recursive getter "nodes.**.total"');
    expect(writeError(stateEl, (s: any) => { s.$resolve("nodes.0.children.0.total", [], 1); }))
      .toContain("[wcs/recursion-readonly]");
    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.0.total.x", [], 1); }))
      .toContain("[wcs/recursion-readonly]");
    expect(snap(nodes), "行オブジェクトに total が生えていない").toEqual(before);
    // 対照: 添字綴りの葉は書ける
    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.1.value", [], 5); })).toBe("");
    expect(nodes[1].value).toBe(5);
    host.remove();
  });

  it("ワイルドカードと添字の混在綴り（nodes.*.children.0.total）も畳んで止まること", async () => {
    // Fixed by post-landing review (round 4) — was: 添字畳みを「アンカーで始まらないとき」にしか
    // 掛けていなかったので、アンカーで始まる混在綴りは畳まれず素通りした。`$setAll` は行 0 の
    // `children[0]` に `total: 5` を書いた**後**、children が空の行 1 で生の
    // `Reflect.set called on non-object` になり（部分書き込み＋診断でない例外）、`$resolve` は
    // 例外なしで汚染していた。静的側（`owningGetterSuffix`）は無条件に畳むので捕まえていた。
    const nodes = forest();
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);
    const before = snap(nodes);

    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.*.children.0.total", [], 5); }))
      .toContain('[wcs/recursion-readonly] "nodes.*.children.0.total" writes into the recursive getter "nodes.**.total"');
    expect(writeError(stateEl, (s: any) => { s.$resolve("nodes.*.children.0.total", [0], 6); }))
      .toContain("[wcs/recursion-readonly]");
    expect(writeError(stateEl, (s: any) => { s.$setAll("nodes.0.children.*.total.x", [], 1); }))
      .toContain("[wcs/recursion-readonly]");
    expect(snap(nodes), "1 件も書かれていない（部分書き込みも無い）").toEqual(before);
    // 対照: 混在綴りの葉は書ける
    expect(writeError(stateEl, (s: any) => { s.$resolve("nodes.*.children.0.value", [0], 5); })).toBe("");
    expect(nodes[0].children[0].value).toBe(5);
    host.remove();
  });

  it("対照: 葉の具体パス・アンカー外・宣言の無い state は従来どおり書けること", async () => {
    const nodes = forest();
    const { host, stateEl } = await mount(recursionState(nodes, {
      title: { value: "t", writable: true, enumerable: true, configurable: true },
    }), NO_RENDER_HTML);

    expect(writeCount(stateEl, (s: any) => s.$setAll("nodes.*.children.*.value", [], 3))).toBe(2);
    expect(nodes[0].children.map((n) => n.value)).toEqual([3, 3]);
    expect(writeError(stateEl, (s: any) => { s["nodes.1.total2"] = 9; })).toBe("");
    expect(writeError(stateEl, (s: any) => { s.title = "u"; })).toBe("");
    // 107 = 1 + (3 + 100) + 3
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", []))).toEqual([107, 103, 100, 3, 2]);
    host.remove();

    const plain = forest();
    const control = await mount({ nodes: plain }, NO_RENDER_HTML);
    expect(writeCount(control.stateEl, (s: any) => s.$setAll("nodes.*.children.*.total", [], 5))).toBe(2);
    expect(plain[0].children[0].total).toBe(5);
    control.host.remove();
  });
});

describe("readonly セッションの中のブロードキャスト（現状の記録）", () => {
  // DEFECT: readonly セッションの中では合併形の $setAll も拒否されるべき
  //         （"This state is readonly." で throw し、書き込み 0 件）。
  //         ガードは src/proxy/StateHandler.ts の set トラップにしか無く、
  //         $setAll は setByAddress を直接呼ぶので掛からない（Phase A の X1）。
  //         これは再帰固有の欠陥ではなく、通常の `*` パスの $setAll と同じ穴である。
  //         setAll.ts / resolve.ts の入口、あるいは setByAddress にガードを足したら反転する。
  it("readonly の中でもブロードキャストが実データを書き換えること（直代入だけが拒否される）", async () => {
    const nodes = asymmetric();
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);

    let count = -1;
    let assignError: string | null = null;
    stateEl.createState("readonly", (s: any) => {
      count = s.$setAll("nodes.**.selected", [], true);
      try { s.nodes = []; } catch (e: any) { assignError = String(e && e.message); }
    });
    await flush();

    expect(count).toBe(9);                                  // should be: throw（0 件）
    expect(countKey(nodes, "selected")).toBe(9);            // should be: 0
    // 対照: 同じ readonly セッションでも、直代入だけは正しく拒否される
    expect(assignError).toBe("[@wcstack/state] This state is readonly.");
    expect(nodes.map((n) => n.value), "直代入は効いていない").toEqual([10, 20, 30]);
    host.remove();
  });
});
