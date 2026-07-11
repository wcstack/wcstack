/**
 * stream.argsTrace.test.ts
 *
 * argsTrace（args トレース = 依存捕捉）のテスト。
 * 受け入れ ID: S7 の単体側, S8（docs/state-streams-design.md §3-1 / §10-2）。
 *
 * - depAddresses の照合は AbsoluteStateAddress のインスタンス同一性
 *   （キャッシュにより同一 (stateElement, pathInfo, listIndex) が同一インスタンス、§2-1）
 *   で Set.has を使う。
 * - stateElement は stream.streamRuntime.test.ts と同じテストダブル流儀
 *   （本物の reactive proxy を createState で生成し、rootNode は detached 要素）。
 */
import { describe, it, expect } from "vitest";
import { collectStreamDependency, traceArgs } from "../src/stream/argsTrace";
import { startStream } from "../src/stream/streamRuntime";
import { processStreamsDeclaration } from "../src/stream/processStreamsDeclaration";
import { getStreamEntries } from "../src/stream/streamRegistry";
import { createStateProxy } from "../src/proxy/StateHandler";
import { setStateElementByName } from "../src/stateElementByName";
import { getResolvedAddress } from "../src/address/ResolvedAddress";
import { getAbsolutePathInfo } from "../src/address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { createStateAddress } from "../src/address/StateAddress";
import type { IAbsoluteStateAddress } from "../src/address/types";
import type { IStateElement } from "../src/components/types";
import type { IStateProxy, Mutability } from "../src/proxy/types";
import type { IState } from "../src/types";
import type { IStreamEntry } from "../src/stream/types";
import { makeManualAsyncGenerator } from "./helpers/fakeStreamSources";

let seq = 0;

/**
 * 本物の proxy で createState を実装したテスト用 stateElement を作る
 * （stream.streamRuntime.test.ts の createTestStateElement と同型。
 *  getter（computed）テスト用に getterPaths を注入できるようにしている）。
 */
function createTestStateElement(state: IState, getterPaths: string[] = []): IStateElement {
  const rootNode = document.createElement("div");
  const name = `stream-args-trace-${++seq}`;
  const stateElement = {
    name,
    listPaths: new Set<string>(),
    elementPaths: new Set<string>(),
    getterPaths: new Set<string>(getterPaths),
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
function declareStreams(state: IState, getterPaths: string[] = []) {
  const stateElement = createTestStateElement(state, getterPaths);
  processStreamsDeclaration(stateElement, state);
  return { stateElement, entries: getStreamEntries(stateElement) };
}

/** パス文字列（listIndex なし）の絶対アドレスをキャッシュ経由で解決する。 */
function absoluteAddressOf(stateElement: IStateElement, path: string): IAbsoluteStateAddress {
  const pathInfo = getResolvedAddress(path).pathInfo;
  return createAbsoluteStateAddress(getAbsolutePathInfo(stateElement, pathInfo), null);
}

/** depAddresses をパス文字列の配列（ソート済み）に落とす。 */
function depPaths(entry: IStreamEntry): string[] {
  return [...entry.depAddresses].map((dep) => dep.absolutePathInfo.pathInfo.path).sort();
}

describe("argsTrace", () => {
  describe("traceArgs: 依存捕捉", () => {
    it("直接パス読みが絶対アドレスとして捕捉され、同じパスの再解決と Set.has のインスタンス同一性が立つこと", () => {
      const state: IState = {
        prompt: "hello",
        $streams: {
          tokens: {
            args: (s: IState) => s.prompt,
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      const argsValue = traceArgs(stateElement, entry);
      expect(argsValue).toBe("hello"); // 評価値がそのまま返る（source の第 1 引数になる）
      expect(entry.depAddresses.size).toBe(1);
      // キャッシュにより同一 (stateElement, path) は同一インスタンス → Set.has で照合できる
      expect(entry.depAddresses.has(absoluteAddressOf(stateElement, "prompt"))).toBe(true);
    });

    it("複数パス読みは読んだ全パスが捕捉されること", () => {
      const state: IState = {
        prompt: "hello",
        model: "gpt",
        $streams: {
          tokens: {
            args: (s: IState) => ({ prompt: s.prompt, model: s.model }),
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      expect(traceArgs(stateElement, entry)).toEqual({ prompt: "hello", model: "gpt" });
      expect(depPaths(entry)).toEqual(["model", "prompt"]);
    });

    it("args なし（null）は depAddresses を clear して undefined を返すこと", () => {
      const state: IState = {
        $streams: { ticker: { source: () => makeManualAsyncGenerator<string>().iterable } },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("ticker")!;
      // 前 run の残骸を模したダミーを入れて clear されることを確認する
      entry.depAddresses.add(absoluteAddressOf(stateElement, "stale"));

      expect(traceArgs(stateElement, entry)).toBeUndefined();
      expect(entry.depAddresses.size).toBe(0);
    });

    it("他 stream の値・$streamStatus 読みは自己依存ではなく通常の依存として捕捉されること（stream 間連鎖の前提）", () => {
      const state: IState = {
        $streams: {
          a: { source: () => makeManualAsyncGenerator<string>().iterable },
          b: {
            args: (s: IState) => ({ value: s.a, status: s["$streamStatus.a"] }),
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("b")!;

      expect(() => traceArgs(stateElement, entry)).not.toThrow();
      expect(depPaths(entry)).toEqual(["$streamStatus.a", "a"]);
    });

    it("getter（computed）読み: キャッシュ miss 時は getter 自身と内側の読みが両方捕捉されること", () => {
      const state: IState = {
        count: 2,
        unit: 10,
        get total(): number {
          return (this as IState).count * (this as IState).unit;
        },
        $streams: {
          tokens: {
            args: (s: IState) => s.total,
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state, ["total"]);
      const entry = entries.get("tokens")!;

      // 初回トレース = キャッシュ miss: getter 本体が実行され内側の読みも collector を通る
      expect(traceArgs(stateElement, entry)).toBe(20);
      expect(depPaths(entry)).toEqual(["count", "total", "unit"]);
    });

    it("getter（computed）読み: キャッシュ命中時は getter 自身のアドレスのみ捕捉されること（依存変化時は walkDependency が getter をバッチに載せるため照合は成立する）", () => {
      const state: IState = {
        count: 2,
        unit: 10,
        get total(): number {
          return (this as IState).count * (this as IState).unit;
        },
        $streams: {
          tokens: {
            args: (s: IState) => s.total,
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state, ["total"]);
      const entry = entries.get("tokens")!;

      traceArgs(stateElement, entry); // 初回で total のキャッシュエントリが作られる
      // 再トレース = キャッシュ命中: getter 本体は実行されず内側の読みは捕捉されない
      expect(traceArgs(stateElement, entry)).toBe(20);
      expect(depPaths(entry)).toEqual(["total"]);
    });

    it("再トレースで depAddresses が丸ごと置換され、前 run の残骸が残らないこと（per-run 再捕捉）", () => {
      let which: "a" | "b" = "a";
      const state: IState = {
        a: "va",
        b: "vb",
        $streams: {
          tokens: {
            args: (s: IState) => (which === "a" ? s.a : s.b),
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      traceArgs(stateElement, entry);
      expect(depPaths(entry)).toEqual(["a"]);

      which = "b";
      traceArgs(stateElement, entry);
      expect(depPaths(entry)).toEqual(["b"]); // "a" は残らない
      expect(entry.depAddresses.has(absoluteAddressOf(stateElement, "a"))).toBe(false);
    });
  });

  describe("traceArgs: 検査（raiseError）", () => {
    it("S8: 自己依存（own name の読み）は raiseError になること", () => {
      const state: IState = {
        $streams: {
          tokens: {
            args: (s: IState) => s.tokens,
            source: () => makeManualAsyncGenerator<string>().iterable,
            fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
            initial: "",
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      expect(() => traceArgs(stateElement, entry)).toThrow(
        /\$streams entry "tokens" args must not read the stream itself \("tokens"\)/,
      );
      // 初回トレースの失敗: 保持すべき前回成功 run の捕捉が無いため空のまま
      expect(entry.depAddresses.size).toBe(0);
    });

    it("S8: 自己依存（$streamStatus.own の読み）は raiseError になること", () => {
      const state: IState = {
        $streams: {
          tokens: {
            args: (s: IState) => s["$streamStatus.tokens"],
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);

      expect(() => traceArgs(stateElement, entries.get("tokens")!)).toThrow(
        /\$streams entry "tokens" args must not read the stream itself \("\$streamStatus\.tokens"\)/,
      );
    });

    it("S8: 自己依存（$streamError.own の読み）は raiseError になること", () => {
      const state: IState = {
        $streams: {
          tokens: {
            args: (s: IState) => s["$streamError.tokens"],
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);

      expect(() => traceArgs(stateElement, entries.get("tokens")!)).toThrow(
        /\$streams entry "tokens" args must not read the stream itself \("\$streamError\.tokens"\)/,
      );
    });

    it("wildcard を含むパスの読み（$getAll 経由）は raiseError になること（第 1 段スコープ外）", () => {
      const state: IState = {
        items: [1, 2, 3],
        $streams: {
          tokens: {
            args: (s: IState) => s.$getAll("items.*"),
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      expect(() => traceArgs(stateElement, entry)).toThrow(
        /\$streams entry "tokens" args must not read wildcard paths \("items\.\*"\)/,
      );
      expect(entry.depAddresses.size).toBe(0);
    });

    it("Promise を返す args は raiseError になること（同期契約・既存文言の移設）", () => {
      const state: IState = {
        prompt: "hello",
        $streams: {
          tokens: {
            args: async (s: IState) => s.prompt,
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      expect(() => traceArgs(stateElement, entry)).toThrow(
        /\$streams entry "tokens" args must be synchronous \(it returned a Promise\)\./,
      );
      // 同期評価分（prompt）の今回捕捉は採用されない（初回失敗のため保持分も空）
      expect(entry.depAddresses.size).toBe(0);
    });
  });

  describe("traceArgs: 失敗時は前回成功 run の検証済み depAddresses を保持する（§2-2 error からの再試行の前提）", () => {
    it("args のユーザー例外: 成功トレース後の失敗で前回捕捉が保持されること", () => {
      let shouldThrow = false;
      const state: IState = {
        ready: true,
        query: "q0",
        $streams: {
          tokens: {
            args: (s: IState) => {
              const ready = s.ready;
              const query = s.query;
              if (shouldThrow) {
                throw new Error("not ready");
              }
              return { ready, query };
            },
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      traceArgs(stateElement, entry); // 成功 run（検証済み捕捉）
      expect(depPaths(entry)).toEqual(["query", "ready"]);

      shouldThrow = true;
      expect(() => traceArgs(stateElement, entry)).toThrow("not ready");
      // clear せず前回の検証済み捕捉を保持 → 依存書き込みで再試行できる
      expect(depPaths(entry)).toEqual(["query", "ready"]);
    });

    it("Promise 同期契約違反: 成功トレース後の失敗で前回捕捉が保持されること（今回の未検査捕捉は採用しない）", () => {
      let mode: "sync" | "async" = "sync";
      const state: IState = {
        prompt: "hello",
        other: "x",
        $streams: {
          tokens: {
            args: (s: IState) => (mode === "sync" ? s.prompt : Promise.resolve(s.other)),
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      traceArgs(stateElement, entry);
      expect(depPaths(entry)).toEqual(["prompt"]);

      mode = "async";
      expect(() => traceArgs(stateElement, entry)).toThrow(/args must be synchronous/);
      // 失敗 run の捕捉（other）は採用されず、前回の prompt が保持される
      expect(depPaths(entry)).toEqual(["prompt"]);
    });

    it("自己依存違反: 成功トレース後の失敗で前回捕捉が保持されること", () => {
      let mode: "ok" | "self" = "ok";
      const state: IState = {
        prompt: "hello",
        $streams: {
          tokens: {
            args: (s: IState) => (mode === "ok" ? s.prompt : s.tokens),
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      traceArgs(stateElement, entry);
      expect(depPaths(entry)).toEqual(["prompt"]);

      mode = "self";
      expect(() => traceArgs(stateElement, entry)).toThrow(/must not read the stream itself/);
      // 保持されるのは検証済みの前回捕捉のみ（自己依存を含む今回捕捉は捨てる）
      expect(depPaths(entry)).toEqual(["prompt"]);
    });

    it("wildcard 読み違反: 成功トレース後の失敗で前回捕捉が保持されること", () => {
      let mode: "ok" | "wild" = "ok";
      const state: IState = {
        prompt: "hello",
        items: [1, 2, 3],
        $streams: {
          tokens: {
            args: (s: IState) => (mode === "ok" ? s.prompt : s.$getAll("items.*")),
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      traceArgs(stateElement, entry);
      expect(depPaths(entry)).toEqual(["prompt"]);

      mode = "wild";
      expect(() => traceArgs(stateElement, entry)).toThrow(/must not read wildcard paths/);
      // 保持されるのは検証済みの前回捕捉のみ（wildcard を含む今回捕捉は捨てる）
      expect(depPaths(entry)).toEqual(["prompt"]);
    });
  });

  describe("collector のライフサイクル", () => {
    it("トレース終了後は collector が閉じられ、トレース外の読みは記録されないこと", () => {
      const state: IState = {
        prompt: "hello",
        other: "x",
        $streams: {
          tokens: {
            args: (s: IState) => s.prompt,
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      traceArgs(stateElement, entry);
      expect(depPaths(entry)).toEqual(["prompt"]);

      // トレース外の読み: collector は null なので捕捉されない
      stateElement.createState("readonly", (s) => {
        void s.other;
      });
      expect(depPaths(entry)).toEqual(["prompt"]); // 増えていない
    });

    it("collectStreamDependency はトレース外（collector === null）では何もしないこと", () => {
      const state: IState = { prompt: "hello" };
      const stateElement = createTestStateElement(state);
      const address = createStateAddress(getResolvedAddress("prompt").pathInfo, null);

      // トレース外の直接呼び出し: 例外も副作用もない（ホットパスの即 return）
      expect(() => collectStreamDependency(stateElement, address)).not.toThrow();
    });

    it("args が throw しても collector が復元され、以後の読みが記録されず再トレースも正常に動くこと", () => {
      const userError = new Error("args-boom");
      let shouldThrow = true;
      const state: IState = {
        prompt: "hello",
        other: "x",
        $streams: {
          tokens: {
            args: (s: IState) => {
              const value = s.prompt;
              if (shouldThrow) {
                throw userError;
              }
              return value;
            },
            source: () => makeManualAsyncGenerator<string>().iterable,
          },
        },
      };
      const { stateElement, entries } = declareStreams(state);
      const entry = entries.get("tokens")!;

      expect(() => traceArgs(stateElement, entry)).toThrow(userError);
      // 不完全な捕捉（prompt）は採用されない（初回失敗のため保持分も空）
      expect(entry.depAddresses.size).toBe(0);

      // collector は復元済み: トレース外の読みは捕捉されない
      stateElement.createState("readonly", (s) => {
        void s.other;
      });
      expect(entry.depAddresses.size).toBe(0);

      // 再トレースは正常に動く（throw で機構が壊れていない）
      shouldThrow = false;
      expect(traceArgs(stateElement, entry)).toBe("hello");
      expect(depPaths(entry)).toEqual(["prompt"]);
    });
  });

  describe("startStream との配線", () => {
    it("startStream 経由で args 評価と依存捕捉が同時に行われ、評価値が source の第 1 引数に渡ること", () => {
      const m = makeManualAsyncGenerator<string>();
      let receivedArgs: unknown = null;
      const state: IState = {
        prompt: "hello",
        $streams: {
          tokens: {
            args: (s: IState) => s.prompt,
            source: (args: unknown) => {
              receivedArgs = args;
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
      expect(receivedArgs).toBe("hello");
      expect(entry.depAddresses.has(absoluteAddressOf(stateElement, "prompt"))).toBe(true);
      // 起動手順内の initial リセット・status 反映（writable proxy 経由の書き込み）は
      // トレース外なので依存に混ざらない
      expect(depPaths(entry)).toEqual(["prompt"]);
    });
  });
});
