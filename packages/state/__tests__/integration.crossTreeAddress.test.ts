/**
 * integration.crossTreeAddress.test.ts — 2 つのツリーが混線しないことの基準試験。
 *
 * v2 の不変条件は「1 rootNode に 1 ツリー」で、ページには rootNode が複数ある。一方で updater・
 * 恒久台帳（cache / bindings / baseline）・行の正本台帳（listIndexesByList）はどれもモジュール単一で、
 * ツリーをまたぐ。ツリーを分けているのはアドレスの `stateElement` 次元だけである
 * （docs/state-address-unification-design.md §3・§3-1）。
 *
 * ここは**アドレス型の統合（案 A）の前後で変わってはならない振る舞い**を固定する
 * （impl-plan §4-2・§9）。統合後に落ちたら、intern のキーから `stateElement` が落ちている（I1 違反）。
 * 統合で反転するのは「前提の固定」の 1 件だけで、そこに FLIP の印を付けてある。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { getPathInfo } from "../src/address/PathInfo";
import { createStateAddress } from "../src/address/StateAddress";
import { getTreePath } from "../src/address/TreePath";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getCacheEntryByAbsoluteStateAddress } from "../src/cache/cacheEntryByAbsoluteStateAddress";
import { getStateListBaseline } from "../src/list/stateListBaseline";
import { getLoopContextByNode } from "../src/list/loopContextByNode";
import { peekBindingsForAddress } from "../src/binding/getBindingSetByAbsoluteStateAddress";
import type { IStateElement } from "../src/components/types";
import type { IListIndex } from "../src/list/types";
import type { IBindingInfo } from "../src/binding/types";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

const TEMPLATE =
  `<ul><template data-wcs="for: items"><li data-wcs="textContent: .upper"></li></template></ul>` +
  `<span id="count" data-wcs="textContent: count"></span>`;

interface IRow { name: string }

function createTreeState(items: IRow[], updatedLog: string[][]) {
  return {
    items,
    get "items.*.upper"(this: any) { return String(this["items.*.name"]).toUpperCase(); },
    get count(this: any) { return this.items.length; },
    $updatedCallback(paths: string[]) { updatedLog.push(paths); },
  };
}

async function mountTree(items: IRow[]) {
  const updatedLog: string[][] = [];
  const host = document.createElement(`cross-tree-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = TEMPLATE + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(createTreeState(items, updatedLog));
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  const rows = () => Array.from(shadowRoot.querySelectorAll("li"), (li) => li.textContent);
  const count = () => shadowRoot.querySelector("#count")!.textContent;
  const write = (fn: (state: any) => void) => stateElement.createState("writable", fn);
  return { host, shadowRoot, stateElement, updatedLog, rows, count, write };
}

/**
 * ツリーまで確定したアドレス。台帳を white-box で引くための唯一の入口で、
 * アドレス型の統合（impl-plan Phase 2）で書き換わるのはここだけにしてある。
 */
function absOf(stateElement: IStateElement, path: string, listIndex: IListIndex | null) {
  return createAbsoluteStateAddress(getTreePath(stateElement, getPathInfo(path)), listIndex);
}

function rowListIndex(shadowRoot: ShadowRoot, row: number): IListIndex {
  return getLoopContextByNode(shadowRoot.querySelectorAll("li")[row])!.listIndex;
}

function nodesOf(bindings: IBindingInfo | Set<IBindingInfo> | undefined): Node[] {
  if (typeof bindings === "undefined") return [];
  return bindings instanceof Set ? Array.from(bindings, (binding) => binding.node) : [bindings.node];
}

describe("クロスツリー: 同じパス形状のルート配列を持つ 2 ツリー", () => {
  it("行の書き込みが、もう一方の描画・キャッシュ・$updatedCallback に触れないこと", async () => {
    const a = await mountTree([{ name: "a0" }, { name: "a1" }]);
    const b = await mountTree([{ name: "b0" }, { name: "b1" }]);
    expect(a.rows()).toEqual(["A0", "A1"]);
    expect(b.rows()).toEqual(["B0", "B1"]);

    const bRow0 = rowListIndex(b.shadowRoot, 0);
    const bCacheBefore = getCacheEntryByAbsoluteStateAddress(absOf(b.stateElement, "items.*.upper", bRow0));
    expect(bCacheBefore?.value).toBe("B0");
    a.updatedLog.length = 0;
    b.updatedLog.length = 0;

    a.write((s) => { s["items.0.name"] = "changed"; });
    await flush();

    expect(a.rows()).toEqual(["CHANGED", "A1"]);
    expect(b.rows()).toEqual(["B0", "B1"]);
    expect(a.updatedLog.length).toBe(1);
    expect(b.updatedLog.length).toBe(0);
    // もう一方のキャッシュは同じ項目のまま（作り直されても dirty にもなっていない）
    const bCacheAfter = getCacheEntryByAbsoluteStateAddress(absOf(b.stateElement, "items.*.upper", bRow0));
    expect(bCacheAfter).toBe(bCacheBefore);
    expect(bCacheAfter?.dirty).toBe(false);

    a.host.remove();
    b.host.remove();
  });

  it("リストの構造変更が、もう一方の描画・差分基準・null 行の getter に触れないこと", async () => {
    const a = await mountTree([{ name: "a0" }, { name: "a1" }]);
    const b = await mountTree([{ name: "b0" }, { name: "b1" }]);
    expect(a.count()).toBe("2");
    expect(b.count()).toBe("2");
    const bBaselineBefore = getStateListBaseline(absOf(b.stateElement, "items", null));

    a.write((s) => { s.items = s.items.concat({ name: "a2" }); });
    await flush();

    expect(a.rows()).toEqual(["A0", "A1", "A2"]);
    expect(a.count()).toBe("3");
    expect(b.rows()).toEqual(["B0", "B1"]);
    expect(b.count()).toBe("2");
    // 差分基準は同じパス形状でもツリーごと（stateListBaseline.ts の冒頭コメントが言う混線の再現）
    const aBaseline = getStateListBaseline(absOf(a.stateElement, "items", null));
    const bBaselineAfter = getStateListBaseline(absOf(b.stateElement, "items", null));
    expect(aBaseline.length).toBe(3);
    expect(bBaselineAfter).toBe(bBaselineBefore);
    expect(bBaselineAfter.length).toBe(2);
    // null 行の getter（count）のキャッシュもツリーごと
    expect(getCacheEntryByAbsoluteStateAddress(absOf(a.stateElement, "count", null))?.value).toBe(3);
    expect(getCacheEntryByAbsoluteStateAddress(absOf(b.stateElement, "count", null))?.value).toBe(2);

    // もう一方を同じように変えても、先に変えた側は動かない
    b.write((s) => { s.items = s.items.slice(1); });
    await flush();
    expect(b.rows()).toEqual(["B1"]);
    expect(b.count()).toBe("1");
    expect(a.rows()).toEqual(["A0", "A1", "A2"]);
    expect(a.count()).toBe("3");

    a.host.remove();
    b.host.remove();
  });
});

describe("クロスツリー: 同じ配列インスタンスを持つ 2 ツリー", () => {
  it("前提の固定: 行の ListIndex はツリーをまたいで共有され、ツリーを分けるのは絶対アドレスだけであること", async () => {
    const shared: IRow[] = [{ name: "s0" }, { name: "s1" }];
    const a = await mountTree(shared);
    const b = await mountTree(shared);
    expect(a.rows()).toEqual(["S0", "S1"]);
    expect(b.rows()).toEqual(["S0", "S1"]);

    // 行の正本台帳（listIndexesByList）は配列だけをキーにするモジュール単一の WeakMap なので、
    // 同じ配列を持つ 2 ツリーは同じ ListIndex を見る。**これは統合後も変わらない**。
    const aRow0 = rowListIndex(a.shadowRoot, 0);
    const bRow0 = rowListIndex(b.shadowRoot, 0);
    expect(bRow0).toBe(aRow0);

    // FLIP（impl-plan Phase 2 の C1b）: 今日のツリー非依存アドレスは (pathInfo, listIndex) で
    // intern されるので、2 ツリーで同一オブジェクトになる。統合後は stateElement がキーに入り、
    // ツリーごとに別オブジェクトになる — 反転するのはこの 2 つの期待値だけ。
    const pathInfo = getPathInfo("items.*");
    expect(createStateAddress(pathInfo, bRow0)).toBe(createStateAddress(pathInfo, aRow0));
    expect(getLoopContextByNode(b.shadowRoot.querySelector("li")!))
      .toBe(getLoopContextByNode(a.shadowRoot.querySelector("li")!));

    // ツリーを分けているのは絶対アドレスだけ
    expect(absOf(b.stateElement, "items.*", bRow0)).not.toBe(absOf(a.stateElement, "items.*", aRow0));
    expect(absOf(a.stateElement, "items.*", aRow0).absolutePathInfo.stateElement).toBe(a.stateElement);
    expect(absOf(b.stateElement, "items.*", bRow0).absolutePathInfo.stateElement).toBe(b.stateElement);

    a.host.remove();
    b.host.remove();
  });

  it("行バインディングの台帳が、同じ ListIndex でもツリーごとに引けること", async () => {
    const shared: IRow[] = [{ name: "s0" }, { name: "s1" }];
    const a = await mountTree(shared);
    const b = await mountTree(shared);
    const row0 = rowListIndex(a.shadowRoot, 0);
    expect(rowListIndex(b.shadowRoot, 0)).toBe(row0);

    const aNodes = nodesOf(peekBindingsForAddress(absOf(a.stateElement, "items.*.upper", row0)));
    const bNodes = nodesOf(peekBindingsForAddress(absOf(b.stateElement, "items.*.upper", row0)));
    expect(aNodes).toEqual([a.shadowRoot.querySelectorAll("li")[0]]);
    expect(bNodes).toEqual([b.shadowRoot.querySelectorAll("li")[0]]);

    a.host.remove();
    b.host.remove();
  });

  it("片方の行への書き込みが、もう一方の描画・キャッシュ・$updatedCallback に触れないこと", async () => {
    const shared: IRow[] = [{ name: "s0" }, { name: "s1" }];
    const a = await mountTree(shared);
    const b = await mountTree(shared);
    const row0 = rowListIndex(a.shadowRoot, 0);
    const bCacheBefore = getCacheEntryByAbsoluteStateAddress(absOf(b.stateElement, "items.*.upper", row0));
    expect(bCacheBefore?.value).toBe("S0");
    a.updatedLog.length = 0;
    b.updatedLog.length = 0;

    a.write((s) => { s["items.0.name"] = "via-a"; });
    await flush();

    // 行オブジェクトは共有なのでデータは両方から見えるが、通知されたのは a だけ。
    // b の台帳には誰も触れていないので、b は書き込み前の描画のまま残る
    expect(shared[0].name).toBe("via-a");
    expect(a.rows()).toEqual(["VIA-A", "S1"]);
    expect(b.rows()).toEqual(["S0", "S1"]);
    expect(a.updatedLog.length).toBe(1);
    expect(b.updatedLog.length).toBe(0);
    const bCacheAfter = getCacheEntryByAbsoluteStateAddress(absOf(b.stateElement, "items.*.upper", row0));
    expect(bCacheAfter).toBe(bCacheBefore);
    expect(bCacheAfter?.dirty).toBe(false);
    expect(getCacheEntryByAbsoluteStateAddress(absOf(a.stateElement, "items.*.upper", row0))?.value).toBe("VIA-A");

    // 逆向きも同じ: b へ書けば b だけが動き、a は自分の描画のまま
    b.write((s) => { s["items.0.name"] = "via-b"; });
    await flush();
    expect(b.rows()).toEqual(["VIA-B", "S1"]);
    expect(a.rows()).toEqual(["VIA-A", "S1"]);
    expect(b.updatedLog.length).toBe(1);
    expect(a.updatedLog.length).toBe(1);

    a.host.remove();
    b.host.remove();
  });

  it("片方のツリーを外しても、残ったツリーが同じ ListIndex で描画・更新を続けること", async () => {
    const shared: IRow[] = [{ name: "s0" }, { name: "s1" }];
    const a = await mountTree(shared);
    const b = await mountTree(shared);
    const row1 = rowListIndex(b.shadowRoot, 1);

    a.host.remove();
    await flush();

    b.write((s) => { s["items.1.name"] = "after"; });
    await flush();
    expect(b.rows()).toEqual(["S0", "AFTER"]);
    expect(rowListIndex(b.shadowRoot, 1)).toBe(row1);

    b.host.remove();
  });
});
