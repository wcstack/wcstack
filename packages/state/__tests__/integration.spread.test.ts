import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getConfig, setConfig } from "../src/config";
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

// Directional initial sync (enableDirectionalInitialSync) assigns per-property
// authority: a two-way member (declared as both a property AND an input) keeps the
// current-compatible `state` authority (state→element push), while an OUTPUT-ONLY
// member (property with no input) gets `element` authority (its initial value is
// read element→state, not pushed). These spread tests exercise spread EXPANSION by
// pushing a state object into the element, so the pushed members are settable and
// are declared two-way (output + input) — that is the correct model under directional
// and stays state-authority whether the flag is on or off. The distinct output-only
// element-authority behavior is covered by its own test below.
describe("spread binding (integration)", () => {
  it("トップレベルで properties と inputs を一括配線すること", async () => {
    const tag = uniqueTag("spread-top");
    defineMockBindable(
      tag,
      [{ name: "value", event: `${tag}:value-changed` }, { name: "loading", event: `${tag}:loading-changed` }],
      [{ name: "url" }, { name: "method" }, { name: "value" }, { name: "loading" }],
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
    defineMockBindable(tag, [{ name: "value", event: eventName }], [{ name: "value" }]);

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
    defineMockBindable(tag, [{ name: "value", event: `${tag}:value-changed` }], [{ name: "value" }]);

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
    defineMockBindable(tag, [{ name: "value", event: `${tag}:value-changed` }], [{ name: "value" }]);

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

  it("未初期化の slot プロパティは undefined を書き戻さず要素既定値を維持すること", async () => {
    // wcs-fetch と同型の「setter が属性へ文字列化反映する」要素。undefined が
    // 書き込まれると method="undefined" 等の壊れた属性になる回帰を防ぐ。
    const tag = uniqueTag("spread-uninit");
    class FetchLikeEl extends HTMLElement {
      static wcBindable: IWcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [{ name: "value", event: `${tag}:value-changed` }],
        inputs: [{ name: "url" }, { name: "method" }, { name: "manual" }, { name: "value" }],
      };
      get url(): string { return this.getAttribute("url") || ""; }
      set url(v: string) { this.setAttribute("url", v); }
      get method(): string { return (this.getAttribute("method") || "GET").toUpperCase(); }
      set method(v: string) { this.setAttribute("method", v); }
      get manual(): boolean { return this.hasAttribute("manual"); }
      set manual(v: boolean) {
        if (v) this.setAttribute("manual", "");
        else this.removeAttribute("manual");
      }
    }
    customElements.define(tag, FetchLikeEl);

    const host = document.createElement(uniqueTag("spread-uninit-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    // slot は value しか初期化しない (url/method/manual は未定義)
    shadowRoot.innerHTML = `
      <${tag} id="mock" manual data-wcs="...: fetchX"></${tag}>
      <wcs-state json='{"fetchX":{"value":"hello"}}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const el = shadowRoot.querySelector("#mock") as any;
    expect(el.value).toBe("hello");
    // undefined は書き込まれず、要素側の既定値・HTML 属性がそのまま生きる
    expect(el.hasAttribute("url")).toBe(false);
    expect(el.method).toBe("GET");
    expect(el.hasAttribute("method")).toBe(false);
    expect(el.manual).toBe(true);

    host.remove();
  });

  it("explicit binding が spread を上書きすること (後勝ち)", async () => {
    const tag = uniqueTag("spread-override");
    defineMockBindable(tag, [
      { name: "value", event: `${tag}:value-changed` },
      { name: "loading", event: `${tag}:loading-changed` },
    ], [{ name: "value" }, { name: "loading" }]);

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

  it("directional 有効時、output-only な spread メンバは element authority で state→element push しない", async () => {
    // Phase 2 (enableDirectionalInitialSync) の意図挙動: OUTPUT-ONLY メンバ
    // (property のみ・input 宣言なし) は element authority になり、pre-seed した state
    // 値は要素へ push されない (要素の初期値が真実源)。IO ノードでは output は初期空
    // なので実挙動は無害だが、spread がこの方向規則に従うことをここで固定する。
    const prevDirectional = getConfig().enableDirectionalInitialSync;
    setConfig({ enableDirectionalInitialSync: true });
    const tag = uniqueTag("spread-output-only");
    defineMockBindable(tag, [{ name: "value", event: `${tag}:value-changed` }]); // input なし = output-only

    const host = document.createElement(uniqueTag("spread-output-only-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="mock" data-wcs="...: fetchX"></${tag}>
      <wcs-state json='{"fetchX":{"value":"seed"}}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const el = shadowRoot.querySelector("#mock") as any;
    // output-only: pre-seed した "seed" は要素へ push されない (element authority)。
    expect(el.value).toBeUndefined();

    host.remove();
    // 立てた directional フラグを元の値へ戻す（他テストへ漏らさない）。
    setConfig({ enableDirectionalInitialSync: prevDirectional });
  });
});
