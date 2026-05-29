import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import type { IWcBindable } from "../src/event/types";

beforeAll(() => {
  bootstrapState();
});

/**
 * event → command-token binding 統合テスト。
 *
 * - `data-wcs="onclick: $command.changeText"` のように、DOM イベントから command token を
 *   直接 emit する形式を、実 binding 文字列・パーサ・bindings 構築・イベント発火まで本物で通す。
 * - emit 引数はハンドラ呼び出しと同じく (event, ...listIndexes) を透過する。
 * - subscriber 側は通常の `command.<method>: $command.<name>` で購読する。
 */
describe("event command-token binding (integration)", () => {
  it("onclick: $command.changeText の click が subscriber を emit し event を透過すること", async () => {
    const setTextSpy = vi.fn();
    const tagName = "cmd-event-target";
    if (!customElements.get(tagName)) {
      class C extends HTMLElement {
        static wcBindable: IWcBindable = {
          protocol: "wc-bindable",
          version: 1,
          properties: [],
          commands: [{ name: "setText" }],
        };
        setText(...args: unknown[]): void {
          setTextSpy(...args);
        }
      }
      customElements.define(tagName, C);
    }

    const host = document.createElement("cmd-event-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <button data-wcs="onclick: $command.changeText">go</button>
      <${tagName} data-wcs="command.setText: $command.changeText"></${tagName}>
      <wcs-state json='{"$commandTokens":["changeText"]}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const button = shadowRoot.querySelector("button") as HTMLButtonElement;
    const event = new Event("click", { bubbles: true });
    button.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve));

    expect(setTextSpy).toHaveBeenCalledTimes(1);
    expect(setTextSpy).toHaveBeenCalledWith(event);

    host.remove();
  });

  it("onclick#prevent: $command.<name> で preventDefault が効きつつ emit されること", async () => {
    const doSpy = vi.fn();
    const tagName = "cmd-event-target-prevent";
    if (!customElements.get(tagName)) {
      class C extends HTMLElement {
        static wcBindable: IWcBindable = {
          protocol: "wc-bindable",
          version: 1,
          properties: [],
          commands: [{ name: "run" }],
        };
        run(...args: unknown[]): void {
          doSpy(...args);
        }
      }
      customElements.define(tagName, C);
    }

    const host = document.createElement("cmd-event-host-prevent");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <button data-wcs="onclick#prevent: $command.go">go</button>
      <${tagName} data-wcs="command.run: $command.go"></${tagName}>
      <wcs-state json='{"$commandTokens":["go"]}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const button = shadowRoot.querySelector("button") as HTMLButtonElement;
    const event = new Event("click", { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(event, "preventDefault");
    button.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve));

    expect(preventSpy).toHaveBeenCalledTimes(1);
    expect(doSpy).toHaveBeenCalledTimes(1);

    host.remove();
  });
});
