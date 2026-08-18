/**
 * watch.wildcard.test.ts
 *
 * `$watch` のワイルドカードパス（実装計画 Phase B）。
 * 基本形（行ごと発火・indexes・昇順）は watch.watchRuntime.test.ts にあり、
 * ここでは多段と `$listKeys` 併用時の粒度を固定する。
 *
 * 受け入れ ID:
 * - P8:  多段ワイルドカードで indexes の段数が合う
 * - P15: 同一パスの複数行が indexes 昇順に呼ばれる（多段でも辞書順）
 * - S11: `$listKeys` の有無で粒度と prev の質が設計書 §6-2 の表どおりに変わる
 * - S13: 行 watch が headless に成立するのは `$listKeys` 宣言時だけ（設計書 §6-3）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";
import type { IState } from "../src/types";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let seq = 0;

async function mount(initial: IState, markup: string) {
  const host = document.createElement(`watch-wc-host-${++seq}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${markup}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElementByName(shadowRoot, "default")!;
  return { host, shadowRoot, stateElement };
}

const NESTED_TPL =
  `<ul><template data-wcs="for: groups">` +
  `<template data-wcs="for: .rows"><li data-wcs="textContent: groups.*.rows.*.text"></li></template>` +
  `</template></ul>`;

describe("$watch のワイルドカード", () => {
  it("P8: 多段ワイルドカードで indexes が段数どおりに渡ること", async () => {
    const calls: Array<[number[], unknown, unknown]> = [];
    const { host, stateElement } = await mount({
      groups: [
        { rows: [{ text: "a" }, { text: "b" }] },
        { rows: [{ text: "c" }] },
      ],
      $watch: {
        "groups.*.rows.*.text"(cur: unknown, prev: unknown, ...indexes: number[]) {
          calls.push([indexes, cur, prev]);
        },
      },
    } as unknown as IState, NESTED_TPL);

    stateElement.createState("writable", (state) => {
      state.$resolve("groups.*.rows.*.text", [1, 0], "C");
    });
    await flush();

    expect(calls).toEqual([[[1, 0], "C", "c"]]);
    host.remove();
  });

  it("P15: 多段でも indexes の辞書順（外側の段から昇順）で呼ばれること", async () => {
    const seen: number[][] = [];
    const { host, stateElement } = await mount({
      groups: [
        { rows: [{ text: "a" }, { text: "b" }] },
        { rows: [{ text: "c" }, { text: "d" }] },
      ],
      $watch: {
        "groups.*.rows.*.text"(_cur: unknown, _prev: unknown, ...indexes: number[]) {
          seen.push(indexes);
        },
      },
    } as unknown as IState, NESTED_TPL);

    stateElement.createState("writable", (state) => {
      // 書き込み順は (1,1) → (0,1) → (1,0) → (0,0)
      state.$resolve("groups.*.rows.*.text", [1, 1], "D2");
      state.$resolve("groups.*.rows.*.text", [0, 1], "B2");
      state.$resolve("groups.*.rows.*.text", [1, 0], "C2");
      state.$resolve("groups.*.rows.*.text", [0, 0], "A2");
    });
    await flush();

    expect(seen).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
    host.remove();
  });

  it("親パスの watch は行フィールドの書き込みでは発火しないこと（粒度は宣言したパスに従う）", async () => {
    const rowCalls: number[] = [];
    const listCalls: unknown[] = [];
    const { host, stateElement } = await mount({
      items: [{ price: 1 }, { price: 2 }],
      $watch: {
        items(cur: unknown) { listCalls.push(cur); },
        "items.*.price"(_cur: unknown, _prev: unknown, index: number) { rowCalls.push(index); },
      },
    } as unknown as IState,
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: items.*.price"></li></template></ul>`);

    stateElement.createState("writable", (state) => {
      state.$resolve("items.*.price", [1], 20);
    });
    await flush();

    expect(rowCalls).toEqual([1]);
    expect(listCalls).toEqual([]);
    host.remove();
  });
});

const ROW_TPL =
  `<ul><template data-wcs="for: items"><li data-wcs="textContent: items.*.price"></li></template></ul>`;

describe("$watch と $listKeys の併用（設計書 §6-2 の表）", () => {
  it("S11: $listKeys 宣言時は、全行置換でも変化した行だけが発火し prev がスカラで取れること", async () => {
    const calls: Array<[number, unknown, unknown]> = [];
    const { host, stateElement } = await mount({
      items: [{ id: 1, price: 1 }, { id: 2, price: 2 }, { id: 3, price: 3 }],
      $listKeys: { items: "id" },
      $watch: {
        "items.*.price"(cur: unknown, prev: unknown, index: number) {
          calls.push([index, cur, prev]);
        },
      },
    } as unknown as IState, ROW_TPL);

    // fetch 相当の全行置換。内容が変わるのは行 1 の price だけ。
    stateElement.createState("writable", (state) => {
      state.items = [{ id: 1, price: 1 }, { id: 2, price: 20 }, { id: 3, price: 3 }];
    });
    await flush();

    // キー突合が per-field 書き込みに分解するので、変化した行だけ・prev はスカラ
    expect(calls).toEqual([[1, 20, 2]]);
    host.remove();
  });

  it("S11: $listKeys 未宣言なら、同じ全行置換で行の watch は「変化していない行」も発火し prev は取れないこと", async () => {
    const calls: Array<[number, unknown, unknown]> = [];
    const { host, stateElement } = await mount({
      items: [{ id: 1, price: 1 }, { id: 2, price: 2 }, { id: 3, price: 3 }],
      $watch: {
        "items.*.price"(cur: unknown, prev: unknown, index: number) {
          calls.push([index, cur, prev]);
        },
      },
    } as unknown as IState, ROW_TPL);

    stateElement.createState("writable", (state) => {
      state.items = [{ id: 1, price: 1 }, { id: 2, price: 20 }, { id: 3, price: 3 }];
    });
    await flush();

    // 配列 1 write が依存展開されるだけなので、行の粒度は「差分」ではなく「展開された行」。
    // prev も setByAddress を通っていないため取れない。
    expect(calls.map(([index]) => index)).toEqual([0, 1, 2]);
    expect(calls.map(([, cur]) => cur)).toEqual([1, 20, 3]);
    expect(calls.every(([, , prev]) => prev === undefined)).toBe(true);
    host.remove();
  });

  it("S13: for バインディングも $listKeys も無いと、配列代入で行 watch は発火しないこと（headless の境界）", async () => {
    // 依存グラフの `items → items.*` 静的子展開は walkDependency が listPaths を
    // 見て初めて行う。listPaths は `for` バインディングでしか埋まらず、`$watch` 宣言の
    // setPathInfo("prop") は listPaths を触らない（設計書 §8）。したがって行の絶対
    // アドレスがバッチに 1 つも載らず、ハンドラは呼ばれない。
    // **これはスカラーパスの headless 購読と非対称**なので、契約としてここで固定する。
    const calls: unknown[] = [];
    const { host, stateElement } = await mount({
      items: [{ price: 1 }, { price: 2 }],
      $watch: {
        "items.*.price"(cur: unknown) { calls.push(cur); },
      },
    } as unknown as IState, ``);

    stateElement.createState("writable", (state) => {
      state.items = [{ price: 1 }, { price: 20 }];
    });
    await flush();

    expect(calls).toEqual([]);
    host.remove();
  });

  it("S13: $listKeys があれば for バインディング無しでも行 watch が発火すること", async () => {
    // キー突合が配列代入を「変化フィールドごとの per-path 書き込み」に分解するため、
    // 依存展開を経由せず葉のアドレスが直接バッチに載る ＝ headless で成立する。
    const calls: Array<[number, unknown, unknown]> = [];
    const { host, stateElement } = await mount({
      items: [{ id: 1, price: 1 }, { id: 2, price: 2 }],
      $listKeys: { items: "id" },
      $watch: {
        "items.*.price"(cur: unknown, prev: unknown, index: number) {
          calls.push([index, cur, prev]);
        },
      },
    } as unknown as IState, ``);

    stateElement.createState("writable", (state) => {
      state.items = [{ id: 1, price: 1 }, { id: 2, price: 20 }];
    });
    await flush();

    expect(calls).toEqual([[1, 20, 2]]);
    host.remove();
  });

  it("$listKeys 宣言時でも、リストそのものの watch は置換で発火すること", async () => {
    const listCalls: unknown[] = [];
    const { host, stateElement } = await mount({
      items: [{ id: 1, price: 1 }],
      $listKeys: { items: "id" },
      $watch: {
        items(cur: unknown, prev: unknown) { listCalls.push([cur, prev]); },
      },
    } as unknown as IState, ROW_TPL);

    stateElement.createState("writable", (state) => {
      state.items = [{ id: 1, price: 9 }];
    });
    await flush();

    expect(listCalls.length).toBe(1);
    host.remove();
  });
});
