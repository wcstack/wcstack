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
 *
 * 2 つ目の describe は #256（X2）の受け入れ条件だったもの。行オブジェクトだけを作り直す
 * 置換（`nodes.map(n => ({...n}))`）は、修理前は子配列を引き継ぐために **退役した旧行の
 * アドレス** を drain バッチへ載せていた。台帳を (親, 配列) でキーしたいま、2 つの綴り
 * （map-spread と [...nodes]）は件数・添字・再評価回数・表示のすべてで一致する。
 * 「厳密に何件か」を固定しているので、重複を増やす修正はここで落ちる。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { registerUpdateBatchListener, unregisterUpdateBatchListener } from "../src/updater/updater";
import type { IAbsoluteStateAddress } from "../src/address/types";
import { getListIndexesByList } from "../src/list/listIndexesByList";

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
  const stateElement = getStateElement(shadowRoot)!;
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

describe("行オブジェクトだけを作り直す置換（#256 / X2）の汚れアドレス", () => {
  /** 2 行・子配列つき。行 total ＝ 自分の value ＋ 直下の子の value の総和 */
  const fixture = () => {
    const counter = { evals: 0 };
    const initial: any = {
      nodes: [
        { value: 1, children: [{ value: 10 }, { value: 20 }] },
        { value: 2, children: [] },
      ],
      get "nodes.*.total"(this: any) {
        counter.evals++;
        return this["nodes.*.value"] +
          this.$getAll("nodes.*.children.*.value").reduce((a: number, b: number) => a + b, 0);
      },
    };
    return { initial, counter };
  };
  const NESTED_FOR =
    `<ul><template data-wcs="for: nodes"><li class="row">` +
    `<b class="total" data-wcs="textContent: .total"></b>` +
    `<template data-wcs="for: nodes.*.children"><i class="kid">{{ .value }}</i></template>` +
    `</li></template></ul>`;

  /** 1 回の書き込みで drain バッチに載った `nodes.*.total` のアドレスだけを集める */
  async function capture(stateElement: any, fn: (s: any) => void) {
    const seen: IAbsoluteStateAddress[] = [];
    const listener = (batch: ReadonlySet<IAbsoluteStateAddress>) => { seen.push(...batch); };
    registerUpdateBatchListener(listener);
    try {
      stateElement.createState("writable", fn);
      await flush();
    } finally {
      unregisterUpdateBatchListener(listener);
    }
    return seen.filter((a) => a.absolutePathInfo.pathInfo.path === "nodes.*.total");
  }
  const texts = (sr: ShadowRoot, sel: string) =>
    Array.from(sr.querySelectorAll(sel)).map((e) => e.textContent);

  // 置換そのものが載せるアドレスの内訳（実測）。**重複は無い**（3 件とも別アドレス）が、
  // 生きている 2 行に加えて **退役した旧行** のアドレスが 1 件混ざる: 依存ウォークが
  // 縮約エッジを辿る時点では、子の行はまだ旧行にぶら下がっている（台帳の付け替えは
  // 新しい親で引かれた時に起きる）。退役した行のアドレスには生きたバインディングが
  // 無いので描画には効かず、**生きている 2 行はどちらも dirty になり再評価される** ——
  // #256 が直したのはそこで、下の「置換のあとの葉の書き込み」の it がその門。
  it("map-spread の置換では、生きている 2 行と退役した旧行 1 件が dirty になる", async () => {
    const { initial, counter } = fixture();
    const { host, shadowRoot, stateElement } = await mount(initial, NESTED_FOR);
    expect(texts(shadowRoot, ".total")).toEqual(["31", "2"]);
    const before = counter.evals;

    const dirty = await capture(stateElement, (s: any) => {
      s.nodes = s.nodes.map((n: any) => ({ ...n }));
    });
    const ledger = getListIndexesByList(initial.nodes, null)!;
    expect(ledger, "置換後の生きている行").toHaveLength(2);

    expect(dirty).toHaveLength(3);
    expect(new Set(dirty).size, "3 件とも別々のアドレス（同一オブジェクトの重複ではない）").toBe(3);
    expect(dirty.map((a) => a.listIndex!.indexes)).toEqual([[0], [1], [0]]);
    expect(dirty.map((a) => ledger.includes(a.listIndex!)), "生きた 2 行 ＋ 退役した旧行 1 件")
      .toEqual([true, true, false]);
    expect(counter.evals - before, "再評価は生きている 2 行ぶん").toBe(2);
    expect(texts(shadowRoot, ".total"), "置換だけでは表示は変わらない").toEqual(["31", "2"]);
    host.remove();
  });

  it("対照: 行オブジェクトを引き継ぐ置換（[...nodes]）では、生きている 2 行だけが dirty になる", async () => {
    const { initial, counter } = fixture();
    const { host, stateElement } = await mount(initial, NESTED_FOR);
    const before = counter.evals;

    const dirty = await capture(stateElement, (s: any) => { s.nodes = [...s.nodes]; });
    const ledger = getListIndexesByList(initial.nodes, null)!;

    expect(dirty).toHaveLength(2);
    expect(dirty.map((a) => a.listIndex!.indexes)).toEqual([[0], [1]]);
    expect(dirty.every((a) => ledger.includes(a.listIndex!)), "全部が生きている行").toBe(true);
    expect(counter.evals - before).toBe(2);
    host.remove();
  });
  // Fixed by #256 — was: map-spread 側だけが **退役した旧行** のアドレスを dirty にし、
  // 生きている行 0 の getter は 1 度も再評価されず（inLedger=false / 再評価 0 回）、
  // 表示が "31" のまま止まっていた。いまは 2 つの綴りが 1 行も違わない。
  it("置換のあとの葉の書き込みは、どちらの綴りでも生きている行を dirty にする", async () => {
    const cases: [string, (s: any) => void, boolean, number, string][] = [
      ["map-spread", (s: any) => { s.nodes = s.nodes.map((n: any) => ({ ...n })); }, true, 1, "120"],
      ["[...nodes]", (s: any) => { s.nodes = [...s.nodes]; }, true, 1, "120"],
    ];
    for (const [label, replace, inLedger, evals, total] of cases) {
      const { initial, counter } = fixture();
      const { host, shadowRoot, stateElement } = await mount(initial, NESTED_FOR);
      await capture(stateElement, replace);
      const before = counter.evals;

      const dirty = await capture(stateElement, (s: any) => {
        s.$resolve("nodes.*.children.*.value", [0, 0], 99);
      });
      const ledger = getListIndexesByList(initial.nodes, null)!;

      expect(dirty, label).toHaveLength(1);
      expect(dirty[0].listIndex!.indexes, label).toEqual([0]);
      expect(ledger.includes(dirty[0].listIndex!), label).toBe(inLedger);
      expect(counter.evals - before, label).toBe(evals);
      expect(texts(shadowRoot, ".total"), label).toEqual([total, "2"]);
      expect(texts(shadowRoot, ".kid"), label + " 葉の描画はどちらも追従する").toEqual(["99", "20"]);
      host.remove();
    }
  });
});
