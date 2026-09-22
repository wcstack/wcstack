/**
 * declarationAliases.test.ts — 宣言キーの正式名とエイリアス（要件 B12・docs/state-3x-naming.ja.md V13 / V14）。
 * `$renderedCallback` / `$stream` が正式名として働き、旧名 `$updatedCallback` / `$streams` も 3.x の間は同じに
 * 働くこと、両方の綴りの宣言を名指しで拒否すること、class の state（プロトタイプのメソッド）も扱えることを固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { DECLARATION_ALIASES, normalizeDeclarationAliases } from "../src/declarationAliases";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let counter = 0;

async function mountPage(state: object, body: string) {
  const host = document.createElement(`decl-alias-host-${++counter}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${body}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(state as Record<string, any>);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  const write = async (fn: (s: any) => void) => { stateElement.createState("writable", fn); await flush(); };
  const text = (id: string) => shadowRoot.getElementById(id)!.textContent;
  return { host, write, text };
}

describe("normalizeDeclarationAliases", () => {
  it("旧名は正式名へ移り、自前のプロパティなら旧名は消えること", () => {
    const handler = () => {};
    const state: Record<string, unknown> = { $updatedCallback: handler, $streams: { s: {} } };
    normalizeDeclarationAliases(state);
    expect(state.$renderedCallback).toBe(handler);
    expect(state.$stream).toEqual({ s: {} });
    expect("$updatedCallback" in state).toBe(false);
    expect("$streams" in state).toBe(false);
    expect(DECLARATION_ALIASES).toEqual({ $updatedCallback: "$renderedCallback", $streams: "$stream" });
  });

  it("class の state ではプロトタイプのメソッドを正式名としてインスタンスに写すこと", () => {
    class AppState {
      calls = 0;
      $updatedCallback(): void { this.calls++; }
    }
    const state = new AppState() as AppState & { $renderedCallback?: () => void };
    normalizeDeclarationAliases(state);
    state.$renderedCallback!();
    expect(state.calls).toBe(1);
    // 同じオブジェクトは二度処理しない（プロトタイプに旧名が残っていても衝突にしない）
    expect(() => normalizeDeclarationAliases(state)).not.toThrow();
  });

  it("両方の綴りを宣言した state は [wcs/declaration-alias] で拒否すること", () => {
    expect(() => normalizeDeclarationAliases({ $streams: {}, $stream: {} }))
      .toThrow(/\[wcs\/declaration-alias\] The state declares both "\$streams" and "\$stream"/);
    expect(() => normalizeDeclarationAliases({ $updatedCallback() {}, $renderedCallback() {} }))
      .toThrow(/keep "\$renderedCallback"/);
  });
});

describe("正式名と旧名の宣言がページで同じに働くこと", () => {
  it.each(["$renderedCallback", "$updatedCallback"])("%s は適用された束縛の更新を受けること", async (key) => {
    const received: string[] = [];
    const { host, write } = await mountPage(
      { count: 0, [key](paths: string[]) { received.push(...paths); } },
      `<span id="c" data-wcs="textContent: count"></span>`,
    );
    await write((s) => { s.count = 1; });
    expect(received).toContain("count");
    host.remove();
  });

  it.each(["$stream", "$streams"])("%s は値プロパティと $streamStatus を作ること", async (key) => {
    const { host, text } = await mountPage(
      {
        [key]: {
          ticks: {
            initial: 0,
            async *source() { yield 5; },
          },
        },
      },
      `<span id="v" data-wcs="textContent: ticks"></span><span id="st" data-wcs="textContent: $streamStatus.ticks"></span>`,
    );
    await flush();
    await flush();
    expect(text("v")).toBe("5");
    expect(["active", "done"]).toContain(text("st"));
    host.remove();
  });
});
