import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/entries/core";
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
