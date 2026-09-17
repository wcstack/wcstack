/**
 * integration.stateGenerationReset.test.ts — 再セット（`setInitialState`）で「前の世代」が
 * 残る 2 つの機構を固定する（issue #258）。
 *
 *  - **世代スタンプ（X10）**: 絶対アドレスは (stateElement, pathInfo, listIndex) で intern され、
 *    state を差し替えても同一のままなので、getter のキャッシュ項目が世代を跨いで生き残っていた。
 *    キャッシュ項目に「載せた世代」を持たせ、世代の違う項目をヒット扱いにしないことで直す
 *    （cache/types.ts の `generation` / State の `stateGeneration`）。
 *  - **経路情報の作り直し（X7 の内部半分）**: セッタは `_listPaths` / `_elementPaths` / `_pathSet` を
 *    クリアするが、それらを登録したバインドは生き残る（再セットは DOM を作り直さない）。
 *    クリアのあと、生きているバインドぶんの `setPathInfo` をやり直して作り直す。前世代の再帰が
 *    生やした具体パスだけは除く — その除外は**世代を跨いで累積する**（State の `_generatedPaths`）。
 *
 * クリア自体は残す。あれには `forgetGeneration` が外した静的辺を「行が作り直されたときに
 * 登録し直させる」自己修復が乗っている（「静的な辺 nodes.* → nodes.*.total が戻る」と
 * 「行まるごと置換」の 2 本がその側）。
 *
 * #258 から切り出した 3 件の着地は末尾の 3 つの describe が固定する:
 *  - 再セットは確立済みのバインドを新しい世代で適用し直す（#267 — 契約の細部は
 *    integration.stateResetReapply.test.ts）。
 *  - 読み込み済みの `<wcs-state mount="…">` への再セットは throw する（#268 — 接ぎ木がルートの木へ
 *    複製しているので、入れ直してもページに届かない）。
 *  - 第 2 世代で消えたバインド先パスを診断する（#270 — 検査済みの印は世代に属する）。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import { flush, makeMount, node, read, write, writeError } from "./helpers/recursionTestUtils";
import { getPathInfo } from "../src/address/PathInfo";
import { getTreePath } from "../src/address/TreePath";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getStateListBaseline } from "../src/list/stateListBaseline";
import { getLastListValueByAbsoluteStateAddress } from "../src/list/lastListValueByAbsoluteStateAddress";
import { getScanRegistry } from "../src/scan/scanRegistry";
import { getActiveWatchStateElements } from "../src/watch/watchRegistry";

beforeAll(() => {
  bootstrapState();
});

const mount = makeMount("genreset-host");

/** 描画結果（テキスト）を並び順で読む。 */
const txt = (root: ParentNode, selector: string): (string | null)[] =>
  Array.from(root.querySelectorAll(selector)).map((element) => element.textContent);

/** ルートリストの絶対アドレス（差分基準の台帳を直接のぞくため）。 */
const absOf = (stateEl: State, path: string): any =>
  createAbsoluteStateAddress(getTreePath(stateEl as any, getPathInfo(path)), null);

/** 静的依存グラフの辺（source → targets）。 */
const edgesOf = (stateEl: State): [string, string[]][] =>
  Array.from((stateEl as any).staticDependency.entries()) as [string, string[]][];

/** 再帰レジストリが実体化済みの具体パス（遅延実体化の外からの覗き口）。 */
const materialized = (stateEl: State): string[] =>
  Array.from(((stateEl as any).recursionRegistry?.materializedPaths ?? []) as Iterable<string>).sort();

/** 合計の再帰 getter を持つ state。 */
const recursiveTotals = (nodes: any): any => {
  const state: any = { nodes, $recursion: { "nodes.*": "children.*" } };
  Object.defineProperty(state, "nodes.**.total", {
    get(this: any) {
      return this["nodes.**.value"] +
        this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
    },
    enumerable: true, configurable: true,
  });
  return state;
};

/** 深さ 2 の木（total は 77 / 70 / 8）。 */
const tree = (): any[] => [node(7, [node(70)]), node(8)];

/** 親行と子行の両方が生成パスを名指すページ（深い行バインドを含む）。 */
const DEEP_ROW_HTML =
  `<div><template data-wcs="for: nodes">` +
  `<span class="t" data-wcs="textContent: nodes.*.total"></span>` +
  `<template data-wcs="for: nodes.*.children">` +
  `<b class="c" data-wcs="textContent: nodes.*.children.*.total"></b></template>` +
  `</template></div>`;

// ---------------------------------------------------------------------------
// A: 世代スタンプ（X10）
// ---------------------------------------------------------------------------

describe("再セットの世代スタンプ: 旧世代のキャッシュ値をヒットさせない", () => {
  /** `sum` は `dep` で名指したリストだけを読む（世代で依存集合を変えられる形）。 */
  const summing = (dep: string, items: number[], values: number[]): any => {
    const state: any = { items, values };
    Object.defineProperty(state, "sum", {
      get(this: any) { return this[dep].reduce((a: number, b: number) => a + b, 0); },
      enumerable: true, configurable: true,
    });
    return state;
  };

  it("再セット前に読んだ wildcard 無しの getter が、新しい世代で評価し直される", async () => {
    const { host, stateEl } = await mount(summing("items", [1, 2], []));
    expect(read(stateEl, (s: any) => s.sum)).toBe(3);

    stateEl.setInitialState(summing("items", [5, 6], []));
    await flush();
    expect(read(stateEl, (s: any) => s.items)).toEqual([5, 6]);
    expect(read(stateEl, (s: any) => s.sum)).toBe(11); // 旧: 3（旧世代の dirty:false が返っていた）
    host.remove();
  });

  it("依存集合が変わる再セットでも、新しい getter の依存だけが効く", async () => {
    // 旧挙動の最悪形: キャッシュがヒットし続ける ＝ 新しい getter が一度も評価されないので、
    // 新世代の依存辺（`values` → `sum`）が張られず、旧世代の辺（`items` → `sum`）だけが残る。
    // 「本当の依存を書いても動かず、新 getter が読みもしないパスを書くと動く」誤った反応グラフ。
    const { host, stateEl } = await mount(summing("items", [1, 2], [100, 200]));
    expect(read(stateEl, (s: any) => s.sum)).toBe(3);

    stateEl.setInitialState(summing("values", [1, 2], [100, 200]));
    await flush();
    expect(read(stateEl, (s: any) => s.sum)).toBe(300); // 旧: 3

    write(stateEl, (s: any) => { s.values = [1, 1]; });
    await flush();
    expect(read(stateEl, (s: any) => s.sum), "本当の依存を書けば追従する").toBe(2); // 旧: 3

    write(stateEl, (s: any) => { s.items = [1000, 2000]; });
    await flush();
    expect(read(stateEl, (s: any) => s.sum), "新 getter が読まないパスを書いても壊れない").toBe(2);
    host.remove();
  });

  it("同じ配列インスタンスを渡す再セットでも、行のキャッシュが世代で無効になる", async () => {
    // 別の配列なら ListIndex が鋳造し直されるので何も残らない。同じ配列を渡す形
    // （listIndexesByList は配列 identity がキー）だけが行のキャッシュを跨がせる。
    const rows = [{ n: 1 }, { n: 2 }];
    const make = (): any => {
      const state: any = { items: rows };
      Object.defineProperty(state, "items.*.double", {
        get(this: any) { return this["items.*.n"] * 2; },
        enumerable: true, configurable: true,
      });
      return state;
    };
    const { host, stateEl } = await mount(make());
    expect(read(stateEl, (s: any) => s.$getAll("items.*.n", []))).toEqual([1, 2]);
    expect(read(stateEl, (s: any) => s.$getAll("items.*.double", []))).toEqual([2, 4]);

    rows[0].n = 91;
    rows[1].n = 92;
    stateEl.setInitialState(make());
    await flush();
    expect(read(stateEl, (s: any) => s.$getAll("items.*.n", []))).toEqual([91, 92]);       // 旧: [1, 2]
    expect(read(stateEl, (s: any) => s.$getAll("items.*.double", []))).toEqual([182, 184]); // 旧: [2, 4]
    host.remove();
  });

  it("連鎖した getter は再セット直後から正しい（書き込みを待たない）", async () => {
    const chained = (base: number): any => {
      const state: any = { base };
      Object.defineProperty(state, "a", { get(this: any) { return this.base * 2; }, enumerable: true, configurable: true });
      Object.defineProperty(state, "b", { get(this: any) { return this.a + 1; }, enumerable: true, configurable: true });
      return state;
    };
    const { host, stateEl } = await mount(chained(5));
    expect(read(stateEl, (s: any) => [s.base, s.a, s.b])).toEqual([5, 10, 11]);

    stateEl.setInitialState(chained(25));
    await flush();
    expect(read(stateEl, (s: any) => [s.base, s.a, s.b])).toEqual([25, 50, 51]); // 旧: [25, 10, 11]
    host.remove();
  });

  it("対照: 再セット前に一度も読んでいない getter は従来どおり正しい", async () => {
    // 欠陥は「項目が存在すること」そのものだった（読んでいなければ項目が無いので正しかった）。
    const { host, stateEl } = await mount(summing("items", [1, 2], []));
    stateEl.setInitialState(summing("items", [5, 6], []));
    await flush();
    expect(read(stateEl, (s: any) => s.sum)).toBe(11);
    host.remove();
  });

  // 宣言の検証は世代更新を挟んで 2 群に割れる（実測）。`value` しか読まない 4 つは世代を進める
  // **前**に走り、`$on` / `$streams` / `$watch` は後に走る（位置の理由は `_state` セッタのコメント）。
  // 7 つの宣言ぜんぶを置く（`$on` は raise する 3 つの形ぜんぶ）。どれか 1 本で一般命題を書かない。
  // 群で共通なのは「世代が進んだか」と「どちらの `__state` が入っているか」だけ。throw の後に
  // 何が残るかは検証ごとに違うので、B 節の「throw した再セットが残す台帳」3 本が個別に固定する。

  /** 世代更新より前に走る検証と、その「確実に落ちる形」。 */
  const beforeGeneration: Array<[string, Record<string, unknown>]> = [
    ["$recursion（アンカーを 2 つ宣言）", { $recursion: { "a.*": "b.*", "c.*": "d.*" } }],
    ["$commandTokens（空文字の名前）", { $commandTokens: [""] }],
    ["$eventTokens（空文字の名前）", { $eventTokens: [""] }],
    ["$listKeys（要素パスの綴り）", { $listKeys: { "items.*": "id" } }],
  ];
  for (const [label, declaration] of beforeGeneration) {
    it(`${label} で throw する再セットは世代を進めない（要素は丸ごと旧世代に留まる）`, async () => {
      const { host, stateEl } = await mount(summing("items", [1, 2], []));
      expect(read(stateEl, (s: any) => s.sum)).toBe(3);
      const generation = stateEl.stateGeneration;

      expect(() => stateEl.setInitialState(
        Object.assign(summing("items", [5, 6], []), declaration),
      )).toThrow();
      expect(stateEl.stateGeneration, "世代は進まない").toBe(generation);
      expect(read(stateEl, (s: any) => s.items), "旧世代の state のまま").toEqual([1, 2]);
      expect(read(stateEl, (s: any) => s.sum), "旧世代の値がそのまま読める").toBe(3);

      // 正当な再セットは従来どおり進む
      stateEl.setInitialState(summing("items", [5, 6], []));
      await flush();
      expect(stateEl.stateGeneration).toBe(generation + 1);
      expect(read(stateEl, (s: any) => s.sum)).toBe(11);
      host.remove();
    });
  }

  /** 世代更新より後に走る検証と、その「確実に落ちる形」。 */
  const afterGeneration: Array<[string, Record<string, unknown>]> = [
    ["$on（オブジェクトでない）", { $on: 1 }],
    ["$on（$eventTokens に無い名前）", { $on: { nope: () => {} } }],
    ["$on（ハンドラが関数でない）", { $eventTokens: ["tok"], $on: { tok: 1 } }],
    ["$streams（source が関数でない）", { $streams: { s: { source: 1 } } }],
    ["$watch（ハンドラが関数でない）", { $watch: { items: 1 } }],
  ];
  for (const [label, declaration] of afterGeneration) {
    it(`${label} で throw する再セットは、世代が進んだ後に落ちる（新しい state が入ったまま）`, async () => {
      // 「直っていない」ではなく、実際の着地を書き留めるテスト。この 3 つが世代更新より後に
      // 走る理由は `_state` セッタのコメント。
      const { host, stateEl } = await mount(summing("items", [1, 2], []));
      expect(read(stateEl, (s: any) => s.sum)).toBe(3);
      const generation = stateEl.stateGeneration;

      expect(() => stateEl.setInitialState(
        Object.assign(summing("items", [5, 6], []), declaration),
      )).toThrow();
      expect(stateEl.stateGeneration, "世代は進んでいる").toBe(generation + 1);
      expect(read(stateEl, (s: any) => s.items), "新しい state が入っている").toEqual([5, 6]);
      expect(read(stateEl, (s: any) => s.sum), "読みも新しい世代で評価される").toBe(11);
      host.remove();
    });
  }

  it("再セットは世代だけを進め、version は動かさない", async () => {
    // 世代は `version`（更新サイクルの番号）の流用ではない。増える条件が違うことを固定する。
    const { host, stateEl } = await mount(summing("items", [1, 2], []));
    const version = stateEl.version;
    const generation = stateEl.stateGeneration;

    stateEl.setInitialState(summing("items", [5, 6], []));
    await flush();
    expect(stateEl.stateGeneration, "世代は進む").toBe(generation + 1);
    expect(stateEl.version, "更新サイクルの番号は動かない").toBe(version);
    host.remove();
  });

  // 後の 2 つ（`$streams` / `$watch`）が世代更新より後に要る理由。どちらも「新しい value /
  // 新しい `__state` を見る」という形で観測できる（`_state` セッタのコメントの対応物）。

  it("$streams の衝突検査は新しい value の getter を見る（旧 state だけの getter とは衝突しない）", async () => {
    const withGetter = (): any => {
      const state: any = { items: [{ name: "a" }] };
      Object.defineProperty(state, "foo", { get() { return 1; }, enumerable: true, configurable: true });
      return state;
    };
    const withStream = (): any => ({
      items: [{ name: "b" }],
      $streams: { foo: { source: async function* () { yield 1; } } },
    });
    const { host, stateEl } = await mount(withGetter());

    expect(() => stateEl.setInitialState(withStream())).not.toThrow();
    await flush();
    host.remove();
  });

  it("$watch の存在検査は新しい __state を見る（新 state にだけあるパスは missing にならない）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, stateEl } = await mount({ a: { deep: 1 } });
      stateEl.setInitialState({ a: { deep: 1 }, b: { deep: 2 }, $watch: { "b.deep": () => {} } } as any);
      await flush();
      await flush();
      expect(warn.mock.calls.map((args) => String(args[0])).join(" | "))
        .not.toContain("wcs/watch-path-missing");
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// B: 経路情報の作り直し（X7 の内部半分）
// ---------------------------------------------------------------------------

const ROW_HTML =
  `<div><template data-wcs="for: items">` +
  `<span class="u" data-wcs="textContent: items.*.upper"></span></template></div>`;

/** 行 getter を持つリスト state（`items.*.upper` は行の派生値）。 */
const rowGetterState = (names: string[]): any => {
  const state: any = { items: names.map((name) => ({ name })) };
  Object.defineProperty(state, "items.*.upper", {
    get(this: any) { return String(this["items.*.name"]).toUpperCase(); },
    enumerable: true, configurable: true,
  });
  return state;
};

describe("再セット後の経路情報: 生きているバインドぶんを登録し直す", () => {
  it("行 getter のページで、再セット後の全リスト書き込みが throw せず行が追従する（2 回目も）", async () => {
    // 旧挙動: `_listPaths` が空のまま残るので依存ウォークが `items.*` を「リストではない
    // パス」として辿り、`Cannot expand dynamic dependency…` で恒久的に落ちる。しかも値と
    // DOM は書かれるので、診断だけが壊れたまま自己回復しなかった。
    const { host, shadowRoot, stateEl } = await mount(rowGetterState(["a", "b"]), ROW_HTML);
    expect(txt(shadowRoot, ".u")).toEqual(["A", "B"]);

    stateEl.setInitialState(rowGetterState(["x", "y"]));
    await flush();

    expect(writeError(stateEl, (s: any) => { s.items = [{ name: "p" }, { name: "q" }]; })).toBe("");
    await flush();
    expect(txt(shadowRoot, ".u")).toEqual(["P", "Q"]);

    expect(writeError(stateEl, (s: any) => { s.$resolve("items.*.name", [0], "leaf"); })).toBe("");
    await flush();
    expect(txt(shadowRoot, ".u")).toEqual(["LEAF", "Q"]);

    // 2 回目も落ちない（残骸が無い）
    expect(writeError(stateEl, (s: any) => { s.items = [{ name: "r" }, { name: "s" }]; })).toBe("");
    await flush();
    expect(txt(shadowRoot, ".u")).toEqual(["R", "S"]);
    expect(read(stateEl, (s: any) => s.$getAll("items.*.upper", []))).toEqual(["R", "S"]);
    host.remove();
  });

  it("再セット直後に listPaths / elementPaths / pathSet が作り直されている", async () => {
    // 機構そのものの固定。旧挙動ではこの 3 つが空のままだった（静的辺だけが残る非対称）。
    const { host, stateEl } = await mount(rowGetterState(["a", "b"]), ROW_HTML);
    expect(Array.from((stateEl as any).listPaths)).toEqual(["items"]);

    stateEl.setInitialState(rowGetterState(["x", "y"]));
    await flush();
    expect(Array.from((stateEl as any).listPaths)).toEqual(["items"]);         // 旧: []
    expect(Array.from((stateEl as any).elementPaths)).toEqual(["items.*"]);    // 旧: []
    expect(Array.from((stateEl as any)._pathSet).sort()).toEqual(["items", "items.*.upper"]); // 旧: []
    host.remove();
  });

  // 宣言の検証が throw したとき、台帳に何が残るかは検証ごとに違う（A 節の 2 群で共通なのは
  // 世代と `__state` だけ）。3 つの位置 — クリアより前・クリアと作り直しの間・作り直しより後 —
  // から 1 本ずつ取って固定する。

  it("throw した再セットが残す台帳（1）$listKeys: 世代更新の前に落ちるので、第 1 世代の台帳がそのまま残る", async () => {
    const { host, stateEl } = await mount(rowGetterState(["a", "b"]), ROW_HTML);

    expect(() => stateEl.setInitialState(
      Object.assign(rowGetterState(["x", "y"]), { $listKeys: { "items.*": "id" } }),
    )).toThrow();
    expect(Array.from((stateEl as any).listPaths), "クリアまで届いていない").toEqual(["items"]);
    expect(read(stateEl, (s: any) => s.$getAll("items.*.name", [])), "旧世代の state のまま")
      .toEqual(["a", "b"]);
    // main は新しい state を入れた後に落ちるので、ここは ["x", "y"] で台帳は空だった
    expect(writeError(stateEl, (s: any) => { s.items = [{ name: "p" }, { name: "q" }]; })).toBe("");
    await flush();
    expect(read(stateEl, (s: any) => s.$getAll("items.*.upper", []))).toEqual(["P", "Q"]);
    host.remove();
  });

  it("throw した再セットが残す台帳（2）$streams: クリアと作り直しの間に落ちるので、台帳は空のまま残る", async () => {
    const { host, stateEl } = await mount(rowGetterState(["a", "b"]), ROW_HTML);

    expect(() => stateEl.setInitialState(
      Object.assign(rowGetterState(["x", "y"]), { $streams: { s: { source: 1 } } }),
    )).toThrow();
    expect(Array.from((stateEl as any).listPaths), "クリアされたまま").toEqual([]);
    expect(Array.from((stateEl as any).elementPaths)).toEqual([]);
    expect(Array.from((stateEl as any)._pathSet)).toEqual([]);
    expect(read(stateEl, (s: any) => s.$getAll("items.*.name", [])), "新しい state は入っている")
      .toEqual(["x", "y"]);
    // 台帳が空なので、その後の全リスト書き込みは依存ウォークで落ちる（main と同じ着地）
    expect(writeError(stateEl, (s: any) => { s.items = [{ name: "p" }, { name: "q" }]; }))
      .toContain("Cannot expand dynamic dependency with wildcard for non-list address: items.*");
    host.remove();
  });

  it("throw した再セットが残す台帳（3）$watch: 作り直しより後に落ちるので、台帳は作り直されている", async () => {
    const { host, stateEl } = await mount(rowGetterState(["a", "b"]), ROW_HTML);

    expect(() => stateEl.setInitialState(
      Object.assign(rowGetterState(["x", "y"]), { $watch: { items: 1 } }),
    )).toThrow();
    expect(Array.from((stateEl as any).listPaths), "作り直し済み").toEqual(["items"]);
    expect(Array.from((stateEl as any).elementPaths)).toEqual(["items.*"]);
    expect(read(stateEl, (s: any) => s.$getAll("items.*.name", [])), "新しい state が入っている")
      .toEqual(["x", "y"]);
    // main では台帳が空のままなので、この書き込みは（2）と同じ形で throw していた
    expect(writeError(stateEl, (s: any) => { s.items = [{ name: "p" }, { name: "q" }]; })).toBe("");
    await flush();
    expect(read(stateEl, (s: any) => s.$getAll("items.*.upper", []))).toEqual(["P", "Q"]);
    host.remove();
  });

  // `$scan` は検査が世代更新より前、registry の作り直しが `processWatchDeclaration` の直前にある。
  // 世代更新より後の 3 つで落ちたとき、残る宣言と発火対象はその位置で割れる — `$on` / `$streams` は
  // 作り直しより前（旧宣言が発火対象のまま残る）、`$watch` は後（新宣言だが発火対象から外れる）。
  // どちらも畳まない。挙動は変えずに、何が残るかを 1 本ずつ固定する。
  const scanResidue: Array<[string, Record<string, unknown>, string, boolean]> = [
    ["$on（$eventTokens に無い名前）", { $on: { nope: () => {} } }, "a", true],
    ["$streams（source が関数でない）", { $streams: { s: { source: 1 } } }, "a", true],
    ["$watch（ハンドラが関数でない）", { $watch: { n: 1 } }, "b", false],
  ];
  for (const [label, declaration, registered, active] of scanResidue) {
    it(`throw した再セットが残す $scan: ${label}`, async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const foldA = vi.fn((acc: number) => acc + 1);
        const foldB = vi.fn((acc: number) => acc + 1);
        const { host, stateEl } = await mount({ n: 0, $scan: { a: { from: "n", initial: 0, fold: foldA } } });

        expect(() => stateEl.setInitialState(
          { n: 0, $scan: { b: { from: "n", initial: 0, fold: foldB } }, ...declaration } as any,
        )).toThrow();
        expect([...getScanRegistry(stateEl as any)!.entries].map((entry) => entry.name), "残る宣言").toEqual([registered]);
        expect(getActiveWatchStateElements().has(stateEl as any), "発火対象か").toBe(active);
        expect((stateEl as any).__state.b, "新しい宣言の出力は実体化済み").toBe(0);

        errorSpy.mockClear();
        write(stateEl, (s: any) => { s.n = 1; });
        await flush();
        expect(foldA).not.toHaveBeenCalled();
        expect(foldB).not.toHaveBeenCalled();
        // 旧宣言が発火対象に残る形は、新しい state に無い旧出力を読めずに報告する（fold の失敗とは分ける）
        const messages = errorSpy.mock.calls.map((call) => String(call[0]));
        expect(messages.some((m) => m.includes(`$scan could not read the output "a"`))).toBe(active);
        expect(messages.some((m) => m.includes(`$scan fold for "a" threw`))).toBe(false);
        host.remove();
      } finally {
        errorSpy.mockRestore();
      }
    });
  }

  it("再セット後の全リスト書き込みが $watch のハンドラまで届く（1 行に 1 回）", async () => {
    // 作り直しが連れてくる挙動変化。main では台帳が空で、この書き込みが依存ウォークで throw する
    // ＝ ハンドラは 0 回だった（実測）。ここでは 2 行ぶん 2 回発火する。
    const calls: Array<[unknown, unknown, number[]]> = [];
    const watched = (names: string[]): any => {
      const state = rowGetterState(names);
      state.$watch = {
        "items.*.name": (cur: unknown, prev: unknown, ...indexes: number[]) => {
          calls.push([cur, prev, indexes]);
        },
      };
      return state;
    };
    const { host, stateEl } = await mount(watched(["a", "b"]), ROW_HTML);
    await flush();
    calls.length = 0;

    stateEl.setInitialState(watched(["x", "y"]));
    await flush();
    expect(calls, "再セットそのものでは発火しない").toEqual([]);

    expect(writeError(stateEl, (s: any) => { s.items = [{ name: "p" }, { name: "q" }]; })).toBe("");
    await flush();
    expect(calls).toStrictEqual([["p", undefined, [0]], ["q", undefined, [1]]]);
    host.remove();
  });

  it("`for` で登録したリストパスは `$watch` の prop 登録に上書きされない（2 回目の再セットでも）", async () => {
    // 台帳は「いちど `for` で登録されたパスを `for` のまま保つ」（State.setPathInfo）。`$watch` の
    // 登録（`setPathInfo(path, "prop", "watch")`）は作り直しより後に走るので、保たなければ
    // 2 回目の再セットで `items` が prop として作り直され、listPaths が空になる。
    const watchedList = (names: string[]): any => {
      const state = rowGetterState(names);
      state.$watch = { items: () => {} };
      return state;
    };
    const { host, stateEl } = await mount(watchedList(["a", "b"]), ROW_HTML);

    stateEl.setInitialState(watchedList(["x", "y"]));
    await flush();
    stateEl.setInitialState(watchedList(["v", "w"]));
    await flush();
    expect(Array.from((stateEl as any).listPaths)).toEqual(["items"]);
    expect(Array.from((stateEl as any).elementPaths)).toEqual(["items.*"]);

    expect(writeError(stateEl, (s: any) => { s.items = [{ name: "p" }, { name: "q" }]; })).toBe("");
    await flush();
    expect(read(stateEl, (s: any) => s.$getAll("items.*.upper", []))).toEqual(["P", "Q"]);
    host.remove();
  });

  it("再帰: 再セット＋全リスト書き込みのあと、静的な辺 nodes.* → nodes.*.total が戻る", async () => {
    // 前世代の生成アクセサ（`nodes.*.total`）を指す辺は `forgetGeneration` が外す。行バインドが
    // 名指していても作り直しの対象から外す — 新しい世代ではまだ実体化されていないため。
    // 辺は「行が作り直されたとき」に BindingSession の setPathInfo が張り直す（自己修復）。
    const recursive = (nodes: any): any => {
      const state: any = { nodes, $recursion: { "nodes.*": "children.*" } };
      Object.defineProperty(state, "nodes.**.total", {
        get(this: any) {
          return this["nodes.**.value"] +
            this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
        },
        enumerable: true, configurable: true,
      });
      return state;
    };
    const html =
      `<div><template data-wcs="for: nodes">` +
      `<span class="t" data-wcs="textContent: nodes.*.total"></span></template></div>`;
    const { host, shadowRoot, stateEl } = await mount(recursive([node(7, [node(70)]), node(8)]), html);
    expect(txt(shadowRoot, ".t")).toEqual(["77", "8"]);

    // 作り直しそのものを見るため、適用し直し（#267 — その読みが実体化して辺を戻す）を再接続まで遅らせる
    stateEl.remove();
    stateEl.setInitialState(recursive([node(7, [node(70)]), node(8)]));
    const afterReset = new Map(edgesOf(stateEl));
    expect(afterReset.get("nodes.*") ?? [], "実体化前に辺を張り直さない").not.toContain("nodes.*.total");
    expect(afterReset.get("nodes"), "アンカーのリスト辺は残る").toEqual(["nodes.*"]);

    shadowRoot.appendChild(stateEl);
    await flush();
    expect(txt(shadowRoot, ".t")).toEqual(["77", "8"]);
    expect(new Map(edgesOf(stateEl)).get("nodes.*"), "適用し直しの読みが実体化して辺が戻る").toContain("nodes.*.total");

    expect(writeError(stateEl, (s: any) => { s.nodes = [node(11, [node(110)]), node(12)]; })).toBe("");
    await flush();
    expect(txt(shadowRoot, ".t")).toEqual(["121", "12"]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([121, 12]);
    const afterWrite = new Map(edgesOf(stateEl));
    expect(afterWrite.get("nodes.*"), "行が作り直されて辺が戻る").toContain("nodes.*.total");
    expect(afterWrite.get("nodes.*.children.*")).toContain("nodes.*.children.*.total");
    host.remove();
  });

  it("生成パスの除外は世代を跨いで持続する: 読みを挟まない 3 連続の再セットで静的辺が戻らない", async () => {
    // 除外は世代を跨いで累積する（State の `_generatedPaths`）。読みを挟まない 2 回目・3 回目の
    // 再セットでも、生成アクセサの具体パスを指す静的辺（`nodes.*` → `nodes.*.total` と深い行の
    // `nodes.*.children.*` → `…children.*.total`）は戻らない。
    const { host, shadowRoot, stateEl } = await mount(recursiveTotals(tree()), DEEP_ROW_HTML);
    expect(txt(shadowRoot, ".t")).toEqual(["77", "8"]);
    expect(txt(shadowRoot, ".c")).toEqual(["70"]);

    // 読みを挟まない形は、適用し直し（#267 — その読みが実体化する）を再接続まで遅らせて作る
    stateEl.remove();
    for (let i = 1; i <= 3; i++) {
      stateEl.setInitialState(recursiveTotals(tree()));
      const edges = new Map(edgesOf(stateEl));
      expect(materialized(stateEl), `${i} 回目: まだ何も実体化していない`).toEqual([]);
      expect(edges.get("nodes.*") ?? [], `${i} 回目`).not.toContain("nodes.*.total");
      expect(edges.get("nodes.*.children.*") ?? [], `${i} 回目（深い行）`).not.toContain("nodes.*.children.*.total");
      expect(edges.get("nodes") ?? [], `${i} 回目: アンカーのリスト辺は残る`).toContain("nodes.*");
    }

    // 再接続の適用し直しが読んで実体化し、辺が戻る
    shadowRoot.appendChild(stateEl);
    await flush();
    expect(txt(shadowRoot, ".t")).toEqual(["77", "8"]);
    expect(txt(shadowRoot, ".c")).toEqual(["70"]);
    expect(new Map(edgesOf(stateEl)).get("nodes.*")).toContain("nodes.*.total");

    // 除外したままでも自己修復する: 行が作り直されれば辺は戻り、表示も集計も追従する
    expect(writeError(stateEl, (s: any) => { s.nodes = [node(11, [node(110)]), node(12)]; })).toBe("");
    await flush();
    expect(txt(shadowRoot, ".t")).toEqual(["121", "12"]);
    expect(txt(shadowRoot, ".c")).toEqual(["110"]);
    expect(new Map(edgesOf(stateEl)).get("nodes.*")).toContain("nodes.*.total");
    host.remove();
  });

  it("読みを挟む 3 連続の再セットでは、実体化のたびに辺が戻る（除外は実体化を邪魔しない）", async () => {
    const { host, stateEl } = await mount(recursiveTotals(tree()), DEEP_ROW_HTML);
    for (let i = 1; i <= 3; i++) {
      stateEl.setInitialState(recursiveTotals(tree()));
      await flush();
      expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", [])), `${i} 回目`).toEqual([77, 8]);
      const edges = new Map(edgesOf(stateEl));
      expect(edges.get("nodes.*"), `${i} 回目`).toContain("nodes.*.total");
      expect(edges.get("nodes.*.children.*"), `${i} 回目（深い行）`).toContain("nodes.*.children.*.total");
      expect(materialized(stateEl), `${i} 回目`).toEqual(["nodes.*.children.*.total", "nodes.*.total"]);
    }
    host.remove();
  });

  it("再セット後に行をまるごと置換しても、表示が state と一致する（#4）", async () => {
    // 旧: 再セット直後の台帳は走査を経ていない cold な状態で、この $resolve は別の既知欠陥
    // （「ListIndexes not found」）で拒否された（拒否されたぶん DOM も動かず、乖離もしなかった）。
    // いまは再セットの適用し直し（#267）が行を走査するので台帳があり、置換そのものは通る。
    const recursive = (nodes: any): any => {
      const state: any = { nodes, $recursion: { "nodes.*": "children.*" } };
      Object.defineProperty(state, "nodes.**.total", {
        get(this: any) {
          return this["nodes.**.value"] +
            this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
        },
        enumerable: true, configurable: true,
      });
      return state;
    };
    const html =
      `<div><template data-wcs="for: nodes">` +
      `<span class="t" data-wcs="textContent: nodes.*.total"></span></template></div>`;
    const { host, shadowRoot, stateEl } = await mount(recursive([node(7, [node(70)]), node(8)]), html);
    stateEl.setInitialState(recursive([node(7, [node(70)]), node(8)]));
    await flush();

    const error = writeError(stateEl, (s: any) => { s.$resolve("nodes.*", [0], node(9, [node(90)])); });
    await flush();
    expect(error).toBe(""); // 旧: "ListIndexes not found"（走査を経ていない cold な $resolve）
    // 旧: ["97", "8"]（#4 — 代入値を書き込み前の listIndex のキャッシュに固定し、台帳には新しい
    // listIndex を入れていたので、束ねていない `nodes.*.value` の古いキャッシュ 7 と新しい子の集計 90 を
    // 足していた）。#4 の修理で、置き換えた行は新しい値で描き直される。
    expect(txt(shadowRoot, ".t")).toEqual(["99", "8"]);
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.total", []))).toEqual([99, 8]);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// リスト差分の基準（世代を跨いで残る台帳）
// ---------------------------------------------------------------------------

describe("再セットとリスト差分の基準: 第 1 世代の配列が残っても無害であること", () => {
  const ITEMS_HTML =
    `<div><template data-wcs="for: items">` +
    `<i class="r" data-wcs="textContent: items.*.n"></i></template></div>`;

  it("描画しているリストでは、再セットの適用し直しが描画側と state 側の基準を新しい配列へ進める", async () => {
    // 旧: 再セットは基準に触れず、第 1 世代の配列を握ったまま最初の構造書き込みを迎えた（書き込みで
    // 上書きされ、結果は正しかった）。いまは適用し直し（#267）の走査と `for` の描画が新しい配列を観測する。
    const first = [{ n: 1 }, { n: 2 }];
    const { host, shadowRoot, stateEl } = await mount({ items: first }, ITEMS_HTML);
    const second = [{ n: 9 }, { n: 8 }, { n: 7 }];

    stateEl.setInitialState({ items: second });
    const address = absOf(stateEl, "items");
    expect(getStateListBaseline(address)).toBe(second as any);
    expect(getLastListValueByAbsoluteStateAddress(address)).toBe(second as any);
    expect(txt(shadowRoot, ".r")).toEqual(["9", "8", "7"]);

    expect(writeError(stateEl, (s: any) => { s.items = [{ n: 5 }]; })).toBe("");
    await flush();
    expect(txt(shadowRoot, ".r")).toEqual(["5"]);
    expect(read(stateEl, (s: any) => s.$getAll("items.*.n", []))).toEqual([5]);
    host.remove();
  });

  it("バインドの無いリストでは基準が第 1 世代の配列のまま残るが、最初の構造書き込みで上書きされ結果は正しい", async () => {
    // `stateListBaseline` は絶対アドレスがキーなので、世代を跨いで第 1 世代の配列インスタンスを
    // 握り続ける（世代印は付けていない）。適用し直しが辿るのは依存グラフの辺で、バインドの無い
    // リストには辺が無いので、ここでは基準が残る。害が出るのは「基準が実体とずれたまま diff を取る」
    // ときなので、再セット直後に一度も読まずに構造書き込みする最悪順序で固定する。
    const first = [{ n: 1 }, { n: 2 }];
    const { host, stateEl } = await mount({ items: first });
    expect(read(stateEl, (s: any) => s.$getAll("items.*.n", []))).toEqual([1, 2]);

    stateEl.setInitialState({ items: [{ n: 9 }, { n: 8 }, { n: 7 }] });
    const address = absOf(stateEl, "items");
    expect(getStateListBaseline(address), "第 1 世代の配列のまま").toBe(first as any);

    // 読まずに（＝基準を更新しないまま）長さの違う構造書き込み
    expect(writeError(stateEl, (s: any) => { s.items = [{ n: 5 }]; })).toBe("");
    await flush();
    expect(read(stateEl, (s: any) => s.$getAll("items.*.n", []))).toEqual([5]);
    expect(getStateListBaseline(address), "書き込みで新しい値に入れ替わる").not.toBe(first as any);
    host.remove();
  });

  it("入れ子リスト: 再セット後の構造書き込みと集計が DOM まで一致する", async () => {
    // 基準の台帳そのものの説明は stateListBaseline.ts のヘッダ。2 段のリストと
    // 2 段の集計で、再セット後の全置換・葉の書き込み・子リスト差し替えを順に通す。
    const nested = (rows: number[][]): any => {
      const state: any = { groups: rows.map((ns) => ({ items: ns.map((n) => ({ n })) })) };
      Object.defineProperty(state, "groups.*.sum", {
        get(this: any) { return this.$getAll("groups.*.items.*.n").reduce((a: number, b: number) => a + b, 0); },
        enumerable: true, configurable: true,
      });
      Object.defineProperty(state, "total", {
        get(this: any) { return this.$getAll("groups.*.sum", []).reduce((a: number, b: number) => a + b, 0); },
        enumerable: true, configurable: true,
      });
      return state;
    };
    const html =
      `<div><template data-wcs="for: groups"><b class="g" data-wcs="textContent: groups.*.sum"></b>` +
      `<template data-wcs="for: groups.*.items">` +
      `<i class="i" data-wcs="textContent: groups.*.items.*.n"></i></template></template></div>`;
    const { host, shadowRoot, stateEl } = await mount(nested([[1, 2], [3]]), html);
    expect(txt(shadowRoot, ".g")).toEqual(["3", "3"]);
    expect(read(stateEl, (s: any) => s.total)).toBe(6);

    stateEl.setInitialState(nested([[10, 20], [30]]));
    await flush();

    expect(writeError(stateEl, (s: any) => {
      s.groups = [{ items: [{ n: 100 }, { n: 200 }] }, { items: [{ n: 300 }] }];
    })).toBe("");
    await flush();
    expect(txt(shadowRoot, ".g")).toEqual(["300", "300"]);
    expect(txt(shadowRoot, ".i")).toEqual(["100", "200", "300"]);
    expect(read(stateEl, (s: any) => s.total)).toBe(600); // 旧: 6（全リスト書き込みが throw して集計が止まる）

    expect(writeError(stateEl, (s: any) => { s.$resolve("groups.*.items.*.n", [0, 0], 999); })).toBe("");
    await flush();
    expect(txt(shadowRoot, ".g")).toEqual(["1199", "300"]);
    expect(read(stateEl, (s: any) => s.total)).toBe(1499);

    expect(writeError(stateEl, (s: any) => { s.$resolve("groups.*.items", [1], [{ n: 1 }, { n: 2 }]); })).toBe("");
    await flush();
    expect(txt(shadowRoot, ".g")).toEqual(["1199", "3"]);
    expect(txt(shadowRoot, ".i")).toEqual(["999", "200", "1", "2"]);
    expect(read(stateEl, (s: any) => s.total)).toBe(1202);
    host.remove();
  });
});

// ---------------------------------------------------------------------------
// #258 から切り出した 3 件の着地（#267 / #268 / #270）
// ---------------------------------------------------------------------------

describe("再セットはバインドを適用し直す（#267）", () => {
  // 旧挙動: 確立済みのバインドは一度も適用し直されず、画面は第 1 世代のテキストのまま残った
  // （読みだけが新しい世代）。契約の細部は integration.stateResetReapply.test.ts が固定する。
  it("スカラー・getter・for のいずれも新しい世代で描画され、読みと一致する", async () => {
    const page = (title: string, ns: number[]): any => {
      const state: any = { title, items: ns.map((n) => ({ n })) };
      Object.defineProperty(state, "upper", {
        get(this: any) { return String(this.title).toUpperCase(); },
        enumerable: true, configurable: true,
      });
      return state;
    };
    const html =
      `<div><span id="t" data-wcs="textContent: title"></span>` +
      `<span id="u" data-wcs="textContent: upper"></span>` +
      `<template data-wcs="for: items"><i class="r" data-wcs="textContent: items.*.n"></i></template></div>`;
    const { host, shadowRoot, stateEl } = await mount(page("a", [1, 2]), html);
    expect(shadowRoot.querySelector("#t")!.textContent).toBe("a");
    expect(shadowRoot.querySelector("#u")!.textContent).toBe("A");
    expect(txt(shadowRoot, ".r")).toEqual(["1", "2"]);

    stateEl.setInitialState(page("b", [9, 8]));

    // 適用し直しは setInitialState の中で同期に済む（drain を待たない）
    expect(shadowRoot.querySelector("#t")!.textContent).toBe("b");  // 旧: "a"
    expect(shadowRoot.querySelector("#u")!.textContent).toBe("B");  // 旧: "A"
    expect(txt(shadowRoot, ".r")).toEqual(["9", "8"]);              // 旧: ["1", "2"]
    expect(read(stateEl, (s: any) => [s.title, s.upper, s.$getAll("items.*.n", [])]))
      .toEqual(["b", "B", [9, 8]]);
    host.remove();
  });
});

describe("読み込み済みのボリュームへの再セットは拒否する（#268）", () => {
  // 旧挙動: ボリューム要素のセッタまでは届く（要素自身の読みだけが新しくなる）が、接ぎ木はロード
  // 完了時に一度だけルートの木へデータを複製するので、ルートの木も DOM も第 1 世代のまま、例外も
  // 警告も出なかった。接ぎ木し直すにはボリュームを外す経路が要る（未対応）ので、拒否する。
  let volumeSeq = 0;
  const volumeState = (lang: string, title: string): any => ({
    lang,
    dict: { en: { title }, ja: { title } },
    get t() { return (this as any).dict[(this as any).lang]; },
  });

  /** ボリューム `i18n` を API でロードし、ルートは `rootJson` から読むページ。 */
  const mountVolumePage = async (rootJson: string, bindings: string): Promise<{
    host: HTMLElement; shadowRoot: ShadowRoot; volumeEl: State; rootEl: State;
  }> => {
    const host = document.createElement(`genreset-vol-${volumeSeq++}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state mount="i18n"></wcs-state>` +
      `<wcs-state json='${rootJson}'></wcs-state>` +
      bindings;
    document.body.appendChild(host);
    const volumeEl = shadowRoot.querySelector("wcs-state[mount]") as State;
    const rootEl = shadowRoot.querySelector("wcs-state:not([mount])") as State;
    volumeEl.setInitialState(volumeState("en", "Hello"));
    await rootEl.connectedCallbackPromise;
    await volumeEl.connectedCallbackPromise;
    await (rootEl.constructor as typeof State).getBindingsReady(shadowRoot);
    await flush();
    await flush();
    return { host, shadowRoot, volumeEl, rootEl };
  };

  it("setInitialState は throw し、ルートの木も画面も変えない（案内どおりルートへ書けば届く）", async () => {
    const { host, shadowRoot, volumeEl, rootEl } = await mountVolumePage(
      `{"count":1}`,
      `<h1 id="title" data-wcs="textContent: i18n.t.title"></h1><p id="lang" data-wcs="textContent: i18n.lang"></p>`,
    );
    expect(shadowRoot.querySelector("#title")!.textContent).toBe("Hello");
    expect(shadowRoot.querySelector("#lang")!.textContent).toBe("en");

    expect(() => volumeEl.setInitialState(volumeState("ja", "第二世代")))
      .toThrow(`Cannot replace the state of <wcs-state mount="i18n"> after it has loaded`);
    await flush();
    expect(shadowRoot.querySelector("#title")!.textContent).toBe("Hello");
    expect(shadowRoot.querySelector("#lang")!.textContent).toBe("en");
    expect(read(rootEl, (s: any) => s.i18n.lang), "ルートの木は第 1 世代のまま").toBe("en");

    // 文言が案内する差し替え方: ルートの木のマウントパスの下へ書く
    write(rootEl, (s: any) => { s["i18n.lang"] = "ja"; });
    await flush();
    expect(shadowRoot.querySelector("#lang")!.textContent).toBe("ja");
    host.remove();
  });

  it("接ぎ木に失敗したボリューム（ルートのキーと衝突）への setInitialState も throw する", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { host, volumeEl, rootEl } = await mountVolumePage(`{"i18n":1}`, "");
      expect(errorSpy.mock.calls.map((args) => String(args[0])).join(" | "))
        .toContain(`volume "i18n" failed to graft`);
      expect(() => volumeEl.setInitialState(volumeState("ja", "x")))
        .toThrow(`Cannot replace the state of <wcs-state mount="i18n"> after it has loaded`);
      expect(read(rootEl, (s: any) => s.i18n)).toBe(1);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("再セットで消えたバインド先パスを診断する（#270）", () => {
  // 旧挙動: `checkDeclaredPath` の「要素ごと・パスごとに 1 回」の印を世代をまたいで持ち越したので、
  // 第 1 世代で検査済みのパスが第 2 世代の state から消えても無言だった。印は世代に属する
  // （pathDiagnostics.ts の `resetPathDiagnostics`）。
  const reports = (spy: { mock: { calls: unknown[][] } }, code: string): string[] =>
    spy.mock.calls.map((args) => String(args[0])).filter((message) => message.includes(code));
  const USER_NAME = `<div><span data-wcs="textContent: user.name"></span></div>`;

  it("第 2 世代で消えた user.name を報告する（綴りの候補つき）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, stateEl } = await mount({ user: { name: "a" } }, USER_NAME);
      await flush();
      expect(reports(warn, "wcs/binding-path-missing")).toEqual([]);

      stateEl.setInitialState({ user: { nmae: "b" } } as any);
      await flush();
      const found = reports(warn, "wcs/binding-path-missing");
      expect(found).toHaveLength(1); // 旧: 0
      expect(found[0]).toContain(`Bound path "user.name"`);
      expect(found[0]).toContain(`"nmae"`);
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });

  it("第 2 世代にも在るパスは報告しない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, stateEl } = await mount({ user: { name: "a" } }, USER_NAME);
      stateEl.setInitialState({ user: { name: "b" } });
      await flush();
      expect(reports(warn, "wcs/binding-path-missing")).toEqual([]);
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });

  it("同じ誤りは 1 世代に 1 回（同じ世代の書き込みでは繰り返さず、世代が進めばもう 1 回）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, stateEl } = await mount({ user: { nmae: "a" } }, USER_NAME);
      await flush();
      expect(reports(warn, "wcs/binding-path-missing")).toHaveLength(1);

      write(stateEl, (s: any) => { s["user.nmae"] = "x"; });
      await flush();
      write(stateEl, (s: any) => { s["user.nmae"] = "y"; });
      await flush();
      expect(reports(warn, "wcs/binding-path-missing"), "同じ世代では繰り返さない").toHaveLength(1);

      stateEl.setInitialState({ user: { nmae: "b" } });
      await flush();
      expect(reports(warn, "wcs/binding-path-missing"), "世代が進めばもう 1 回").toHaveLength(2);
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });

  it("前の世代の $watch から外したパスは報告しない（今の世代の $watch は報告する）", async () => {
    // 作り直しは台帳にある登録を全部やり直すが、`$watch` の登録は前の世代の宣言の残骸でもある。
    // 検査までやり直すと、新しい宣言から外したパスを missing と誤って報告する。
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, stateEl } = await mount({ a: { deep: 1 }, $watch: { "a.deep": () => {} } });
      await flush();
      stateEl.setInitialState({ b: 1 } as any);
      await flush();
      expect(reports(warn, "wcs/watch-path-missing"), "外した a.deep は報告しない").toEqual([]);

      stateEl.setInitialState({ c: {}, $watch: { "c.nope": () => {} } } as any);
      await flush();
      const found = reports(warn, "wcs/watch-path-missing");
      expect(found).toHaveLength(1);
      expect(found[0]).toContain(`"c.nope"`);
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });

  it("両方の世代で宣言し続けた $watch / $scan のパスが新しい state で消えたら報告する", async () => {
    // 作り直しが前の世代の宣言の登録まで `_pathSet` に入れると、今の世代の宣言の登録が素通りして
    // 検査されない（新しく作った要素なら報告される形が、再セットでは無言になっていた）
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const declarations = (): any => ({
        $watch: { "a.deep": () => {} },
        $scan: { count: { from: "n", initial: 0, fold: (acc: number) => acc + 1 } },
      });
      const { host, stateEl } = await mount({ a: { deep: 1 }, n: 0, ...declarations() });
      await flush();
      expect(reports(warn, "wcs/watch-path-missing")).toEqual([]);
      expect(reports(warn, "wcs/scan-path-missing")).toEqual([]);

      stateEl.setInitialState({ a: {}, m: 0, ...declarations() });
      await flush();
      expect(reports(warn, "wcs/watch-path-missing")).toHaveLength(1);
      expect(reports(warn, "wcs/scan-path-missing")).toHaveLength(1);
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });

  it("前の世代で判定した遅延中の報告は、入れ直しで捨てて新しい世代で判定し直す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { host, stateEl } = await mount({ user: { name: "a" } }, USER_NAME);
      await flush();
      stateEl.setInitialState({ user: {} });           // user.name が消える → 報告は遅延中
      stateEl.setInitialState({ user: { name: "c" } }); // マクロタスクを待たずに戻す
      await flush();
      expect(reports(warn, "wcs/binding-path-missing")).toEqual([]);
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });
});
