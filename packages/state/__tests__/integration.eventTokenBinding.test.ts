import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import type { IWcBindable } from "../src/event/types";

beforeAll(() => {
  bootstrapState();
});

/**
 * event-token binding 統合テスト（element → state、command-token の双対）。
 *
 * - `data-wcs="eventToken.<prop>: <name>"` は wcBindable.properties[].event を実イベント名に解決し、
 *   要素 dispatch を event-token に流す。
 * - state 側は `$on` マップで `(state, event, ...listIndexes)` 規約で受ける。
 * - 実 binding 文字列・パーサ・bindings 構築・イベント発火まで本物で通す。
 */
describe("event-token binding (integration)", () => {
  it("要素のdispatchが$onハンドラへ (state, event) 規約で配送されること", async () => {
    const tagName = "evt-int-target";
    if (!customElements.get(tagName)) {
      class C extends HTMLElement {
        static wcBindable: IWcBindable = {
          protocol: "wc-bindable",
          version: 1,
          properties: [{ name: "error", event: "thing-error" }],
        };
      }
      customElements.define(tagName, C);
    }

    const onError = vi.fn();
    const host = document.createElement("evt-int-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tagName} data-wcs="eventToken.error: createFailed"></${tagName}>
      <wcs-state></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({
      $eventTokens: ["createFailed"],
      $on: {
        createFailed: (_state: unknown, event: Event) => {
          onError((event as CustomEvent).detail);
        },
      },
    });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const target = shadowRoot.querySelector(tagName) as HTMLElement;
    target.dispatchEvent(new CustomEvent("thing-error", { detail: "boom" }));
    await new Promise((resolve) => setTimeout(resolve));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("boom");

    host.remove();
  });

  it("event-token受信 → command-token発火 のチェインが通ること", async () => {
    const targetTag = "evt-chain-target";
    if (!customElements.get(targetTag)) {
      class C extends HTMLElement {
        static wcBindable: IWcBindable = {
          protocol: "wc-bindable",
          version: 1,
          properties: [{ name: "done", event: "chain-done" }],
        };
      }
      customElements.define(targetTag, C);
    }
    const refreshSpy = vi.fn();
    const refresherTag = "evt-chain-refresher";
    if (!customElements.get(refresherTag)) {
      class C extends HTMLElement {
        static wcBindable: IWcBindable = {
          protocol: "wc-bindable",
          version: 1,
          properties: [],
          commands: [{ name: "refresh" }],
        };
        refresh(...args: unknown[]): void {
          refreshSpy(...args);
        }
      }
      customElements.define(refresherTag, C);
    }

    const host = document.createElement("evt-chain-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${targetTag} data-wcs="eventToken.done: completed"></${targetTag}>
      <${refresherTag} data-wcs="command.refresh: $command.doRefresh"></${refresherTag}>
      <wcs-state></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({
      $commandTokens: ["doRefresh"],
      $eventTokens: ["completed"],
      $on: {
        completed: (state: any) => {
          state.$command.doRefresh.emit("from-chain");
        },
      },
    });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const target = shadowRoot.querySelector(targetTag) as HTMLElement;
    target.dispatchEvent(new CustomEvent("chain-done"));
    await new Promise((resolve) => setTimeout(resolve));

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith("from-chain");

    host.remove();
  });

  it("for ブロック内の eventToken が配線され、発火で $on に listIndex 付きで届くこと（detached fragment 回帰）", async () => {
    const rowTag = "evt-for-row";
    if (!customElements.get(rowTag)) {
      class C extends HTMLElement {
        static wcBindable: IWcBindable = {
          protocol: "wc-bindable",
          version: 1,
          properties: [{ name: "failed", event: "row-failed" }],
        };
      }
      customElements.define(rowTag, C);
    }

    const received: Array<{ detail: unknown; indexes: number[] }> = [];
    const host = document.createElement("evt-for-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <template data-wcs="for: items">
        <${rowTag} data-wcs="eventToken.failed: rowFailed"></${rowTag}>
      </template>
      <wcs-state></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({
      items: [{ id: "a" }, { id: "b" }],
      $eventTokens: ["rowFailed"],
      $on: {
        rowFailed: (_state: unknown, event: Event, ...indexes: number[]) => {
          received.push({ detail: (event as CustomEvent).detail, indexes });
        },
      },
    });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const rows = shadowRoot.querySelectorAll(rowTag);
    expect(rows.length).toBe(2);

    rows[1].dispatchEvent(new CustomEvent("row-failed", { detail: "boom-1" }));
    await new Promise((resolve) => setTimeout(resolve));

    expect(received).toHaveLength(1);
    expect(received[0].detail).toBe("boom-1");
    expect(received[0].indexes).toEqual([1]);

    host.remove();
  });

  it("if ブロック内の eventToken が配線され、発火で $on に届くこと（detached fragment 回帰）", async () => {
    const tag = "evt-if-target";
    if (!customElements.get(tag)) {
      class C extends HTMLElement {
        static wcBindable: IWcBindable = {
          protocol: "wc-bindable",
          version: 1,
          properties: [{ name: "error", event: "if-error" }],
        };
      }
      customElements.define(tag, C);
    }

    const onError = vi.fn();
    const host = document.createElement("evt-if-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <template data-wcs="if: show">
        <${tag} data-wcs="eventToken.error: createFailed"></${tag}>
      </template>
      <wcs-state></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({
      show: true,
      $eventTokens: ["createFailed"],
      $on: { createFailed: (_s: unknown, e: Event) => onError((e as CustomEvent).detail) },
    });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);

    const target = shadowRoot.querySelector(tag) as HTMLElement;
    expect(target).not.toBeNull();
    target.dispatchEvent(new CustomEvent("if-error", { detail: "boom" }));
    await new Promise((resolve) => setTimeout(resolve));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("boom");

    host.remove();
  });
});
