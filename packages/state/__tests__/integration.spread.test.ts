import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import type { IWcBindable } from "../src/event/types";

beforeAll(() => {
  bootstrapState();
});

let counter = 0;
function uniqueTag(prefix: string): string {
  return `${prefix}-${++counter}`;
}

function defineMockBindable(tag: string, properties: { name: string; event: string }[], inputs?: { name: string }[]) {
  if (customElements.get(tag)) return;
  class MockEl extends HTMLElement {
    static wcBindable: IWcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties,
      ...(inputs ? { inputs } : {}),
    };
  }
  customElements.define(tag, MockEl);
}

describe("spread binding (integration)", () => {
  it("トップレベルで properties と inputs を一括配線すること", async () => {
    const tag = uniqueTag("spread-top");
    defineMockBindable(
      tag,
      [{ name: "value", event: `${tag}:value-changed` }, { name: "loading", event: `${tag}:loading-changed` }],
      [{ name: "url" }, { name: "method" }],
    );

    const host = document.createElement(uniqueTag("spread-top-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="mock" data-wcs="...: fetchX"></${tag}>
      <wcs-state json='{"fetchX":{"value":"hello","loading":true,"url":"/api","method":"POST"}}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const el = shadowRoot.querySelector("#mock") as any;
    expect(el.value).toBe("hello");
    expect(el.loading).toBe(true);
    expect(el.url).toBe("/api");
    expect(el.method).toBe("POST");

    host.remove();
  });

  it("spread が双方向 prop の event を尊重すること (event 経由で書き戻し)", async () => {
    const tag = uniqueTag("spread-twoway");
    const eventName = `${tag}:value-changed`;
    defineMockBindable(tag, [{ name: "value", event: eventName }]);

    const host = document.createElement(uniqueTag("spread-twoway-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="mock" data-wcs="...: fetchX"></${tag}>
      <wcs-state json='{"fetchX":{"value":"initial"}}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const el = shadowRoot.querySelector("#mock") as any;
    expect(el.value).toBe("initial");

    el.dispatchEvent(new CustomEvent(eventName, { detail: "updated" }));
    await Promise.resolve();

    await stateEl.createStateAsync("readonly", async (state: any) => {
      expect(state.fetchX.value).toBe("updated");
    });

    host.remove();
  });

  it("for ループ内で '...: items.*' が各イテレーションへ展開されること", async () => {
    const tag = uniqueTag("spread-loop-star");
    defineMockBindable(tag, [{ name: "value", event: `${tag}:value-changed` }]);

    const host = document.createElement(uniqueTag("spread-loop-star-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <div id="list">
        <template data-wcs="for: items">
          <${tag} class="row" data-wcs="...: items.*"></${tag}>
        </template>
      </div>
      <wcs-state json='{"items":[{"value":"a"},{"value":"b"},{"value":"c"}]}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const rows = Array.from(shadowRoot.querySelectorAll(".row")) as any[];
    expect(rows).toHaveLength(3);
    expect(rows[0].value).toBe("a");
    expect(rows[1].value).toBe("b");
    expect(rows[2].value).toBe("c");

    host.remove();
  });

  it("for ループ内で '...: .' (dot ショートカット) も同様に展開されること", async () => {
    const tag = uniqueTag("spread-loop-dot");
    defineMockBindable(tag, [{ name: "value", event: `${tag}:value-changed` }]);

    const host = document.createElement(uniqueTag("spread-loop-dot-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <div id="list">
        <template data-wcs="for: items">
          <${tag} class="row" data-wcs="...: ."></${tag}>
        </template>
      </div>
      <wcs-state json='{"items":[{"value":"x"},{"value":"y"}]}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const rows = Array.from(shadowRoot.querySelectorAll(".row")) as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].value).toBe("x");
    expect(rows[1].value).toBe("y");

    host.remove();
  });

  it("explicit binding が spread を上書きすること (後勝ち)", async () => {
    const tag = uniqueTag("spread-override");
    defineMockBindable(tag, [
      { name: "value", event: `${tag}:value-changed` },
      { name: "loading", event: `${tag}:loading-changed` },
    ]);

    const host = document.createElement(uniqueTag("spread-override-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="mock" data-wcs="...: fetchX; value: overridden"></${tag}>
      <wcs-state json='{"fetchX":{"value":"original","loading":true},"overridden":"OVERRIDE"}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const el = shadowRoot.querySelector("#mock") as any;
    expect(el.value).toBe("OVERRIDE");
    expect(el.loading).toBe(true);

    host.remove();
  });
});
