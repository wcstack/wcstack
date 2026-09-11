/**
 * integration.recursionShape.test.ts — 再帰が受け付ける「木の形」の契約（設計書 D12 / E6）。
 *
 * 拒否すべき最小条件は「DAG」ではなく **同じ配列インスタンスが 2 つ以上の親から
 * 到達可能であること**で、循環はその特殊ケース（自分より上へ戻る参照）。判定は
 * 走査そのものが持つ「訪れた配列」と「祖先の配列」の集合で行う。
 *
 * **台帳の親（`newIndexes[0].parentListIndex`）で判定してはならない。** 台帳は
 * リスト配列の identity だけをキーにしているので、行オブジェクトを作り直すふつうの
 * イミュータブル更新（`nodes.map(n => ({...n}))` は children を参照ごと引き継ぐ）でも
 * 親 ListIndex が別物になり、正当な木を恒久的に拒否してしまう。反証レビューが
 * blocking として出した形で、このファイルの前半はその回帰テストである。
 *
 * 後半は深さの境界。走査は葉の 1 段先を投機的に読まないので、実効上限は仕様どおり
 * 128 段（`MAX_WILDCARD_DEPTH`）で、127 段ではない。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { flush, read, write } from "./helpers/recursionTestUtils";
beforeAll(() => { bootstrapState(); });
let seq = 0;
async function mount(initial: any) {
  const host = document.createElement(`shape-host-${seq++}`);
  const sr = host.attachShadow({ mode: "open" });
  sr.innerHTML = `<div data-wcs="textContent: label"></div><wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const el = sr.querySelector("wcs-state") as State;
  el.setInitialState(initial);
  await el.connectedCallbackPromise;
  await State.getBindingsReady(sr);
  return el;
}
// read / write / flush は helpers/recursionTestUtils
/** 再帰 getter つきの state を組む。spread では accessor が値化されるので defineProperty で足す。 */
const mountShape = async (partial: any) => {
  const st: any = { label: "x", $recursion: { "nodes.*": "children.*" }, ...partial };
  Object.defineProperty(st, "nodes.**.total", {
    get(this: any) {
      return this["nodes.**.value"] +
        this.$getAll("nodes.**.children.*.total").reduce((a: number, b: number) => a + b, 0);
    },
    enumerable: true, configurable: true,
  });
  return mount(st);
};
const base = () => ({
  label: "x", $recursion: { "nodes.*": "children.*" },
  nodes: [{ value: 1, children: [{ value: 10, children: [] }, { value: 20, children: [] }] }, { value: 2, children: [] }],
});

describe("再帰が受け付ける木の形（共有・循環・イミュータブル更新）", () => {
  it("イミュータブル更新（spread で children を参照ごと引き継ぐ）を拒否しない", async () => {
    const el = await mount(base());
    expect(read(el, (s) => s.$getAll("nodes.**.value", []))).toEqual([1, 10, 20, 2]);
    write(el, (s: any) => { s.nodes = s.nodes.map((n: any) => ({ ...n })); });
    await flush();
    expect(read(el, (s) => s.$getAll("nodes.**.value", []))).toEqual([1, 10, 20, 2]);
    // 2 回目も通る（恒久化しない）
    write(el, (s: any) => { s.nodes = s.nodes.map((n: any) => ({ ...n })); });
    await flush();
    expect(read(el, (s) => s.$getAll("nodes.**.value", []))).toEqual([1, 10, 20, 2]);
  });

  it("行の並べ替えでも拒否しない", async () => {
    const el = await mount(base());
    read(el, (s) => s.$getAll("nodes.**.value", []));
    write(el, (s: any) => { const r = s.nodes; s.nodes = [{ ...r[1] }, { ...r[0] }]; });
    await flush();
    expect(read(el, (s) => s.$getAll("nodes.**.value", []))).toEqual([2, 1, 10, 20]);
  });

  it("ルート配列へ戻る循環は cycle として診断される", async () => {
    const roots: any[] = [];
    roots.push({ value: 1, children: roots });
    const el = await mount({ label: "x", $recursion: { "nodes.*": "children.*" }, nodes: roots });
    let msg = "";
    try { read(el, (s) => s.$getAll("nodes.**.value", [])); } catch (e: any) { msg = e.message; }
    expect(msg).toContain("[wcs/recursion-cycle]");
  });

  it("孫が祖父の配列を指す循環も cycle として診断される", async () => {
    const top: any = { value: 1, children: [] };
    const child: any = { value: 2, children: [] };
    const grand: any = { value: 3, children: top.children };
    child.children = [grand];
    top.children.push(child);
    const el = await mount({ label: "x", $recursion: { "nodes.*": "children.*" }, nodes: [top] });
    let msg = "";
    try { read(el, (s) => s.$getAll("nodes.**.value", [])); } catch (e: any) { msg = e.message; }
    expect(msg).toContain("[wcs/recursion-cycle]");
  });

  it("兄弟共有は shared-list として診断される", async () => {
    const shared = [{ value: 9, children: [] }];
    const el = await mount({ label: "x", $recursion: { "nodes.*": "children.*" },
      nodes: [{ value: 1, children: shared }, { value: 2, children: shared }] });
    let msg = "";
    try { read(el, (s) => s.$getAll("nodes.**.value", [])); } catch (e: any) { msg = e.message; }
    expect(msg).toContain("[wcs/recursion-shared-list]");
  });

  it("空配列の使い回しは拒否しない", async () => {
    const empty: any[] = [];
    const el = await mount({ label: "x", $recursion: { "nodes.*": "children.*" },
      nodes: [{ value: 1, children: empty }, { value: 2, children: empty }] });
    expect(read(el, (s) => s.$getAll("nodes.**.value", []))).toEqual([1, 2]);
  });

  it("深さ 128 段ちょうどの鎖が走査できる", async () => {
    const build = (n: number): any => n === 0 ? { value: 0, children: [] } : { value: n, children: [build(n - 1)] };
    const el = await mount({ label: "x", $recursion: { "nodes.*": "children.*" }, nodes: [build(127)] });
    const values = read(el, (s) => s.$getAll("nodes.**.value", []));
    expect(values).toHaveLength(128);
  });
});

describe("cold な合併書き込みが差分基準を残すこと（Phase D の反証レビュー）", () => {
  // Fixed by Phase D review — was: 書き側の列挙が commitDiffBaseline: false で走り、
  // 全深さぶんの ListIndex 世代を鋳造したまま基準を残さなかった。次の構造変更で
  // その世代を見られない diff が行を鋳造し直し、生き残った深い children の台帳だけが
  // 死んだ世代の親を指す。以後、再帰 getter の読みが恒久的に落ちていた
  // （値の合併は動き続けるので、getter を読むまで無症状）。
  // 孫が要る。壊れるのは「生き残った深い children の台帳が死んだ世代の親を指す」形なので、
  // 削除される兄弟の隣に**子を持つノード**が居ないと再現しない。
  const kid = (v: number, grand: number[] = []) =>
    ({ value: v, children: grand.map((g) => ({ value: g, children: [] })) });
  const forest = () => [
    { value: 1, children: [kid(10, [100]), kid(11, [110]), kid(12, [120])] },
    { value: 2, children: [] },
  ];

  it("cold の $setAll → 中間の子を削除 → 再帰 getter を読む、が通ること", async () => {
    const el = await mountShape({ nodes: forest() });
    // 走査も描画も一度も経ていない状態で、最初の操作が合併形の書き込み
    write(el, (s: any) => { s.$setAll("nodes.**.value", [], 5); });
    await flush();
    // 真ん中の子を落とす（生き残る行の index がずれる形）
    write(el, (s: any) => {
      const kids = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [kids[0], kids[2]]);
    });
    await flush();
    expect(read(el, (s: any) => s.$getAll("nodes.**.total", []))).toEqual([25, 10, 5, 10, 5, 5]);
  });

  it("1 件も書かない undefined のブロードキャストでも同じく壊れないこと", async () => {
    const el = await mountShape({ nodes: forest() });
    let written = -1;
    write(el, (s: any) => { written = s.$setAll("nodes.**.value", [], undefined); });
    expect(written).toBe(0);
    await flush();
    write(el, (s: any) => {
      const kids = s.$resolve("nodes.*.children", [0]);
      s.$resolve("nodes.*.children", [0], [kids[1], kids[2]]);
    });
    await flush();
    expect(read(el, (s: any) => s.$getAll("nodes.**.total", []))).toEqual([254, 121, 110, 132, 120, 2]);
  });
});
