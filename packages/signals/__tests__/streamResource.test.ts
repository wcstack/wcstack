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

  it("source が同期 throw しても error/status に正規化される", async () => {
    const r = streamResource<string>(() => {
      throw new Error("sync-boom");
    });
    await flushAsync();
    expect(r.status.peek()).toBe("error");
    expect((r.error.peek() as Error).message).toBe("sync-boom");
  });

  it("source が AsyncIterable でも ReadableStream でもなければ明示エラー", async () => {
    const r = streamResource<string>(() => ({ not: "a stream" }) as unknown as AsyncIterable<string>);
    await flushAsync();
    expect(r.status.peek()).toBe("error");
    expect((r.error.peek() as Error).message).toMatch(/AsyncIterable or a ReadableStream/);
  });

  it("abort が throw として現れても error にしない", async () => {
    const id = signal(1);
    const r = streamResource(
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
    const r = streamResource(
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

  it("ReadableStream を未消費のまま abort すると reader.cancel() で解放する", async () => {
    const id = signal(1);
    let cancelled = false;
    let released = false;
    // 1チャンク出した後は永久に保留する ReadableStream 風（done に到達しない）。
    const makeReadable = () =>
      ({
        getReader() {
          let i = 0;
          // Models a real reader: the parked read() stays pending until cancel(),
          // which settles it with { done: true } (as the streams spec requires).
          let settlePending: ((v: { done: boolean; value: unknown }) => void) | null = null;
          return {
            read: () =>
              i++ === 0
                ? Promise.resolve({ done: false, value: "first" })
                : new Promise((resolve) => {
                    settlePending = resolve;
                  }),
            // cancel settles the parked read (so the for-await unwinds) but then
            // REJECTS — exercising the swallow in onAbort's `.catch(() => {})`
            // (a real reader can reject cancel on an already-errored stream).
            cancel: () => {
              cancelled = true;
              settlePending?.({ done: true, value: undefined });
              return Promise.reject(new Error("cancel rejected"));
            },
            releaseLock: () => {
              released = true;
            },
          };
        },
      }) as unknown as ReadableStream<string>;

    streamResource<string>(() => makeReadable(), { args: () => id.get() });
    await flushAsync();

    id.set(2); // restart → 旧 run を abort（for-await を中断）
    flushSync();
    await flushAsync();

    expect(cancelled).toBe(true); // underlying source を解放
    expect(released).toBe(true);
  });

  it("ReadableStream が done まで消費されたら cancel は呼ばない", async () => {
    let cancelled = false;
    const fakeReadable = {
      getReader() {
        const data = ["p", "q"];
        let i = 0;
        return {
          read: async () =>
            i < data.length ? { done: false, value: data[i++] } : { done: true, value: undefined },
          cancel: async () => {
            cancelled = true;
          },
          releaseLock: () => {},
        };
      },
    } as unknown as ReadableStream<string>;

    const r = streamResource<string>(() => fakeReadable);
    await flushAsync();
    expect(r.value.peek()).toBe("q");
    expect(cancelled).toBe(false); // 正常に drain したので cancel 不要
  });

  it("abort 時に AsyncIterable の return() を呼ぶ（generator の finally 救済 / D3）", async () => {
    const id = signal(1);
    let returned = 0;
    // signal を無視して park する AsyncIterable。1チャンク出した後、return() 待ち。
    const makeIterable = (): AsyncIterable<string> => ({
      [Symbol.asyncIterator](): AsyncIterator<string> {
        let i = 0;
        return {
          next(): Promise<IteratorResult<string>> {
            return i++ === 0
              ? Promise.resolve({ done: false, value: "first" })
              : new Promise<IteratorResult<string>>(() => {}); // 永久 park
          },
          return(): Promise<IteratorResult<string>> {
            returned++;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    });

    streamResource<string>(() => makeIterable(), { args: () => id.get() });
    await flushAsync();

    id.set(2); // restart → 旧 run を abort
    flushSync();
    await flushAsync();

    expect(returned).toBe(1); // abort で return() が呼ばれ、generator の cleanup を起動
  });

  it("return() が reject/throw しても teardown は壊れない（D3 の握りつぶし）", async () => {
    const id = signal(1);
    let rejReturned = 0;
    let throwReturned = 0;
    // run1: return() が reject する iterator。run2: return() が同期 throw する iterator。
    const rejecting: AsyncIterable<string> = {
      [Symbol.asyncIterator](): AsyncIterator<string> {
        let i = 0;
        return {
          next: () =>
            i++ === 0
              ? Promise.resolve({ done: false, value: "a" })
              : new Promise<IteratorResult<string>>(() => {}),
          return(): Promise<IteratorResult<string>> {
            rejReturned++;
            return Promise.reject(new Error("return rejected"));
          },
        };
      },
    };
    const throwing: AsyncIterable<string> = {
      [Symbol.asyncIterator](): AsyncIterator<string> {
        let i = 0;
        return {
          next: () =>
            i++ === 0
              ? Promise.resolve({ done: false, value: "b" })
              : new Promise<IteratorResult<string>>(() => {}),
          return(): never {
            throwReturned++;
            throw new Error("return threw");
          },
        };
      },
    };
    const map: Record<number, AsyncIterable<string>> = { 1: rejecting, 2: throwing };

    const r = streamResource<string>(() => map[id.peek()], { args: () => id.get() });
    await flushAsync();
    id.set(2); // restart → run1 を abort（return() が reject、握りつぶす）
    flushSync();
    await flushAsync();
    expect(rejReturned).toBe(1);

    r.dispose(); // run2 を abort（return() が同期 throw、握りつぶす）
    await flushAsync();
    expect(throwReturned).toBe(1);
    // どちらの teardown も例外を外に漏らさない（テストが完走する＝OK）。
  });

  it("source の await 中に abort されても、解決後の iterator の return() を呼ぶ（D3）", async () => {
    const id = signal(1);
    let returned = 0;
    let resolveProduced!: (it: AsyncIterable<string>) => void;
    const producedPromise = new Promise<AsyncIterable<string>>((r) => (resolveProduced = r));
    const iterable: AsyncIterable<string> = {
      [Symbol.asyncIterator](): AsyncIterator<string> {
        return {
          next: () => new Promise<IteratorResult<string>>(() => {}),
          return(): Promise<IteratorResult<string>> {
            returned++;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    };

    streamResource(
      (a: number) => (a === 1 ? producedPromise : manualStream<string>().iterable),
      { args: () => id.get() },
    );
    id.set(2); // source(args=1) の Promise 解決前に restart → run1 を abort
    flushSync();
    resolveProduced(iterable); // run1 の source がようやく解決
    await flushAsync();

    expect(returned).toBe(1); // 解決後に aborted を検知し iterator を return() で解放
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
