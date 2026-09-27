/**
 * integration.renderChainLimit.test.ts — 描画起点の書き込み連鎖の上限（#338・MAX_RENDER_CHAIN_DEPTH）。
 *
 * getter で作る一覧を `for:` で描き、行の中の wc-bindable 要素の出力を、その getter が依存するルートの
 * キーへ束ねる。要素ごとに違う値を返すと、書き込み → getter の再評価 → 行の描き直し → 要素からの
 * 書き込み（行を作るときの初期同期）が microtask で回り続け、ページが固まっていた。hop 上限
 * （1 transaction の中）も `$watch` の連鎖上限（ハンドラ起点だけ）もこの連鎖を数えない。
 *
 * updater は binding の適用の最中に起きた書き込みだけを「次のバッチはこの連鎖の続き」と数え、
 * drain の外から来た書き込みで数え直す。上限を超えたバッチは binding を適用せずに報告する。
 * 後半は誤検出しないことの番人 — 正当な連鎖（microtask で刻む書き手・`$watch` の連鎖・
 * `$renderedCallback` の書き戻し・上限ちょうどの連鎖・32 段を超えて有限で収まる連鎖）を止めない。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { MAX_RENDER_CHAIN_DEPTH } from "../src/define";
import { setDevtoolsSink } from "../src/platform/devtoolsSink";
import { TRANSITION_RUNNER_KEY } from "../src/protocol/transitionRunner";

beforeAll(() => {
  bootstrapState();
});

const RENDER_LIMIT_MESSAGE = "render chain depth limit exceeded";
/** 測定用の評価回数の上限。修正が外れたときにテストをハングさせず落とすため（Issue の再現と同じ） */
const RUNAWAY_CAP = 2000;

let seq = 0;
const macro = () => new Promise((r) => setTimeout(r, 0));
async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await macro();
  }
}

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`render-chain-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  return { host, shadowRoot, stateEl };
}

/** 出力専用メンバー `status` を持つ要素。`value(n)` の n はインスタンスの連番（1 始まり） */
function defineOutput(value: (n: number) => unknown): string {
  const tag = `x-render-chain-${seq++}`;
  let instances = 0;
  customElements.define(tag, class extends HTMLElement {
    static wcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [{ name: "status", event: `${tag}:status` }],
    };
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
    get view(this: any) {
      if (++counter.evals > RUNAWAY_CAP) throw new Error("runaway-evals");
      const m = this.mode;
      return this.rows.map((r: any) => ({ ...r, m }));
    },
    ...extra,
  };
}

function loopHtml(tag: string): string {
  return `<p>{{ title }}</p>`
    + `<ul><template data-wcs="for: view"><li><${tag} data-wcs="status: mode"></${tag}><span>{{ .m }}</span></li></template></ul>`;
}

function read(stateEl: State, path: string): unknown {
  let value: unknown;
  stateEl.createState("readonly", (state: any) => { value = state[path]; });
  return value;
}

function write(stateEl: State, path: string, value: unknown): void {
  stateEl.createState("writable", (state: any) => { state[path] = value; });
}

let errorSpy: ReturnType<typeof vi.spyOn>;

function renderChainReports(): unknown[][] {
  return errorSpy.mock.calls.filter((call: unknown[]) => String(call[0]).includes(RENDER_LIMIT_MESSAGE));
}

describe("描画起点の書き込み連鎖の上限（#338）", () => {
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("行の要素がインスタンスごとに違う値を一覧の元のキーへ書くと、上限で打ち切って 1 回だけ報告し、ページが応答すること", async () => {
    const tag = defineOutput((n) => `m${n}`);
    const counter = { evals: 0 };
    let renders = 0;
    const { host, shadowRoot, stateEl } = await mount(
      loopState(counter, { $renderedCallback() { renders++; } }),
      loopHtml(tag),
    );
    await settle();

    const reports = renderChainReports();
    expect(reports).toHaveLength(1);
    // README の表・出力例と同じ値（hop / `$watch` の 32 とは単位が違う — define.ts）
    expect(MAX_RENDER_CHAIN_DEPTH).toBe(100);
    expect(reports[0][1]).toEqual({
      maxDepth: MAX_RENDER_CHAIN_DEPTH,
      paths: expect.arrayContaining(["mode", "view"]),
    });
    // 上限まで回ってから止まる（修正前は RUNAWAY_CAP まで評価が続いた。実測 評価 104 回 / 描画 102 回）
    expect(counter.evals).toBeGreaterThan(MAX_RENDER_CHAIN_DEPTH);
    expect(counter.evals).toBeLessThanOrEqual(MAX_RENDER_CHAIN_DEPTH + 4);
    expect(renders).toBeLessThanOrEqual(MAX_RENDER_CHAIN_DEPTH + 2);
    // 一覧は打ち切った時点の描画のまま残る
    expect(shadowRoot.querySelectorAll("li")).toHaveLength(2);

    // 止まったまま — マクロタスクを挟んでも評価は続かない
    const settled = counter.evals;
    await settle();
    expect(counter.evals).toBe(settled);

    // 次の書き込みは深さ 0 から普通に描かれる
    write(stateEl, "title", "t1");
    await settle();
    expect(shadowRoot.querySelector("p")!.textContent).toBe("t1");
    expect(counter.evals).toBe(settled);
    expect(renderChainReports()).toHaveLength(1);
    host.remove();
  });

  it("毎回新しいオブジェクトを書く形も上限で打ち切ること", async () => {
    const tag = defineOutput((n) => ({ at: n }));
    const counter = { evals: 0 };
    let renders = 0;
    const { host, shadowRoot } = await mount(
      loopState(counter, { $renderedCallback() { renders++; } }),
      loopHtml(tag),
    );
    await settle();

    expect(renderChainReports()).toHaveLength(1);
    expect(renders).toBeLessThanOrEqual(MAX_RENDER_CHAIN_DEPTH + 2);
    // この形は 1 回の描画で view を 2 回評価する（実測 205 回 / 描画 102 回）
    expect(counter.evals).toBeLessThanOrEqual(2 * (MAX_RENDER_CHAIN_DEPTH + 4));
    expect(shadowRoot.querySelectorAll("li")).toHaveLength(2);
    host.remove();
  });

  it("バインディングが要素に値を設定したその場で要素が同期に出すイベントの書き込みも連鎖を伸ばし、上限で打ち切られること", async () => {
    // setter の中で出力イベントを同期に出す要素（I/O ノードのイベントでも、同期に出れば適用中の書き込み）
    const tag = `x-render-chain-${seq++}`;
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
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
    const { host, shadowRoot, stateEl } = await mount(
      {
        b: 0,
        // 要素へ渡す値は、要素が返した値 + 1 — 書くたびに新しい値になる
        get a(this: any) {
          if (++counter.evals > RUNAWAY_CAP) throw new Error("runaway-evals");
          return this.b + 1;
        },
      },
      `<${tag} data-wcs="value: a; status: b"></${tag}>`,
    );
    await settle();

    const reports = renderChainReports();
    expect(reports).toHaveLength(1);
    expect(reports[0][1]).toEqual({ maxDepth: MAX_RENDER_CHAIN_DEPTH, paths: ["b", "a"] });
    // 修正前は RUNAWAY_CAP まで評価が続いた。b は 102 で止まり、打ち切ったバッチ（b = 102 の書き込み）は
    // 要素へ適用されない — 要素が最後に受け取って返した値も 102 のまま
    expect(counter.evals).toBeLessThanOrEqual(MAX_RENDER_CHAIN_DEPTH + 4);
    expect(read(stateEl, "b")).toBe(MAX_RENDER_CHAIN_DEPTH + 2);
    expect((shadowRoot.querySelector(tag) as any).status).toBe(MAX_RENDER_CHAIN_DEPTH + 2);
    host.remove();
  });

  it("対照: 要素がどれも同じ値を返す形は 2 回の評価で収束し、報告しないこと", async () => {
    const tag = defineOutput(() => "same");
    const counter = { evals: 0 };
    const { host, shadowRoot, stateEl } = await mount(loopState(counter), loopHtml(tag));
    await settle();

    expect(renderChainReports()).toHaveLength(0);
    expect(counter.evals).toBe(2);
    expect(read(stateEl, "mode")).toBe("same");
    expect(Array.from(shadowRoot.querySelectorAll("span"), (span) => span.textContent)).toEqual(["same", "same"]);
    host.remove();
  });

  it("打ち切った後の作者の書き込みで連鎖は 0 から数え直し、同じ循環はもう一度だけ打ち切られること", async () => {
    const tag = defineOutput((n) => `m${n}`);
    const counter = { evals: 0 };
    let renders = 0;
    const { host, shadowRoot, stateEl } = await mount(
      loopState(counter, { $renderedCallback() { renders++; } }),
      loopHtml(tag),
    );
    await settle();
    expect(renderChainReports()).toHaveLength(1);
    const firstRenders = renders;
    const firstEvals = counter.evals;

    write(stateEl, "rows", [{ k: 1 }, { k: 2 }, { k: 3 }]);
    await settle();

    expect(renderChainReports()).toHaveLength(2);
    // 続きの深さのまま即座に打ち切る（描画 0 回）のではなく、深さ 0〜上限の drain を描き直してから止まる
    expect(renders - firstRenders).toBe(MAX_RENDER_CHAIN_DEPTH + 1);
    // 3 行のこの形は 1 回の描画で view を 2 回評価する（この書き込みからの実測 203 回）
    expect(counter.evals - firstEvals).toBeLessThanOrEqual(2 * (MAX_RENDER_CHAIN_DEPTH + 4));
    expect(shadowRoot.querySelectorAll("li")).toHaveLength(3);
    host.remove();
  });

  it("打ち切りが state:render-chain-limit として DevTools へ 1 回流れること", async () => {
    const tag = defineOutput((n) => `m${n}`);
    const counter = { evals: 0 };
    const events: any[] = [];
    setDevtoolsSink((event) => { events.push(event); });
    try {
      const { host } = await mount(loopState(counter), loopHtml(tag));
      await settle();
      const limits = events.filter((event) => event.type === "state:render-chain-limit");
      expect(limits).toEqual([{
        type: "state:render-chain-limit",
        maxDepth: MAX_RENDER_CHAIN_DEPTH,
        paths: expect.arrayContaining(["mode", "view"]),
      }]);
      host.remove();
    } finally {
      setDevtoolsSink(null);
    }
  });

  it("循環中のパスへ $watch が書いても（drain 終了リスナーの書き込みは数え直さない）打ち切られ、相乗りした $watch の上限の報告も出ること（今の振る舞い）", async () => {
    const tag = defineOutput((n) => `m${n}`);
    const counter = { evals: 0 };
    const { host, shadowRoot, stateEl } = await mount(
      loopState(counter, {
        saved: null,
        $watch: {
          mode(this: any, current: unknown) { this.saved = current; },
        },
      }),
      loopHtml(tag),
    );
    await settle();

    // 今の振る舞いの固定: `$watch` の連鎖深さはバッチ単位で数える（watch/chainDepth.ts）ので、描画の
    // 循環の各バッチにハンドラの書き込み（saved）が相乗りすると、watch の深さも 1 バッチに 1 段ずつ伸びる。
    // watch の上限（32）で 1 回打ち切られると深さは 0 に戻ってまた伸びるので、描画の上限（100）までに
    // 2 回報告する（実測 評価 37 回目・72 回目の後）。ハンドラ自身は循環していないが、その機構から見た連鎖は
    // 実在する — 修正前（描画の連鎖に上限が無い）も同じ間隔で報告していた。
    const kinds = errorSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .filter((message) => message.includes("chain depth limit exceeded"))
      .map((message) => (message.includes("$watch") ? "watch" : "render"));
    expect(kinds).toEqual(["watch", "watch", "render"]);
    expect(renderChainReports()).toHaveLength(1);
    expect(counter.evals).toBeLessThanOrEqual(MAX_RENDER_CHAIN_DEPTH + 4);
    expect(shadowRoot.querySelectorAll("li")).toHaveLength(2);
    expect(read(stateEl, "saved")).toMatch(/^m\d+$/);
    host.remove();
  });

  it("遷移越しに後で適用されても、その適用の中の書き込みは連鎖の続きとして数えられ打ち切られること", async () => {
    const runner = {
      protocol: "wcs-transition-runner",
      version: 1,
      naming: "manual",
      namingLimit: 200,
      accepts: () => true,
      // 適用を別のマクロタスクへ遅らせる（ビュー遷移の更新コールバック相当）
      run(mutate: () => void): Promise<void> {
        return new Promise((resolve) => {
          setTimeout(() => { mutate(); resolve(); }, 0);
        });
      },
    };
    const globals = globalThis as unknown as Record<symbol, unknown>;
    globals[TRANSITION_RUNNER_KEY] = runner;
    try {
      const tag = defineOutput((n) => `m${n}`);
      const counter = { evals: 0 };
      const { host, shadowRoot } = await mount(loopState(counter), loopHtml(tag));
      await settle(MAX_RENDER_CHAIN_DEPTH + 10);

      expect(renderChainReports()).toHaveLength(1);
      expect(counter.evals).toBeLessThanOrEqual(MAX_RENDER_CHAIN_DEPTH + 4);
      expect(shadowRoot.querySelectorAll("li")).toHaveLength(2);
      host.remove();
    } finally {
      delete globals[TRANSITION_RUNNER_KEY];
    }
  });

  describe("誤検出しない", () => {
    it("microtask で刻む書き込み（await の続き）で一覧を伸ばし、各行の要素が初期同期で書き戻しても打ち切らないこと", async () => {
      const tag = defineOutput(() => "ready");
      const { host, shadowRoot, stateEl } = await mount(
        { rows: [] },
        `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>`,
      );
      await settle();

      // 書き込みのたびに 1 tick だけ譲る — 描画の書き戻し（行の初期同期）と同じバッチに乗り続ける
      const count = MAX_RENDER_CHAIN_DEPTH * 2;
      for (let i = 0; i < count; i++) {
        stateEl.createState("writable", (state: any) => { state.rows = [...state.rows, { st: `x${i}` }]; });
        await null;
      }
      await settle();

      expect(renderChainReports()).toHaveLength(0);
      expect(shadowRoot.querySelectorAll("li")).toHaveLength(count);
      const spans = Array.from(shadowRoot.querySelectorAll("span"), (span) => span.textContent);
      expect(spans).toEqual(Array(count).fill("ready"));
      host.remove();
    });

    it("$stream が microtask で流す値で一覧を伸ばし、各行の要素が初期同期で書き戻しても打ち切らないこと", async () => {
      const tag = defineOutput(() => "ready");
      const count = MAX_RENDER_CHAIN_DEPTH * 2;
      const { host, shadowRoot } = await mount(
        {
          $stream: {
            rows: {
              // 待ちの無い async generator — 値は microtask ごとに届く
              source: async function* () {
                for (let i = 0; i < count; i++) yield { st: `x${i}` };
              },
              fold: (acc: unknown[], chunk: unknown) => [...acc, chunk],
              initial: [],
            },
          },
        },
        `<ul><template data-wcs="for: rows"><li><${tag} data-wcs="status: .st"></${tag}><span>{{ .st }}</span></li></template></ul>`,
      );
      await settle();

      expect(renderChainReports()).toHaveLength(0);
      expect(shadowRoot.querySelectorAll("li")).toHaveLength(count);
      const spans = Array.from(shadowRoot.querySelectorAll("span"), (span) => span.textContent);
      expect(spans).toEqual(Array(count).fill("ready"));
      host.remove();
    });

    it("相互 $watch の連鎖は $watch の上限で打ち切られ、DOM に束ねたパスでも描画連鎖の上限は報告しないこと", async () => {
      const { host, stateEl } = await mount(
        {
          a: 0,
          b: 0,
          $watch: {
            a(this: any, current: number) { this.b = current + 1; },
            b(this: any, current: number) { this.a = current + 1; },
          },
        },
        `<p>{{ a }}</p><p>{{ b }}</p>`,
      );
      write(stateEl, "a", 1);
      await settle();

      const messages = errorSpy.mock.calls.map((call: unknown[]) => String(call[0]));
      expect(messages.some((message) => message.includes("$watch chain depth limit exceeded"))).toBe(true);
      expect(renderChainReports()).toHaveLength(0);
      host.remove();
    });

    it("$renderedCallback の書き戻しは、別のマクロタスクから何度来ても連鎖を伸ばさないこと（タイマーの tick 相当）", async () => {
      const { host, shadowRoot, stateEl } = await mount(
        {
          n: 0,
          echo: 0,
          $renderedCallback(this: any) {
            if (this.echo !== this.n) this.echo = this.n;
          },
        },
        `<p class="n">{{ n }}</p><p class="echo">{{ echo }}</p>`,
      );
      const ticks = MAX_RENDER_CHAIN_DEPTH + 8;
      for (let i = 1; i <= ticks; i++) {
        write(stateEl, "n", i);
        await macro();
      }
      await settle();

      expect(renderChainReports()).toHaveLength(0);
      expect(shadowRoot.querySelector(".echo")!.textContent).toBe(String(ticks));
      host.remove();
    });

    it("上限ちょうどの連鎖は打ち切らず、1 段超えると打ち切ること（$renderedCallback の数え上げ）", async () => {
      async function countUp(target: number) {
        const { host, shadowRoot, stateEl } = await mount(
          {
            count: 0,
            target,
            $renderedCallback(this: any) {
              if (this.count > 0 && this.count < this.target) this.count++;
            },
          },
          `<p>{{ count }}</p>`,
        );
        write(stateEl, "count", 1);
        await settle();
        const result = {
          text: shadowRoot.querySelector("p")!.textContent,
          count: read(stateEl, "count"),
          reports: renderChainReports().length,
        };
        host.remove();
        return result;
      }

      // 作者の書き込みの drain が深さ 0。深さ MAX_RENDER_CHAIN_DEPTH の drain までは描く
      expect(await countUp(MAX_RENDER_CHAIN_DEPTH + 1)).toEqual({
        text: String(MAX_RENDER_CHAIN_DEPTH + 1),
        count: MAX_RENDER_CHAIN_DEPTH + 1,
        reports: 0,
      });
      // 1 段超えた drain は適用しない — 値は巻き戻さず、描画は 1 つ前のまま
      expect(await countUp(MAX_RENDER_CHAIN_DEPTH + 2)).toEqual({
        text: String(MAX_RENDER_CHAIN_DEPTH + 1),
        count: MAX_RENDER_CHAIN_DEPTH + 2,
        reports: 1,
      });
    });

    // 以下の 2 つは上限の値そのものの番人。32 段を超えるが有限で収まる連鎖は、上限を 32 にすると
    // 途中で打ち切られていた（描画は 1 回ごとに 1 段なので、段数 ＝ 描画の回数 − 1）。
    it("文字サイズを 1px ずつ詰めて収める連鎖（64px → 18px・描画 47 回）が最後まで収まること", async () => {
      let renders = 0;
      const { host, shadowRoot, stateEl } = await mount(
        {
          text: "",
          size: 64,
          fit: 18,
          $renderedCallback(this: any) {
            renders++;
            // 描いた結果を測り、はみ出していれば 1px 詰める（測定の代わりに fit と比べる）。
            // 見出しが空のうち（初回の描画）は測らない
            if (this.text !== "" && this.size > this.fit) this.size--;
          },
        },
        `<p class="text">{{ text }}</p><p class="size">{{ size }}</p>`,
      );
      renders = 0;
      write(stateEl, "text", "a long heading");
      await settle();

      expect(renderChainReports()).toHaveLength(0);
      expect(renders).toBe(47);
      expect(read(stateEl, "size")).toBe(18);
      expect(shadowRoot.querySelector(".size")!.textContent).toBe("18");
      host.remove();
    });

    it("400 行を 10 行ずつ段階描画する連鎖（40 段）が最後まで収まること", async () => {
      let renders = 0;
      const { host, shadowRoot, stateEl } = await mount(
        {
          all: Array.from({ length: 400 }, (_, i) => ({ id: i })),
          shown: 0,
          get visible(this: any) {
            return this.all.slice(0, this.shown);
          },
          $renderedCallback(this: any) {
            renders++;
            // 描き終えたら次の 10 行を足す（1 回の描画を軽く保つ段階描画）
            if (this.shown < this.all.length) this.shown += 10;
          },
        },
        `<ul><template data-wcs="for: visible"><li>{{ .id }}</li></template></ul>`,
      );
      renders = 0;
      write(stateEl, "shown", 10);
      await settle();

      expect(renderChainReports()).toHaveLength(0);
      expect(renders).toBe(40);
      expect(read(stateEl, "shown")).toBe(400);
      expect(shadowRoot.querySelectorAll("li")).toHaveLength(400);
      host.remove();
    });
  });
});
