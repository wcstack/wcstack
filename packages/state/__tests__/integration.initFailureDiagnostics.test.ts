/**
 * integration.initFailureDiagnostics.test.ts — 初回マウントでの初期化失敗の着地（#257）。
 *
 * 旧挙動: `connectedCallback` の `await this._initialize()` は**唯一の無防備な await** で、
 * そこから投げられた例外は `_initialized = true` も `_resolveInitialize()` も
 * `_resolveConnectedCallback()` も飛ばした。結果、`initializePromise` と
 * `connectedCallbackPromise` は永久 pending・`console.error` は 0 件で、作者が受け取るのは
 * 診断ではなく無言のハングだった（`await` したテストは 5 秒で timeout する）。
 *
 * 契約（このファイルが固定する）:
 *  - `connectedCallbackPromise` は**元のエラーそのもの**で reject する（包み直さない）。
 *  - `console.error` が 1 件出る（カスタム要素リアクションは connectedCallback の戻り
 *    Promise を捨てるので、ブラウザの "Uncaught (in promise)" 以外に受け手が居ない）。
 *  - `initializePromise` は**解決する**。`waitForStateInitialize` は同じ root の全
 *    `<wcs-state>` の initializePromise を `Promise.all` で待つので、reject にすると
 *    1 要素の設定ミスが無関係なバインディングまで道連れにする。
 *  - `initialized` は false のまま（切断時の後始末が未ロードの state を触らないため）。
 *  - 失敗した rootNode の `getBindingsReady` は reject する（即時解決のままだと
 *    @wcstack/server の `waitForReady` が空のページを ready と報告する）。
 *  - 同じ rootNode の保留中ボリュームは孤児として着地する（ルート登録が来ない ＝
 *    `drainPendingVolumes` が呼ばれないので、放置すると永久未解決になる）。
 *  - 失敗した要素は復旧不能。`setInitialState` は無言の no-op ではなく throw する。
 *
 * 載る throw 元は「`_initialize` が投げうるもの全部」— コードから導いてある:
 * `_state` セッタの宣言検証 7 種（$recursion / $commandTokens / $eventTokens / $on /
 * $streams / $listKeys / $watch）、`_loadStateFromSource` の 4 種（src の拡張子・json の
 * パース・内包スクリプト・外部モジュール — 後ろ 3 つは components.State.test.ts 側）、
 * SSR データの merge、`setStateElement` の「1 rootNode 1 ツリー」違反。
 *
 * 対照として、`_failInitialization`（`name=` などの設定エラー）は従来どおり
 * connectedCallbackPromise を**解決**することも固定する。両者は別クラスの失敗で、
 * 統合するなら別の設計判断が要る（前者はページの残りが生きている設定ミス、
 * 後者は state を 1 つも持たない要素）。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r));

let seq = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++seq}`;

interface IBrokenMount {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  stateEl: State;
  errorSpy: ReturnType<typeof vi.spyOn>;
}

/** 壊れた state を初回マウントで渡す（ソースは setInitialState — getter を含む形も渡せる）。 */
function mountBroken(initial: unknown, extraHtml = ""): IBrokenMount {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const host = document.createElement(uniqueTag("initfail-host"));
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<wcs-state></wcs-state>` + extraHtml;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial as Record<string, any>);
  return { host, shadowRoot, stateEl, errorSpy };
}

/** reject の理由（オブジェクトそのもの）を取り出す。 */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("promise resolved, expected a rejection");
}

describe("#257 初期化失敗: $ 宣言の検証", () => {
  // 検証の実行順（_state セッタ）に沿って 1 つずつ。どれも初回マウントでは同じ着地に
  // 載ることが要点で、文面はそれぞれの宣言自身のもの（包み直していない証拠）
  const cases: Array<[string, unknown, RegExp]> = [
    ["$recursion", { nodes: [{ value: 1, children: [] }], $recursion: { nodes: "children.*" } },
      /\[wcs\/recursion-declaration-invalid\].*must name a list element/],
    ["$commandTokens", { $commandTokens: "focus" }, /\$commandTokens must be an array of strings/],
    ["$eventTokens", { $eventTokens: ["changed", "changed"] }, /\$eventTokens entry "changed" is duplicated/],
    ["$on", { $eventTokens: [], $on: { changed() { /* noop */ } } }, /\$on entry "changed" is not declared in \$eventTokens/],
    ["$streams", { $streams: { s: {} } }, /\$streams entry "s" source must be a function/],
    ["$listKeys", { items: [], $listKeys: { "items.*": "id" } }, /\$listKeys entry "items\.\*" must be the list path itself/],
    ["$watch", { $watch: { a: 1 } }, /\[wcs\/watch-declaration-invalid\].*\$watch entry "a" must be a function/],
  ];

  for (const [name, initial, message] of cases) {
    it(`${name} の宣言エラーは connectedCallbackPromise を自分の文面で reject し、診断を 1 件出すこと`, async () => {
      const { host, stateEl, errorSpy } = mountBroken(initial);
      try {
        await expect(stateEl.connectedCallbackPromise).rejects.toThrow(message);
        // initializePromise は解決する（ページ全体を道連れにしない）
        await expect(stateEl.initializePromise).resolves.toBeUndefined();
        expect(stateEl.initialized).toBe(false);
        expect(errorSpy.mock.calls.length).toBe(1);
        expect(String(errorSpy.mock.calls[0][0])).toContain("failed to initialize");
      } finally {
        errorSpy.mockRestore();
        host.remove();
      }
    });
  }

  it("診断に載るエラーと reject の理由は同一オブジェクトであること（包み直していない）", async () => {
    const { host, stateEl, errorSpy } = mountBroken({ $watch: { a: 1 } });
    try {
      const reason = await rejection(stateEl.connectedCallbackPromise);
      expect(errorSpy.mock.calls[0][1]).toBe(reason);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });
});

describe("#257 初期化失敗: ソースと SSR merge", () => {
  it("json 属性の壊れた JSON も同じ経路に載ること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-json"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state json='{invalid'></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    try {
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/Failed to initialize state/);
      await expect(stateEl.initializePromise).resolves.toBeUndefined();
      expect(errorSpy.mock.calls.length).toBe(1);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });

  it("SSR スナップショットの merge 失敗も同じ経路に載ること", async () => {
    // merge は `__state[key] = value` の素の代入なので、凍結した state は TypeError を投げる。
    // <wcs-ssr> は要素の parentNode から探されるため、コンテナ要素で包む（ShadowRoot 直下では
    // Ssr.find が null を返し、そもそも merge に入らない）
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-ssr"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<div id="box">` +
      `<wcs-ssr><script type="application/json">{"a":2}</script></wcs-ssr>` +
      `<wcs-state enable-ssr></wcs-state>` +
      `</div>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState(Object.freeze({ a: 1 }) as Record<string, any>);
    try {
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(TypeError);
      await expect(stateEl.initializePromise).resolves.toBeUndefined();
      expect(stateEl.initialized).toBe(false);
      expect(errorSpy.mock.calls.length).toBe(1);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });
});

describe("#257 初期化失敗: 2 本目のルート <wcs-state>", () => {
  /**
   * v2 は 1 rootNode 1 ツリー（`setStateElement` の raise）。これも `_initialize` の中で
   * 投げるので、旧挙動では **1 本目が正常でもページが丸ごと死んでいた**
   * （2 本目の initializePromise が永久 pending ＝ waitForStateInitialize が
   * buildBindings を止め、`getBindingsReady` も pending のまま）。
   *
   * 着地後は 1 本目でページが成立する。ただし 2 本目は**登録されないまま state を
   * 持つゾンビ**として DOM に残る: `__state` は組み上がり、$on の購読は生きていて、
   * `_initialized` は false なので切断時の後始末も掛からない。要素を消すのは作者の仕事で、
   * そのための診断が出る（DOM の見た目は変えない — 消すかどうかはページの設計判断）。
   */
  it("2 本目は診断付きで落ち、1 本目のページはそのまま生きること（2 本目はゾンビとして残る）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-dup"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state json='{"count":1}'></wcs-state>` +
      `<wcs-state json='{"count":2}'></wcs-state>` +
      `<p id="count" data-wcs="textContent: count"></p>`;
    document.body.appendChild(host);
    const [first, second] = Array.from(shadowRoot.querySelectorAll("wcs-state")) as State[];
    try {
      await expect(first.connectedCallbackPromise).resolves.toBeUndefined();
      await expect(second.connectedCallbackPromise).rejects.toThrow(/already registered on this root/);
      // 両方の initializePromise は解決する（1 本目を道連れにしない）
      await expect(first.initializePromise).resolves.toBeUndefined();
      await expect(second.initializePromise).resolves.toBeUndefined();
      // 1 本目の ready は壊さない（失敗した要素は ready を上書きしない）
      await expect(State.getBindingsReady(shadowRoot)).resolves.toBeUndefined();
      await flush();
      // ページは 1 本目の値で描画される（旧挙動: 空のまま）
      expect((shadowRoot.querySelector("#count") as HTMLElement).textContent).toBe("1");
      expect(first.initialized).toBe(true);
      expect(second.initialized).toBe(false);
      // ゾンビの実体（この it が「何を残しているか」の記録）
      expect(typeof (second as unknown as { __state: unknown }).__state).toBe("object");
      expect(errorSpy.mock.calls.length).toBe(1);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });
});

describe("#257 初期化失敗: getBindingsReady と復旧", () => {
  it("失敗したルートの getBindingsReady は同じ診断で reject すること", async () => {
    const { host, shadowRoot, stateEl, errorSpy } = mountBroken({ $watch: { a: 1 } });
    try {
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/must be a function/);
      // 旧挙動: 未登録の rootNode ＝ 即時解決。@wcstack/server の waitForReady が
      // 「バインディングが 1 本も無いページ」を ready と報告してしまう
      await expect(State.getBindingsReady(shadowRoot)).rejects.toThrow(/must be a function/);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });

  it("失敗した要素への setInitialState は無言の no-op ではなく throw すること", async () => {
    const { host, stateEl, errorSpy } = mountBroken({ $watch: { a: 1 } });
    try {
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/must be a function/);
      // 旧挙動: _setStatePromise は解決済みで読み手も居ないので、渡し直しても何も起きなかった
      expect(() => stateEl.setInitialState({ ok: 1 })).toThrow(/failed to initialize/);
      expect(() => stateEl.setInitialState({ ok: 1 })).toThrow(/Remove this element and create a new one/);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });

  it("再接続では接続 1 回につき診断が 1 件出ること（要素は復旧しない）", async () => {
    const { host, shadowRoot, stateEl, errorSpy } = mountBroken({ $watch: { a: 1 } });
    try {
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/must be a function/);
      expect(errorSpy.mock.calls.length).toBe(1);
      errorSpy.mockClear();
      // remove → append は同じ壊れた state を _setStatePromise から引き直すので同じ所で落ちる。
      // 「診断は接続ごとに 1 件」であって「要素ごとに 1 件」ではない
      stateEl.remove();
      await flush();
      shadowRoot.appendChild(stateEl);
      await flush();
      await flush();
      expect(errorSpy.mock.calls.length).toBe(1);
      expect(stateEl.initialized).toBe(false);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });

  it("初期化中に切断された要素でも診断は出ること（rootNode が解決不能でも着地が落ちない）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-detach"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    try {
      // ソースを待っている間に剥がす（disconnectedCallback が _rootNode を null にする）
      stateEl.remove();
      await flush();
      stateEl.setInitialState({ $watch: { a: 1 } });
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/must be a function/);
      await expect(stateEl.initializePromise).resolves.toBeUndefined();
      expect(errorSpy.mock.calls.length).toBe(1);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });

  it("promise を誰も await しない DOM 駆動のマウントでも診断は 1 件出て、unhandled rejection にならないこと", async () => {
    // このテストが落ちるのは _failInitializeLoudly の「reject より先に handled を立てる」
    // 行（_connectedCallbackPromise.catch）が消えたとき。unhandled rejection が 1 件でも
    // 出るとテストランナーはプロセスごと exit 1 になるので、緑であること自体が担保になる
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-nowait"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state json='{invalid'></wcs-state>`;
    document.body.appendChild(host);
    try {
      await flush();
      await flush();
      expect(errorSpy.mock.calls.length).toBe(1);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });
});

describe("#257 初期化失敗: 同居するボリューム", () => {
  /**
   * ボリュームの `finish()` はルート登録（`setStateElement` → `drainPendingVolumes`）からしか
   * 呼ばれない。ルートが落ちるとその行に到達しないので、**ルートの診断だけが出て
   * ボリュームは永久 pending のまま**残る（`_volumeInitializing` が立っているので
   * remove → append の復旧も効かない）。D11 の「ルート無し」報告も出ない — 検査は
   * ルート候補**要素**の存在で見るため、落ちたルート要素が居る限り黙る。
   * 保留キューの引き取り手が来ないと確定した時点で、1 件 1 報告で着地させる。
   * 鏡写しの形（ボリュームが落ちてルートは無事）は integration.volumeMount.test.ts の
   * 「volume: ロード失敗の隔離」が固定している。
   */
  it("ルートより先に保留に積まれたボリュームが、ルートの失敗で着地すること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-vol-a"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state mount="i18n"></wcs-state>` +
      `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const volumeElement = shadowRoot.querySelector("wcs-state[mount]") as State;
    const rootElement = shadowRoot.querySelector("wcs-state:not([mount])") as State;
    try {
      volumeElement.setInitialState({ lang: "en" });
      await flush();
      await flush();
      // ここでボリュームは保留キューに積まれている（ルートはまだソース待ち）
      expect(errorSpy.mock.calls.length).toBe(0);

      rootElement.setInitialState({ items: [], $listKeys: { "items.*": "id" } });
      await expect(rootElement.connectedCallbackPromise).rejects.toThrow(/must be the list path itself/);
      // 旧挙動: ここで永久待ち
      await expect(volumeElement.connectedCallbackPromise).resolves.toBeUndefined();
      await expect(volumeElement.initializePromise).resolves.toBeUndefined();
      const messages = errorSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes("failed to initialize"))).toBe(true);
      expect(messages.some((m) => m.includes('volume "i18n" was not grafted'))).toBe(true);
      expect(errorSpy.mock.calls.length).toBe(2);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });

  it("ルートが落ちた後に届いたボリュームも同じ着地に合流すること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-vol-b"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state json='{invalid'></wcs-state>` +
      `<wcs-state mount="i18n"></wcs-state>`;
    document.body.appendChild(host);
    const volumeElement = shadowRoot.querySelector("wcs-state[mount]") as State;
    const rootElement = shadowRoot.querySelector("wcs-state:not([mount])") as State;
    try {
      await expect(rootElement.connectedCallbackPromise).rejects.toThrow(/Failed to initialize state/);
      expect(errorSpy.mock.calls.length).toBe(1);
      // ボリュームのロードのほうが遅い形（保留に積もうとした時点でルートは既に失敗済み）
      volumeElement.setInitialState({ lang: "en" });
      await expect(volumeElement.connectedCallbackPromise).resolves.toBeUndefined();
      await expect(volumeElement.initializePromise).resolves.toBeUndefined();
      expect(errorSpy.mock.calls.length).toBe(2);
      expect(String(errorSpy.mock.calls[1][0])).toContain('volume "i18n" was not grafted');
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });
});

describe("#257 対照: _failInitialization は従来どおり解決する", () => {
  /**
   * `name=` などの設定エラー（`_failInitialization`）は connectedCallbackPromise を
   * **解決**したまま raise する。ここを揃えたくなったら別の Issue にすること —
   * integration.bindComponentRootMount.test.ts の 2 件がこの解決に依存している
   * （ページの残りが生きている設定ミスと、state を 1 つも持たない要素は別クラス）。
   */
  it("name= のページは connectedCallbackPromise も getBindingsReady も解決したままであること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-name"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state name="foo" json='{"a":1}'></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    try {
      await expect(stateEl.connectedCallbackPromise).resolves.toBeUndefined();
      await expect(stateEl.initializePromise).resolves.toBeUndefined();
      await expect(State.getBindingsReady(shadowRoot)).resolves.toBeUndefined();
      expect(errorSpy.mock.calls.length).toBe(0);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });
});
