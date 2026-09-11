/**
 * integration.recursionGetter.test.ts — Phase B（宣言・パス展開・生成 getter）の
 * 実挙動を固定する統合テスト（docs/state-recursive-path-impl-plan.md §4）。
 *
 * Phase B が入れたのは次の 3 つで、このファイルはそれぞれの成立と境界を測る。
 *
 *  1. `$recursion = { "nodes.*": "children.*" }` 宣言と、`get "nodes.**.total"()`
 *     という形の再帰 getter。`**` は**オーサリング層だけの記号**で、`PathInfo` には
 *     決して降りない（降ろすと wildcardCount が不定になり ListIndex 連鎖長・
 *     `$1..$n`・`$resolve` の厳密一致が同時に壊れる。設計書 D2）。
 *  2. 具体パス（`nodes.*.children.*.total`）を読む直前に、その深さの getter を
 *     `defineTreeAccessor` で**遅延実体化**する。遅延であることは実装の不変条件で、
 *     先に生やしてしまうと Phase A の A6/A7（未定義のまま一度読まれた
 *     ワイルドカードパスが `dirty:false` の `undefined` で固定される）に落ちる。
 *  3. getter 本体の `this["nodes.**.value"]` と添字省略の
 *     `$getAll("nodes.**.children.*.total")` を、**いま評価している深さ**に束縛する。
 *
 * Phase C（`$getAll(path, [])` の全深さ合併）と Phase D（再帰 `$setAll`）は
 * まだ無い。ここではその 2 つが**診断で拒否される**ことまでを固定する。
 *
 * 反証レビューで直った契約（このファイルが固定している側）は 5 つ。
 *  - バインド確立時の存在検査は、宣言済み `**` getter の展開形を**偽の
 *    `[wcs/binding-path-missing]` にしない**（実体化はしない）。
 *  - 作者が生成先の具体パスを手で定義していたら、読みの経路でも衝突として拒否する。
 *  - 展開先が重なる 2 本の `**` getter は、レジストリ構築時に静的に拒否する。
 *  - 接尾辞が空の `**` getter（`get "nodes.**"`）も構築時に拒否する。
 *  - アンカー不一致は `[wcs/recursion-anchor]`（深さ解決より先に照合する）。
 * 反転させた it には `// Fixed by Phase B review — was: …` を残してある。
 * 【現状の記録】は残っていない（接尾辞が `.*` の `**` getter も、接頭辞と接尾辞の重なりガードで解決済み）。
 * 空接尾辞と違って構築時のガードに掛からず、いまもアンカー行を隠す。
 *
 * 壊れた宣言を**初回マウント**で渡すと、`_state` セッターの throw が
 * `_resolveLoading()` まで届かず `connectedCallbackPromise` が永久 pending になる
 * （`$listKeys` と同じ性質）。`await` したテストは 5 秒で timeout するので、
 * **構築時に落ちる契約は再セットの経路（`withReset`）で測る** — こちらは同期的に
 * throw し、作者が実際に受け取る診断をそのまま観測できる。`new RecursionRegistry`
 * を直接組む `buildRegistry` は、定義の並び順に依らないこと・正当な 2 本を巻き添えに
 * しないことという**検査そのものの性質**だけに使う。
 *
 * 期待値は契約から決め、実行して一致を確かめたもの。手で畳んだ算術
 * （`131 = 1 + (10 + 100) + 20`）は、二重計上が起きていないことの独立した検算。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { setLoopContextSymbol } from "../src/proxy/symbols";
import { __private__ as stateHandlerPrivate } from "../src/proxy/StateHandler";
import { processRecursionDeclaration } from "../src/recursion/declaration";
import { currentRecursionDepth } from "../src/recursion/bind";
import { RecursionRegistry } from "../src/recursion/registry";
import type { IState } from "../src/types";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`recursion-getter-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  return { host, shadowRoot, stateEl };
}

function read<T>(stateEl: State, fn: (s: any) => T): T {
  let out: any;
  stateEl.createState("readonly", (s: any) => { out = fn(s); });
  return out as T;
}

function write(stateEl: State, fn: (s: any) => void): void {
  stateEl.createState("writable", fn);
}

// ---------------------------------------------------------------------------
// 木と再帰 state
// ---------------------------------------------------------------------------

type TNode = { value: number; children: TNode[] };
const node = (value: number, children: TNode[] = []): TNode => ({ value, children });

/**
 * 深さ 3 の木。
 *   nodes[0] = 1 ─┬─ 10 ── 100
 *                 └─ 20
 *   nodes[1] = 2
 * 手で畳んだ total: 100 / 110 / 20 / 131 / 2、全 value の合計 = 133。
 */
const forest = (): TNode[] => [node(1, [node(10, [node(100)]), node(20)]), node(2)];

/**
 * 標準の再帰 state。`get "nodes.**.total"()` は
 *   自分の value（`**` は自分の深さに束縛される）
 *   ＋ 直下の子の total（添字省略の `$getAll` ＝ 文脈の接頭辞に整合する分だけ）
 * を返す。`extra` で「作者が手で書いた具体パス getter」等を足せる。
 */
function recursionState(
  nodes: TNode[],
  extra: Record<string, PropertyDescriptor> = {},
  recursion: unknown = { "nodes.*": "children.*" },
): any {
  const state: any = { nodes };
  if (typeof recursion !== "undefined") {
    state.$recursion = recursion;
  }
  // オブジェクトリテラルの getter として書くと、この関数の外で spread された時に
  // 本体が評価されてしまう。descriptor で足して事故を防ぐ。
  Object.defineProperty(state, "nodes.**.total", {
    get(this: any) {
      return this["nodes.**.value"] +
        this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
    },
    enumerable: true,
    configurable: true,
  });
  for (const [key, descriptor] of Object.entries(extra)) {
    Object.defineProperty(state, key, descriptor);
  }
  return state;
}

/**
 * 一度正しくマウントしてから壊れた state を再セットする。**レジストリ構築時に落ちる
 * 契約はこの形で測る** — 再セットの `_state` セッターは同期的に throw するので、
 * 作者が実際に受け取る診断をそのまま観測できる。
 *
 * 初回マウントで壊れた宣言を渡すと、セッターの throw が `_resolveLoading()` まで
 * 届かず `connectedCallbackPromise` が永久 pending になる（`$listKeys` と同じ性質）
 * ため、`await` したテストは 5 秒で timeout する。だから「壊れた宣言」は必ず
 * 再セットの経路で測る。
 */
async function withReset(broken: any): Promise<{ host: HTMLElement; run: () => void }> {
  const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
  return { host, run: () => stateEl.setInitialState(broken) };
}

/**
 * mount も `State` も経ずにレジストリだけを組む。**構築時の検査そのもの**（定義の
 * 並び順に依らないこと・正当な 2 本を巻き添えにしないこと）を測るための単体形で、
 * 作者に診断が届くかは `withReset` の側で測る。
 * キーの並びは descriptor の定義順で、診断が名指しする順序もそれに従う。
 */
function buildRegistry(
  recursion: Record<string, string>,
  keys: Record<string, () => unknown>,
): RecursionRegistry {
  const spec = processRecursionDeclaration({ $recursion: recursion } as unknown as IState)!;
  const state: Record<string, unknown> = {};
  for (const [key, get] of Object.entries(keys)) {
    Object.defineProperty(state, key, { get, enumerable: true, configurable: true });
  }
  return new RecursionRegistry(spec, state);
}

/** 実体化済みの具体パス（＝遅延実体化の観測窓） */
const materialized = (stateEl: State): string[] =>
  Array.from(((stateEl as any).recursionRegistry?.materializedPaths ?? []) as Set<string>).sort();

/** 再帰 getter に関係する getterPaths だけを取り出す */
const totalGetterPaths = (stateEl: State): string[] =>
  Array.from((stateEl as any).getterPaths as Set<string>).filter((p) => p.endsWith(".total")).sort();

const listPathsOf = (stateEl: State): string[] =>
  Array.from((stateEl as any).listPaths as Set<string>).sort();

/** 深さ d の total パス */
const totalAt = (d: number) => "nodes.*" + ".children.*".repeat(d) + ".total";
/** 深さ d の value パス */
const valueAt = (d: number) => "nodes.*" + ".children.*".repeat(d) + ".value";

/** 各深さの total を一度に読む（浅い順に読むと getter の連鎖で全段が生える） */
const totals = (stateEl: State, maxDepth = 2) =>
  read(stateEl, (s: any) => {
    const out: number[][] = [];
    for (let d = 0; d <= maxDepth; d++) out.push(s.$getAll(totalAt(d), []));
    return out;
  });

/** 3 段の `for` でツリーを描く（各段の total を表示する） */
const TREE_HTML =
  `<div><template data-wcs="for: nodes">` +
  `<div><span class="t0">{{ .total }}</span>` +
  `<template data-wcs="for: nodes.*.children">` +
  `<div><span class="t1">{{ .total }}</span>` +
  `<template data-wcs="for: nodes.*.children.*.children">` +
  `<div><span class="t2">{{ .total }}</span></div>` +
  `</template></div></template></div></template></div>`;

/** `for` も data-wcs も持たない（描画ゼロ） */
const NO_RENDER_HTML = `<div></div>`;

const texts = (sr: ShadowRoot, sel: string) =>
  Array.from(sr.querySelectorAll(sel)).map((e) => e.textContent!.trim());
const treeDom = (sr: ShadowRoot) => ({
  t0: texts(sr, ".t0"),
  t1: texts(sr, ".t1"),
  t2: texts(sr, ".t2"),
});

// ===========================================================================
// 1. 各深さの集計
// ===========================================================================

describe("再帰 getter: 深さごとの集計", () => {
  it("深さ 3 の木で、各深さの total が手で畳んだ値と一致すること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    // 深いほうから読む（浅いほうから読むと getter が連鎖して全段を評価してしまう）
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(2), [])), "深さ 2").toEqual([100]);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(1), [])), "深さ 1").toEqual([110, 20]);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), [])), "深さ 0").toEqual([131, 2]);
    host.remove();
  });

  it("孫を二重計上しないこと（全 value の合計 = ルート total の合計）", async () => {
    // 添字省略の `$getAll` が `[]` 明示（全深さ合流）に化けていたら、
    // ルートの合計は 133 を超える。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    const allValues = read(stateEl, (s: any) =>
      [0, 1, 2].flatMap((d) => s.$getAll(valueAt(d), [])) as number[]);
    expect(allValues.reduce((a, b) => a + b, 0), "全 value の合計").toBe(133);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []) as number[])
      .reduce((a, b) => a + b, 0), "ルート total の合計").toBe(133);
    host.remove();
  });

  it("三段の鎖 1 → 2 → 3 で total が 6 / 5 / 3 になること", async () => {
    const { host, stateEl } = await mount(
      recursionState([node(1, [node(2, [node(3)])])]), NO_RENDER_HTML);

    expect(totals(stateEl)).toEqual([[6], [5], [3]]);
    host.remove();
  });

  it("兄弟・別ルートの文脈が混ざらないこと", async () => {
    // 3 ルート × 子 1 個。文脈が混ざると 11/22/44 が崩れる。
    const { host, stateEl } = await mount(recursionState([
      node(1, [node(10)]), node(2, [node(20)]), node(4, [node(40)]),
    ]), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(1), [])), "深さ 1").toEqual([10, 20, 40]);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), [])), "深さ 0").toEqual([11, 22, 44]);
    host.remove();
  });

  it("`**` が自分の深さの value を読むこと（別の再帰 getter を経由しても同じ）", async () => {
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.**.doubled": {
        get(this: any) { return this["nodes.**.total"] * 2; },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.children.*.doubled", []))).toEqual([220, 40]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.doubled", []))).toEqual([262, 4]);
    host.remove();
  });

  it("通常の行 getter（具体パス）の文脈からも `**` が自分の深さに束縛されること", async () => {
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.*.label": {
        get(this: any) { return "R" + this["nodes.**.value"]; },
        enumerable: true, configurable: true,
      },
      "nodes.*.children.*.label": {
        get(this: any) { return "C" + this["nodes.**.value"]; },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.children.*.label", []))).toEqual(["C10", "C20"]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.label", []))).toEqual(["R1", "R2"]);
    host.remove();
  });

  it("writable な createState の中で読んでも同じ値になること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    let out: any;
    write(stateEl, (s: any) => { out = s.$getAll(totalAt(0), []); });
    expect(out).toEqual([131, 2]);
    host.remove();
  });
});

// ===========================================================================
// 2. 遅延実体化
// ===========================================================================

describe("再帰 getter: 遅延実体化であること", () => {
  it("mount 直後は `**` のキーだけで、具体パスは 1 本も生えていないこと", async () => {
    // ここが「最初から全部生えている」構成に退化すると、Phase A の A7
    // （未定義のワイルドカードパスを一度読むと undefined が dirty:false で固定される）
    // を踏みにいく実装に戻ったことになる。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(totalGetterPaths(stateEl)).toEqual(["nodes.**.total"]);
    expect(materialized(stateEl)).toEqual([]);
    // Fixed by Phase E — was: [] （何も読むまで 1 本も登録されなかった）。アンカーの
    // リストパスは宣言から静的に分かるので、宣言の時点で登録する。深い段は遅延のまま。
    expect(listPathsOf(stateEl), "アンカーのリストパスだけが宣言時に登録される").toEqual(["nodes"]);
    host.remove();
  });

  it("読んだ深さのぶんだけ具体パスが増えること（深い順に 1 本ずつ）", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    read(stateEl, (s: any) => s.$getAll(totalAt(2), []));
    expect(materialized(stateEl), "深さ 2 を読んだ後").toEqual([totalAt(2)]);

    read(stateEl, (s: any) => s.$getAll(totalAt(1), []));
    expect(materialized(stateEl), "深さ 1 を読んだ後").toEqual([totalAt(2), totalAt(1)].sort());

    read(stateEl, (s: any) => s.$getAll(totalAt(0), []));
    expect(materialized(stateEl), "深さ 0 を読んだ後")
      .toEqual([totalAt(0), totalAt(1), totalAt(2)].sort());

    // 生成物は getterPaths にも載る（載らないと getter の `this` が生 state になる）
    expect(totalGetterPaths(stateEl))
      .toEqual(["nodes.**.total", totalAt(0), totalAt(1), totalAt(2)].sort());
    host.remove();
  });

  it("同じ深さを何度読んでも生成物が重複せず、アクセサの再定義も起きないこと", async () => {
    // `materializedPaths` は Set なので、台帳の要素数だけを見ても「重複しない」は
    // 構造上ほぼ自明になる。実際に守りたいのは `defineTreeAccessor` を二度呼ばない
    // ことなので、呼び出し回数そのものを数える。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    const spy = vi.spyOn(stateEl, "defineTreeAccessor");

    for (let i = 0; i < 5; i++) {
      expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([131, 2]);
    }
    expect(materialized(stateEl)).toEqual([totalAt(0), totalAt(1), totalAt(2)].sort());
    expect(spy.mock.calls.map((args) => args[0]).sort(), "深さごとに 1 回だけ")
      .toEqual([totalAt(0), totalAt(1), totalAt(2)].sort());
    spy.mockRestore();
    host.remove();
  });

  it("浅い深さを先に読むと、getter の連鎖で必要な深さがまとめて生えること", async () => {
    // 「遅延 = 1 段ずつしか生えない」ではない。要るときに要るだけ生える。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([131, 2]);
    expect(materialized(stateEl)).toEqual([totalAt(0), totalAt(1), totalAt(2)].sort());
    host.remove();
  });

  it("実体化した深さのぶんだけ listPaths が載ること（依存ウォークの経路）", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    read(stateEl, (s: any) => s.$getAll(totalAt(0), []));
    expect(listPathsOf(stateEl))
      .toEqual(["nodes", "nodes.*.children", "nodes.*.children.*.children"]);
    host.remove();
  });

  it("木より深いパスを読んでも空配列で、実体化も起きないこと", async () => {
    // 走査が届かないので getByAddress まで来ない。生成物を無駄に増やさない。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(3), []))).toEqual([]);
    expect(materialized(stateEl)).toEqual([]);
    // その後の通常の読みは影響を受けない
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([131, 2]);
    host.remove();
  });
});

// ===========================================================================
// 3. 書き込みの伝播
// ===========================================================================

describe("再帰 getter: 書き込みが全段に伝播する", () => {
  it("深い葉への $setAll が全段の集計に反映されること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    expect(totals(stateEl)).toEqual([[131, 2], [110, 20], [100]]);

    write(stateEl, (s: any) => { s.$setAll(valueAt(2), [], 500); });
    await flush();

    expect(totals(stateEl)).toEqual([[531, 2], [510, 20], [500]]);
    host.remove();
  });

  it("$resolve による単点書き込みも全段に伝播すること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    expect(totals(stateEl)).toEqual([[131, 2], [110, 20], [100]]);

    write(stateEl, (s: any) => { s.$resolve(valueAt(2), [0, 0, 0], 700); });
    await flush();

    expect(totals(stateEl)).toEqual([[731, 2], [710, 20], [700]]);
    host.remove();
  });

  it("描画ゼロでもルートリストの並べ替えに追従すること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([131, 2]);

    write(stateEl, (s: any) => { s.nodes = [s.nodes[1], s.nodes[0]]; });
    await flush();

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([2, 131]);
    host.remove();
  });
});

// ===========================================================================
// 4. 木の形が後から変わる
// ===========================================================================

describe("再帰 getter: 木の形が変わる", () => {
  it("初回評価より深くなったとき、次の読みで新しい深さが実体化されること（R4）", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([131, 2]);
    expect(materialized(stateEl)).toEqual([totalAt(0), totalAt(1), totalAt(2)].sort());

    // 深さ 3 の子を後から足す
    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.children.*.children", [0, 0, 0], [node(1000)]); });
    await flush();

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), [])), "集計").toEqual([1131, 2]);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(3), [])), "新しい深さ").toEqual([1000]);
    expect(materialized(stateEl), "深さ 3 が足されている")
      .toEqual([totalAt(0), totalAt(1), totalAt(2), totalAt(3)].sort());
    host.remove();
  });

  it("$setAll の mapper で子を足しても新しい深さが実体化されること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([131, 2]);

    // mapper で「行ごとに新しい配列」を作る（定数ブロードキャストだと同一配列を共有する）
    write(stateEl, (s: any) => {
      s.$setAll("nodes.*.children.*.children.*.children", [], () => [node(1000)]);
    });
    await flush();

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([1131, 2]);
    expect(materialized(stateEl)).toContain(totalAt(3));
    host.remove();
  });

  it("木が浅くなっても壊れないこと（到達済みの深さは残る）", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    expect(totals(stateEl)).toEqual([[131, 2], [110, 20], [100]]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children", [0], []); });
    await flush();

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), [])), "深さ 0").toEqual([1, 2]);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(1), [])), "深さ 1 は空").toEqual([]);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(2), [])), "深さ 2 も空").toEqual([]);
    // 生成物は消さない（浅くなっただけで、また深くなりうる）
    expect(materialized(stateEl)).toEqual([totalAt(0), totalAt(1), totalAt(2)].sort());

    // 再び深くしたら元どおりに集計できる
    write(stateEl, (s: any) => { s.$resolve("nodes.*.children", [0], [node(3, [node(4)])]); });
    await flush();
    expect(totals(stateEl)).toEqual([[8, 2], [7], [4]]);
    host.remove();
  });
});

// ===========================================================================
// 5. 描画あり（`for`）
// ===========================================================================

describe("再帰 getter: `for` で描画したツリー", () => {
  it("初期描画で各段の total が出ること", async () => {
    const { host, shadowRoot } = await mount(recursionState(forest()), TREE_HTML);

    expect(treeDom(shadowRoot)).toEqual({ t0: ["131", "2"], t1: ["110", "20"], t2: ["100"] });
    host.remove();
  });

  it("葉の更新が全段の表示に反映されること", async () => {
    const { host, shadowRoot, stateEl } = await mount(recursionState(forest()), TREE_HTML);

    write(stateEl, (s: any) => { s.$setAll(valueAt(2), [], 500); });
    await flush();

    expect(treeDom(shadowRoot)).toEqual({ t0: ["531", "2"], t1: ["510", "20"], t2: ["500"] });
    host.remove();
  });

  it("子の追加が行の追加と全段の再集計になること", async () => {
    const { host, shadowRoot, stateEl } = await mount(recursionState(forest()), TREE_HTML);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children", [1], [node(7)]); });
    await flush();
    expect(treeDom(shadowRoot), "子の追加")
      .toEqual({ t0: ["131", "9"], t1: ["110", "20", "7"], t2: ["100"] });

    write(stateEl, (s: any) => { s.$resolve(valueAt(1), [0, 0], 11); });
    await flush();
    expect(treeDom(shadowRoot), "葉の更新")
      .toEqual({ t0: ["132", "9"], t1: ["111", "20", "7"], t2: ["100"] });
    host.remove();
  });

  it("宣言時点では生成 getter が未実体化でも binding-path-missing を出さないこと", async () => {
    // Fixed by Phase B review — was: バインド宣言の検証が走る時点では
    // `nodes.*.total` がまだ state 上に無いので、偽の `[wcs/binding-path-missing]`
    // が「更新が黙って捨てられる」という文面で出ていた（描画も更新も成立しているのに）。
    // `checkDeclaredPath` が `RecursionRegistry.recursiveGetterOwning` で
    // 「宣言済み `**` getter の展開形か」を先に見る（実体化はしない）。
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, shadowRoot } = await mount(recursionState(forest()), TREE_HTML);
      await flush(); // 報告は deferReport 経由で 1 tick 遅れる
      const messages = spy.mock.calls.map((args) => String(args[0]));
      const recursivePaths = [totalAt(0), totalAt(1), totalAt(2)];
      // 他の警告まで禁止しない。再帰の具体パスを名指しした missing が 0 件であること。
      expect(messages.filter((m) => m.includes("[wcs/binding-path-missing]") &&
        recursivePaths.some((path) => m.includes(path)))).toEqual([]);
      expect(treeDom(shadowRoot)).toEqual({ t0: ["131", "2"], t1: ["110", "20"], t2: ["100"] });
      host.remove();

      // 対照: 同じ spy・同じ待ち方で、**同じ再帰 state の** 打ち間違いは捉えられる。
      // これが無いと「そもそも警告が 1 件も届いていないだけ」と区別が付かず、上の
      // assert が空虚になる。同時に、免除がアンカー配下を丸ごと黙らせる形（宣言が
      // あれば何でも通す）に広がっていないことも押さえる。
      spy.mockClear();
      const control = await mount(recursionState(forest()),
        `<div><template data-wcs="for: nodes"><span>{{ .totl }}</span></template></div>`);
      await flush();
      expect(spy.mock.calls.map((args) => String(args[0]))
        .filter((m) => m.includes("[wcs/binding-path-missing]") && m.includes("nodes.*.totl")),
      "打ち間違いは免除されない").toHaveLength(1);
      control.host.remove();
    } finally {
      spy.mockRestore();
    }
  });

  it("オブジェクトを返す `**` getter の値の内側をバインドしても binding-path-missing を出さないこと", async () => {
    // Fixed by post-landing review (P15) — was: `nodes.*.stats.count`（`get "nodes.**.stats"()` が
    // `{ count }` を返す）で偽の `[wcs/binding-path-missing] … "stats"` が出ていた。通常の
    // 行 getter なら `resolvePathExistence` の「途中のプレフィックスがフラット宣言」で
    // UNKNOWN に倒れるが、未実体化のアクセサは findDescriptor に見えない。値自体は正しく
    // 解決していたので、警告だけが嘘だった。
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, shadowRoot } = await mount(recursionState(forest(), {
        "nodes.**.stats": {
          get(this: any) { return { count: this["nodes.**.value"] }; },
          enumerable: true, configurable: true,
        },
      }), `<div><template data-wcs="for: nodes"><span class="c" data-wcs="textContent: nodes.*.stats.count"></span></template></div>`);
      await flush();
      expect(spy.mock.calls.map((args) => String(args[0]))
        .filter((m) => m.includes("[wcs/binding-path-missing]"))).toEqual([]);
      expect(texts(shadowRoot, ".c")).toEqual(["1", "2"]);
      host.remove();

      // 対照: getter の名前そのものを打ち間違えれば捉えられる（免除は getter の下に限る）
      spy.mockClear();
      const control = await mount(recursionState(forest(), {
        "nodes.**.stats": { get() { return { count: 0 }; }, enumerable: true, configurable: true },
      }), `<div><template data-wcs="for: nodes"><span data-wcs="textContent: nodes.*.statsx.count"></span></template></div>`);
      await flush();
      expect(spy.mock.calls.map((args) => String(args[0]))
        .filter((m) => m.includes("[wcs/binding-path-missing]") && m.includes("nodes.*.statsx.count")),
      "打ち間違いは免除されない").toHaveLength(1);
      control.host.remove();
    } finally {
      spy.mockRestore();
    }
  });
});

// ===========================================================================
// 6. `**` の診断（未対応の使い方）
// ===========================================================================

describe("`**` の診断: 再帰文脈の外", () => {
  it("トップレベルで `**` を直接読むと [wcs/recursion-context] になること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s["nodes.**.total"]))
      .toThrow(/\[wcs\/recursion-context\]/);
    expect(() => read(stateEl, (s: any) => s["nodes.**.total"]))
      .toThrow(/bound to the depth of the recursive getter being evaluated/);
    host.remove();
  });

  it("添字省略の $getAll に `**` を渡しても、文脈が無ければ同じ診断になること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.**.total")))
      .toThrow(/\[wcs\/recursion-context\]/);
    host.remove();
  });

  it("診断が「どこから読めるか」と具体パスの回避策を示すこと", async () => {
    // Fixed by Phase B review — was: 回避策として `$getAll("nodes.**.value", [])` を
    // 勧めていたが、その形は Phase C 未実装で `[wcs/recursion-getall-form]` になる。
    // 出口の無い堂々巡りだったので、文面から落とした。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    let message = "";
    try { read(stateEl, (s: any) => s["nodes.**.value"]); } catch (e: any) { message = e.message; }
    expect(message).toContain('Read it from inside a recursive getter or a row getter under "nodes.*"');
    expect(message).toContain('name a concrete depth (for example "nodes.*.value")');
    expect(message, "未実装の $getAll 形はもう勧めない").not.toContain("$getAll");
    host.remove();
  });

  it("`**` の診断で throw した後も、同じ state の通常の読みが壊れないこと", async () => {
    // 束縛は評価中のアドレススタックだけを見るので、例外で文脈が漏れてはいけない。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    const out = read(stateEl, (s: any) => {
      const log: any = {};
      try { s["nodes.**.total"]; } catch (e: any) { log.first = e.message.includes("[wcs/recursion-context]"); }
      log.d0 = s.$getAll(totalAt(0), []);
      try { s["nodes.**.total"]; } catch (e: any) { log.second = e.message.includes("[wcs/recursion-context]"); }
      log.d1 = s.$getAll(totalAt(1), []);
      return log;
    });
    expect(out).toEqual({ first: true, d0: [131, 2], second: true, d1: [110, 20] });
    host.remove();
  });

  it("再帰でない通常の getter の中から `**` を読んでも [wcs/recursion-context] になること", async () => {
    // 深さの根拠は評価中のアドレスであって、state に宣言があることではない。
    const { host, stateEl } = await mount(recursionState(forest(), {
      summary: {
        get(this: any) { return this["nodes.**.value"]; },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.summary)).toThrow(/\[wcs\/recursion-context\]/);
    host.remove();
  });

  it("アンカーの綴りが接頭辞として一致するだけの getter からも深さを取らないこと", async () => {
    // `nodes.*x` は `startsWith("nodes.*")` を通ってしまうが、パス境界で
    // 終わっていないのでノードパスではない。ここを通すと無関係な行の深さを拾う。
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.*x": {
        get(this: any) { return this["nodes.**.value"]; },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s["nodes.*x"])).toThrow(/\[wcs\/recursion-context\]/);
    host.remove();
  });

  it("トップレベルのバインド（ループ文脈なし）から `**` を読むと、バッチを壊さず $errorCallback に届くこと", async () => {
    // ループ文脈が無いバインドの適用中はアドレススタックの最下段が null になる。
    // そこを飛ばして走査できないと、`**` の診断ではなく別の失敗になる。
    const errors: { message: string; path: string }[] = [];
    const state = recursionState(forest(), {
      summary: {
        get(this: any) { return this["nodes.**.value"]; },
        enumerable: true, configurable: true,
      },
    });
    state.$errorCallback = function (error: any, info: any) {
      errors.push({ message: String(error?.message ?? error), path: info.path });
    };
    const { host, shadowRoot } = await mount(state,
      `<span class="s" data-wcs="textContent: summary"></span>`);
    await flush();

    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("summary");
    expect(errors[0].message).toContain("[wcs/recursion-context]");
    expect(shadowRoot.querySelector(".s")!.textContent).toBe("");
    host.remove();
  });

  it("ループ文脈が null のスコープ（イベントハンドラ・初期同期と同じ形）でも診断になること", async () => {
    // `setLoopContext(null)` はアドレススタックの段に **null を積む**。
    // 走査がそこで止まると `**` の診断ではなく別の失敗になる。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(() => stateEl.createState("readonly", (s: any) =>
      s[setLoopContextSymbol](null, () => s["nodes.**.value"])))
      .toThrow(/\[wcs\/recursion-context\]/);

    // 対照: 同じスコープでも具体パスは従来どおり読める
    let out: any;
    stateEl.createState("readonly", (s: any) => {
      out = s[setLoopContextSymbol](null, () => s.$getAll(totalAt(0), []));
    });
    expect(out).toEqual([131, 2]);
    host.remove();
  });

  it("再帰文脈の中でも、宣言外のアンカーの `**` は名指しで拒否されること", async () => {
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.**.bad": {
        get(this: any) { return this["tree.**.value"]; },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.*.bad", [])))
      .toThrow(/"tree\.\*\*\.value" does not match the declared recursion anchor "nodes\.\*\*"/);
    host.remove();
  });
});

describe("`**` の合併形と、定義できない形の診断", () => {
  it("$getAll(path, []) は全深さを深さ優先・行きがけ・添字昇順で合併すること", async () => {
    // Fixed by Phase C — was: [wcs/recursion-getall-form]（全深さ合併が未実装だった）。
    // forest() は [1[10[100], 20], 2]。行きがけ順は 1 → 10 → 100 → 20 → 2。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", [])))
      .toEqual([1, 10, 100, 20, 2]);
    // 各ノードの total（自分＋子孫）も同じ順序で並ぶ
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", [])))
      .toEqual([131, 110, 100, 20, 2]);
    host.remove();
  });

  it("合併形は値の配列だけを返し、添字タプルの往復は保証しないこと", async () => {
    // 深さごとにワイルドカードの本数が変わるので、返るタプルの長さが揃わない。
    // これが `$resolve` への往復を保証しない理由（設計書 §7-2）。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    const values = read(stateEl, (s: any) => s.$getAll("nodes.**.value", []));
    expect(values).toHaveLength(5);
    expect(values.every((v: unknown) => typeof v === "number")).toBe(true);
    host.remove();
  });

  it("非空の添字を渡しても同じ診断になること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.**.total", [0])))
      .toThrow(/\[wcs\/recursion-getall-form\]/);
    host.remove();
  });

  it("$resolve に `**` を渡すと [wcs/recursion-unsupported] になること（PathInfo の不変条件）", async () => {
    // `**` は PathInfo に降ろさない。降ろすと wildcardCount が不定になる。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$resolve("nodes.**.value", [0])))
      .toThrow(/\[wcs\/recursion-unsupported\]/);
    expect(() => read(stateEl, (s: any) => s.$resolve("nodes.**.value", [0])))
      .toThrow(/which is not accepted here/);
    host.remove();
  });

  it("$setAll(path, [], value) は全深さへブロードキャストすること", async () => {
    // Fixed by Phase D — was: [wcs/recursion-unsupported]（書き側が未実装だった）。
    // forest() は [1[10[100], 20], 2] の 5 ノード。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    let written = -1;
    write(stateEl, (s: any) => { written = s.$setAll("nodes.**.value", [], 7); });
    expect(written).toBe(5);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", []))).toEqual([7, 7, 7, 7, 7]);
    host.remove();
  });

  it("$setAll の非空接頭辞は [wcs/recursion-setall-form] になること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(() => write(stateEl, (s: any) => { s.$setAll("nodes.**.value", [0], 5); }))
      .toThrow(/\[wcs\/recursion-setall-form\]/);
    // 形の検査は列挙より前なので 1 件も書かれていない
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", []))).toEqual([1, 10, 100, 20, 2]);
    host.remove();
  });
});

describe("`**` の診断: 宣言の無い state", () => {
  it("`**` を直接読むと [wcs/recursion-unsupported] になること", async () => {
    const { host, stateEl } = await mount({ nodes: forest() }, NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s["nodes.**.value"]))
      .toThrow(/\[wcs\/recursion-unsupported\]/);
    host.remove();
  });

  it("$getAll に `**` を渡しても [wcs/recursion-unsupported] になること", async () => {
    const { host, stateEl } = await mount({ nodes: forest() }, NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.**.value", [])))
      .toThrow(/\[wcs\/recursion-unsupported\]/);
    host.remove();
  });

  it("診断が「$recursion 宣言のある state でしか意味を持たない」と言うこと", async () => {
    const { host, stateEl } = await mount({ nodes: forest() }, NO_RENDER_HTML);

    let message = "";
    try { read(stateEl, (s: any) => s["nodes.**.value"]); } catch (e: any) { message = e.message; }
    expect(message).toContain("only when the state declares a $recursion anchor");
    host.remove();
  });
});

// ===========================================================================
// 7. 宣言・定義そのものの診断
// ===========================================================================

describe("宣言と再帰 getter の定義を検証する", () => {
  it("複数アンカーの宣言を拒否すること", async () => {
    const { host, run } = await withReset(
      recursionState(forest(), {}, { "nodes.*": "children.*", "rows.*": "kids.*" }));
    expect(run).toThrow(/\$recursion declares 2 anchors/);
    host.remove();
  });

  it("`.*` で終わらないアンカーを拒否すること", async () => {
    const { host, run } = await withReset(recursionState(forest(), {}, { nodes: "children.*" }));
    expect(run).toThrow(/\$recursion anchor "nodes" must name a list element/);
    host.remove();
  });

  it("反復サブパスがアンカーのルートで始まる宣言を受理すること（自己相似な木）", async () => {
    // Fixed by Phase B review — was: `{ "nodes.*": "nodes.*" }` を「絶対パスの
    // 取り違え」として拒否していた。`{ nodes: [{ nodes: [...] }] }` は自己相似な木の
    // 最も自然な綴りで、反復サブパスが相対か絶対かは名前の形では判定できない。
    // その形の木が実際に畳めることは section 16 で測る。
    const { host, stateEl } = await mount(
      recursionState(forest(), {}, { "nodes.*": "nodes.*" }), NO_RENDER_HTML);

    expect((stateEl as any).recursionRegistry.spec.repeat).toBe("nodes.*");
    expect((stateEl as any).recursionRegistry.spec.recursiveAnchor).toBe("nodes.**");
    host.remove();
  });

  it("再帰 setter を拒否すること", async () => {
    const { host, run } = await withReset(recursionState(forest(), {
      "nodes.**.w": { get() { return 1; }, set() { /* noop */ }, configurable: true },
    }));
    expect(run).toThrow(/Recursive setters are not supported in this version: "nodes\.\*\*\.w"/);
    host.remove();
  });

  it("`**` を含むのに getter でないキーを拒否すること", async () => {
    const broken = recursionState(forest());
    broken["nodes.**.plain"] = 1;
    const { host, run } = await withReset(broken);
    expect(run).toThrow(/"nodes\.\*\*\.plain" contains "\*\*" but is not a getter/);
    host.remove();
  });

  it("宣言のアンカーに合致しない `**` getter を拒否すること", async () => {
    const { host, run } = await withReset(recursionState(forest(), {
      "tree.**.x": { get() { return 1; }, configurable: true },
    }));
    expect(run).toThrow(/"tree\.\*\*\.x" does not match the declared recursion anchor "nodes\.\*\*"/);
    host.remove();
  });

  it("2 つ目の `**` を持つ getter を拒否すること", async () => {
    const { host, run } = await withReset(recursionState(forest(), {
      "nodes.**.children.**.x": { get() { return 1; }, configurable: true },
    }));
    expect(run).toThrow(/does not match the declared recursion anchor/);
    host.remove();
  });

  it("2 つ目の `**` の診断が「アンカーは 1 つ・同じパスに 2 つ目の `**` は無い」と言うこと", async () => {
    const { host, run } = await withReset(recursionState(forest(), {
      "nodes.**.children.**.x": { get() { return 1; }, configurable: true },
    }));
    expect(run).toThrow(/supports exactly one anchor, and no second "\*\*" in the same path/);
    host.remove();
  });

  it("`**` getter を持たない宣言でも成立すること（レジストリは空のまま）", async () => {
    const plain: any = { $recursion: { "nodes.*": "children.*" }, nodes: forest() };
    const { host, stateEl } = await mount(plain, NO_RENDER_HTML);

    expect((stateEl as any).hasRecursion).toBe(true);
    expect((stateEl as any).recursionRegistry.hasDefinitions).toBe(false);
    expect(read(stateEl, (s: any) => s.$getAll(valueAt(0), []))).toEqual([1, 2]);
    host.remove();
  });

  it("作者が具体パスを手で定義済みなら、生成先の衝突として拒否されること", async () => {
    // Fixed by Phase B review — was: 診断されず、深さ 1 だけ作者の getter（常に 7）が
    // 黙って使われていた（`$getAll(totalAt(0), [])` が `[15, 2]`）。原因は
    // `materializeRecursionAccessor` の早期 return が `getterPaths.has(path)` だったこと。
    // いまは `materializeFor` の台帳（`_accessors`）で見るので `_define` の衝突検査に到達する
    // （生成物と作者定義は WeakSet で見分ける）。
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.*.children.*.total": { get() { return 7; }, enumerable: true, configurable: true },
    }), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$getAll(totalAt(0), [])))
      .toThrow(/"nodes\.\*\.children\.\*\.total" is already defined on the state/);
    expect(() => read(stateEl, (s: any) => s.$getAll(totalAt(0), [])))
      .toThrow(/the recursive getter "nodes\.\*\*\.total" cannot expand to it\. Rename one of them/);
    host.remove();
  });

  it("class 構文（prototype の getter）で書いた同名の具体パスも、衝突として拒否されること", async () => {
    // Fixed by post-landing review (P1) — was: 衝突検査が own descriptor しか見ておらず、
    // class 構文の `get "nodes.*.total"()`（prototype に載る）を素通りして、生成アクセサが
    // own に定義されて作者の getter を無言で影にしていた（`$getAll("nodes.*.total", [])` が
    // 作者の -1 ではなく再帰の `[131, 2]`）。README「rejected when the declaration is read —
    // never reinterpreted」と impl-plan §1-1 の例（class 形）に反する。
    class TreeState {
      $recursion = { "nodes.*": "children.*" };
      nodes = forest();
      get "nodes.*.total"(): number { return -1; }
      get "nodes.**.total"(): number {
        return (this as any)["nodes.**.value"] +
          (this as any).$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
      }
    }
    const { host, stateEl } = await mount(new TreeState(), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.*.total", [])))
      .toThrow(/"nodes\.\*\.total" is already defined on the state, so the recursive getter "nodes\.\*\*\.total" cannot expand to it/);
    // 拒否したので、作者の getter が own の生成物で影にされていない
    expect(Object.getOwnPropertyDescriptor(stateEl["state" as keyof State] ?? {}, "nodes.*.total")).toBe(undefined);
    host.remove();
  });

  it("同名の具体パスがデータプロパティでも衝突として拒否されること（作者のデータを上書きしない）", async () => {
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.*.total": { value: 7, writable: true, enumerable: true, configurable: true },
    }), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$getAll(totalAt(0), [])))
      .toThrow(/"nodes\.\*\.total" is already defined on the state/);
    host.remove();
  });
});

// ===========================================================================
// 8. state 再セットとレジストリの世代
// ===========================================================================

describe("state の再セットでレジストリが作り直されること", () => {
  it("再セットで別のレジストリになり、実体化済みの展開が持ち越されないこと", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    read(stateEl, (s: any) => s.$getAll(totalAt(0), []));
    const before = (stateEl as any).recursionRegistry;
    expect(materialized(stateEl)).toEqual([totalAt(0), totalAt(1), totalAt(2)].sort());

    stateEl.setInitialState(recursionState([node(5, [node(50)])]));

    const after = (stateEl as any).recursionRegistry;
    expect(after, "レジストリは作り直される").not.toBe(before);
    expect(materialized(stateEl), "展開は空に戻る").toEqual([]);
    expect(totalGetterPaths(stateEl), "getterPaths も `**` だけに戻る").toEqual(["nodes.**.total"]);
    host.remove();
  });

  it("再セット後の読みが新しい木の値になること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    read(stateEl, (s: any) => s.$getAll(totalAt(0), []));

    stateEl.setInitialState(recursionState([node(5, [node(50)])]));

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([55]);
    expect(materialized(stateEl)).toEqual([totalAt(0), totalAt(1)].sort());
    host.remove();
  });

  it("別のアンカーの宣言へ切り替えると、旧アンカーは再帰でなくなること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    read(stateEl, (s: any) => s.$getAll(totalAt(0), []));

    const rows: any = { $recursion: { "rows.*": "kids.*" }, rows: [{ value: 5, kids: [{ value: 50, kids: [] }] }] };
    Object.defineProperty(rows, "rows.**.total", {
      get(this: any) {
        return this["rows.**.value"] +
          this.$getAll("rows.**.kids.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    stateEl.setInitialState(rows);

    expect((stateEl as any).recursionRegistry.spec.recursiveAnchor).toBe("rows.**");
    expect(read(stateEl, (s: any) => s.$getAll("rows.*.total", []))).toEqual([55]);
    // 旧アンカーはもう宣言に無い。
    // Fixed by Phase B review — was: [wcs/recursion-context]（「文脈が無い」と
    // 報告され、綴り違い／宣言外のアンカーだという原因に辿り着けなかった）。
    // `bindRecursivePath` はアンカー照合を深さ解決より先に行う。
    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.**.total")))
      .toThrow(/\[wcs\/recursion-anchor\]/);
    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.**.total")))
      .toThrow(/does not match the declared recursion anchor "rows\.\*\*"/);
    host.remove();
  });

  it("宣言の無い state へ切り替えると、再帰の経路が完全に外れること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    read(stateEl, (s: any) => s.$getAll(totalAt(0), []));

    stateEl.setInitialState({ nodes: forest() });

    expect((stateEl as any).hasRecursion).toBe(false);
    expect((stateEl as any).recursionRegistry).toBe(null);
    expect(() => read(stateEl, (s: any) => s["nodes.**.total"]))
      .toThrow(/\[wcs\/recursion-unsupported\]/);
    host.remove();
  });

  it("同じ state オブジェクトを再セットしても、読む前の構造書き込みが集計に届くこと", async () => {
    // Fixed by post-landing review (P2) — was: 同じオブジェクトなので `nodes` 配列も同じ
    // instance ＝ ListIndex も絶対アドレスも世代を跨いで同一のまま。再セットで生成アクセサ向けの
    // 依存辺だけが外れ（`forgetGeneratedDependencies`）、旧世代の `dirty:false` のキャッシュは
    // 残っていた。次に再帰 getter を読むまでの間の構造書き込みは辺が無いので dirty にできず、
    // `$getAll("nodes.**.total", [])` が `[131, 7, 8, 2]`（正しくは `[16, 7, 8, 2]`）を返した。
    // いまは辺と一緒にキャッシュも落とす（registry.forgetGenerated）。
    const state = recursionState(forest());
    const { host, stateEl } = await mount(state, NO_RENDER_HTML);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", []))).toEqual([131, 110, 100, 20, 2]);

    stateEl.setInitialState(state);
    write(stateEl, (s: any) => { s["nodes.0.children"] = [node(7), node(8)]; });

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", []))).toEqual([16, 7, 8, 2]);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([16, 2]);
    host.remove();
  });

  it("同じ `nodes` 配列を新しいオブジェクトで再セットしても同じこと（台帳は配列の identity）", async () => {
    const nodes = forest();
    const { host, stateEl } = await mount(recursionState(nodes), NO_RENDER_HTML);
    read(stateEl, (s: any) => s.$getAll("nodes.**.total", []));

    stateEl.setInitialState(recursionState(nodes));
    write(stateEl, (s: any) => { s["nodes.1.children"] = [node(3)]; });

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.total", []))).toEqual([131, 110, 100, 20, 5, 3]);
    host.remove();
  });

  it("忘れる走査が、台帳の無いリスト・children を持たないノード・消えたアンカーを飛ばすこと", async () => {
    // 走査を一度も経ていない配列（台帳が無い）、`children` の無いノード、アンカーの親が
    // null になった木 — どれも「落とすキャッシュが無い」だけで、再セットは成立する。
    const nodes: any[] = [node(1, [node(10)]), { value: 2 }];
    const state: any = { $recursion: { "data.tree.*": "children.*" }, data: { tree: nodes } };
    Object.defineProperty(state, "data.tree.**.total", {
      get(this: any) {
        return this["data.tree.**.value"] +
          this.$getAll("data.tree.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    const { host, stateEl } = await mount(state, NO_RENDER_HTML);
    expect(read(stateEl, (s: any) => s.$getAll("data.tree.**.total", []))).toEqual([11, 10, 2]);

    // 台帳の無い配列を差し込む（読まない）
    write(stateEl, (s: any) => { s["data.tree.0.children"] = [node(5)]; });
    expect(() => stateEl.setInitialState(state)).not.toThrow();
    expect(read(stateEl, (s: any) => s.$getAll("data.tree.**.total", []))).toEqual([6, 5, 2]);

    // アンカーの親を消す
    write(stateEl, (s: any) => { s.data = null; });
    expect(() => stateEl.setInitialState(state)).not.toThrow();
    host.remove();
  });
});

// ===========================================================================
// 9. 宣言の無い state の回帰（対照）
// ===========================================================================

describe("宣言の無い state の挙動が変わらないこと（対照）", () => {
  /** 手で 1 段だけ畳んだ、再帰でない集計 getter */
  function plainState(): any {
    const state: any = { title: "plain", nodes: forest() };
    Object.defineProperty(state, "nodes.*.total", {
      get(this: any) {
        return this["nodes.*.value"] +
          this.$getAll("nodes.*.children.*.value").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    return state;
  }

  it("hasRecursion が false で recursionRegistry が null であること", async () => {
    const { host, stateEl } = await mount(plainState(), NO_RENDER_HTML);

    expect((stateEl as any).hasRecursion).toBe(false);
    expect((stateEl as any).recursionRegistry).toBe(null);
    host.remove();
  });

  it("通常のワイルドカード getter が従来どおり評価されること", async () => {
    const { host, stateEl } = await mount(plainState(), NO_RENDER_HTML);

    // nodes[0] = 1 + (10 + 20) = 31、nodes[1] = 2 + 0 = 2
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([31, 2]);
    host.remove();
  });

  it("$getAll / $setAll / $resolve が従来どおり動くこと", async () => {
    const { host, stateEl } = await mount(plainState(), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll(valueAt(1), []))).toEqual([10, 20]);

    let count: number | null = null;
    write(stateEl, (s: any) => { count = s.$setAll(valueAt(1), [], 3); });
    await flush();
    expect(count).toBe(2);
    expect(read(stateEl, (s: any) => s.$resolve(valueAt(1), [0, 1]))).toBe(3);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([7, 2]);
    host.remove();
  });

  it("`for` の描画が従来どおりであること", async () => {
    const { host, shadowRoot, stateEl } = await mount(plainState(),
      `<div><template data-wcs="for: nodes">` +
      `<span class="t0" data-wcs="textContent: nodes.*.total"></span>` +
      `</template></div>`);

    expect(texts(shadowRoot, ".t0")).toEqual(["31", "2"]);
    write(stateEl, (s: any) => { s.$resolve(valueAt(0), [0], 100); });
    await flush();
    expect(texts(shadowRoot, ".t0")).toEqual(["130", "2"]);
    host.remove();
  });

  it("`**` を含まないパスは、宣言のある state でも従来どおり読めること", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll(valueAt(0), []))).toEqual([1, 2]);
    expect(read(stateEl, (s: any) => s.$getAll(valueAt(1), []))).toEqual([10, 20]);
    expect(read(stateEl, (s: any) => s.$resolve(valueAt(1), [0, 1]))).toBe(20);
    host.remove();
  });
});

// ===========================================================================
// 10. 二重計上を「和が合う」より強い形で見る
// ===========================================================================

describe("再帰 getter: 非対称な木で二重計上が起きないこと", () => {
  it("値を 2 の冪にした非対称な木で、各段の集計がビットの重なりを持たないこと", async () => {
    // 「全 value の和 = ルート total の和」は、二重計上と取りこぼしが打ち消し合えば
    // 偶然通りうる。値を相異なる 2 の冪にすると、各 total は「その部分木に含まれる
    // 値の集合」をビットで表すので、重複も欠落もビットパターンとして露出する。
    //   1 ─┬─ 2 ── 4
    //      └─ 8 ─┬─ 16
    //            └─ 32
    //   64 ── 128
    const tree = [node(1, [node(2, [node(4)]), node(8, [node(16), node(32)])]), node(64, [node(128)])];
    const { host, stateEl } = await mount(recursionState(tree), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(2), [])), "深さ 2").toEqual([4, 16, 32]);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(1), [])), "深さ 1").toEqual([6, 56, 128]);
    const roots = read(stateEl, (s: any) => s.$getAll(totalAt(0), [])) as number[];
    expect(roots, "深さ 0").toEqual([63, 192]);

    // 63 = 0b0011_1111（1,2,4,8,16,32 が各 1 回）、192 = 0b1100_0000（64,128）。
    // ビットが重なっていない = どの値もちょうど 1 つのルートに 1 回だけ数えられた。
    expect(roots[0] & roots[1], "ルート同士でビットが重ならない").toBe(0);
    expect(roots[0] | roots[1], "全 8 値がちょうど 1 回ずつ").toBe(255);
    host.remove();
  });
});

// ===========================================================================
// 11. `**` getter が複数ある state
// ===========================================================================

describe("再帰 getter: `**` getter が複数ある", () => {
  it("独立した 2 本（total と count）が互いに干渉せず、それぞれ実体化されること", async () => {
    // レジストリは定義を Map で持ち、具体パスごとにどの定義の展開かを選ぶ。
    // 1 本しか無い state だけを測っていると、この選択が正しいかは分からない。
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.**.count": {
        get(this: any) {
          return 1 + this.$getAll("nodes.**.children.*.count").reduce((a: number, b: number) => a + b, 0);
        },
        enumerable: true, configurable: true,
      },
    }), NO_RENDER_HTML);

    // count: nodes[0] の部分木は 4 ノード（1・10・100・20）、nodes[1] は 1 ノード
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.count", [])), "深さ 0 の件数").toEqual([4, 1]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.children.*.count", [])), "深さ 1 の件数")
      .toEqual([2, 1]);
    // total は count を足しても変わらない
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([131, 2]);

    expect(materialized(stateEl), "2 本ぶんが別々に生える").toEqual([
      "nodes.*.children.*.children.*.count", "nodes.*.children.*.children.*.total",
      "nodes.*.children.*.count", "nodes.*.children.*.total",
      "nodes.*.count", "nodes.*.total",
    ].sort());
    host.remove();
  });

  it("展開先が重なる 2 本を、レジストリ構築時に静的に拒否すること", async () => {
    // Fixed by Phase B review — was: 診断されず、定義（descriptor）の順で先勝ちして
    // いた。`nodes.**.children.*.tag` の深さ k と `nodes.**.tag` の深さ k+1 は
    // どちらも同じ具体パスに展開される（接尾辞の差が反復語の整数倍）。
    // 作者が受け取る経路（state のセット）で測る。初回マウントではセッターの throw が
    // 握り潰されて永久 pending になるので、再セットの形で読む（withReset の docblock）。
    const broken: any = { $recursion: { "nodes.*": "children.*" }, nodes: forest() };
    Object.defineProperty(broken, "nodes.**.children.*.tag",
      { get() { return "A"; }, enumerable: true, configurable: true });
    Object.defineProperty(broken, "nodes.**.tag",
      { get() { return "B"; }, enumerable: true, configurable: true });
    const { host, run } = await withReset(broken);

    expect(run).toThrow(
      /"nodes\.\*\*\.children\.\*\.tag" and "nodes\.\*\*\.tag" expand to the same concrete path at different depths/);
    expect(run).toThrow(/they differ by whole repetitions of "children\.\*"\)\. Rename one of them/);
    host.remove();
  });

  it("重なりの検査が定義順に依らないこと（深いほうを先に書いても同じ）", () => {
    // 「短いほうが先」でしか検出しない実装に退化していないこと。
    expect(() => buildRegistry({ "nodes.*": "children.*" }, {
      "nodes.**.tag": () => "B",
      "nodes.**.children.*.tag": () => "A",
    })).toThrow(/expand to the same concrete path at different depths/);
  });

  it("接尾辞が反復語の整数倍だけ違わない 2 本は受理されること（対照）", () => {
    // `.total` と `.children.*.count` は語尾が一致しないので衝突しない。
    // ここまで拒否する実装になると、独立した 2 本が書けなくなる。
    const registry = buildRegistry({ "nodes.*": "children.*" }, {
      "nodes.**.total": () => 1,
      "nodes.**.children.*.count": () => 1,
    });
    expect(registry.hasDefinitions).toBe(true);
  });

  it("語尾が一致しても、差分が反復語でなければ受理されること（対照）", () => {
    // `.meta.total` と `.total` は語尾が一致するが、差分 `.meta` は反復語ではない。
    // 深さ k の `nodes.*…*.meta.total` は、どの深さの `nodes.*…*.total` とも別のパス。
    const registry = buildRegistry({ "nodes.*": "children.*" }, {
      "nodes.**.meta.total": () => 1,
      "nodes.**.total": () => 1,
    });
    expect(registry.hasDefinitions).toBe(true);
  });

  it("差分の長さが反復語と同じでも、別の語なら受理されること（対照）", () => {
    // `.subtotal.*` は `.children.*` と**同じ文字数**なので、長さの剰余だけで
    // 判定する実装だと衝突と誤判定される。語そのものを見ていることを固定する。
    expect(".subtotal.*".length, "前提: 反復語と同じ長さ").toBe(".children.*".length);
    const registry = buildRegistry({ "nodes.*": "children.*" }, {
      "nodes.**.subtotal.*.total": () => 1,
      "nodes.**.total": () => 1,
    });
    expect(registry.hasDefinitions).toBe(true);
  });
});

// ===========================================================================
// 12. 深さ上限（統合）
// ===========================================================================

describe("再帰 getter: 深さ上限に届く木", () => {
  /** 長さ len の一本鎖（全 value = 1） */
  const chain = (len: number): TNode[] => {
    let leaf = node(1);
    for (let i = 1; i < len; i++) leaf = node(1, [leaf]);
    return [leaf];
  };

  it("上限より浅い鎖（64 段）は最後まで畳めること（対照）", async () => {
    const { host, stateEl } = await mount(recursionState(chain(64)), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([64]);
    expect(materialized(stateEl).length, "深さのぶんだけ生える").toBe(64);
    host.remove();
  });

  it("上限を超える鎖では [wcs/recursion-depth-exceeded] で止まること", async () => {
    // ここが Phase B の上限で、Phase A のアドレススタック上限
    // （`[wcs/getter-depth-exceeded]`）より先に効く。エンジンが黙って
    // 途中で集計を打ち切らないことの担保。
    const { host, stateEl } = await mount(recursionState(chain(200)), NO_RENDER_HTML);

    let message = "";
    try { read(stateEl, (s: any) => s.$getAll(totalAt(0), [])); } catch (e: any) { message = e.message; }
    expect(message).toContain("[wcs/recursion-depth-exceeded]");
    expect(message).toContain('Recursion on "nodes.*" reached depth 127');
    expect(message).toContain("which needs 129 wildcard levels");
    expect(message).toContain("the limit is 128");
    expect(message).toContain("or the tree contains a cycle");
    expect(message).not.toContain("[wcs/getter-depth-exceeded]");

    // 諦める前に上限ぶんまでは実体化している（＝途中で静かに止まっていない）
    expect(materialized(stateEl).length).toBe(128);
    host.remove();
  });
});

// ===========================================================================
// 13. レジストリの直接 API と防御分岐
// ===========================================================================

describe("RecursionRegistry の直接 API", () => {
  const registryOf = (stateEl: State): any => (stateEl as any).recursionRegistry;

  it("materializeFor が冪等で、同じアクセサ（凍結済み）を返すこと", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    const registry = registryOf(stateEl);

    const first = registry.materializeFor(stateEl, totalAt(0));
    const second = registry.materializeFor(stateEl, totalAt(0));
    expect(second, "二度目は台帳から同じものを返す").toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    host.remove();
  });

  it("アクセサのメタデータが元の `**` キーと深さだけを持つこと", async () => {
    // ランタイムが読むのはこの 2 つだけ（深さ ＝ `**` の束縛、元のキー ＝ 診断の名指し）。
    // 具体パス・spec・PathInfo は台帳のキーと読み手が持っているので重ねて持たない。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    const registry = registryOf(stateEl);

    const d1 = registry.materializeFor(stateEl, totalAt(1));
    expect(d1).toEqual({ recursivePath: "nodes.**.total", depth: 1 });
    expect(registry.accessorFor(totalAt(1))).toBe(d1);
    host.remove();
  });

  it("アンカー外のパス・未実体化のパスでは null を返すこと", async () => {
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    const registry = registryOf(stateEl);

    expect(registry.materializeFor(stateEl, "title"), "アンカーで始まらない").toBe(null);
    expect(registry.materializeFor(stateEl, "nodes.*.unknown"), "定義に合致しない").toBe(null);
    expect(registry.accessorFor(totalAt(0)), "まだ読んでいない").toBe(null);
    host.remove();
  });

  it("recursiveGetterOwning が実体化せずに展開形を `**` getter に帰属させ、アンカー外・定義外は null になること", async () => {
    // バインド確立時の存在検査（`checkDeclaredPath`）と書き込みの入口（`setByAddress`）が
    // 使う窓。「実体化しない」が効いていないと、宣言を見ただけで具体パスが生えて
    // Phase A の A6/A7 に戻る。免除がアンカー配下を丸ごと黙らせる形に広がっていない
    // こともここで測る。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    const registry = registryOf(stateEl);

    expect(registry.recursiveGetterOwning(totalAt(1)), "未実体化の展開形").toBe("nodes.**.total");
    expect(materialized(stateEl), "見ただけでは生えない").toEqual([]);
    expect(registry.recursiveGetterOwning("title"), "アンカー外").toBe(null);
    expect(registry.recursiveGetterOwning("nodes.*.totl"), "アンカー配下でも定義外").toBe(null);
    expect(registry.recursiveGetterOwning("nodes.*"), "アンカー自身（行）").toBe(null);
    // getter の値の内側（通常の getter の下と同じく、評価しないと分からない側）
    expect(registry.recursiveGetterOwning(totalAt(0) + ".x"), "展開形の値の内側").toBe("nodes.**.total");
    expect(registry.recursiveGetterOwning(totalAt(2) + ".a.b"), "深い展開形の値の内側").toBe("nodes.**.total");
    expect(registry.recursiveGetterOwning("nodes.*.totalx.y"), "セグメント境界で一致しない接頭辞").toBe(null);
    // 判定は記憶される（二度目も同じ答え）
    expect(registry.recursiveGetterOwning(totalAt(0) + ".x")).toBe("nodes.**.total");
    expect(registry.recursiveGetterOwning("nodes.*.totl")).toBe(null);

    // 実体化した後は台帳の即答経路（同じ答えが二度出ること）
    registry.materializeFor(stateEl, totalAt(1));
    expect(registry.recursiveGetterOwning(totalAt(1))).toBe("nodes.**.total");
    host.remove();
  });
});

describe("生成先の衝突と展開不一致（読みの経路では見えないガード）", () => {
  const registryOf = (stateEl: State): any => (stateEl as any).recursionRegistry;

  it("作者が定義済みの具体パスへ直接 materializeFor すると、名指しで拒否されること", async () => {
    // 読みの経路からも同じガードに来る（section 7 の対のテスト）。ここで固定するのは
    // レジストリ API 単体としての契約 — 深さを名指しして呼んでも同じ診断になること。
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.*.children.*.total": { get() { return 7; }, enumerable: true, configurable: true },
    }), NO_RENDER_HTML);

    expect(() => registryOf(stateEl).materializeFor(stateEl, totalAt(1)))
      .toThrow(/"nodes\.\*\.children\.\*\.total" is already defined on the state/);
    expect(() => registryOf(stateEl).materializeFor(stateEl, totalAt(1)))
      .toThrow(/cannot expand to it\. Rename one of them/);
    host.remove();
  });

  it("接尾辞が空の `**` getter（`get \"nodes.**\"`）をレジストリ構築時に拒否すること", async () => {
    // Fixed by Phase B review — was: 宣言時に診断されず、`nodes.*` を触った時点で
    // 「展開不一致」という内部語の診断になっていた。`nodes.**` は展開すると
    // アンカーそのもの（`nodes.*`）で、`getByAddress` は「パスが target にあるか」を
    // 先に見るため実データの行が丸ごと隠れる。
    // 衝突の検査と同じく、作者が受け取る経路（再セット）で測る。
    const { host, run } = await withReset(recursionState(forest(), {
      "nodes.**": { get() { return 1; }, enumerable: true, configurable: true },
    }));

    expect(run).toThrow(/"nodes\.\*\*" names the recursive node itself/);
    expect(run).toThrow(/"\*\*" names a computed path under a node/);
    host.remove();
  });

  it("接尾辞が `.*` だけの `**` getter でも、アンカー自身の読みは壊れないこと", async () => {
    // Fixed by Phase B review — was: materialized === ["nodes.*"] and reading the
    // anchor threw a raw "Reflect.get called on non-object" (the generated getter
    // had replaced the data row, because the anchor and the ".*" suffix overlapped
    // and made depthOfConcretePath report depth 0 for the anchor itself).
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.**.*": { get() { return 1; }, enumerable: true, configurable: true },
    }), NO_RENDER_HTML);
    // The anchor still reads the real rows.
    expect(read(stateEl, (s: any) => s.$getAll(valueAt(0), []))).toEqual([1, 2]);
    expect(materialized(stateEl), "アンカー自身は生成 getter に置き換わらない")
      .not.toContain("nodes.*");
    host.remove();
  });
});

// ===========================================================================
// 14. `**` の外縁
// ===========================================================================

describe("`**` の外縁", () => {
  /** 失敗するマウントの後始末込みで診断文面だけを取り出す */
  async function mountFailure(initial: any, innerHTML: string): Promise<string> {
    const host = document.createElement(`recursion-getter-host-${seq++}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    try {
      const stateEl = shadowRoot.querySelector("wcs-state") as State;
      stateEl.setInitialState(initial);
      await stateEl.connectedCallbackPromise;
      await State.getBindingsReady(shadowRoot);
      return "NO THROW";
    } catch (e: any) {
      return String(e?.message ?? e);
    } finally {
      host.remove();
    }
  }

  it("markup（data-wcs）に `**` を書くと [wcs/recursion-unsupported] でマウントが失敗すること", async () => {
    // バインドのパスは PathInfo に降りる。`**` はそこへ降ろさない、が Phase B の
    // 不変条件なので、オーサリングの入口でも同じ診断でなければならない。
    const message = await mountFailure(recursionState(forest()),
      `<span class="x" data-wcs="textContent: nodes.**.total"></span>`);

    expect(message).toContain("[wcs/recursion-unsupported]");
    expect(message).toContain('"nodes.**.total" uses "**", which is not accepted here');
    expect(message).toContain("in a recursive getter key");
  });

  it("宣言はあるが `**` getter が無い state で `**` を読むと [wcs/recursion-context] になること", async () => {
    // レジストリはあるが台帳が空なので、どのアドレスからも深さが取れない。
    // 「宣言が無い」（recursion-unsupported）とは別の診断になる。
    const plain: any = { $recursion: { "nodes.*": "children.*" }, nodes: forest() };
    const { host, stateEl } = await mount(plain, NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s["nodes.**.value"]))
      .toThrow(/\[wcs\/recursion-context\]/);
    expect(() => read(stateEl, (s: any) => s["nodes.**.value"]))
      .not.toThrow(/\[wcs\/recursion-unsupported\]/);
    host.remove();
  });

  it("木より深いパスを先に読んで空配列を得ても、後から深くした木がそこで評価できること", async () => {
    // Phase A の A7（未定義のワイルドカードパスを一度読むと `undefined` が
    // `dirty:false` で固定される）を、再帰の生成経路で踏んでいないことの確認。
    // 実体化がキャッシュ参照より前にあるので、空振りの読みが跡を残さない。
    const { host, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(3), [])), "まだ無い深さ").toEqual([]);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([131, 2]);

    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children.*.children", [0, 0, 0], [node(1000)]);
    });
    await flush();

    expect(read(stateEl, (s: any) => s.$getAll(totalAt(3), [])), "空振り後でも読める").toEqual([1000]);
    expect(read(stateEl, (s: any) => s.$getAll(totalAt(0), []))).toEqual([1131, 2]);
    host.remove();
  });
});

// ===========================================================================
// 15. 公開 API からは到達しない防御分岐
// ===========================================================================

describe("防御分岐（`hasRecursion` ゲートより内側）", () => {
  // Removed by Phase B review: `bindRecursivePath` の `[wcs/recursion-undeclared]`
  // 分岐を固定していたテストは、その分岐ごと削除された（呼び出し元 2 つとも
  // `hasRecursion === true` をゲートにしていて到達不能だったため）。宣言の無い
  // state の `**` は `[wcs/recursion-unsupported]`（PathInfo の不変条件ガード）で
  // 落ちる — section 6「宣言の無い state」がその契約を測っている。

  it("空のアドレススタックでは深さ解決が null（診断側）になること", async () => {
    const { host, shadowRoot, stateEl } = await mount(recursionState(forest()), NO_RENDER_HTML);
    const handler = new stateHandlerPrivate.StateHandler(shadowRoot, "readonly");

    expect(handler.addressStackLength).toBe(0);
    expect(currentRecursionDepth(handler, (stateEl as any).recursionRegistry)).toBe(null);
    host.remove();
  });
});

// ===========================================================================
// 15'. 深さと行は同じフレームから取る（別の getter を経由した `**` 読み）
// ===========================================================================

describe("`**` getter が別の素の getter を経由して `**` を読む形", () => {
  // Fixed by post-landing review (P5) — was: `currentRecursionDepth` がアドレススタックを
  // 外側へ走査して深さだけを再帰 getter のフレームから拾っていた。添字（ListIndex）は
  // `getContextListIndex` / `$getAll` の省略形が**先頭のフレームだけ**から取るので、
  // 深さの供給元と添字の供給元が別フレームになり、直接読みは生の `ListIndex not found:
  // nodes.*.value`、`$getAll` の省略形は「束縛した深さ × 全行」（`[30, 30, 30, 30, 30]`）という
  // 定義にない値を無言で返していた。深さも先頭のフレームだけから取り、無ければ
  // `[wcs/recursion-context]` にする（README「each of those carries a real ListIndex」の通り）。
  const viaHelper = () => recursionState(forest(), {
    "nodes.**.viaHelper": { get(this: any) { return this.helper; }, enumerable: true, configurable: true },
    helper: { get(this: any) { return this["nodes.**.value"]; }, enumerable: true, configurable: true },
    "nodes.**.viaHelper2": { get(this: any) { return this.helper2; }, enumerable: true, configurable: true },
    helper2: {
      get(this: any) {
        return this.$getAll("nodes.**.children.*.value").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    },
  });

  it("直接読み（this[\"nodes.**.value\"]）は [wcs/recursion-context] になること", async () => {
    const { host, stateEl } = await mount(viaHelper(), NO_RENDER_HTML);

    let message = "";
    try { read(stateEl, (s: any) => s.$getAll("nodes.**.viaHelper", [])); } catch (e: any) { message = e.message; }
    expect(message).toContain("[wcs/recursion-context]");
    expect(message).not.toContain("ListIndex not found");
    expect(message).toContain("The depth comes from the innermost frame only");
    host.remove();
  });

  it("添字省略の $getAll も同じ診断になること（「束縛した深さ × 全行」を無言で返さない）", async () => {
    const { host, stateEl } = await mount(viaHelper(), NO_RENDER_HTML);

    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.**.viaHelper2", [])))
      .toThrow(/\[wcs\/recursion-context\]/);
    host.remove();
  });

  it("対照: `**` を再帰 getter の側で読んで値を渡せば成立すること", async () => {
    const { host, stateEl } = await mount(recursionState(forest(), {
      "nodes.**.viaHelper": {
        get(this: any) { return this.describe(this["nodes.**.value"]); },
        enumerable: true, configurable: true,
      },
      describe: { value(this: any, v: number) { return `v=${v}`; }, enumerable: true, configurable: true },
    }), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.viaHelper", [])))
      .toEqual(["v=1", "v=10", "v=100", "v=20", "v=2"]);
    host.remove();
  });
});

// ===========================================================================
// 16. 自己相似な木（反復サブパスがアンカーと同じ語）
// ===========================================================================

describe("再帰 getter: 反復サブパスがアンカーと同じ語の木", () => {
  /** `{ nodes: [{ nodes: [...] }] }`。子リストの名前が親と同じ自己相似な形。 */
  type SNode = { value: number; nodes: SNode[] };
  const snode = (value: number, nodes: SNode[] = []): SNode => ({ value, nodes });

  function selfSimilarState(nodes: SNode[]): any {
    const state: any = { $recursion: { "nodes.*": "nodes.*" }, nodes };
    Object.defineProperty(state, "nodes.**.total", {
      get(this: any) {
        return this["nodes.**.value"] +
          this.$getAll("nodes.**.nodes.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    return state;
  }

  it("`{ \"nodes.*\": \"nodes.*\" }` の宣言で三段の木が畳めること", async () => {
    // Fixed by Phase B review — was: この宣言が「絶対パスの取り違え」として
    // 拒否され、自己相似な木の最も自然な綴りが書けなかった。
    //   nodes[0] = 1 ── 10 ── 100 / nodes[1] = 2
    const { host, stateEl } = await mount(
      selfSimilarState([snode(1, [snode(10, [snode(100)])]), snode(2)]), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.nodes.*.nodes.*.total", [])), "深さ 2")
      .toEqual([100]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.nodes.*.total", [])), "深さ 1")
      .toEqual([110]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", [])), "深さ 0")
      .toEqual([111, 2]);
    host.remove();
  });

  it("深さのぶんだけ具体パスが生え、葉の書き込みが全段に伝播すること", async () => {
    const { host, stateEl } = await mount(
      selfSimilarState([snode(1, [snode(10, [snode(100)])]), snode(2)]), NO_RENDER_HTML);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([111, 2]);
    expect(materialized(stateEl)).toEqual([
      "nodes.*.nodes.*.nodes.*.total", "nodes.*.nodes.*.total", "nodes.*.total",
    ].sort());
    expect(listPathsOf(stateEl)).toEqual(["nodes", "nodes.*.nodes", "nodes.*.nodes.*.nodes"]);

    write(stateEl, (s: any) => { s.$setAll("nodes.*.nodes.*.nodes.*.value", [], 500); });
    await flush();

    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([511, 2]);
    host.remove();
  });
});
