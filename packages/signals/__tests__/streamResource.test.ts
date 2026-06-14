import { describe, it, expect } from "vitest";
import { signal, flushSync, createRoot } from "../src/reactive.js";
import { streamResource } from "../src/streamResource.js";

const flushAsync = () => new Promise((r) => setTimeout(r, 0));

/** A manually-driven async iterable: push chunks / end on demand. */
function manualStream<C>() {
  const chunks: C[] = [];
  let waiting: (() => void) | null = null;
  let ended = false;
  const wake = (): void => {
    const w = waiting;
    waiting = null;
    w?.();
  };
  const iterable: AsyncIterable<C> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (chunks.length) {
          yield chunks.shift() as C;
          continue;
        }
        if (ended) {
          return;
        }
        await new Promise<void>((r) => (waiting = r));
      }
    },
  };
  return {
    iterable,
    push: (c: C): void => {
      chunks.push(c);
      wake();
    },
    end: (): void => {
      ended = true;
      wake();
    },
  };
}

describe("streamResource", () => {
  it("latest（既定 fold）: 最後のチャンクに置換、終了で done", async () => {
    const r = streamResource<string>(async function* () {
      yield "a";
      yield "b";
      yield "c";
    });
    expect(r.status.peek()).toBe("active"); // 生成時に同期で active
    await flushAsync();
    expect(r.value.peek()).toBe("c");
    expect(r.status.peek()).toBe("done");
    expect(r.error.peek()).toBeNull();
  });

  it("reduce fold: チャンクを累積する", async () => {
    const r = streamResource<string, string>(
      async function* () {
        yield "a";
        yield "b";
        yield "c";
      },
      { fold: (acc, chunk) => (acc ?? "") + chunk, initial: "" },
    );
    await flushAsync();
    expect(r.value.peek()).toBe("abc");
    expect(r.status.peek()).toBe("done");
  });

  it("initial で初期値を与えられる", () => {
    const r = streamResource(() => manualStream<string>().iterable, { initial: "seed" });
    expect(r.value.peek()).toBe("seed");
  });

  it("ReadableStream 風（getReader フォールバック）も消費できる", async () => {
    const fakeReadable = {
      getReader() {
        const data = ["p", "q"];
        let i = 0;
        return {
          read: async () =>
            i < data.length ? { done: false, value: data[i++] } : { done: true, value: undefined },
          releaseLock: () => {},
        };
      },
    } as unknown as ReadableStream<string>;

    const r = streamResource<string>(() => fakeReadable);
    await flushAsync();
    expect(r.value.peek()).toBe("q");
    expect(r.status.peek()).toBe("done");
  });

  it("args 変化で stream を abort し、value を initial にリセットして張り直す", async () => {
    const id = signal(1);
    const s1 = manualStream<string>();
    const s2 = manualStream<string>();
    const map: Record<number, typeof s1> = { 1: s1, 2: s2 };

    const r = streamResource<string>(() => map[id.peek()].iterable, { args: () => id.get() });

    s1.push("a");
    await flushAsync();
    expect(r.value.peek()).toBe("a");

    id.set(2); // restart
    flushSync();
    expect(r.value.peek()).toBeUndefined(); // initial にリセット

    // 旧 stream に遅れて届いたチャンクは drop される（stale-drop）
    s1.push("late");
    await flushAsync();
    expect(r.value.peek()).toBeUndefined();

    // 新 stream は反映される
    s2.push("b");
    await flushAsync();
    expect(r.value.peek()).toBe("b");
  });

  it("実エラーは error/status に出る（直前 value は保持）", async () => {
    const r = streamResource<string>(async function* () {
      yield "ok";
      throw new Error("boom");
    });
    await flushAsync();
    expect(r.value.peek()).toBe("ok"); // 保持
    expect(r.status.peek()).toBe("error");
    expect(r.error.peek()).toMatchObject({ message: "boom" });
  });

  it("abort が throw として現れても error にしない", async () => {
    const id = signal(1);
    const r = streamResource<string>(
      async function* (_a: number, sig: AbortSignal) {
        yield "a";
        await new Promise<void>((_resolve, reject) => {
          sig.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      },
      { args: () => id.get() },
    );
    await flushAsync();
    id.set(2); // 旧 stream を abort → reject するが error にしない
    flushSync();
    await flushAsync();
    expect(r.error.peek()).toBeNull();
  });

  it("source が空のまま abort された run は done にならない", async () => {
    const id = signal(1);
    const empty: AsyncIterable<string> = {
      // eslint-disable-next-line require-yield
      async *[Symbol.asyncIterator]() {
        return;
      },
    };
    const r = streamResource<string>(
      (a: number) => (a === 1 ? Promise.resolve(empty) : manualStream<string>().iterable),
      { args: () => id.get() },
    );
    // run1 の source は Promise。解決前に restart して abort する
    id.set(2);
    flushSync();
    await flushAsync();
    // run1 は空ループ→aborted で return（done にしない）。run2 が active
    expect(r.status.peek()).toBe("active");
  });

  it("dispose で in-flight stream を止める（owner 連動）", async () => {
    const s = manualStream<string>();
    const r = createRoot((dispose) => {
      const res = streamResource(() => s.iterable);
      return { res, dispose };
    });
    s.push("x");
    await flushAsync();
    expect(r.res.value.peek()).toBe("x");

    r.dispose(); // owner 破棄 → abort
    s.push("y");
    await flushAsync();
    expect(r.res.value.peek()).toBe("x"); // 以降は drop
  });
});
