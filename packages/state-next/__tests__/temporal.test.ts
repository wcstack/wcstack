import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([temporal]);
  bootstrapState();
});

async function host(html: string, state: Record<string, any>) {
  const h = document.createElement(`temporal-test-${seq++}`);
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

describe("$watch", () => {
  it("ハンドラの失敗は報告され、ほかの監視は動く", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    const { write } = await host("", {
      a: 0, b: 0,
      $watch: { a() { throw new Error("boom"); }, b(cur: number) { seen.push(`b:${cur}`); } },
    });
    await write((s) => { s.a = 1; s.b = 2; });
    expect(seen).toEqual(["b:2"]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('$watch "a" failed'), expect.any(Error));
    error.mockRestore();
  });

  it("互いに書き合う監視は 32 回で打ち切る", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let fired = 0;
    const { write } = await host("", {
      n: 0,
      $watch: { n(this: any, cur: number) { fired++; this.n = cur + 1; } },
    });
    await write((s) => { s.n = 1; });
    for (let i = 0; i < 40; i++) await flush();
    expect(fired).toBe(32);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("the chain is cut"));
    error.mockRestore();
  });

  it("$connectedCallback の中の書き込みでは発火せず、その後から発火する", async () => {
    const seen: unknown[] = [];
    const { write } = await host("", {
      n: 0,
      $connectedCallback(this: any) { this.n = 5; },
      $watch: { n(cur: unknown, prev: unknown) { seen.push([cur, prev]); } },
    });
    expect(seen).toEqual([]);
    await write((s) => { s.n = 6; });
    expect(seen).toEqual([[6, 5]]);
  });

  it("切断中は発火せず、再接続すると再び発火する", async () => {
    const seen: unknown[] = [];
    const { h, write } = await host("", { n: 0, $watch: { n(cur: unknown) { seen.push(cur); } } });
    h.remove();
    await write((s) => { s.n = 1; });
    document.body.appendChild(h);
    await flush();
    await write((s) => { s.n = 2; });
    expect(seen).toEqual([2]);
  });

  it("再セットは書き込みではない（発火しない）。新しい状態の監視がその後から働く", async () => {
    const old: unknown[] = [];
    const next: unknown[] = [];
    const { el, write } = await host("", { n: 0, $watch: { n(cur: unknown) { old.push(cur); } } });
    el.setInitialState({ n: 10, $watch: { n(cur: unknown) { next.push(cur); } } });
    await flush();
    await write((s) => { s.n = 11; });
    expect(old).toEqual([]);
    expect(next).toEqual([11]);
  });

  it.each(["$x", "a@b", ""])("監視できないパス %j は投げる", async (path) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`temporal-test-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state>`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ $watch: { [path]() {} } });
    document.body.appendChild(h);
    await expect(el.connectedCallbackPromise).rejects.toThrow("is not a path of the state tree");
    error.mockRestore();
  });

  it("ワイルドカードの getter も先行評価され、変わった行だけが発火する", async () => {
    const seen: string[] = [];
    const { write } = await host("", {
      items: [{ n: 1 }, { n: 2 }],
      get "items.*.double"() { return (this as any)["items.*.n"] * 2; },
      $watch: { "items.*.double"(cur: number, prev: number, i: number) { seen.push(`${i}:${prev}->${cur}`); } },
    });
    await write((s) => { s["items.1.n"] = 5; });
    expect(seen).toEqual(["1:4->10"]);
  });

  it("for の無い入れ子の行も、書き込みと新しい行で発火する", async () => {
    const seen: string[] = [];
    const { write } = await host("", {
      groups: [{ items: [{ v: 1 }] }],
      $watch: { "groups.*.items.*.v"(cur: number, prev: unknown, g: number, i: number) { seen.push(`${g}.${i}:${prev}->${cur}`); } },
    });
    await write((s) => { s["groups.0.items.0.v"] = 2; });
    await write((s) => { s["groups.0.items"] = [...s["groups.0.items"], { v: 3 }]; });
    await write((s) => { s.groups = [...s.groups, { items: [{ v: 9 }] }]; });
    expect(seen).toEqual(["0.0:1->2", "0.1:undefined->3", "1.0:undefined->9"]);
  });
});

/** A source whose chunks the test pushes by hand. */
function manual() {
  const runs: { args: unknown; push: (v: unknown) => void; end: () => void; signal: AbortSignal }[] = [];
  const source = (args: unknown, signal: AbortSignal) => new ReadableStream({
    start(c) {
      runs.push({ args, signal, push: (v) => c.enqueue(v), end: () => c.close() });
    },
  });
  return { runs, source };
}

describe("$stream", () => {
  it("依存を同じ回に何度書いても再開は 1 回。done の後も依存で再開する", async () => {
    const m = manual();
    const { write, read } = await host("", { q: "a", $stream: { s: { args: (st: any) => st.q, source: m.source } } });
    m.runs[0].push("x");
    m.runs[0].end();
    await flush();
    expect(read("$streamStatus.s")).toBe("done");
    await write((st) => { st.q = "b"; st.q = "c"; });
    expect(m.runs.map((r) => r.args)).toEqual(["a", "c"]);
    // a finished run is not aborted afterwards
    expect(m.runs[0].signal.aborted).toBe(false);
    expect(read("$streamStatus.s")).toBe("active");
  });

  it("実行中の再開では前の実行を中止し、その後の塊は捨てる。値は initial に戻る", async () => {
    const m = manual();
    const { write, read } = await host("", { q: 1, $stream: { s: { args: (st: any) => st.q, source: m.source, fold: (a: number, c: number) => a + c, initial: 0 } } });
    m.runs[0].push(5);
    await flush();
    expect(read("s")).toBe(5);
    await write((st) => { st.q = 2; });
    expect(m.runs[0].signal.aborted).toBe(true);
    expect(read("s")).toBe(0);
    // the old run's reader was cancelled: its stream takes no more chunks
    expect(() => m.runs[0].push(100)).toThrow();
    m.runs[1].push(7);
    await flush();
    expect(read("s")).toBe(7);
  });

  it("切断で中止して idle、再接続で initial から始め直す", async () => {
    const m = manual();
    const { h, read } = await host("", { $stream: { s: { source: m.source, initial: "-" } } });
    m.runs[0].push("x");
    await flush();
    h.remove();
    await flush();
    expect(m.runs[0].signal.aborted).toBe(true);
    expect(read("$streamStatus.s")).toBe("idle");
    document.body.appendChild(h);
    await flush();
    await flush();
    expect(m.runs.length).toBe(2);
    expect(read("s")).toBe("-");
    expect(read("$streamStatus.s")).toBe("active");
  });

  it("$streamStatus / $streamError は読み取り専用。getter からの読みは依存になる", async () => {
    const m = manual();
    const { el, root, read } = await host(`<p>{{ busy }}</p>`, {
      get busy() { return (this as any)["$streamStatus.s"] === "active" ? "busy" : "idle"; },
      $stream: { s: { source: m.source } },
    });
    expect(root.querySelector("p")!.textContent).toBe("busy");
    expect(() => el.createState("writable", (s: any) => { s["$streamStatus.s"] = "done"; })).toThrow("is read-only");
    m.runs[0].end();
    await flush();
    await flush();
    expect(root.querySelector("p")!.textContent).toBe("idle");
    let direct: unknown;
    el.createState("readonly", (s: any) => { direct = s.$streamStatus.s; });
    expect(direct).toBe(read("$streamStatus.s"));
  });

  it("再開時の args の失敗は error 状態になり、前の依存を書けば回復する", async () => {
    const m = manual();
    const { write, read } = await host("", {
      q: 1, broken: false,
      $stream: { s: { args: (st: any) => { if (st.broken) throw new Error("bad args"); return st.q; }, source: m.source } },
    });
    await write((st) => { st.broken = true; });
    expect(read("$streamStatus.s")).toBe("error");
    expect((read("$streamError.s") as Error).message).toBe("bad args");
    await write((st) => { st.broken = false; });
    expect(read("$streamStatus.s")).toBe("active");
    expect(read("$streamError.s")).toBe(null);
  });

  it.each<[Record<string, any>, string]>([
    [{ s: { args: (st: any) => st.s, source: () => null } }, "must not read the stream itself"],
    [{ s: { args: (st: any) => st["items.*.v"], source: () => null } }, "must not read a wildcard path"],
    [{ s: { args: () => Promise.resolve(1), source: () => null } }, "must be synchronous"],
  ])("始めの args の違反は初期化を失敗させる（%#）", async (decl, message) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`temporal-test-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state>`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState({ items: [{ v: 1 }], $stream: decl });
    document.body.appendChild(h);
    await expect(el.connectedCallbackPromise).rejects.toThrow(message);
    error.mockRestore();
  });

  it.each<[Record<string, any>, string]>([
    [{ $stream: { s: { source: 1 } } }, "needs a source function"],
    [{ $stream: { s: { source: () => null, fold: (a: unknown) => a } } }, "fold needs an initial value"],
    [{ $stream: { "a.b": { source: () => null } } }, "must be a flat property name"],
    [{ s() {}, $stream: { s: { source: () => null } } }, "collides with a getter, setter or method"],
    [{ $streams: {} }, `[wcs/declaration-alias] #1601 "$streams" "$stream"`],
  ])("宣言の違反は状態を受け取る時点で投げる（%#）", async (state, message) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = document.createElement(`temporal-test-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = `<wcs-state></wcs-state>`;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await expect(el.connectedCallbackPromise).rejects.toThrow(message);
    error.mockRestore();
  });
});
