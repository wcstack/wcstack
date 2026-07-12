/**
 * integration.divergentLedgerReplacement.test.ts — 台帳が分岐した配列への
 * リスト置換（calcDiffIndexes 経路）の回帰テスト。
 *
 * 同じ行オブジェクトを含む2つの配列がそれぞれ別パスで描画されると、
 * 各配列は互いに接続されない listIndex 台帳を持つ（identity の分岐）。
 * その一方の配列をもう一方のパスへ代入すると diff は calcDiffIndexes を通る。
 * 旧実装は changeIndexSet を値マッチングで oldIndexes 側のオブジェクトから
 * 作っていたため、newIndexes に存在しない「孤児マーカー」が混入し、
 * walkDependency の diff 展開が破棄予定の旧行を余計に dirty 化していた
 * （applyChangeToFor の has() には一致しないため描画自体は add+delete で正しい）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";
import { registerUpdateBatchListener, unregisterUpdateBatchListener } from "../src/updater/updater";
import type { IAbsoluteStateAddress } from "../src/address/types";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`divergent-host-${seq++}`);
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

describe("台帳が分岐した配列へのリスト置換（calcDiffIndexes）", () => {
  it("別パスで描画済みの配列を代入したとき、破棄予定の旧行が dirty 化・drain バッチに混入しないこと", async () => {
    const r1 = { name: "a" };
    const r2 = { name: "b" };
    let evals = 0;
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [r1, r2],
        others: [r2, r1], // 同じ行オブジェクト・別配列 = 台帳が分岐する
        get "items.*.label"(this: any) { evals++; return this["items.*.name"]; },
      },
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: .label"></li></template></ul>
       <ol><template data-wcs="for: others"><li>{{ .name }}</li></template></ol>`,
    );
    const texts = (sel: string) => Array.from(shadowRoot.querySelectorAll(sel)).map(el => el.textContent);
    expect(texts("ul li")).toEqual(["a", "b"]);
    expect(texts("ol li")).toEqual(["b", "a"]);
    expect(evals).toBe(2); // 初期描画で各行 1 回
    const before = evals;

    const batchAddresses: IAbsoluteStateAddress[] = [];
    const listener = (batch: ReadonlySet<IAbsoluteStateAddress>) => { batchAddresses.push(...batch); };
    registerUpdateBatchListener(listener);
    try {
      // others の配列（items とは台帳が分岐）を items に代入 → calcDiffIndexes 経路
      stateElement.createState("writable", (s: any) => {
        s.items = s.others;
      });
      await flush();
    } finally {
      unregisterUpdateBatchListener(listener);
    }

    expect(texts("ul li")).toEqual(["b", "a"]);
    expect(texts("ol li")).toEqual(["b", "a"]);
    // 台帳の identity が無い行は add+delete で表現される。dirty 化されるのは
    // 新規行 2 件のみが正。孤児マーカーがあると破棄予定の旧台帳行 2 件も
    // dirty 化され、drain バッチ（stream 依存駆動 restart の契約入力）に
    // 混入して 4 件になる
    const labelAddresses = batchAddresses.filter(
      (a) => a.absolutePathInfo.pathInfo.path === "items.*.label",
    );
    expect(labelAddresses).toHaveLength(2);
    expect(evals - before).toBe(2);
    host.remove();
  });

  it("代入後も両パスのリストが引き続き独立に更新できること", async () => {
    const r1 = { name: "a" };
    const r2 = { name: "b" };
    const { host, shadowRoot, stateElement } = await mount(
      { items: [r1, r2], others: [r2, r1] },
      `<ul><template data-wcs="for: items"><li>{{ .name }}</li></template></ul>
       <ol><template data-wcs="for: others"><li>{{ .name }}</li></template></ol>`,
    );
    const texts = (sel: string) => Array.from(shadowRoot.querySelectorAll(sel)).map(el => el.textContent);

    stateElement.createState("writable", (s: any) => {
      s.items = s.others;
    });
    await flush();
    expect(texts("ul li")).toEqual(["b", "a"]);

    // 代入後の items（= 元 others の配列）をさらに置換しても正しく描画されること
    stateElement.createState("writable", (s: any) => {
      s.items = [r1, r2, { name: "c" }];
    });
    await flush();
    expect(texts("ul li")).toEqual(["a", "b", "c"]);
    expect(texts("ol li")).toEqual(["b", "a"]);
    host.remove();
  });
});
