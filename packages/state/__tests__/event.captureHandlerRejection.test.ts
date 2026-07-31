import { describe, it, expect, vi, afterEach } from "vitest";
import { captureHandlerRejection } from "../src/event/captureHandlerRejection";

/**
 * state 側ハンドラの戻り値に混ざった Promise の reject を捕捉して報告するユニット。
 * 発火経路はハンドラの完了を待たないため、ここで掴まないと unhandled rejection になる。
 */

function withConsoleError(): { calls: unknown[][]; restore: () => void } {
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { calls.push(args); };
  return { calls, restore: () => { console.error = original; } };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("event/captureHandlerRejection", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("非 Promise の戻り値では何も報告しないこと", async () => {
    const spy = withConsoleError();
    try {
      captureHandlerRejection(undefined, "d");
      captureHandlerRejection(42, "d");
      captureHandlerRejection("text", "d");
      captureHandlerRejection(null, "d");
      captureHandlerRejection({ then: "not a function" }, "d");
      await flush();
      expect(spy.calls).toEqual([]);
    } finally {
      spy.restore();
    }
  });

  it("emit の戻り値配列に混ざった reject を describe 付きで報告すること", async () => {
    const spy = withConsoleError();
    try {
      const error = new Error("boom");
      captureHandlerRejection([undefined, Promise.reject(error)], '$on."x" of state "s"');
      await flush();
      expect(spy.calls).toHaveLength(1);
      expect(String(spy.calls[0][0])).toContain('$on."x" of state "s"');
      expect(spy.calls[0][1]).toBe(error);
    } finally {
      spy.restore();
    }
  });

  it("配列でない単一の Promise でも報告すること", async () => {
    const spy = withConsoleError();
    try {
      captureHandlerRejection(Promise.reject(new Error("single")), "d");
      await flush();
      expect(spy.calls).toHaveLength(1);
      expect((spy.calls[0][1] as Error).message).toBe("single");
    } finally {
      spy.restore();
    }
  });

  it("resolve する Promise では報告しないこと", async () => {
    const spy = withConsoleError();
    try {
      captureHandlerRejection([Promise.resolve("ok")], "d");
      await flush();
      expect(spy.calls).toEqual([]);
    } finally {
      spy.restore();
    }
  });

  it("複数の reject をそれぞれ報告すること", async () => {
    const spy = withConsoleError();
    try {
      captureHandlerRejection([Promise.reject(new Error("a")), Promise.reject(new Error("b"))], "d");
      await flush();
      expect(spy.calls).toHaveLength(2);
      expect(spy.calls.map((c) => (c[1] as Error).message).sort()).toEqual(["a", "b"]);
    } finally {
      spy.restore();
    }
  });

  it("native Promise でない thenable でも捕捉すること", async () => {
    const spy = withConsoleError();
    try {
      const thenable = {
        then(_onFulfilled: (v: unknown) => void, onRejected: (e: unknown) => void) {
          onRejected(new Error("thenable"));
        },
      };
      captureHandlerRejection([thenable], "d");
      await flush();
      expect(spy.calls).toHaveLength(1);
      expect((spy.calls[0][1] as Error).message).toBe("thenable");
    } finally {
      spy.restore();
    }
  });

  it("関数形の thenable も捕捉すること（typeof value === 'function' 分岐）", async () => {
    const spy = withConsoleError();
    try {
      const fnThenable = Object.assign(
        () => {},
        {
          then(_onFulfilled: (v: unknown) => void, onRejected: (e: unknown) => void) {
            onRejected(new Error("fn-thenable"));
          },
        },
      );
      captureHandlerRejection(fnThenable, "d");
      await flush();
      expect(spy.calls).toHaveLength(1);
      expect((spy.calls[0][1] as Error).message).toBe("fn-thenable");
    } finally {
      spy.restore();
    }
  });
});
