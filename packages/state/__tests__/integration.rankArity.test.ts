/**
 * integration.rankArity.test.ts
 *
 * 「意味論的な取り違え」がどう失敗するかを固定する。いずれも**パス文字列から
 * 決まる**種類の誤りで、静的にも検査できる（vscode-wcs 側の `wcs/index-arity` /
 * `wcs/wildcard-rank` / `wcs/getter-cycle`）。ここはランタイム側の契約。
 *
 * 改修前の実測（このファイルが存在する理由）:
 *
 * | ケース | 改修前 |
 * |---|---|
 * | `$getAll("items.*.price", [0,1,2])` | **黙って** `[items[0].price]` を返す（余分な添字を捨てる） |
 * | `$resolve("items.*.price", [1,9,9])` | **黙って** `items[1].price` を返す |
 * | `matrix.*.*` を 1 段の `for` の中で読む | `address.listIndex?.index is undefined path: matrix.*` |
 * | `$2` を 1 段のループの中で読む | `Index not found at position 1 for loopContext:` |
 * | getter の相互参照 | `Address stack at index 128 is undefined.`（本来の診断が巻き戻しで消える） |
 *
 * 前 2 つは「未検査」ではなく**誤った値を返していた**のが要点。後 3 つは loud に
 * 落ちてはいたが、文面が内部実装の言葉で、何を間違えたのかが書かれていなかった。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import type { IState } from "../src/types";

beforeAll(() => { bootstrapState(); });

const flush = () => new Promise((r) => setTimeout(r));
let seq = 0;

async function mount(state: IState, markup: string) {
  const host = document.createElement(`rank-arity-host-${++seq}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${markup}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(state as Record<string, any>);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  return { host, shadowRoot, stateElement: getStateElement(shadowRoot)! };
}

function read(stateElement: any, fn: (s: any) => unknown): unknown {
  let out: unknown;
  stateElement.createState("readonly", (s: any) => { out = fn(s); });
  return out;
}

/** 隔離された binding 適用失敗の内側の例外を取り出す（applyChangeFromBindings が握る） */
function isolatedErrors(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls
    .map((call) => (call[1] as { error?: unknown } | undefined)?.error)
    .filter((error): error is Error => error instanceof Error)
    .map((error) => error.message);
}

const LIST_MARKUP = `<ul><template data-wcs="for: items"><li data-wcs="textContent: .price"></li></template></ul>`;

describe("添字の本数（$getAll / $resolve）", () => {
  it("$resolve は本数がワイルドカード数と一致しなければ落ちること（超過は黙って無視されていた）", async () => {
    const { host, stateElement } = await mount(
      { items: [{ price: 1 }, { price: 2 }] } as unknown as IState, LIST_MARKUP,
    );
    expect(() => read(stateElement, (s) => s.$resolve("items.*.price", [1, 9, 9])))
      .toThrow(/\[wcs\/index-arity\] \$resolve\("items\.\*\.price"\) requires exactly 1 index\(es\).*but got 3/);
    host.remove();
  });

  it("$resolve は不足でも落ちること（従来からの挙動・文面のみ統一）", async () => {
    const { host, stateElement } = await mount(
      { items: [{ price: 1 }] } as unknown as IState, LIST_MARKUP,
    );
    expect(() => read(stateElement, (s) => s.$resolve("items.*.price", [])))
      .toThrow(/\[wcs\/index-arity\].*requires exactly 1 index\(es\).*but got 0/);
    host.remove();
  });

  it("$getAll は超過で落ちること", async () => {
    const { host, stateElement } = await mount(
      { items: [{ price: 1 }, { price: 2 }] } as unknown as IState, LIST_MARKUP,
    );
    expect(() => read(stateElement, (s) => s.$getAll("items.*.price", [0, 1, 2])))
      .toThrow(/\[wcs\/index-arity\] \$getAll\("items\.\*\.price"\) requires at most 1 index\(es\).*but got 3/);
    host.remove();
  });

  it("$getAll の不足は正当（接頭辞 ＝ 残りの階層を全展開）なので落ちないこと", async () => {
    const { host, stateElement } = await mount(
      { items: [{ price: 1 }, { price: 2 }] } as unknown as IState, LIST_MARKUP,
    );
    expect(read(stateElement, (s) => s.$getAll("items.*.price", []))).toEqual([1, 2]);
    // 省略時（文脈から導出）も従来どおり
    expect(read(stateElement, (s) => s.$getAll("items.*.price"))).toEqual([1, 2]);
    host.remove();
  });
});

describe("ワイルドカードの階数（rank）", () => {
  it("パスの階数がスコープの段数を超えたら、何段必要かを言って落ちること", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host } = await mount(
      { matrix: [[1, 2], [3, 4]] } as unknown as IState,
      `<ul><template data-wcs="for: matrix"><li data-wcs="textContent: matrix.*.*"></li></template></ul>`,
    );
    expect(isolatedErrors(error).join("\n")).toMatch(/\[wcs\/wildcard-rank\].*needs 1 enclosing loop level\(s\) but the current scope provides 0/);
    error.mockRestore();
    host.remove();
  });

  it("$N が段数を超えたら、何段必要かを言って落ちること", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host } = await mount(
      { items: [{ n: 1 }] } as unknown as IState,
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: $2"></li></template></ul>`,
    );
    expect(isolatedErrors(error).join("\n")).toMatch(/\[wcs\/wildcard-rank\] "\$2" needs 2 enclosing loop level\(s\) but the current scope provides 1/);
    error.mockRestore();
    host.remove();
  });

  it("段数が足りていれば当然通ること（対照）", async () => {
    const { host, shadowRoot } = await mount(
      { matrix: [[1, 2], [3, 4]] } as unknown as IState,
      `<ul><template data-wcs="for: matrix">` +
      `<template data-wcs="for: matrix.*"><li data-wcs="textContent: matrix.*.*"></li></template>` +
      `</template></ul>`,
    );
    expect(Array.from(shadowRoot.querySelectorAll("li")).map((n) => n.textContent)).toEqual(["1", "2", "3", "4"]);
    host.remove();
  });
});

describe("getter の循環参照", () => {
  it("循環だと名指しして落ちること（従来は巻き戻し中の別エラーで診断が消えていた）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = {
      get a(this: any) { return this.b + 1; },
      get b(this: any) { return this.a + 1; },
    } as unknown as IState;
    const { host } = await mount(state, `<span data-wcs="textContent: a"></span>`);
    const messages = isolatedErrors(error).join("\n");
    expect(messages).toMatch(/Possible circular dependency between path getters/);
    // 当事者が名指しされること（原因と無関係な "Address stack at index N is undefined." ではない）
    expect(messages).toMatch(/a -> b|b -> a/);
    expect(messages).not.toMatch(/Address stack at index/);
    error.mockRestore();
    host.remove();
  });
});
