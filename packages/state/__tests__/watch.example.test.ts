/**
 * watch.example.test.ts
 *
 * `examples/watch/index.html` が主張している 3 点を、同じ state 定義で固定する。
 * example は CDN 経由でしか実行されないため、壊れても誰も気づかない —— 主張が
 * 実装と食い違っていないことをここで担保する。
 *
 * 1. どこにもバインドされていない getter が watch で発火する（headless ＝ 存在理由）
 * 2. 行 watch が `(cur, prev, index)` を受け、ハンドラ内から `$resolve` で他フィールドを読める
 * 3. `$listKeys` 宣言下の全行置換では、変化した行だけが発火する
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import type { IState } from "../src/types";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
const FREE_SHIPPING_THRESHOLD = 20000;
let seq = 0;

/**
 * examples/watch/index.html の行リスト部分と同じバインド構成。
 *
 * example 本体は `<tbody><template data-wcs="for:">`（cart example と同じ形）だが、
 * happy-dom の innerHTML パースは table 内の `<template>` を保持しないため、
 * ここでは `<ul>` に置き換える。検証対象は state 側のロジックであり、
 * どの要素で回すかは結果に影響しない。
 */
const MARKUP = `
  <ul>
    <template data-wcs="for: items">
      <li>
        <span data-wcs="textContent: items.*.name"></span>
        <span data-wcs="textContent: items.*.qty"></span>
        <span data-wcs="textContent: items.*.lineTotal"></span>
      </li>
    </template>
  </ul>
  <p data-wcs="textContent: subtotalLabel"></p>
`;

function exampleState(): IState {
  return {
    items: [
      { id: 1, name: "Mechanical keyboard", price: 12000, qty: 1 },
      { id: 2, name: "USB-C cable", price: 1200, qty: 2 },
      { id: 3, name: "Desk mat", price: 3800, qty: 1 },
    ],
    log: [],
    banner: "",
    qualified: false,

    $listKeys: { items: "id" },

    get subtotal(this: any) {
      return this.$getAll("items.*.lineTotal", []).reduce((a: number, v: number) => a + v, 0);
    },
    get "items.*.lineTotal"(this: any) {
      return this["items.*.price"] * this["items.*.qty"];
    },
    get subtotalLabel(this: any) { return `¥${this.subtotal.toLocaleString()}`; },
    // どこにもバインドしない（= $updatedCallback では観測できない）
    get freeShipping(this: any) { return this.subtotal >= FREE_SHIPPING_THRESHOLD; },

    $watch: {
      "items.*.qty"(this: any, cur: unknown, prev: unknown, index: number) {
        const name = this.$resolve("items.*.name", [index]);
        this.log = [`${name}: ${prev} → ${cur}`, ...this.log].slice(0, 8);
      },
      freeShipping(this: any, cur: unknown, prev: unknown) {
        this.qualified = cur;
        if (cur === prev) return;
        this.banner = cur
          ? "🎉 Free shipping unlocked"
          : "Free shipping lost — back under the threshold";
      },
    },

    onInc(this: any, _event: Event, $1: number) {
      this.$resolve("items.*.qty", [$1], this.$resolve("items.*.qty", [$1]) + 1);
    },
    onRestock(this: any) {
      this.items = this.items.map((item: any) => ({ ...item, qty: item.id === 1 ? 2 : item.qty }));
    },
  } as unknown as IState;
}

async function mount() {
  const host = document.createElement(`watch-example-host-${++seq}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${MARKUP}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(exampleState());
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  const stateElement = getStateElement(shadowRoot)!;
  const read = (path: string) => {
    let value: unknown;
    stateElement.createState("readonly", (state) => { value = state[path]; });
    return value;
  };
  return { host, stateElement, read };
}

describe("examples/watch の主張", () => {
  it("初期状態: subtotal は 18200 で、バインドしていない freeShipping は接続時に評価済み", async () => {
    const { host, read } = await mount();
    // 12000*1 + 1200*2 + 3800*1 = 18200（しきい値 20000 の手前）
    expect(read("subtotal")).toBe(18200);
    // 接続時の初回評価で watch が走り、qualified が同期されている
    expect(read("qualified")).toBe(false);
    host.remove();
  });

  it("しきい値を跨いだ瞬間だけバナーが変わること（バインドしていない getter の watch）", async () => {
    const { host, stateElement, read } = await mount();
    expect(read("banner")).toBe("");

    // キーボードを +1（18200 → 30200）でしきい値 20000 を跨ぐ
    stateElement.createState("writable", (state) => { state.onInc(new Event("click"), 0); });
    await flush();

    expect(read("subtotal")).toBe(30200);
    expect(read("banner")).toBe("🎉 Free shipping unlocked");

    // 跨がない変化ではバナーは書き換わらない（cur === prev で早期 return）
    stateElement.createState("writable", (state) => { state.onInc(new Event("click"), 1); });
    await flush();
    expect(read("banner")).toBe("🎉 Free shipping unlocked");
    host.remove();
  });

  it("行 watch が (cur, prev, index) を受け、ハンドラ内の $resolve で行名を読めること", async () => {
    const { host, stateElement, read } = await mount();

    stateElement.createState("writable", (state) => { state.onInc(new Event("click"), 2); });
    await flush();

    expect(read("log")).toEqual(["Desk mat: 1 → 2"]);
    host.remove();
  });

  it("$listKeys 宣言下の全行置換では、変化した行だけが発火すること", async () => {
    const { host, stateElement, read } = await mount();

    stateElement.createState("writable", (state) => { state.onRestock(); });
    await flush();

    // 変わったのは id:1 の qty（1 → 2）だけ
    expect(read("log")).toEqual(["Mechanical keyboard: 1 → 2"]);
    host.remove();
  });
});
