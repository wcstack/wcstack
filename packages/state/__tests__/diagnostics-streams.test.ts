/**
 * diagnostics-streams.test.ts — 流れてくるデータの沈黙（docs/seam-apps.md、counter-assist。4.33、v4-direction §5.29）:
 *   - $stream の失敗を誰も読まない（wcs/stream-error-unobserved）・source が流れを返さない（wcs/stream-source-shape）
 *   - fold が受け取った値をその場で変えて返す（wcs/stream-fold-in-place）・流れている値への書き込み（wcs/stream-value-written）
 *   - eventToken が名指すイベントが束縛より先に出ていた（wcs/event-before-binding）
 * どれも同じ種類・名前で 1 回（モジュールの集合に残る）: テストごとに名前を変える。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, diagnostics, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

beforeAll(() => {
  installFeatures([diagnostics, temporal]);
  bootstrapState();
});

async function page(html: string, state: Record<string, any>, before?: (root: ShadowRoot) => void) {
  const h = document.createElement(`diag-stream-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  before?.(root);
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
  return { h, root, el, write };
}

/** The warnings `run` leads to (console.warn, first argument) whose code starts with `code`. */
async function warnings(code: string, run: () => Promise<unknown>): Promise<string[]> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await run();
    await flush();
    return warn.mock.calls.map((c) => String(c[0])).filter((w) => w.includes(`[wcs/${code}`));
  } finally {
    warn.mockRestore();
    error.mockRestore();
  }
}

/** A source whose runs the test drives (a ReadableStream per run). */
function manual() {
  const runs: { push: (v: unknown) => void; end: () => void; fail: (e: unknown) => void }[] = [];
  const source = () => new ReadableStream({
    start(c) {
      runs.push({ push: (v) => c.enqueue(v), end: () => c.close(), fail: (e) => c.error(e) });
    },
  });
  return { runs, source };
}

describe("$stream の失敗を誰も読まない（wcs/stream-error-unobserved）", () => {
  it("$streamError / $streamStatus を束縛も getter も読まなければ、名前ごとに 1 回、失敗の文面と直し方を付けて知らせる", async () => {
    const m = manual();
    const got = await warnings("stream-error-unobserved", async () => {
      const { write } = await page(`<p>{{ answerA }}</p>`, { q: 1, $stream: { answerA: { args: (s: any) => s.q, source: m.source } } });
      m.runs[0].fail(new Error("Failed to fetch"));
      await flush();
      // the second failure of the same stream is not told again
      await write((s) => { s.q = 2; });
      m.runs[1].fail(new Error("again"));
      await flush();
    });
    expect(got).toEqual([
      `[@wcstack/state] [wcs/stream-error-unobserved] $stream "answerA" failed: "Failed to fetch" — and nothing reads it: no binding or getter reads $streamError.answerA or $streamStatus.answerA, so the page goes on showing what was folded. Bind $streamError.answerA (textContent: $streamError.answerA) and show it.`,
    ]);
  });

  it("$streamStatus を束ねる・$streamError を getter で読むページには言わない", async () => {
    const m = manual();
    const n = manual();
    const got = await warnings("stream-error-unobserved", async () => {
      await page(`<p>{{ $streamStatus.answerB }}</p>`, { $stream: { answerB: { source: m.source } } });
      await page(`<p>{{ failed }}</p>`, {
        get failed() { return (this as any)["$streamError.answerC"] !== null; },
        $stream: { answerC: { source: n.source } },
      });
      m.runs[0].fail(new Error("x"));
      n.runs[0].fail(new Error("y"));
      await flush();
    });
    expect(got).toEqual([]);
  });

  it("message の無い失敗（投げた文字列）はそのまま書く", async () => {
    const got = await warnings("stream-error-unobserved", async () => {
      await page("", { $stream: { answerQ: { source: () => { throw "down"; } } } });
      await flush();
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toContain(`$stream "answerQ" failed: "down"`);
  });

  it("再開の args の失敗も知らせる", async () => {
    const got = await warnings("stream-error-unobserved", async () => {
      const { write } = await page("", {
        broken: false,
        $stream: { answerD: { args: (s: any) => { if (s.broken) throw new Error("bad args"); return 1; }, source: manual().source } },
      });
      await write((s) => { s.broken = true; });
    });
    expect(got).toHaveLength(1);
    expect(got[0]).toContain(`$stream "answerD" failed: "bad args"`);
  });
});

describe("source が流れを返さない（wcs/stream-source-shape）", () => {
  it("Response を返したら、失敗を読んでいても知らせ、body を返すよう言う（失敗を読まない知らせとは重ねない）", async () => {
    const got = await warnings("stream-", async () => {
      await page(`<p>{{ $streamError.answerE }}</p>`, { $stream: { answerE: { source: async () => new Response("x") } } });
      await page("", { $stream: { answerF: { source: async () => new Response("x") } } });
      await flush();
    });
    expect(got).toEqual([
      `[@wcstack/state] [wcs/stream-source-shape] The source of $stream "answerE" returned Response, neither an async iterable nor a ReadableStream: every run fails at once. Return its body (response.body).`,
      `[@wcstack/state] [wcs/stream-source-shape] The source of $stream "answerF" returned Response, neither an async iterable nor a ReadableStream: every run fails at once. Return its body (response.body).`,
    ]);
  });

  it("undefined（return 忘れ）・配列にはそれぞれの文面", async () => {
    const got = await warnings("stream-source-shape", async () => {
      await page("", { $stream: { answerG: { source: () => undefined }, answerH: { source: () => [1, 2] } } });
      await flush();
    });
    expect(got).toEqual([
      `[@wcstack/state] [wcs/stream-source-shape] The source of $stream "answerG" returned undefined, neither an async iterable nor a ReadableStream: every run fails at once. Return the stream (a missing return?).`,
      `[@wcstack/state] [wcs/stream-source-shape] The source of $stream "answerH" returned Array, neither an async iterable nor a ReadableStream: every run fails at once.`,
    ]);
    const bare = await warnings("stream-source-shape", async () => {
      await page("", { $stream: { answerR: { source: () => Object.create(null) } } });
      await flush();
    });
    expect(bare[0]).toContain(`"answerR" returned object,`);
  });
});

describe("fold が受け取った値をその場で変えて返す（wcs/stream-fold-in-place）", () => {
  it("配列に push して返す・オブジェクトに書いて返す fold を 1 回ずつ知らせる", async () => {
    const m = manual();
    const got = await warnings("stream-fold-in-place", async () => {
      await page("", {
        $stream: {
          listI: { source: m.source, fold: (acc: number[], c: number) => { acc.push(c); return acc; }, initial: [] },
          objJ: { source: m.source, fold: (acc: any, c: number) => Object.assign(acc, { last: c }), initial: {} },
        },
      });
      for (const r of m.runs) { r.push(1); r.push(2); }
      await flush();
    });
    expect(got).toEqual([
      `[@wcstack/state] [wcs/stream-fold-in-place] The fold of $stream "listI" changed its accumulator in place and returned it: list diffing and $watch's prev compare it with itself. Return a new value ([...acc, chunk], { ...acc, key: chunk }).`,
      expect.stringContaining(`$stream "objJ" changed its accumulator in place`),
    ]);
  });

  it("新しい値を返す fold・塊を飛ばして受け取った値をそのまま返す fold・文字列の fold には言わない", async () => {
    const m = manual();
    const got = await warnings("stream-fold-in-place", async () => {
      await page("", {
        $stream: {
          listK: { source: m.source, fold: (acc: number[], c: number) => [...acc, c], initial: [] },
          skipL: { source: m.source, fold: (acc: number[], c: number) => (c < 0 ? acc : [...acc, c]), initial: [] },
          textM: { source: m.source, fold: (acc: string, c: string) => acc + c, initial: "" },
          mapN: { source: m.source, fold: (acc: Map<number, number>, c: number) => (c < 0 ? acc : new Map(acc).set(c, c)), initial: new Map() },
        },
      });
      for (const r of m.runs) { r.push(-1); r.push(1); r.push(-1); }
      await flush();
    });
    expect(got).toEqual([]);
  });

  it("Map に set して返す fold も知らせる（大きさが変わる）", async () => {
    const m = manual();
    const got = await warnings("stream-fold-in-place", async () => {
      await page("", { $stream: { mapO: { source: m.source, fold: (acc: Map<number, number>, c: number) => acc.set(c, c), initial: new Map() } } });
      m.runs[0].push(1);
      await flush();
    });
    expect(got).toHaveLength(1);
  });
});

describe("流れている値への書き込み（wcs/stream-value-written）", () => {
  it("流れている間に値を書くと 1 回知らせ、止めるには args を null にと言う。流れが終わった後の書き込み・ランタイム自身の書き込みには言わない", async () => {
    const m = manual();
    const got = await warnings("stream-value-written", async () => {
      const { write } = await page("", { $stream: { answerP: { source: m.source, fold: (a: string, c: string) => a + c, initial: "" } } });
      m.runs[0].push("a");
      await flush();
      await write((s) => { s.answerP = ""; });
      await write((s) => { s.answerP = "x"; });
      m.runs[0].end();
      await flush();
      await write((s) => { s.answerP = "cleared"; });
    });
    expect(got).toEqual([
      `[@wcstack/state] [wcs/stream-value-written] "answerP" was written while $stream "answerP" runs: the stream goes on, and its next chunk folds on top of what was written. To stop it, make args return null (it keeps what it folded); to start over, change what args reads.`,
    ]);
  });
});

describe("束縛より先に出たイベント（wcs/event-before-binding）", () => {
  const BINDABLE = { protocol: "wc-bindable", version: 1, properties: [
    { name: "message", event: "evt-src:message", semantics: "event" },
    { name: "connected", event: "evt-src:connected" },
  ] };
  beforeAll(() => {
    customElements.define("evt-src", class extends HTMLElement {
      static wcBindable = BINDABLE;
      message: unknown = null;
      connected = false;
      receive(v: unknown): void {
        this.message = v;
        this.dispatchEvent(new CustomEvent("evt-src:message", { detail: v }));
      }
    });
  });

  it("eventToken が名指す出力（semantics: event）を束ねる前から要素が持っていれば、タグと出力ごとに 1 回知らせる", async () => {
    const got = await warnings("event-before-binding", async () => {
      for (let i = 0; i < 2; i++) {
        await page(`<evt-src data-wcs="eventToken.message: snapshot"></evt-src>`, { $eventTokens: ["snapshot"], $on: { snapshot() {} } },
          (root) => (root.querySelector("evt-src") as any).receive({ waiting: 8 }));
      }
    });
    expect(got).toEqual([
      `[@wcstack/state] [wcs/event-before-binding] <evt-src> dispatched message before @wcstack/state bound the page, and eventToken.message never sees that event (the element holds it). Let the state start the element — give it what starts it from the state (url: path), so it starts once the page is bound — or bind the output too (message: path takes what the element holds). See docs/timing-and-firing-contract.md §31.`,
    ]);
  });

  it("束ねた後のイベント・semantics が event でない出力・プロパティの束縛には言わない", async () => {
    const got = await warnings("event-before-binding", async () => {
      const { root } = await page(`<evt-src data-wcs="eventToken.message: snap2"></evt-src>`, { $eventTokens: ["snap2"], $on: { snap2() {} } });
      (root.querySelector("evt-src") as any).receive(1);
      await page(`<evt-src data-wcs="eventToken.connected: up"></evt-src>`, { $eventTokens: ["up"], $on: { up() {} } },
        (r) => { (r.querySelector("evt-src") as any).connected = true; });
      await page(`<evt-src data-wcs="message: last"></evt-src>`, { last: null },
        (r) => (r.querySelector("evt-src") as any).receive(2));
    });
    expect(got).toEqual([]);
  });

  it("定義されていない要素は飛ばす", async () => {
    const got = await warnings("event-before-binding", async () => {
      await page(`<later-src data-wcs="eventToken.message: snap5"></later-src>`, { $eventTokens: ["snap5"] });
    });
    expect(got).toEqual([]);
  });

  it("読めない data-wcs は飛ばす（その誤りは束ねるときに core が報告する）", async () => {
    const got = await warnings("event-before-binding", async () => {
      await page(`<evt-src data-wcs="eventToken.message: snap4|"></evt-src>`, { $eventTokens: ["snap4"] },
        (r) => (r.querySelector("evt-src") as any).receive(3)).catch(() => {});
    });
    expect(got).toEqual([]);
  });
});
