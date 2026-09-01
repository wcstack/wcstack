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
