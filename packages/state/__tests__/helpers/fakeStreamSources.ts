/**
 * __tests__/helpers/fakeStreamSources.ts
 *
 * `$streams` テスト用の fake source 群（packages/signals/__tests__/streamResource.test.ts
 * のヘルパを移植・共通化）。stream.consumeSource.test.ts のほか、runtime / restart 系の
 * 後続テストからも再利用する想定で export している。
 *
 * - makeManualAsyncGenerator: 手動 resolve 制御の async iterable（push / end）
 * - makeManualFailableSource: 手動 resolve 制御の async iterable（push / fail で reject 終端）
 * - makeFakeReadableStream: getReader だけ持つ ReadableStream 風（全チャンク drain で done）
 * - makeParkedFakeReadableStream: チャンク送出後に永久 park する ReadableStream 風
 *   （cancel が parked read を settle してから reject する — 実 reader の挙動をモデル化）
 * - makeParkedAsyncIterable: チャンク送出後に永久 park する AsyncIterable
 *   （return() の挙動を resolve / reject / throw から選べる）
 */

/** 手動駆動の async iterable: push でチャンク供給、end で終端。 */
export function makeManualAsyncGenerator<C>(): {
  iterable: AsyncIterable<C>;
  push: (c: C) => void;
  end: () => void;
} {
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

/**
 * 手動駆動の失敗可能な async iterable: push でチャンク供給、fail で reject 終端。
 * makeManualAsyncGenerator（正常終端専用）の error 終端版。
 * consumeSource は next() を逐次 await するため、pending は常に高々 1 つ。
 */
export function makeManualFailableSource<C>(): {
  iterable: AsyncIterable<C>;
  push: (c: C) => void;
  fail: (e: unknown) => void;
} {
  const chunks: C[] = [];
  let waiting: { resolve: (r: IteratorResult<C>) => void; reject: (e: unknown) => void } | null = null;
  let failure: { error: unknown } | null = null;
  const settle = (): void => {
    if (waiting === null) {
      return;
    }
    if (chunks.length > 0) {
      const w = waiting;
      waiting = null;
      w.resolve({ done: false, value: chunks.shift() as C });
      return;
    }
    if (failure !== null) {
      const w = waiting;
      waiting = null;
      w.reject(failure.error);
    }
  };
  const iterable: AsyncIterable<C> = {
    [Symbol.asyncIterator](): AsyncIterator<C> {
      return {
        next: (): Promise<IteratorResult<C>> =>
          new Promise<IteratorResult<C>>((resolve, reject) => {
            waiting = { resolve, reject };
            settle();
          }),
      };
    },
  };
  return {
    iterable,
    push: (c: C): void => {
      chunks.push(c);
      settle();
    },
    fail: (e: unknown): void => {
      failure = { error: e };
      settle();
    },
  };
}

/**
 * getReader だけ持つ fake ReadableStream 風オブジェクト（Symbol.asyncIterator なし）。
 * data を順に返し、尽きたら { done: true }。cancel / releaseLock の呼び出し回数を観測できる。
 */
export function makeFakeReadableStream<C>(data: C[]): {
  stream: ReadableStream<C>;
  readonly cancelled: number;
  readonly released: number;
} {
  let cancelled = 0;
  let released = 0;
  const stream = {
    getReader() {
      let i = 0;
      return {
        read: async () =>
          i < data.length ? { done: false, value: data[i++] } : { done: true, value: undefined },
        cancel: async () => {
          cancelled++;
        },
        releaseLock: () => {
          released++;
        },
      };
    },
  } as unknown as ReadableStream<C>;
  return {
    stream,
    get cancelled() {
      return cancelled;
    },
    get released() {
      return released;
    },
  };
}

/**
 * chunks を出し切った後は永久に保留する fake ReadableStream 風（done に到達しない）。
 * Models a real reader: the parked read() stays pending until cancel(),
 * which settles it with { done: true } (as the streams spec requires).
 * cancel は parked read を settle した後 REJECT する — abort teardown 側の
 * `.catch(() => {})` による握りつぶしを演習するため（実 reader も errored stream
 * では cancel が reject し得る）。
 */
export function makeParkedFakeReadableStream<C>(chunks: C[]): {
  stream: ReadableStream<C>;
  readonly cancelled: number;
  readonly released: number;
} {
  let cancelled = 0;
  let released = 0;
  const stream = {
    getReader() {
      let i = 0;
      let settlePending: ((v: { done: boolean; value: unknown }) => void) | null = null;
      return {
        read: () =>
          i < chunks.length
            ? Promise.resolve({ done: false, value: chunks[i++] })
            : new Promise((resolve) => {
                settlePending = resolve;
              }),
        cancel: () => {
          cancelled++;
          settlePending?.({ done: true, value: undefined });
          return Promise.reject(new Error("cancel rejected"));
        },
        releaseLock: () => {
          released++;
        },
      };
    },
  } as unknown as ReadableStream<C>;
  return {
    stream,
    get cancelled() {
      return cancelled;
    },
    get released() {
      return released;
    },
  };
}

export type ParkedIteratorReturnBehavior = "resolve" | "reject" | "throw";

/**
 * chunks を出し切った後、next() が永久に park する AsyncIterable（signal は無視する）。
 * return() の呼び出し回数を観測でき、挙動を選べる:
 * - "resolve": { done: true } を resolve（既定）
 * - "reject": reject する（teardown 側の握りつぶし演習用）
 * - "throw": 同期 throw する（同上）
 */
export function makeParkedAsyncIterable<C>(
  chunks: C[],
  returnBehavior: ParkedIteratorReturnBehavior = "resolve",
): {
  iterable: AsyncIterable<C>;
  readonly returned: number;
} {
  let returned = 0;
  const iterable: AsyncIterable<C> = {
    [Symbol.asyncIterator](): AsyncIterator<C> {
      let i = 0;
      return {
        next: (): Promise<IteratorResult<C>> =>
          i < chunks.length
            ? Promise.resolve({ done: false, value: chunks[i++] })
            : new Promise<IteratorResult<C>>(() => {}), // 永久 park
        return(): Promise<IteratorResult<C>> {
          returned++;
          if (returnBehavior === "throw") {
            throw new Error("return threw");
          }
          if (returnBehavior === "reject") {
            return Promise.reject(new Error("return rejected"));
          }
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  };
  return {
    iterable,
    get returned() {
      return returned;
    },
  };
}
