/**
 * integration.listLedgerParentKey.test.ts — 行の台帳（src/list/listIndexesByList.ts）が
 * 「生きた共有」と「陳腐化」を分けることの、親が特殊になる経路での固定（#256）。
 *
 * 台帳は 1 本の配列につき行集合 1 組。行がぶら下がる親が**退役している**ときだけ、
 * 行の identity を保ったまま生きた親へ付け替える。付け替えの可否は親の深さ
 * （`position`）で決まるので、**行を鋳造するときの親**が何になるかが効く ──
 * ハイドレーションは `createListIndex(null, block.index)` で常に親 null で鋳造し、
 * `$listKeys` の書き込みはハイブリッド配列を格納する前に台帳を確定させる。
 * どちらも方針書が名指しで求めた特殊例なので、実測して固定する。
 *
 * **行 DOM が据え置かれることは `toBe`（identity）で書く。** `toEqual` は構造比較なので、
 * 行ノードが全部作り直されていても同じ文字列なら通ってしまう。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getListIndexesByList } from "../src/list/listIndexesByList";
import { clientLoad, serverRender } from "./helpers/ssrRoundTrip";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

describe("ハイドレーションが鋳造する行（親は null）", () => {
  it("SSR 済みの for ブロックの行が、親 null で登録されること", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":[{"name":"Alice"},{"name":"Bob"}]}</script>
        <template id="lk0" data-wcs="for: items">
          <li data-wcs="textContent: items.*.name"></li>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"items":[]}'></wcs-state>
      <ul>
        <!--@@wcs-for:lk0-->
        <!--@@wcs-for-start:lk0:items:0--><li data-wcs="textContent: items.*.name">Alice</li><!--@@wcs-for-end:lk0:items:0-->
        <!--@@wcs-for-start:lk0:items:1--><li data-wcs="textContent: items.*.name">Bob</li><!--@@wcs-for-end:lk0:items:1-->
      </ul>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise((resolve) => setTimeout(resolve, 200));

    const items = stateEl.__state.items;
    expect(items).toHaveLength(2);
    const rows = getListIndexesByList(items);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows!.map((r) => r.parentListIndex)).toEqual([null, null]);
    expect(rows!.map((r) => r.index)).toEqual([0, 1]);
  });

  it("ハイドレートした行がそのまま更新に使われること（行を作り直していない）", async () => {
    document.body.innerHTML = `
      <wcs-ssr name="default">
        <script type="application/json">{"items":[{"name":"Alice"},{"name":"Bob"}]}</script>
        <template id="lk1" data-wcs="for: items">
          <li data-wcs="textContent: items.*.name"></li>
        </template>
      </wcs-ssr>
      <wcs-state enable-ssr json='{"items":[]}'></wcs-state>
      <ul>
        <!--@@wcs-for:lk1-->
        <!--@@wcs-for-start:lk1:items:0--><li data-wcs="textContent: items.*.name">Alice</li><!--@@wcs-for-end:lk1:items:0-->
        <!--@@wcs-for-start:lk1:items:1--><li data-wcs="textContent: items.*.name">Bob</li><!--@@wcs-for-end:lk1:items:1-->
      </ul>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await new Promise((resolve) => setTimeout(resolve, 200));

    const before = Array.from(document.querySelectorAll("li"));
    const rowsBefore = getListIndexesByList(stateEl.__state.items);

    stateEl.createState("writable", (s: any) => { s["items.0.name"] = "Alicia"; });
    await flush();

    const after = Array.from(document.querySelectorAll("li"));
    expect(after.map((li) => li.textContent)).toEqual(["Alicia", "Bob"]);
    expect(after[0], "行 DOM は同じノード").toBe(before[0]);
    expect(after[1], "行 DOM は同じノード").toBe(before[1]);
    expect(getListIndexesByList(stateEl.__state.items)).toBe(rowsBefore);
  });
});

/**
 * `$listKeys` の書き込み（setKeyedListByAddress）は、ハイブリッド配列を格納する**前**に
 * 台帳を確定させて「以降は全経路がこれに合流する」ようにしている。単一スロットの台帳でも
 * 「どの親のもとで確定するか」は効く（付け替えの可否が親の深さで決まるため）。
 */
let seq = 0;
async function mountKeyed(initial: any, innerHTML: string) {
  const host = document.createElement(`lkpk-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as any;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await (stateEl.constructor as any).getBindingsReady(shadowRoot);
  return { host, shadowRoot, stateEl };
}

describe("$listKeys が先に確定させる台帳", () => {
  it("ルートのキー付きリストは、親 null の台帳に合流し行 DOM を保つこと", async () => {
    const initial: any = {
      $listKeys: { items: "id" },
      items: [{ id: 1, name: "a" }, { id: 2, name: "b" }],
    };
    const { host, shadowRoot, stateEl } = await mountKeyed(initial,
      `<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>`);
    const before = Array.from(shadowRoot.querySelectorAll("li"));
    expect(before.map((li) => li.textContent)).toEqual(["a", "b"]);
    const rowsBefore = getListIndexesByList(stateEl.__state.items)!;
    expect(rowsBefore).toHaveLength(2);

    // fetch 相当: 同じキー・別オブジェクト
    stateEl.createState("writable", (s: any) => {
      s.items = [{ id: 1, name: "a2" }, { id: 2, name: "b2" }];
    });
    await flush();

    const after = Array.from(shadowRoot.querySelectorAll("li"));
    expect(after.map((li) => li.textContent)).toEqual(["a2", "b2"]);
    // 行 DOM が据え置かれること ＝ **同じノード**であること（toEqual では全部作り直しても通る）
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    // 新しい配列の台帳も親 null のもとにあり、行オブジェクトも同じ
    const rowsAfter = getListIndexesByList(stateEl.__state.items)!;
    expect(rowsAfter[0]).toBe(rowsBefore[0]);
    expect(rowsAfter[1]).toBe(rowsBefore[1]);
    host.remove();
  });

  it("行の下のキー付きリストは、その行を親とする台帳に確定すること", async () => {
    const initial: any = {
      $listKeys: { items: "id", "items.*.children": "id" },
      items: [
        { id: 1, name: "a", children: [{ id: 11, name: "x" }, { id: 12, name: "y" }] },
        { id: 2, name: "b", children: [{ id: 21, name: "z" }] },
      ],
    };
    const { host, shadowRoot, stateEl } = await mountKeyed(initial,
      `<ul><template data-wcs="for: items"><li>{{ .name }}` +
      `<template data-wcs="for: items.*.children"><i>{{ .name }}</i></template>` +
      `</li></template></ul>`);
    const kidsBefore = Array.from(shadowRoot.querySelectorAll("i"));
    expect(kidsBefore.map((i) => i.textContent)).toEqual(["x", "y", "z"]);

    const rows = getListIndexesByList(stateEl.__state.items)!;
    const childRows = getListIndexesByList(stateEl.__state.items[0].children)!;
    expect(childRows).toHaveLength(2);
    expect(childRows.map((r) => r.parentListIndex)).toEqual([rows[0], rows[0]]);
    // 行 1 の children は別の配列なので別の行集合
    const otherRows = getListIndexesByList(stateEl.__state.items[1].children)!;
    expect(otherRows).toHaveLength(1);
    expect(otherRows).not.toBe(childRows);
    expect(otherRows.map((r) => r.parentListIndex)).toEqual([rows[1]]);

    // 子リストだけを同じキー・別オブジェクトで差し替える
    stateEl.createState("writable", (s: any) => {
      s["items.0.children"] = [{ id: 11, name: "x2" }, { id: 12, name: "y2" }];
    });
    await flush();

    const kidsAfter = Array.from(shadowRoot.querySelectorAll("i"));
    expect(kidsAfter.map((i) => i.textContent)).toEqual(["x2", "y2", "z"]);
    // 行 DOM は据え置き ＝ 同じノード
    expect(kidsAfter[0]).toBe(kidsBefore[0]);
    expect(kidsAfter[1]).toBe(kidsBefore[1]);
    expect(kidsAfter[2]).toBe(kidsBefore[2]);
    const childRowsAfter = getListIndexesByList(stateEl.__state.items[0].children)!;
    expect(childRowsAfter[0]).toBe(childRows[0]);
    expect(childRowsAfter[1]).toBe(childRows[1]);
    host.remove();
  });
});

/**
 * 方針書が名指しで求めた特殊例その 1: **ホストの `for` の中の子スコープ（入れ子の for）をハイドレートする形**。
 *
 * 旧: `hydrateBindings` は for ブロックの行を `createListIndex(null, block.index)` で常に親 null で
 * 鋳造し、内側の for ブロックは台帳に載らなかった（手書きの断片での実測: 内側への `$resolve` が
 * `ListIndexes not found` で落ち、DOM は SSR のまま）。実際のサーバー出力ではさらに悪く、
 * `ListIndex not found` でハイドレーション全体が止まっていた（#258）。
 *
 * 今は入れ子の for をハイドレーションせず、クライアントの全描画に倒す（#258）。行は通常の描画が
 * 鋳造するので、内側の行の親は外側の行になり、内側への書き込みが届く。fixture はサーバーに描かせる
 * （helpers/ssrRoundTrip.ts）。
 */
describe("ハイドレーション: ホストの for の中の子スコープ（入れ子の for — 全描画に倒す）", () => {
  it("内側の行が外側の行を親として台帳に載り、子スコープへの $resolve が DOM に届くこと", async () => {
    const make = (): any => ({ groups: [{ title: "G1", items: [{ name: "x" }, { name: "y" }] }] });
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state><div id="outer"><template data-wcs="for: groups">` +
      `<div class="group"><h3 data-wcs="textContent: .title"></h3>` +
      `<template data-wcs="for: .items"><i data-wcs="textContent: .name"></i></template></div></template></div>`,
      make);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stateEl = await clientLoad(html, make) as any;
    expect(warnSpy.mock.calls.map((args) => String(args[0]))).toEqual([
      `[@wcstack/state] SSR: "for: groups.*.items" in "for: groups" (known limitation). Falling back to full render.`,
    ]);
    warnSpy.mockRestore();

    const txt = () => Array.from(document.querySelectorAll("i")).map((i) => i.textContent);
    expect(txt()).toEqual(["x", "y"]);
    expect(document.querySelectorAll(".group")).toHaveLength(1);
    const outerRows = getListIndexesByList(stateEl.__state.groups)!;
    expect(outerRows.map((r) => r.parentListIndex)).toEqual([null]);
    // 内側の配列は外側の行を親として載る（旧: null — どの親のもとにも載っていなかった）
    const innerRows = getListIndexesByList(stateEl.__state.groups[0].items)!;
    expect(innerRows).toHaveLength(2);
    expect(innerRows.map((r) => r.parentListIndex)).toEqual([outerRows[0], outerRows[0]]);

    stateEl.createState("writable", (s: any) => {
      s.$resolve("groups.*.items.*.name", [0, 0], "x2");
    });
    await flush();
    expect(txt(), "旧: ListIndexes not found で throw し、DOM は SSR のまま").toEqual(["x2", "y"]);
  });
});

/**
 * 方針書が名指しで求めた特殊例その 2: **bind-component のスコープ下のキー付きリスト**。
 * ホストが `$listKeys` を宣言し、子コンポーネントがその配列を自分の `for` で描く。
 * キー一致の差し替えで行 DOM が据え置かれること（＝台帳が合流していること）を
 * identity で固定する。
 */
describe("$listKeys: bind-component のスコープ下", () => {
  it("ホストのキー付き子リストを差し替えても、子スコープの行 DOM が同じノードであること", async () => {
    const tag = `lkpk-kid-${seq++}`;
    class Kid extends HTMLElement {
      state: Record<string, any> = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.shadowRoot!.innerHTML =
          `<wcs-state bind-component="state"></wcs-state>` +
          `<ul id="kid-view"><template data-wcs="for: items">` +
          `<li data-wcs="textContent: items.*.name"></li></template></ul>`;
      }
    }
    customElements.define(tag, Kid);

    const host = document.createElement(`lkpk-khost-${seq++}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state></wcs-state>` +
      `<div id="outer"><template data-wcs="for: groups">` +
      `<${tag} data-wcs="state.items: groups.*.children"></${tag}>` +
      `</template></div>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      $listKeys: { "groups.*.children": "id" },
      groups: [{ children: [{ id: 1, name: "a" }, { id: 2, name: "b" }] }],
    });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    const kid = shadowRoot.querySelector(tag) as HTMLElement;
    await (kid.shadowRoot!.querySelector("wcs-state") as State).connectedCallbackPromise;
    await State.getBindingsReady(kid.shadowRoot!);
    await flush();

    const rowsOf = () => Array.from(kid.shadowRoot!.querySelectorAll("#kid-view li"));
    const before = rowsOf();
    expect(before.map((li) => li.textContent)).toEqual(["a", "b"]);

    // 同じキー・別オブジェクト（fetch 相当）
    stateEl.createState("writable", (s: any) => {
      s.$resolve("groups.*.children", [0], [{ id: 1, name: "a2" }, { id: 2, name: "b2" }]);
    });
    await flush();

    const after = rowsOf();
    expect(after.map((li) => li.textContent)).toEqual(["a2", "b2"]);
    expect(after[0], "キー一致行は同じノード").toBe(before[0]);
    expect(after[1], "キー一致行は同じノード").toBe(before[1]);
    host.remove();
  });
});
