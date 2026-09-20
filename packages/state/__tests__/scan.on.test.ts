/**
 * scan.on.test.ts
 *
 * `$scan` の `on`（event-token の出来事を畳む）— docs/state-scan-design.md §2-2 / D3 / D11。
 * 実 binding（`eventToken.<prop>: <name>`）→ パーサ → 要素 dispatch まで本物で通す。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { getTreePath } from "../src/address/TreePath";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { setDevtoolsSink } from "../src/platform/devtoolsSink";
import type { IWcBindable } from "../src/event/types";
import { getPendingScanResetCount, hasPendingScanReset } from "../src/scan/eventReset";
import { getScanEventResetGateCount, getScanRegistry } from "../src/scan/scanRegistry";
import type { IState } from "../src/types";
import { getUpdater } from "../src/updater/updater";
import { getActiveWatchStateElements } from "../src/watch/watchRegistry";
import { flushAsync, flushTimes, readState } from "./helpers/streamTestUtils";

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

  it("出力の読みが throw したら fold を呼ばず、fold の失敗と区別して報告すること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fold = vi.fn(append);
      const { host, shadowRoot, stateEl } = await mount(SINGLE, {
        $eventTokens: ["received"],
        $scan: { log: { on: "received", initial: [], fold } },
      } as unknown as IState);
      stateEl.defineTreeAccessor("log", { get() { throw new Error("output read refused"); }, enumerable: false, configurable: true });

      dispatch(shadowRoot.querySelector(TARGET)!, "a");

      expect(fold).not.toHaveBeenCalled();
      const messages = errorSpy.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes(`$scan could not read the output "log"`))).toBe(true);
      expect(messages.some((m) => m.includes(`$scan fold for "log" threw`))).toBe(false);
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
    expect(readState(stateEl, (s) => s.log)).toEqual(["a"]);

    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    await flushAsync();
    expect(readState(stateEl, (s) => s.log)).toEqual(initial);

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

  it("バインディングの適用で要素が同期に dispatch したイベントの $on が from を書くと、その from の prev は undefined であること", async () => {
    const { host, stateEl } = await mount(
      `<${SYNC_EMITTER} data-wcs="src: server; eventToken.started: started"></${SYNC_EMITTER}>`,
      {
        server: "a",
        n: 0,
        $eventTokens: ["started"],
        $scan: { log: { from: "n", initial: [], fold: (acc: unknown[], cur: unknown, prev: unknown) => [...acc, [cur, prev]] } },
        $on: { started: (state: any) => { state.n = state.n + 1; } },
      } as unknown as IState,
    );
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.log), "接続時の初期同期で dispatch された書き込みは旧値を持つ").toEqual([[1, 0]]);

    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.log)).toEqual([[1, 0], [2, undefined]]);
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
      expect(readState(stateEl, (s) => s.log)).toEqual(initial);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("保留中の出来事で出力の書き込みが throw したら保留は残り、drain が initial に戻すこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let armed = false;
    setDevtoolsSink((event: any) => {
      if (armed && event.type === "state:write" && event.absoluteAddress.absolutePathInfo.pathInfo.path === "log") {
        armed = false;
        throw new Error("write refused once");
      }
    });
    try {
      const initial: unknown[] = [];
      const { host, shadowRoot, stateEl } = await mount(SINGLE, {
        server: "a",
        $eventTokens: ["received"],
        $scan: { log: { on: "received", initial, fold: append, resetOn: ["server"] } },
      } as unknown as IState);
      const target = shadowRoot.querySelector(TARGET)!;
      const [entry] = getScanRegistry(stateEl)!.entries;

      dispatch(target, "a1");
      stateEl.createState("writable", (s: any) => { s.server = "b"; });
      armed = true;
      dispatch(target, "b1");
      expect(readState(stateEl, (s) => s.log)).toEqual(["a1"]);
      // 書き込みの前に保留を消していたので、drain が reset せず ["a1"] のまま残っていた
      expect(hasPendingScanReset(entry), "書き込みが通っていないので保留は残る").toBe(true);

      await flushAsync();
      expect(readState(stateEl, (s) => s.log)).toEqual(initial);
      expect(hasPendingScanReset(entry)).toBe(false);
      host.remove();
    } finally {
      setDevtoolsSink(null);
      errorSpy.mockRestore();
    }
  });

  it("保留中の出来事の fold が Promise を返したら保留は残り、drain が initial に戻すこと", async () => {
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
            fold: (acc: unknown[], event: unknown) =>
              ((event as CustomEvent).detail === "later" ? Promise.resolve(acc) : append(acc, event)),
            resetOn: ["server"],
          },
        },
      } as unknown as IState);
      const target = shadowRoot.querySelector(TARGET)!;
      const [entry] = getScanRegistry(stateEl)!.entries;

      dispatch(target, "a1");
      stateEl.createState("writable", (s: any) => { s.server = "b"; });
      dispatch(target, "later");
      expect(readState(stateEl, (s) => s.log)).toEqual(["a1"]);
      expect(hasPendingScanReset(entry)).toBe(true);

      await flushAsync();
      expect(readState(stateEl, (s) => s.log)).toEqual(initial);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("連鎖深さの上限で打ち切ったバッチの resetOn は保留を捨て、後の出来事で出力を reset しないこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { host, shadowRoot, stateEl } = await mount(SINGLE, {
        n: 0,
        server: "a",
        $eventTokens: ["received"],
        $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["server"] } },
        $watch: {
          n(this: any) {
            if (this.n < 34) this.n = this.n + 1;
            if (this.n === 34) this.server = "b";
          },
        },
      } as unknown as IState);
      const target = shadowRoot.querySelector(TARGET)!;
      const [entry] = getScanRegistry(stateEl)!.entries;

      dispatch(target, "a1");
      stateEl.createState("writable", (s: any) => { s.n = 1; });
      await flushTimes(50);

      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("chain depth limit exceeded"))).toBe(true);
      expect(readState(stateEl, (s) => [s.server, s.log])).toEqual(["b", ["a1"]]);
      // 保留が残っていると、ずっと後の無関係な出来事が突然 initial から畳み始めていた（log は ["x"]）
      expect(hasPendingScanReset(entry)).toBe(false);
      dispatch(target, "x");
      expect(readState(stateEl, (s) => s.log)).toEqual(["a1", "x"]);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("連鎖深さの上限で打ち切ったバッチでも、次のバッチ向けに同じ resetOn が積まれていれば保留を残し、次の drain で from の scan と一緒に reset すること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { host, shadowRoot, stateEl } = await mount(`${SINGLE}<span data-wcs="textContent: server"></span>`, {
        n: 0,
        server: "a",
        $eventTokens: ["received"],
        $scan: {
          log: { on: "received", initial: [], fold: append, resetOn: ["server"] },
          fromLog: { from: "n", initial: [], fold: (acc: unknown[], cur: unknown) => [...acc, cur], resetOn: ["server"] },
        },
        $watch: {
          n(this: any) {
            if (this.n < 33) this.n = this.n + 1;
            else if (this.n === 33) { this.n = 34; this.server = "b"; }
          },
        },
        // 深さ 33 で打ち切られるバッチの binding 適用中に書く — 次のバッチ（深さ 0）に載る
        $updatedCallback(this: any) { if (this.server === "b") this.server = "c"; },
      } as unknown as IState);
      const target = shadowRoot.querySelector(TARGET)!;
      const entry = [...getScanRegistry(stateEl)!.entries].find((e) => e.name === "log")!;

      dispatch(target, "a1");
      stateEl.createState("writable", (s: any) => { s.n = 1; });
      await flushTimes(60);

      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("chain depth limit exceeded"))).toBe(true);
      // 保留を entry ごとの 1 bit で一律に捨てると、log は ["a1"] のまま、fromLog だけが reset されていた
      expect(readState(stateEl, (s) => [s.server, s.log, s.fromLog])).toEqual(["c", [], []]);
      expect(hasPendingScanReset(entry)).toBe(false);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each([
    ["出力 → resetOn の順", true],
    ["resetOn → 出力の順", false],
  ])("$watch ハンドラが reset の書き込みの後に出力と resetOn の両方を書いたら（%s）、次のバッチでもう一度 reset し、from の scan と揃うこと", async (_label, outputFirst) => {
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      server: "a",
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["server"] } },
      $watch: {
        server(this: any) {
          if (this.server !== "b") return;
          if (outputFirst) { this.log = ["x"]; this.server = "c"; } else { this.server = "c"; this.log = ["x"]; }
        },
      },
    } as unknown as IState);
    const [entry] = getScanRegistry(stateEl)!.entries;

    dispatch(shadowRoot.querySelector(TARGET)!, "a1");
    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    await flushTimes(6);

    expect(readState(stateEl, (s) => [s.server, s.log])).toEqual(["c", []]);
    expect(hasPendingScanReset(entry)).toBe(false);
    host.remove();
  });

  it("$watch ハンドラが同期に dispatch した出来事は、reset の書き込みの後に畳まれて残ること", async () => {
    let targetRef: Element | null = null;
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      server: "a",
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["server"] } },
      $watch: { server(this: any) { if (this.server === "b") dispatch(targetRef!, "from-handler"); } },
    } as unknown as IState);
    targetRef = shadowRoot.querySelector(TARGET)!;
    const [entry] = getScanRegistry(stateEl)!.entries;

    dispatch(targetRef, "a1");
    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    await flushTimes(6);

    expect(readState(stateEl, (s) => s.log)).toEqual(["from-handler"]);
    expect(hasPendingScanReset(entry)).toBe(false);
    dispatch(targetRef, "later");
    expect(readState(stateEl, (s) => s.log)).toEqual(["from-handler", "later"]);
    host.remove();
  });

  it("相 2 の再確認で落ちた on の reset の計画でも、次のバッチに同じ resetOn が積まれていれば保留を残すこと（C2-2 と同じ規則）", async () => {
    let hostRef: HTMLElement | null = null;
    let stateRef: State | null = null;
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      n: 0,
      server: "a",
      $eventTokens: ["received"],
      $scan: {
        log: { on: "received", initial: [], fold: append, resetOn: ["server"] },
        // 後続の scan の fold が、次のバッチ向けに server を書いてから同期に切断する
        cut: {
          from: "n",
          initial: 0,
          fold: (acc: number) => {
            stateRef?.createState("writable", (s: any) => { s.server = "c"; });
            hostRef?.remove();
            return acc;
          },
        },
      },
    } as unknown as IState);
    hostRef = host;
    stateRef = stateEl;
    const entry = [...getScanRegistry(stateEl)!.entries].find((e) => e.name === "log")!;
    dispatch(shadowRoot.querySelector(TARGET)!, "a1");

    const abs = (path: string) => createAbsoluteStateAddress(getTreePath(stateEl, getPathInfo(path)), null);
    (stateEl as any).__state.server = "b";
    (stateEl as any).__state.n = 1;
    // server と n を載せたバッチを同期に drain する（fold が積んだ次のバッチはまだ drain しない）
    getUpdater().testApplyChange([abs("server"), abs("n")]);
    expect(hasPendingScanReset(entry), "次のバッチに server が積まれているので残す").toBe(true);

    await flushAsync();
    // 次のバッチは切断中なので発火せず、そこで保留を捨てる
    expect(hasPendingScanReset(entry)).toBe(false);
    expect((stateEl as any).__state.log).toEqual(["a1"]);
  });

  it("resetOn を書いてから drain の前に切断したら保留を捨て、出力は reset しないこと（他に発火対象の state が居る drain）", async () => {
    const other = await mount("", { n: 0, $scan: { total: { from: "n", initial: 0, fold: (acc: number) => acc + 1 } } } as unknown as IState);
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      server: "a",
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["server"] } },
    } as unknown as IState);
    const [entry] = getScanRegistry(stateEl)!.entries;

    dispatch(shadowRoot.querySelector(TARGET)!, "a1");
    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    expect(hasPendingScanReset(entry)).toBe(true);
    host.remove();
    expect(getActiveWatchStateElements().has(other.stateEl)).toBe(true);
    await flushAsync();

    expect(hasPendingScanReset(entry)).toBe(false);
    expect((stateEl as any).__state.log).toEqual(["a1"]);
    other.host.remove();
  });

  it("resetOn を書いてから drain の前に切断したら保留を捨てること（発火対象の state が 1 つも無い drain）", async () => {
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      server: "a",
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["server"] } },
    } as unknown as IState);
    const [entry] = getScanRegistry(stateEl)!.entries;

    dispatch(shadowRoot.querySelector(TARGET)!, "a1");
    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    host.remove();
    expect(getActiveWatchStateElements().size).toBe(0);
    await flushAsync();

    expect(hasPendingScanReset(entry)).toBe(false);
    expect((stateEl as any).__state.log).toEqual(["a1"]);
  });

  it("先行する scan の fold が同期に切断したら、同じバッチの on scan の保留を捨てること（相 1 の再確認）", async () => {
    let hostRef: HTMLElement | null = null;
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      n: 0,
      server: "a",
      $eventTokens: ["received"],
      $scan: {
        cut: { from: "n", initial: 0, fold: (acc: number) => { hostRef?.remove(); return acc; } },
        log: { on: "received", initial: [], fold: append, resetOn: ["server"] },
      },
    } as unknown as IState);
    hostRef = host;
    const entry = [...getScanRegistry(stateEl)!.entries].find((e) => e.name === "log")!;

    dispatch(shadowRoot.querySelector(TARGET)!, "a1");
    stateEl.createState("writable", (s: any) => { s.n = 1; s.server = "b"; });
    expect(hasPendingScanReset(entry)).toBe(true);
    await flushAsync();

    expect(hasPendingScanReset(entry)).toBe(false);
    expect((stateEl as any).__state.log).toEqual(["a1"]);
  });

  it("後続の scan の fold が同期に切断したら、先に計画した on scan の reset も書かず保留を捨てること（相 2 の再確認）", async () => {
    let hostRef: HTMLElement | null = null;
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      n: 0,
      server: "a",
      $eventTokens: ["received"],
      $scan: {
        log: { on: "received", initial: [], fold: append, resetOn: ["server"] },
        cut: { from: "n", initial: 0, fold: (acc: number) => { hostRef?.remove(); return acc; } },
      },
    } as unknown as IState);
    hostRef = host;
    const entry = [...getScanRegistry(stateEl)!.entries].find((e) => e.name === "log")!;

    dispatch(shadowRoot.querySelector(TARGET)!, "a1");
    stateEl.createState("writable", (s: any) => { s.n = 1; s.server = "b"; });
    await flushAsync();

    expect(hasPendingScanReset(entry)).toBe(false);
    expect((stateEl as any).__state.log).toEqual(["a1"]);
  });

  it("発火対象でない（切断中の）state への書き込みは、他の state が enqueue のゲートを開けていても reset を保留しないこと", async () => {
    // 同じ宣言を持つ別の state が接続中なので、ゲートは開いたまま（切断した state 自身の判定まで進む）
    const other = await mount(SINGLE, {
      server: "a",
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["server"] } },
    } as unknown as IState);
    const { host, stateEl } = await mount(SINGLE, {
      server: "a",
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["server"] } },
    } as unknown as IState);
    const [entry] = getScanRegistry(stateEl)!.entries;

    host.remove();
    expect(getScanEventResetGateCount()).toBeGreaterThan(0);
    getUpdater().enqueueAbsoluteAddress(createAbsoluteStateAddress(getTreePath(stateEl, getPathInfo("server")), null));
    expect(hasPendingScanReset(entry)).toBe(false);
    await flushAsync();
    other.host.remove();
  });

  it.each([
    ["同じオブジェクト", (_stateEl: State, declaration: Record<string, unknown>): unknown => declaration],
    ["値のコピー", (stateEl: State): unknown => ({ ...(stateEl as any).__state })],
  ])("resetOn の書き込みと drain の間に再セット（%s）しても、同じ出力の on scan が保留を引き継ぎ、書き込み後のイベントを initial から畳んで from の scan と揃うこと", async (_label, next) => {
    const declaration: Record<string, unknown> = {
      host: "a",
      n: 0,
      $eventTokens: ["received"],
      $scan: {
        onLog: { on: "received", initial: [], fold: append, resetOn: ["host"] },
        fromLog: { from: "n", initial: [], fold: (acc: unknown[], cur: unknown) => [...acc, cur], resetOn: ["host"] },
      },
    };
    const { host, shadowRoot, stateEl } = await mount(SINGLE, declaration as unknown as IState);
    const target = shadowRoot.querySelector(TARGET)!;
    dispatch(target, "a1");
    stateEl.createState("writable", (s: any) => { s.n = 1; });
    await flushTimes(3);
    expect(readState(stateEl, (s) => [s.onLog, s.fromLog])).toEqual([["a1"], [1]]);

    stateEl.createState("writable", (s: any) => { s.host = "b"; });
    stateEl.setInitialState(next(stateEl, declaration) as IState);
    const onEntry = [...getScanRegistry(stateEl)!.entries].find((e) => e.name === "onLog")!;
    expect(hasPendingScanReset(onEntry), "新しい entry が保留を持つ").toBe(true);
    dispatch(target, "b1");
    await flushTimes(3);

    // 引き継がないと [["a1", "b1"], []] — on だけが reset されない
    expect(readState(stateEl, (s) => [s.onLog, s.fromLog])).toEqual([["b1"], []]);
    expect(hasPendingScanReset(onEntry)).toBe(false);
    host.remove();
  });

  it("再セットの後の宣言が、書き込まれた resetOn のパスを持たない・出力名が違うときは、保留を引き継がないこと", async () => {
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      host: "a",
      server: "a",
      other: 0,
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["host", "server"] } },
    } as unknown as IState);
    const target = shadowRoot.querySelector(TARGET)!;
    dispatch(target, "a1");

    // server を書いたが、新しい宣言の resetOn に server が無い（host は重なるが、積まれていない）
    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    stateEl.setInitialState({
      ...(stateEl as any).__state,
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["other", "host"] } },
    } as unknown as IState);
    const [logEntry] = getScanRegistry(stateEl)!.entries;
    expect(hasPendingScanReset(logEntry)).toBe(false);
    dispatch(target, "a2");
    await flushTimes(3);
    expect(readState(stateEl, (s) => s.log)).toEqual(["a1", "a2"]);

    // 同じ resetOn を書いても、出力名が違えば別の出力なので引き継がない
    stateEl.createState("writable", (s: any) => { s.host = "c"; });
    stateEl.setInitialState({
      ...(stateEl as any).__state,
      $scan: { renamed: { on: "received", initial: [], fold: append, resetOn: ["host"] } },
    } as unknown as IState);
    const [renamedEntry] = getScanRegistry(stateEl)!.entries;
    expect(hasPendingScanReset(renamedEntry)).toBe(false);
    await flushTimes(3);
    host.remove();
  });

  it("書き込みを載せたバッチの drain 中（バインディング適用中の $updatedCallback）の再セットでは保留を引き継がず、on だけが書き込み済みの値を reset しないこと（仕様の線引き）", async () => {
    let armed = false;
    let stateRef: State | null = null;
    const declaration: Record<string, unknown> = {
      host: "a",
      n: 0,
      $eventTokens: ["received"],
      $scan: {
        onLog: { on: "received", initial: [], fold: append, resetOn: ["host"] },
        fromLog: { from: "n", initial: [], fold: (acc: unknown[], cur: unknown) => [...acc, cur], resetOn: ["host"] },
      },
      $updatedCallback() {
        if (armed) {
          armed = false;
          stateRef!.setInitialState(declaration as unknown as IState);
        }
      },
    };
    const { host, shadowRoot, stateEl } = await mount(`${SINGLE}<span data-wcs="textContent: host"></span>`, declaration as unknown as IState);
    stateRef = stateEl;
    const target = shadowRoot.querySelector(TARGET)!;
    dispatch(target, "a1");
    stateEl.createState("writable", (s: any) => { s.n = 1; });
    await flushTimes(3);
    const pending0 = getPendingScanResetCount();

    armed = true;
    stateEl.createState("writable", (s: any) => { s.host = "b"; });
    await flushTimes(4);
    // 書き込みは drain 中のバッチにあり、キューには無いので引き継がない（再セットしなければ [[], []]）
    expect(armed).toBe(false);
    expect(readState(stateEl, (s) => [s.onLog, s.fromLog])).toEqual([["a1"], []]);
    expect(getPendingScanResetCount()).toBe(pending0);
    dispatch(target, "later");
    expect(readState(stateEl, (s) => s.onLog)).toEqual(["a1", "later"]);

    // 揃えたいときは、再セットの後で resetOn のパスへもう一度書き込む
    stateEl.createState("writable", (s: any) => { s.host = "c"; });
    await flushTimes(4);
    expect(readState(stateEl, (s) => [s.onLog, s.fromLog])).toEqual([[], []]);
    host.remove();
  });

  it("再セットで足した reset 条件と from から on への変更では、書き込み済みの値に on の scan は reset しないこと（仕様の線引き）", async () => {
    const fromFold = (acc: unknown[], cur: unknown): unknown[] => [...acc, cur];
    const withReset = {
      onLog: { on: "received", initial: [], fold: append, resetOn: ["host"] },
      fromLog: { from: "n", initial: [], fold: fromFold, resetOn: ["host"] },
    };

    // resetOn を持たない宣言に、再セットで足す
    const added = await mount(SINGLE, {
      host: "a",
      n: 0,
      $eventTokens: ["received"],
      $scan: { onLog: { on: "received", initial: [], fold: append }, fromLog: { from: "n", initial: [], fold: fromFold } },
    } as unknown as IState);
    dispatch(added.shadowRoot.querySelector(TARGET)!, "a1");
    added.stateEl.createState("writable", (s: any) => { s.n = 1; });
    await flushTimes(3);
    added.stateEl.createState("writable", (s: any) => { s.host = "b"; });
    added.stateEl.setInitialState({ ...(added.stateEl as any).__state, $scan: withReset } as unknown as IState);
    dispatch(added.shadowRoot.querySelector(TARGET)!, "b1");
    await flushTimes(3);
    expect(readState(added.stateEl, (s) => [s.onLog, s.fromLog]), "足した reset 条件").toEqual([["a1", "b1"], []]);
    added.host.remove();

    // 同じ出力名を from から on に変える（onLog は on のままなので引き継ぐ）
    const changed = await mount(SINGLE, {
      host: "a",
      n: 0,
      $eventTokens: ["received"],
      $scan: withReset,
    } as unknown as IState);
    dispatch(changed.shadowRoot.querySelector(TARGET)!, "a1");
    changed.stateEl.createState("writable", (s: any) => { s.n = 1; });
    await flushTimes(3);
    changed.stateEl.createState("writable", (s: any) => { s.host = "b"; });
    changed.stateEl.setInitialState({
      ...(changed.stateEl as any).__state,
      $scan: {
        onLog: withReset.onLog,
        fromLog: { on: "received", initial: [], fold: append, resetOn: ["host"] },
      },
    } as unknown as IState);
    dispatch(changed.shadowRoot.querySelector(TARGET)!, "b1");
    await flushTimes(3);
    expect(readState(changed.stateEl, (s) => [s.onLog, s.fromLog]), "from → on").toEqual([["b1"], [1, "b1"]]);
    changed.host.remove();
  });

  it("保留中の出来事の fold には、宣言の initial ではなく複製を渡すこと（出力が initial と同じ値なら、その出力を渡す）", async () => {
    const INITIAL = { items: [] as unknown[] };
    const received: unknown[] = [];
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      server: "a",
      $eventTokens: ["received"],
      $scan: {
        log: {
          on: "received",
          initial: INITIAL,
          fold: (acc: any, event: unknown) => {
            received.push(acc);
            return { items: [...acc.items, (event as CustomEvent).detail] };
          },
          resetOn: ["server"],
        },
      },
    } as unknown as IState);
    const target = shadowRoot.querySelector(TARGET)!;
    const materialized = readState(stateEl, (s) => s.log);

    // 出力が initial と同じ値のまま保留した
    stateEl.createState("writable", (s: any) => { s.server = "b"; });
    dispatch(target, "a1");
    expect(received[0]).toBe(materialized);
    await flushAsync();

    // 出力が変わってから保留した
    stateEl.createState("writable", (s: any) => { s.server = "c"; });
    dispatch(target, "b1");
    expect(received[1]).toEqual({ items: [] });
    expect(received[1]).not.toBe(INITIAL);
    expect(readState(stateEl, (s) => s.log)).toEqual({ items: ["b1"] });
    expect(INITIAL).toEqual({ items: [] });
    host.remove();
  });

  it("resetOn のオブジェクトのパスは、そのオブジェクト自身の書き込みで reset を保留し、子への書き込み（パスが一致しない）では保留しないこと", async () => {
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      filter: { text: "a" },
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append, resetOn: ["filter"] } },
    } as unknown as IState);
    const [entry] = getScanRegistry(stateEl)!.entries;
    const target = shadowRoot.querySelector(TARGET)!;
    dispatch(target, "a1");

    stateEl.createState("writable", (s: any) => { s["filter.text"] = "b"; });
    expect(hasPendingScanReset(entry), "子への書き込み").toBe(false);
    await flushAsync();
    dispatch(target, "a2");
    expect(readState(stateEl, (s) => s.log)).toEqual(["a1", "a2"]);

    stateEl.createState("writable", (s: any) => { s.filter = { text: "b" }; });
    expect(hasPendingScanReset(entry), "同じ内容の再代入").toBe(true);
    await flushAsync();
    expect(readState(stateEl, (s) => s.log)).toEqual([]);
    expect(hasPendingScanReset(entry)).toBe(false);
    host.remove();
  });

  it("on の scan の出力を from に取ると、drain の外の書き込みと同じく prev を受けること（from の scan の出力なら undefined）", async () => {
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      $eventTokens: ["received"],
      $scan: {
        count: { on: "received", initial: 0, fold: (n: number) => n + 1 },
        log: { from: "count", initial: [], fold: (acc: unknown[], cur: unknown, prev: unknown) => [...acc, [cur, prev]] },
      },
    } as unknown as IState);
    const target = shadowRoot.querySelector(TARGET)!;

    dispatch(target, "a");
    await flushTimes(3);
    dispatch(target, "b");
    await flushTimes(3);

    expect(readState(stateEl, (s) => s.log)).toEqual([[1, 0], [2, 1]]);
    host.remove();
  });

  it("ルート <wcs-state> の再接続の後も on の購読が残り、畳み続けること（$on と同じ寿命・#273）", async () => {
    // $on の購読は `_state` セッターでしか張られない。切断が event-token の registry を捨てていた頃は、
    // 再接続の後の出来事が購読者の居ない新しい token に届き、無言で畳まれなかった
    const { host, shadowRoot, stateEl } = await mount(SINGLE, {
      $eventTokens: ["received"],
      $scan: { log: { on: "received", initial: [], fold: append } },
    } as unknown as IState);

    dispatch(shadowRoot.querySelector(TARGET)!, "before");
    await flushAsync();
    host.remove();
    await flushAsync();
    document.body.appendChild(host);
    await stateEl.connectedCallbackPromise;
    await flushAsync();

    dispatch(shadowRoot.querySelector(TARGET)!, "after-reconnect");
    await flushAsync();
    expect(readState(stateEl, (s) => s.log)).toEqual(["before", "after-reconnect"]);
    host.remove();
  });
});
