/**
 * integration.listLedgerParentKey.test.ts — 行の台帳（src/list/listIndexesByList.ts）の
 * キーを **(親, 配列)** の組にした変更（#256）の、親が `null` になる経路の固定。
 *
 * 組キーにしたことで「この親のもとに行が無い」が意味を持つようになった。無いときに
 * 他の親の行を借りると #256 の別名化に戻るので、借りずに鋳造する。そのぶん、
 * **親を null で鋳造する経路**が本当に null を親にしているかが効くようになった。
 * ハイドレーションは `createListIndex(null, block.index)` で行を無条件に鋳造する
 * （src/hydrateBindings.ts）。ルート直下のリストなら親は null で正しく、台帳も
 * ルート番兵のもとに入る ── それをここで固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { getListIndexesByList, getLastRegisteredListIndexes } from "../src/list/listIndexesByList";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

describe("ハイドレーションが鋳造する行（親は null）", () => {
  it("SSR 済みの for ブロックの行が、ルート番兵（親 null）のもとに登録されること", async () => {
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
    // 親 null のもとに 2 行。組キーでも「ルート直下のリスト」は番兵側に入る
    const rows = getListIndexesByList(items, null);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows!.map((r) => r.parentListIndex)).toEqual([null, null]);
    expect(rows!.map((r) => r.index)).toEqual([0, 1]);
    // 親を問わない最後の登録も同じ集合（別の親のもとに二重登録されていない）
    expect(getLastRegisteredListIndexes(items)).toBe(rows);
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
    const rowsBefore = getListIndexesByList(stateEl.__state.items, null);

    stateEl.createState("writable", (s: any) => { s["items.0.name"] = "Alicia"; });
    await flush();

    const after = Array.from(document.querySelectorAll("li"));
    expect(after.map((li) => li.textContent)).toEqual(["Alicia", "Bob"]);
    // 行 DOM は作り直されていない（ハイドレートした行 ListIndex がそのまま生きている）
    expect(after[0]).toBe(before[0]);
    expect(getListIndexesByList(stateEl.__state.items, null)).toBe(rowsBefore);
  });
});

/**
 * `$listKeys` の書き込み（src/proxy/methods/setByAddress.ts の setKeyedListByAddress）は、
 * ハイブリッド配列を格納する **前** に台帳を確定させて「以降は全経路がこれに合流する」
 * ようにしている。組キーにすると、その確定がどの親のもとに入るかが効く ——
 * ルート直下のリストなら親 null、行の下のリストならその行。両方を固定する。
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
    const rowsBefore = getListIndexesByList(stateEl.__state.items, null)!;
    expect(rowsBefore).toHaveLength(2);

    // fetch 相当: 同じキー・別オブジェクト
    stateEl.createState("writable", (s: any) => {
      s.items = [{ id: 1, name: "a2" }, { id: 2, name: "b2" }];
    });
    await flush();

    const after = Array.from(shadowRoot.querySelectorAll("li"));
    expect(after.map((li) => li.textContent)).toEqual(["a2", "b2"]);
    expect(after).toEqual(before); // キー一致行は行 DOM が据え置かれる
    // 新しい配列の台帳も親 null のもとにあり、行は同じオブジェクト
    const rowsAfter = getListIndexesByList(stateEl.__state.items, null)!;
    expect(rowsAfter).toEqual(rowsBefore);
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

    const rows = getListIndexesByList(stateEl.__state.items, null)!;
    const childRows = getListIndexesByList(stateEl.__state.items[0].children, rows[0])!;
    expect(childRows).toHaveLength(2);
    expect(childRows.map((r) => r.parentListIndex)).toEqual([rows[0], rows[0]]);
    // 行 1 の children は行 1 のもとにある（行 0 のもとには無い）
    expect(getListIndexesByList(stateEl.__state.items[1].children, rows[0])).toBeNull();
    expect(getListIndexesByList(stateEl.__state.items[1].children, rows[1])).toHaveLength(1);

    // 子リストだけを同じキー・別オブジェクトで差し替える
    stateEl.createState("writable", (s: any) => {
      s["items.0.children"] = [{ id: 11, name: "x2" }, { id: 12, name: "y2" }];
    });
    await flush();

    const kidsAfter = Array.from(shadowRoot.querySelectorAll("i"));
    expect(kidsAfter.map((i) => i.textContent)).toEqual(["x2", "y2", "z"]);
    expect(kidsAfter).toEqual(kidsBefore); // 行 DOM は据え置き
    const childRowsAfter = getListIndexesByList(stateEl.__state.items[0].children, rows[0])!;
    expect(childRowsAfter).toEqual(childRows);
    host.remove();
  });
});
