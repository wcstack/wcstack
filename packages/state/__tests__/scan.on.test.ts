/**
 * scan.on.test.ts
 *
 * `$scan` の `on`（event-token の出来事を畳む）— docs/state-scan-design.md §2-2 / D3 / D11。
 * 実 binding（`eventToken.<prop>: <name>`）→ パーサ → 要素 dispatch まで本物で通す。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { getAbsolutePathInfo } from "../src/address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { setDevtoolsSink } from "../src/devtools/sink";
import type { IWcBindable } from "../src/event/types";
import { hasPendingScanReset } from "../src/scan/eventReset";
import { getScanRegistry } from "../src/scan/scanRegistry";
import type { IState } from "../src/types";
import { getUpdater } from "../src/updater/updater";
import { flushAsync, readState } from "./helpers/streamTestUtils";

const TARGET = "scan-on-target";
/** 入力プロパティ `src` を書かれた瞬間に、出力イベントを同期に dispatch する要素 */
const SYNC_EMITTER = "scan-on-sync-emitter";

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
  if (!customElements.get(SYNC_EMITTER)) {
    class SyncEmitter extends HTMLElement {
      static wcBindable: IWcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [{ name: "started", event: "scan-started" }],
        inputs: [{ name: "src" }],
      };
      private _src = "";
      get src(): string { return this._src; }
      set src(value: string) {
        this._src = value;
        this.dispatchEvent(new CustomEvent("scan-started", { detail: `started:${value}` }));
      }
    }
    customElements.define(SYNC_EMITTER, SyncEmitter);
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

    expect(readState(stateEl, (s) => s.log)).toEqual(["a", "b"]);
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
    expect(readState(stateEl, (s) => s.last)).toBe("x");
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
      expect(readState(stateEl, (s) => s.log)).toEqual([]);
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

      expect(readState(stateEl, (s) => s.log)).toBe("seed");
      const reported = errorSpy.mock.calls.find((call) => String(call[0]).includes(`$scan fold for "log" returned a Promise`));
      expect(String((reported?.[1] as Error).message)).toMatch(/returned a Promise/);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("出力への書き込みが throw したら fold の失敗と区別して報告し、同じトークンの $on を巻き添えにしないこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setDevtoolsSink((event: any) => {
      if (event.type === "state:write" && event.absoluteAddress.absolutePathInfo.pathInfo.path === "log") {
        throw new Error("write refused");
      }
    });
    try {
      const onHandler = vi.fn();
      const { host, shadowRoot, stateEl } = await mount(SINGLE, {
        $eventTokens: ["received"],
        $scan: { log: { on: "received", initial: [], fold: append } },
        $on: { received: onHandler },
      } as unknown as IState);

      dispatch(shadowRoot.querySelector(TARGET)!, "a");
      await flushAsync();

      expect(onHandler).toHaveBeenCalledTimes(1);
      expect(readState(stateEl, (s) => s.log)).toEqual([]);
      const messages = errorSpy.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes(`$scan could not write the output "log"`))).toBe(true);
      expect(messages.some((m) => m.includes(`$scan fold for "log" threw`))).toBe(false);
      host.remove();
    } finally {
      setDevtoolsSink(null);
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
    expect(readState(stateEl, (s) => s.log)).toEqual(["a"]);

    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    await flushAsync();
    expect(readState(stateEl, (s) => s.log)).toBe(initial);

    dispatch(target, "c");
    expect(readState(stateEl, (s) => s.log)).toEqual(["c"]);
    host.remove();
  });

  it("resetOn の書き込みより後に同じジョブで来た出来事は、initial から畳まれ、drain で消えないこと", async () => {
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      server: "a",
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["server"] } },
    } as unknown as IState);
    const target = shadowRoot.querySelector(TARGET)!;

    dispatch(target, "a1");
    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    dispatch(target, "b1");
    expect(readState(stateEl, (s) => s.log)).toEqual(["b1"]);

    await flushAsync();
    expect(readState(stateEl, (s) => s.log), "出来事が reset を消費したので drain は戻さない").toEqual(["b1"]);
    host.remove();
  });

  it("同じジョブで resetOn を 2 回書くと、2 回目の後の出来事も initial から畳むこと", async () => {
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      server: "a",
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["server"] } },
    } as unknown as IState);
    const target = shadowRoot.querySelector(TARGET)!;

    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    dispatch(target, "b1");
    stateEl.createState("writable", (s: any) => { s.server = "c"; });
    dispatch(target, "c1");
    await flushAsync();

    expect(readState(stateEl, (s) => s.log)).toEqual(["c1"]);
    host.remove();
  });

  it("resetOn の書き込みを binding に適用する最中に要素が同期に dispatch した出来事も、reset 後の出力に残ること", async () => {
    const { host, stateEl } = await mount(
      `<${SYNC_EMITTER} data-wcs="src: server; eventToken.started: started"></${SYNC_EMITTER}>`,
      {
        server: "a",
        $eventTokens: ["started"],
        $scan: { log: { on: "started", initial: [], fold: append, resetOn: ["server"] } },
      } as unknown as IState,
    );
    await flushAsync();
    expect(readState(stateEl, (s) => s.log)).toEqual(["started:a"]);

    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    await flushAsync();
    await flushAsync();

    expect(readState(stateEl, (s) => s.log)).toEqual(["started:b"]);
    host.remove();
  });

  it("保留中の出来事の fold が throw したら保留は残り、drain が initial に戻すこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const initial: unknown[] = [];
      const { host, shadowRoot, stateEl } = await mount(SINGLE, {
        server: "a",
        $eventTokens: ["received"],
        $scan: {
          log: {
            on: "received",
            initial,
            fold: (acc: unknown[], event: unknown) => {
              if ((event as CustomEvent).detail === "boom") throw new Error("boom");
              return append(acc, event);
            },
            resetOn: ["server"],
          },
        },
      } as unknown as IState);
      const target = shadowRoot.querySelector(TARGET)!;

      dispatch(target, "a1");
      stateEl.createState("writable", (s: any) => { s.server = "b"; });
      dispatch(target, "boom");
      expect(readState(stateEl, (s) => s.log)).toEqual(["a1"]);

      await flushAsync();
      expect(readState(stateEl, (s) => s.log)).toBe(initial);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("発火対象でない（切断中の）state への書き込みは reset を保留しないこと", async () => {
    const { host, stateEl } = await mount(SINGLE, {
      server: "a",
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["server"] } },
    } as unknown as IState);
    const [entry] = getScanRegistry(stateEl)!.entries;

    host.remove();
    getUpdater().enqueueAbsoluteAddress(createAbsoluteStateAddress(getAbsolutePathInfo(stateEl, getPathInfo("server")), null));
    expect(hasPendingScanReset(entry)).toBe(false);
    await flushAsync();
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
    expect(readState(stateEl, (s) => s.log)).toEqual([]);
    host.remove();
  });
});
