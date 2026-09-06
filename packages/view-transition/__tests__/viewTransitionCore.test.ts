import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewTransitionCore } from "../src/core/ViewTransitionCore";
import { TRANSITION_RUNNER_KEY, getTransitionRunner, runTransition } from "../src/protocol/transitionRunner";
import {
  flushMicrotasks,
  installMatchMedia,
  installTypesSupport,
  installViewTransitionMock,
  removeMatchMedia,
  setDocumentHidden,
  ViewTransitionMock,
} from "./mocks";

function clearRunnerSlot(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY];
}

describe("ViewTransitionCore", () => {
  let mock: ViewTransitionMock;
  const restores: Array<() => void> = [];

  beforeEach(() => {
    mock = installViewTransitionMock();
    clearRunnerSlot();
  });

  afterEach(() => {
    mock.uninstall();
    while (restores.length > 0) {
      restores.pop()!();
    }
    clearRunnerSlot();
    vi.restoreAllMocks();
  });

  describe("遷移を開始できない場合", () => {
    it("startViewTransition が無い環境では mutate を同期実行する", async () => {
      mock.uninstall();
      const core = new ViewTransitionCore();
      let ran = false;
      const promise = core.run(() => { ran = true; });
      expect(ran).toBe(true);
      await expect(promise).resolves.toBeUndefined();
      expect(mock.transitions).toHaveLength(0);
    });

    it("disabled のときは mutate を同期実行する", async () => {
      const core = new ViewTransitionCore();
      core.disabled = true;
      let ran = false;
      await core.run(() => { ran = true; });
      expect(ran).toBe(true);
      expect(mock.transitions).toHaveLength(0);
    });

    it("document.hidden のときは同期実行する（更新コールバックが走らずDOMが凍るため）", async () => {
      restores.push(setDocumentHidden(true));
      const core = new ViewTransitionCore();
      let ran = false;
      await core.run(() => { ran = true; });
      expect(ran).toBe(true);
      expect(mock.transitions).toHaveLength(0);
    });

    it("SSR（data-wcs-server）中は遷移を開始しない（G5・参加者に依らずここで閉じる）", async () => {
      document.documentElement.setAttribute("data-wcs-server", "");
      restores.push(() => document.documentElement.removeAttribute("data-wcs-server"));
      const core = new ViewTransitionCore();
      let ran = false;
      await core.run(() => { ran = true; });
      expect(ran).toBe(true);
      expect(mock.transitions).toHaveLength(0);
    });

    it("prefers-reduced-motion: reduce は既定でスキップする", async () => {
      restores.push(installMatchMedia(true));
      const core = new ViewTransitionCore();
      let ran = false;
      await core.run(() => { ran = true; });
      expect(ran).toBe(true);
      expect(mock.transitions).toHaveLength(0);
    });

    it("reduced-motion=animate なら reduce でも遷移する", async () => {
      restores.push(installMatchMedia(true));
      const core = new ViewTransitionCore();
      core.reducedMotion = "animate";
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      expect(mock.transitions).toHaveLength(1);
    });

    it("matchMedia が無い / throw する環境では reduce ではないとみなす", async () => {
      restores.push(installMatchMedia("throw"));
      const core = new ViewTransitionCore();
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      expect(mock.transitions).toHaveLength(1);
    });

    it("matchMedia を持たない環境では reduce ではないとみなす", async () => {
      restores.push(removeMatchMedia());
      const core = new ViewTransitionCore();
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      expect(mock.transitions).toHaveLength(1);
    });

    it("同期パスでも mutate の throw は Promise の reject になる", async () => {
      mock.uninstall();
      const core = new ViewTransitionCore();
      const boom = new Error("boom");
      await expect(core.run(() => { throw boom; })).rejects.toBe(boom);
    });
  });

  describe("バッチと順序", () => {
    it("同一 microtask の run は 1 つの遷移に呼び出し順で合流する", async () => {
      const core = new ViewTransitionCore();
      const order: string[] = [];
      const p1 = core.run(() => order.push("a"));
      const p2 = core.run(() => order.push("b"));
      expect(order).toEqual([]);

      await flushMicrotasks();
      expect(mock.transitions).toHaveLength(1);
      expect(order).toEqual([]);

      mock.transitions[0].runUpdate();
      expect(order).toEqual(["a", "b"]);
      await expect(p1).resolves.toBeUndefined();
      await expect(p2).resolves.toBeUndefined();
    });

    it("キャプチャ中（更新コールバック未実行）の run は同じバッチに合流する", async () => {
      const core = new ViewTransitionCore();
      const order: string[] = [];
      core.run(() => order.push("a"));
      await flushMicrotasks();
      expect(mock.transitions).toHaveLength(1);

      core.run(() => order.push("late"));
      await flushMicrotasks();
      expect(mock.transitions).toHaveLength(1);

      mock.transitions[0].runUpdate();
      expect(order).toEqual(["a", "late"]);
    });

    it("mutate が throw しても同じバッチの他は適用される", async () => {
      const core = new ViewTransitionCore();
      const boom = new Error("boom");
      const order: string[] = [];
      const p1 = core.run(() => { throw boom; });
      const p2 = core.run(() => order.push("b"));
      await flushMicrotasks();
      mock.transitions[0].runUpdate();

      await expect(p1).rejects.toBe(boom);
      await expect(p2).resolves.toBeUndefined();
      expect(order).toEqual(["b"]);
    });

    it("更新コールバックが二度呼ばれても mutate は 1 回だけ", async () => {
      const core = new ViewTransitionCore();
      const mutate = vi.fn();
      core.run(mutate);
      await flushMicrotasks();
      mock.transitions[0].runUpdate();
      mock.transitions[0].finish();
      // 実装側のガード（バッチを消費済み）も直接叩いて確かめる
      mock.transitions[0].callUpdateAgain();
      expect(mutate).toHaveBeenCalledTimes(1);
    });
  });

  describe("排他モード", () => {
    it("latest: アニメーション中の run は新しい遷移を開始する", async () => {
      const core = new ViewTransitionCore();
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      mock.transitions[0].runUpdate();

      const order: string[] = [];
      core.run(() => order.push("second"));
      await flushMicrotasks();
      expect(mock.transitions).toHaveLength(2);
      mock.transitions[1].runUpdate();
      expect(order).toEqual(["second"]);
    });

    it("queue: 実行中の遷移が終わるまで次のバッチは開始しない", async () => {
      const core = new ViewTransitionCore();
      core.mode = "queue";
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      mock.transitions[0].runUpdate();

      const order: string[] = [];
      core.run(() => order.push("second"));
      await flushMicrotasks();
      expect(mock.transitions).toHaveLength(1);
      expect(order).toEqual([]);

      mock.transitions[0].finish();
      await flushMicrotasks();
      expect(mock.transitions).toHaveLength(2);
      mock.transitions[1].runUpdate();
      expect(order).toEqual(["second"]);
    });

    it("exhaust: アニメーション中の run は即時適用しアニメーションしない", async () => {
      const core = new ViewTransitionCore();
      core.mode = "exhaust";
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      mock.transitions[0].runUpdate();

      let ran = false;
      await core.run(() => { ran = true; });
      expect(ran).toBe(true);
      expect(mock.transitions).toHaveLength(1);
    });

    it("exhaust: キャプチャ中の run は順序を守るため同じバッチへ合流する", async () => {
      const core = new ViewTransitionCore();
      core.mode = "exhaust";
      const order: string[] = [];
      core.run(() => order.push("first"));
      await flushMicrotasks();

      core.run(() => order.push("second"));
      expect(order).toEqual([]);
      mock.transitions[0].runUpdate();
      expect(order).toEqual(["first", "second"]);
    });

    it("exhaust: pending を積んだ後に mode が変わっても flush で即時適用に倒す", async () => {
      const core = new ViewTransitionCore();
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      mock.transitions[0].runUpdate();

      const order: string[] = [];
      core.run(() => order.push("queued")); // latest として pending へ
      core.mode = "exhaust";                 // flush 前に切り替え
      await flushMicrotasks();
      expect(mock.transitions).toHaveLength(1);
      expect(order).toEqual(["queued"]);
    });

    it("未知の mode は latest に丸める", () => {
      const core = new ViewTransitionCore();
      core.mode = "nonsense" as never;
      expect(core.mode).toBe("latest");
    });
  });

  describe("失敗と観測", () => {
    it("startViewTransition が throw しても mutate は適用され error に載る", async () => {
      const core = new ViewTransitionCore();
      const events: unknown[] = [];
      core.addEventListener("wcs-view-transition:error", (e) => events.push((e as CustomEvent).detail));
      const boom = new Error("no transition for you");
      mock.throwOnStart = boom;

      let ran = false;
      const promise = core.run(() => { ran = true; });
      await flushMicrotasks();
      expect(ran).toBe(true);
      await expect(promise).resolves.toBeUndefined();
      expect(core.error).toBe(boom);
      expect(events).toEqual([boom]);
    });

    it("throw された非 Error 値も Error に正規化される", async () => {
      const core = new ViewTransitionCore();
      mock.throwOnStart = "just a string" as unknown as Error;
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      expect(core.error).toBeInstanceOf(Error);
      expect(core.error?.message).toBe("just a string");
    });

    it("active は遷移の開始と終了で反転しイベントを出す", async () => {
      const core = new ViewTransitionCore();
      const seen: boolean[] = [];
      core.addEventListener("wcs-view-transition:active-changed", (e) => seen.push((e as CustomEvent).detail));
      expect(core.active).toBe(false);

      core.run(() => { /* noop */ });
      await flushMicrotasks();
      expect(core.active).toBe(true);

      mock.transitions[0].finish();
      await flushMicrotasks();
      expect(core.active).toBe(false);
      expect(seen).toEqual([true, false]);
    });

    it("latest で置き換えられた古い遷移の finished は active を落とさない", async () => {
      const core = new ViewTransitionCore();
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      const first = mock.transitions[0];
      first.runUpdate();
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      expect(mock.transitions).toHaveLength(2);

      first.finish();
      await flushMicrotasks();
      expect(core.active).toBe(true);
    });

    it("updateCallbackDone の reject を握って unhandled にしない", async () => {
      const core = new ViewTransitionCore();
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      mock.transitions[0].failUpdateCallback(new Error("update callback failed"));
      await flushMicrotasks();
      expect(core.active).toBe(true);
    });

    it("skip() は実行中の遷移だけをスキップし、idle では何もしない", async () => {
      const core = new ViewTransitionCore();
      expect(() => core.skip()).not.toThrow();

      core.run(() => { /* noop */ });
      await flushMicrotasks();
      core.skip();
      expect(mock.transitions[0].skipped).toBe(true);
      expect(mock.transitions[0].updateRan).toBe(true);
    });
  });

  describe("types", () => {
    it("types があり対応環境ならオプション形式で開始する", async () => {
      restores.push(installTypesSupport(true));
      const core = new ViewTransitionCore();
      core.types = ["forward", "slide"];
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      expect(mock.transitions[0].usedOptionsForm).toBe(true);
      expect(mock.transitions[0].types).toEqual(["forward", "slide"]);
    });

    it("未対応環境ではコールバック形式にフォールバックする", async () => {
      restores.push(installTypesSupport(false));
      const core = new ViewTransitionCore();
      core.types = ["forward"];
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      expect(mock.transitions[0].usedOptionsForm).toBe(false);
    });

    it("ViewTransition.prototype の参照が throw する環境ではコールバック形式へ倒す", async () => {
      restores.push(installTypesSupport("throw"));
      const core = new ViewTransitionCore();
      core.types = ["forward"];
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      expect(mock.transitions[0].usedOptionsForm).toBe(false);
    });

    it("types が空ならコールバック形式で開始する", async () => {
      restores.push(installTypesSupport(true));
      const core = new ViewTransitionCore();
      core.run(() => { /* noop */ });
      await flushMicrotasks();
      expect(mock.transitions[0].usedOptionsForm).toBe(false);
      expect(core.types).toEqual([]);
    });
  });

  describe("設定", () => {
    it("participants の既定は router / state、空配列は既定へ戻す", () => {
      const core = new ViewTransitionCore();
      expect(core.accepts("router")).toBe(true);
      expect(core.accepts("state")).toBe(true);
      expect(core.accepts("other")).toBe(false);

      core.participants = ["router"];
      expect(core.accepts("state")).toBe(false);
      expect(core.participants).toEqual(["router"]);

      core.participants = [];
      expect(core.accepts("state")).toBe(true);
    });

    it("participants / types は空白区切り文字列も受け付ける（文字単位に分解しない）", () => {
      const core = new ViewTransitionCore();
      core.participants = "router";
      expect(core.accepts("router")).toBe(true);
      expect(core.accepts("state")).toBe(false);
      expect(core.accepts("r")).toBe(false);

      core.participants = "  router   state ";
      expect(core.participants).toEqual(["router", "state"]);

      core.types = "fade slide";
      expect(core.types).toEqual(["fade", "slide"]);
      core.types = "";
      expect(core.types).toEqual([]);
    });

    it("naming / namingLimit は不正値を既定へ丸める", () => {
      const core = new ViewTransitionCore();
      expect(core.naming).toBe("manual");
      core.naming = "auto";
      expect(core.naming).toBe("auto");
      core.naming = "nonsense" as never;
      expect(core.naming).toBe("manual");

      expect(core.namingLimit).toBe(200);
      core.namingLimit = 12.7;
      expect(core.namingLimit).toBe(12);
      core.namingLimit = Number.NaN;
      expect(core.namingLimit).toBe(200);
      core.namingLimit = -1;
      expect(core.namingLimit).toBe(200);
    });

    it("reducedMotion は skip / animate のみ受け付ける", () => {
      const core = new ViewTransitionCore();
      expect(core.reducedMotion).toBe("skip");
      core.reducedMotion = "animate";
      expect(core.reducedMotion).toBe("animate");
      core.reducedMotion = "whatever" as never;
      expect(core.reducedMotion).toBe("skip");
    });

    it("protocol / version はプロトコル準拠の値を返す", () => {
      const core = new ViewTransitionCore();
      expect(core.protocol).toBe("wcs-transition-runner");
      expect(core.version).toBe(1);
      expect(core.disabled).toBe(false);
    });
  });

  describe("install / uninstall", () => {
    it("install でグローバルへ載り、getTransitionRunner から引ける", () => {
      const core = new ViewTransitionCore();
      expect(getTransitionRunner("state")).toBeNull();
      expect(core.install()).toBe(true);
      expect(getTransitionRunner("state")).toBe(core as never);
      core.uninstall();
      expect(getTransitionRunner("state")).toBeNull();
    });

    it("二重 install は警告して inert になる", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => { /* silence */ });
      const first = new ViewTransitionCore();
      const second = new ViewTransitionCore();
      expect(first.install()).toBe(true);
      expect(second.install()).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(getTransitionRunner("state")).toBe(first as never);

      // 自分が載っていない uninstall は他人のスロットを壊さない
      second.uninstall();
      expect(getTransitionRunner("state")).toBe(first as never);
    });

    it("同じ core の再 install は冪等", () => {
      const core = new ViewTransitionCore();
      expect(core.install()).toBe(true);
      expect(core.install()).toBe(true);
    });

    it("accepts が false の participant には runner を返さない", () => {
      const core = new ViewTransitionCore();
      core.participants = ["router"];
      core.install();
      expect(getTransitionRunner("router")).toBe(core as never);
      expect(getTransitionRunner("state")).toBeNull();
    });

    it("runTransition は runner が無ければ mutate を同期実行して undefined を返す", () => {
      let ran = false;
      const result = runTransition("state", () => { ran = true; });
      expect(ran).toBe(true);
      expect(result).toBeUndefined();
    });

    it("runTransition は runner があれば run() へ委譲する", async () => {
      const core = new ViewTransitionCore();
      core.install();
      const order: string[] = [];
      const result = runTransition("state", () => order.push("a"), ["slide"]);
      expect(result).toBeInstanceOf(Promise);
      await flushMicrotasks();
      mock.transitions[0].runUpdate();
      expect(order).toEqual(["a"]);
    });
  });

  describe("dispose", () => {
    it("未適用の pending / queue を適用してからスロットを解放する", async () => {
      const core = new ViewTransitionCore();
      core.mode = "queue";
      core.install();
      core.run(() => { /* first */ });
      await flushMicrotasks();
      mock.transitions[0].runUpdate();

      const order: string[] = [];
      core.run(() => order.push("queued"));
      await flushMicrotasks();
      core.run(() => order.push("pending"));

      core.dispose();
      expect(order).toEqual(["pending", "queued"]);
      expect(getTransitionRunner("state")).toBeNull();
    });

    it("キャプチャ中のバッチを queue より先に適用する（要求順を保つ）", async () => {
      const core = new ViewTransitionCore();
      core.mode = "queue";
      core.install();
      const order: string[] = [];

      core.run(() => order.push("first"));
      await flushMicrotasks();
      const first = mock.transitions[0];
      first.runUpdate();
      expect(order).toEqual(["first"]);

      // second は queue へ、third は pending へ積まれる
      core.run(() => order.push("second"));
      await flushMicrotasks();
      core.run(() => order.push("third"));

      // first の完了で second がキャプチャ中になり、third は queue へ回る
      first.finish();
      await flushMicrotasks();

      core.dispose();
      // 要求順どおり。キャプチャ中のバッチを飛ばすと third が second を追い越す
      expect(order).toEqual(["first", "second", "third"]);

      // 走行中の更新コールバックが後から走っても二度は適用しない
      mock.transitions[1].runUpdate();
      expect(order).toEqual(["first", "second", "third"]);
    });

    it("idle での dispose は何も適用しない", () => {
      const core = new ViewTransitionCore();
      core.install();
      expect(() => core.dispose()).not.toThrow();
      expect(getTransitionRunner("state")).toBeNull();
    });
  });
});

describe("getTransitionRunner の妥当性検査", () => {
  afterEach(() => {
    clearRunnerSlot();
  });

  function install(value: unknown): void {
    (globalThis as unknown as Record<symbol, unknown>)[TRANSITION_RUNNER_KEY] = value;
  }

  it("null / undefined は null", () => {
    install(null);
    expect(getTransitionRunner("state")).toBeNull();
  });

  it("protocol 名が違えば null", () => {
    install({ protocol: "something-else", version: 1, run() { /* */ }, accepts: () => true });
    expect(getTransitionRunner("state")).toBeNull();
  });

  it("version が数値でない / 1 未満なら null", () => {
    install({ protocol: "wcs-transition-runner", version: "1", run() { /* */ }, accepts: () => true });
    expect(getTransitionRunner("state")).toBeNull();
    install({ protocol: "wcs-transition-runner", version: 0, run() { /* */ }, accepts: () => true });
    expect(getTransitionRunner("state")).toBeNull();
  });

  it("run / accepts が関数でなければ null", () => {
    install({ protocol: "wcs-transition-runner", version: 1, accepts: () => true });
    expect(getTransitionRunner("state")).toBeNull();
    install({ protocol: "wcs-transition-runner", version: 1, run() { /* */ } });
    expect(getTransitionRunner("state")).toBeNull();
  });
});
