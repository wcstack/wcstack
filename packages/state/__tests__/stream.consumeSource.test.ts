/**
 * stream.consumeSource.test.ts
 *
 * consumeSource（signals streamResource の consume / iterate / readableToAsyncIterable
 * 移植）の単体テスト。状態書き込みは IConsumeSink（vi.fn スパイ）で観測する。
 * 受け入れ ID: P4, P8, P9, P10, P11, P12, P13, P14, P15 ＋ fold throw
 * （docs/state-streams-design.md §10-1）。
 */
import { describe, it, expect, vi } from "vitest";
import { consumeSource } from "../src/stream/consumeSource";
import type { IConsumeSink, StreamSource } from "../src/stream/types";
import {
  makeManualAsyncGenerator,
  makeFakeReadableStream,
  makeParkedFakeReadableStream,
  makeParkedAsyncIterable,
} from "./helpers/fakeStreamSources";

const flushAsync = () => new Promise<void>((r) => setTimeout(r, 0));

function makeSink(overrides: Partial<IConsumeSink> = {}) {
  return {
    fold: vi.fn(overrides.fold ?? (() => {})),
    done: vi.fn(overrides.done ?? (() => {})),
    fail: vi.fn(overrides.fail ?? (() => {})),
  };
}

describe("consumeSource", () => {
  it("各チャンクで sink.fold が順に呼ばれ、正常終端で sink.done が呼ばれる（args / signal は素通し）", async () => {
    const sink = makeSink();
    const ac = new AbortController();
    const argsObj = { q: 1 };
    const received: unknown[] = [];
    const source: StreamSource = (args, sig) => {
      received.push(args, sig);
      return (async function* () {
        yield "a";
        yield "b";
        yield "c";
      })();
    };
    await consumeSource(source, argsObj, ac.signal, sink);
    expect(sink.fold.mock.calls).toEqual([["a"], ["b"], ["c"]]);
    expect(sink.done).toHaveBeenCalledTimes(1);
    expect(sink.fail).not.toHaveBeenCalled();
    expect(received[0]).toBe(argsObj);
    expect(received[1]).toBe(ac.signal);
  });

  it("P4: Symbol.asyncIterator 無しの ReadableStream 風を getReader フォールバックで消費できる", async () => {
    const fake = makeFakeReadableStream(["p", "q"]);
    const sink = makeSink();
    await consumeSource(() => fake.stream, undefined, new AbortController().signal, sink);
    expect(sink.fold.mock.calls).toEqual([["p"], ["q"]]);
    expect(sink.done).toHaveBeenCalledTimes(1);
    expect(sink.fail).not.toHaveBeenCalled();
    expect(fake.released).toBe(1); // finally で releaseLock
  });

  it("P12: ReadableStream が done まで消費されたら cancel は呼ばない", async () => {
    const fake = makeFakeReadableStream(["p", "q"]);
    const sink = makeSink();
    await consumeSource(() => fake.stream, undefined, new AbortController().signal, sink);
    expect(sink.done).toHaveBeenCalledTimes(1);
    expect(fake.cancelled).toBe(0); // 正常に drain したので cancel 不要
    expect(fake.released).toBe(1);
  });

  it("途中エラーは sink.fail に出る（直前チャンクまでは fold 済み・done は呼ばれない）", async () => {
    const err = new Error("boom");
    const sink = makeSink();
    const source: StreamSource = async function* () {
      yield "ok";
      throw err;
    };
    await consumeSource(source, undefined, new AbortController().signal, sink);
    expect(sink.fold.mock.calls).toEqual([["ok"]]);
    expect(sink.fail).toHaveBeenCalledTimes(1);
    expect(sink.fail).toHaveBeenCalledWith(err);
    expect(sink.done).not.toHaveBeenCalled();
  });

  it("P8: source が AsyncIterable でも ReadableStream でもなければ TypeError で sink.fail", async () => {
    const sink = makeSink();
    const source = (() => ({ not: "a stream" })) as unknown as StreamSource;
    await consumeSource(source, undefined, new AbortController().signal, sink);
    expect(sink.fail).toHaveBeenCalledTimes(1);
    const e = sink.fail.mock.calls[0][0];
    expect(e).toBeInstanceOf(TypeError);
    expect((e as TypeError).message).toMatch(/AsyncIterable or a ReadableStream/);
    expect(sink.done).not.toHaveBeenCalled();
    expect(sink.fold).not.toHaveBeenCalled();
  });

  it("fold throw: sink.fold が throw したら sink.fail がそのエラーで呼ばれ、sink.done は呼ばれない", async () => {
    const err = new Error("fold-boom");
    const sink = makeSink({
      fold: () => {
        throw err;
      },
    });
    const source: StreamSource = async function* () {
      yield "a";
      yield "b";
    };
    await consumeSource(source, undefined, new AbortController().signal, sink);
    expect(sink.fold).toHaveBeenCalledTimes(1); // "b" 以降は消費されない
    expect(sink.fail).toHaveBeenCalledTimes(1);
    expect(sink.fail).toHaveBeenCalledWith(err);
    expect(sink.done).not.toHaveBeenCalled();
  });

  it("P9: abort が throw として現れても sink.fail を呼ばない", async () => {
    const sink = makeSink();
    const ac = new AbortController();
    const source: StreamSource = (_args, sig) =>
      (async function* () {
        yield "a";
        await new Promise<void>((_resolve, reject) => {
          sig.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      })();
    const p = consumeSource(source, undefined, ac.signal, sink);
    await flushAsync();
    expect(sink.fold).toHaveBeenCalledWith("a");
    ac.abort(); // 旧 run を abort → reject するが error にしない
    await p;
    expect(sink.fail).not.toHaveBeenCalled();
    expect(sink.done).not.toHaveBeenCalled();
  });

  it("P10: チャンクを出さないまま abort された run は sink.done を呼ばない", async () => {
    const sink = makeSink();
    const ac = new AbortController();
    const m = makeManualAsyncGenerator<string>();
    const p = consumeSource(() => m.iterable, undefined, ac.signal, sink);
    await flushAsync(); // ループが park するまで進める
    ac.abort();
    m.end(); // abort 後に終端が届いても done にしない（stale-drop）
    await p;
    expect(sink.done).not.toHaveBeenCalled();
    expect(sink.fail).not.toHaveBeenCalled();
    expect(sink.fold).not.toHaveBeenCalled();
  });

  it("P11: ReadableStream を未消費のまま abort すると reader.cancel() で解放する（cancel の reject は握りつぶす）", async () => {
    const sink = makeSink();
    const ac = new AbortController();
    const fake = makeParkedFakeReadableStream(["first"]);
    const p = consumeSource(() => fake.stream, undefined, ac.signal, sink);
    await flushAsync();
    expect(sink.fold).toHaveBeenCalledWith("first");
    ac.abort(); // parked read() を cancel で強制解放
    await p;
    expect(fake.cancelled).toBe(1); // underlying source を解放
    expect(fake.released).toBe(1);
    expect(sink.done).not.toHaveBeenCalled(); // abort 済み run なので done にしない
    expect(sink.fail).not.toHaveBeenCalled();
  });

  it("P13: abort 時に AsyncIterable の return() を呼ぶ（generator の finally 救済）", async () => {
    const sink = makeSink();
    const ac = new AbortController();
    const parked = makeParkedAsyncIterable(["first"]);
    void consumeSource(() => parked.iterable, undefined, ac.signal, sink);
    await flushAsync();
    expect(sink.fold).toHaveBeenCalledWith("first");
    ac.abort();
    await flushAsync();
    expect(parked.returned).toBe(1); // abort で return() が呼ばれ、generator の cleanup を起動
    expect(sink.done).not.toHaveBeenCalled();
    expect(sink.fail).not.toHaveBeenCalled();
  });

  it("P14: return() が reject / 同期 throw しても teardown は壊れない（握りつぶし）", async () => {
    // run1: return() が reject する iterator
    const rejecting = makeParkedAsyncIterable(["a"], "reject");
    const ac1 = new AbortController();
    const sink1 = makeSink();
    void consumeSource(() => rejecting.iterable, undefined, ac1.signal, sink1);
    await flushAsync();
    ac1.abort();
    await flushAsync();
    expect(rejecting.returned).toBe(1);
    expect(sink1.fail).not.toHaveBeenCalled();

    // run2: return() が同期 throw する iterator
    const throwing = makeParkedAsyncIterable(["b"], "throw");
    const ac2 = new AbortController();
    const sink2 = makeSink();
    void consumeSource(() => throwing.iterable, undefined, ac2.signal, sink2);
    await flushAsync();
    ac2.abort();
    await flushAsync();
    expect(throwing.returned).toBe(1);
    expect(sink2.fail).not.toHaveBeenCalled();
    // どちらの teardown も例外を外に漏らさない（テストが完走する＝OK）。
  });

  it("P15: source の await 中に abort されても、解決後の iterator の return() を呼ぶ", async () => {
    const sink = makeSink();
    const ac = new AbortController();
    let resolveProduced!: (it: AsyncIterable<string>) => void;
    const producedPromise = new Promise<AsyncIterable<string>>((r) => (resolveProduced = r));
    const parked = makeParkedAsyncIterable<string>([]);
    const p = consumeSource(() => producedPromise, undefined, ac.signal, sink);
    ac.abort(); // source 解決前に abort（この時点では iterator が無く listener は no-op）
    resolveProduced(parked.iterable); // source がようやく解決
    await p;
    expect(parked.returned).toBe(1); // 解決後に aborted を検知し iterator を return() で解放（二重解放なし）
    expect(sink.done).not.toHaveBeenCalled();
    expect(sink.fail).not.toHaveBeenCalled();
  });
});
