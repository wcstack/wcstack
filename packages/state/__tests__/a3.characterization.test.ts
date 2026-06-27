/**
 * a3.characterization.test.ts — A4 構造再構築のためのオラクル（route-a A3）。
 *
 * 反応性の「観測可能な契約」を現状コードで pin する。A4（walkDependency の flush 境界遅延 +
 * computed 同値短絡）を入れても、ここが緑のままなら表の挙動は保たれている、という番人。
 *  - computed チェーンの最終値
 *  - microtask coalescing（N回 set → flush 1回 → $updatedCallback 1回）
 *  - 同値 set の no-op
 *  - wildcard list 依存の伝播
 *  - updatedCallback の paths 集約
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`a3-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElementByName(shadowRoot, "default")!;
  return { host, shadowRoot, stateElement };
}

describe("A3 オラクル: 反応性の観測可能な契約", () => {
  it("computed チェーン（leaf→tens→label→caption）の最終DOM値", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        n: 0,
        get tens(this: any) { return Math.floor(this.n / 10); },
        get label(this: any) { return "T" + this.tens; },
        get caption(this: any) { return "[" + this.label + "]"; },
      },
      `<div id="cap" data-wcs="textContent: caption"></div>`,
    );
    stateElement.createState("writable", (s: any) => { s.n = 25; });
    await flush();
    expect(shadowRoot.querySelector("#cap")!.textContent).toBe("[T2]");
    stateElement.createState("writable", (s: any) => { s.n = 5; });
    await flush();
    expect(shadowRoot.querySelector("#cap")!.textContent).toBe("[T0]");
    host.remove();
  });

  it("coalescing: 同一tick内の複数set→flush1回→$updatedCallback1回・最終値のみ反映", async () => {
    const calls: string[][] = [];
    const { host, shadowRoot, stateElement } = await mount(
      {
        n: 0,
        get doubled(this: any) { return this.n * 2; },
        $updatedCallback(paths: string[]) { calls.push(paths); },
      },
      `<div id="d" data-wcs="textContent: doubled"></div>`,
    );
    calls.length = 0;
    stateElement.createState("writable", (s: any) => {
      for (let i = 1; i <= 100; i++) s.n = i; // 100回 set（最終 n=100）
    });
    await flush();
    expect(shadowRoot.querySelector("#d")!.textContent).toBe("200"); // 最終値のみ
    expect(calls.length).toBe(1); // flush 1回に集約
    // 契約: updatedCallback は「適用された binding のパス」を報告する（set した leaf n でなく、
    // 束縛されている getter doubled）。n は DOM 未束縛なので含まれない。
    expect(calls[0]).toContain("doubled");
    host.remove();
  });

  it("同値 set は no-op（$updatedCallback が発火しない）", async () => {
    const calls: string[][] = [];
    const { host, stateElement } = await mount(
      { v: "x", $updatedCallback(paths: string[]) { calls.push(paths); } },
      `<div data-wcs="textContent: v"></div>`,
    );
    calls.length = 0;
    stateElement.createState("writable", (s: any) => { s.v = "x"; }); // 同値
    await flush();
    expect(calls.length).toBe(0);
    stateElement.createState("writable", (s: any) => { s.v = "y"; }); // 変更
    await flush();
    expect(calls.length).toBe(1);
    host.remove();
  });

  it("wildcard list 依存: items.*.price 変更が items.*.tax getter→DOMへ伝播", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ id: 0, price: 100 }, { id: 1, price: 200 }],
        get "items.*.tax"(this: any) { return this["items.*.price"] * 0.1; },
      },
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: .tax"></li></template></ul>`,
    );
    const taxOf = (i: number) => shadowRoot.querySelectorAll("li")[i].textContent;
    expect(taxOf(0)).toBe("10");
    expect(taxOf(1)).toBe("20");
    stateElement.createState("writable", (s: any) => { s["items.1.price"] = 500; });
    await flush();
    expect(taxOf(0)).toBe("10");   // 変えてない行は不変
    expect(taxOf(1)).toBe("50");   // 変えた行の tax が伝播
    host.remove();
  });

  it("read-after-write 一貫性: sync ブロック内で set 直後に computed が最新値を返す", async () => {
    // ★ A4 の核心制約。現行は set 時に依存を dirty 化するため、同一 sync ブロック内で
    //   set 直後に computed を読むと最新値が返る。walkDependency を flush へ遅延すると
    //   この一貫性が壊れる（stale を返す）＝flush境界 computed 短絡が三色再実装を要する根拠。
    let read1: number | undefined;
    let read2: number | undefined;
    const { host, stateElement } = await mount(
      {
        n: 1,
        get d(this: any) { return this.n * 10; },
        get dd(this: any) { return this.d + 1; },
      },
      `<div data-wcs="textContent: dd"></div>`,
    );
    stateElement.createState("writable", (s: any) => {
      s.n = 5;
      read1 = s.d;   // set 直後に1段 computed
      read2 = s.dd;  // set 直後に2段 computed
    });
    expect(read1).toBe(50);  // 最新値（set時 dirty 化の帰結）
    expect(read2).toBe(51);  // 多段でも最新
    host.remove();
  });

  it("updatedCallback は1 batch の更新パスを集約して1回呼ばれる", async () => {
    const calls: string[][] = [];
    const { host, stateElement } = await mount(
      { a: 1, b: 1, $updatedCallback(paths: string[]) { calls.push([...paths].sort()); } },
      `<div data-wcs="textContent: a"></div><div data-wcs="textContent: b"></div>`,
    );
    calls.length = 0;
    stateElement.createState("writable", (s: any) => { s.a = 2; s.b = 2; });
    await flush();
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(["a", "b"]);
    host.remove();
  });
});
