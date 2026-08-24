/**
 * integration.viewTransition.test.ts — transition-runner プロトコル参加の
 * エンドツーエンド契約（docs/view-transition-design.md §7.2）。
 *
 * - arbiter が居ると drain の DOM 適用が「ひとまとまりの変更」として預けられる
 * - 初期レンダリングは包まれない（drain だけが参加点）
 * - state を受け付けない arbiter では従来どおり同期適用
 * - 適用すべき binding が 0 本のバッチは arbiter へ渡さない
 * - 機構間の順序（$updatedCallback と drain リスナー）が arbiter の有無で入れ替わる
 * - naming="auto" は行と if 分岐へ view-transition-name / class を割り当て、
 *   上限に達したら命名を止めて一度だけ警告する
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";
import { TRANSITION_RUNNER_KEY } from "../src/protocol/transitionRunner";
import { __test_resetTransitionNaming } from "../src/apply/viewTransitionNaming";
import { registerUpdateBatchListener, unregisterUpdateBatchListener } from "../src/updater/updater";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

interface FakeRunner {
  readonly deferred: Array<() => void>;
  readonly sources: string[];
}

function installRunner(options: {
  naming?: "manual" | "auto";
  namingLimit?: number;
  accepts?: (source: string) => boolean;
  immediate?: boolean;
} = {}): FakeRunner {
  const deferred: Array<() => void> = [];
  const sources: string[] = [];
  const runner = {
    protocol: "wcs-transition-runner",
    version: 1,
    naming: options.naming ?? "manual",
    namingLimit: options.namingLimit ?? 200,
    accepts: options.accepts ?? (() => true),
    run(mutate: () => void, runOptions?: { source?: string }) {
      sources.push(runOptions?.source ?? "");
      if (options.immediate === true) {
        mutate();
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        deferred.push(() => {
          try {
            mutate();
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    },
  };
  (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY] = runner;
  return { deferred, sources };
}

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`vt-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElementByName(shadowRoot, "default")!;
  return { host, shadowRoot, stateElement };
}

afterEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY];
  __test_resetTransitionNaming();
  vi.restoreAllMocks();
});

describe("state の transition-runner 参加（統合）", () => {
  it("arbiter が居ると drain の DOM 適用が遅延され、mutate 実行で反映される", async () => {
    const runner = installRunner();
    const { host, shadowRoot, stateElement } = await mount(
      { label: "before" },
      `<span class="l" data-wcs="textContent: label"></span>`,
    );
    const text = () => shadowRoot.querySelector("span.l")!.textContent;
    // 初期レンダリングは drain を通らないので arbiter には渡らない
    expect(text()).toBe("before");
    expect(runner.deferred).toHaveLength(0);

    stateElement.createState("writable", (s: any) => { s.label = "after"; });
    await flush();

    expect(runner.sources).toEqual(["state"]);
    expect(runner.deferred).toHaveLength(1);
    expect(text()).toBe("before");

    runner.deferred[0]();
    expect(text()).toBe("after");
    host.remove();
  });

  it("state を受け付けない arbiter では従来どおり同期適用する", async () => {
    const runner = installRunner({ accepts: (source) => source !== "state" });
    const { host, shadowRoot, stateElement } = await mount(
      { label: "before" },
      `<span class="l" data-wcs="textContent: label"></span>`,
    );

    stateElement.createState("writable", (s: any) => { s.label = "after"; });
    await flush();

    expect(runner.deferred).toHaveLength(0);
    expect(shadowRoot.querySelector("span.l")!.textContent).toBe("after");
    host.remove();
  });

  it("binding の無いパスへの書き込みは arbiter へ渡さない（空の遷移を起こさない）", async () => {
    const runner = installRunner();
    const { host, stateElement } = await mount(
      { label: "before", headless: 1 },
      `<span class="l" data-wcs="textContent: label"></span>`,
    );

    // headless は DOM のどこにも配線されていない。書き込みは enqueue されるが、
    // 適用すべき binding が無いので遷移は要求しない（mode="latest" なら実行中の
    // 遷移を巻き添えにスキップしてしまう）。
    stateElement.createState("writable", (s: any) => { s.headless = 2; });
    await flush();
    expect(runner.sources).toEqual([]);
    expect(runner.deferred).toHaveLength(0);

    // 配線のあるパスなら従来どおり渡る
    stateElement.createState("writable", (s: any) => { s.label = "after"; });
    await flush();
    expect(runner.sources).toEqual(["state"]);
    host.remove();
  });

  it('naming="auto" は行と if 分岐へ一意な名前とクラスを付ける', async () => {
    installRunner({ naming: "auto", immediate: true });
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ v: 1 }, { v: 2 }], visible: false },
      `<ul><template data-wcs="for: items"><li class="row">{{ .v }}</li></template></ul>` +
      `<template data-wcs="if: visible"><p class="branch">shown</p></template>`,
    );

    const rows = () => Array.from(shadowRoot.querySelectorAll("li.row")) as HTMLElement[];
    const names = rows().map((el) => el.style.getPropertyValue("view-transition-name"));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names.every((n) => n.startsWith("wcs-row-"))).toBe(true);
    expect(rows()[0].style.getPropertyValue("view-transition-class")).toBe("wcs-row");

    stateElement.createState("writable", (s: any) => { s.visible = true; });
    await flush();

    const branch = shadowRoot.querySelector("p.branch") as HTMLElement;
    expect(branch.style.getPropertyValue("view-transition-name")).toMatch(/^wcs-branch-\d+$/);
    expect(branch.style.getPropertyValue("view-transition-class")).toBe("wcs-branch");
    host.remove();
  });

  it("既定（manual）では名前を付けない", async () => {
    installRunner({ immediate: true });
    const { host, shadowRoot } = await mount(
      { items: [{ v: 1 }] },
      `<ul><template data-wcs="for: items"><li class="row">{{ .v }}</li></template></ul>`,
    );
    const row = shadowRoot.querySelector("li.row") as HTMLElement;
    expect(row.style.getPropertyValue("view-transition-name")).toBe("");
    host.remove();
  });

  it("arbiter が居なければ名前を付けない", async () => {
    const { host, shadowRoot } = await mount(
      { items: [{ v: 1 }] },
      `<ul><template data-wcs="for: items"><li class="row">{{ .v }}</li></template></ul>`,
    );
    const row = shadowRoot.querySelector("li.row") as HTMLElement;
    expect(row.style.getPropertyValue("view-transition-name")).toBe("");
    host.remove();
  });

  it("naming-limit を超えたら命名を止め、一度だけ警告する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => { /* silence */ });
    installRunner({ naming: "auto", namingLimit: 2, immediate: true });
    const { host, shadowRoot } = await mount(
      { items: [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }] },
      `<ul><template data-wcs="for: items"><li class="row">{{ .v }}</li></template></ul>`,
    );

    const named = (Array.from(shadowRoot.querySelectorAll("li.row")) as HTMLElement[])
      .map((el) => el.style.getPropertyValue("view-transition-name"))
      .filter((n) => n !== "");
    expect(named).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("naming-limit");
    host.remove();
  });

  it("既に名前のある要素は再命名しない（プール再利用でも同じ名前が続く）", async () => {
    installRunner({ naming: "auto", immediate: true });
    const { host, shadowRoot, stateElement } = await mount(
      { items: [{ v: 1 }] },
      `<ul><template data-wcs="for: items"><li class="row">{{ .v }}</li></template></ul>`,
    );
    const first = (shadowRoot.querySelector("li.row") as HTMLElement).style.getPropertyValue("view-transition-name");

    // 全削除 → 再追加。content はプールから戻るので同じ要素・同じ名前になる
    stateElement.createState("writable", (s: any) => { s.items = []; });
    await flush();
    stateElement.createState("writable", (s: any) => { s.items = [{ v: 9 }]; });
    await flush();

    const second = (shadowRoot.querySelector("li.row") as HTMLElement).style.getPropertyValue("view-transition-name");
    expect(second).toBe(first);
    host.remove();
  });
});

describe("drain の機構間順序（$updatedCallback と drain 終了リスナー）", () => {
  async function record(runner: FakeRunner | null) {
    const order: string[] = [];
    const listener = () => { order.push("batch-listener"); };
    registerUpdateBatchListener(listener);
    const { host, stateElement } = await mount(
      {
        label: "before",
        $updatedCallback() { order.push("updated"); },
      },
      `<span class="l" data-wcs="textContent: label"></span>`,
    );
    order.length = 0; // 初期レンダリング分を落とす
    stateElement.createState("writable", (s: any) => { s.label = "after"; });
    await flush();
    return {
      order,
      release() {
        runner?.deferred.forEach((apply) => apply());
      },
      cleanup() {
        unregisterUpdateBatchListener(listener);
        host.remove();
      },
    };
  }

  it("arbiter が居なければ $updatedCallback → drain リスナー（README の 3 層表どおり）", async () => {
    const probe = await record(null);
    try {
      expect(probe.order).toEqual(["updated", "batch-listener"]);
    } finally {
      probe.cleanup();
    }
  });

  it("arbiter が state を受け付けると drain リスナー → $updatedCallback へ反転する", async () => {
    // 意図的な反転（docs/view-transition-design.md §7.2）。$watch / $streams restart は
    // state アドレスを消費するので microtask に留まり、$updatedCallback だけが
    // バインディングと一緒にフレームへ乗る。
    const runner = installRunner();
    const probe = await record(runner);
    try {
      expect(probe.order).toEqual(["batch-listener"]);
      probe.release();
      expect(probe.order).toEqual(["batch-listener", "updated"]);
    } finally {
      probe.cleanup();
    }
  });
});

describe("遷移越しの適用失敗の報告", () => {
  it("失敗は microtask で再 throw される（握り潰さない）", async () => {
    const { __private__ } = await import("../src/updater/updater");
    const boom = new Error("apply exploded");
    const scheduled: Array<() => void> = [];
    const original = globalThis.queueMicrotask;
    globalThis.queueMicrotask = ((callback: () => void) => { scheduled.push(callback); }) as typeof queueMicrotask;
    try {
      __private__.reportDeferredApplyFailure(boom);
    } finally {
      globalThis.queueMicrotask = original;
    }
    expect(scheduled).toHaveLength(1);
    expect(() => scheduled[0]()).toThrow(boom);
  });
});
