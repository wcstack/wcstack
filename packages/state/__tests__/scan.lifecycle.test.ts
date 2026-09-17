/**
 * scan.lifecycle.test.ts
 *
 * `$scan` の寿命（docs/state-scan-design.md D7 / D8 / §2-4）。
 * 切断・再接続・`_state` 再セット・throw した再セット・SSR・ボリューム・マウント。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { getTreePath } from "../src/address/TreePath";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { getPathInfo } from "../src/address/PathInfo";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import type { IWcBindable } from "../src/event/types";
import { getScanRegistry } from "../src/scan/scanRegistry";
import { getUpdater } from "../src/updater/updater";
import { getActiveWatchStateElements } from "../src/watch/watchRegistry";
import type { IState } from "../src/types";
import { flushAsync, flushTimes, makeConnectHost, readState, writeState } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("scan-lc-host");

describe("切断と再接続（D8）", () => {
  it("切断中のバッチは畳まず、再接続後は再開し、出力は保持されること", async () => {
    const fold = vi.fn((acc: number, cur: number) => acc + cur);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { total: { from: "n", initial: 0, fold } },
    } as unknown as IState);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();
    expect(readState(stateEl, (s) => s.total)).toBe(1);

    host.remove();
    await flushAsync();
    expect(getActiveWatchStateElements().has(stateEl)).toBe(false);
    // registry は保持する（切断は「発火しなくなる」だけ — $watch と同じ二段構え）
    expect(getScanRegistry(stateEl)).toBeDefined();

    // 切断中に from が書かれたバッチ
    (stateEl as any).__state.n = 5;
    getUpdater().testApplyChange([createAbsoluteStateAddress(getTreePath(stateEl, getPathInfo("n")), null)]);
    await flushTimes();
    expect(fold).toHaveBeenCalledTimes(1);

    document.body.appendChild(host);
    await stateEl.connectedCallbackPromise;
    await flushAsync();
    expect(getActiveWatchStateElements().has(stateEl)).toBe(true);
    expect(readState(stateEl, (s) => s.total), "出力は保持される").toBe(1);

    writeState(stateEl, (s) => { s.n = 7; });
    await flushTimes();
    expect(readState(stateEl, (s) => s.total)).toBe(8);
    expect(fold).toHaveBeenCalledTimes(2);
    host.remove();
  });
});

describe("同じ drain の $watch ハンドラによる切断（D8）", () => {
  it("ハンドラが要素を切断しても、scan の書き込みは $watch より前なので、接続中の着地は畳まれて残ること", async () => {
    let hostRef: HTMLElement | null = null;
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { total: { from: "n", initial: 0, fold: (acc: number, cur: number) => acc + cur } },
      $watch: { n(this: any) { if (this.n === 2) hostRef?.remove(); } },
    } as unknown as IState);
    hostRef = host;

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes(4);
    writeState(stateEl, (s) => { s.n = 2; });
    await flushTimes(4);
    // n = 2 は接続中に着地し、切断より前に畳んで書かれている
    expect((stateEl as any).__state.total).toBe(3);

    document.body.appendChild(host);
    await stateEl.connectedCallbackPromise;
    await flushTimes(4);
    expect(readState(stateEl, (s) => s.total), "再接続後も保持する").toBe(3);

    writeState(stateEl, (s) => { s.n = 3; });
    await flushTimes(4);
    expect(readState(stateEl, (s) => s.total), "以後の着地も畳む").toBe(6);
    host.remove();
  });
});

describe("_state の再セット（§2-4）", () => {
  it("宣言を作り直し、旧宣言の scan は発火せず、宣言が消えたら registry と scanPaths も消えること", async () => {
    const foldA = vi.fn((acc: number) => acc + 1);
    const foldB = vi.fn((acc: number) => acc + 1);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { a: { from: "n", initial: 0, fold: foldA } },
    } as unknown as IState);

    stateEl.setInitialState({ n: 0, $scan: { b: { from: "n", initial: 0, fold: foldB } } } as unknown as IState);
    await flushAsync();
    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();
    expect(foldA).not.toHaveBeenCalled();
    expect(foldB).toHaveBeenCalledTimes(1);

    stateEl.setInitialState({ n: 0 } as unknown as IState);
    await flushAsync();
    expect(stateEl.scanPaths).toBeNull();
    expect(getScanRegistry(stateEl)).toBeUndefined();
    expect(getActiveWatchStateElements().has(stateEl)).toBe(false);
    writeState(stateEl, (s) => { s.n = 2; });
    await flushTimes();
    expect(foldB).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("$scan の検証で throw した再セットは世代を進めず、旧宣言のまま発火し続けること", async () => {
    const foldA = vi.fn((acc: number) => acc + 1);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { a: { from: "n", initial: 0, fold: foldA } },
    } as unknown as IState);

    expect(() => stateEl.setInitialState({ n: 100, $scan: { bad: 1 } } as unknown as IState))
      .toThrow(/\[wcs\/scan-declaration-invalid\]/);
    expect(readState(stateEl, (s) => s.n), "旧世代の state のまま").toBe(0);

    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();
    expect(foldA).toHaveBeenCalledTimes(1);
    expect(readState(stateEl, (s) => s.a)).toBe(1);
    host.remove();
  });

  it("$recursion の ** getter の展開形を from に書いた再セットは wcs/scan-source-computed で raise し、世代を進めないこと（D5）", async () => {
    const foldA = vi.fn((acc: number) => acc + 1);
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { a: { from: "n", initial: 0, fold: foldA } },
    } as unknown as IState);
    const next: Record<string, unknown> = {
      n: 0,
      nodes: [{ value: 1, children: [] }],
      $recursion: { "nodes.*": "children.*" },
      $scan: { log: { from: "nodes.*.total", initial: [], fold: (acc: unknown) => acc } },
    };
    Object.defineProperty(next, "nodes.**.total", {
      get(this: any) { return this["nodes.**.value"]; },
      enumerable: true,
      configurable: true,
    });

    expect(() => stateEl.setInitialState(next as unknown as IState))
      .toThrow(/\[wcs\/scan-source-computed\] \$scan entry "log" from "nodes\.\*\.total" is computed by the recursive getter "nodes\.\*\*\.total"/);
    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();
    expect(foldA).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("fold が関数を返す出力も、同じオブジェクト・値のコピーの再セットで累積を保ち、メソッド衝突にしないこと（D7）", async () => {
    const raw = {
      n: 0,
      $scan: { handler: { from: "n", initial: (): string => "initial", fold: (_acc: unknown, cur: number) => (): string => `n=${cur}` } },
    } as unknown as IState;
    const { host, stateEl } = await connectHost("", raw);
    writeState(stateEl, (s) => { s.n = 1; });
    await flushTimes();

    expect(() => stateEl.setInitialState(raw)).not.toThrow();
    expect(() => stateEl.setInitialState({ ...(raw as object) } as IState)).not.toThrow();
    expect((stateEl as any).__state.handler()).toBe("n=1");
    writeState(stateEl, (s) => { s.n = 2; });
    await flushTimes();
    expect((stateEl as any).__state.handler()).toBe("n=2");
    host.remove();
  });

  it("旧宣言と同じ出力名でも、新しいオブジェクトが本物のメソッドを宣言していれば、再セットはメソッド衝突として raise すること（D7）", async () => {
    const fold = (acc: number, cur: number): number => acc + cur;
    const { host, stateEl } = await connectHost("", {
      n: 0,
      $scan: { handler: { from: "n", initial: 0, fold } },
    } as unknown as IState);

    // 名前だけで通すと raise せず、畳むと出力が "handler() {…}2" になっていた
    expect(() => stateEl.setInitialState({
      n: 0,
      handler(): string { return "method"; },
      $scan: { handler: { from: "n", initial: 0, fold } },
    } as unknown as IState)).toThrow(/\$scan entry "handler" conflicts with a method/);
    host.remove();
  });

  it("世代を進めた後に throw した再セットを挟んでも、新しいオブジェクトの同名の本物のメソッドは raise すること（D7）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fold = (acc: number, cur: number): number => acc + cur;
      const { host, stateEl } = await connectHost("", {
        n: 0,
        $scan: { handler: { from: "n", initial: 0, fold } },
      } as unknown as IState);
      const method = function handler(): string { return "method"; };

      // `$streams` の検査は世代を進めた後に走るので、`__state` だけがこのオブジェクトに替わり、registry は旧宣言のまま残る
      expect(() => stateEl.setInitialState({ n: 0, handler: method, $streams: { s: { source: 1 } } } as unknown as IState)).toThrow();
      // `__state` から旧出力を引くと method そのものに見えて通り、畳むと出力が「メソッドのソース + 2」になっていた
      expect(() => stateEl.setInitialState({
        n: 0,
        handler: method,
        $scan: { handler: { from: "n", initial: 0, fold } },
      } as unknown as IState)).toThrow(/\$scan entry "handler" conflicts with a method/);
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("世代を進めた後に throw した再セットの後に fold が返した関数値も、その state のコピーでの再セットでメソッド衝突にしないこと（D7）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const declaration = { handler: { from: "n", initial: (): number => 0, fold: (_acc: unknown, cur: number) => (): number => cur } };
      const first: Record<string, unknown> = { n: 0, $scan: declaration };
      const { host, stateEl } = await connectHost("", first as unknown as IState);
      writeState(stateEl, (s) => { s.n = 1; });
      await flushTimes();

      // `$streams` の検査で throw — 世代は進み、以後の fold はこのオブジェクトにだけ書く（registry は旧宣言のまま）
      const thrown: Record<string, unknown> = { ...first, $streams: { s: { source: 1 } } };
      expect(() => stateEl.setInitialState(thrown as unknown as IState)).toThrow();
      writeState(stateEl, (s) => { s.n = 2; });
      await flushTimes();
      expect((thrown.handler as () => number)()).toBe(2);
      expect((first.handler as () => number)()).toBe(1);

      // 旧 registry の state オブジェクトから旧出力を引いていたときは、thrown.handler が旧出力と一致せず raise していた
      expect(() => stateEl.setInitialState({ n: 2, handler: thrown.handler, $scan: declaration } as unknown as IState)).not.toThrow();
      host.remove();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("throw する getter を持つ initial は参照のまま置くので、再セットが途中で落ちないこと（D7）", async () => {
    const { host, stateEl } = await connectHost("", { n: 0 } as unknown as IState);
    const initial = { get boom(): never { throw new Error("getter boom"); } };

    expect(() => stateEl.setInitialState({
      n: 0,
      $scan: { out: { from: "n", initial, fold: (acc: unknown) => acc } },
    } as unknown as IState)).not.toThrow();
    expect((stateEl as any).__state.out).toBe(initial);
    host.remove();
  });

  it("同じオブジェクトの再セットでは出力が既にあるので、累積を保持すること（D7）", async () => {
    const raw = {
      n: 0,
      $scan: { total: { from: "n", initial: 0, fold: (acc: number, cur: number) => acc + cur } },
    } as unknown as IState;
    const { host, stateEl } = await connectHost("", raw);

    writeState(stateEl, (s) => { s.n = 3; });
    await flushTimes();
    stateEl.setInitialState(raw);
    await flushAsync();
    expect(readState(stateEl, (s) => s.total)).toBe(3);

    writeState(stateEl, (s) => { s.n = 4; });
    await flushTimes();
    expect(readState(stateEl, (s) => s.total)).toBe(7);
    host.remove();
  });
});

describe("SSR / ボリューム / マウント（D8）", () => {
  it("SSR では from が発火せず、出力の実体化だけ行うこと", async () => {
    document.documentElement.setAttribute("data-wcs-server", "");
    let host: HTMLElement | null = null;
    try {
      const fold = vi.fn((acc: unknown) => acc);
      const raw = { n: 0, $scan: { out: { from: "n", initial: "seed", fold } } } as unknown as IState;
      const connected = await connectHost("", raw);
      host = connected.host;

      expect((raw as Record<string, unknown>).out).toBe("seed");
      expect(getActiveWatchStateElements().has(connected.stateEl)).toBe(false);
      writeState(connected.stateEl, (s) => { s.n = 1; });
      await flushTimes();
      expect(fold).not.toHaveBeenCalled();
    } finally {
      host?.remove();
      document.documentElement.removeAttribute("data-wcs-server");
    }
  });

  it("ボリュームの $scan は接ぎ木前に名指しで拒否されること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      document.body.innerHTML = `<wcs-state json='{"root":1}'></wcs-state><wcs-state mount="sc"></wcs-state>`;
      const rootEl = document.querySelector("wcs-state:not([mount])") as State;
      const volumeEl = document.querySelector("wcs-state[mount]") as State;
      volumeEl.setInitialState({ plain: 1, $scan: { x: { from: "plain", initial: 0, fold: (acc: unknown) => acc } } } as unknown as IState);
      await rootEl.connectedCallbackPromise;
      await volumeEl.connectedCallbackPromise;
      await flushTimes();

      const messages = errorSpy.mock.calls.map((call) => String(call[0]) + "|" + String((call[1] as any)?.message ?? ""));
      expect(messages.some((m) => m.includes("declares $scan, which volumes do not support yet"))).toBe(true);
      expect((rootEl as any).__state.sc).toBeUndefined();
    } finally {
      errorSpy.mockRestore();
      document.body.innerHTML = "";
    }
  });

  it("実際にマウントした bind-component の $scan は、from も on も畳まず、出力を実体化せず、registry も作らないこと", async () => {
    const { clearMountDollarWarnsForTesting } = await import("../src/webComponent/mount");
    clearMountDollarWarnsForTesting();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const COMPONENT = "scan-lc-mounted-component";
    const EMITTER = "scan-lc-root-emitter";
    const fromFold = vi.fn((acc: number) => acc + 1);
    const onFold = vi.fn((acc: number) => acc + 1);
    const authored: Record<string, unknown> = {
      $eventTokens: ["received"],
      $scan: {
        total: { from: "user.name", initial: 0, fold: fromFold },
        count: { on: "received", initial: 0, fold: onFold },
      },
    };
    if (!customElements.get(EMITTER)) {
      class Emitter extends HTMLElement {
        static wcBindable: IWcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "message", event: "scan-lc-message" }] };
      }
      customElements.define(EMITTER, Emitter);
    }
    if (!customElements.get(COMPONENT)) {
      class MountedComponent extends HTMLElement {
        state: Record<string, unknown> = authored;
        constructor() {
          super();
          this.attachShadow({ mode: "open" });
          this.shadowRoot!.innerHTML = `<wcs-state bind-component="state"></wcs-state><span data-wcs="textContent: user.name"></span>`;
        }
      }
      customElements.define(COMPONENT, MountedComponent);
    }
    const rootOn = vi.fn();
    const host = document.createElement("scan-lc-mount-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state></wcs-state><${EMITTER} data-wcs="eventToken.message: received"></${EMITTER}>` +
      `<${COMPONENT} data-wcs="state.user: user"></${COMPONENT}>`;
    try {
      document.body.appendChild(host);
      const rootEl = shadowRoot.querySelector("wcs-state") as State;
      rootEl.setInitialState({ user: { name: "a" }, $eventTokens: ["received"], $on: { received: rootOn } } as unknown as IState);
      await rootEl.connectedCallbackPromise;
      const component = shadowRoot.querySelector(COMPONENT) as HTMLElement;
      const childEl = component.shadowRoot!.querySelector("wcs-state") as State;
      await childEl.connectedCallbackPromise;
      await flushTimes(3);
      expect(component.shadowRoot!.querySelector("span")!.textContent, "マッピングは生きている").toBe("a");

      writeState(rootEl, (s) => { s["user.name"] = "b"; });
      await flushTimes(3);
      shadowRoot.querySelector(EMITTER)!.dispatchEvent(new CustomEvent("scan-lc-message", { detail: "x" }));
      await flushTimes(3);

      expect(component.shadowRoot!.querySelector("span")!.textContent).toBe("b");
      expect(rootOn, "同名トークンのルートの $on は届く").toHaveBeenCalledTimes(1);
      expect(fromFold).not.toHaveBeenCalled();
      expect(onFold).not.toHaveBeenCalled();
      expect("total" in authored || "count" in authored).toBe(false);
      expect(getScanRegistry(childEl)).toBeUndefined();
      expect(getScanRegistry(rootEl)).toBeUndefined();
      const warns = warn.mock.calls.map((call) => String(call[0])).filter((m) => m.includes("[wcs/mount-dollar-declaration]"));
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("$scan");
    } finally {
      host.remove();
      warn.mockRestore();
    }
  });

  it("マウントされたコンポーネントの $scan は誘導 warn の対象になること", async () => {
    const { clearMountDollarWarnsForTesting, buildMountRecord, warnMountedDollarDeclarations } =
      await import("../src/webComponent/mount");
    clearMountDollarWarnsForTesting();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const component = document.createElement("scan-mount-decl");
      const record = buildMountRecord(
        component,
        "state",
        [{
          propName: "state", propSegments: ["state"], propModifiers: [],
          statePathName: "user", statePathInfo: getPathInfo("user"),
          inFilters: [], outFilters: [], bindingType: "prop", uuid: null,
          node: component, replaceNode: component,
        } as any],
        { name: "default" } as any,
        { $scan: { count: { from: "n", initial: 0, fold: (acc: unknown) => acc } } },
      );
      warnMountedDollarDeclarations(record);
      const warns = warn.mock.calls.map((call) => String(call[0])).filter((m) => m.includes("[wcs/mount-dollar-declaration]"));
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("declares $scan");
    } finally {
      warn.mockRestore();
    }
  });
});
