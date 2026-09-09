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
beforeAll(() => { bootstrapState(); });
let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));
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
const read = (el: State, fn: (s: any) => any) => { let r: any; el.createState("readonly", (s: any) => { r = fn(s); }); return r; };
const write = (el: State, fn: (s: any) => void) => el.createState("writable", fn);
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
    console.log("root-cycle:", msg.slice(0, 90));
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
    console.log("deep-cycle:", msg.slice(0, 90));
    expect(msg).toContain("[wcs/recursion-cycle]");
  });

  it("兄弟共有は shared-list として診断される", async () => {
    const shared = [{ value: 9, children: [] }];
    const el = await mount({ label: "x", $recursion: { "nodes.*": "children.*" },
      nodes: [{ value: 1, children: shared }, { value: 2, children: shared }] });
    let msg = "";
    try { read(el, (s) => s.$getAll("nodes.**.value", [])); } catch (e: any) { msg = e.message; }
    console.log("shared:", msg.slice(0, 90));
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
    console.log("depth-128 count:", values.length);
    expect(values).toHaveLength(128);
  });
});
