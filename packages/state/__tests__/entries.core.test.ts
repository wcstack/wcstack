import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, installFeatures } from "../src/entries/core";
import diagnostics from "../src/features/diagnostics";
import type { State } from "../src/components/State";

/**
 * `@wcstack/state/core` だけのページ（設計案 §4）。機能は 1 つも install しない。
 * 素の state — 束縛・更新・リスト描画 — がそれだけで動くことを固定する。
 */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve));

beforeAll(() => {
  bootstrapState();
});

describe("entries/core — 機能を 1 つも入れないページ", () => {
  it("束縛・更新・リスト描画が core だけで動くこと", async () => {
    const host = document.createElement("core-entry-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<p data-wcs="textContent: message"></p>` +
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: items.*"></li></template></ul>` +
      `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({ message: "hi", items: ["a", "b"] });
    await stateEl.connectedCallbackPromise;
    await (stateEl.constructor as typeof State).getBindingsReady(shadowRoot);

    expect(shadowRoot.querySelector("p")!.textContent).toBe("hi");
    expect([...shadowRoot.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["a", "b"]);

    stateEl.createState("writable", (state: any) => {
      state.message = "bye";
      state.items = ["c"];
    });
    await flush();

    expect(shadowRoot.querySelector("p")!.textContent).toBe("bye");
    expect([...shadowRoot.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["c"]);
    host.remove();
  });
});

/**
 * 開発時の診断（features/diagnostics）。core だけのページは打ち間違いのパスを警告しない
 * （静かな本番形）。入れれば同じページで警告が出る。install は大域なので、入れる前の
 * 挙動を先に固定する。
 */
describe("entries/core — 開発時の診断", () => {
  async function mountTypo(tag: string): Promise<HTMLElement> {
    const host = document.createElement(tag);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<p data-wcs="textContent: user.nmae"></p><wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({ user: { name: "x" } });
    await stateEl.connectedCallbackPromise;
    await (stateEl.constructor as typeof State).getBindingsReady(shadowRoot);
    await flush();
    return host;
  }

  it("診断を入れないページは、存在しないパスを警告しないこと", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const host = await mountTypo("core-diagnostics-off");
      expect(warn.mock.calls.some((call) => String(call[0]).includes("wcs/binding-path-missing"))).toBe(false);
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });

  it("installFeatures([diagnostics]) で、同じ打ち間違いが名指しで警告されること", async () => {
    installFeatures([diagnostics]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const host = await mountTypo("core-diagnostics-on");
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages.some((message) => message.includes("wcs/binding-path-missing") && message.includes("user.nmae"))).toBe(true);
      host.remove();
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * 機能の readiness barrier（要件 D13・設計案 H5）。README は「宣言が要求する機能が
 * 入っていなければ **黙って通さず**、state が定義された時点で `[wcs/feature-not-installed]`
 * を投げる」と約束している。受け口（core/declarationHooks.ts）は未 install なら段が
 * 空になるだけなので、core 自身が宣言キーを見ていないと `$watch` / `$scan` / `$stream` /
 * `$recursion` が素通りしていた。
 */
describe("entries/core — 宣言の readiness barrier", () => {
  async function mountWithDeclaration(tag: string, state: Record<string, unknown>): Promise<{ host: HTMLElement; stateEl: State }> {
    const host = document.createElement(tag);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<p data-wcs="textContent: count"></p><wcs-state></wcs-state>`;
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState(state);
    document.body.appendChild(host);
    return { host, stateEl };
  }

  it.each([
    ["$watch", "watch", "temporal", { count: 0, $watch: { count() { /* noop */ } } }],
    ["$scan", "scan", "temporal", { count: 0, $scan: { count: { on: "tick", reduce: (a: number) => a } } }],
    ["$stream", "streams", "temporal", { count: 0, $stream: { count: { source: () => [] } } }],
    ["$recursion", "recursion", "recursion", { count: 0, $recursion: { "nodes.**": "nodes.*.children" } }],
  ])("%s を宣言したのに機能が未 install なら [wcs/feature-not-installed] で落ちること", async (declaration, feature, entry, state) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { host, stateEl } = await mountWithDeclaration(`core-barrier-${feature}`, state as Record<string, unknown>);
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(
        `[wcs/feature-not-installed] "${declaration}" needs the "${feature}" feature`,
      );
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(
        `@wcstack/state/features/${entry}`,
      );
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("旧名 `$streams` で書いても同じ barrier に当たること（正規化の後に門がある）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { host, stateEl } = await mountWithDeclaration("core-barrier-streams-alias", {
        count: 0,
        $streams: { count: { source: () => [] } },
      });
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/needs the "streams" feature/);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("宣言が無ければ core だけでも落ちないこと", async () => {
    const { host, stateEl } = await mountWithDeclaration("core-barrier-none", { count: 1 });
    await expect(stateEl.connectedCallbackPromise).resolves.toBeUndefined();
    host.remove();
  });
});
