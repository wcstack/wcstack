/**
 * bind-component の子スコープが「親スコープのリスト」を `for:` で回すケースの統合テスト。
 *
 * 規則 `state.items: rows` に対して子が `<template data-wcs="for: items">` を持つ形。
 * 値の正本は親 state にあり、行の同一性（listIndex）は配列オブジェクトの同一性で
 * 親子が共有している。この形はこれまで
 *   - 越境時に listIndex が落ちるため初期描画で `ListIndex not found` を投げ、
 *     子のバインディング初期化が完了しないまま止まる
 *   - 親 state がマップ先をリストと認識しないため依存 walk が行に展開されない
 *   - 親起点の行フィールド書き込みを購読する経路が無い
 * という 3 点で成立していなかった
 * （docs/architecture-hardening/15-state-component-mechanism-consistency.md §1.8）。
 *
 * 単体テストはどれも境界のどちらか片側しかモックできないため、ここでは実モジュールだけで
 * 親スコープと子コンポーネントを組み立てて往復を固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

/** shadow 内に `<wcs-state bind-component="state">` と任意のマークアップを持つコンポーネント */
function defineComponent(tag: string, initialState: Record<string, any>, innerTemplate: string): void {
  class Component extends HTMLElement {
    state: Record<string, any> = structuredClone(initialState);
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      this.shadowRoot!.innerHTML =
        `<wcs-state bind-component="state"></wcs-state>${innerTemplate}`;
    }
  }
  customElements.define(tag, Component);
}

const LIST_TEMPLATE =
  `<ul id="inner-view"><template data-wcs="for: items">` +
  `<li data-wcs="textContent: items.*.name"></li>` +
  `</template></ul>`;

async function mountListComponent(json: string, hostExtra = "") {
  const tag = uniqueTag("bclr-list");
  defineComponent(tag, {}, LIST_TEMPLATE);

  const host = document.createElement(uniqueTag("bclr-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `
    <wcs-state json='${json}'></wcs-state>
    ${hostExtra}
    <${tag} data-wcs="state.items: rows"></${tag}>
  `;
  document.body.appendChild(host);

  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);

  const component = shadowRoot.querySelector(tag) as HTMLElement;
  const childShadow = component.shadowRoot!;
  const childStateElement = childShadow.querySelector("wcs-state") as State;
  await childStateElement.connectedCallbackPromise;
  await State.getBindingsReady(childShadow);
  await flush();

  const rows = () => Array.from(childShadow.querySelectorAll("#inner-view li"));
  const rendered = () => rows().map((li) => li.textContent);

  return { host, shadowRoot, parentStateElement, childStateElement, component, childShadow, rows, rendered };
}

describe("bind-component: 子スコープの for が親スコープのリストを回す (integration)", () => {
  it("子の for が親のリストを描画すること", async () => {
    const { host, rendered } = await mountListComponent('{"rows":[{"name":"a"},{"name":"b"}]}');

    expect(rendered()).toEqual(["a", "b"]);

    host.remove();
  });

  it("マップ先をリストとして親 state に伝えること", async () => {
    const { host, parentStateElement, childStateElement } = await mountListComponent(
      '{"rows":[{"name":"a"}]}',
    );

    // v2 単一ツリー: 子の for は翻訳されて親の台帳にだけ載る（rows / rows.*）。
    // 子の <wcs-state> は独立ツリーを持たないので、子の台帳は空のまま
    expect([...parentStateElement.listPaths]).toContain("rows");
    expect([...parentStateElement.elementPaths]).toContain("rows.*");
    expect([...childStateElement.listPaths]).toEqual([]);

    host.remove();
  });

  it("親のリスト置換に子の描画が追随すること", async () => {
    const { host, parentStateElement, rendered } = await mountListComponent(
      '{"rows":[{"name":"a"},{"name":"b"}]}',
    );
    expect(rendered()).toEqual(["a", "b"]);

    parentStateElement.createState("writable", (s: any) => {
      s.rows = [{ name: "c" }, { name: "d" }, { name: "e" }];
    });
    await flush();

    expect(rendered()).toEqual(["c", "d", "e"]);

    host.remove();
  });

  it("親の行フィールド書き込みが子の行に届くこと", async () => {
    const { host, parentStateElement, rows, rendered } = await mountListComponent(
      '{"rows":[{"name":"a"},{"name":"b"}]}',
    );
    const before = rows();

    parentStateElement.createState("writable", (s: any) => {
      s["rows.1.name"] = "z";
    });
    await flush();

    expect(rendered()).toEqual(["a", "z"]);
    // 行そのものは作り直されない（差分は値だけ）
    expect(rows()[0]).toBe(before[0]);
    expect(rows()[1]).toBe(before[1]);

    host.remove();
  });

  it("子から行フィールドへ書き戻すと親 state に届くこと", async () => {
    const { host, parentStateElement, component, rendered } = await mountListComponent(
      '{"rows":[{"name":"a"},{"name":"b"}]}',
    );

    // v2: 子スコープの語彙での書き戻しは公開 chroot（element.state）を通す。
    //（$resolve の接頭辞翻訳は P2-9 — それまで $ API は親の意味論のまま）
    (component as any).state["items.1.name"] = "w";
    await flush();

    let parentRows: unknown;
    parentStateElement.createState("readonly", (s: any) => {
      parentRows = JSON.parse(JSON.stringify(s.rows));
    });
    expect(parentRows).toEqual([{ name: "a" }, { name: "w" }]);
    expect(rendered()).toEqual(["a", "w"]);

    host.remove();
  });

  it("行オブジェクトを保った並べ替えで行ノードが再利用されること", async () => {
    const { host, parentStateElement, rows, rendered } = await mountListComponent(
      '{"rows":[{"name":"a"},{"name":"b"}]}',
    );
    const [firstNode, secondNode] = rows();

    parentStateElement.createState("writable", (s: any) => {
      s.rows = [s.rows[1], s.rows[0]];
    });
    await flush();

    expect(rendered()).toEqual(["b", "a"]);
    // 値ベース diff で行の同一性が保たれる ＝ 親側の展開が行を作り直していない
    expect(rows()[0]).toBe(secondNode);
    expect(rows()[1]).toBe(firstNode);

    host.remove();
  });

  it("行が消えて増えても購読が壊れないこと（台帳の後始末）", async () => {
    const { host, parentStateElement, rendered } = await mountListComponent(
      '{"rows":[{"name":"a"},{"name":"b"}]}',
    );

    parentStateElement.createState("writable", (s: any) => {
      s.rows = [];
    });
    await flush();
    expect(rendered()).toEqual([]);

    parentStateElement.createState("writable", (s: any) => {
      s.rows = [{ name: "x" }, { name: "y" }];
    });
    await flush();
    expect(rendered()).toEqual(["x", "y"]);

    // 作り直された行にも親起点の書き込みが届く
    parentStateElement.createState("writable", (s: any) => {
      s["rows.0.name"] = "X";
    });
    await flush();
    expect(rendered()).toEqual(["X", "y"]);

    host.remove();
  });

  it("同じリストを親スコープでも描画しているとき双方が追随すること", async () => {
    const { host, parentStateElement, shadowRoot, rendered } = await mountListComponent(
      '{"rows":[{"name":"a"},{"name":"b"}]}',
      `<ul id="host-view"><template data-wcs="for: rows">` +
      `<li data-wcs="textContent: rows.*.name"></li></template></ul>`,
    );
    const hostRendered = () =>
      Array.from(shadowRoot.querySelectorAll("#host-view li")).map((li) => li.textContent);

    expect(hostRendered()).toEqual(["a", "b"]);
    expect(rendered()).toEqual(["a", "b"]);

    parentStateElement.createState("writable", (s: any) => {
      s["rows.0.name"] = "z";
    });
    await flush();

    expect(hostRendered()).toEqual(["z", "b"]);
    expect(rendered()).toEqual(["z", "b"]);

    host.remove();
  });

  it("同じコンポーネントの複数インスタンスが別々のリストに独立して追随すること", async () => {
    // リストであることの伝播も行の購読も state 要素インスタンス単位で成立する必要がある。
    // テンプレート単位で 1 回しか登録されないと 2 つ目以降が無言で死ぬ。
    const tag = uniqueTag("bclr-list");
    defineComponent(tag, {}, LIST_TEMPLATE);

    const host = document.createElement(uniqueTag("bclr-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <wcs-state json='{"left":[{"name":"a"}],"right":[{"name":"x"},{"name":"y"}]}'></wcs-state>
      <${tag} id="c1" data-wcs="state.items: left"></${tag}>
      <${tag} id="c2" data-wcs="state.items: right"></${tag}>
    `;
    document.body.appendChild(host);

    const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
    await parentStateElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    for (const id of ["#c1", "#c2"]) {
      const childShadow = (shadowRoot.querySelector(id) as HTMLElement).shadowRoot!;
      await (childShadow.querySelector("wcs-state") as State).connectedCallbackPromise;
      await State.getBindingsReady(childShadow);
    }
    await flush();

    const view = (id: string) =>
      Array.from(
        (shadowRoot.querySelector(id) as HTMLElement).shadowRoot!.querySelectorAll("#inner-view li"),
      ).map((li) => li.textContent);

    expect(view("#c1")).toEqual(["a"]);
    expect(view("#c2")).toEqual(["x", "y"]);
    expect([...parentStateElement.listPaths]).toEqual(expect.arrayContaining(["left", "right"]));

    parentStateElement.createState("writable", (s: any) => {
      s["left.0.name"] = "A";
      s["right.1.name"] = "Y";
    });
    await flush();

    expect(view("#c1")).toEqual(["A"]);
    expect(view("#c2")).toEqual(["x", "Y"]);

    host.remove();
  });

  // P2-9（$ API の接頭辞翻訳・設計書 §4-6）で green に反転したら .fails を外すこと
  it.fails("子から $getAll でマップ先のリストを横断的に読めること（P2-9 待ち）", async () => {
    const { host, component } = await mountListComponent(
      '{"rows":[{"name":"a"},{"name":"b"},{"name":"c"}]}',
    );

    // v2 の形: 公開 chroot の $getAll が内側の語彙（items.*）を受ける
    const names = ((component as any).state as any).$getAll("items.*.name", []);
    expect(names).toEqual(["a", "b", "c"]);

    host.remove();
  });

  it("コンポーネント自身が親の for の中にいる形（従来の成立形）が壊れていないこと", async () => {
    const tag = uniqueTag("bclr-row");
    // v2 の厳格 R1: 既定値 { row: {} } は私有になりマッピングを隠す（D19）— 既定値を持たない形が正
    defineComponent(tag, {}, `<span id="inner-view" data-wcs="textContent: row.name"></span>`);

    const host = document.createElement(uniqueTag("bclr-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <wcs-state json='{"rows":[{"name":"a"},{"name":"b"}]}'></wcs-state>
      <ul><template data-wcs="for: rows"><li><${tag} data-wcs="state.row: rows.*"></${tag}></li></template></ul>
    `;
    document.body.appendChild(host);

    const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
    await parentStateElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flush();
    await flush();

    const rendered = () =>
      Array.from(shadowRoot.querySelectorAll(tag))
        .map((c) => (c as HTMLElement).shadowRoot?.querySelector("#inner-view")?.textContent);

    expect(rendered()).toEqual(["a", "b"]);

    parentStateElement.createState("writable", (s: any) => {
      s["rows.0.name"] = "z";
    });
    await flush();
    await flush();

    expect(rendered()).toEqual(["z", "b"]);

    host.remove();
  });

  it("親からのバインドが無いコンポーネント（plain）のローカルリストが従来どおり動くこと", async () => {
    const tag = uniqueTag("bclr-plain");
    defineComponent(tag, { items: [{ name: "a" }] }, LIST_TEMPLATE);

    const host = document.createElement(uniqueTag("bclr-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <wcs-state json='{"rows":[]}'></wcs-state>
      <${tag}></${tag}>
    `;
    document.body.appendChild(host);

    const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
    await parentStateElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    const component = shadowRoot.querySelector(tag) as HTMLElement;
    const childShadow = component.shadowRoot!;
    const childStateElement = childShadow.querySelector("wcs-state") as State;
    await childStateElement.connectedCallbackPromise;
    await State.getBindingsReady(childShadow);
    await flush();

    const rendered = () =>
      Array.from(childShadow.querySelectorAll("#inner-view li")).map((li) => li.textContent);
    expect(rendered()).toEqual(["a"]);
    // ローカルなリストなので親スコープへは伝播しない
    expect([...parentStateElement.listPaths]).not.toContain("rows");

    childStateElement.createState("writable", (s: any) => {
      s.items = [{ name: "p" }, { name: "q" }];
    });
    await flush();
    expect(rendered()).toEqual(["p", "q"]);

    host.remove();
  });
});
