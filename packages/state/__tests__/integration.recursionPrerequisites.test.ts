/**
 * integration.recursionPrerequisites.test.ts — 再帰パス
 * （docs/state-recursive-path-design.md）の実装が土台にしている「今日すでに
 * 正しく動く挙動」を固定する回帰テスト。
 *
 * ここに置くのは前提条件だけで、既知の欠陥（描画なしルートリストの世代分裂・
 * DAG の無言誤答・$n の断崖・深さ超過診断の誤告発など）は別ファイルが持つ。
 * ここが赤くなったら再帰パスの土台が崩れる、という契約だけを入れている。
 *
 * 固定している 5 つの前提:
 *  1. cold start — `for` バインドが 1 つも無い state でも、最初の
 *     ワイルドカード操作が `$getAll` / `$setAll` なら通る（設計書 §7-2 本文の
 *     「$setAll も throw する」は誤りで、その訂正の正本）。走査を持たない
 *     `$resolve` も、#324 以降は台帳の無い段でその場で台帳を生やして通る
 *     （以前は `ListIndexes not found` で throw する唯一の API だった）。
 *     再帰パスが最終的に生成する形そのもの ―― 行 getter が内側で添字を省略した
 *     `$getAll` を撃つ ―― も cold で成立し、1 回の読みで全段の台帳が温まる。
 *  2. 手動アンロールした再帰集計は、`for` がある構成なら構造変更（葉の更新・
 *     追加・削除・並べ替え・リスト置換・同一バッチ複数変更）に全段追従する。
 *     `for` はルートリストに 1 本あれば足り、ネストしたリスト
 *     （`nodes.*.children`）は `for` が無くても追従する。
 *  3. 遅延実体化（`defineTreeAccessor`）は「そのパスを最初に読むより前に生やす」
 *     なら成立する。`getterPaths` 登録は必須（無いと getter の `this` が生 state に
 *     なる）で、構造変更を伴うなら `listPaths` も併せて要る。
 *  4. cold な top-down 評価の実効上限は 128 段（`pushAddress` / `MAX_LOOP_DEPTH`）。
 *     ワイルドカード段数そのものにエンジン側の上限は無く、上限はパス形状ではなく
 *     同時に積まれた getter フレーム数（ワイルドカード無しの鎖でも同じ 128 / 129）。
 *  5. 集計 getter の内側は `$getAll(path)`（添字省略＝直下の子だけ）と
 *     `$getAll(path, [])`（明示＝全深さ合併）で意味が変わる。このファイルと
 *     known-defects 側の集計 getter はすべて省略形を前提にしている。
 *
 * 出典は Phase A のプローブ A-cold / B-struct / C-replace / D-lazy / E-grow /
 * F-limits の実測値（検証者の追試 V9 / V14 / V16-V18 を含む）。期待値はそこで
 * 観測されたもの、または同条件をこのファイルで再実行して確認したものだけを書いている。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { flush, makeMount, node, read, write, type TNode } from "./helpers/recursionTestUtils";
import { getListIndexesByList } from "../src/list/listIndexesByList";
import { getPathInfo } from "../src/address/PathInfo";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;   // mountSelfExpanding（自前のホスト組み立て）が使う
const mount = makeMount("recursion-prereq-host");

// ---------------------------------------------------------------------------
// 木と、手動アンロールした再帰集計（node / read / write は helpers/recursionTestUtils）
// ---------------------------------------------------------------------------

const baseAt = (d: number) => "nodes.*" + ".children.*".repeat(d);
const totalAt = (d: number) => baseAt(d) + ".total";
/** 深さ d の行が持つ子リストのパス（d=0 はルートリスト） */
const listAt = (d: number) =>
  d === 0 ? "nodes" : "nodes.*" + ".children.*".repeat(d - 1) + ".children";

const DEEP_LEAF = "nodes.*.children.*.children.*.value";

/**
 * 深さ d の集計 getter。子の合計は添字を**省略**して読む（文脈束縛＝直下の子だけを
 * 畳む）。`[]` を明示すると孫まで合流して二重計上になる。
 */
function totalDescriptor(base: string): PropertyDescriptor {
  return {
    get(this: any) {
      const childTotals: number[] = this.$getAll(base + ".children.*.total");
      return this[base + ".value"] + childTotals.reduce((a, b) => a + b, 0);
    },
    enumerable: true,
    configurable: true,
  };
}

/** 深さ maxDepth まで再帰集計を手で展開する（再帰パスの手動シミュレーション） */
function defineTotals<T extends object>(state: T, maxDepth: number): T {
  for (let d = 0; d <= maxDepth; d++) {
    Object.defineProperty(state, totalAt(d), totalDescriptor(baseAt(d)));
  }
  Object.defineProperty(state, "grandTotal", {
    get(this: any) {
      return this.$getAll("nodes.*.total", []).reduce((a: number, b: number) => a + b, 0);
    },
    enumerable: true,
    configurable: true,
  });
  return state;
}

/** nodes[0] = 1 + (10 + 100) + 20 = 131 / nodes[1] = 2 / grandTotal = 133 */
const forestState = () => defineTotals({
  nodes: [node(1, [node(10, [node(100)]), node(20)]), node(2)],
}, 2);

/** ルートが 3 行、それぞれ子 1 個。totals = [11, 22, 44] */
const threeRootsState = () => defineTotals({
  nodes: [node(1, [node(10)]), node(2, [node(20)]), node(4, [node(40)])],
}, 2);

function agg(stateEl: State) {
  return read(stateEl, (s: any) => ({
    gt: s.grandTotal,
    d0: s.$getAll("nodes.*.total", []),
    d1: s.$getAll("nodes.*.children.*.total", []),
    d2: s.$getAll("nodes.*.children.*.children.*.total", []),
  }));
}

/** 3 段の `for` でツリーを描く（各段の total を描画する） */
const TREE_HTML =
  `<div><template data-wcs="for: nodes">` +
  `<div><span class="t0">{{ .total }}</span>` +
  `<template data-wcs="for: nodes.*.children">` +
  `<div><span class="t1">{{ .total }}</span>` +
  `<template data-wcs="for: nodes.*.children.*.children">` +
  `<div><span class="t2">{{ .total }}</span></div>` +
  `</template></div></template></div></template></div>` +
  `<span class="gt" data-wcs="textContent: grandTotal"></span>`;

/** ルートリストにだけ `for` を置き、children は一切描画しない */
const ROOT_FOR_HTML =
  `<div><template data-wcs="for: nodes">` +
  `<div><span class="t0" data-wcs="textContent: nodes.*.total"></span></div>` +
  `</template></div>`;

/** `for` が 1 つも無い（バインドそのものが無い） */
const NO_FOR_HTML = `<div></div>`;

const texts = (sr: ShadowRoot, sel: string) =>
  Array.from(sr.querySelectorAll(sel)).map((e) => e.textContent!.trim());
const dom = (sr: ShadowRoot) => ({
  gt: texts(sr, ".gt")[0],
  t0: texts(sr, ".t0"),
  t1: texts(sr, ".t1"),
  t2: texts(sr, ".t2"),
});

// ===========================================================================
// 1. cold start の非対称性（A-cold）
// ===========================================================================

/** 深さ 2 の木。`for` は無く、data-wcs はスカラー 1 本しか触らない */
const coldTree = () => ({
  title: "cold",
  nodes: [
    { value: 1, children: [{ value: 10, children: [] }, { value: 11, children: [] }] },
    { value: 2, children: [{ value: 20, children: [] }] },
  ],
});
const COLD_HTML = `<span data-wcs="textContent: title"></span>`;
const COLD_LEAF = "nodes.*.children.*.value";
const shapeOf = (raw: any) => raw.nodes.map((n: any) => n.children.map((c: any) => c.value));

/**
 * まだ 1 度も走査されていない（＝ ListIndex 台帳がどこにも無い）ことを確かめる。
 * これが無いと「mount 中に誰かが温めていた」可能性を排除できず、以降の
 * 「cold でも通る」という主張が偶然の産物になる。
 */
function expectColdLedger(raw: any): void {
  expect(getListIndexesByList(raw.nodes), "nodes の台帳").toBe(null);
  for (const n of raw.nodes) {
    expect(getListIndexesByList(n.children), "children の台帳").toBe(null);
  }
}

describe("cold start（for バインドが 1 つも無い state）の非対称性", () => {
  it("最初のワイルドカード操作が $getAll(path, []) なら値が返ること", async () => {
    const raw = coldTree();
    const { host, stateEl } = await mount(raw, COLD_HTML);
    expectColdLedger(raw);

    expect(read(stateEl, (s: any) => s.$getAll(COLD_LEAF, []))).toEqual([10, 11, 20]);
    host.remove();
  });

  it("ListIndex 台帳は mount では作られず、走査 API（$getAll）が作ること", async () => {
    // expectColdLedger（= 台帳が null）が空虚な検査でないことを、この 1 本が保証する。
    // ここが壊れると「cold でも通る」という上下のテストがすべて無意味になる。
    const raw = coldTree();
    const { host, stateEl } = await mount(raw, COLD_HTML);
    expectColdLedger(raw);

    read(stateEl, (s: any) => s.$getAll(COLD_LEAF, []));

    const rows = getListIndexesByList(raw.nodes)!;
    expect(rows, "$getAll の後").toHaveLength(2);
    // 子の行はその行（親）のもとにある
    expect(getListIndexesByList(raw.nodes[0].children), "$getAll の後（子）").toHaveLength(2);
    host.remove();
  });

  it("最初のワイルドカード操作が添字省略の $getAll(path) でも [] 明示と同じ全展開になること", async () => {
    // トップレベル文脈（`for` の中でも行 getter の中でもない）では、省略は
    // 「整合する最長接頭辞が空」＝全展開に落ちる。
    const raw = coldTree();
    const { host, stateEl } = await mount(raw, COLD_HTML);
    expectColdLedger(raw);

    expect(read(stateEl, (s: any) => s.$getAll(COLD_LEAF))).toEqual([10, 11, 20]);
    host.remove();
  });

  it("最初のワイルドカード操作が $setAll(path, [], v) でも throw せず、件数と実データの両方が更新されること", async () => {
    // 設計書 §7-2 本文の「走査を経ていないリストへの $setAll は throw する」を
    // 訂正する中心的な回帰テスト。$setAll は第 1 相の走査で自分の台帳を作る。
    const raw = coldTree();
    const { host, stateEl } = await mount(raw, COLD_HTML);
    expectColdLedger(raw);

    let count: number | null = null;
    write(stateEl, (s: any) => { count = s.$setAll(COLD_LEAF, [], 99); });
    await flush();

    expect(count, "書き込み件数").toBe(3);
    // setInitialState は生オブジェクトの identity を保つので、生データを直接見られる
    expect(shapeOf(raw), "生データ").toEqual([[99, 99], [99]]);
    expect(read(stateEl, (s: any) => s.$getAll(COLD_LEAF, [])), "読み戻し").toEqual([99, 99, 99]);
    host.remove();
  });

  it("cold な $setAll の mapper 形は、位置ごとに異なる値を書き分けること", async () => {
    // 定数ブロードキャストだけだと「1 箇所しか書けていない」欠陥を件数が隠しうる。
    // mapper で位置ごとに異なる値を書き、宛先が本当にばらけていることを見る。
    const raw = coldTree();
    const { host, stateEl } = await mount(raw, COLD_HTML);
    expectColdLedger(raw);

    let count: number | null = null;
    write(stateEl, (s: any) => {
      count = s.$setAll(COLD_LEAF, [], (cur: number, i: number, j: number) => cur * 100 + i * 10 + j);
    });
    await flush();

    expect(count).toBe(3);
    expect(shapeOf(raw)).toEqual([[1000, 1101], [2010]]);
    host.remove();
  });

  it("最初のワイルドカード操作が $resolve(path, indexes) でも、降りた段の台帳をその場で生やして通ること（#324）", async () => {
    // 修正前は、深さ 2 でも 1 段でも最初の cold な段の名前で落ちた
    //   — was: "[@wcstack/state] ListIndexes not found: nodes"
    const raw = coldTree();
    const { host, stateEl } = await mount(raw, COLD_HTML);
    expectColdLedger(raw);

    expect(read(stateEl, (s: any) => s.$resolve(COLD_LEAF, [0, 0]))).toBe(10);
    // 降りた段（nodes と nodes[0].children）だけに台帳ができる
    expect(getListIndexesByList(raw.nodes), "nodes の台帳").toHaveLength(2);
    expect(getListIndexesByList(raw.nodes[0].children), "降りた children の台帳").toHaveLength(2);
    expect(getListIndexesByList(raw.nodes[1].children), "降りなかった children の台帳").toBe(null);
    host.remove();

    const raw2 = coldTree();
    const m2 = await mount(raw2, COLD_HTML);
    expectColdLedger(raw2);
    expect(read(m2.stateEl, (s: any) => s.$resolve("nodes.*.value", [0]))).toBe(1);
    m2.host.remove();
  });

  it("cold $resolve が生やした台帳を、同一 state の $getAll がそのまま使うこと", async () => {
    // 台帳の出どころが走査 API でも $resolve でも、行は 1 組にまとまる。
    const raw = coldTree();
    const { host, stateEl } = await mount(raw, COLD_HTML);
    expectColdLedger(raw);

    let rows: unknown = null;
    let childRows: unknown = null;
    const log = read(stateEl, (s: any) => {
      const out: string[] = [];
      out.push("resolve#1 = " + s.$resolve(COLD_LEAF, [0, 1]));
      rows = getListIndexesByList(raw.nodes);
      childRows = getListIndexesByList(raw.nodes[0].children);
      out.push("getAll = " + JSON.stringify(s.$getAll(COLD_LEAF, [])));
      out.push("resolve#2 = " + s.$resolve(COLD_LEAF, [0, 1]));
      return out;
    });

    // Fixed by #324 — was: "resolve#1 THROW [@wcstack/state] ListIndexes not found: nodes"
    expect(log).toEqual(["resolve#1 = 11", "getAll = [10,11,20]", "resolve#2 = 11"]);
    // $getAll は $resolve が生やした台帳（行）を差し替えずに使う
    expect(rows).not.toBe(null);
    expect(getListIndexesByList(raw.nodes)).toBe(rows);
    expect(getListIndexesByList(raw.nodes[0].children)).toBe(childRows);
    host.remove();
  });

  it("cold $setAll の直後は、走査を挟まずに深いパスでも 1 段浅いパスでも $resolve が通ること", async () => {
    // $setAll の第 1 相は降りた全ワイルドカード段の台帳を作る。$getAll を先に
    // 撃つと「$getAll が温めたから通った」になるので、読みは $resolve から始める。
    const raw = coldTree();
    const { host, stateEl } = await mount(raw, COLD_HTML);
    expectColdLedger(raw);

    write(stateEl, (s: any) => { s.$setAll(COLD_LEAF, [], 99); });
    await flush();

    const out = read(stateEl, (s: any) => ({
      deep: s.$resolve(COLD_LEAF, [0, 1]),
      shallow: s.$resolve("nodes.*.value", [1]),
    }));
    expect(out).toEqual({ deep: 99, shallow: 2 });
    host.remove();
  });

  it("接頭辞つきの $setAll は、降りなかった枝を cold のまま残すこと", async () => {
    // 温度は state 単位でもリスト単位でもなく「ワイルドカード段 × 枝」単位。
    const raw = coldTree();
    const { host, stateEl } = await mount(raw, COLD_HTML);
    expectColdLedger(raw);

    let count: number | null = null;
    write(stateEl, (s: any) => { count = s.$setAll(COLD_LEAF, [0], -1); });
    await flush();

    expect(count).toBe(2);
    expect(shapeOf(raw)).toEqual([[-1, -1], [20]]);
    // 降りた枝（nodes[0]）は温まっている
    expect(getListIndexesByList(raw.nodes[0].children), "降りた枝の台帳").toHaveLength(2);
    expect(read(stateEl, (s: any) => s.$resolve(COLD_LEAF, [0, 1]))).toBe(-1);
    // 降りなかった枝（nodes[1].children）は cold のまま残る
    expect(getListIndexesByList(raw.nodes[1].children), "降りなかった枝の台帳").toBe(null);
    // その枝への $resolve は、台帳をその場で生やして通る
    // Fixed by #324 — was: throw "[@wcstack/state] ListIndexes not found: nodes.*.children"
    expect(read(stateEl, (s: any) => s.$resolve(COLD_LEAF, [1, 0]))).toBe(20);
    expect(getListIndexesByList(raw.nodes[1].children), "$resolve の後").toHaveLength(1);
    host.remove();
  });

  it("空リスト・データより深いパス・存在しないプロパティへの $getAll / $setAll が無言で [] / 0 を返すこと", async () => {
    // 「黙って 0 件」は現行の契約。再帰パスの走査一般化がここを変えるなら、
    // このテストが最初に落ちる。
    const empty = { title: "cold", nodes: [] as any[] };
    const a = await mount(empty, COLD_HTML);
    expect(read(a.stateEl, (s: any) => s.$getAll(COLD_LEAF, [])), "空リストの読み").toEqual([]);
    let emptyCount: number | null = null;
    write(a.stateEl, (s: any) => { emptyCount = s.$setAll(COLD_LEAF, [], 1); });
    expect(emptyCount, "空リストの書き").toBe(0);
    a.host.remove();

    const b = await mount(coldTree(), COLD_HTML);
    expect(read(b.stateEl, (s: any) => s.$getAll(DEEP_LEAF, [])), "データより深いパスの読み").toEqual([]);
    let deepCount: number | null = null;
    write(b.stateEl, (s: any) => { deepCount = s.$setAll(DEEP_LEAF, [], 1); });
    expect(deepCount, "データより深いパスの書き").toBe(0);
    b.host.remove();

    const c = await mount(coldTree(), COLD_HTML);
    expect(read(c.stateEl, (s: any) => s.$getAll("nodes.*.nosuch.*.value", [])),
      "存在しないプロパティの読み").toEqual([]);
    let missingCount: number | null = null;
    write(c.stateEl, (s: any) => { missingCount = s.$setAll("nodes.*.nosuch.*.value", [], 1); });
    expect(missingCount, "存在しないプロパティの書き").toBe(0);
    c.host.remove();
  });

  /**
   * 再帰パスが最終的に生成する形そのもの ―― 行 getter が、内側で**添字を省略した**
   * $getAll で直下の子を畳む ―― を cold な state に対して読む。走査の最中に走査を
   * 再入する形なので、ここが壊れていると Phase B は成立しない。
   */
  const withSubtotal = () => {
    const s: any = coldTree();
    Object.defineProperty(s, "nodes.*.subtotal", {
      get(this: any) {
        return this["nodes.*.value"] +
          this.$getAll("nodes.*.children.*.value").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    return s;
  };

  it("cold な state で行 getter（内側は添字省略の $getAll）が行に正しく束縛されること", async () => {
    const raw = withSubtotal();
    const { host, stateEl } = await mount(raw, COLD_HTML);
    expectColdLedger(raw);

    // 行 0 = 1 + (10+11) = 22 / 行 1 = 2 + 20 = 22。
    // もし内側の省略が「全深さ合併」に落ちていたら [42, 43] になる（＝この 2 本の
    // 22 は偶然の一致ではなく、行ごとに別の子集合を畳んだ結果）。
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.subtotal", []))).toEqual([22, 22]);

    // 1 回の読みで全ワイルドカード段の台帳が温まる（内側の省略 $getAll が自分で降りる）
    const rows = getListIndexesByList(raw.nodes)!;
    expect(rows).toHaveLength(2);
    expect(getListIndexesByList(raw.nodes[0].children)).toHaveLength(2);
    expect(getListIndexesByList(raw.nodes[1].children)).toHaveLength(1);
    host.remove();
  });

  it("cold な $setAll の後に行 getter を読んでも、読む順序に関わらず新しい値になること", async () => {
    // 「先に読んで温めてから書く」と「書いてから初めて読む」で結果が変わらないこと＝
    // cold $setAll が行 getter のキャッシュを stale で残さないこと。
    const before = await mount(withSubtotal(), COLD_HTML);
    expect(read(before.stateEl, (s: any) => s.$getAll("nodes.*.subtotal", []))).toEqual([22, 22]);
    let n1: number | null = null;
    write(before.stateEl, (s: any) => { n1 = s.$setAll(COLD_LEAF, [], 5); });
    await flush();
    expect(n1).toBe(3);
    expect(read(before.stateEl, (s: any) => s.$getAll("nodes.*.subtotal", [])), "読んでから書く")
      .toEqual([11, 7]);
    before.host.remove();

    const after = await mount(withSubtotal(), COLD_HTML);
    let n2: number | null = null;
    write(after.stateEl, (s: any) => { n2 = s.$setAll(COLD_LEAF, [], 5); });
    await flush();
    expect(n2).toBe(3);
    expect(read(after.stateEl, (s: any) => s.$getAll("nodes.*.subtotal", [])), "書いてから初めて読む")
      .toEqual([11, 7]);
    after.host.remove();
  });
});

// ===========================================================================
// 2. 手動アンロールした再帰集計 × 構造変更（描画あり）
// ===========================================================================

describe("手動アンロールした再帰集計 × 構造変更（3 段の for で描画する）", () => {
  it("初期値として各深さの total とルート集計が木のデータどおりであること", async () => {
    const { host, shadowRoot, stateEl } = await mount(forestState(), TREE_HTML);
    expect(agg(stateEl)).toEqual({ gt: 133, d0: [131, 2], d1: [110, 20], d2: [100] });
    expect(dom(shadowRoot)).toEqual({ gt: "133", t0: ["131", "2"], t1: ["110", "20"], t2: ["100"] });
    host.remove();
  });

  it("深さ 2 の葉の更新が、深さ 1・深さ 0・ルート集計まで伝播すること", async () => {
    const { host, shadowRoot, stateEl } = await mount(forestState(), TREE_HTML);
    write(stateEl, (s: any) => { s.$resolve(DEEP_LEAF, [0, 0, 0], 500); });
    await flush();

    expect(agg(stateEl)).toEqual({ gt: 533, d0: [531, 2], d1: [510, 20], d2: [500] });
    expect(dom(shadowRoot)).toEqual({ gt: "533", t0: ["531", "2"], t1: ["510", "20"], t2: ["500"] });
    host.remove();
  });

  it("空の children へ新しい配列を代入すると、親と祖先の集計に反映されること", async () => {
    const { host, stateEl } = await mount(
      defineTotals({ nodes: [node(1), node(2)] }, 2), TREE_HTML);
    expect(agg(stateEl).d0).toEqual([1, 2]);

    write(stateEl, (s: any) => {
      const cur = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [...cur, node(10)]);
    });
    await flush();

    expect(agg(stateEl).d0).toEqual([11, 2]);
    host.remove();
  });

  it("中間ノードの子を削除すると集計が縮むこと", async () => {
    const { host, shadowRoot, stateEl } = await mount(forestState(), TREE_HTML);
    write(stateEl, (s: any) => {
      const cur = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], cur.slice(1));
    });
    await flush();

    expect(agg(stateEl)).toEqual({ gt: 23, d0: [21, 2], d1: [20], d2: [] });
    expect(dom(shadowRoot)).toEqual({ gt: "23", t0: ["21", "2"], t1: ["20"], t2: [] });
    host.remove();
  });

  it("兄弟の順序変更（ルートリストの並べ替え）で、集計が行に付いて動くこと", async () => {
    const { host, shadowRoot, stateEl } = await mount(forestState(), TREE_HTML);
    write(stateEl, (s: any) => { s.nodes = [...s.nodes].reverse(); });
    await flush();

    expect(agg(stateEl)).toEqual({ gt: 133, d0: [2, 131], d1: [110, 20], d2: [100] });
    expect(dom(shadowRoot).t0).toEqual(["2", "131"]);
    host.remove();
  });

  it("内容が同一のコピーを再代入しても値が動かないこと", async () => {
    const { host, shadowRoot, stateEl } = await mount(forestState(), TREE_HTML);
    write(stateEl, (s: any) => { s.nodes = [...s.nodes]; });
    await flush();

    expect(agg(stateEl).d0).toEqual([131, 2]);
    expect(dom(shadowRoot).gt).toBe("133");
    host.remove();
  });

  it("deep clone で作り直した木でも、深い葉の変更が全段に追従すること", async () => {
    const { host, shadowRoot, stateEl } = await mount(forestState(), TREE_HTML);
    write(stateEl, (s: any) => {
      const clone = JSON.parse(JSON.stringify(s.nodes));
      clone[0].children[0].children[0].value = 500;
      s.nodes = clone;
    });
    await flush();

    expect(dom(shadowRoot)).toEqual({ gt: "533", t0: ["531", "2"], t1: ["510", "20"], t2: ["500"] });
    host.remove();
  });

  it("中間 children 配列の再代入が、親とルート集計まで伝播すること", async () => {
    const { host, shadowRoot, stateEl } = await mount(forestState(), TREE_HTML);
    write(stateEl, (s: any) => { s["nodes.0.children"] = [node(33)]; });
    await flush();

    expect(agg(stateEl)).toEqual({ gt: 36, d0: [34, 2], d1: [33], d2: [] });
    expect(dom(shadowRoot).t0).toEqual(["34", "2"]);
    host.remove();
  });

  it("同一バッチの「深い葉の per-path 書き込み + 親リストへの追加」が両方とも反映されること", async () => {
    const { host, shadowRoot, stateEl } = await mount(forestState(), TREE_HTML);
    write(stateEl, (s: any) => {
      s["nodes.0.children.0.children.0.value"] = 500;
      s.nodes = [...s.nodes, node(7)];
    });
    await flush();

    expect(dom(shadowRoot)).toEqual({
      gt: "540", t0: ["531", "2", "7"], t1: ["510", "20"], t2: ["500"],
    });
    host.remove();
  });
});

// ===========================================================================
// 3. `for` は 1 本でよい / ネストしたリストは `for` 無しでも追従する
// ===========================================================================

describe("集計に必要な for の本数", () => {
  it("ルートリストに for が 1 本あれば、中央行の削除と子の書き込みが集計に反映されること", async () => {
    const { host, stateEl } = await mount(threeRootsState(), ROOT_FOR_HTML);
    expect(agg(stateEl).d0).toEqual([11, 22, 44]);

    write(stateEl, (s: any) => { const a = s.nodes; s.nodes = [a[0], a[2]]; });
    await flush();
    expect(agg(stateEl).d0).toEqual([11, 44]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [1, 0], 444); });
    await flush();
    expect(agg(stateEl).d0).toEqual([11, 448]);
    host.remove();
  });

  it("for: nodes だけを置いて children を描画しなくても、深さ 3 の木の構造変更が全段の集計に追従すること", async () => {
    // この 1 本の `for` は、かつては載っていた（飾りではなかった）。同じ 3 ケースを
    // for ゼロで走らせると、行の移動は `ListIndex not found at index 0 of nodes.*.children`
    // で恒久 throw し（E1 で修理）、深い葉の更新は cold な $resolve が
    // `ListIndexes not found: nodes` で落ちた（#324 で修理）。いまは for ゼロでも同じ値に
    // なる（＝ known-defects 側の「同じ 3 ケースは for を外しても…」が裏を固定する）。
    const cases: [string, (s: any) => void, any][] = [
      ["深い葉の更新", (s) => { s.$resolve(DEEP_LEAF, [0, 0, 0], 500); },
        { gt: 533, d0: [531, 2], d1: [510, 20], d2: [500] }],
      ["行の移動", (s) => { s.nodes = [...s.nodes].reverse(); },
        { gt: 133, d0: [2, 131], d1: [110, 20], d2: [100] }],
      ["中間 children の差し替え", (s) => { s["nodes.0.children"] = [node(33)]; },
        { gt: 36, d0: [34, 2], d1: [33], d2: [] }],
    ];
    for (const [label, mutate, expected] of cases) {
      const { host, stateEl } = await mount(forestState(), ROOT_FOR_HTML);
      write(stateEl, mutate);
      await flush();
      expect(agg(stateEl), label).toEqual(expected);
      host.remove();
    }
  });

  it("描画が一切無くても、ネストしたリスト（nodes.*.children）の削除・並べ替えが集計に追従すること", async () => {
    // 描画なしで壊れるのはルートリストだけ、という切り分けの正本。
    // 各構造変更のあいだに集計を読む（走査 API が台帳を作り直す）。
    const state = defineTotals({
      nodes: [node(1, [node(10, [node(100)]), node(20, [node(200)]), node(40, [node(400)])])],
    }, 3);
    const { host, stateEl } = await mount(state, NO_FOR_HTML);
    expect(agg(stateEl).d0).toEqual([771]);

    write(stateEl, (s: any) => {
      const a = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [a[0], a[2]]);   // 中央を削除
    });
    await flush();
    expect(agg(stateEl).d0, "中央削除").toEqual([551]);

    write(stateEl, (s: any) => {
      const a = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [a[1], a[0]]);   // 並べ替え
    });
    await flush();
    expect(agg(stateEl).d1, "並べ替え").toEqual([440, 110]);

    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children.*.value", [0, 1, 0], 9000);
    });
    await flush();
    expect(agg(stateEl).d0, "並べ替え後の孫への書き込み").toEqual([9451]);
    host.remove();
  });
});

// ===========================================================================
// 4. 遅延実体化（defineTreeAccessor）の成立条件
// ===========================================================================

/** 深さ 2 の一本鎖: value 1 -> 2 -> 3（total は 6 / 5 / 3） */
const chainTree = () => ({
  title: "lazy",
  nodes: [{ value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }] }],
});
const LAZY_HTML = `<span data-wcs="textContent: title"></span>`;
const D0 = totalAt(0);
const D1 = totalAt(1);
const D2 = totalAt(2);
const D3 = totalAt(3);

const defineTotalsLazily = (stateEl: State, from: number, to: number) => {
  for (let d = from; d <= to; d++) {
    stateEl.defineTreeAccessor(totalAt(d), totalDescriptor(baseAt(d)));
  }
};
/**
 * listPaths だけを直接足す。`setPathInfo(path, "for")` を流用すると elementPaths も
 * 汚れて setByAddress の swap 判定が変わるので、集計だけが要るときはこちらを使う。
 */
const registerListPaths = (stateEl: State, paths: string[]) => {
  for (const p of paths) stateEl.listPaths.add(p);
};
const all = (stateEl: State, path: string) => read(stateEl, (s: any) => s.$getAll(path, []));

describe("遅延実体化（defineTreeAccessor）の成立条件", () => {
  it("バインド確立後に生やした集計 getter が、そのパスを読む前なら即座に正しい値を返すこと", async () => {
    const { host, stateEl } = await mount(chainTree(), LAZY_HTML);
    expect([...stateEl.getterPaths]).toEqual([]);

    defineTotalsLazily(stateEl, 0, 2);

    expect([...stateEl.getterPaths]).toEqual([D0, D1, D2]);
    // defineTreeAccessor が触るのは getterPaths と "prop" の PathInfo だけ
    expect([...stateEl.listPaths]).toEqual([]);
    expect([...stateEl.elementPaths]).toEqual([]);

    expect(all(stateEl, D0)).toEqual([6]);
    expect(all(stateEl, D1)).toEqual([5]);
    expect(all(stateEl, D2)).toEqual([3]);
    host.remove();
  });

  it("遅延登録した getter の動的依存エッジは、定義時ではなく最初の評価で張られること", async () => {
    const { host, stateEl } = await mount(chainTree(), LAZY_HTML);
    defineTotalsLazily(stateEl, 0, 2);
    expect(stateEl.dynamicDependency.size, "定義しただけでは 0 本").toBe(0);

    expect(all(stateEl, D0)).toEqual([6]);

    expect(stateEl.dynamicDependency.get("nodes.*.value")).toEqual([D0]);
    expect(stateEl.dynamicDependency.get(D1)).toEqual([D0]);
    expect(stateEl.dynamicDependency.get(D2)).toEqual([D1]);
    // setPathInfo("prop") 由来の静的連鎖も同時に張られている
    expect(stateEl.staticDependency.get("nodes")).toEqual(["nodes.*"]);
    host.remove();
  });

  it("遅延登録した getter が、その後の葉の更新で dirty 化されて再評価されること", async () => {
    const { host, stateEl } = await mount(chainTree(), LAZY_HTML);
    defineTotalsLazily(stateEl, 0, 2);
    expect(all(stateEl, D0)).toEqual([6]);

    write(stateEl, (s: any) => { s.$resolve(DEEP_LEAF, [0, 0, 0], 30); });
    await flush();

    expect(all(stateEl, D0)).toEqual([33]);
    expect(all(stateEl, D1)).toEqual([32]);
    expect(all(stateEl, D2)).toEqual([30]);
    host.remove();
  });

  it("getterPaths に載っていない getter は this が生 state になり、$getAll が無くて TypeError になること", async () => {
    // getByAddress が receiver 付きの Reflect.get を使うのは getterPaths に載って
    // いるパスだけ。遅延実体化を素の defineProperty でやってはいけない理由。
    const initial = chainTree();
    const { host, stateEl } = await mount(initial, LAZY_HTML);
    const raw = (stateEl as any)._state;
    expect(raw).toBe(initial);
    for (let d = 0; d <= 2; d++) {
      Object.defineProperty(raw, totalAt(d), totalDescriptor(baseAt(d)));
    }
    expect([...stateEl.getterPaths]).toEqual([]);

    expect(() => all(stateEl, D0)).toThrow(/\$getAll is not a function/);
    host.remove();
  });

  it("defineTreeAccessor + listPaths 登録なら、葉更新・子追加・中間差し替え・ルート置換のすべてが成立すること", async () => {
    // defineTreeAccessor が張る静的連鎖（nodes → nodes.*）は listPaths とセットで
    // ないと walk がリスト置換で落ちる。成立する側の組み合わせを固定する。
    const { host, stateEl } = await mount(chainTree(), LAZY_HTML);
    defineTotalsLazily(stateEl, 0, 2);
    registerListPaths(stateEl, ["nodes", "nodes.*.children", "nodes.*.children.*.children"]);
    expect([...stateEl.elementPaths], "elementPaths は不要").toEqual([]);
    expect(all(stateEl, D0)).toEqual([6]);

    write(stateEl, (s: any) => { s.$resolve(DEEP_LEAF, [0, 0, 0], 30); });
    await flush();
    expect(all(stateEl, D0), "葉の更新").toEqual([33]);

    write(stateEl, (s: any) => {
      const cur = s.$resolve("nodes.*.children.*.children", [0, 0]);
      s.$resolve("nodes.*.children.*.children", [0, 0], [...cur, node(10)]);
    });
    await flush();
    expect(all(stateEl, D0), "子の追加").toEqual([43]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children", [0], [node(5)]); });
    await flush();
    expect(all(stateEl, D0), "中間 children の差し替え").toEqual([6]);

    write(stateEl, (s: any) => { s.nodes = [node(7, [node(8)])]; });
    await flush();
    expect(all(stateEl, D0), "ルートリストの置換").toEqual([15]);
    expect(all(stateEl, D1)).toEqual([8]);
    host.remove();
  });

  it("定義がそのパスの最初の読みより先であれば、木が深くなっても集計が正しいこと", async () => {
    const { host, stateEl } = await mount(chainTree(), LAZY_HTML);
    defineTotalsLazily(stateEl, 0, 2);
    registerListPaths(stateEl,
      ["nodes", "nodes.*.children", "nodes.*.children.*.children",
        "nodes.*.children.*.children.*.children"]);
    expect(all(stateEl, D0)).toEqual([6]);

    // 深さ 3 を読むより前に生やしてから、データを深さ 3 へ伸ばす
    defineTotalsLazily(stateEl, 3, 3);
    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children.*.children", [0, 0, 0], [node(100)]);
    });
    await flush();

    expect(all(stateEl, D0)).toEqual([106]);
    expect(all(stateEl, D2)).toEqual([103]);
    expect(all(stateEl, D3)).toEqual([100]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// 「読みの直前に 1 段先を実体化する」形（E-grow）
// ---------------------------------------------------------------------------

/**
 * 各深さの集計 getter が、子を読む直前に 1 段深い getter を実体化する。
 * 登録は connectedCallback の後（state セッタが listPaths を clear するため）で、
 * 最初の読み（grandTotal のバインド確立）より前に済ませる。
 */
async function mountSelfExpanding(nodes: TNode[]) {
  const holder: { el: State | null } = { el: null };

  function descriptorFor(d: number): PropertyDescriptor {
    const base = baseAt(d);
    return {
      get(this: any) {
        ensure(d + 1);   // 子を読む前に 1 段先を生やす
        const childTotals: number[] = this.$getAll(base + ".children.*.total");
        return this[base + ".value"] + childTotals.reduce((a, b) => a + b, 0);
      },
      enumerable: true,
      configurable: true,
    };
  }
  function ensure(d: number): void {
    const el = holder.el;
    if (el === null || d > 6 || el.getterPaths.has(totalAt(d))) return;
    el.setPathInfo(listAt(d), "for", "internal");
    el.defineTreeAccessor(totalAt(d), descriptorFor(d));
  }

  const state: any = {
    nodes,
    get grandTotal(this: any) {
      return this.$getAll("nodes.*.total", []).reduce((a: number, b: number) => a + b, 0);
    },
  };
  Object.defineProperty(state, totalAt(0), descriptorFor(0));

  const host = document.createElement(`recursion-prereq-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML =
    `<span id="gt" data-wcs="textContent: grandTotal"></span><wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  holder.el = stateEl;
  stateEl.setInitialState(state);
  await stateEl.connectedCallbackPromise;
  stateEl.setPathInfo(listAt(0), "for", "internal");
  stateEl.setPathInfo(totalAt(0), "prop", "internal");
  await State.getBindingsReady(shadowRoot);
  return { host, stateEl, gt: () => shadowRoot.querySelector("#gt")!.textContent };
}

describe("読みの直前に 1 段先を実体化する遅延展開", () => {
  it("木が 1 段ずつ深くなっても、そのつど正しい集計になること", async () => {
    const { host, gt, stateEl } = await mountSelfExpanding([node(1)]);
    expect(gt(), "初期").toBe("1");
    // 実体化は本当に遅延している: データが 1 段しか無い時点で存在するのは
    // 「評価された深さ + 1」までで、その先はまだ生えていない。
    expect(stateEl.getterPaths.has(totalAt(1)), "初期 d1").toBe(true);
    expect(stateEl.getterPaths.has(totalAt(2)), "初期 d2").toBe(false);

    for (const [d, expected] of [[0, "11"], [1, "111"], [2, "1111"], [3, "11111"]] as const) {
      const path = baseAt(d) + ".children";
      const value = 10 ** (d + 1);
      write(stateEl, (s: any) => { s.$resolve(path, new Array(d + 1).fill(0), [node(value)]); });
      await flush();
      expect(gt(), `深さ ${d + 1}`).toBe(expected);
      expect(stateEl.getterPaths.has(totalAt(d + 2)), `深さ ${d + 1} で 1 段先が生えている`).toBe(true);
    }
    host.remove();
  });

  it("縮小・ルートリストの差し替え・同一バッチの複数深さの書き込みが正しく畳まれること", async () => {
    const { host, gt, stateEl } = await mountSelfExpanding([node(1)]);
    for (const d of [0, 1, 2, 3]) {
      write(stateEl, (s: any) => {
        s.$resolve(baseAt(d) + ".children", new Array(d + 1).fill(0), [node(10 ** (d + 1))]);
      });
      await flush();
    }
    expect(gt()).toBe("11111");

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children", [0], []); });
    await flush();
    expect(gt(), "縮小").toBe("1");

    write(stateEl, (s: any) => { s.nodes = [node(2, [node(20, [node(200)])])]; });
    await flush();
    expect(gt(), "ルートリストの差し替え").toBe("222");

    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.value", [0], 3);
      s.$resolve("nodes.*.children.*.children.*.value", [0, 0, 0], 300);
      s.$resolve("nodes.*.children.*.children.*.children", [0, 0, 0], [node(4000)]);
    });
    await flush();
    expect(gt(), "同一バッチ複数深さ").toBe(String(3 + 20 + 300 + 4000));
    host.remove();
  });
});

// ===========================================================================
// 5. 深さの実効上限（F-limits）
// ===========================================================================

/** 深さ depth の一本鎖（各 value = 1、最深の children は []） */
function deepChain(depth: number): TNode[] {
  let n: TNode = { value: 1, children: [] };
  for (let d = depth - 1; d >= 1; d--) n = { value: 1, children: [n] };
  return [n];
}

/** 深さ depth ぶんの集計 getter を初期 state 上に手で展開する（1 段 1 getter） */
function unrolledAggregate(depth: number): any {
  const state: any = { nodes: deepChain(depth) };
  for (let d = 0; d < depth; d++) {
    Object.defineProperty(state, totalAt(d), totalDescriptor(baseAt(d)));
  }
  return state;
}

describe("深さの実効上限", () => {
  it("ワイルドカード段数そのものにはエンジン側の上限が無いこと（129 段の PathInfo が受理される）", () => {
    // MAX_WILDCARD_DEPTH（128）は PathInfo からは参照されない。
    const info = getPathInfo("deep." + Array(129).fill("*").join("."));
    expect(info.wildcardCount).toBe(129);
    expect(info.segments.length).toBe(130);
  });

  it("cold な top-down 集計はちょうど深さ 128 まで評価できること", { timeout: 120000 }, async () => {
    const { host, stateEl } = await mount(unrolledAggregate(128), "");
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([128]);
    host.remove();
  });

  it("cold な top-down 集計は深さ 129 で address stack 超過になること", { timeout: 120000 }, async () => {
    // 実効上限は「同時に積まれた getter フレーム数」であって木の深さではない
    // （1 段あたり 2 本の getter を挟めば天井は 64 に半減する）。
    const { host, stateEl } = await mount(unrolledAggregate(129), "");
    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.*.total", [])))
      .toThrow(/Exceeded maximum address stack depth of 128/);
    host.remove();
  });

  it("上限はパス形状ではなく同時に積まれた getter フレーム数であること（ワイルドカード無しの鎖でも 128 / 129）", { timeout: 120000 }, async () => {
    // 上の 2 本のコメントが主張している「実効上限は同時に積まれた getter フレーム数」を
    // 実際に測る。ワイルドカードもリストも一切含まない素の getter 連鎖が、木と
    // まったく同じ 128 / 129 の境界で落ちる＝上限は再帰パスの形とは無関係。
    const chainState = (n: number) => {
      const s: any = {};
      for (let i = 0; i < n; i++) {
        const next = i === n - 1 ? null : `g${i + 1}`;
        Object.defineProperty(s, `g${i}`, {
          get(this: any) { return next === null ? 1 : this[next]; },
          enumerable: true, configurable: true,
        });
      }
      return s;
    };

    const ok = await mount(chainState(128), "");
    expect(read(ok.stateEl, (s: any) => s.g0), "128 段").toBe(1);
    ok.host.remove();

    const ng = await mount(chainState(129), "");
    expect(() => read(ng.stateEl, (s: any) => s.g0), "129 段")
      .toThrow(/Exceeded maximum address stack depth of 128/);
    ng.host.remove();
  });
});

// ===========================================================================
// 6. 集計 getter 内の $getAll の書き分け
// ===========================================================================

describe("集計 getter 内の $getAll の書き分け", () => {
  it("添字省略は直下の子だけを畳み、[] 明示は全深さ合併になること", async () => {
    // このファイルと known-defects 側の集計 getter はすべて「省略」で書かれている。
    // その前提そのものを固定する 1 本。ここが変わると両ファイルの期待値が総崩れに
    // なるので、値が動いた理由をこのテストで先に特定できるようにしておく。
    const state: any = { nodes: [node(1, [node(10)]), node(2, [node(20)])] };
    Object.defineProperty(state, "nodes.*.children.*.total", {
      get(this: any) { return this["nodes.*.children.*.value"]; },
      enumerable: true, configurable: true,
    });
    Object.defineProperty(state, "nodes.*.totalScoped", {
      get(this: any) {
        return this["nodes.*.value"] +
          this.$getAll("nodes.*.children.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    Object.defineProperty(state, "nodes.*.totalAll", {
      get(this: any) {
        return this["nodes.*.value"] +
          this.$getAll("nodes.*.children.*.total", []).reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });

    const { host, stateEl } = await mount(state, NO_FOR_HTML);
    expect(all(stateEl, "nodes.*.totalScoped"), "省略＝直下の子だけ").toEqual([11, 22]);
    // [] は「全深さ合併」なので、どの行から読んでも子 total の全件（10+20）が乗る
    expect(all(stateEl, "nodes.*.totalAll"), "[] 明示＝全件合併").toEqual([31, 32]);
    host.remove();
  });
});
