/**
 * stream.streamRuntime.test.ts
 *
 * streamRuntime（起動・チャンク反映・status 遷移）のテスト。
 * 受け入れ ID: P1, P2, P3, P6, P7, S14 ＋ restart 基礎 ＋ args 評価
 * （docs/state-streams-design.md §2-2 / §3-3 / §4-3 / §10）。
 *
 * stateElement は本物の reactive proxy（createStateProxy）を createState で
 * 生成するテストダブルを使う（proxy.Proxy.test.ts の createMockStateElement を
 * 実 proxy 化した形）。rootNode は Document でない detached 要素にして
 * buildBindings のスケジューリングとテスト間干渉を避ける。
 */
import { describe, it, expect, vi } from "vitest";
import { startStream, startStreams, updateStreamStatus } from "../src/stream/streamRuntime";
import { processStreamsDeclaration } from "../src/stream/processStreamsDeclaration";
import { abortAllStreams, getStreamEntries } from "../src/stream/streamRegistry";
import { createStateProxy } from "../src/proxy/StateHandler";
import { setStateElementByName } from "../src/stateElementByName";
import { getUpdater } from "../src/updater/updater";
import type { IStateElement } from "../src/components/types";
import type { IStateProxy, Mutability } from "../src/proxy/types";
import type { IState } from "../src/types";
import type { IAbsoluteStateAddress } from "../src/address/types";
import { makeManualAsyncGenerator, makeParkedAsyncIterable } from "./helpers/fakeStreamSources";

const flushAsync = () => new Promise<void>((r) => setTimeout(r, 0));

let seq = 0;

/**
 * 本物の proxy で createState を実装したテスト用 stateElement を作る。
 * rootNode / name をテストごとに一意にして registry・キャッシュの干渉を避ける。
 */
function createTestStateElement(state: IState): IStateElement {
  const rootNode = document.createElement("div");
  const name = `stream-runtime-${++seq}`;
  const stateElement = {
    name,
    listPaths: new Set<string>(),
    elementPaths: new Set<string>(),
    getterPaths: new Set<string>(),
    setterPaths: new Set<string>(),
    staticDependency: new Map<string, string[]>(),
    dynamicDependency: new Map<string, string[]>(),
    bindableEventMap: {},
    setPathInfo() {},
    addStaticDependency() {
      return false;
    },
    addDynamicDependency() {
      return false;
    },
    createState(mutability: Mutability, callback: (s: IStateProxy) => void) {
      const proxy = createStateProxy(rootNode, state, name, mutability);
      return callback(proxy);
    },
  } as unknown as IStateElement;
  setStateElementByName(rootNode, name, stateElement);
  return stateElement;
}

/** $streams 宣言をパースして stateElement と entry 群を返す。 */
function declareStreams(state: IState) {
  const stateElement = createTestStateElement(state);
  processStreamsDeclaration(stateElement, state);
  return { stateElement, entries: getStreamEntries(stateElement) };
}

describe("streamRuntime", () => {
  describe("startStream", () => {
    it("P1: fold 省略（latest）はチャンクごとに値を置換し、正常終端で status が done になること", async () => {
      const m = makeManualAsyncGenerator<string>();
      const state: IState = { $streams: { ticker: { source: () => m.iterable } } };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("ticker")!;

      startStream(stateElement, entry);
      expect(entry.status).toBe("active");

      m.push("10");
      m.push("20");
      await flushAsync();
      expect(state.ticker).toBe("20"); // latest = 最後のチャンクで置換
      expect(entry.status).toBe("active");

      m.end();
      await flushAsync();
      expect(entry.status).toBe("done");
      expect(entry.error).toBeNull();
      expect(state.ticker).toBe("20"); // 終端後も値は保持
    });

    it("P2: fold 指定は initial からチャンクを累積すること", async () => {
      const m = makeManualAsyncGenerator<string>();
      const state: IState = {
        $streams: {
          tokens: {
            source: () => m.iterable,
            fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
            initial: "A",
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      startStream(stateElement, entry);
      m.push("b");
      m.push("c");
      await flushAsync();
      expect(state.tokens).toBe("Abc"); // initial "A" から累積

      m.end();
      await flushAsync();
      expect(entry.status).toBe("done");
    });

    it("P3: 起動直後に値が initial にリセットされること（ユーザーの事前値も上書き）", () => {
      const m = makeManualAsyncGenerator<string>();
      const state: IState = {
        tokens: "stale-user-value",
        $streams: {
          tokens: {
            source: () => m.iterable,
            fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
            initial: "seed",
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      // パース時点では事前値は上書きされない（§1-3）
      expect(state.tokens).toBe("stale-user-value");

      startStream(stateElement, entries.get("tokens")!);
      // 起動 = restart と同一セマンティクスで initial にリセット
      expect(state.tokens).toBe("seed");
    });

    it("P6: source の実エラーは status=error・entry.error 格納・値は直前の fold 結果を保持すること", async () => {
      const err = new Error("boom");
      const state: IState = {
        $streams: {
          tokens: {
            source: async function* () {
              yield "a";
              yield "b";
              throw err;
            },
            fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
            initial: "",
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      startStream(stateElement, entry);
      await flushAsync();
      expect(entry.status).toBe("error");
      expect(entry.error).toBe(err);
      expect(state.tokens).toBe("ab"); // 直前の fold 結果を保持（リセットしない）
    });

    it("P7: source の同期 throw も error に正規化されること（値は initial のまま）", async () => {
      const err = new Error("sync-boom");
      const state: IState = {
        $streams: {
          tokens: {
            source: () => {
              throw err;
            },
            fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
            initial: "seed",
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      startStream(stateElement, entry);
      await flushAsync();
      expect(entry.status).toBe("error");
      expect(entry.error).toBe(err);
      expect(state.tokens).toBe("seed"); // fold は一度も走っていない
    });

    it("S14: fold が throw したら status=error になり producer 側の signal が abort されること（掃除の確認）", async () => {
      const foldErr = new Error("fold-boom");
      const parked = makeParkedAsyncIterable(["x"]);
      let sourceSignal: AbortSignal | null = null;
      const state: IState = {
        $streams: {
          tokens: {
            source: (_args: unknown, signal: AbortSignal) => {
              sourceSignal = signal;
              return parked.iterable;
            },
            fold: () => {
              throw foldErr;
            },
            initial: "",
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      startStream(stateElement, entry);
      await flushAsync();
      expect(entry.status).toBe("error");
      expect(entry.error).toBe(foldErr);
      // fail 経路で controller.abort() が呼ばれ producer が掃除される
      expect(sourceSignal!.aborted).toBe(true);
      expect(entry.controller!.signal.aborted).toBe(true);
      expect(parked.returned).toBe(1); // iterator.return() で generator の cleanup が発火
      expect(state.tokens).toBe(""); // fold は throw したので値は initial のまま
    });

    it("restart 基礎: 再呼び出しで旧 controller が abort され、旧 run の遅延チャンクが値に混ざらないこと（stale-drop）", async () => {
      const run1 = makeManualAsyncGenerator<string>();
      const run2 = makeManualAsyncGenerator<string>();
      let callCount = 0;
      const state: IState = {
        $streams: {
          ticker: {
            source: () => (++callCount === 1 ? run1.iterable : run2.iterable),
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("ticker")!;

      startStream(stateElement, entry);
      run1.push("old-1");
      await flushAsync();
      expect(state.ticker).toBe("old-1");
      const controller1 = entry.controller!;

      // restart（start と同一手順）
      startStream(stateElement, entry);
      expect(controller1.signal.aborted).toBe(true); // 旧 run は abort 済み
      expect(entry.controller).not.toBe(controller1); // 新 controller に差し替え
      expect(state.ticker).toBeUndefined(); // initial（fold 無しは undefined）にリセット
      expect(entry.status).toBe("active");

      // 旧 run の遅延チャンクは stale-drop され値に混ざらない
      run1.push("old-late");
      await flushAsync();
      expect(state.ticker).toBeUndefined();

      // 新 run のチャンクは反映される
      run2.push("new-1");
      await flushAsync();
      expect(state.ticker).toBe("new-1");
      expect(callCount).toBe(2);
    });

    it("args: readonly proxy で評価され、評価値が source の第 1 引数・signal が第 2 引数に渡ること", () => {
      const m = makeManualAsyncGenerator<string>();
      let receivedArgs: unknown = null;
      let receivedSignal: AbortSignal | null = null;
      const state: IState = {
        prompt: "hello",
        $streams: {
          tokens: {
            args: (s: IState) => s.prompt,
            source: (args: unknown, signal: AbortSignal) => {
              receivedArgs = args;
              receivedSignal = signal;
              return m.iterable;
            },
            fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
            initial: "",
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      startStream(stateElement, entry);
      expect(receivedArgs).toBe("hello"); // args(state) の評価値が第 1 引数
      expect(receivedSignal).toBe(entry.controller!.signal); // 新 controller の signal が第 2 引数
    });

    it("args: 内部での書き込みは readonly proxy が防ぐこと", () => {
      const state: IState = {
        prompt: "hello",
        $streams: {
          tokens: {
            args: (s: IState) => {
              s.prompt = "mutated";
              return s.prompt;
            },
            source: () => makeManualAsyncGenerator<string>().iterable,
            fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
            initial: "",
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      expect(() => startStream(stateElement, entries.get("tokens")!)).toThrow(/readonly/);
      expect(state.prompt).toBe("hello");
    });

    it("args: Promise を返す args は raiseError になること（同期契約）", () => {
      const state: IState = {
        prompt: "hello",
        $streams: {
          tokens: {
            args: async (s: IState) => s.prompt,
            source: () => makeManualAsyncGenerator<string>().iterable,
            fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
            initial: "",
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      expect(() => startStream(stateElement, entries.get("tokens")!)).toThrow(
        /\$streams entry "tokens" args must be synchronous/,
      );
    });

    it("args 省略時（null）は評価せず source の第 1 引数は undefined になること", () => {
      let receivedArgs: unknown = "sentinel";
      const state: IState = {
        $streams: {
          ticker: {
            source: (args: unknown) => {
              receivedArgs = args;
              return makeManualAsyncGenerator<string>().iterable;
            },
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      startStream(stateElement, entries.get("ticker")!);
      expect(receivedArgs).toBeUndefined();
    });
  });

  describe("startStreams", () => {
    it("登録済みの全 entry を起動すること", () => {
      const sourceA = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
      const sourceB = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
      const state: IState = {
        $streams: {
          a: { source: sourceA },
          b: { source: sourceB },
        },
      };
      const { stateElement, entries } = declareStreams(state);

      startStreams(stateElement);
      try {
        expect(sourceA).toHaveBeenCalledTimes(1);
        expect(sourceB).toHaveBeenCalledTimes(1);
        expect(entries.get("a")!.status).toBe("active");
        expect(entries.get("b")!.status).toBe("active");
        expect(entries.get("a")!.controller).not.toBeNull();
        expect(entries.get("b")!.controller).not.toBeNull();
      } finally {
        // startStreams はモック stateElement を activeStateElements（モジュール
        // スコープの strong Set）に登録するため、後始末しないと同一ファイル内の
        // 後続テストの drain リスナーがこの残留要素を走査し続ける（衛生上の後始末）
        abortAllStreams(stateElement);
      }
    });

    it("entry が無い（未宣言）stateElement では何もしないこと", () => {
      const stateElement = createTestStateElement({});
      expect(() => startStreams(stateElement)).not.toThrow();
    });
  });

  describe("updateStreamStatus", () => {
    /**
     * enqueue された絶対アドレスのパス一覧（重複排除済み）を取り出す。
     * $postUpdate は本体 enqueue ＋ walkDependency コールバックで同一アドレスを
     * 二重 enqueue する（updater 側の Set 重複排除に委ねる既存挙動）ため、
     * ここではパスの集合として比較する。
     */
    const enqueuedPaths = (spy: { mock: { calls: unknown[][] } }) => [
      ...new Set(
        spy.mock.calls.map((call) => (call[0] as IAbsoluteStateAddress).absolutePathInfo.pathInfo.path),
      ),
    ];

    it("status / error のうち変化した項目だけ registry を書き換え $postUpdate を通知すること（両方不変なら何もしない）", () => {
      const state: IState = {
        $streams: {
          tokens: {
            source: () => makeManualAsyncGenerator<string>().iterable,
            fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
            initial: "",
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;
      const spy = vi.spyOn(getUpdater(), "enqueueAbsoluteAddress");
      try {
        // 両方不変（idle / null のまま）→ 何もしない
        updateStreamStatus(stateElement, entry, "idle", null);
        expect(spy).not.toHaveBeenCalled();
        expect(entry.status).toBe("idle");
        expect(entry.error).toBeNull();

        // status のみ変化 → $streamStatus.<name> だけ通知
        updateStreamStatus(stateElement, entry, "active", null);
        expect(entry.status).toBe("active");
        expect(enqueuedPaths(spy)).toEqual(["$streamStatus.tokens"]);
        spy.mockClear();

        // error のみ変化 → $streamError.<name> だけ通知
        const err = new Error("e");
        updateStreamStatus(stateElement, entry, "active", err);
        expect(entry.status).toBe("active");
        expect(entry.error).toBe(err);
        expect(enqueuedPaths(spy)).toEqual(["$streamError.tokens"]);
        spy.mockClear();

        // 両方変化 → 2 パスとも通知
        updateStreamStatus(stateElement, entry, "done", null);
        expect(entry.status).toBe("done");
        expect(entry.error).toBeNull();
        expect(enqueuedPaths(spy)).toEqual(["$streamStatus.tokens", "$streamError.tokens"]);
      } finally {
        spy.mockRestore();
      }
    });

    it("startStream 経由でも起動時に $streamStatus.<name> が通知されること（error は null のままなので通知されない）", () => {
      const state: IState = {
        // 事前値を持たせて initial リセットが実際の値変化になるようにする
        // （宣言時に initial で実体化されるため、事前値なしの初回リセットは
        //  sameValueGuard により enqueue されない — 設計どおりの挙動）
        ticker: "stale",
        $streams: { ticker: { source: () => makeManualAsyncGenerator<string>().iterable } },
      };
      const { stateElement, entries } = declareStreams(state);
      const spy = vi.spyOn(getUpdater(), "enqueueAbsoluteAddress");
      try {
        startStream(stateElement, entries.get("ticker")!);
        const paths = enqueuedPaths(spy);
        expect(paths).toContain("ticker"); // 値リセット（initial）の enqueue
        expect(paths).toContain("$streamStatus.ticker"); // idle → active の通知
        expect(paths).not.toContain("$streamError.ticker"); // null → null は通知しない
      } finally {
        spy.mockRestore();
      }
    });
  });
});
