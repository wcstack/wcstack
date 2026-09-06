/**
 * Phase 2 のマウントスコープ構築（webComponent/mountScope.ts）のプローブ統合テスト。
 *
 * まだ State.ts には配線されていないので、ホストの準備完了後に手でマウント記録を組んで
 * initializeMountScope を呼ぶ。検証するのは impl-plan §3-0 の核 — 変換されたバインディングが
 * **親スコープにインラインで書かれたものと同じ経路**（台帳・静的依存・パターン台帳・
 * ループ文脈の境界ホップ）で流れること。子側に state 要素・橋渡しは一切無い。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { buildMountRecord } from "../src/webComponent/mount";
import { initializeMountScope } from "../src/webComponent/mountScope";
import { getBindingsByNode } from "../src/bindings/getBindingsByNode";
import { getBindingsReady } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));

let counter = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++counter}`;

/** Shadow を持つが `<wcs-state bind-component>` を持たないコンポーネント（v2 の子は素の DOM） */
function defineShell(tag: string, innerTemplate: string): void {
  class Shell extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
    }
    connectedCallback() {
      if (this.shadowRoot!.childElementCount === 0) {
        this.shadowRoot!.innerHTML = innerTemplate;
      }
    }
  }
  customElements.define(tag, Shell);
}

async function mountHost(json: string, body: string) {
  const host = document.createElement(uniqueTag("ms-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state json='${json}'></wcs-state>${body}`;
  document.body.appendChild(host);
  const parentStateElement = shadowRoot.querySelector("wcs-state") as State;
  await parentStateElement.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  await flush();
  return { host, shadowRoot, parentStateElement };
}

/** ホストの `stateProp` バインディングからマウント記録を組み、スコープを構築する */
function mountComponent(component: Element, parentStateElement: State, stateObject: Record<string, any> = {}) {
  const hostBindings = (getBindingsByNode(component) ?? []).filter((b) => b.propSegments[0] === "state");
  const record = buildMountRecord(component, "state", hostBindings, parentStateElement as any, stateObject);
  initializeMountScope(record, component.shadowRoot as ShadowRoot);
  return record;
}

const text = (root: ParentNode, selector: string) => (root.querySelector(selector) as HTMLElement).textContent;

describe("mountScope: 丸ごとマウントの構築（配線前プローブ）", () => {
  it("変換されたバインディングが親ツリーを読み、親の書き込み（部分・丸ごと）が静的依存だけで届くこと", async () => {
    const tag = uniqueTag("ms-card");
    defineShell(tag,
      `<span class="name" data-wcs="textContent: name"></span>` +
      `<p class="mustache">{{ email }}</p>` +
      `<template data-wcs="if: active"><span class="on">on</span></template>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"user":{"name":"Alice","email":"a@x","active":false}}',
      `<${tag} data-wcs="state: user"></${tag}>`,
    );
    const component = shadowRoot.querySelector(tag)!;
    mountComponent(component, parentStateElement);
    await flush();

    const cs = component.shadowRoot!;
    expect(text(cs, ".name")).toBe("Alice");
    expect(text(cs, ".mustache")).toBe("a@x");
    expect(cs.querySelector(".on")).toBeNull();

    // 部分書き込み: 親の絶対アドレス台帳に登録済みなので通常の drain で届く
    parentStateElement.createState("writable", (s: any) => {
      s["user.name"] = "Carol";
      s["user.active"] = true;
    });
    await flush();
    await flush();
    expect(text(cs, ".name")).toBe("Carol");
    expect(cs.querySelector(".on")).not.toBeNull();

    // 丸ごと差し替え: setPathInfo が張った静的依存（user → user.name …）だけで届く。
    // v1 の「値を運ばない再読込通知チャネル」は要らない
    parentStateElement.createState("writable", (s: any) => {
      s.user = { name: "Dana", email: "d@x", active: false };
    });
    await flush();
    await flush();
    expect(text(cs, ".name")).toBe("Dana");
    expect(text(cs, ".mustache")).toBe("d@x");
    expect(cs.querySelector(".on")).toBeNull();

    // getBindingsReady(childShadow) の互換面
    await expect(getBindingsReady(component.shadowRoot!)).resolves.toBeUndefined();

    host.remove();
  });

  it("行マウント（state: .）: 境界ホップで listIndex を継承し、内側の for が users.*.tags.* を回すこと", async () => {
    const tag = uniqueTag("ms-row");
    defineShell(tag,
      `<span class="name" data-wcs="textContent: name"></span>` +
      `<ul class="tags"><template data-wcs="for: tags"><li data-wcs="textContent: .name"></li></template></ul>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"users":[{"name":"Anna","tags":[{"name":"x"}]},{"name":"Ben","tags":[{"name":"y"},{"name":"z"}]}]}',
      `<div id="rows"><template data-wcs="for: users"><${tag} data-wcs="state: ."></${tag}></template></div>`,
    );
    const rows = () => Array.from(shadowRoot.querySelectorAll(tag));
    for (const row of rows()) {
      mountComponent(row, parentStateElement);
    }
    await flush();

    const names = () => rows().map((row) => text(row.shadowRoot!, ".name"));
    const tags = (i: number) => Array.from(rows()[i].shadowRoot!.querySelectorAll(".tags li")).map((li) => li.textContent);
    expect(names()).toEqual(["Anna", "Ben"]);
    expect(tags(0)).toEqual(["x"]);
    expect(tags(1)).toEqual(["y", "z"]);

    // 行フィールドの書き込みはパターン台帳（listIndex 共有）でその行だけに届く
    parentStateElement.createState("writable", (s: any) => {
      s["users.1.name"] = "Bennett";
    });
    await flush();
    await flush();
    expect(names()).toEqual(["Anna", "Bennett"]);

    // 行の配列の差し替え: 親の listPaths / 静的依存が（フラグメント登録の setPathInfo で）
    // 揃っているので、内側の for が追随する
    parentStateElement.createState("writable", (s: any) => {
      s["users.0.tags"] = [...s["users.0.tags"], { name: "w" }];
    });
    await flush();
    await flush();
    expect(tags(0)).toEqual(["x", "w"]);
    expect(tags(1)).toEqual(["y", "z"]);

    host.remove();
  });
});

/**
 * 1 スコープ根 1 マウント（v2 の制約）— v2 レビューの修理。
 * 2 本目（別 stateProp）を受けると 1 本目の session を dispose した上、収集済み
 * ノードは registeredNodeSet が弾いて再収集されず、スコープ全体が無言で死ぬ。
 * 設定ミスとして 1 本目に触れる前に raise することをピンする。
 */
describe("mountScope: 1 スコープ根 1 マウント", () => {
  it("同じスコープ根への別 stateProp のマウント初期化は raise し、既存スコープを壊さないこと", async () => {
    const { getPathInfo } = await import("../src/address/PathInfo");
    const tag = uniqueTag("ms-dup");
    defineShell(tag, `<span class="name" data-wcs="textContent: name"></span>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"user":{"name":"Alice"},"theme":{"mode":"light"}}',
      `<${tag} data-wcs="state: user"></${tag}>`,
    );
    const component = shadowRoot.querySelector(tag)!;
    mountComponent(component, parentStateElement);
    await flush();
    const cs = component.shadowRoot!;
    expect(text(cs, ".name")).toBe("Alice");

    const record2 = buildMountRecord(
      component,
      "other",
      [{
        propName: "other", propSegments: ["other"], propModifiers: [],
        statePathName: "theme", statePathInfo: getPathInfo("theme"),
        inFilters: [], outFilters: [], bindingType: "prop", uuid: null,
        node: component, replaceNode: component,
      } as any],
      parentStateElement as any,
      {},
    );
    expect(() => initializeMountScope(record2, component.shadowRoot as ShadowRoot))
      .toThrow(/one <wcs-state bind-component> per component/);

    // 1 本目のスコープは無傷（親の書き込みが届く）
    parentStateElement.createState("writable", (s: any) => { s["user.name"] = "Carol"; });
    await flush();
    await flush();
    expect(text(cs, ".name")).toBe("Carol");

    host.remove();
  });
});

/**
 * D22 同型の防御（レビュー修理）: マウント記録の居る親ツリーの丸ごと再 set
 * （接続中の setInitialState）は、マーカーの getterPaths・台帳・翻訳済みバインディングの
 * 前提を全て無言で壊すため loud に落とす。
 */
describe("mountScope: マウントの居る親への丸ごと再 set の防御", () => {
  it("マウント記録の居る親への setInitialState（S13 再 set）は throw し、スコープは無傷であること", async () => {
    const tag = uniqueTag("ms-reset");
    defineShell(tag, `<span class="name" data-wcs="textContent: name"></span>`);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"user":{"name":"Alice"}}',
      `<${tag} data-wcs="state: user"></${tag}>`,
    );
    const component = shadowRoot.querySelector(tag)!;
    mountComponent(component, parentStateElement);
    await flush();
    const cs = component.shadowRoot!;
    expect(text(cs, ".name")).toBe("Alice");

    // 旧挙動: 無言で新 state に差し替わり、マーカーの getterPaths・台帳の前提が消えていた
    expect(() => parentStateElement.setInitialState({ user: { name: "X" } }))
      .toThrow(/grafted volumes or mounted components/);

    // スコープは無傷（親の書き込みが届く）
    parentStateElement.createState("writable", (s: any) => { s["user.name"] = "Carol"; });
    await flush();
    await flush();
    expect(text(cs, ".name")).toBe("Carol");

    host.remove();
  });
});

/**
 * own result への forPath 伝播（v2 レビューの修理 — collectStructuralFragments）:
 * 翻訳がワイルドカードを増やす部分マウントでは、for の内側の `if: $n`（テンプレート
 * 自身の条件）も囲む for のシフト量で繰り上がる必要がある。旧挙動: own result の変換
 * だけ forPath 無しで呼ばれてシフトが Δ（部分マウントのみ＝0）に落ち、`$1` が外側
 * group の添字に無言で解決されていた（group 0 は全行 first / group 1 は 0 行）。
 */
describe("mountScope: 部分マウント内の for + if: $n（own result の繰り上がり）", () => {
  it("state.items: groups.*.children 内の for: items の中の if: $1|eq(0) が各グループの先頭行だけに立つこと", async () => {
    const tag = uniqueTag("ms-grp");
    // 部分マウント（state.items）のホスト側初期適用は element.state.items へ書く —
    // 実配線のコンポーネントと同じく state フィールドを持つシェルにする
    const innerTemplate =
      `<ul class="items"><template data-wcs="for: items"><li>` +
      `<template data-wcs="if: $1|eq(0)"><em class="first">first</em></template>` +
      `<span class="val" data-wcs="textContent: .v"></span>` +
      `</li></template></ul>`;
    class GroupShell extends HTMLElement {
      state: Record<string, any> = {};
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
      }
      connectedCallback() {
        if (this.shadowRoot!.childElementCount === 0) {
          this.shadowRoot!.innerHTML = innerTemplate;
        }
      }
    }
    customElements.define(tag, GroupShell);
    const { host, shadowRoot, parentStateElement } = await mountHost(
      '{"groups":[{"children":[{"v":"a"},{"v":"b"}]},{"children":[{"v":"c"},{"v":"d"}]}]}',
      `<div id="rows"><template data-wcs="for: groups"><${tag} data-wcs="state.items: .children"></${tag}></template></div>`,
    );
    const comps = () => Array.from(shadowRoot.querySelectorAll(tag));
    expect(comps()).toHaveLength(2);
    for (const comp of comps()) {
      mountComponent(comp, parentStateElement);
    }
    await flush();
    await flush();

    const vals = (i: number) =>
      Array.from(comps()[i].shadowRoot!.querySelectorAll("li .val")).map((el) => el.textContent);
    const firsts = (i: number) =>
      Array.from(comps()[i].shadowRoot!.querySelectorAll("li")).map((li) => li.querySelector(".first") !== null);
    expect(vals(0)).toEqual(["a", "b"]);
    expect(vals(1)).toEqual(["c", "d"]);
    // 各グループの先頭行（子の添字 $2 = 0）だけに first が立つ
    expect(firsts(0)).toEqual([true, false]);
    expect(firsts(1)).toEqual([true, false]);

    host.remove();
  });
});
