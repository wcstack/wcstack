import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { setConfig } from "../src/config";

beforeAll(() => {
  bootstrapState();
});

let sequence = 0;

function uniqueTag(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

async function drainUpdates(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Phase 3 因果伝播の end-to-end 検証（設計書 §8 完了条件: echo / 正規化 /
 * 収束が決定的に通ること）。producer は value setter が同期的に
 * `value-change` を dispatch する「echo する」custom element。
 */
describe("propagation context (integration)", () => {
  const hosts: HTMLElement[] = [];

  beforeEach(() => {
    setConfig({ enablePropagationContext: true });
  });

  afterEach(() => {
    setConfig({ enablePropagationContext: false });
    for (const host of hosts.splice(0)) {
      host.remove();
    }
  });

  function defineEchoElement(normalize: (value: unknown) => unknown): {
    tag: string;
    setterCalls: () => number;
  } {
    const tag = uniqueTag("x-propagation-echo");
    let setterCallCount = 0;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
          { name: "value", event: "value-change", getter: (event: Event) => (event as CustomEvent).detail },
        ],
        inputs: [{ name: "value" }],
      };
      private _value: unknown = "";
      get value(): unknown {
        return this._value;
      }
      set value(value: unknown) {
        setterCallCount += 1;
        this._value = normalize(value);
        this.dispatchEvent(new CustomEvent("value-change", { detail: this._value }));
      }
    });
    return { tag, setterCalls: () => setterCallCount };
  }

  async function mountEchoApp(tag: string, initialJson: string): Promise<{
    element: HTMLElement & { value: unknown };
    mirror: HTMLElement;
    stateElement: State;
  }> {
    const host = document.createElement(uniqueTag("x-propagation-host"));
    hosts.push(host);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="producer" data-wcs="value: text"></${tag}>
      <span id="mirror" data-wcs="textContent: text"></span>
      <wcs-state json='${initialJson}'></wcs-state>
    `;
    document.body.appendChild(host);
    const stateElement = shadowRoot.querySelector("wcs-state") as State;
    await stateElement.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await drainUpdates();
    return {
      element: shadowRoot.querySelector("#producer") as HTMLElement & { value: unknown },
      mirror: shadowRoot.querySelector("#mirror") as HTMLElement,
      stateElement,
    };
  }

  it("同期 confirmation: setter が同値 event を echo しても再伝播しないこと", async () => {
    const { tag, setterCalls } = defineEchoElement((value) => value);
    const { element, mirror } = await mountEchoApp(tag, '{"text":"initial"}');

    expect(element.value).toBe("initial");
    expect(mirror.textContent).toBe("initial");
    const settledSetterCalls = setterCalls();

    // ユーザー入力相当の外部 event → state 反映 → element へ書き戻し（setter 1 回）
    // → setter の同値 echo は confirmation として抑止され、それ以上進まない
    element.dispatchEvent(new CustomEvent("value-change", { detail: "typed" }));
    await drainUpdates();

    expect(element.value).toBe("typed");
    expect(mirror.textContent).toBe("typed");
    expect(setterCalls()).toBe(settledSetterCalls + 1);
  });

  it("API 書き込みは新しい transaction として配送され、echo は confirmation で止まること", async () => {
    const { tag, setterCalls } = defineEchoElement((value) => value);
    const { element, mirror, stateElement } = await mountEchoApp(tag, '{"text":"initial"}');
    const settledSetterCalls = setterCalls();

    // binding 外からの API update（current context なし）→ 新 transaction
    stateElement.createState("writable", (state: Record<string, unknown>) => {
      state.text = "api";
    });
    await drainUpdates();

    expect(element.value).toBe("api");
    expect(mirror.textContent).toBe("api");
    expect(setterCalls()).toBe(settledSetterCalls + 1);
  });

  it("正規化差分: element の確定値を state が受理して 1 往復で収束すること", async () => {
    const { tag, setterCalls } = defineEchoElement((value) => String(value).trim());
    const { element, mirror } = await mountEchoApp(tag, '{"text":" padded "}');

    // 初期適用 " padded " → element が "padded" へ正規化 → state が受理
    // → 再適用は同一 transaction の通過済み edge として抑止され、往復が止まる
    expect(element.value).toBe("padded");
    expect(mirror.textContent).toBe("padded");
    expect(setterCalls()).toBe(1);
  });

  it("増殖する正規化でも provenance で収束し、値は最後に適用されたもので確定すること", async () => {
    const { tag, setterCalls } = defineEchoElement((value) => `${value}!`);
    const { element, mirror } = await mountEchoApp(tag, '{"text":"a"}');

    // "a" → element "a!"（正規化）→ state "a!" → element への再適用は
    // 通過済み edge として抑止。value 比較では止まらないケースが 1 hop で止まる
    expect(element.value).toBe("a!");
    expect(mirror.textContent).toBe("a!");
    expect(setterCalls()).toBe(1);
  });
});
