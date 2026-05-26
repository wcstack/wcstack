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

/**
 * wc-bindable Composite Profile (COMPOSITE.md / SPEC-extensions § 4) との
 * spread 互換性を検証する統合テスト。
 *
 * composite shell の特徴:
 * - `target.constructor.wcBindable` で synthesized declaration を露出（§ 1）
 * - properties name は `<sourceId>.<sourceName>` パターン（§ 3）例: "s3.progress"
 * - event は `@wc-bindable/composite:<composedName>` namespace（§ 6）
 *
 * spread 実装は composite shell に固有の知識を持たず、wcBindable の標準
 * surface を読むだけなので、composite は自動的にサポートされる。state 側を
 * `{ s3: { progress: 0 } }` のような nested 構造で持てば、composed name の
 * dot がそのまま state path として解決される。
 */
describe("spread binding with composite shell (integration)", () => {
  it("composite shell の synthesized properties が spread で展開されること", async () => {
    const tag = uniqueTag("composite-shell");
    const wcBindable: IWcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [
        { name: "s3.progress", event: `@wc-bindable/composite:s3.progress` },
        { name: "s3.status", event: `@wc-bindable/composite:s3.status` },
        { name: "ai.prompt", event: `@wc-bindable/composite:ai.prompt` },
        { name: "ai.response", event: `@wc-bindable/composite:ai.response` },
      ],
    };
    class CompositeShell extends HTMLElement {
      static wcBindable = wcBindable;
    }
    customElements.define(tag, CompositeShell);

    const host = document.createElement(uniqueTag("composite-shell-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="shell" data-wcs="...: pipeline"></${tag}>
      <wcs-state json='{
        "pipeline": {
          "s3": { "progress": 42, "status": "uploading" },
          "ai":  { "prompt": "hello", "response": "world" }
        }
      }'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const el = shadowRoot.querySelector("#shell") as any;
    // composed name はフラットなプロパティキーとして要素に書き込まれる
    expect(el["s3.progress"]).toBe(42);
    expect(el["s3.status"]).toBe("uploading");
    expect(el["ai.prompt"]).toBe("hello");
    expect(el["ai.response"]).toBe("world");

    host.remove();
  });

  it("composite shell の event 名 (@wc-bindable/composite:...) で書き戻しが機能すること", async () => {
    const tag = uniqueTag("composite-twoway");
    const eventName = `@wc-bindable/composite:s3.progress`;
    class CompositeShell extends HTMLElement {
      static wcBindable: IWcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
          { name: "s3.progress", event: eventName },
        ],
      };
    }
    customElements.define(tag, CompositeShell);

    const host = document.createElement(uniqueTag("composite-twoway-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="shell" data-wcs="...: pipeline"></${tag}>
      <wcs-state json='{"pipeline":{"s3":{"progress":0}}}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const el = shadowRoot.querySelector("#shell") as any;
    expect(el["s3.progress"]).toBe(0);

    // composite shell が source event を fan-out して shell event を dispatch
    el.dispatchEvent(new CustomEvent(eventName, { detail: 75 }));
    await Promise.resolve();

    await stateEl.createStateAsync("readonly", async (state: any) => {
      expect(state.pipeline.s3.progress).toBe(75);
    });

    host.remove();
  });
});
