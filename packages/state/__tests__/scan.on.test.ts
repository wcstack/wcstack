/**
 * scan.on.test.ts
 *
 * `$scan` の `on`（event-token の出来事を畳む）— docs/state-scan-design.md §2-2 / D3 / D11。
 * 実 binding（`eventToken.<prop>: <name>`）→ パーサ → 要素 dispatch まで本物で通す。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import type { IWcBindable } from "../src/event/types";
import type { IState } from "../src/types";
import { flushAsync } from "./helpers/streamTestUtils";

const TARGET = "scan-on-target";

beforeAll(() => {
  bootstrapState();
  if (!customElements.get(TARGET)) {
    class Target extends HTMLElement {
      static wcBindable: IWcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [{ name: "message", event: "scan-message" }],
      };
    }
    customElements.define(TARGET, Target);
  }
});

let hostSeq = 0;

async function mount(markup: string, state: IState): Promise<{ host: HTMLElement; shadowRoot: ShadowRoot; stateEl: State }> {
  const host = document.createElement(`scan-on-host-${++hostSeq}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${markup}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(state);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  return { host, shadowRoot, stateEl };
}

function read<T>(stateEl: State, fn: (state: any) => T): T {
  let value: T | undefined;
  stateEl.createState("readonly", (state) => {
    value = fn(state);
  });
  return value as T;
}

const SINGLE = `<${TARGET} data-wcs="eventToken.message: received"></${TARGET}>`;

function dispatch(target: Element, detail: unknown): void {
  target.dispatchEvent(new CustomEvent("scan-message", { detail }));
}

const append = (acc: unknown[], event: unknown): unknown[] => [...acc, (event as CustomEvent).detail];

describe("on: 出来事の scan（D3）", () => {
  it("イベント 1 回につき fold 1 回（同じ task の 2 回も 2 回）で、同じトークンの $on より先に畳むこと", async () => {
    const seenByOn: unknown[] = [];
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append } },
      $on: { received: (state: any) => { seenByOn.push([...state.log]); } },
    } as unknown as IState);

    const target = shadowRoot.querySelector(TARGET)!;
    dispatch(target, "a");
    dispatch(target, "b");
    await flushAsync();

    expect(read(stateEl, (s) => s.log)).toEqual(["a", "b"]);
    expect(seenByOn).toEqual([["a"], ["a", "b"]]);
    host.remove();
  });

  it("fold は (acc, event, ...indexes) を受け、this は undefined で、ループ文脈の indexes が渡ること", async () => {
    let captured: unknown[] = [];
    let seenThis: unknown = "unset";
    const { host, shadowRoot, stateEl } = await mount(
      `<template data-wcs="for: rows">${SINGLE}</template>`,
      {
        rows: [1, 2],
        $eventTokens: ["received"],
        $scan: {
          last: {
            on: "received",
            initial: 0,
            fold: function (this: unknown, acc: unknown, event: unknown, ...indexes: unknown[]): unknown {
              seenThis = this;
              captured = [acc, (event as CustomEvent).detail, ...indexes];
              return (event as CustomEvent).detail;
            },
          },
        },
      } as unknown as IState,
    );

    const targets = shadowRoot.querySelectorAll(TARGET);
    expect(targets).toHaveLength(2);
    dispatch(targets[1], "x");
    await flushAsync();

    expect(captured).toEqual([0, "x", 1]);
    expect(seenThis).toBeUndefined();
    expect(read(stateEl, (s) => s.last)).toBe("x");
    host.remove();
  });

  it("acc と同一参照を返したら書き込まず、出力を見る $watch も鳴らないこと", async () => {
    const watch = vi.fn();
    const { host, shadowRoot } = await mount(SINGLE, {
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: (acc: unknown) => acc } },
      $watch: { log: watch },
    } as unknown as IState);

    dispatch(shadowRoot.querySelector(TARGET)!, "a");
    await flushAsync();
    await flushAsync();

    expect(watch).not.toHaveBeenCalled();
    host.remove();
  });
});

describe("on: 失敗の隔離（D4）", () => {
  it("fold の throw は報告し、同じトークンの $on を巻き添えにしないこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const onHandler = vi.fn();
      const { host, shadowRoot, stateEl } = await mount(SINGLE, {
        $eventTokens: ["received"],
        $scan: { log: { on: "received", initial: [], fold: () => { throw new Error("boom"); } } },
        $on: { received: onHandler },
      } as unknown as IState);

      dispatch(shadowRoot.querySelector(TARGET)!, "a");
      await flushAsync();

      expect(onHandler).toHaveBeenCalledTimes(1);
      expect(read(stateEl, (s) => s.log)).toEqual([]);
      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes(`$scan fold for "log" threw`))).toBe(true);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("fold が Promise を返したら報告して書かないこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { host, shadowRoot, stateEl } = await mount(SINGLE, {
        $eventTokens: ["received"],
        $scan: { log: { on: "received", initial: "seed", fold: async () => "later" } },
      } as unknown as IState);

      dispatch(shadowRoot.querySelector(TARGET)!, "a");
      await flushAsync();

      expect(read(stateEl, (s) => s.log)).toBe("seed");
      const reported = errorSpy.mock.calls.find((call) => String(call[0]).includes(`$scan fold for "log" threw`));
      expect(String((reported?.[1] as Error).message)).toMatch(/returned a Promise/);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("on: resetOn と寿命（D6 / D8）", () => {
  it("resetOn は drain で出力を initial に戻すこと", async () => {
    const initial: unknown[] = [];
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      server: "a",
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial, fold: append, resetOn: ["server"] } },
    } as unknown as IState);
    const target = shadowRoot.querySelector(TARGET)!;

    dispatch(target, "a");
    expect(read(stateEl, (s) => s.log)).toEqual(["a"]);

    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    await flushAsync();
    expect(read(stateEl, (s) => s.log)).toBe(initial);

    dispatch(target, "c");
    expect(read(stateEl, (s) => s.log)).toEqual(["c"]);
    host.remove();
  });

  it("DEFECT(#273): ルート <wcs-state> の再接続で on の購読が外れ、以後は畳まれないこと（$on と同じ寿命）", async () => {
    // $on の購読は `_state` セッターでしか張られず、切断が event-token の registry を捨てる。
    // `on` の scan も同じ経路に乗るので同じく止まる。#273 を直したらこのテストを反転させる。
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append } },
    } as unknown as IState);

    host.remove();
    await flushAsync();
    document.body.appendChild(host);
    await stateEl.connectedCallbackPromise;
    await flushAsync();

    dispatch(shadowRoot.querySelector(TARGET)!, "after-reconnect");
    await flushAsync();
    expect(read(stateEl, (s) => s.log)).toEqual([]);
    host.remove();
  });
});
