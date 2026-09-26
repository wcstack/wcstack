import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, DirtyStrategy, Engine, getBindingsReady, installFeatures, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

async function host(html: string, state: Record<string, any>) {
  const h = document.createElement(`cov-temporal-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  const write = async (fn: (s: any) => void) => {
    el.createState("writable", fn);
    await flush();
  };
  const read = (path: string) => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  return { h, root, el, write, read };
}

/** A page whose engine was made before the add-on was installed. */
let early: Awaited<ReturnType<typeof host>>;

beforeAll(async () => {
  bootstrapState();
  early = await host(`<p>{{ double }}</p>`, { n: 1, get double() { return (this as any).n * 2; } });
  installFeatures([temporal]);
});

/** A source whose chunks the test pushes by hand. */
function manual() {
  const runs: { args: unknown; push: (v: unknown) => void; end: () => void; fail: (e: unknown) => void; signal: AbortSignal }[] = [];
  const source = (args: unknown, signal: AbortSignal) => new ReadableStream({
    start(c) {
      runs.push({ args, signal, push: (v) => c.enqueue(v), end: () => c.close(), fail: (e) => c.error(e) });
    },
  });
  return { runs, source };
}

const make = (state: Record<string, any>) => new Engine(state, new DirtyStrategy());

describe("宣言の検査", () => {
  it.each<[Record<string, any>, string]>([
    [{ $stream: null }, "$stream must be an object mapping stream names to definitions."],
    [{ $stream: 5 }, "$stream must be an object mapping stream names to definitions."],
    [{ $stream: { s: 5 } }, '$stream entry "s" must be an object.'],
    [{ $stream: { s: null } }, '$stream entry "s" must be an object.'],
    [{ $stream: { s: { source() {}, fold: 1, initial: 0 } } }, '$stream entry "s": fold must be a function.'],
    [{ $stream: { s: { source() {}, args: 1 } } }, '$stream entry "s": args must be a function.'],
    [{ $watch: null }, "$watch must be an object mapping paths to handler functions."],
    [{ $watch: "n" }, "$watch must be an object mapping paths to handler functions."],
    [{ n: 0, $watch: { n: 1 } }, '$watch entry "n" must be a function.'],
  ])("不正な $stream / $watch を拒む（%#）", (state, message) => {
    expect(() => make(state)).toThrow(message);
  });
});

describe("$stream", () => {
  it("状態が値を持っていれば始まるまではその値のまま（$connectedCallback が見る）、始まると initial になる", async () => {
    const m = manual();
    const seen: unknown[] = [];
    const { root, read } = await host(`<p>{{ s }}</p>`, {
      s: "pre",
      $stream: { s: { source: m.source, initial: "init" } },
      $connectedCallback(this: any) { seen.push(this.s); },
    });
    expect(seen).toEqual(["pre"]);
    expect(read("s")).toBe("init");
    expect(root.querySelector("p")!.textContent).toBe("init");
    m.runs[0].push("chunk");
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("chunk");
  });

  it("再セットは前の実行を中止し（新しい状態には触れない）、新しい状態のストリームを始める", async () => {
    const m1 = manual();
    const m2 = manual();
    const { el, root, read } = await host(`<p>{{ s }}</p>`, { $stream: { s: { source: m1.source, initial: 0 } } });
    m1.runs[0].push(1);
    await flush();
    expect(read("s")).toBe(1);
    el.setInitialState({ $stream: { s: { source: m2.source, initial: 10 } } });
    await flush();
    expect(m1.runs[0].signal.aborted).toBe(true);
    // the old run's reader was cancelled: its stream takes no more chunks
    expect(() => m1.runs[0].push(2)).toThrow();
    expect(m2.runs).toHaveLength(1);
    expect(read("s")).toBe(10);
    expect(read("$streamStatus.s")).toBe("active");
    m2.runs[0].push(11);
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("11");
  });

  it("切断中の再セットではストリームを始めず、再接続で始める", async () => {
    const m1 = manual();
    const m2 = manual();
    const { h, el, read } = await host(``, { $stream: { s: { source: m1.source } } });
    h.remove();
    await flush();
    el.setInitialState({ $stream: { t: { source: m2.source, initial: "x" } } });
    await flush();
    expect(m2.runs).toHaveLength(0);
    expect(read("t")).toBe("x");
    expect(read("$streamStatus.t")).toBe("idle");
    document.body.appendChild(h);
    await flush();
    await flush();
    expect(m2.runs).toHaveLength(1);
    expect(read("$streamStatus.t")).toBe("active");
  });

  it("source の Promise が中止の後に解決しても、そのストリームは読まない", async () => {
    let resolve!: (v: unknown) => void;
    const signals: AbortSignal[] = [];
    const { h, read } = await host(``, {
      $stream: { s: { initial: "i", source: (_a: unknown, signal: AbortSignal) => { signals.push(signal); return new Promise((r) => { resolve = r; }); } } },
    });
    expect(read("$streamStatus.s")).toBe("active");
    h.remove();
    await flush();
    expect(signals[0].aborted).toBe(true);
    const late = new ReadableStream({ start(c) { c.enqueue("late"); c.close(); } });
    resolve(late);
    await flush();
    expect(late.locked).toBe(false);
    expect(read("s")).toBe("i");
    expect(read("$streamStatus.s")).toBe("idle");
  });

  it("非同期イテレータ：再開で前の実行に return() を呼び、その後に届いた値は捨てる。done で終わる", async () => {
    const nexts: ((r: IteratorResult<unknown>) => void)[] = [];
    let returned = 0;
    const source = () => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>((r) => { nexts.push(r); }),
          return: () => { returned++; return Promise.resolve({ value: undefined, done: true as const }); },
        };
      },
    });
    const { write, read } = await host(``, { q: 1, $stream: { s: { args: (st: any) => st.q, source, initial: 0 } } });
    expect(nexts).toHaveLength(1);
    await write((st) => { st.q = 2; });
    expect(returned).toBe(1);
    expect(nexts).toHaveLength(2);
    // the aborted run's pending next() resolves now: dropped
    nexts[0]({ value: 99, done: false });
    await flush();
    expect(read("s")).toBe(0);
    nexts[1]({ value: 5, done: false });
    await flush();
    expect(read("s")).toBe(5);
    nexts[2]({ value: undefined, done: true });
    await flush();
    expect(read("$streamStatus.s")).toBe("done");
    expect(read("s")).toBe(5);
  });

  it("async iterable でも ReadableStream でもない source の値は error 状態（TypeError）", async () => {
    const { read } = await host(``, {
      $stream: { a: { source: () => 42 }, b: { source: async () => null } },
    });
    await flush();
    for (const name of ["a", "b"]) {
      expect(read(`$streamStatus.${name}`)).toBe("error");
      const e = read(`$streamError.${name}`) as Error;
      expect(e).toBeInstanceOf(TypeError);
      expect(e.message).toBe(`$stream "${name}": source must return an async iterable or a ReadableStream`);
    }
  });

  it("中止の後の source の失敗（AbortError）は報告しない", async () => {
    const { h, read } = await host(``, {
      $stream: {
        s: {
          source: (_a: unknown, signal: AbortSignal) => new Promise((_r, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
        },
      },
    });
    h.remove();
    await flush();
    expect(read("$streamStatus.s")).toBe("idle");
    expect(read("$streamError.s")).toBe(null);
  });

  it("ReadableStream の失敗は error 状態になり、畳んだ値は残る（読み手の cancel の失敗は握りつぶす）", async () => {
    const m = manual();
    const { read } = await host(``, { $stream: { s: { source: m.source, fold: (a: number, c: number) => a + c, initial: 0 } } });
    m.runs[0].push(2);
    m.runs[0].push(3);
    await flush();
    m.runs[0].fail(new Error("broken"));
    await flush();
    expect(read("s")).toBe(5);
    expect(read("$streamStatus.s")).toBe("error");
    expect((read("$streamError.s") as Error).message).toBe("broken");
    expect(m.runs[0].signal.aborted).toBe(true);
  });
});

describe("$watch", () => {
  it("監視するパスの範囲でないリストの同期では発火しない", async () => {
    const seen: string[] = [];
    const { write } = await host(`<ul><template data-wcs="for: items"><li>{{ . }}</li></template></ul>`, {
      n: 0, items: [1], others: [{ v: 1 }],
      $watch: {
        n(cur: number) { seen.push(`n:${cur}`); },
        "others.*.v"(cur: number, _p: unknown, i: number) { seen.push(`others.${i}:${cur}`); },
      },
    });
    await write((s) => { s.items = [1, 2]; });
    expect(seen).toEqual([]);
    await write((s) => { s.n = 1; s.others = [...s.others, { v: 2 }]; });
    expect(seen).toEqual(["n:1", "others.1:2"]);
  });

  it("入れ子の行は外側の添字が同じでも内側の添字の昇順に発火する", async () => {
    const seen: string[] = [];
    const { write } = await host(``, {
      groups: [{ items: [{ v: 0 }, { v: 0 }] }, { items: [{ v: 0 }] }],
      $watch: { "groups.*.items.*.v"(cur: number, _p: unknown, g: number, i: number) { seen.push(`${g}.${i}=${cur}`); } },
    });
    await write((s) => {
      s["groups.1.items.0.v"] = 3;
      s["groups.0.items.1.v"] = 2;
      s["groups.0.items.0.v"] = 1;
    });
    expect(seen).toEqual(["0.0=1", "0.1=2", "1.0=3"]);
  });
});

describe("add-on を入れる前に作られたエンジン", () => {
  it("書き込み・getter への到達・drain の後始末は、実行時の無いエンジンでは何もしない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await early.write((s) => { s.n = 5; });
      expect(early.root.querySelector("p")!.textContent).toBe("10");
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
