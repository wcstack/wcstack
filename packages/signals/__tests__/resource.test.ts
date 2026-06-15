import { describe, it, expect } from "vitest";
import { signal, flushSync, createRoot } from "../src/reactive.js";
import { resource } from "../src/resource.js";

/** A manually-resolvable deferred, for deterministic async assertions. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain all pending microtasks (e.g. chained .then in the source + resource). */
const flushAsync = () => new Promise((r) => setTimeout(r, 0));

describe("resource", () => {
  it("成功パス: loading が立ち、解決で value が入り loading が下がる", async () => {
    const d = deferred<string>();
    const r = resource(() => d.promise);
    expect(r.loading.peek()).toBe(true);
    expect(r.value.peek()).toBeUndefined();

    d.resolve("ok");
    await d.promise;
    expect(r.value.peek()).toBe("ok");
    expect(r.loading.peek()).toBe(false);
    expect(r.error.peek()).toBeNull();
  });

  it("initial で初期値を与えられる", () => {
    const r = resource(() => deferred<number>().promise, { initial: 42 });
    expect(r.value.peek()).toBe(42);
  });

  it("失敗パス: error が入り loading が下がる", async () => {
    const d = deferred<string>();
    const r = resource(() => d.promise);
    const boom = new Error("boom");
    d.reject(boom);
    await d.promise.catch(() => {});
    expect(r.error.peek()).toBe(boom);
    expect(r.loading.peek()).toBe(false);
  });

  it("args 変化で古いリクエストを abort して張り直す（switchMap）", async () => {
    const id = signal(1);
    const aborts: boolean[] = [];
    const deferreds: Array<ReturnType<typeof deferred<string>>> = [];

    const r = resource(
      (a: number, sig: AbortSignal) => {
        const d = deferred<string>();
        deferreds.push(d);
        sig.addEventListener("abort", () => aborts.push(true));
        return d.promise.then((v) => `${a}:${v}`);
      },
      { args: () => id.get() },
    );

    expect(deferreds.length).toBe(1); // 初回起動

    id.set(2); // 依存変化 → 再起動
    flushSync();
    expect(aborts.length).toBe(1); // 旧リクエストが abort された
    expect(deferreds.length).toBe(2);

    // 新リクエストが解決
    deferreds[1].resolve("new");
    await flushAsync();
    expect(r.value.peek()).toBe("2:new");
  });

  it("abort された古いリクエストの遅延解決は無視される（stale-drop）", async () => {
    const id = signal(1);
    const deferreds: Array<ReturnType<typeof deferred<string>>> = [];

    const r = resource(
      (a: number) => {
        const d = deferred<string>();
        deferreds.push(d);
        return d.promise.then((v) => `${a}:${v}`);
      },
      { args: () => id.get() },
    );

    id.set(2);
    flushSync();

    // 新（2番目）が先に解決
    deferreds[1].resolve("fresh");
    await flushAsync();
    expect(r.value.peek()).toBe("2:fresh");

    // 後から古い（1番目）が解決しても上書きしない
    deferreds[0].resolve("stale");
    await flushAsync();
    expect(r.value.peek()).toBe("2:fresh");
  });

  it("abort 後に古いリクエストが reject しても error を上書きしない（stale-drop・error 経路）", async () => {
    const id = signal(1);
    const deferreds: Array<ReturnType<typeof deferred<string>>> = [];
    const r = resource(
      (_a: number) => {
        const d = deferred<string>();
        deferreds.push(d);
        return d.promise;
      },
      { args: () => id.get() },
    );

    id.set(2); // 1番目を abort
    flushSync();

    deferreds[1].resolve("ok"); // 新リクエスト成功
    await flushAsync();
    expect(r.value.peek()).toBe("ok");
    expect(r.error.peek()).toBeNull();

    // 後から古い（abort 済み）リクエストが reject しても error を立てない
    deferreds[0].reject(new Error("late-fail"));
    await flushAsync();
    expect(r.error.peek()).toBeNull();
    expect(r.value.peek()).toBe("ok");
  });

  it("dispose で in-flight を abort し、以降 args 変化に反応しない", async () => {
    const id = signal(1);
    let starts = 0;
    let aborted = false;
    const r = resource(
      (_a: number, sig: AbortSignal) => {
        starts++;
        sig.addEventListener("abort", () => (aborted = true));
        return deferred<string>().promise;
      },
      { args: () => id.get() },
    );
    expect(starts).toBe(1);

    r.dispose();
    expect(aborted).toBe(true); // in-flight を abort

    id.set(2);
    flushSync();
    expect(starts).toBe(1); // 再起動しない
  });

  it("args 無しでも単発ソースとして動く", async () => {
    const d = deferred<string>();
    const r = resource(() => d.promise);
    d.resolve("once");
    await d.promise;
    expect(r.value.peek()).toBe("once");
  });

  it("同期値を返すソースも扱える", async () => {
    const r = resource(() => "sync-value");
    await flushAsync();
    expect(r.value.peek()).toBe("sync-value");
    expect(r.loading.peek()).toBe(false);
  });

  it("source が同期 throw しても loading が固着せず error に正規化される", async () => {
    const r = resource(() => {
      throw new Error("sync-boom");
    });
    await flushAsync();
    expect(r.loading.peek()).toBe(false); // 固着しない
    expect((r.error.peek() as Error).message).toBe("sync-boom");
  });

  it("二重 teardown（owner dispose と手動 dispose の重複）は無害", () => {
    let aborts = 0;
    let dispose!: () => void;
    let res!: ReturnType<typeof resource<string, void>>;
    createRoot((d) => {
      dispose = d;
      res = resource((_a, sig: AbortSignal) => {
        sig.addEventListener("abort", () => aborts++);
        return deferred<string>().promise;
      });
    });
    res.dispose(); // 手動
    dispose(); // owner 側（effect dispose + onCleanup dispose）
    res.dispose(); // 再度手動
    // abort は冪等。複数経路で呼ばれても in-flight 1 件分の abort で破綻しない。
    expect(aborts).toBe(1);
  });

  it("createRoot 配下で生成すると dispose 時に abort される（onCleanup 連動）", () => {
    let aborted = false;
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      resource((_a, sig: AbortSignal) => {
        sig.addEventListener("abort", () => (aborted = true));
        return deferred<string>().promise;
      });
    });
    expect(aborted).toBe(false);
    dispose(); // owner 破棄 → resource も abort
    expect(aborted).toBe(true);
  });
});
