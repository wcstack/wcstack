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
