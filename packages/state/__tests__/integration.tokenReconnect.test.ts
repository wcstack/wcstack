/**
 * integration.tokenReconnect.test.ts
 *
 * ルート `<wcs-state>` の切断 → 再接続を跨いで、event-token（`$on`）と command-token の購読が
 * 残ること（#273）。実 binding 文字列 → パーサ → 要素の dispatch / `$command` の emit まで本物で通す。
 *
 * `$on` は `_state` セッターでしか購読せず、`command.<method>:` は値の適用でしか購読しない。
 * 切断が両方の registry を捨てていた頃は、再接続の後の発火が購読者の居ない新しい token に届き、
 * 例外も警告も無く止まっていた。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { getOrCreateCommandToken } from "../src/command/commandTokenRegistry";
import { State } from "../src/components/State";
import { getOrCreateEventToken } from "../src/event/eventTokenRegistry";
import type { IWcBindable } from "../src/event/types";
import type { IState } from "../src/types";
import { flushAsync } from "./helpers/streamTestUtils";

const EMITTER = "token-reconnect-emitter";
const RECEIVER = "token-reconnect-receiver";
const MESSAGE_EVENT = "token-reconnect-message";

interface IReceiver extends HTMLElement {
  calls: unknown[][];
}

beforeAll(() => {
  bootstrapState();
  if (!customElements.get(EMITTER)) {
    class Emitter extends HTMLElement {
      static wcBindable: IWcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [{ name: "message", event: MESSAGE_EVENT }],
      };
    }
    customElements.define(EMITTER, Emitter);
  }
  if (!customElements.get(RECEIVER)) {
    class Receiver extends HTMLElement {
      static wcBindable: IWcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [],
        commands: [{ name: "run" }],
      };
      calls: unknown[][] = [];
      run(...args: unknown[]): string {
        this.calls.push(args);
        return "ran";
      }
    }
    customElements.define(RECEIVER, Receiver);
  }
});

let hostSeq = 0;

async function mount(markup: string, state: IState): Promise<{ host: HTMLElement; shadowRoot: ShadowRoot; stateEl: State }> {
  const host = document.createElement(`token-reconnect-host-${++hostSeq}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${markup}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(state);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  return { host, shadowRoot, stateEl };
}

/** ホストごと DOM から外して付け直す（ルート `<wcs-state>` の切断 → 再接続） */
async function reattach(host: HTMLElement, stateEl: State): Promise<void> {
  host.remove();
  await flushAsync();
  document.body.appendChild(host);
  await stateEl.connectedCallbackPromise;
  await flushAsync();
}

function dispatchMessage(target: Element, detail: unknown): void {
  target.dispatchEvent(new CustomEvent(MESSAGE_EVENT, { detail }));
}

async function emitCommand(stateEl: State, name: string, ...args: unknown[]): Promise<unknown[]> {
  let results: unknown[] = [];
  await stateEl.createStateAsync("readonly", async (state: any) => {
    results = state.$command[name].emit(...args);
  });
  return results;
}

describe("ルート <wcs-state> の再接続と event-token の購読（#273）", () => {
  it("再接続の後も $on のハンドラが要素の出来事を受けること", async () => {
    const onPing = vi.fn();
    const { host, shadowRoot, stateEl } = await mount(
      `<${EMITTER} data-wcs="eventToken.message: ping"></${EMITTER}>`,
      { $eventTokens: ["ping"], $on: { ping: onPing } } as unknown as IState,
    );
    const emitter = shadowRoot.querySelector(EMITTER)!;
    const tokenBefore = getOrCreateEventToken(stateEl, "ping");

    dispatchMessage(emitter, "before");
    await flushAsync();
    expect(onPing).toHaveBeenCalledTimes(1);

    await reattach(host, stateEl);
    expect(getOrCreateEventToken(stateEl, "ping"), "切断は registry を捨てない").toBe(tokenBefore);

    dispatchMessage(emitter, "after");
    await flushAsync();
    expect(onPing).toHaveBeenCalledTimes(2);
    expect((onPing.mock.calls[1][1] as CustomEvent).detail).toBe("after");
    host.remove();
  });

  it("何度付け直しても購読は 1 つのままで、出来事 1 回につきハンドラは 1 回だけ走ること", async () => {
    const onPing = vi.fn();
    const { host, shadowRoot, stateEl } = await mount(
      `<${EMITTER} data-wcs="eventToken.message: ping"></${EMITTER}>`,
      { $eventTokens: ["ping"], $on: { ping: onPing } } as unknown as IState,
    );

    await reattach(host, stateEl);
    await reattach(host, stateEl);
    expect(getOrCreateEventToken(stateEl, "ping").size).toBe(1);

    dispatchMessage(shadowRoot.querySelector(EMITTER)!, "x");
    await flushAsync();
    expect(onPing).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("切断中の出来事は $on に届かず（要素のハンドラが state を引けない）、再接続の後の出来事から再び届くこと", async () => {
    const onPing = vi.fn();
    const { host, shadowRoot, stateEl } = await mount(
      `<${EMITTER} data-wcs="eventToken.message: ping"></${EMITTER}>`,
      { $eventTokens: ["ping"], $on: { ping: onPing } } as unknown as IState,
    );
    const emitter = shadowRoot.querySelector(EMITTER)!;

    host.remove();
    await flushAsync();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let thrown: unknown = null;
    try {
      dispatchMessage(emitter, "detached");
    } catch (error) {
      thrown = error;
    }
    await flushAsync();
    const reported = [thrown, ...consoleError.mock.calls.flat()].map((e) => String((e as Error)?.message ?? e)).join("\n");
    consoleError.mockRestore();
    expect(onPing).not.toHaveBeenCalled();
    expect(reported).toContain("No state tree found on this root for eventToken handler");

    document.body.appendChild(host);
    await stateEl.connectedCallbackPromise;
    await flushAsync();
    dispatchMessage(emitter, "after");
    await flushAsync();
    expect(onPing).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("再接続の後の再セットは、旧宣言のハンドラを外して新しい宣言のハンドラだけを張ること", async () => {
    const oldHandler = vi.fn();
    const newHandler = vi.fn();
    const { host, shadowRoot, stateEl } = await mount(
      `<${EMITTER} data-wcs="eventToken.message: ping"></${EMITTER}>`,
      { $eventTokens: ["ping"], $on: { ping: oldHandler } } as unknown as IState,
    );

    await reattach(host, stateEl);
    stateEl.setInitialState({ $eventTokens: ["ping"], $on: { ping: newHandler } } as unknown as IState);
    expect(getOrCreateEventToken(stateEl, "ping").size).toBe(1);

    dispatchMessage(shadowRoot.querySelector(EMITTER)!, "x");
    await flushAsync();
    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).toHaveBeenCalledTimes(1);
    host.remove();
  });
});

describe("ルート <wcs-state> の再接続と command-token の購読（#273）", () => {
  it("再接続の後も command.<method>: バインドの要素へ $command の emit が届くこと", async () => {
    const { host, shadowRoot, stateEl } = await mount(
      `<${RECEIVER} data-wcs="command.run: $command.rearm"></${RECEIVER}>`,
      { $commandTokens: ["rearm"] } as unknown as IState,
    );
    const receiver = shadowRoot.querySelector(RECEIVER) as IReceiver;
    const tokenBefore = getOrCreateCommandToken(stateEl, "rearm");

    expect(await emitCommand(stateEl, "rearm", "before")).toEqual(["ran"]);

    await reattach(host, stateEl);
    expect(getOrCreateCommandToken(stateEl, "rearm"), "切断は registry を捨てない").toBe(tokenBefore);

    expect(await emitCommand(stateEl, "rearm", "after")).toEqual(["ran"]);
    expect(receiver.calls).toEqual([["before"], ["after"]]);
    host.remove();
  });

  it("切断中は state を作れないので $command を emit できず、要素の購読は再接続の後の emit まで残ること", async () => {
    const { host, shadowRoot, stateEl } = await mount(
      `<${RECEIVER} data-wcs="command.run: $command.rearm"></${RECEIVER}>`,
      { $commandTokens: ["rearm"] } as unknown as IState,
    );
    const receiver = shadowRoot.querySelector(RECEIVER) as IReceiver;

    host.remove();
    await flushAsync();
    expect(() => stateEl.createState("readonly", () => {})).toThrow("State rootNode is not available.");
    expect(getOrCreateCommandToken(stateEl, "rearm").size).toBe(1);

    document.body.appendChild(host);
    await stateEl.connectedCallbackPromise;
    await flushAsync();
    expect(await emitCommand(stateEl, "rearm", "after")).toEqual(["ran"]);
    expect(receiver.calls).toEqual([["after"]]);
    host.remove();
  });

  it("再接続の後も、DOM イベントから emit する onclick: $command.<name> が購読者へ届くこと", async () => {
    const { host, shadowRoot, stateEl } = await mount(
      `<button data-wcs="onclick: $command.rearm">go</button>` +
        `<${RECEIVER} data-wcs="command.run: $command.rearm"></${RECEIVER}>`,
      { $commandTokens: ["rearm"] } as unknown as IState,
    );
    const receiver = shadowRoot.querySelector(RECEIVER) as IReceiver;
    const button = shadowRoot.querySelector("button")!;

    await reattach(host, stateEl);
    const event = new Event("click", { bubbles: true });
    button.dispatchEvent(event);
    await flushAsync();

    expect(receiver.calls).toEqual([[event]]);
    host.remove();
  });
});
