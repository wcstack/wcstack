/**
 * integration.pathDiagnostics.test.ts
 *
 * 「打ち間違えたパスへの配線は黙って死ぬ」を、実際のマウント経路で破れているか確かめる。
 *
 * 単体テスト（pathDiagnostics.test.ts）は判定関数を直接叩くので、`data-wcs` の文字列が
 * パーサ → `expandShorthandPaths` → `BindingSession.registerAddress` → `setPathInfo`
 * と流れて検査に届くところが検証されない。相対パス（`.nmae`）が展開済みで届くことは
 * この経路でしか固定できない。
 *
 * 併せて、この診断が **既存ページを騒がせない**（実在するパス・空配列・null 親では
 * 一切鳴らない）ことも同じ経路で固定する。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import type { IState } from "../src/types";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let seq = 0;

async function mount(state: IState, markup: string) {
  const host = document.createElement(`path-diag-host-${++seq}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${markup}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(state as Record<string, any>);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  return { host, shadowRoot };
}

/** 診断メッセージだけを取り出す（他の warn と混ざらないように） */
function diagnostics(warn: ReturnType<typeof vi.spyOn>): string[] {
  return warn.mock.calls
    .map((call) => String(call[0]))
    .filter((message) => message.includes("wcs/binding-path-missing") || message.includes("wcs/watch-path-missing"));
}

describe("存在しないパスへの配線（マウント経路）", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("ネストしたパスの打ち間違いを報告すること（従来は無警告で DOM が更新されないだけだった）", async () => {
    const { host } = await mount(
      { user: { name: "Ann" } } as IState,
      `<span data-wcs="textContent: user.nmae"></span>`,
    );
    const messages = diagnostics(warn);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Bound path "user.nmae"');
    expect(messages[0]).toContain('Did you mean "name"?');
    host.remove();
  });

  it("ループ内の相対パスは展開済みの絶対パスで報告すること", async () => {
    const { host } = await mount(
      { items: [{ name: "a" }] } as IState,
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: .nmae"></li></template></ul>`,
    );
    const messages = diagnostics(warn);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Bound path "items.*.nmae"');
    expect(messages[0]).toContain('Did you mean "name"?');
    host.remove();
  });

  it("$watch のキーの打ち間違いを watch 用の診断 code で報告すること", async () => {
    const { host } = await mount(
      { count: 0, $watch: { cout() { /* never fires */ } } } as unknown as IState,
      `<span data-wcs="textContent: count"></span>`,
    );
    const messages = diagnostics(warn);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("[wcs/watch-path-missing]");
    expect(messages[0]).toContain('$watch path "cout"');
    host.remove();
  });

  it("実在するパスでは一切鳴らないこと", async () => {
    const { host } = await mount(
      { user: { name: "Ann" }, items: [{ name: "a" }] } as IState,
      `<span data-wcs="textContent: user.name"></span>
       <ul><template data-wcs="for: items"><li data-wcs="textContent: .name"></li></template></ul>`,
    );
    expect(diagnostics(warn)).toEqual([]);
    host.remove();
  });

  it("初期値が空配列の行フィールドでは鳴らないこと（行の形が分からないので黙る）", async () => {
    const { host } = await mount(
      { items: [] } as unknown as IState,
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: .whatever"></li></template></ul>`,
    );
    expect(diagnostics(warn)).toEqual([]);
    host.remove();
  });

  it("初期値 null のオブジェクト配下では鳴らないこと（後から代入する形を潰さない）", async () => {
    const { host } = await mount(
      { user: null } as unknown as IState,
      `<span data-wcs="textContent: user.name"></span>`,
    );
    expect(diagnostics(warn)).toEqual([]);
    host.remove();
  });

  it("ドットパス getter への配線では鳴らないこと", async () => {
    const state = {
      items: [{ price: 100, qty: 2 }],
      get "items.*.subtotal"(this: any) { return this["items.*.price"] * this["items.*.qty"]; },
    } as unknown as IState;
    const { host, shadowRoot } = await mount(
      state,
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: .subtotal"></li></template></ul>`,
    );
    expect(diagnostics(warn)).toEqual([]);
    expect(shadowRoot.querySelector("li")?.textContent).toBe("200");
    host.remove();
  });
});
