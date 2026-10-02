/**
 * regression-3x-chains.test.ts — @wcstack/state 3.4.0 で直した「書き込みの連鎖の上限」（#338・#353・#354）と
 * 「入れ子のテンプレートの外側の添字」（#360・#390）の回帰テストを、4.0 エンジン（state-next）で流す。
 *
 * 移植元（packages/state/__tests__）: integration.renderChainLimit.test.ts（#338・#353・#354）、
 * watch.watchRuntime.test.ts の #354 で足した部分、integration.nestedOuterIndex.test.ts（#360・#390）、
 * integration.nestedOuterIndexCost.test.ts（#390 — 費用の数は移さず、当て直すべき添字が当て直されることだけ）。
 *
 * 4.0 の上限は 4.0 のもの（src/engine.ts の MAX_DRAIN_PASSES・MAX_RENDER_CHAIN、src/temporal/watch.ts の
 * MAX_CHAIN）。3.x の段数・評価回数そのものではなく、利用者から見える振る舞い — 終わらない連鎖は打ち切られて
 * 1 回だけ報告され、ページが応答し、次の外からの書き込みは普通に描かれる／有限の連鎖は打ち切られない — を
 * 確かめる。`$scan` は 4.0 で廃止（docs/migration-v4.md §1.6）なので、意味のある形だけ `$watch` に書き換えた。
 * 3.x の `$updatedCallback` は 4.0 の `$renderedCallback`（最初の描画では呼ばれない）。
 * 既存の issues*.test.ts が移した Issue の再現手順そのものは重ねない（報告に記す）。
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState, devtools, getBindingsReady, installFeatures, ssr, temporal } from "../src/index";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await flush();
}
let seq = 0;

beforeAll(() => {
  installFeatures([temporal, ssr, devtools]);
  bootstrapState();
});

const HOOK = "__WCSTACK_DEVTOOLS_HOOK__";
let detach: (() => void) | null = null;
/** DevTools のリスナーを付ける。受け取ったイベントの配列を返す（テストの後で外す）。 */
function listen(): any[] {
  const events: any[] = [];
  detach = (globalThis as any)[HOOK].addListener({ onEvent: (_id: string, e: any) => events.push(e) });
  return events;
}

afterEach(() => {
  detach?.();
  detach = null;
  vi.restoreAllMocks();
});

/** A page (a shadow root) with a root `<wcs-state>` over `state`. `write` does not wait. */
async function page(html: string, state: Record<string, any>) {
  const host = document.createElement(`regression-3x-chains-page-${seq++}`);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<wcs-state></wcs-state>${html}`;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(host);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  const write = (fn: (s: any) => void) => { el.createState("writable", fn); };
  const read = (path: string): any => {
    let v: unknown;
    el.createState("readonly", (s: any) => { v = s[path]; });
    return v;
  };
  return { host, root, el, write, read };
}

const texts = (c: ParentNode, sel: string) => Array.from(c.querySelectorAll(sel)).map((n) => n.textContent);
const errorSpy = () => vi.spyOn(console, "error").mockImplementation(() => {});
const watchLimits = (events: any[]) => events.filter((e) => e.type === "state:watch-chain-limit");

// ======================================================================== #338 / #353 / #354 — 連鎖の上限

/** 測定用の評価回数の上限。修正が外れたときにテストをハングさせず落とすため */
const RUNAWAY_CAP = 2000;

/** 出力専用メンバー `status` を持つ要素。`value(n)` の n はインスタンスの連番（1 始まり） */
function defineOutput(value: (n: number) => unknown): string {
  const tag = `regression-3x-chains-out-${seq++}`;
  let instances = 0;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "status", event: `${tag}:status` }] };
    _n = ++instances;
    get status(): unknown { return value(this._n); }
  });
  return tag;
}

/** Issue #338 の形: 一覧 `view` は `mode` に依存し、毎回新しい行オブジェクトを返す */
function loopState(counter: { evals: number }, extra: Record<string, unknown> = {}): any {
  return {
    mode: "init",
    title: "t0",
    rows: [{ k: 1 }, { k: 2 }],
    get view(): any {
      if (++counter.evals > RUNAWAY_CAP) throw new Error("runaway-evals");
      const self = this as any;
      const m = self.mode;
      return self.rows.map((r: object) => ({ ...r, m }));
    },
    ...extra,
  };
}

const loopHtml = (tag: string, key = "mode") =>
  `<p>{{ title }}</p><ul><template data-wcs="for: view"><li><${tag} data-wcs="status: ${key}"></${tag}><span>{{ .m }}</span></li></template></ul>`;

describe("#338 描画が起こす書き込みの終わらない連鎖は打ち切られ、1 回だけ報告され、ページが応答する", () => {
  it("行の要素がインスタンスごとに違う値を一覧の元のキーへ書く: 打ち切った後も止まったままで、次の外からの書き込みは普通に描かれる", async () => {
    const error = errorSpy();
    const tag = defineOutput((n) => `m${n}`);
    const counter = { evals: 0 };
    const { host, root, write } = await page(loopHtml(tag), loopState(counter));
    await settle();

    expect(error).toHaveBeenCalledTimes(1);
    expect(counter.evals).toBeLessThan(RUNAWAY_CAP / 4);
    // 一覧は打ち切った時点の描画のまま残る（2 行とも描かれている）
    expect(root.querySelectorAll("li")).toHaveLength(2);

    // 止まったまま — マクロタスクを挟んでも評価は続かない
    const settled = counter.evals;
    await settle();
    expect(counter.evals).toBe(settled);

    // 次の書き込みは普通に描かれ、一覧を作り直さず、報告も増えない
    write((s) => { s.title = "t1"; });
    await settle();
    expect(root.querySelector("p")!.textContent).toBe("t1");
    expect(counter.evals).toBe(settled);
    expect(error).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("毎回新しいオブジェクトを書く形も打ち切られ、2 行とも描かれる", async () => {
    const error = errorSpy();
    const tag = defineOutput((n) => ({ at: n }));
    const counter = { evals: 0 };
    const { host, root } = await page(loopHtml(tag), loopState(counter));
    await settle();

    expect(error).toHaveBeenCalledTimes(1);
    expect(counter.evals).toBeLessThan(RUNAWAY_CAP / 4);
    expect(root.querySelectorAll("li")).toHaveLength(2);
    host.remove();
  });

  it("バインディングが要素に値を設定したその場で要素が同期に出すイベントの書き込みも連鎖になり、打ち切られる", async () => {
    const error = errorSpy();
    // setter の中で出力イベントを同期に出す要素
    const tag = `regression-3x-chains-sync-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = {
        protocol: "wc-bindable", version: 1,
        properties: [{ name: "status", event: `${tag}:status` }],
        inputs: [{ name: "value" }],
      };
      _status: unknown = 0;
      get status(): unknown { return this._status; }
      set value(v: unknown) {
        this._status = v;
        this.dispatchEvent(new CustomEvent(`${tag}:status`, { detail: v }));
      }
    });
    const counter = { evals: 0 };
    const { host, root, read } = await page(`<${tag} data-wcs="value: a; status: b"></${tag}>`, {
      b: 0,
      // 要素へ渡す値は、要素が返した値 + 1 — 書くたびに新しい値になる
      get a(): number {
        if (++counter.evals > RUNAWAY_CAP) throw new Error("runaway-evals");
        return (this as any).b + 1;
      },
    });
    await settle();

    expect(error).toHaveBeenCalledTimes(1);
    expect(counter.evals).toBeLessThan(RUNAWAY_CAP / 4);
    // 止まったまま。要素が最後に返した値は state の値と同じ
    const settled = counter.evals;
    await settle();
    expect(counter.evals).toBe(settled);
    expect((root.querySelector(tag) as any).status).toBe(read("b"));
    host.remove();
  });

  it("対照: 要素がどれも同じ値を返す形は数回の評価で収束し、報告しない", async () => {
    const error = errorSpy();
    const tag = defineOutput(() => "same");
    const counter = { evals: 0 };
    const { host, root, read } = await page(loopHtml(tag), loopState(counter));
    await settle();

    expect(error).not.toHaveBeenCalled();
    expect(counter.evals).toBeLessThanOrEqual(3);
    expect(read("mode")).toBe("same");
    expect(texts(root, "span")).toEqual(["same", "same"]);
    host.remove();
  });

  it("打ち切った後の作者の書き込みで連鎖は数え直され、同じ循環はもう一度だけ打ち切られる", async () => {
    const error = errorSpy();
    const tag = defineOutput((n) => `m${n}`);
    const counter = { evals: 0 };
    const { host, root, write } = await page(loopHtml(tag), loopState(counter));
    await settle();
    expect(error).toHaveBeenCalledTimes(1);
    const firstEvals = counter.evals;

    write((s) => { s.rows = [{ k: 1 }, { k: 2 }, { k: 3 }]; });
    await settle();

    expect(error).toHaveBeenCalledTimes(2);
    // 続きの深さのまま即座に打ち切る（描画 0 回）のではなく、もう一度描き直してから止まる
    expect(counter.evals - firstEvals).toBeGreaterThan(2);
    expect(counter.evals - firstEvals).toBeLessThan(RUNAWAY_CAP / 4);
    expect(root.querySelectorAll("li")).toHaveLength(3);
    host.remove();
  });

  // 3.x #338 の修正の形が 4.0 で再現しない: 打ち切りは console.error（#11 / #41）にだけ出て、DevTools には何も
  // 流れない（実測 limit の付くイベント 0 件 / 期待 1 件 — 3.x は state:render-chain-limit）。src/engine.ts の
  // drain() は打ち切りの 2 か所（MAX_RENDER_CHAIN の報告・MAX_DRAIN_PASSES の報告）で hooks.noticed を呼ばない
  it.fails("打ち切りが DevTools へ 1 回流れる（3.x: state:render-chain-limit）", async () => {
    errorSpy();
    const events = listen();
    const tag = defineOutput((n) => `m${n}`);
    const counter = { evals: 0 };
    const { host } = await page(loopHtml(tag), loopState(counter));
    await settle();
    host.remove();

    const limits = events.filter((e) => typeof e.type === "string" && /limit|settle/.test(e.type) && e.type !== "state:watch-chain-limit");
    expect(limits).toHaveLength(1);
  });

  it("循環中のパスを $watch が見て別のキーへ書いても打ち切られ、相乗りした $watch の上限は報告しない（#354）", async () => {
    const error = errorSpy();
    const events = listen();
    const tag = defineOutput((n) => `m${n}`);
    const counter = { evals: 0 };
    const { host, root, write, read } = await page(loopHtml(tag), loopState(counter, {
      saved: null,
      $watch: { mode(this: any, current: unknown) { this.saved = current; } },
    }));
    await settle();
    // 読み込み時の循環は $watch の活性化（$connectedCallback の後）より前に打ち切られる（4.0 の $watch は読み込み時の
    // 要素からの初期同期を見ない — issues-misc.test.ts #353 形 2b）。$watch が見ている状態で、書き込みから循環をもう一度起こす
    expect(error).toHaveBeenCalledTimes(1);
    const before = counter.evals;
    write((s) => { s.mode = "kick"; });
    await settle();

    // $watch は毎回発火して別のキーへ書くが、その書き込みは連鎖を伸ばさず、$watch の上限も出ない
    expect(error).toHaveBeenCalledTimes(2);
    expect(watchLimits(events)).toEqual([]);
    expect(counter.evals - before).toBeLessThan(RUNAWAY_CAP / 4);
    expect(root.querySelectorAll("li")).toHaveLength(2);
    expect(read("saved")).toMatch(/^m\d+$/);
    host.remove();
  });

  // 3.x #338 の修正の形が 4.0 で再現しない: 遷移の arbiter が適用を次のマクロタスクへ遅らせると、適用の中の
  // 要素の書き戻しが起こす drain は毎回連鎖 1 段目に戻り、打ち切られずに回り続ける（1 マクロタスクに 1 周なので
  // ページは固まらないが、止まらない。実測 130 マクロタスクで評価 130 回超・報告 0 / 期待 報告 1）。
  // src/engine.ts の drain() が連鎖 1 段目で setTimeout(unchainFn) を仕掛け、マクロタスクを跨ぐと chain を 0 に戻す
  it.fails("ビュー遷移の arbiter が適用を別のマクロタスクへ遅らせても、その適用の中の書き込みは連鎖として数えられ打ち切られる", async () => {
    const RUNNER_KEY = Symbol.for("wcstack.transition-runner");
    const globals = globalThis as unknown as Record<symbol, unknown>;
    globals[RUNNER_KEY] = {
      protocol: "wcs-transition-runner", version: 1, naming: "manual", namingLimit: 200,
      accepts: () => true,
      // 適用を別のマクロタスクへ遅らせる（ビュー遷移の更新コールバック相当）
      run(mutate: () => void): Promise<void> {
        return new Promise((resolve) => { setTimeout(() => { mutate(); resolve(); }, 0); });
      },
    };
    const error = errorSpy();
    // 打ち切られなかったときに後のテストへ持ち越さないための止め金（要素が同じ値を返すようにする）
    let frozen = false;
    const tag = defineOutput((n) => (frozen ? "frozen" : `m${n}`));
    const counter = { evals: 0 };
    let host: HTMLElement | null = null;
    try {
      const loaded = await page(loopHtml(tag), loopState(counter));
      host = loaded.host;
      await settle(130);
      const evals = counter.evals;
      const reports = error.mock.calls.length;
      const rows = loaded.root.querySelectorAll("li").length;
      expect({ reports, rows, bounded: evals < 130 }).toEqual({ reports: 1, rows: 2, bounded: true });
    } finally {
      frozen = true;
      delete globals[RUNNER_KEY];
      host?.remove();
      await settle();
    }
  });
});

describe("#338 有限の連鎖・外から刻む書き込みは打ち切らない（誤検出しない）", () => {
  it("microtask で刻む書き込み（await の続き）で一覧を伸ばし、各行の要素が初期同期で書き戻しても打ち切らない", async () => {
    const error = errorSpy();
    const tag = defineOutput(() => "ready");
    const { host, root, write } = await page(
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>`,
      { rows: [] },
    );
    const count = 200;
    for (let i = 0; i < count; i++) {
      write((s) => { s.rows = [...s.rows, { st: `x${i}` }]; });
      await null;
    }
    await settle();

    expect(error).not.toHaveBeenCalled();
    expect(root.querySelectorAll("li")).toHaveLength(count);
    expect(texts(root, "span")).toEqual(Array(count).fill("ready"));
    host.remove();
  });

  it("$stream が microtask で流す値で一覧を伸ばし、各行の要素が初期同期で書き戻しても打ち切らない", async () => {
    const error = errorSpy();
    const tag = defineOutput(() => "ready");
    const count = 200;
    const { host, root } = await page(
      `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>`,
      {
        $stream: {
          rows: {
            // 待ちの無い async generator — 値は microtask ごとに届く
            source: async function* () { for (let i = 0; i < count; i++) yield { st: `x${i}` }; },
            fold: (acc: unknown[], chunk: unknown) => [...acc, chunk],
            initial: [],
          },
        },
      },
    );
    await settle();

    expect(error).not.toHaveBeenCalled();
    expect(root.querySelectorAll("li")).toHaveLength(count);
    expect(texts(root, "span")).toEqual(Array(count).fill("ready"));
    host.remove();
  });

  it("相互 $watch の連鎖は $watch の上限で打ち切られ、DOM に束ねたパスでも描画の連鎖の上限は報告しない", async () => {
    const error = errorSpy();
    const events = listen();
    let calls = 0;
    const { host, write } = await page(`<p>{{ a }}</p><p>{{ b }}</p>`, {
      a: 0,
      b: 0,
      $watch: {
        a(this: any, current: number) { if (++calls > 1000) return; this.b = current + 1; },
        b(this: any, current: number) { if (++calls > 1000) return; this.a = current + 1; },
      },
    });
    write((s) => { s.a = 1; });
    await settle();

    expect(watchLimits(events)).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(calls).toBeLessThan(100);
    host.remove();
  });

  it("$renderedCallback の書き戻しは、別のマクロタスクから何度来ても連鎖を伸ばさない（タイマーの tick 相当）", async () => {
    const error = errorSpy();
    const { host, root, write } = await page(`<p class="n">{{ n }}</p><p class="echo">{{ echo }}</p>`, {
      n: 0,
      echo: 0,
      $renderedCallback(this: any) { if (this.echo !== this.n) this.echo = this.n; },
    });
    const ticks = 108;
    for (let i = 1; i <= ticks; i++) {
      write((s) => { s.n = i; });
      await flush();
    }
    await settle();

    expect(error).not.toHaveBeenCalled();
    expect(root.querySelector(".echo")!.textContent).toBe(String(ticks));
    host.remove();
  });

  /** `$renderedCallback` が 1 回の描画ごとに 1 つ数え上げる（count を 1 にする作者の書き込みから target まで） */
  async function countUp(target: number) {
    const error = errorSpy();
    const { host, root, write, read } = await page(`<p>{{ count }}</p>`, {
      count: 0,
      target,
      $renderedCallback(this: any) { if (this.count > 0 && this.count < this.target) this.count++; },
    });
    write((s) => { s.count = 1; });
    await settle();
    const result = { text: root.querySelector("p")!.textContent, count: read("count"), reports: error.mock.calls.length };
    host.remove();
    error.mockRestore();
    return result;
  }

  it("上限（100 段）ちょうどの連鎖は打ち切らず、1 段超えると打ち切る — 値は巻き戻さず、描画は 1 つ前のまま", async () => {
    expect(await countUp(101)).toEqual({ text: "101", count: 101, reports: 0 });
    expect(await countUp(102)).toEqual({ text: "101", count: 102, reports: 1 });
  });

  it("文字サイズを 1px ずつ詰めて収める連鎖（64px → 18px・描画 47 回）が最後まで収まる", async () => {
    const error = errorSpy();
    let renders = 0;
    const { host, root, write, read } = await page(`<p class="text">{{ text }}</p><p class="size">{{ size }}</p>`, {
      text: "",
      size: 64,
      fit: 18,
      $renderedCallback(this: any) {
        renders++;
        if (renders > 500) throw new Error("runaway-renders");
        if (this.text !== "" && this.size > this.fit) this.size--;
      },
    });
    renders = 0;
    write((s) => { s.text = "a long heading"; });
    await settle();

    expect(error).not.toHaveBeenCalled();
    expect(renders).toBe(47);
    expect(read("size")).toBe(18);
    expect(root.querySelector(".size")!.textContent).toBe("18");
    host.remove();
  });

  it("400 行を 10 行ずつ段階描画する連鎖（40 段）が最後まで収まる", async () => {
    const error = errorSpy();
    let renders = 0;
    const { host, root, write, read } = await page(`<ul><template data-wcs="for: visible"><li>{{ .id }}</li></template></ul>`, {
      all: Array.from({ length: 400 }, (_, i) => ({ id: i })),
      shown: 0,
      get visible(): unknown[] { const self = this as any; return self.all.slice(0, self.shown); },
      $renderedCallback(this: any) {
        renders++;
        if (renders > 500) throw new Error("runaway-renders");
        if (this.shown < this.all.length) this.shown += 10;
      },
    });
    renders = 0;
    write((s) => { s.shown = 10; });
    await settle();

    expect(error).not.toHaveBeenCalled();
    expect(renders).toBe(40);
    expect(read("shown")).toBe(400);
    expect(root.querySelectorAll("li")).toHaveLength(400);
    host.remove();
  });
});

/**
 * 描いた結果を測って書き（`$renderedCallback` の書き戻し）、測った値を見る `$watch` が 1px 詰める — 64px から `fit` まで。
 * 1 周（書き戻し → `$watch` → 描画）で描画の連鎖が 1 段伸びる（#353）
 */
async function shrinkViaWatch(fit: number) {
  const error = errorSpy();
  const events = listen();
  let renders = 0;
  const { host, root, write, read } = await page(`<p class="text">{{ text }}</p><p class="size">{{ size }}</p><p class="measured">{{ measured }}</p>`, {
    text: "",
    size: 64,
    measured: 0,
    $renderedCallback(this: any) {
      if (++renders > 1000) throw new Error("runaway-renders");
      if (this.text !== "" && this.measured !== this.size) this.measured = this.size;
    },
    $watch: {
      measured(this: any, current: number) { if (current > fit) this.size = current - 1; },
    },
  });
  write((s) => { s.text = "a long heading"; });
  await settle();
  const result = {
    reports: error.mock.calls.length,
    watchLimits: watchLimits(events).length,
    size: read("size"),
    text: root.querySelector(".size")!.textContent,
  };
  host.remove();
  error.mockRestore();
  detach?.();
  detach = null;
  return result;
}

describe("#353 $watch を挟む描画の循環も、描画の連鎖の上限で打ち切られる", () => {
  it("要素の出力 x を $watch が一覧の読む mode へ書く循環を打ち切って 1 回だけ報告し、$watch の上限は出ず、次の外からの書き込みは普通に描かれる", async () => {
    const error = errorSpy();
    const events = listen();
    const tag = defineOutput((n) => `m${n}`);
    const counter = { evals: 0 };
    const { host, root, write } = await page(loopHtml(tag, "x"), loopState(counter, {
      x: "",
      $watch: { x(this: any, current: unknown) { this.mode = current; } },
    }));
    await settle();
    // 4.0 の $watch は読み込み時の要素からの初期同期を見ない（issues-misc.test.ts #353 形 2b）: 書き込みで循環を始める
    write((s) => { s.mode = "kick"; });
    await settle();

    expect(error).toHaveBeenCalledTimes(1);
    expect(watchLimits(events)).toEqual([]);
    expect(counter.evals).toBeLessThan(RUNAWAY_CAP / 4);
    expect(root.querySelectorAll("li")).toHaveLength(2);

    const settled = counter.evals;
    await settle();
    expect(counter.evals).toBe(settled);
    write((s) => { s.title = "t1"; });
    await settle();
    expect(root.querySelector("p")!.textContent).toBe("t1");
    expect(counter.evals).toBe(settled);
    expect(error).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("$watch を挟んで文字サイズを 1px ずつ詰める有限の連鎖（64px → 18px・46 段）が最後まで収まる", async () => {
    expect(await shrinkViaWatch(18)).toEqual({ reports: 0, watchLimits: 0, size: 18, text: "18" });
  });

  it("$watch を挟む連鎖: 99 段は収まり、上限を超える段の書き戻しは打ち切る（値は巻き戻さず、描画は 1 つ前のまま）", async () => {
    expect(await shrinkViaWatch(64 - 99)).toEqual({ reports: 0, watchLimits: 0, size: 64 - 99, text: String(64 - 99) });
    const cut = await shrinkViaWatch(64 - 200);
    expect(cut.reports).toBe(1);
    expect(cut.watchLimits).toBe(0);
    expect(cut.size).toBeGreaterThan(64 - 200);
    expect(Number(cut.text)).toBe(cut.size + 1);
  });

  it("$watch でつないだ有限の描画の連鎖は上限を分け合う — 2 本（47 段 × 2）は収まり、3 本は 3 本目の途中で打ち切られる", async () => {
    async function fitPhases(phases: number) {
      const error = errorSpy();
      const { host, root, el, read } = await page(`<h1>{{ s1 }}</h1><h2>{{ s2 }}</h2><h3>{{ s3 }}</h3><i>{{ phase }}</i>`, {
        go: false, phase: 0, s1: 64, s2: 64, s3: 64, f1: false, f2: false, f3: false,
        $watch: {
          f1(this: any, done: boolean) { if (done && phases >= 2) this.phase = 2; },
          f2(this: any, done: boolean) { if (done && phases >= 3) this.phase = 3; },
        },
        $renderedCallback(this: any) {
          if (!this.go) return;
          const size = `s${this.phase}`;
          const fitted = `f${this.phase}`;
          if (this[size] > 18) this[size] = this[size] - 1;
          else if (!this[fitted]) this[fitted] = true;
        },
      });
      el.createState("writable", (s: any) => { s.go = true; s.phase = 1; });
      await settle(6);
      const result = {
        reports: error.mock.calls.length,
        state: ["s1", "s2", "s3"].map((p) => read(p)),
        dom: ["h1", "h2", "h3"].map((t) => root.querySelector(t)!.textContent),
      };
      host.remove();
      error.mockRestore();
      return result;
    }

    expect(await fitPhases(2)).toEqual({ reports: 0, state: [18, 18, 64], dom: ["18", "18", "64"] });
    // 1 本ずつなら収まる連鎖でも、つなぐと 3 本目の途中で打ち切られる（描画は 1 つ前のまま）
    const three = await fitPhases(3);
    expect(three.reports).toBe(1);
    expect(three.state.slice(0, 2)).toEqual([18, 18]);
    expect(three.state[2]).toBeGreaterThan(18);
    expect(three.state[2]).toBeLessThan(64);
    expect(three.dom).toEqual(["18", "18", String(three.state[2] + 1)]);
  });

  it("$watch の書き込みと描画の書き戻しは、別のマクロタスクから何度来ても連鎖を伸ばさない（タイマーの tick 相当）", async () => {
    const error = errorSpy();
    const { host, root, write } = await page(`<p class="n">{{ n }}</p><p class="echo">{{ echo }}</p><p class="seen">{{ seen }}</p>`, {
      n: 0,
      echo: 0,
      seen: 0,
      $watch: { n(this: any, current: number) { this.echo = current; } },
      $renderedCallback(this: any) { if (this.seen !== this.echo) this.seen = this.echo; },
    });
    const ticks = 108;
    for (let i = 1; i <= ticks; i++) {
      write((s) => { s.n = i; });
      await flush();
    }
    await settle();

    expect(error).not.toHaveBeenCalled();
    expect(root.querySelector(".seen")!.textContent).toBe(String(ticks));
    host.remove();
  });
});

describe("#354 $watch の連鎖の深さは書き込みごと — 有限の描画の連鎖を誤って打ち切らず、本当の循環は打ち切る", () => {
  /** 描いて測って 1px 詰める（64px → 18px・描画 47 回）。測定の代わりに 18 と比べる */
  function shrinkState(extra: Record<string, unknown>): any {
    return {
      text: "",
      size: 64,
      $renderedCallback(this: any) { if (this.text !== "" && this.size > 18) this.size = this.size - 1; },
      ...extra,
    };
  }

  async function run(markup: string, state: any) {
    const error = errorSpy();
    const events = listen();
    const loaded = await page(`<i>{{ text }}</i><h1>{{ size }}</h1>${markup}`, state);
    loaded.write((s) => { s.text = "a long heading"; });
    await settle();
    return { ...loaded, error, events };
  }

  it("（$scan の from を $watch に書き換えた形）描画の連鎖が書き進める size の着地を $watch が数えても、上限を報告せず、どの着地も数える", async () => {
    const { host, read, error } = await run(`<p>{{ steps }}</p>`, shrinkState({
      steps: 0,
      $watch: { size(this: any) { this.steps = this.steps + 1; } },
    }));

    // size は 63 から 18 まで 46 回着地する
    expect(error).not.toHaveBeenCalled();
    expect(read("size")).toBe(18);
    expect(read("steps")).toBe(46);
    host.remove();
  });

  // 3.x #354 の修正の形が 4.0 で再現しない: 描画の書き戻し（$renderedCallback の size）が同じバッチに載っている
  // 間は、相互 $watch の連鎖が毎バッチ 0 段に戻る。書き戻しが止んでから 32 段で打ち切るので、循環が 32 段を
  // 大きく超えて回る（実測 ハンドラ 76 回・報告 1 / 期待 33 回以下）。src/temporal/watch.ts の drained() は
  // 連鎖を「ハンドラの書き込みだけのバッチ」（handlerWrote && !otherWrote）で数え、ほかの書き込みが 1 つでも
  // 相乗りすると chain = 0 にする
  it.fails("相互 $watch の循環は、描画の書き戻しが同じバッチに相乗りしても $watch の上限（32 段）で打ち切られる", async () => {
    let ticks = 0;
    const { host, error, events } = await run(`<p>{{ a }}</p><p>{{ b }}</p>`, shrinkState({
      a: 0,
      b: 0,
      $watch: {
        size(this: any) { if (this.a === 0) this.a = 1; },
        a(this: any, cur: number) { if (++ticks > 1000) return; this.b = cur + 1; },
        b(this: any, cur: number) { if (++ticks > 1000) return; this.a = cur + 1; },
      },
    }));
    host.remove();

    expect(watchLimits(events)).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(ticks).toBeGreaterThan(32 - 2);
    expect(ticks).toBeLessThanOrEqual(32 + 1);
  });

  // `$stream` の再開（args の依存への書き込みで起きる）は drain の終わりで `initial` を書く。その書き込みも
  // 再開を起こした書き込みの連鎖の続きに数えないと、`$watch` が args の依存へ書き、再開の書き込みがまた
  // その `$watch` を起こす循環が、上限に掛からずに回り続ける
  describe("$stream の再開を挟む循環", () => {
    /** 値を出さずに abort を待つ source（再開のたびに abort される） */
    const never = (_args: unknown, signal: AbortSignal) => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
        };
      },
    });
    /** 測定用のハンドラ呼び出しの上限。修正が外れたときにテストをハングさせないため */
    const CAP = 300;

    async function runCycle(declare: (step: () => void) => Record<string, unknown>) {
      const error = errorSpy();
      const events = listen();
      let calls = 0;
      const { host, write } = await page(`<i>{{ go }}</i>`, {
        q: 0,
        go: false,
        $stream: {
          results: { args: (s: any) => s.q, source: never, fold: (acc: unknown[], chunk: unknown) => [...acc, chunk], initial: [] },
        },
        // q を進める（args の依存への書き込み ＝ 再開）。go が立つまでは何もしない
        ...declare(function (this: any) {
          if (!this.go || ++calls > CAP) return;
          this.q = this.q + 1;
        }),
      });
      await settle(2);
      write((s) => { s.go = true; s.q = 100; });
      await settle(6);
      host.remove();
      return { calls, reports: error.mock.calls.length, watchLimits: watchLimits(events).length };
    }

    /** 3.x は 1 周（ハンドラ → 再開 → ハンドラ）2 段で、16 回前後で止まり 1 回報告する。4.0 の段数には依らず「止まる・1 回報告」を見る */
    function expectCut(result: { calls: number; reports: number; watchLimits: number }): void {
      expect(result.calls).toBeLessThanOrEqual(40);
      expect(result.reports).toBe(1);
    }

    // 以下 3 つ: 3.x #354 の修正の形が 4.0 で再現しない: 再開の循環がどちらの上限にも掛からず、ハンドラの止め金
    // （CAP = 300 回）まで microtask だけで回る — その間マクロタスクは 1 つも回らない（ページが固まる。実測
    // ハンドラ 301 回・報告 0 / 期待 40 回以下・報告 1）。再開の書き込み（src/temporal/stream.ts の start() の
    // engine.write(name, initial) と $streamError / $streamStatus）は drain の終わり（hooks.drained）で、ハンドラの
    // 外・feeding の外で書かれる。そのため src/temporal/watch.ts の written() は otherWrote を立てて $watch の連鎖を
    // 0 に戻し、src/engine.ts の write() は codeWrote を立てて描画の連鎖も 0 に戻す
    it.fails("$watch が args の依存へ書き、再開の書き込みがその $watch を起こす循環を打ち切る", async () => {
      expectCut(await runCycle((step) => ({ $watch: { results: step } })));
    });

    it.fails("循環に関係しない $watch の書き込みが相乗りしても、同じく打ち切る", async () => {
      expectCut(await runCycle((step) => ({
        w: 0,
        $watch: { results: step, q(this: any, v: number) { this.w = v; } },
      })));
    });

    it.fails("（$scan を $watch に書き換えた形）再開の書き込みを $watch が数え、その数の $watch が args の依存へ書く循環も打ち切る", async () => {
      expectCut(await runCycle((step) => ({
        count: 0,
        $watch: { results(this: any) { this.count = this.count + 1; }, count: step },
      })));
    });

    // 3.x #354 の修正の形が 4.0 で再現しない: 2 本の再開が互いを起こし続け、args の止め金（CAP = 300 回の評価で
    // 投げる）まで microtask だけで回る — 接続時の起動でもう回り始める（実測 評価 301 回・報告 0 / 期待 40 回以下・
    // 報告 1〜2）。$watch が無いので $watch の上限は関係せず、再開の書き込みは codeWrote として描画の連鎖を
    // 毎 drain 0 に戻す（src/engine.ts の drain() 冒頭）
    it.fails("$stream どうしが args で互いの値を読む循環も、$watch が無くても止まり報告される", async () => {
      const error = errorSpy();
      let evaluations = 0;
      const counted = (read: (s: any) => unknown) => (s: any) => {
        if (++evaluations > CAP) throw new Error("runaway");
        return read(s);
      };
      const { host, write } = await page("", {
        go: 0,
        $stream: {
          a: { args: counted((s) => [s.b, s.go]), source: never, fold: (acc: unknown[], c: unknown) => [...acc, c], initial: [] },
          b: { args: counted((s) => s.a), source: never, fold: (acc: unknown[], c: unknown) => [...acc, c], initial: [] },
        },
      });
      await settle(2);
      evaluations = 0;
      write((s) => { s.go = 1; });
      await settle(6);
      host.remove();

      expect(evaluations).toBeLessThanOrEqual(40);
      expect(error.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(error.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  it("連鎖の途中でハンドラが自分のホストを外しても、残った深さが別の state の次の書き込みの $watch を打ち切らない", async () => {
    const error = errorSpy();
    let hostRef: HTMLElement | null = null;
    const first = await page(`<i>{{ a }}</i>`, {
      a: 0,
      b: 0,
      $watch: {
        // 連鎖が上限に届く前（20 段あたり）にホストを外す
        a(this: any, cur: number) {
          this.b = cur + 1;
          if (cur > 20) hostRef!.remove();
        },
        b(this: any, cur: number) { this.a = cur + 1; },
      },
    });
    hostRef = first.host;
    first.write((s) => { s.a = 1; });
    await settle();
    const reportsAfterFirst = error.mock.calls.length;

    const seen: number[] = [];
    const second = await page("", {
      n: 0,
      $watch: { n(cur: number) { seen.push(cur); } },
    });
    second.write((s) => { s.n = 1; });
    await settle();

    expect(seen).toEqual([1]);
    expect(error.mock.calls.length).toBe(reportsAfterFirst);
    second.host.remove();
  });

  it("（描画の連鎖の形）書き戻しの連鎖の途中で <wcs-state> がページを離れても、別の state の次の書き込みとその書き戻しは普通に描かれる", async () => {
    const error = errorSpy();
    let hostRef: HTMLElement | null = null;
    let renders = 0;
    const first = await page(`<p>{{ n }}</p>`, {
      n: 0,
      $renderedCallback(this: any) {
        if (++renders > 1000) return;
        // 終わらない数え上げ。上限に届く前（50 段あたり）にホストを外す
        if (this.n > 0) this.n = this.n + 1;
        if (this.n > 50) hostRef!.remove();
      },
    });
    hostRef = first.host;
    first.write((s) => { s.n = 1; });
    await settle();
    const reportsAfterFirst = error.mock.calls.length;

    const second = await page(`<p class="a">{{ a }}</p><p class="b">{{ b }}</p>`, {
      a: 0,
      b: 0,
      $renderedCallback(this: any) { if (this.b !== this.a) this.b = this.a; },
    });
    second.write((s) => { s.a = 1; });
    await settle();

    expect(texts(second.root, "p")).toEqual(["1", "1"]);
    expect(error.mock.calls.length).toBe(reportsAfterFirst);
    expect(renders).toBeLessThan(1000);
    second.host.remove();
  });
});

// ======================================================================== #360 / #390 — 入れ子のテンプレートの外側の添字

describe("#360 外側の for の行の位置が変わると、行の中の入れ子のテンプレート（内側の for・if / else・その奥）の $1 も新しい位置になる", () => {
  it("$1 と $2 を並べた形: 外側の反転・同じバッチの内側の入れ替え・同じバッチの内側の反転のどれでも揃う", async () => {
    const { host, root, write } = await page(
      `<template data-wcs="for: groups"><p><template data-wcs="for: .items"><i>{{ .id }}:{{ $1 }}.{{ $2 }}</i></template></p></template>`,
      {
        groups: [
          { n: "a", items: [{ id: 1 }, { id: 2 }, { id: 3 }] },
          { n: "b", items: [{ id: 4 }, { id: 5 }] },
        ],
      },
    );
    const shown = () => texts(root, "i").join(" ");
    expect(shown()).toBe("1:0.0 2:0.1 3:0.2 4:1.0 5:1.1");

    write((s) => { s.groups = [...s.groups].reverse(); });
    await settle(2);
    expect(shown()).toBe("4:0.0 5:0.1 1:1.0 2:1.1 3:1.2");

    // 外側の反転と同じバッチで内側の要素を入れ替える（4.0 の要素の書き込みはその位置の値を置き換える — §3）
    write((s) => {
      const first = s["groups.1.items.0"];
      s["groups.1.items.0"] = s["groups.1.items.2"];
      s["groups.1.items.2"] = first;
      s.groups = [...s.groups].reverse();
    });
    await settle(2);
    expect(shown()).toBe("3:0.0 2:0.1 1:0.2 4:1.0 5:1.1");

    // 外側の反転と同じバッチで内側の配列を反転する
    write((s) => {
      s["groups.0.items"] = [...s["groups.0.items"]].reverse();
      s.groups = [...s.groups].reverse();
    });
    await settle(2);
    expect(shown()).toBe("4:0.0 5:0.1 1:1.0 2:1.1 3:1.2");
    host.remove();
  });

  // 3 段: 外側の行 → if → 中の for → 内側の for。外側の行には else の枝もある
  const DEEP = `<template data-wcs="for: g"><section>` +
    `<template data-wcs="if: .show"><template data-wcs="for: .s"><template data-wcs="for: .t">` +
    `<i data-wcs="textContent: $1"></i><u data-wcs="textContent: $2"></u></template></template></template>` +
    `<template data-wcs="else:"><em data-wcs="textContent: $1"></em></template></section></template>`;
  const deep = () => ({
    g: [
      { show: true, s: [{ t: [{ v: "x" }] }, { t: [{ v: "y" }, { v: "z" }] }] },
      { show: false, s: [{ t: [{ v: "w" }] }] },
    ],
  });

  it("さらに深い入れ子: 外側の反転・先頭への挿入・中の段の反転・先頭の削除の後、どの段の $1 / $2 も今の位置になる", async () => {
    const { host, root, write } = await page(DEEP, deep());
    const shown = () => ({ i: texts(root, "i"), u: texts(root, "u"), em: texts(root, "em") });
    expect(shown()).toEqual({ i: ["0", "0", "0"], u: ["0", "1", "1"], em: ["1"] });

    write((s) => { s.g = [...s.g].reverse(); });
    await settle(2);
    expect(shown()).toEqual({ i: ["1", "1", "1"], u: ["0", "1", "1"], em: ["0"] });

    write((s) => { s.g = [{ show: false, s: [] }, ...s.g]; });
    await settle(2);
    expect(shown()).toEqual({ i: ["2", "2", "2"], u: ["0", "1", "1"], em: ["0", "1"] });

    // 中の段（$2 の軸）の反転は、内側の for の行（$2 を描く）まで当て直す
    write((s) => { s["g.2.s"] = [...s["g.2.s"]].reverse(); });
    await settle(2);
    expect(shown()).toEqual({ i: ["2", "2", "2"], u: ["0", "0", "1"], em: ["0", "1"] });

    write((s) => { s.g = s.g.slice(1); });
    await settle(2);
    expect(shown()).toEqual({ i: ["1", "1", "1"], u: ["0", "0", "1"], em: ["0"] });
    host.remove();
  });

  it("隠れている枝は並べ替えの後に表示したとき、今の位置で描かれる", async () => {
    const { host, root, write } = await page(DEEP, deep());
    const shown = () => ({ i: texts(root, "i"), u: texts(root, "u"), em: texts(root, "em") });

    // 描いたことのある枝を隠してから並べ替え、表示し直す
    write((s) => { s["g.0.show"] = false; });
    await settle(2);
    write((s) => { s.g = [...s.g].reverse(); });
    await settle(2);
    expect(shown()).toEqual({ i: [], u: [], em: ["0", "1"] });

    write((s) => { s["g.1.show"] = true; });
    await settle(2);
    expect(shown()).toEqual({ i: ["1", "1", "1"], u: ["0", "1", "1"], em: ["0"] });
    host.remove();
  });

  it("添字を条件に持つ if（if: $1|eq(0)）は、並べ替えで条件を評価し直す", async () => {
    const { host, root, write } = await page(
      `<template data-wcs="for: groups"><p><template data-wcs="if: $1|eq(0)"><i>{{ .n }}:{{ $1 }}</i></template></p></template>`,
      { groups: [{ n: "a" }, { n: "b" }, { n: "c" }] },
    );
    expect(texts(root, "i")).toEqual(["a:0"]);

    write((s) => { s.groups = [...s.groups].reverse(); });
    await settle(2);
    expect(texts(root, "i")).toEqual(["c:0"]);
    host.remove();
  });

  it("添字を条件に持つ if が真のまま動いた行でも、その中の for の行の $1 を当て直す", async () => {
    const { host, root, write } = await page(
      `<template data-wcs="for: groups"><p><template data-wcs="if: $1|lt(2)">` +
      `<template data-wcs="for: .items"><i>{{ . }}:{{ $1 }}</i></template></template></p></template>`,
      { groups: [{ items: [1, 2] }, { items: [3] }, { items: [4] }] },
    );
    expect(texts(root, "i")).toEqual(["1:0", "2:0", "3:1"]);

    // 0 行目と 1 行目を入れ替える（どちらも条件は真のまま）
    write((s) => { s.groups = [s.groups[1], s.groups[0], s.groups[2]]; });
    await settle(2);
    expect(texts(root, "i")).toEqual(["3:0", "1:1", "2:1"]);

    // 条件が偽になる行・真になる行が出る並べ替え
    write((s) => { s.groups = [s.groups[2], s.groups[1], s.groups[0]]; });
    await settle(2);
    expect(texts(root, "i")).toEqual(["4:0", "1:1", "2:1"]);
    host.remove();
  });

  it("添字を条件に持つ elseif（elseif: $1|eq(0)）は、並べ替え・先頭への挿入で条件を評価し直す", async () => {
    const { host, root, write } = await page(
      `<template data-wcs="for: groups"><p><template data-wcs="if: .hot"><b>{{ .n }}</b></template>` +
      `<template data-wcs="elseif: $1|eq(0)"><i>{{ .n }}:{{ $1 }}</i></template></p></template>`,
      { groups: [{ n: "a", hot: false }, { n: "b", hot: true }, { n: "c", hot: false }] },
    );
    expect(texts(root, "b")).toEqual(["b"]);
    expect(texts(root, "i")).toEqual(["a:0"]);

    write((s) => { s.groups = [...s.groups].reverse(); });
    await settle(2);
    expect(texts(root, "b")).toEqual(["b"]);
    expect(texts(root, "i")).toEqual(["c:0"]);

    write((s) => { s.groups = [{ n: "d", hot: false }, ...s.groups]; });
    await settle(2);
    expect(texts(root, "i")).toEqual(["d:0"]);
    host.remove();
  });

  it("if / elseif の後の else の枝だけに書いた $1 も、並べ替えの後に今の位置になる", async () => {
    const { host, root, write } = await page(
      `<template data-wcs="for: groups"><p><template data-wcs="if: .x"><b>{{ .n }}</b></template>` +
      `<template data-wcs="elseif: .y"><u>{{ .n }}</u></template>` +
      `<template data-wcs="else:"><i>{{ .n }}:{{ $1 }}</i></template></p></template>`,
      { groups: [{ n: "a", x: false, y: false }, { n: "b", x: true, y: false }, { n: "c", x: false, y: false }] },
    );
    expect(texts(root, "i")).toEqual(["a:0", "c:2"]);

    write((s) => { s.groups = [...s.groups].reverse(); });
    await settle(2);
    expect(texts(root, "i")).toEqual(["c:0", "a:2"]);
    expect(texts(root, "b")).toEqual(["b"]);
    host.remove();
  });
});

// ---------------------------------------------------------------- SSR（サーバー描画 → ハイドレーション）と CSR の対照

/** Renders `html` as the server does (orchestrated: the snapshot builder runs last); its HTML. */
async function serverRender(html: string, state: Record<string, any>): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  try {
    const h = document.createElement(`regression-3x-chains-server-${seq++}`);
    const root = h.attachShadow({ mode: "open" });
    root.innerHTML = html;
    const el = root.querySelector("wcs-state") as any;
    el.setInitialState(state);
    document.body.appendChild(h);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    await flush();
    await flush();
    (globalThis as any)[Symbol.for("wcstack.ssr.snapshotBuilder")].build(root);
    const out = root.innerHTML;
    h.remove();
    return out;
  } finally {
    document.documentElement.removeAttribute("data-wcs-server");
  }
}

/** Loads `html` (a server output, or a client markup) on the client. */
async function clientLoad(html: string, state: Record<string, any>) {
  const host = document.createElement(`regression-3x-chains-client-${seq++}`);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(host);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  await flush();
  await flush();
  return { host, root, el };
}

type Step = (s: any) => void;

/** 読み込み（CSR なら描画、SSR ならハイドレーション）→ 書き込みを 1 つずつ流し、観測と失敗の報告を集める */
async function runSteps(html: string, make: () => any, steps: Step[], observe: (root: ParentNode) => unknown) {
  const errors: string[] = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  const { host, root, el } = await clientLoad(html, make());
  try {
    const views = [observe(root)];
    for (const step of steps) {
      el.createState("writable", step);
      await settle(2);
      views.push(observe(root));
    }
    return { views, errors };
  } finally {
    host.remove();
    vi.restoreAllMocks();
  }
}

async function compare(markup: string, make: () => any, steps: Step[], observe: (root: ParentNode) => unknown) {
  const csr = await runSteps(`<wcs-state></wcs-state>${markup}`, make, steps, observe);
  const html = await serverRender(`<wcs-state enable-ssr></wcs-state>${markup}`, make());
  expect(html).toContain("<wcs-ssr");
  const ssrRun = await runSteps(html, make, steps, observe);
  return { csr, ssr: ssrRun };
}

describe("#360 SSR ハイドレーション後も、行の中の入れ子の $1 は CSR と同じく並べ替えに追従し、失敗を報告しない", () => {
  it("行の中の if / else の枝: 切り替え → 並べ替え → 隠れていた枝の表示 → 先頭への挿入", async () => {
    const MARKUP = `<template data-wcs="for: groups"><p>` +
      `<b data-wcs="textContent: $1"></b>` +
      `<template data-wcs="if: .show"><i data-wcs="textContent: $1"></i></template>` +
      `<template data-wcs="else:"><s data-wcs="textContent: $1"></s></template></p></template>`;
    const make = (): any => ({ groups: [{ show: true }, { show: true }, { show: false }] });
    const observe = (root: ParentNode): unknown => ({ b: texts(root, "b"), i: texts(root, "i"), s: texts(root, "s") });
    const { csr, ssr: ssrRun } = await compare(MARKUP, make, [
      (s) => { s.groups = [...s.groups].reverse(); },
      // SSR で描いた枝を隠し、SSR で描かなかった枝を表示する
      (s) => { s["groups.0.show"] = true; s["groups.2.show"] = false; },
      (s) => { s.groups = [...s.groups].reverse(); },
      // 隠したまま動いた、SSR で描いた枝を表示し直す
      (s) => { s["groups.0.show"] = true; },
      (s) => { s.groups = [{ show: false }, ...s.groups]; },
    ], observe);

    expect(csr.views).toEqual([
      { b: ["0", "1", "2"], i: ["0", "1"], s: ["2"] },
      { b: ["0", "1", "2"], i: ["1", "2"], s: ["0"] },
      { b: ["0", "1", "2"], i: ["0", "1"], s: ["2"] },
      { b: ["0", "1", "2"], i: ["1", "2"], s: ["0"] },
      { b: ["0", "1", "2"], i: ["0", "1", "2"], s: [] },
      { b: ["0", "1", "2", "3"], i: ["1", "2", "3"], s: ["0"] },
    ]);
    expect(ssrRun.views).toEqual(csr.views);
    expect(ssrRun.errors).toEqual([]);
    expect(csr.errors).toEqual([]);
  });

  it("入れ子の for の内側の行の $1 も、外側の並べ替え・先頭への挿入で CSR と同じになる", async () => {
    const MARKUP = `<template data-wcs="for: groups"><p>` +
      `<template data-wcs="for: .items"><i data-wcs="textContent: $1"></i></template></p></template>`;
    const make = (): any => ({ groups: [{ items: [{ id: 1 }, { id: 2 }] }, { items: [{ id: 3 }] }] });
    const observe = (root: ParentNode): unknown => texts(root, "i");
    const { csr, ssr: ssrRun } = await compare(MARKUP, make, [
      (s) => { s.groups = [...s.groups].reverse(); },
      (s) => { s.groups = [{ items: [{ id: 0 }] }, ...s.groups]; },
    ], observe);

    expect(csr.views).toEqual([["0", "0", "1"], ["0", "1", "1"], ["0", "1", "2", "2"]]);
    expect(ssrRun.views).toEqual(csr.views);
    expect(ssrRun.errors).toEqual([]);
  });
});

describe("#390 外側の行が動いたとき、当て直すべき入れ子の添字だけでなく、それが当て直されること（費用は移さない）", () => {
  const ROWS = 20;
  const rows = <T>(make: (n: number) => T): T[] => Array.from({ length: ROWS }, (_, n) => make(n));

  it("行に $1 のある入れ子（for: .a）と無い入れ子（for: .b）が並ぶ: 先頭に足すと $1 のある方が新しい位置になり、無い方の値はそのまま", async () => {
    const { host, root, write } = await page(
      `<template data-wcs="for: rows"><div>` +
      `<template data-wcs="for: .a"><i>{{ .v }}:{{ $1 }}</i></template>` +
      `<template data-wcs="for: .b"><u>{{ .v }}</u></template></div></template>`,
      { rows: rows((n) => ({ n, a: [{ v: 1 }, { v: 2 }, { v: 3 }], b: [{ v: 4 }, { v: 5 }, { v: 6 }] })) },
    );
    write((s) => { s.rows = [{ n: -1, a: [], b: [] }, ...s.rows]; });
    await settle(2);

    expect(texts(root, "i").slice(0, 3)).toEqual(["1:1", "2:1", "3:1"]);
    expect(texts(root, "i").slice(-1)).toEqual([`3:${ROWS}`]);
    expect(texts(root, "u")).toEqual(rows(() => ["4", "5", "6"]).flat());
    host.remove();
  });

  it("$1 が elseif の否定の枝（else）の奥にだけあっても、先頭を消すと今の位置になる", async () => {
    const { host, root, write } = await page(
      `<template data-wcs="for: rows"><div><template data-wcs="if: .x"><b>{{ .n }}</b></template>` +
      `<template data-wcs="elseif: .y"><u>{{ .n }}</u></template>` +
      `<template data-wcs="else:"><i>{{ .n }}:{{ $1 }}</i></template></div></template>`,
      { rows: rows((n) => ({ n, x: false, y: false })) },
    );
    write((s) => { s.rows = s.rows.slice(1); });
    await settle(2);

    expect(texts(root, "i").slice(0, 2)).toEqual(["1:0", "2:1"]);
    expect(texts(root, "i")).toHaveLength(ROWS - 1);
    host.remove();
  });

  it("内側の行が自分の番号（$2）だけを描く形: 外側の先頭に足しても内側の番号は変わらず、内側の並べ替えでは当て直される", async () => {
    const { host, root, write } = await page(
      `<template data-wcs="for: rows"><div>{{ .n }}<template data-wcs="for: .it"><i>{{ .v }}:{{ $2 }}</i></template></div></template>`,
      { rows: rows((n) => ({ n, it: [{ v: 1 }, { v: 2 }, { v: 3 }] })) },
    );
    write((s) => { s.rows = [{ n: -1, it: [{ v: 9 }] }, ...s.rows]; });
    await settle(2);
    expect(texts(root, "i").slice(0, 7)).toEqual(["9:0", "1:0", "2:1", "3:2", "1:0", "2:1", "3:2"]);

    write((s) => { s["rows.1.it"] = [...s["rows.1.it"]].reverse(); });
    await settle(2);
    expect(texts(root, "i").slice(1, 4)).toEqual(["3:0", "2:1", "1:2"]);
    host.remove();
  });

  // 3 段: g（$1）→ s（$2）→ 内側の for が 3 つ（a の行は $3 だけ、b の行は $2、c の行は $1）
  const MIXED = `<template data-wcs="for: g"><section><h2>{{ $1 }}</h2>` +
    `<template data-wcs="for: .s"><div><h3>{{ $2 }}</h3>` +
    `<template data-wcs="for: .a"><i>{{ $3 }}</i></template>` +
    `<template data-wcs="for: .b"><em>{{ $2 }}</em></template>` +
    `<template data-wcs="for: .c"><s>{{ $1 }}</s></template></div></template></section></template>`;
  const mixed = () => ({
    g: [0, 1].map(() => ({ s: [0, 1, 2].map(() => ({ a: [{}, {}], b: [{}, {}], c: [{}, {}] })) })),
  });
  const shownMixed = (root: ParentNode) => ({
    h2: texts(root, "h2").join(""), h3: texts(root, "h3").join(""),
    i: texts(root, "i").join(""), em: texts(root, "em").join(""), s: texts(root, "s").join(""),
  });

  it("$1 / $2 / $3 が混ざる 3 段: 中の段の反転で $2 が、外側の反転で $1 が今の位置になる", async () => {
    const { host, root, write } = await page(MIXED, mixed());
    write((s) => { s["g.0.s"] = [...s["g.0.s"]].reverse(); });
    await settle(2);
    expect(shownMixed(root)).toEqual({
      h2: "01", h3: "012012", i: "01".repeat(6), em: "001122001122", s: "0".repeat(6) + "1".repeat(6),
    });

    // 外側で目印を付けて（g.0 の中の段を 1 行増やす）、反転したことを見分ける
    write((s) => { s["g.0.s"] = [...s["g.0.s"], { a: [], b: [], c: [] }]; });
    await settle(2);
    write((s) => { s.g = [...s.g].reverse(); });
    await settle(2);
    expect(shownMixed(root)).toEqual({
      h2: "01", h3: "0120123", i: "01".repeat(6), em: "001122001122", s: "0".repeat(6) + "1".repeat(6),
    });
    host.remove();
  });

  it("SSR ハイドレーション後: 行の中の if の枝に $1 が無ければ値のまま並べ替わり、$1 があれば今の位置になる（CSR と同じ）", async () => {
    const make = (): any => ({ rows: Array.from({ length: 6 }, (_, n) => ({ n, show: true })) });
    const reverse: Step = (s) => { s.rows = [...s.rows].reverse(); };
    const observe = (root: ParentNode): unknown => texts(root, "i");

    const plain = await compare(`<template data-wcs="for: rows"><p>` +
      `<template data-wcs="if: .show"><i data-wcs="textContent: .n"></i></template></p></template>`, make, [reverse], observe);
    expect(plain.ssr.views).toEqual([["0", "1", "2", "3", "4", "5"], ["5", "4", "3", "2", "1", "0"]]);
    expect(plain.ssr.views).toEqual(plain.csr.views);
    expect(plain.ssr.errors).toEqual([]);

    const indexed = await compare(`<template data-wcs="for: rows"><p>` +
      `<template data-wcs="if: .show"><i data-wcs="textContent: $1"></i></template></p></template>`, make, [reverse], observe);
    expect(indexed.ssr.views).toEqual([["0", "1", "2", "3", "4", "5"], ["0", "1", "2", "3", "4", "5"]]);
    expect(indexed.ssr.views).toEqual(indexed.csr.views);
    expect(indexed.ssr.errors).toEqual([]);
  });
});
