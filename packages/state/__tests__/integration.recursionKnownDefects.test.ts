/**
 * integration.recursionKnownDefects.test.ts — 再帰パス（docs/state-recursive-path-design.md）
 * の Phase A 実測で見つかった欠陥の台帳。
 *
 * このファイルには **2 種類の it** が混ざっている。混同しないこと。
 *  - **修理済み（契約）**: Phase A' の E1〜E3 で挙動が正しくなったもの。assert は
 *    正しい値を期待し、`// Fixed by E<n> … — was: <元の誤った値>` の英語コメントで
 *    元の誤った値を残してある。将来の回帰で「何に戻ったか」が読めるようにするため。
 *  - **現状固定（characterization）**: まだ直していないもの。assert は **誤った現状の値**
 *    を期待しており、直前の `DEFECT:` コメントが「本来どうあるべきか」を書いてある。
 *    修正が入ったらここが赤くなるのが正常で、緑を保つために期待値を緩めてはならない。
 *
 * 修理済み（Phase A' / コミット時点）:
 *  1. **E1 — 描画なしのルートリストの世代分裂**。差分基準 `lastListValueByAbsoluteStateAddress`
 *     が apply（描画）経路からしか書かれず、`for` の無いルートリストへの構造書き込みで
 *     ListIndex 台帳の世代が分裂して集計が恒久 stale／恒久 throw になっていた。state 側の
 *     基準（src/list/stateListBaseline.ts）を新設し、読み・描画・依存ウォークで共有する。
 *  3a. **E2 — 深さ超過の誤告発**。MAX_LOOP_DEPTH=128 超過が、循環の無い直線の木でも
 *     「Possible circular dependency」になっていた。末尾 8 段の重複有無で分岐し、
 *     重複が無ければ `[wcs/getter-depth-exceeded]` にする。**本物の循環では従来どおり
 *     循環を名指しする**ことを別の it で固定してある（分岐が片側へ退化していない担保）。
 *  3b. **E3 — `$129` の無言 undefined**。`$` + 数字の表引き失敗を `[wcs/index-param-range]`
 *     で raiseError する。
 *
 * 現状固定のまま残っている欠陥:
 *  1'. 欠陥1 の describe に 3 箇所残る（いずれも `DEFECT:` コメント付き）。
 *      (i) in-place push 後の `[...arr]` 再代入（in-place 変異規範の側）、
 *      (ii) ネストしたリストへの構造書き込み直後の cold な `$resolve`、
 *      (iii) describe 末尾の it に **埋め込まれた** `(1')`＝走査を一度も経ていない
 *      cold な `$resolve`（it 全体は緑なので、独立した it を数えると見落とす）。
 *      (ii)(iii) はどちらも「$resolve だけが走査の第 1 相を持たない」（Phase A の A1）で、
 *      E1 とは別の契約。
 *  2. 同じ配列インスタンスが 2 つ以上の親から到達可能（DAG・循環・同一リスト内の
 *     重複）だと、台帳（src/list/listIndexesByList.ts）が配列インスタンスだけを
 *     キーにしているため ListIndex が先着の親に別名化し、無言で誤る（E6 で修理予定）。
 *  4. createState("readonly") の中で $setAll / $resolve(set) が readonly ガードを
 *     素通りして実データを書き換える（ガードは StateHandler の set トラップにしかない。X1）。
 *  5. 遅延実体化（defineTreeAccessor）で、そのパスを読んだ後に getter を生やしても
 *     undefined が dirty:false でキャッシュに固定されたまま直らない。加えて、
 *     リストを実体化するアクセサを生の defineProperty で入れると（getterPaths 外＝
 *     非キャッシュになり）cold 走査そのものが落ちる（E4/E5 で修理予定）。
 *  6. 描画ありでも 1 クラスだけ取りこぼす。in-place の深い変異を構造変化と同じ代入に
 *     混ぜると、集計 getter は再評価されるのに葉の値パスのキャッシュだけが dirty 化
 *     されず、縮約エッジでルート集計まで古い値が伝播する。in-place の arr.reverse()
 *     も描画ありで行と子サブツリーを分離させる。
 *
 * 【偶然の救済に注意】Phase A で実際に結論が反転した罠が 4 つあり、このファイルでは
 * それぞれ意図的に「露出する側」の書き方を選んでいる。書き換えるときは崩さないこと。
 *  (a) 構造変更と書き込みの間に集計を読むかどうかで結果が変わっていた（E1 の修理で
 *      読みの有無に関わらず正しくなった。両方の綴りを別の it として残してある）。
 *  (b) $setAll の定数ブロードキャストは同値ガードで二重適用を隠す（mapper で書くと露出）。
 *  (c) getter を通さない平パスの $getAll / $resolve は描画なしでも正しかった（欠陥は
 *      getter に渡る文脈 ListIndex の側にあった）。E1 の修理後は両者が一致することを固定する。
 *  (d) 木が浅すぎる（孫が無い）と、反転後に行 getter がキャッシュヒットして一度も
 *      評価されず、$1 の証拠テストが「空の seen」で無言に緑になる。深さ 3 が要る。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { flush, makeMount, node, read, write } from "./helpers/recursionTestUtils";
import { getListIndexesByList } from "../src/list/listIndexesByList";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const mount = makeMount("recdefect-host");

const NODE = node;
const baseAt = (d: number) => "nodes.*" + ".children.*".repeat(d);

/**
 * 再帰集計 `total = 自分の value + 直下の子の total` を深さ `depth` まで手で展開する。
 * 内側の $getAll は添字を **省略** する（文脈束縛 = 直下の子だけを畳む）。`[]` を渡すと
 * 全深さ合併になって孫を二重計上するので、書き分けを変えてはならない。
 */
function unrollTotals(state: any, depth: number): any {
  for (let d = 0; d <= depth; d++) {
    const base = baseAt(d);
    Object.defineProperty(state, base + ".total", {
      get(this: any) {
        const kids = this.$getAll(base + ".children.*.total");
        return this[base + ".value"] + kids.reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true,
      configurable: true,
    });
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

/** 深さ d の行 total を全件読む（getter を経由する読み） */
const totalsAt = (stateEl: State, d: number) =>
  read(stateEl, (s: any) => s.$getAll(baseAt(d) + ".total", []));
/** getter を経由しない素の値の読み（対照用） */
const valuesAt = (stateEl: State, d: number) =>
  read(stateEl, (s: any) => s.$getAll(baseAt(d) + ".value", []));

const FOR_ROOT =
  `<div><template data-wcs="for: nodes">` +
  `<span class="t0" data-wcs="textContent: nodes.*.total"></span>` +
  `</template></div>`;

// ---------------------------------------------------------------------------

// E1 で修理済みの describe。ただし末尾 2 本（in-place push の再代入 / cold な $resolve）
// だけは別原因なので現状固定のまま残してある（`DEFECT:` コメントが付いている方）。
describe("欠陥1（E1 修理済み）: 描画なしのルートリストでも構造書き込みが集計に追従する", () => {
  /** 2 行 × 子 1 個。行 total は [11, 22] */
  const twoRoots = () =>
    unrollTotals({ nodes: [NODE(1, [NODE(10)]), NODE(2, [NODE(20)])] }, 2);
  /** 3 行 × 子 1 個。行 total は [11, 22, 44] */
  const threeRoots = () =>
    unrollTotals({
      nodes: [NODE(1, [NODE(10)]), NODE(2, [NODE(20)]), NODE(4, [NODE(40)])],
    }, 2);
  /** 左右対称の 3 段木。行 total は [111, 222] */
  const symmetricTree = () =>
    unrollTotals({
      nodes: [
        NODE(1, [NODE(10, [NODE(100)])]),
        NODE(2, [NODE(20, [NODE(200)])]),
      ],
    }, 2);

  // 【偶然の救済(a)】並べ替えた世代で集計キャッシュを確定させる中間の読みが、修理前は
  // 破損の必要条件だった（この 1 行を省くと結果が正しくなってしまっていた）。修理後は
  // 読みの有無で結果が変わらないことが契約なので、この読みを消してはならない
  // ── 次の it が「読まない綴り」を担当し、2 本で一致を固定している。
  it("ルートリストを並べ替えたあと、子への書き込みが行の集計に届く", async () => {
    const { stateEl } = await mount(twoRoots());
    expect(totalsAt(stateEl, 0)).toEqual([11, 22]);

    write(stateEl, (s: any) => { const a = s.nodes; s.nodes = [a[1], a[0]]; });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([22, 11]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [1, 0], 2000); });
    await flush();

    expect(totalsAt(stateEl, 1)).toEqual([20, 2000]); // 深さ 1 は修理前から正しかった
    // Fixed by E1 (state-side list baseline) — was: [22, 11]（恒久 stale）
    expect(totalsAt(stateEl, 0)).toEqual([22, 2001]);
    // Fixed by E1 — was: 33
    expect(read(stateEl, (s: any) => s.grandTotal)).toBe(2023);

    // 2 回目の書き込みも同じように届く（1 回目だけの偶然ではない）
    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [1, 0], 3000); });
    await flush();
    expect(totalsAt(stateEl, 1)).toEqual([20, 3000]);
    // Fixed by E1 — was: [22, 11]（恒久 stale）
    expect(totalsAt(stateEl, 0)).toEqual([22, 3001]);
  });

  // 【偶然の救済(a) の対照】上の it から中間の読みを 1 行抜いた綴り。修理前はこちらだけが
  // 正しい値になっていた（破損の必要条件は「並べ替えた世代で集計キャッシュを確定させる
  // こと」であって書き込みそのものではなかった）。いまは 2 本とも [22, 2001] で、
  // 読みの有無が結果を変えないことをこの対で固定する。
  it("対照: 並べ替えと書き込みの間に集計を読まなくても、同じ書き込みが正しく届く", async () => {
    const { stateEl } = await mount(twoRoots());
    expect(totalsAt(stateEl, 0)).toEqual([11, 22]);

    write(stateEl, (s: any) => { const a = s.nodes; s.nodes = [a[1], a[0]]; });
    await flush();
    // ここで読まない

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [1, 0], 2000); });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([22, 2001]);
  });

  // 末尾追加は既存行に影響しない。行 0 の子を 111 にしたら d0 は [112,22,44,88] になる。
  it("ルートリストへ 1 件追加したあと、既存行の子への書き込みが集計に届く", async () => {
    const { stateEl } = await mount(threeRoots());
    expect(totalsAt(stateEl, 0)).toEqual([11, 22, 44]);

    write(stateEl, (s: any) => { s.nodes = [...s.nodes, NODE(8, [NODE(80)])]; });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([11, 22, 44, 88]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [0, 0], 111); });
    await flush();
    expect(totalsAt(stateEl, 1)).toEqual([111, 20, 40, 80]); // 深さ 1 は修理前から正しかった
    // Fixed by E1 (state-side list baseline) — was: [11, 22, 44, 88]（行 0 が恒久 stale）
    expect(totalsAt(stateEl, 0)).toEqual([112, 22, 44, 88]);
  });

  // 修理前は孤児化した親 ListIndex の .index が新しいリスト長を超え、
  // collectWildcardIndexes の `listIndexes[index] ?? raiseError` に落ちていた。
  it("ルートリストから末尾以外を削除しても、以後の集計読みが残った行を正しく返す", async () => {
    const { stateEl } = await mount(threeRoots());
    expect(totalsAt(stateEl, 0)).toEqual([11, 22, 44]);

    write(stateEl, (s: any) => { const a = s.nodes; s.nodes = [a[0], a[2]]; }); // 中央を削除
    await flush();

    // Fixed by E1 (state-side list baseline)
    //   — was: throw "[@wcstack/state] ListIndex not found at index 2 of nodes"（恒久）
    expect(totalsAt(stateEl, 0)).toEqual([11, 44]);
    // 読み直しても同じ（一度きりの偶然ではない）
    expect(totalsAt(stateEl, 0)).toEqual([11, 44]);
  });

  // 対照。修理前は「末尾削除だけが throw しない」という非対称があった（孤児の .index が
  // 範囲内に残るため）。いまは削除位置に関わらず throw しないので、上の it との対で
  // 「位置に依存しない」ことを固定する。
  it("対照: 末尾削除（pop 相当）も同じ手順で正しく追従する", async () => {
    const { stateEl } = await mount(threeRoots());
    expect(totalsAt(stateEl, 0)).toEqual([11, 22, 44]);

    write(stateEl, (s: any) => { const a = s.nodes; s.nodes = [a[0], a[1]]; });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([11, 22]);
  });

  // 対照。for を 1 本置いた同じ操作。修理前はこちら（描画あり）だけが正しく、描画なしは
  // throw していた。いまは上の 2 本と値が一致する ── 集計が描画に依存しないことの固定。
  it("対照: ルートリストに for を 1 本置いても、描画なしとまったく同じ結果になる", async () => {
    const { stateEl } = await mount(threeRoots(), FOR_ROOT);
    expect(totalsAt(stateEl, 0)).toEqual([11, 22, 44]);

    write(stateEl, (s: any) => { const a = s.nodes; s.nodes = [a[0], a[2]]; });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([11, 44]); // 描画なしの同じ操作（上の it）と同値

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.value", [1, 0], 444); });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([11, 448]);
  });

  // DEFECT: in-place push は既知の非対応（in-place 変異規範）だが、公式に推奨される
  //         リフレッシュイディオム `s.items = [...arr]` が「唯一効かない形」になっている。
  //         差分基準が push で変異した *同じ配列* なので createListDiff の isSameList が
  //         真になり、空だった頃の台帳がそのまま新配列へ引き継がれる。
  //         should be: [...arr] 再代入の後は [11, 2]。
  it("空 children に in-place push したあと [...arr] で再代入しても回復しない", async () => {
    const { stateEl } = await mount(unrollTotals({ nodes: [NODE(1), NODE(2)] }, 2));
    expect(totalsAt(stateEl, 0)).toEqual([1, 2]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children", [0]).push(NODE(10)); });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([1, 2]); // in-place 変異は観測されない（既知の規範）

    write(stateEl, (s: any) => {
      const arr = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [...arr]);
    });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([1, 2]); // should be: [11, 2]
  });

  // 対照: 最初から新しい配列を代入すれば追従する。上のイディオムだけが効かないことの証明。
  it("対照: 最初から [...arr, NODE] で代入すれば空 children への追加は反映される", async () => {
    const { stateEl } = await mount(unrollTotals({ nodes: [NODE(1), NODE(2)] }, 2));
    expect(totalsAt(stateEl, 0)).toEqual([1, 2]);

    write(stateEl, (s: any) => {
      const arr = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [...arr, NODE(10)]);
    });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([11, 2]);
  });

  // 修理前は行自身の value だけが追従し、子サブツリーの集計が反転前の位置に残っていた
  // （122 = 2 + 120、211 = 1 + 210）。
  it("ルートリストの反転で、行の集計も子サブツリーごと入れ替わる", async () => {
    const { stateEl } = await mount(symmetricTree());
    expect(totalsAt(stateEl, 0)).toEqual([111, 222]);

    write(stateEl, (s: any) => { s.nodes = [...s.nodes].reverse(); });
    await flush();
    // Fixed by E1 (state-side list baseline) — was: [122, 211]（子サブツリーだけ旧世代）
    expect(totalsAt(stateEl, 0)).toEqual([222, 111]);
  });

  // 【偶然の救済(c)】欠陥があったのは「getter に渡る文脈 ListIndex」の側だけで、走査
  // そのもの（生データ・平パスの $getAll）は破損状態でも全段正しかった。ここを見て
  // 「値も壊れている」と誤読すると修理の対象を取り違えるし、逆にここだけ見て「値は
  // 正しい」と結論しても取り違える。契約は **両者が一致すること** なので、getter 経由と
  // 非経由を同じ it で突き合わせて固定する。
  it("反転後、getter 経由の集計と getter を通さない値の読みが一致する", async () => {
    const initial = symmetricTree();
    const { stateEl } = await mount(initial);
    expect(totalsAt(stateEl, 0)).toEqual([111, 222]);

    write(stateEl, (s: any) => { s.nodes = [...s.nodes].reverse(); });
    await flush();

    // 生データと平パスの読みは修理前から正しく、いまも同じ
    expect(initial.nodes.map((n: any) => n.value)).toEqual([2, 1]);
    expect(valuesAt(stateEl, 0)).toEqual([2, 1]);
    expect(valuesAt(stateEl, 1)).toEqual([20, 10]);
    expect(valuesAt(stateEl, 2)).toEqual([200, 100]);

    // Fixed by E1 (state-side list baseline) — was: [122, 211]（値と食い違っていた）
    // 各段の集計が、上の平パスの値から手で畳んだ結果と一致する
    expect(totalsAt(stateEl, 2)).toEqual([200, 100]);
    expect(totalsAt(stateEl, 1)).toEqual([20 + 200, 10 + 100]);
    expect(totalsAt(stateEl, 0)).toEqual([2 + 20 + 200, 1 + 10 + 100]);
  });

  // 【偶然の救済(c) の裏】修理前は warm の仕方で結論が変わっていた ── getter で warm
  // すると壊れ、同じ全段を平パスで warm すると壊れなかった（平パス warm は動的依存
  // エッジを 1 本も登録しないので walkDependency が新配列を鋳造しなかった）。いまは
  // どちらの warm でも同じ値になるので、上の it との対で warm 経路非依存を固定する。
  it("対照: 平パスで warm してから反転しても、getter で warm した場合と同じ集計になる", async () => {
    const { stateEl } = await mount(symmetricTree());
    // getter を一度も評価せずに全段の台帳を作る
    expect(valuesAt(stateEl, 2)).toEqual([100, 200]);

    write(stateEl, (s: any) => { s.nodes = [...s.nodes].reverse(); });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([222, 111]); // getter warm（上の it）と同値
  });

  // 修理前は添字タプルが「最初に getter で読んだときの世代」に固定され、反転のたびに
  // 正誤が入れ替わっていた。
  it("反転を繰り返しても集計が振動せず、毎回その世代の正しい値を返す", async () => {
    const { stateEl } = await mount(symmetricTree());
    const seen: number[][] = [totalsAt(stateEl, 0)];
    for (let i = 0; i < 4; i++) {
      write(stateEl, (s: any) => { s.nodes = [...s.nodes].reverse(); });
      await flush();
      seen.push(totalsAt(stateEl, 0));
    }
    // Fixed by E1 (state-side list baseline)
    //   — was: [[111,222],[122,211],[111,222],[122,211],[111,222]]（1 回おきに誤る）
    expect(seen).toEqual([
      [111, 222], [222, 111], [111, 222], [222, 111], [111, 222],
    ]);
  });

  // これは欠陥ではない対照。ネストしたリスト（ワイルドカード親を持つリスト）は
  // 描画なしでも構造変更に追従する。修理でここを壊さないための回帰。
  it("対照: ネストしたリスト（nodes.*.children）の削除・並べ替えは描画なしでも追従する", async () => {
    const { stateEl } = await mount(unrollTotals({
      nodes: [NODE(1, [NODE(10, [NODE(100)]), NODE(20, [NODE(200)]), NODE(40, [NODE(400)])])],
    }, 3));
    expect(totalsAt(stateEl, 0)).toEqual([771]);

    write(stateEl, (s: any) => {
      const a = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [a[0], a[2]]); // 中央を削除
    });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([551]);

    write(stateEl, (s: any) => {
      const a = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [a[1], a[0]]); // 並べ替え
    });
    await flush();
    expect(totalsAt(stateEl, 1)).toEqual([440, 110]);
  });

  // DEFECT: ネストしたリストへの構造書き込みの直後は、その新配列を誰も走査していない
  //         ので getListIndexByIndexes が台帳を引けずに throw する（引くだけで作らない）。
  //         走査を 1 回挟めば同じ書き込みが通る＝「書く前に走査する」を実装側が
  //         保証すべき。修理後は走査を挟まなくても通るべき。
  it("ネストしたリストへの構造書き込み直後、走査を挟まない $resolve が throw する", async () => {
    const { stateEl } = await mount(unrollTotals({
      nodes: [NODE(1, [NODE(10, [NODE(100)]), NODE(20, [NODE(200)])])],
    }, 3));
    expect(totalsAt(stateEl, 0)).toEqual([331]);

    let err: string | null = null;
    write(stateEl, (s: any) => {
      const a = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [a[1], a[0]]);
      try {
        s.$resolve("nodes.*.children.*.children.*.value", [0, 1, 0], 9000);
      } catch (e: any) { err = String(e && e.message); }
    });
    await flush();
    expect(err).toBe("[@wcstack/state] ListIndexes not found: nodes.*.children");

    // 走査（$getAll）を 1 回挟めば同じ書き込みが通る
    expect(totalsAt(stateEl, 1)).toEqual([220, 110]);
    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children.*.value", [0, 1, 0], 9000);
    });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([9231]);
  });
  // 壊れていたのは値ではなく「文脈から導かれる添字タプル」だったので、受け入れ試験と
  // しては集計値より $1 の方が鋭い（集計値は偶然一致しうる）。反転後、value 10 の子は
  // 行 1 に属するので、それを評価している getter は $1 = 1 を報告する。
  // 【偶然の救済(d)】木を 2 段（nodes.*.children まで）にすると、反転後に深さ 1 の
  // getter がキャッシュヒットして一度も評価されず seen が空になる＝何も測れない。
  // 3 段目（孫）を必ず持たせること。
  it("深さ 1 の getter の $1 が、反転後の行位置を報告する", async () => {
    const seen: { $1: number; value: number }[] = [];
    const state: any = {
      nodes: [NODE(1, [NODE(10, [NODE(100)])]), NODE(2, [NODE(20, [NODE(200)])])],
    };
    Object.defineProperty(state, "nodes.*.total", {
      get(this: any) {
        return this["nodes.*.value"] +
          this.$getAll("nodes.*.children.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    Object.defineProperty(state, "nodes.*.children.*.total", {
      get(this: any) {
        seen.push({ $1: this.$1, value: this["nodes.*.children.*.value"] });
        return this["nodes.*.children.*.value"] +
          this.$getAll("nodes.*.children.*.children.*.total")
            .reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    Object.defineProperty(state, "nodes.*.children.*.children.*.total", {
      get(this: any) { return this["nodes.*.children.*.children.*.value"]; },
      enumerable: true, configurable: true,
    });
    const { stateEl } = await mount(state);

    // cold な走査では位置から添字を組み立てるので正しい
    read(stateEl, (s: any) => s.$getAll("nodes.*.total", []));
    expect(seen).toEqual([{ $1: 0, value: 10 }, { $1: 1, value: 20 }]);

    seen.length = 0;
    write(stateEl, (s: any) => { s.nodes = [...s.nodes].reverse(); });
    await flush();
    read(stateEl, (s: any) => s.$getAll("nodes.*.total", []));

    // 反転後、value 10 の子は index 1 の行に属し、$1 もそう報告する
    expect(seen.length, "getter が再評価されていること（seen が空だと何も測れていない）")
      .toBeGreaterThan(0);
    // Fixed by E1 (state-side list baseline) — was: { $1: 0, value: 10 }（旧世代の行位置）
    expect(seen).toContainEqual({ $1: 1, value: 10 });
    expect(seen).not.toContainEqual({ $1: 0, value: 10 });
    // もう一方の子（value 20）も反転後の行 0 を報告する
    expect(seen).toContainEqual({ $1: 0, value: 20 });
  });

  // prerequisites 側の「ルートリストに for が 1 本あれば深さ 3 の木の 3 種の構造変更が
  // 全段追従する」（integration.recursionPrerequisites.test.ts）の裏。修理前は、その
  // `for` を外すと同じ 3 ケースのうち 2 つが throw していた（＝あの 1 本の for は
  // 飾りではなかった）。いまは 3 ケースとも「for 1 本」と同じ値になる。
  // 唯一残る差は (1') の cold な `$resolve` で、これは E1 ではなく「$resolve だけが
  // 走査の第 1 相を持たない」（Phase A の A1）という別の契約 ── for があるときは初回描画が
  // その走査を代行していただけなので、走査を 1 回挟めば for 無しでも通る。
  it("同じ 3 ケースは for を外しても「for 1 本」と同じ結果になる（cold な $resolve だけが走査を 1 回要る）", async () => {
    const forest = () => unrollTotals({
      nodes: [NODE(1, [NODE(10, [NODE(100)]), NODE(20)]), NODE(2)],
    }, 2);
    const DEEP = "nodes.*.children.*.children.*.value";

    // (1) 深い葉の更新。走査を 1 回挟めば for 無しでも「for 1 本」と同じ 533 になる
    const a = await mount(forest());
    expect(read(a.stateEl, (s: any) => s.grandTotal)).toBe(133); // 走査して台帳を作る
    write(a.stateEl, (s: any) => { s.$resolve(DEEP, [0, 0, 0], 500); });
    await flush();
    expect(read(a.stateEl, (s: any) => s.grandTotal), "深い葉の更新").toBe(533);
    expect(totalsAt(a.stateEl, 0), "深い葉の更新").toEqual([531, 2]);

    // (1') DEFECT（E1 とは別原因・現状固定）: 走査を一度も経ていない cold な $resolve
    //      だけは、いまも for 無しで落ちる。should be: 走査を挟まなくても書ける。
    const cold = await mount(forest());
    let coldErr: string | null = null;
    write(cold.stateEl, (s: any) => {
      try { s.$resolve(DEEP, [0, 0, 0], 500); } catch (e: any) { coldErr = String(e && e.message); }
    });
    expect(coldErr).toBe("[@wcstack/state] ListIndexes not found: nodes");

    // (2) 行の移動
    const b = await mount(forest());
    expect(read(b.stateEl, (s: any) => s.grandTotal)).toBe(133);
    write(b.stateEl, (s: any) => { s.nodes = [...s.nodes].reverse(); });
    await flush();
    // Fixed by E1 (state-side list baseline)
    //   — was: throw "[@wcstack/state] ListIndex not found at index 0 of nodes.*.children"（恒久）
    expect(totalsAt(b.stateEl, 0), "行の移動").toEqual([2, 131]);
    expect(read(b.stateEl, (s: any) => s.grandTotal), "行の移動").toBe(133);

    // (3) 中間 children の差し替え（修理前から for 無しで通っていた 1 つ）
    const c = await mount(forest());
    expect(read(c.stateEl, (s: any) => s.grandTotal)).toBe(133);
    write(c.stateEl, (s: any) => { s["nodes.0.children"] = [NODE(33)]; });
    await flush();
    expect(read(c.stateEl, (s: any) => s.grandTotal), "中間 children の差し替え").toBe(36);
    expect(totalsAt(c.stateEl, 0), "中間 children の差し替え").toEqual([34, 2]);
  });

  // 同一バッチ内で同じリストへ 2 回構造書き込みすると、2 回目のウォークは
  // 「一度も描画されず直後に上書きされる中間値」を基準に diff を取っていた。中間値が
  // 落とした行の ListIndex が鋳造し直され、その行の子リスト台帳が恒久的に切れる。
  // 描画があれば applyChangeToFor が描画基準で引き直すので救われるが、描画なしの
  // ツリー（＝ E1 が対象にしている集団そのもの）では救いが無かった。
  // Fixed by E1 batching — was: 2 回目の $setAll が [1001,1002] のまま届かない
  it("中間値を挟むリスト再構築のあとでも、子への 2 回目の書き込みが集計に届く", async () => {
    const b = await mount(twoRoots());
    expect(totalsAt(b.stateEl, 0)).toEqual([11, 22]);

    write(b.stateEl, (s: any) => {
      const rows = s.nodes;
      s.nodes = [];                       // intermediate value: drops every row
      s.nodes = [rows[0], rows[1]];       // same row objects, new array
    });
    await flush();

    write(b.stateEl, (s: any) => { s.$setAll("nodes.*.children.*.value", [], 1000); });
    await flush();
    expect(totalsAt(b.stateEl, 0)).toEqual([1001, 1002]);

    write(b.stateEl, (s: any) => { s.$setAll("nodes.*.children.*.value", [], 2000); });
    await flush();
    expect(totalsAt(b.stateEl, 0)).toEqual([2001, 2002]);
  });

  // Fixed by E1 batching — was: [2001, 102]（行 0 だけ追従し行 1 が止まる半 stale）
  it("中間値が一部の行だけ残す形でも、行ごとに追従が分かれない", async () => {
    const b = await mount(twoRoots());
    expect(totalsAt(b.stateEl, 0)).toEqual([11, 22]);

    write(b.stateEl, (s: any) => {
      const rows = s.nodes;
      s.nodes = [rows[0]];                // intermediate value: drops row 1 only
      s.nodes = [rows[0], rows[1]];
    });
    await flush();

    write(b.stateEl, (s: any) => { s.$setAll("nodes.*.children.*.value", [], 2000); });
    await flush();
    expect(totalsAt(b.stateEl, 0)).toEqual([2001, 2002]);
  });
});

// ---------------------------------------------------------------------------

describe("欠陥2: 同じ配列インスタンスの共有（DAG・循環）が無言で誤る（現状の挙動を固定する / 修正時に反転させる）", () => {
  /** 2 親が同一の children 配列インスタンスを共有する木 */
  function sharedChildren() {
    const shared: any[] = [NODE(10), NODE(20)];
    const state: any = { nodes: [NODE(1, shared), NODE(2, shared)] };
    unrollTotals(state, 2);
    // 子スコープから親（ルート行）の value を読む getter。取り違えを露出させる唯一の形。
    Object.defineProperty(state, "nodes.*.children.*.rootValue", {
      get(this: any) { return this["nodes.*.value"]; },
      enumerable: true, configurable: true,
    });
    return { shared, state };
  }

  // DEFECT: rootValue は行ごとに [1,1,2,2] になるべき。台帳が配列インスタンスだけを
  //         キーにしていて親の同一性を表せないため、共有配列の ListIndex が
  //         「最初に走査した親」に別名化する。台帳キーを (配列, 親アドレス) に拡張する案は
  //         #256 で実測して却下した（1 スロットに絶対アドレスが 2 本でき、片方へ書いた値が
  //         もう片方から永久に見えなくなる）。再帰走査に共有ガード（wcs/recursion-shared-list
  //         相当）を新設したら反転する。
  it("共有した children 配列では、子スコープから親を読む getter が先着の親に別名化する", async () => {
    const { shared, state } = sharedChildren();
    const { stateEl } = await mount(state);

    const out = read(stateEl, (s: any) => ({
      leaf: s.$getAll("nodes.*.children.*.value", []),
      totals: s.$getAll("nodes.*.total", []),
      rootValue: s.$getAll("nodes.*.children.*.rootValue", []),
    }));

    // 件数・値・順序は「木として正しい」形をしている（実体は 2 スロットしかない）
    expect(out.leaf).toEqual([10, 20, 10, 20]);
    // 【偶然の救済】`自分の value + 子の total` という形の集計は、この取り違えに構造上
    // 免疫がある（親を読まない）。しかも共有した部分木が literally 同一なので二重に
    // 救われて正しく見える。この [31,32] を「集計は無事」の根拠に使ってはならない
    // ── 次の it が、親を読む集計は実際に誤ることを示す。
    expect(out.totals).toEqual([31, 32]);
    expect(out.rootValue).toEqual([1, 1, 1, 1]); // should be: [1, 1, 2, 2]

    // 台帳の親ポインタが nodes[0] の行に固定されている（nodes[1] にはならない）
    const nodeLedger = getListIndexesByList(state.nodes)!;
    const sharedLedger = getListIndexesByList(shared)!;
    expect(sharedLedger[0].parentListIndex).toBe(nodeLedger[0]);
    expect(sharedLedger[1].parentListIndex).toBe(nodeLedger[0]);
  });

  /** 親の value を掛ける行 getter と、その合計（＝親依存の集計）を持つ木 */
  function weightedFixture(share: boolean) {
    const kids = [NODE(10), NODE(20)];
    const state: any = {
      nodes: share
        ? [NODE(1, kids), NODE(2, kids)]
        : [NODE(1, [NODE(10), NODE(20)]), NODE(2, [NODE(10), NODE(20)])],
    };
    Object.defineProperty(state, "nodes.*.children.*.weighted", {
      get(this: any) { return this["nodes.*.value"] * this["nodes.*.children.*.value"]; },
      enumerable: true, configurable: true,
    });
    Object.defineProperty(state, "nodes.*.weightedTotal", {
      get(this: any) {
        return this.$getAll("nodes.*.children.*.weighted")
          .reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    return state;
  }
  const readWeighted = (stateEl: State) => read(stateEl, (s: any) => ({
    weighted: s.$getAll("nodes.*.children.*.weighted", []),
    weightedTotal: s.$getAll("nodes.*.weightedTotal", []),
  }));

  // DEFECT: 親を読む集計は集計値そのものが誤る。行 1 は親 value=2 なので
  //         weighted=[20,40] / weightedTotal=60 になるべきなのに、行 0 の文脈で
  //         評価されて 30 になる。上の it の [31,32] が「無事」に見えるのは
  //         集計の形が親を読まないからにすぎない、ということの直接証明。
  it("共有した children 配列では、親を読む集計そのものが誤る", async () => {
    const { stateEl } = await mount(weightedFixture(true));
    const out = readWeighted(stateEl);
    expect(out.weighted).toEqual([10, 20, 10, 20]);   // should be: [10, 20, 20, 40]
    expect(out.weightedTotal).toEqual([30, 30]);      // should be: [30, 60]
  });

  it("対照: 共有していない同形の木では親を読む集計が正しい", async () => {
    const { stateEl } = await mount(weightedFixture(false));
    const out = readWeighted(stateEl);
    expect(out.weighted).toEqual([10, 20, 20, 40]);
    expect(out.weightedTotal).toEqual([30, 60]);
  });

  // DEFECT: 描画は throw も警告もせず、黙って誤った値を表示する。
  //         「壊れるのは値解決であって DOM 生成ではない」は誤りで、親依存の行 getter を
  //         バインドすると DOM にそのまま漏れる。共有ガードを入れたら描画時点で
  //         診断が出るべき。
  it("共有した children 配列は、入れ子 for の描画にも誤った値が黙って出る", async () => {
    const NESTED_FOR =
      `<div><template data-wcs="for: nodes"><div class="n">` +
      `<b class="nv">{{ .value }}</b>` +
      `<template data-wcs="for: nodes.*.children"><i class="c">{{ .weighted }}</i></template>` +
      `</div></template></div>`;
    const rows = (sr: ShadowRoot) => Array.from(sr.querySelectorAll(".n")).map((n) =>
      n.querySelector(".nv")!.textContent + ":" +
      Array.from(n.querySelectorAll(".c")).map((c) => c.textContent).join(","));

    const shared = await mount(weightedFixture(true), NESTED_FOR);
    expect(rows(shared.shadowRoot)).toEqual(["1:10,20", "2:10,20"]); // should be: ["1:10,20","2:20,40"]

    const control = await mount(weightedFixture(false), NESTED_FOR);
    expect(rows(control.shadowRoot)).toEqual(["1:10,20", "2:20,40"]);
  });

  // DEFECT: 共有スロットへの $setAll は 1 スロットにつき 1 回だけ適用されるべき
  //         （[11,21]）。到達経路が 2 本あるため同じスロットへ 2 回書いている。
  //         共有ガードを入れれば 1 件も書かずに throw するようになる。
  // 【偶然の救済(b)】定数ブロードキャストで書くと同値ガードが 2 回目を握り潰し、
  // 「$setAll は共有下でも正しい」と誤結論する。必ず mapper で書くこと。
  it("共有した children 配列への $setAll(mapper) が同じスロットへ二重適用される", async () => {
    const { shared, state } = sharedChildren();
    const { stateEl } = await mount(state);

    let written = 0;
    write(stateEl, (s: any) => {
      written = s.$setAll("nodes.*.children.*.value", [], (cur: number) => cur + 1);
    });
    expect(written).toBe(4);                              // should be: 2（実体スロット数）
    expect(shared.map((c) => c.value)).toEqual([12, 22]); // should be: [11, 21]
  });

  // 対照。共有していない同形の木では mapper がスロットあたり 1 回だけ適用される。
  // この対照が無いと、上の [12,22] が「+1 を 2 スロットに配った正しい結果」に見える。
  it("対照: 共有していない同形の木では $setAll(mapper) は 1 回だけ適用される", async () => {
    const state: any = {
      nodes: [NODE(1, [NODE(10), NODE(20)]), NODE(2, [NODE(10), NODE(20)])],
    };
    const { stateEl } = await mount(state);

    let written = 0;
    write(stateEl, (s: any) => {
      written = s.$setAll("nodes.*.children.*.value", [], (cur: number) => cur + 1);
    });
    expect(written).toBe(4);
    expect(state.nodes.map((n: any) => n.children.map((c: any) => c.value)))
      .toEqual([[11, 21], [11, 21]]);
  });

  // DEFECT: 定数ブロードキャストは written を 4 と過大報告するが実体は 2 スロット。
  //         written は「書いたスロット数」を返すべき。ここは値だけを見ると正しく
  //         見えるので、欠陥が隠れる形そのものを固定しておく。
  it("共有配列への $setAll ブロードキャストは件数を過大報告する（値は正しく見える）", async () => {
    const { shared, state } = sharedChildren();
    const { stateEl } = await mount(state);

    let written = 0;
    write(stateEl, (s: any) => {
      written = s.$setAll("nodes.*.children.*.value", [], 99);
    });
    expect(written).toBe(4);                              // should be: 2
    expect(shared.map((c) => c.value)).toEqual([99, 99]); // 値は正しく見える（同値ガード）
  });

  // DEFECT: 循環データ（node.children が自分自身を含む）は「循環」を名指しする診断で
  //         止まるべき。実際には台帳の別名化で ListIndex 連鎖の長さが足りなくなり、
  //         まったく無関係な wcs/wildcard-rank（「for テンプレートで囲め」）が出る。
  //         この助言を信じたユーザーは絶対に原因に辿り着けない。
  //         専用診断（wcs/recursion-cycle 相当）を入れたらこの期待文字列を書き換える。
  it("循環データが「循環検出」ではなく wcs/wildcard-rank という無関係な文面で throw する", async () => {
    const n: any = NODE(1);
    n.children.push(n); // 自己循環
    const { stateEl } = await mount({ nodes: [n] });

    const out = read(stateEl, (s: any) => {
      const r: any = {
        d0: s.$getAll("nodes.*.value", []),
        d1: s.$getAll("nodes.*.children.*.value", []),
      };
      try {
        s.$getAll("nodes.*.children.*.children.*.value", []);
        r.d2 = "NO THROW";
      } catch (e: any) { r.d2 = String(e && e.message); }
      return r;
    });

    // 深さ 1 までは静かに通る。無限ループでもスタックオーバーフローでもない
    expect(out.d0).toEqual([1]);
    expect(out.d1).toEqual([1]);
    expect(out.d2).toContain("wcs/wildcard-rank");
    expect(out.d2).toContain('path "nodes.*"');
    expect(out.d2).not.toContain("circular"); // 循環を一言も名指ししない
  });

  // これは欠陥ではない対照。台帳のキーは配列であってオブジェクトではないので、
  // 共有されたノードが葉（children が空）なら文脈も件数も正しい。
  // 「DAG は全部だめ」ではなく「共有してよいのは葉ノードだけ」という境界を固定する。
  it("対照: children が空の同一ノードオブジェクトを 2 親が共有するのは正しく動く", async () => {
    const leaf: any = NODE(10);
    const state: any = { nodes: [NODE(1, [leaf]), NODE(2, [leaf])] };
    unrollTotals(state, 2);
    Object.defineProperty(state, "nodes.*.children.*.rootValue", {
      get(this: any) { return this["nodes.*.value"]; },
      enumerable: true, configurable: true,
    });
    const { stateEl } = await mount(state);

    const out = read(stateEl, (s: any) => ({
      leaf: s.$getAll("nodes.*.children.*.value", []),
      totals: s.$getAll("nodes.*.total", []),
      rootValue: s.$getAll("nodes.*.children.*.rootValue", []),
    }));
    expect(out.leaf).toEqual([10, 10]);
    expect(out.totals).toEqual([11, 12]);
    expect(out.rootValue).toEqual([1, 2]); // 文脈は正しい
    // 親配列が別インスタンスなので台帳も別
    const nodeLedger = getListIndexesByList(state.nodes)!;
    expect(getListIndexesByList(state.nodes[0].children))
      .not.toBe(getListIndexesByList(state.nodes[1].children));
  });

  // DEFECT: 共有ノードが children を持つと、親配列が別でも孫配列が必然的に共有になる。
  //         深さ 2 の rootValue は [1,2] になるべき。上の「葉なら安全」の裏返しで、
  //         入力契約を「葉ノードの共有だけ許す」と書く根拠になる。
  it("children を持つ同一ノードの共有は、孫配列が共有になって深さ 2 の文脈が壊れる", async () => {
    const gc: any = NODE(100);
    const shared: any = NODE(10, [gc]);
    const state: any = { nodes: [NODE(1, [shared]), NODE(2, [shared])] };
    unrollTotals(state, 3);
    for (const d of [1, 2]) {
      Object.defineProperty(state, baseAt(d) + ".rootValue", {
        get(this: any) { return this["nodes.*.value"]; },
        enumerable: true, configurable: true,
      });
    }
    const { stateEl } = await mount(state);

    const out = read(stateEl, (s: any) => ({
      d1: s.$getAll(baseAt(1) + ".rootValue", []),
      d2: s.$getAll(baseAt(2) + ".rootValue", []),
    }));
    expect(out.d1).toEqual([1, 2]); // 深さ 1（children 配列は別）は正しい
    expect(out.d2).toEqual([1, 1]); // should be: [1, 2]
  });

  // DEFECT: 循環の輪が 2 段（root -> kid -> root）でも、自己循環と同じく無限ループにも
  //         スタックオーバーフローにも MAX_LOOP_DEPTH 到達にもならず、無関係な
  //         wcs/wildcard-rank で止まる。「循環は深さ上限で検出される」ではないことの固定。
  //         専用診断（wcs/recursion-cycle 相当）を入れたらこの期待文字列を書き換える。
  it("2 段の輪も、深さ上限ではなく wcs/wildcard-rank で止まる", async () => {
    const root: any = NODE(1);
    const kid: any = NODE(2, [root]);
    root.children.push(kid);            // root -> kid -> root
    const state: any = { nodes: [root] };
    unrollTotals(state, 4);             // 深さ 4 まで手で展開しておく
    const { stateEl } = await mount(state);

    let msg = "NO THROW";
    read(stateEl, (s: any) => {
      try { s.$getAll("nodes.*.total", []); } catch (e: any) { msg = String(e && e.message); }
    });
    expect(msg).toContain("wcs/wildcard-rank");
    expect(msg).not.toContain("circular");
    expect(msg).not.toContain("Exceeded maximum address stack depth");
  });

  // DEFECT: 同じ配列が深さ 1 と深さ 2 の両方から到達できる（異深度共有）と、深い側の
  //         走査が両方 throw する。理由は台帳の別名化で ListIndex 連鎖の段数が足りなく
  //         なることで、やはり wcs/wildcard-rank という無関係な文面になる。
  //         唯一の救いは $setAll が 1 件も書かないこと（部分適用は起きない）。
  //         共有ガードを入れたら「共有を名指しする診断」に変わるべき。
  it("異深度共有（同じ配列が深さ 1 と深さ 2 から到達可能）では深い側の走査が throw し、$setAll は 1 件も書かない", async () => {
    const build = () => {
      const deep: any[] = [NODE(7)];
      // nodes[0].children（深さ 1）と nodes[1].children[0].children（深さ 2）が同一配列
      return { deep, state: { nodes: [NODE(1, deep), NODE(2, [NODE(3, deep)])] } as any };
    };

    // 浅い側は通る
    const a = build();
    const shallow = await mount(a.state);
    expect(read(shallow.stateEl, (s: any) => s.$getAll("nodes.*.children.*.value", [])))
      .toEqual([7, 3]);

    // 読み → 書きの順
    const b = build();
    const rw = await mount(b.state);
    const readFirst = read(rw.stateEl, (s: any) => {
      try { return { ok: s.$getAll("nodes.*.children.*.children.*.value", []) }; }
      catch (e: any) { return { err: String(e && e.message) }; }
    });
    expect(readFirst.err).toContain("wcs/wildcard-rank");
    let writeErr: string | null = null;
    write(rw.stateEl, (s: any) => {
      try { s.$setAll("nodes.*.children.*.children.*.value", [], 42); }
      catch (e: any) { writeErr = String(e && e.message); }
    });
    expect(writeErr).toContain("wcs/wildcard-rank");
    expect(b.deep[0].value).toBe(7);   // 書き込み 0 件（部分適用は無い）

    // 書き → 読みの順でも同じ（順序に依存しない）
    const c = build();
    const wr = await mount(c.state);
    let writeErr2: string | null = null;
    write(wr.stateEl, (s: any) => {
      try { s.$setAll("nodes.*.children.*.children.*.value", [], 42); }
      catch (e: any) { writeErr2 = String(e && e.message); }
    });
    expect(writeErr2).toContain("wcs/wildcard-rank");
    expect(c.deep[0].value).toBe(7);
  });

  // DEFECT: 共有は「別の親どうし」だけでなく「同じ親のリスト内の重複」でも起きる。
  //         nodes=[n,n] は値も親文脈も正しく見えるのに、mapper の $setAll だけが
  //         written=2 と正しい件数を返しながら実スロットへ 2 回適用される。
  //         件数が正しいぶん、共有配列の written=4 より見つけにくい形。
  //         should be: n.children[0].value = 51（+1 が 1 回）。
  it("同一リスト内のノード重複（nodes=[n,n]）でも $setAll(mapper) が二重適用される", async () => {
    const n: any = NODE(5, [NODE(50)]);
    const state: any = { nodes: [n, n] };
    unrollTotals(state, 2);
    Object.defineProperty(state, "nodes.*.children.*.rootValue", {
      get(this: any) { return this["nodes.*.value"]; },
      enumerable: true, configurable: true,
    });
    const { stateEl } = await mount(state);

    const out = read(stateEl, (s: any) => ({
      leaf: s.$getAll("nodes.*.children.*.value", []),
      rootValue: s.$getAll("nodes.*.children.*.rootValue", []),
    }));
    expect(out.leaf).toEqual([50, 50]);        // 値は正しく見える
    expect(out.rootValue).toEqual([5, 5]);     // 親文脈も（両親が同一なので）正しい

    let written = 0;
    write(stateEl, (s: any) => {
      written = s.$setAll("nodes.*.children.*.value", [], (cur: number) => cur + 1);
    });
    expect(written).toBe(2);                   // 件数は正しい
    expect(n.children[0].value).toBe(52);      // should be: 51
  });
});

// ---------------------------------------------------------------------------

describe("欠陥3（E2/E3 修理済み）: 深さ超過と循環が別の診断になり、$129 が範囲外として throw する", () => {
  /** 1 本鎖の木（depth 個のノード、全 value=1、最深の children は []） */
  function chain(depth: number): any[] {
    let node: any = NODE(1);
    for (let d = depth - 1; d >= 1; d--) node = NODE(1, [node]);
    return [node];
  }
  const aggregateChain = (depth: number) => {
    const state: any = { nodes: chain(depth) };
    for (let d = 0; d < depth; d++) {
      const base = baseAt(d);
      Object.defineProperty(state, base + ".total", {
        get(this: any) {
          const kids = this.$getAll(base + ".children.*.total");
          return this[base + ".value"] + kids.reduce((a: number, b: number) => a + b, 0);
        },
        enumerable: true, configurable: true,
      });
    }
    return state;
  };

  // 対照。実効上限は MAX_LOOP_DEPTH と同じ 128 で、そこまでは正しく畳める。
  it("対照: 循環の無い直線の木は深さ 128 まで cold で評価できる", { timeout: 60000 }, async () => {
    const { stateEl } = await mount(aggregateChain(128));
    expect(totalsAt(stateEl, 0)).toEqual([128]);
  });

  // 修理前は StateHandler の _describeAddressCycle が末尾 8 段を並べるだけで重複の有無を
  // 見ておらず、循環が 1 つも無い直線の木でも「相互参照を直せ」と読める文面が出ていた。
  it("循環の無い直線の木の深さ 129 は、循環ではなく深さ超過として診断される", { timeout: 60000 }, async () => {
    const { stateEl } = await mount(aggregateChain(129));
    let msg = "NO THROW";
    try { totalsAt(stateEl, 0); } catch (e: any) { msg = String(e && e.message); }

    expect(msg).toContain("Exceeded maximum address stack depth of 128");
    // Fixed by E2 (深さ超過と循環の分岐)
    //   — was: "Possible circular dependency between path getters:"（この木に循環は無い）
    expect(msg).toContain("[wcs/getter-depth-exceeded]");
    expect(msg).not.toContain("Possible circular dependency between path getters:");
  });

  // E2 の分岐が「常に深さ超過扱い」へ退化していないことの担保。本物の循環（getter どうしが
  // 呼び合う）では、従来どおり循環を名指しする文面でなければならない。この it が無いと、
  // 上の it は「循環の文面を消しただけ」でも緑になってしまう。
  it("getter の相互参照（本物の循環）は循環として診断される", async () => {
    const state: any = { title: "cycle" };
    Object.defineProperty(state, "a", {
      get(this: any) { return this.b; }, enumerable: true, configurable: true,
    });
    Object.defineProperty(state, "b", {
      get(this: any) { return this.a; }, enumerable: true, configurable: true,
    });
    const { stateEl } = await mount(state);

    let msg = "NO THROW";
    try { read(stateEl, (s: any) => s.a); } catch (e: any) { msg = String(e && e.message); }

    expect(msg).toContain("Exceeded maximum address stack depth of 128");
    expect(msg).toContain("Possible circular dependency between path getters:");
    // 循環の当事者（a / b）だけを名指しする（並び順は末尾からの収集順に依存するので問わない）
    expect(msg).toMatch(/Possible circular dependency between path getters: (a -> b|b -> a) -> \.\.\./);
    expect(msg).not.toContain("[wcs/getter-depth-exceeded]");
  });

  // 修理前は traps/get.ts の「未知の $ プロパティは undefined」ガードに握り潰され、
  // 境界のすぐ外側（$129）だけが診断ゼロで壊れていた。MAX_WILDCARD_DEPTH は
  // manifest.syntax.indexParam.maxDepth として公開されている値。
  it("129 本目のワイルドカードで $129 が範囲外として throw する（$128 は解決する）",
    { timeout: 60000 }, async () => {
    const depth = 129;                     // 最深 base のワイルドカードはちょうど 129 本
    const base = baseAt(depth - 1);
    const state: any = { nodes: chain(depth) };
    Object.defineProperty(state, base + ".idx", {
      get(this: any) { return [this.$1, this.$128]; },
      enumerable: true, configurable: true,
    });
    Object.defineProperty(state, base + ".tooDeep", {
      get(this: any) { return this.$129; },
      enumerable: true, configurable: true,
    });
    const { stateEl } = await mount(state);

    const got = read(stateEl, (s: any) => s.$getAll(base + ".idx", []));
    expect(got[0]).toEqual([0, 0]);        // $1 / $128 は境界の内側なので解決する

    // Fixed by E3 — was: undefined（診断ゼロ。$128 は 0 を返すのに $129 だけ無言で壊れる）
    expect(() => read(stateEl, (s: any) => s.$getAll(base + ".tooDeep", [])))
      .toThrow("[wcs/index-param-range]");
  });

  // 「末尾 8 段のパスに重複があれば循環」という判定は、周期が 8 より長い輪を取り逃がし、
  // しかも「重複が無い＝ただ深いだけ」と積極的に誤った断定をしていた。判定はスタック
  // 全体×アドレス同一性（IStateAddress は (pathInfo, listIndex) で intern 済み）で行う。
  it("周期が 8 段を超える getter の輪も循環として診断される", async () => {
    const st: any = { label: "x" };
    const N = 9;
    for (let i = 0; i < N; i++) {
      Object.defineProperty(st, `g${i}`, {
        get(this: any) { return this[`g${(i + 1) % N}`]; },
        enumerable: true, configurable: true,
      });
    }
    const b = await mount(st);
    let message = "";
    read(b.stateEl, (s: any) => { try { void s.g0; } catch (e: any) { message = e.message; } });
    expect(message).toContain("[wcs/getter-cycle]");
    expect(message).toContain("Possible circular dependency between path getters");
    expect(message).not.toContain("[wcs/getter-depth-exceeded]");
  });

  // 対照: 循環の無い直線の getter 連鎖（ワイルドカードを含まない）は深さ超過側に落ちる。
  // 上の輪と同じく「同じパスが末尾に並ぶか」では判別できない形。
  it("ワイルドカードを含まない直線の getter 連鎖は深さ超過として診断される", async () => {
    const st: any = { label: "x", leaf: 1 };
    for (let i = 0; i < 200; i++) {
      const prev = i === 0 ? "leaf" : `c${i - 1}`;
      Object.defineProperty(st, `c${i}`, {
        get(this: any) { return this[prev]; }, enumerable: true, configurable: true,
      });
    }
    const b = await mount(st);
    let message = "";
    read(b.stateEl, (s: any) => { try { void s.c199; } catch (e: any) { message = e.message; } });
    expect(message).toContain("[wcs/getter-depth-exceeded]");
    expect(message).not.toContain("[wcs/getter-cycle]");
  });
});

// ---------------------------------------------------------------------------

describe("欠陥4: readonly ガードを $setAll / $resolve(set) が素通りする（現状の挙動を固定する / 修正時に反転させる）", () => {
  const coldTree = () => ({
    title: "cold",
    nodes: [
      NODE(1, [NODE(10), NODE(11)]),
      NODE(2, [NODE(20)]),
    ],
  });
  const shape = (o: any) =>
    o.nodes.map((n: any) => n.children.map((c: any) => c.value));

  // DEFECT: readonly セッションの中では $setAll も拒否されるべき
  //         （"This state is readonly." で throw し、書き込み 0 件）。
  //         ガードは src/proxy/StateHandler.ts の set トラップにしか無く、
  //         $setAll は setByAddress を直接呼ぶので掛からない。
  //         setAll.ts / resolve.ts の入口、あるいは setByAddress にガードを
  //         足したら反転する。
  it("readonly セッションの中で $setAll が実データを書き換える（直代入だけが拒否される）", async () => {
    const initial = coldTree();
    const { stateEl } = await mount(initial, `<span data-wcs="textContent: title"></span>`);

    let written: any = null;
    let assignError: string | null = null;
    stateEl.createState("readonly", (s: any) => {
      written = s.$setAll("nodes.*.children.*.value", [], 77);
      try { s.title = "changed"; } catch (e: any) { assignError = String(e && e.message); }
    });

    expect(written).toBe(3);                        // should be: throw（書き込み 0 件）
    expect(shape(initial)).toEqual([[77, 77], [77]]); // should be: [[10,11],[20]]

    // 対照: 同じ readonly セッションの中でも、直代入だけは正しく拒否される
    expect(assignError).toBe("[@wcstack/state] This state is readonly.");
    expect(initial.title).toBe("cold");
  });

  // DEFECT: $resolve(path, indexes, value) も readonly では拒否されるべき。
  //         同上の修理で反転する。
  it("readonly セッションの中で $resolve(path, indexes, value) が実データを書き換える", async () => {
    const initial = coldTree();
    const { stateEl } = await mount(initial, `<span data-wcs="textContent: title"></span>`);

    stateEl.createState("readonly", (s: any) => {
      s.$getAll("nodes.*.children.*.value", []); // 台帳を作る（cold の $resolve は throw する）
      s.$resolve("nodes.*.children.*.value", [1, 0], 55);
    });
    expect(shape(initial)).toEqual([[10, 11], [55]]); // should be: [[10,11],[20]]
  });
});

// ---------------------------------------------------------------------------

describe("欠陥5: 遅延実体化（defineTreeAccessor）のキャッシュ固定（現状の挙動を固定する / 修正時に反転させる）", () => {
  /** 深さ 2 の 1 本鎖: value 1 -> 2 -> 3（total は 6 / 5 / 3） */
  const lazyTree = () => ({ title: "t", nodes: [NODE(1, [NODE(2, [NODE(3)])])] });
  const totalDescriptor = (base: string): PropertyDescriptor => ({
    get(this: any) {
      const kids = this.$getAll(base + ".children.*.total");
      return this[base + ".value"] + kids.reduce((a: number, b: number) => a + b, 0);
    },
    enumerable: true,
    configurable: true,
  });
  const defineTotals = (stateEl: State, from: number, to: number) => {
    for (let d = from; d <= to; d++) {
      stateEl.defineTreeAccessor(baseAt(d) + ".total", totalDescriptor(baseAt(d)));
    }
  };
  const HTML = `<div data-wcs="textContent: title"></div>`;

  // 対照。実体化がそのパスの最初の読みより前なら、遅延登録は完全に成立する。
  it("対照: そのパスを読む前に defineTreeAccessor すれば、直後に正しく読める", async () => {
    const { stateEl } = await mount(lazyTree(), HTML);
    expect([...stateEl.getterPaths]).toEqual([]);
    defineTotals(stateEl, 0, 2);

    expect(totalsAt(stateEl, 0)).toEqual([6]);
    expect(totalsAt(stateEl, 1)).toEqual([5]);
    expect(totalsAt(stateEl, 2)).toEqual([3]);
  });

  // DEFECT: 後から生やした getter は次の読みで有効になるべき。isCacheable が
  //         `wildcardCount > 0` だけで true を返すため、getter が未定義の時点の
  //         読みが undefined を dirty:false でキャッシュに固定してしまう。
  //         実体化フックを getByAddress のキャッシュ参照より前へ置く修理
  //         （D-lazy engineChangeDetail 1）で反転する。
  //         should be: 後から生やした直後に [6] / [5]。
  it("先に読んで undefined がキャッシュに載った後に生やしても、恒久的に直らない", async () => {
    const { stateEl } = await mount(lazyTree(), HTML);
    defineTotals(stateEl, 0, 0);                 // 深さ 0 だけ定義

    expect(totalsAt(stateEl, 0)[0]).toBeNaN();   // 子の total が undefined → NaN
    expect(totalsAt(stateEl, 1)).toEqual([undefined]);

    defineTotals(stateEl, 1, 2);                 // 読んだ後に生やす
    expect(totalsAt(stateEl, 0)[0]).toBeNaN();   // should be: [6]
    expect(totalsAt(stateEl, 1)).toEqual([undefined]); // should be: [5]
    expect(totalsAt(stateEl, 2)).toEqual([3]);   // 一度も読んでいない深さだけ正しい

    // 依存先（葉）への書き込みでも救済されない。walkDependency の静的子展開は
    // 親→子方向にしか進まないので、葉の値への書き込みは未評価の中間 getter に届かない。
    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children.*.value", [0, 0, 0], 30);
    });
    await flush();
    expect(totalsAt(stateEl, 0)[0]).toBeNaN();   // should be: [33]
    expect(totalsAt(stateEl, 1)).toEqual([undefined]); // should be: [32]

    // 唯一の回復口は「囲むリストコンテナへの書き込み」だが、それも listPaths を
    // 登録して静的連鎖が効く状態でなければ届かない（登録なしでは NaN のまま）。
    for (const p of ["nodes", "nodes.*.children", "nodes.*.children.*.children"]) {
      stateEl.listPaths.add(p);
    }
    write(stateEl, (s: any) => {
      const cur = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], cur); // 同一参照の再代入で十分
    });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([33]);  // 30 に書き換えた葉が効いている
    expect(totalsAt(stateEl, 1)).toEqual([32]);
  });

  // DEFECT: getter を差し替えたら次の読みは新しい getter の値を返すべき。
  //         defineTreeAccessor はキャッシュに触れないので、無言で効かない。
  //         「効かない」ではなく「次の無効化まで遅延する」＝この後で dirty 化する
  //         書き込みを 1 回入れると 999 になる（対照として同じ it に含める）。
  it("getter の差し替え（再 defineTreeAccessor）がキャッシュを無効化しない", async () => {
    const { stateEl } = await mount(lazyTree(), HTML);
    defineTotals(stateEl, 0, 2);
    expect(totalsAt(stateEl, 0)).toEqual([6]);

    stateEl.defineTreeAccessor(baseAt(0) + ".total", {
      get() { return 999; }, enumerable: true, configurable: true,
    });
    expect(stateEl.getterPaths.size).toBe(3);
    expect(totalsAt(stateEl, 0)).toEqual([6]);   // should be: [999]

    // 対照: dirty 化する書き込みを 1 回入れれば差し替えが見える
    write(stateEl, (s: any) => { s.$resolve("nodes.*.value", [0], 42); });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([999]);
  });

  // DEFECT: $postUpdate は「まだ走査していない深さのキャッシュを剥がす」ための
  //         救済手段のはずだが、まさにその状況（台帳が未生成）では throw する。
  //         救済手段が救済したい状況で使えない。
  //         should be: throw せず、その深さのキャッシュが剥がれる。
  it("$postUpdate が台帳の無い深さで throw する（救済手段が救済したい状況で使えない）", async () => {
    const { stateEl } = await mount(lazyTree(), HTML);
    defineTotals(stateEl, 0, 0);
    expect(totalsAt(stateEl, 0)[0]).toBeNaN();
    defineTotals(stateEl, 1, 2);

    expect(() => write(stateEl, (s: any) => {
      s.$postUpdate("nodes.0.children.0.children.0.total");
    })).toThrow("[@wcstack/state] ListIndex not found: nodes.*.children.*.children");

    // 対照: 葉→根の順に、台帳のある深さだけを撃てば回復する
    write(stateEl, (s: any) => {
      s.$postUpdate("nodes.0.children.0.total");
      s.$postUpdate("nodes.0.total");
    });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([6]);
    expect(totalsAt(stateEl, 1)).toEqual([5]);
  });

  // DEFECT: defineTreeAccessor が呼ぶ setPathInfo(path,"prop") は
  //         `nodes -> nodes.*` の静的連鎖を張るが、listPaths を触らない。
  //         中間リストが listPaths に無いと walkDependency の静的子展開が
  //         桁数の合わない ListIndex を持つアドレスを作り、**書き込みが**
  //         同期例外で落ちる。defineTreeAccessor 側で listPaths も登録する
  //         修理（D-lazy / E-grow engineChangeDetail）で反転する。
  it("defineTreeAccessor だけ（listPaths 未登録）だとリスト置換が throw する", async () => {
    const a = await mount(lazyTree(), HTML);
    defineTotals(a.stateEl, 0, 2);
    expect(totalsAt(a.stateEl, 0)).toEqual([6]);
    expect([...a.stateEl.listPaths]).toEqual([]);

    expect(() => write(a.stateEl, (s: any) => {
      s.nodes = [NODE(7, [NODE(8)])];
    })).toThrow("Cannot expand dynamic dependency with wildcard for non-list address: nodes.*");

    const b = await mount(lazyTree(), HTML);
    defineTotals(b.stateEl, 0, 2);
    expect(totalsAt(b.stateEl, 0)).toEqual([6]);
    expect(() => write(b.stateEl, (s: any) => {
      s.$resolve("nodes.*.children", [0], [NODE(5)]);
    })).toThrow("wcs/wildcard-rank");
  });

  // 対照。「登録を増やすほど安全」ではないことの直接証明。setPathInfo を呼ばない
  // 素の登録（defineProperty + getterPaths.add）だと静的連鎖が生まれず、
  // 動的依存側が自力でリストを読んで展開するので同じ操作が通る。
  it("対照: 素の defineProperty + getterPaths.add なら同じリスト置換が通る", async () => {
    const initial = lazyTree();
    const { stateEl } = await mount(initial, HTML);
    const raw = (stateEl as any)._state;
    for (let d = 0; d <= 2; d++) {
      const p = baseAt(d) + ".total";
      Object.defineProperty(raw, p, totalDescriptor(baseAt(d)));
      stateEl.getterPaths.add(p);
    }
    expect(totalsAt(stateEl, 0)).toEqual([6]);
    expect(stateEl.staticDependency.size).toBe(0);

    write(stateEl, (s: any) => { s.nodes = [NODE(7, [NODE(8)])]; });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([15]);
    expect(totalsAt(stateEl, 1)).toEqual([8]);
  });

  // DEFECT: 上の対照の裏。「素の defineProperty で足りる」のは **総和 getter** の話で、
  //         リストそのものを実体化するアクセサ（毎回新しい配列を返す）に同じことを
  //         すると、cold な $getAll も $setAll も `ListIndexes not found: nodes` で
  //         落ちる。原因は isCacheable が `wildcardCount > 0 || getterPaths.has(path)`
  //         なので、ワイルドカードを含まない "nodes" が getterPaths 外だと非キャッシュに
  //         なり、走査の第 1 相と第 2 相が別々の配列インスタンスを読むこと。
  //         メッセージは「台帳が無い」としか言わないので原因に辿り着けない。
  //         should be: 実体化アクセサでも cold 走査が成立する（あるいは非キャッシュな
  //         リスト getter を名指しする診断が出る）。
  it("生の defineProperty で入れた「毎回新配列を返す」リスト getter は、cold 走査が両方 throw する", async () => {
    const backing = [{ value: 1 }, { value: 2 }];
    const initial: any = { title: "t", nodes: backing };
    const { stateEl } = await mount(initial, HTML);
    const raw = (stateEl as any)._state;
    Object.defineProperty(raw, "nodes", {
      get() { return backing.slice(); },   // 参照するたび別インスタンス
      enumerable: true, configurable: true,
    });
    expect(stateEl.getterPaths.has("nodes")).toBe(false);

    expect(() => read(stateEl, (s: any) => s.$getAll("nodes.*.value", [])))
      .toThrow("[@wcstack/state] ListIndexes not found: nodes");
    expect(() => write(stateEl, (s: any) => { s.$setAll("nodes.*.value", [], 5); }))
      .toThrow("[@wcstack/state] ListIndexes not found: nodes");
    expect(backing.map((b) => b.value)).toEqual([1, 2]);   // 書き込み 0 件
  });

  // 対照。まったく同じアクセサを defineTreeAccessor 経由で入れると、getterPaths に載って
  // キャッシュ対象になり、cold 走査が通る。再帰の遅延アクセサ生成は必ずこちらを通すこと。
  it("対照: 同じアクセサを defineTreeAccessor で入れると cold 走査が通る", async () => {
    const backing = [{ value: 1 }, { value: 2 }];
    const initial: any = { title: "t", nodes: backing };
    const { stateEl } = await mount(initial, HTML);
    stateEl.defineTreeAccessor("nodes", {
      get() { return backing.slice(); },
      enumerable: true, configurable: true,
    });
    expect(stateEl.getterPaths.has("nodes")).toBe(true);

    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.value", []))).toEqual([1, 2]);
    let written = 0;
    write(stateEl, (s: any) => { written = s.$setAll("nodes.*.value", [], 5); });
    expect(written).toBe(2);
    expect(backing.map((b) => b.value)).toEqual([5, 5]);
  });

  // 対照。defineTreeAccessor に listPaths 登録を足せば全構造操作が通る
  // （elementPaths は不要）。修理の受け入れ試験として残す。
  it("対照: defineTreeAccessor + listPaths への直接登録なら全構造操作が成立する", async () => {
    const { stateEl } = await mount(lazyTree(), HTML);
    defineTotals(stateEl, 0, 2);
    for (const p of ["nodes", "nodes.*.children", "nodes.*.children.*.children"]) {
      stateEl.listPaths.add(p);
    }
    expect([...stateEl.elementPaths]).toEqual([]);
    expect(totalsAt(stateEl, 0)).toEqual([6]);

    write(stateEl, (s: any) => {
      s.$resolve("nodes.*.children.*.children.*.value", [0, 0, 0], 30);
    });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([33]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children", [0], [NODE(5)]); });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([6]);

    write(stateEl, (s: any) => { s.nodes = [NODE(7, [NODE(8)])]; });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([15]);
  });

  // DEFECT: アンロール深さがデータ深さに届かないとき、throw も警告も出ずに NaN になる。
  //         再帰パスの実装が「1 段足りない」状態で出荷されると、この NaN が縮約エッジで
  //         ルート集計まで伝播して「壊れているのに静か」になる。
  //         should be: 深さ不足を名指しする診断（wcs/recursion-unrolled-too-shallow 相当）。
  //         このキャッシュ固定とは別原因（最初から getter が足りない）だが、症状が同じ
  //         NaN なので、修理時に取り違えないよう対にして置いておく。
  it("アンロール深さがデータ深さに足りないと、throw も警告も無く NaN になる", async () => {
    // データは深さ 3（value 1 -> 2 -> 3）、getter は深さ 1 までしか無い
    const state: any = { title: "t", nodes: [NODE(1, [NODE(2, [NODE(3)])])] };
    for (let d = 0; d <= 1; d++) {
      Object.defineProperty(state, baseAt(d) + ".total", totalDescriptor(baseAt(d)));
    }
    const warnings: any[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...a: any[]) => { warnings.push(a); });
    try {
      const { stateEl } = await mount(state, HTML);
      expect(totalsAt(stateEl, 0)[0]).toBeNaN();   // should be: 診断が出る
      expect(totalsAt(stateEl, 1)[0]).toBeNaN();
      expect(warnings).toEqual([]);                // 警告も一切出ない
    } finally { spy.mockRestore(); }
  });
});

// ---------------------------------------------------------------------------

/**
 * 欠陥1〜5 はすべて「描画なし」か「遅延実体化」の話だが、描画ありでも 1 クラスだけ
 * 取りこぼしがある。C-replace の機構(1)＝葉キャッシュの dirty 漏れ。
 *
 * walkDependency の selectExpansionIndexes は「行の追加・変更がある置換」では未変更行を
 * 静的子展開から外す。集計 getter 自体は container 動的エッジ（nodes / nodes.*.children →
 * 各段の total）で必ず全行再評価されるが、静的経路でしか dirty 化されない葉の値パス
 * （nodes.*.children.*.children.*.value）のキャッシュだけが古いまま残る。再帰でなければ
 * 「1 セルが古い」で済むが、再帰集計では縮約エッジで親・祖先・ルートまで同じ古い値が届く。
 */
describe("欠陥6: 描画ありでも、in-place の深い変異を構造変化と混ぜると葉キャッシュが古いまま伝播する（現状の挙動を固定する / 修正時に反転させる）", () => {
  /** nodes[0] = 1 + (10+100) + 20 = 131 / nodes[1] = 2 / grandTotal = 133 */
  const forest = () => unrollTotals({
    nodes: [NODE(1, [NODE(10, [NODE(100)]), NODE(20)]), NODE(2)],
  }, 2);
  /** 左右対称の 3 段木。行 total は [111, 222] */
  const symmetric = () => unrollTotals({
    nodes: [NODE(1, [NODE(10, [NODE(100)])]), NODE(2, [NODE(20, [NODE(200)])])],
  }, 2);

  const TREE_FOR =
    `<div><template data-wcs="for: nodes">` +
    `<div><span class="t0">{{ .total }}</span><span class="v0">{{ .value }}</span>` +
    `<template data-wcs="for: nodes.*.children">` +
    `<div><span class="t1">{{ .total }}</span><span class="v1">{{ .value }}</span>` +
    `<template data-wcs="for: nodes.*.children.*.children">` +
    `<div><span class="t2">{{ .total }}</span><span class="v2">{{ .value }}</span></div>` +
    `</template></div></template></div></template></div>` +
    `<span class="gt" data-wcs="textContent: grandTotal"></span>`;

  const txt = (sr: ShadowRoot, sel: string) =>
    Array.from(sr.querySelectorAll(sel)).map((e) => e.textContent!.trim());
  /** 深さ 2 の葉の **生の値**（getter を通さない読み）。ここが古いことが真因 */
  const deepLeafValues = (stateEl: State) =>
    read(stateEl, (s: any) => s.$getAll("nodes.*.children.*.children.*.value", []));

  // DEFECT: 同じ代入の中で in-place に深い葉を書き換え、かつ行を追加すると、葉の
  //         キャッシュだけが dirty 化されずルート集計まで古い値が伝播する。
  //         should be: gt="540" / t0=["531","2","7"] / 生の葉 [500]。
  //         selectExpansionIndexes の未変更行スキップを葉の値パスに掛けない修理で反転する。
  it("in-place の深い変異と行の追加を 1 回の代入に混ぜると、葉が古いままルート集計まで古くなる", async () => {
    const { shadowRoot, stateEl } = await mount(forest(), TREE_FOR);
    expect(txt(shadowRoot, ".gt")).toEqual(["133"]);

    write(stateEl, (s: any) => {
      const arr = s.nodes;
      arr[0].children[0].children[0].value = 500;  // in-place の深い変異
      s.nodes = [...arr, NODE(7)];                 // 同じ代入に構造変化を混ぜる
    });
    await flush();

    expect(txt(shadowRoot, ".gt")).toEqual(["140"]);            // should be: ["540"]
    expect(txt(shadowRoot, ".t0")).toEqual(["131", "2", "7"]);  // should be: ["531","2","7"]
    expect(txt(shadowRoot, ".t2")).toEqual(["100"]);            // should be: ["500"]
    expect(deepLeafValues(stateEl)).toEqual([100]);             // should be: [500]

    // 対照: $postUpdate("nodes")（全行展開）を撃てば復帰する。つまり「再評価されて
    // いない」のではなく「未変更行が静的子展開から外されている」ことが原因。
    write(stateEl, (s: any) => { s.$postUpdate("nodes"); });
    await flush();
    expect(txt(shadowRoot, ".t0")).toEqual(["531", "2", "7"]);
    expect(deepLeafValues(stateEl)).toEqual([500]);
  });

  // DEFECT: 追加だけでなく削除・移動でも同じ。混ぜた構造変化の種類に依存しない。
  //         should be: いずれも生の葉 [500]。
  it("削除・移動を混ぜても同じく葉が古いまま残る", async () => {
    const cases: [string, (s: any, arr: any[]) => void][] = [
      ["削除", (s, arr) => { s.nodes = arr.slice(0, 1); }],
      ["移動", (s, arr) => { s.nodes = [...arr].reverse(); }],
    ];
    for (const [label, mutate] of cases) {
      const { stateEl } = await mount(forest(), TREE_FOR);
      write(stateEl, (s: any) => {
        const arr = s.nodes;
        arr[0].children[0].children[0].value = 500;
        mutate(s, arr);
      });
      await flush();
      expect(deepLeafValues(stateEl), label).toEqual([100]); // should be: [500]
    }
  });

  // これは欠陥ではない対照。構造変化を混ぜずに「in-place 変異 + コピー再代入」だけなら
  // 描画ありでは正しく反映される（§7.0 のリフレッシュ綴りが成立する形）。
  // 上の 2 本との差は「同じ代入に行の増減・移動が入るかどうか」だけ。
  // ただしこの対照が成立する条件はもう 1 つある ── 次の it を参照。
  it("対照: 構造変化を混ぜないコピー再代入なら、描画ありでは in-place 変異が反映される", async () => {
    const { shadowRoot, stateEl } = await mount(forest(), TREE_FOR);
    write(stateEl, (s: any) => {
      const arr = s.nodes;
      arr[0].children[0].children[0].value = 500;
      s.nodes = [...arr];
    });
    await flush();
    expect(txt(shadowRoot, ".gt")).toEqual(["533"]);
    expect(deepLeafValues(stateEl)).toEqual([500]);
  });

  // DEFECT: 上の対照が成立するのは、テンプレートが葉の **value** を描画している
  //         ときだけ。同じ木・同じ 3 段の `for` でも、描画するのが集計（.total）だけで
  //         葉の value をバインドしていないと、まったく同じ綴りが 133 のまま止まる。
  //         「描画ありなら in-place 変異のリフレッシュ綴りが効く」には、
  //         「その葉自身がバインドされている」という隠れた前提がある。
  //         should be: どちらのテンプレートでも 533。
  //         これは欠陥6 の真因（葉の値パスは静的経路でしか dirty 化されない）の
  //         もっとも小さい再現形でもある ── 葉のバインドがその静的経路の唯一の供給源。
  it("同じコピー再代入が、葉の value を描画していないテンプレートでは効かない", async () => {
    // TREE_FOR から .v0 / .v1 / .v2（= 各段の value）を落としただけのテンプレート
    const TOTALS_ONLY =
      `<div><template data-wcs="for: nodes">` +
      `<div><span class="t0">{{ .total }}</span>` +
      `<template data-wcs="for: nodes.*.children">` +
      `<div><span class="t1">{{ .total }}</span>` +
      `<template data-wcs="for: nodes.*.children.*.children">` +
      `<div><span class="t2">{{ .total }}</span></div>` +
      `</template></div></template></div></template></div>` +
      `<span class="gt" data-wcs="textContent: grandTotal"></span>`;

    const { shadowRoot, stateEl } = await mount(forest(), TOTALS_ONLY);
    expect(txt(shadowRoot, ".gt")).toEqual(["133"]);
    write(stateEl, (s: any) => {
      const arr = s.nodes;
      arr[0].children[0].children[0].value = 500;
      s.nodes = [...arr];
    });
    await flush();
    expect(txt(shadowRoot, ".gt")).toEqual(["133"]);       // should be: ["533"]
    expect(deepLeafValues(stateEl)).toEqual([100]);        // should be: [500]
  });

  // DEFECT: 上の対照とまったく同じ綴りが、`for` が 1 つも無い state では効かない。
  //         §7.0 が保証する in-place 変異のリフレッシュ綴りが描画に依存している。
  //         should be: 533（描画ありと同じ）。
  it("同じコピー再代入が、描画なしでは in-place 変異を拾わない", async () => {
    const { stateEl } = await mount(forest());
    expect(read(stateEl, (s: any) => s.grandTotal)).toBe(133);

    write(stateEl, (s: any) => {
      const arr = s.nodes;
      arr[0].children[0].children[0].value = 500;
      s.nodes = [...arr];
    });
    await flush();
    expect(read(stateEl, (s: any) => s.grandTotal)).toBe(133); // should be: 533
  });

  // DEFECT: in-place の `arr.reverse()` は描画ありでも「混ざった行」を作る。
  //         行の value は元の位置のまま・子サブツリーだけが移動して、
  //         t0=[221,112]（= 1+220 と 2+110）になる。should be: ["222","111"]。
  //         描画ありの並べ替えが正しいのは `[...s.nodes].reverse()`（元配列を触らない形）
  //         だけで、in-place 並べ替えは保証外であることの明文化。
  // DEFECT: in-place の `arr.reverse()` は、描画ありでも「行と子サブツリーが別々に動く」
  //         混ざった行を作る。行の value は正しく反転するのに children はその場に残るので、
  //         行 0（value 2）が value 1 の子（10 → total 110）を抱えて 112 になる。
  //         should be: t0=[222,111] / v1=["20","10"]。
  //         描画ありの並べ替えが正しいのは `[...s.nodes].reverse()`（元配列に触れない形）
  //         だけで、in-place の並べ替えは同一参照でもコピーでも保証外であることの明文化。
  //         なお混ざり *方* は固定契約ではない: C-replace のプローブは同じ操作で鏡像の
  //         t0=[221,112]（value が残り children が動く形）を観測している。ここで
  //         固定するのは「行と子サブツリーが分離する」ことで、下の実測値はその現れ。
  it("in-place の arr.reverse() は、描画ありでも行の value と子サブツリーがずれる", async () => {
    for (const [label, assign] of [
      ["同一参照", (s: any, arr: any[]) => { s.nodes = arr; }],
      ["コピー", (s: any, arr: any[]) => { s.nodes = [...arr]; }],
    ] as [string, (s: any, arr: any[]) => void][]) {
      const { shadowRoot, stateEl } = await mount(symmetric(), TREE_FOR);
      expect(txt(shadowRoot, ".t0"), label).toEqual(["111", "222"]);

      write(stateEl, (s: any) => {
        const arr = s.nodes;
        arr.reverse();
        assign(s, arr);
      });
      await flush();

      // 行の value は正しく反転している（生データも [2,1]）
      expect(txt(shadowRoot, ".v0"), label).toEqual(["2", "1"]);
      expect(valuesAt(stateEl, 0), label).toEqual([2, 1]);
      // ところが子は動いていない。行 0（value 2）の子が value 10 のまま
      expect(txt(shadowRoot, ".v1"), label).toEqual(["10", "20"]); // should be: ["20","10"]
      expect(txt(shadowRoot, ".t0"), label).toEqual(["112", "221"]); // should be: ["222","111"]
      expect(totalsAt(stateEl, 0), label).toEqual([112, 221]);
    }
  });
});

// ---------------------------------------------------------------------------
// 着地後レビュー（2026-09-11・実装計画 §7-3）で見つかった既存欠陥。どちらも再帰固有ではなく、
// 手書きの多段 getter・wildcard 無しの getter で同じ形になる。欠陥7 は現状固定のまま
// （X2 / #256 の担当）、欠陥8 は #258 で修理済みなので反転させてある。
// ---------------------------------------------------------------------------

describe("欠陥7（X2 / #256 で修理済み）: 行オブジェクトを作り直す置換（children 配列は引き継ぐ）でも、その行の集計が葉の更新に追従する", () => {
  const forest = () => [NODE(1, [NODE(10, [NODE(100)]), NODE(20)]), NODE(2)];
  const leafWrite = (stateEl: State) =>
    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.children.*.value", [0, 0, 0], 500); });

  // #256 で修理済み（was: depth-0 だけが [131, 2] のまま）。台帳は 1 本の配列につき
  // 行集合 1 組のままだが、行がぶら下がる親が**退役している**ときだけ、行の identity を
  // 保ったまま新しい親へ付け替えるようにした。葉の書き込みは縮約エッジ
  // （listIndexAtWildcard）で親を遡るので、付け替え後は**生きている行**のアドレスが
  // dirty になり、新行の nodes.*.total キャッシュが落ちる。
  // 露出条件は「置換と葉更新の**間に集計を読む**こと」（新行のアドレスにキャッシュが載る）
  // で、このファイルの it は全部その綴り。修理後も同じ綴りのまま固定する。
  it("手書きの 3 段 getter: depth-0 も depth-1 も葉も追従する", async () => {
    const { stateEl } = await mount(unrollTotals({ nodes: forest() }, 2));
    expect(totalsAt(stateEl, 0)).toEqual([131, 2]);

    write(stateEl, (s: any) => { s.nodes = s.nodes.map((n: any) => ({ ...n })); });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([131, 2]);

    leafWrite(stateEl);
    await flush();
    expect(valuesAt(stateEl, 2)).toEqual([500]);
    expect(totalsAt(stateEl, 1)).toEqual([510, 20]);
    expect(totalsAt(stateEl, 0)).toEqual([531, 2]); // Fixed by #256 — was: [131, 2]
  });

  it("再帰 getter でも同じ（`**` は縮約エッジの向きを変えない）", async () => {
    const state: any = { nodes: forest(), $recursion: { "nodes.*": "children.*" } };
    Object.defineProperty(state, "nodes.**.total", {
      get(this: any) {
        return this["nodes.**.value"] +
          this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
      },
      enumerable: true, configurable: true,
    });
    const { stateEl } = await mount(state);
    expect(totalsAt(stateEl, 0)).toEqual([131, 2]);

    write(stateEl, (s: any) => { s.nodes = s.nodes.map((n: any) => ({ ...n })); });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([131, 2]);   // 間に読む（露出条件）

    leafWrite(stateEl);
    await flush();
    expect(read(stateEl, (s: any) => s.$getAll("nodes.**.value", []))).toEqual([1, 10, 500, 20, 2]);
    expect(totalsAt(stateEl, 1)).toEqual([510, 20]);
    expect(totalsAt(stateEl, 0)).toEqual([531, 2]); // Fixed by #256 — was: [131, 2]
  });

  it("対照: 行オブジェクトを引き継ぐ置換（[...nodes]）なら depth-0 も追従する", async () => {
    const { stateEl } = await mount(unrollTotals({ nodes: forest() }, 2));
    expect(totalsAt(stateEl, 0)).toEqual([131, 2]);
    write(stateEl, (s: any) => { s.nodes = [...s.nodes]; });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([131, 2]);   // 間に読んでも
    leafWrite(stateEl);
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([531, 2]);
  });

  it("対照: children 配列も作り直す深いクローンなら depth-0 も追従する", async () => {
    const clone = (nodes: any[]): any[] => nodes.map((n) => ({ ...n, children: clone(n.children) }));
    const { stateEl } = await mount(unrollTotals({ nodes: forest() }, 2));
    expect(totalsAt(stateEl, 0)).toEqual([131, 2]);
    write(stateEl, (s: any) => { s.nodes = clone(s.nodes); });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([131, 2]);   // 間に読んでも
    leafWrite(stateEl);
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([531, 2]);
  });
  // #256 の受け入れ条件「描画行の数（MUST KEEP ROW COUNT）」。X2 は $getAll を 1 つも
  // 書いていないページでも露出していた ── 描画そのものが「置換と葉更新の間の読み」に
  // なる。ここでは値に加えて **行数** を固定する: 旧行を退役させられない修正は行を
  // 重複させることがあり、本文だけの表明では見えない。
  it("描画あり（3 段の入れ子 for）でも depth-0 が追従し、行数は増減しない", async () => {
    const TREE_FOR =
      `<div><template data-wcs="for: nodes">` +
      `<div class="r0"><span class="t0">{{ .total }}</span><span class="v0">{{ .value }}</span>` +
      `<template data-wcs="for: nodes.*.children">` +
      `<div class="r1"><span class="t1">{{ .total }}</span><span class="v1">{{ .value }}</span>` +
      `<template data-wcs="for: nodes.*.children.*.children">` +
      `<div class="r2"><span class="t2">{{ .total }}</span></div>` +
      `</template></div></template></div></template></div>` +
      `<span class="gt" data-wcs="textContent: grandTotal"></span>`;
    const { shadowRoot, stateEl } = await mount(unrollTotals({ nodes: forest() }, 2), TREE_FOR);
    const rowCounts = () => [".r0", ".r1", ".r2"].map((sel) => shadowRoot.querySelectorAll(sel).length);
    const t = (sel: string) =>
      Array.from(shadowRoot.querySelectorAll(sel)).map((e) => e.textContent!.trim());

    expect(rowCounts(), "初期描画").toEqual([2, 2, 1]);
    expect(t(".t0")).toEqual(["131", "2"]);

    write(stateEl, (s: any) => { s.nodes = s.nodes.map((row: any) => ({ ...row })); });
    await flush();
    expect(rowCounts(), "置換で行は増減しない").toEqual([2, 2, 1]);
    expect(t(".t0")).toEqual(["131", "2"]);

    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.children.*.value", [0, 0, 0], 500); });
    await flush();
    expect(rowCounts(), "葉の書き込みでも行は増減しない").toEqual([2, 2, 1]);
    expect(t(".t2"), "葉は追従する").toEqual(["500"]);
    expect(t(".t1"), "深さ 1 も追従する").toEqual(["510", "20"]);
    // Fixed by #256 — was: t0=["131","2"] / gt=["133"]。$getAll を 1 つも書いていない
    // ページでも露出する形だったので、描画そのものが回帰の門になっている。
    expect(t(".t0")).toEqual(["531", "2"]);
    expect(t(".gt")).toEqual(["533"]);
  });

  // #256 の受け入れ条件「置換のあとも生き続けること（MUST STAY LIVE）」。1 回追従して
  // 終わりではなく、3 回とも・2 回目の置換をまたいでも追従することを固定する。
  // was: depth-1 と葉だけが毎回追従し、depth-0 は置換の時点の値に凍って、次の置換が
  // その時点の正しい値で撮り直してはまた凍る、という周期になっていた。
  it("置換のあと 3 回書いても、depth-0・depth-1・葉が毎回追従する", async () => {
    const { stateEl } = await mount(unrollTotals({ nodes: forest() }, 2));
    expect(totalsAt(stateEl, 0)).toEqual([131, 2]);
    write(stateEl, (s: any) => { s.nodes = s.nodes.map((row: any) => ({ ...row })); });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([131, 2]);   // 間に読む（露出条件）

    for (const [v, d1] of [[500, 510], [600, 610], [700, 710]] as [number, number][]) {
      write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.children.*.value", [0, 0, 0], v); });
      await flush();
      expect(valuesAt(stateEl, 2), String(v)).toEqual([v]);
      expect(totalsAt(stateEl, 1), String(v)).toEqual([d1, 20]);
      // Fixed by #256 — was: 毎回 [131, 2]（置換の時点で凍り、自己修復しなかった）。
      expect(totalsAt(stateEl, 0), String(v)).toEqual([v + 31, 2]);
    }

    // 2 回目の置換のあとも追従し続ける（修理前はここで撮り直してまた凍っていた）。
    write(stateEl, (s: any) => { s.nodes = s.nodes.map((row: any) => ({ ...row })); });
    await flush();
    expect(totalsAt(stateEl, 0)).toEqual([731, 2]);
    write(stateEl, (s: any) => { s.$resolve("nodes.*.children.*.children.*.value", [0, 0, 0], 800); });
    await flush();
    expect(totalsAt(stateEl, 1)).toEqual([810, 20]);
    expect(totalsAt(stateEl, 0)).toEqual([831, 2]); // Fixed by #256 — was: [731, 2]
  });
});

describe("欠陥8（X10 / #258）: setInitialState の再セットで getter キャッシュが世代ごと無効になる（修理済み）", () => {
  // 契約（#258 で修理済み）: キャッシュ項目は「載せた世代」の番号を持ち（cache/types.ts の
  //         `generation`）、`_state` の差し替えごとに世代が 1 つ進む。世代の違う項目はヒット
  //         扱いにせず読みが getter を評価し直すので、値だけでなく**新しい世代の依存辺**も張られる。
  //         世代を進める位置は「旧世代の後始末（forgetGenerated）の後・`__state` 差し替えの前」。
  //         宣言の検証はこの位置を挟んで 2 群に割れる（`value` しか読まない 4 つが前・`$on` /
  //         `$streams` / `$watch` が後）。どちらの群が何を残すかは
  //         integration.stateGenerationReset.test.ts が 1 つずつ固定している。
  //         旧挙動: 絶対アドレスは (stateElement, pathInfo, listIndex) で intern され世代を跨いで
  //         同一なので、再セット前に一度でも読んだ getter は旧世代の値を dirty:false のまま
  //         恒久的に返していた。依存集合が変わる再セットでは「新しい依存を書いても動かず、
  //         旧世代だけが読んでいたパスを書くと動く」という誤った反応グラフまで残っていた
  //         （その形は integration.stateGenerationReset.test.ts が固定している）。
  it("{ items, get sum } を再セットすると sum が新しい世代で評価し直される", async () => {
    const make = (items: number[]) => {
      const s: any = { items };
      Object.defineProperty(s, "sum", {
        get(this: any) { return this.items.reduce((a: number, b: number) => a + b, 0); },
        enumerable: true, configurable: true,
      });
      return s;
    };
    const { stateEl } = await mount(make([1, 2]));
    expect(read(stateEl, (s: any) => s.sum)).toBe(3);

    stateEl.setInitialState(make([5, 6]));
    await flush();
    expect(read(stateEl, (s: any) => s.items)).toEqual([5, 6]);
    expect(read(stateEl, (s: any) => s.sum)).toBe(11); // Fixed by #258 — was: 3
  });

  it("再帰の合併形も同じ: 再セット前に読んだ getter も新しい世代の値を返す", async () => {
    const make = (nodes: any[]) => {
      const s: any = { nodes, $recursion: { "nodes.*": "children.*" } };
      Object.defineProperty(s, "nodes.**.total", {
        get(this: any) {
          return this["nodes.**.value"] +
            this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
        },
        enumerable: true, configurable: true,
      });
      Object.defineProperty(s, "rootTotals", {
        get(this: any) { return this.$getAll("nodes.*.total", []); },
        enumerable: true, configurable: true,
      });
      Object.defineProperty(s, "treeTotal", {
        get(this: any) { return this.$getAll("nodes.**.value", []).reduce((a: number, b: number) => a + b, 0); },
        enumerable: true, configurable: true,
      });
      return s;
    };
    const { stateEl } = await mount(make([NODE(1, [NODE(10, [NODE(100)])])]));
    expect(read(stateEl, (s: any) => s.rootTotals)).toEqual([111]);   // 再セット前に読む
    //（treeTotal は読まない）

    stateEl.setInitialState(make([NODE(5, [NODE(50, [NODE(500)])])]));
    await flush();
    expect(read(stateEl, (s: any) => s.$getAll("nodes.*.value", []))).toEqual([5]);
    expect(read(stateEl, (s: any) => s.treeTotal)).toBe(555);          // 初めて読むので正しい
    expect(read(stateEl, (s: any) => s.rootTotals)).toEqual([555]);   // Fixed by #258 — was: [111]
    // 生成アクセサ経由の直接読みは正しい（キャッシュの主は rootTotals の側）
    expect(totalsAt(stateEl, 0)).toEqual([555]);
  });
});

// ---------------------------------------------------------------------------

describe("欠陥9（X5 / #257）: 宣言の検証が初回マウントで throw したときの着地（修理済み）", () => {
  // 契約（#257 で修理済み）: 初回マウントで宣言の検証が throw したら、
  //         `connectedCallbackPromise` は**その宣言自身の文面で reject** し、`console.error` が
  //         1 件出る。`initializePromise` は解決したままにする（`waitForStateInitialize` は
  //         同じ root の全 <wcs-state> を Promise.all で待つので、reject にすると 1 要素の
  //         設定ミスが無関係なバインディングまで道連れにする）。旧挙動は「両 promise が
  //         永久 pending・`console.error` 0 件」の無言のハングだった。
  //         再セット経路の同期 throw は不変（integration.recursionGetter.test.ts の
  //         withReset がその側を固定）。第 2 / 第 3 サイクルで新設した `**` getter の
  //         構築時 raise も同じ経路に載っている。着地そのものの全面（ソースのロード失敗・
  //         2 本目のルート・同居ボリューム・復旧不能）は
  //         integration.initFailureDiagnostics.test.ts。
  const settle = (stateEl: State) => Promise.race([
    stateEl.connectedCallbackPromise.then(() => "resolved", () => "rejected"),
    flush().then(() => flush()).then(() => "pending"),
  ]);

  async function mountBroken(initial: any): Promise<{ outcome: string; errors: number; host: HTMLElement }> {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement(`recdefect-host-${seq++}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    try {
      stateEl.setInitialState(initial);
      return { outcome: await settle(stateEl), errors: spy.mock.calls.length, host };
    } finally {
      spy.mockRestore();
    }
  }

  it("不正な $recursion 宣言（アンカーが要素を指さない）", async () => {
    const { outcome, errors, host } = await mountBroken({ nodes: [NODE(1)], $recursion: { nodes: "children.*" } });
    expect(outcome).toBe("rejected"); // Fixed by #257 — was: "pending"（無言のハング）
    expect(errors).toBe(1);           // Fixed by #257 — was: 0
    host.remove();
  });

  it("`**` getter の展開形と同名の具体 getter（第 3 サイクルで新設した構築時 raise も同じ表面）", async () => {
    const state: any = { nodes: [NODE(1)], $recursion: { "nodes.*": "children.*" } };
    Object.defineProperty(state, "nodes.**.total", { get() { return 0; }, enumerable: true, configurable: true });
    Object.defineProperty(state, "nodes.*.children.*.total", { get() { return 7; }, enumerable: true, configurable: true });
    const { outcome, errors, host } = await mountBroken(state);
    expect(outcome).toBe("rejected"); // Fixed by #257 — was: "pending"（無言のハング）
    expect(errors).toBe(1);           // Fixed by #257 — was: 0
    host.remove();
  });

  it("構造を名指す `**` getter（第 2 サイクルで新設した構築時 raise も同じ表面）", async () => {
    const state: any = { nodes: [NODE(1)], $recursion: { "nodes.*": "children.*" } };
    Object.defineProperty(state, "nodes.**.children", { get() { return []; }, enumerable: true, configurable: true });
    const { outcome, errors, host } = await mountBroken(state);
    expect(outcome).toBe("rejected"); // Fixed by #257 — was: "pending"（無言のハング）
    expect(errors).toBe(1);           // Fixed by #257 — was: 0
    host.remove();
  });
});
