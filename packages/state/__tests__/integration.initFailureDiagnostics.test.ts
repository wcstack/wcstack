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
 *  - **失敗の時点で待機していた**同じ rootNode のボリュームは孤児として着地する
 *    （ルート登録が来ない ＝ `drainPendingVolumes` が呼ばれないので、放置すると永久
 *    未解決になる）。「ルートは来ない」の印は**落ちた要素が居る間だけ**有効。
 *    ただし孤児として報告されたボリュームはそこが終点で、後から修正版のルートを
 *    接続しても自分で接ぎ木し直さない。マウントの枠は決着の時点で返す（#265）ので、
 *    壊れたルートとボリュームを作り直せば、ページを読み直さずに復旧できる
 *    （枠の寿命は integration.volumeSlotRelease.test.ts が固定する）。
 *  - 失敗した要素は復旧不能。`setInitialState` は無言の no-op ではなく throw する。
 *
 * 載る throw 元は「`_initialize` が投げうるもの全部」— コードから導いてある:
 * `_state` セッタの宣言検証 7 種（$recursion / $commandTokens / $eventTokens / $on /
 * $streams / $listKeys / $watch）、`_loadStateFromSource` の 4 種（src の拡張子・json の
 * パース・内包スクリプト・外部モジュール — 後ろ 3 つは components.State.test.ts 側）、
 * SSR データの merge、`setStateElement` の
 * 「1 rootNode 1 ツリー」違反（**別の**要素が 2 本目に来た形 — 同じ要素の再登録は冪等で、
 * ロード中の remove → append は拒否しない）。
 *
 * 載**らない**もの: ロード中に剥がされた要素。作者のミスが 1 つも無いので初期化失敗では
 * なく**中断**として扱う（診断も reject も毒化も無し）。第 2 ラウンドはこれを失敗として
 * 列挙していたが、第 3 ラウンドで撤回した — 下の「#257 中断」2 つの describe が新しい契約。
 *
 * 同じく載らないのがボリューム（`mount=`）の失敗。`_initializeVolume` の catch が 3 つの
 * promise を自分で解決してから raise し、`connectedCallback` のボリューム分岐はそれを
 * 包まないので、ボリュームは connectedCallbackPromise を**拒否しない** —— `name=` と
 * 同じ逃げ方で、エラーはカスタム要素リアクションが捨てる戻り Promise（ブラウザの
 * "Uncaught (in promise)"）として残り、promise を待つ側には届かない。自前の報告が出るか
 * どうかは失敗の種類による。挙動はこの PR では変えない（枠の寿命は #265 —
 * integration.volumeSlotRelease.test.ts）。
 *
 * `connectedCallback` が `_initialize` より前に await する 2 つ（`_initializeDCC` /
 * `_initializeBindWebComponent`）の raise も同じ着地に載る。自分で promise を解決してから
 * raise する fail-fast（`_failInitialization` / `initializeMountScope` の catch）だけは
 * 従来どおり素通しで、こちらは connectedCallbackPromise を**解決**する側のクラスに留まる。
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

/** promise の決着を「解決 / 拒否 / 未決着」の 3 値で測る（await でハングしないため）。 */
const settle = (promise: Promise<unknown>): Promise<string> => Promise.race([
  promise.then(() => "resolved", () => "rejected"),
  flush().then(() => flush()).then(() => flush()).then(() => "pending"),
]);

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
    ["$streams", { $streams: { s: {} } }, /\$stream entry "s" source must be a function/],
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
      // 文言は「2 本目は登録されないまま残る・取り除け」まで伝えること（作者の次の一手。
      // 「1 root 1 ツリー」だけでは、生きているように見える 2 本目をどうすべきか分からない）
      expect(String(errorSpy.mock.calls[0][1])).toMatch(/stays unregistered/);
      expect(String(errorSpy.mock.calls[0][1])).toMatch(/remove it/);
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

  it("切断された要素でも宣言のエラーは診断されること（中断と失敗の切り分け）", async () => {
    // 切断**そのもの**（宣言もソースも健全な形）は中断として黙って終わる — 下の
    //「#257 中断」の 2 つの describe。ここは作者のエラーが実在する形で、要素が DOM に
    // 居なくても着地は落ちない（_rootNode が null なので ready 台帳と保留ボリュームには
    // 触らず、診断と reject だけが届く）
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
  it("ルートを外してから接続したボリュームは、修正版のルートが採用すること（復旧の窓）", async () => {
    // この PR が案内する復旧は「壊れた要素を取り除いて作り直す」。失敗の印を rootNode に
    // **持続**させると、外してから修正版を接続するまでの窓で接続したボリュームが即座に
    // 孤児化し、正しいルートが来ても二度と採用されない（第 1 ラウンドの実測: 接ぎ木は
    // 起きず `i18n.lang` は undefined のまま）。印は「落ちたルート要素がまだ居る間」だけ
    // 有効で、その要素が切断された時点で消える。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-vol-c"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state json='{invalid'></wcs-state>`;
    document.body.appendChild(host);
    const brokenRoot = shadowRoot.querySelector("wcs-state") as State;
    try {
      await expect(brokenRoot.connectedCallbackPromise).rejects.toThrow(/Failed to initialize state/);
      expect(errorSpy.mock.calls.length).toBe(1);
      // 作者の復旧操作: 壊れたルートを取り除く
      brokenRoot.remove();
      await flush();
      // 窓の中で接続したボリューム（旧: ここで孤児化した）
      const volumeElement = document.createElement("wcs-state") as State;
      volumeElement.setAttribute("mount", "i18n");
      shadowRoot.appendChild(volumeElement);
      volumeElement.setInitialState({ lang: "en" });
      // 修正版のルート
      const fixedRoot = document.createElement("wcs-state") as State;
      fixedRoot.setAttribute("json", '{"count":1}');
      shadowRoot.insertBefore(fixedRoot, shadowRoot.firstChild);
      await expect(fixedRoot.connectedCallbackPromise).resolves.toBeUndefined();
      await expect(volumeElement.connectedCallbackPromise).resolves.toBeUndefined();
      await flush();
      let lang: unknown = undefined;
      fixedRoot.createState("readonly", (state: any) => { lang = state["i18n.lang"]; });
      expect(lang).toBe("en");
      // 孤児の報告も D11 の「ルート無し」報告も出ない（出たルートの診断 1 件のまま）
      expect(errorSpy.mock.calls.length).toBe(1);
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

describe("#257 回帰防止: 健全な要素の DOM 移動は拒否しないこと", () => {
  /**
   * 着地は `setStateElement` の「1 rootNode 1 ツリー」raise も拾う。第 1 ラウンドは
   * それが**同じ要素の再登録**にも当たっていた: ロード完了前の remove → append
   * （DOM の移動・行プールの張り直し・shadow の組み直し）は `_initialize` を 2 本
   * 同時に走らせ、後から登録に来たほうが**自分自身**に対して raise していた。
   * 実測（修理前）: 健全な `<wcs-state json='{"count":1}'>` の remove → append で
   * `connectedCallbackPromise` が rejected ＋ `console.error` 1 件（描画は "1" で
   * 成立しているのに、待ち手だけが失敗を受け取る）。
   *
   * 直したのは `setStateElement` 側（同一インスタンスの再登録は冪等 —
   * `setStateElementAlias` と同じ規範）。「切断時に登録を解除する」案は効かない —
   * 実測で remove の時点ではまだ**何も登録されていない**（登録は進行中の
   * `_initialize` の続きで起きる）ので、解除しても後から来る 2 本目は同じ raise に当たる。
   * 別インスタンスの 2 本目に対する raise は従来どおり（上の describe が固定）。
   */
  it("ロード中の remove → append（markup ソース）は resolve のまま・診断 0 件であること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-move"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state json='{"count":1}'></wcs-state>` +
      `<p id="count" data-wcs="textContent: count"></p>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    try {
      stateEl.remove();
      shadowRoot.insertBefore(stateEl, shadowRoot.firstChild);
      await expect(stateEl.connectedCallbackPromise).resolves.toBeUndefined();
      await flush();
      expect(errorSpy.mock.calls.length).toBe(0);
      expect(stateEl.initialized).toBe(true);
      expect((shadowRoot.querySelector("#count") as HTMLElement).textContent).toBe("1");
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });

  it("ロード中の remove → append（API セット）も同じであること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-move-api"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<wcs-state></wcs-state>` +
      `<p id="count" data-wcs="textContent: count"></p>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    try {
      stateEl.setInitialState({ count: 1 });
      stateEl.remove();
      shadowRoot.insertBefore(stateEl, shadowRoot.firstChild);
      await expect(stateEl.connectedCallbackPromise).resolves.toBeUndefined();
      await flush();
      expect(errorSpy.mock.calls.length).toBe(0);
      expect(stateEl.initialized).toBe(true);
      expect((shadowRoot.querySelector("#count") as HTMLElement).textContent).toBe("1");
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });
});

describe("#257 中断: ロード中に剥がされた要素は初期化失敗ではないこと", () => {
  /**
   * 第 2 ラウンドは `_initialize` の最後の行（`setStateElement(this.rootNode!, this)`）が
   * 切断済みの要素で raise する形を「初期化失敗」として列挙し、診断 ＋ reject ＋
   * 毒化（`_initializeFailed`）に載せた。**これは誤りで、第 3 ラウンドで撤回した**。
   * 作者のミスは 1 つも無く（state も宣言もソースも健全）、起きたのは DOM 操作による
   * 中断だけ。付け直せばそのまま初期化できる要素を「失敗」と呼んではいけない。
   *
   * 実測（`setInitialState` 直後に remove して戻さない形）:
   *   main         : { connected: "pending",  errors: 0, reSetThrew: null }
   *   第 2 ラウンド : { connected: "rejected", errors: 1, reSetThrew: "…so its state cannot be replaced" }
   *   修正後       : main と同じ（この it が固定する）
   *
   * とりわけ効くのが行プール（下の describe）。`connectedCallbackPromise` は
   * コンストラクタで 1 度だけ作られるので、中断で reject すると**完全に初期化されて
   * 描画も登録も成立した要素**が永久に失敗を報告し続け、その promise を待つ
   * @wcstack/server の `renderToString` と @wcstack/testing の `mount` が健全なページで
   * throw する。直し方は promise の再武装ではなく「この場合は拒否しない」
   *（`_initialize` が `false` を返し、`connectedCallback` はその接続だけを黙って終える）。
   */
  it("戻さない形: 診断 0 件・要素は毒化されず・promise は未解決のまま残ること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("interrupt-gone"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    try {
      stateEl.setInitialState({ count: 1 });
      stateEl.remove();
      expect(await settle(stateEl.connectedCallbackPromise)).toBe("pending");
      expect(errorSpy.mock.calls.length).toBe(0);
      expect(stateEl.initialized).toBe(false);
      // 毒化されていない ＝ 失敗した要素向けの復旧不能 raise に載っていない
      expect(() => stateEl.setInitialState({ count: 2 })).not.toThrow();
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });
});

describe("#257 中断: 行プール（ロード中の remove → append）", () => {
  /**
   * 3 形とも「付け直した要素は ready を報告し、作者の `$connectedCallback` と
   * `$streams` の起動は **1 接続につき 1 回**」で固定する。
   *
   * 実測（main → 第 2 ラウンド → 修正後）:
   *  - 素のマウント        : resolved / cc 1 / streams 1  →  同左  →  同左
   *  - remove の前にソース : resolved / cc 1 / streams 1  →  **rejected** ＋ 診断 1 件  →  resolved / cc 1 / streams 1
   *  - append の後にソース : resolved / cc 1 / streams 0  →  resolved / **cc 2** / streams 1  →  resolved / cc 1 / streams 1
   *
   * 2 回走ったのは、負けた `_initialize` も tail まで到達するから（登録が冪等に弾かれる
   * だけで、その後の `$connectedCallback` は止まらない）。`startWatch` / `startStreams` に
   * だけ掛かっていた世代ガードを `$connectedCallback` の呼び出しにも掛け、起動点を
   * 最新の connect に一本化した。3 形目の `$streams` が main で 0 なのは、2 本目の
   * `_initialize` が "already registered" で落ちて tail に到達しなかったため — 登録の
   * 冪等化で到達するようになったのは改善なので、世代ガードで 0 へ戻さないことも固定する。
   */
  type Shape = "plain" | "source-before-remove" | "source-after-append";

  async function pooled(shape: Shape) {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const counts = { connected: 0, source: 0 };
    const makeState = (): Record<string, any> => ({
      count: 1,
      $connectedCallback() { counts.connected++; },
      $streams: {
        ticker: {
          source: () => { counts.source++; return (async function* () { /* 即完了 */ })(); },
        },
      },
    });
    const host = document.createElement(uniqueTag(`pool-${shape}`));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state><p id="count" data-wcs="textContent: count"></p>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    if (shape === "plain") {
      stateEl.setInitialState(makeState());
    } else if (shape === "source-before-remove") {
      stateEl.setInitialState(makeState());
      stateEl.remove();
      await flush();
      await flush();
      shadowRoot.insertBefore(stateEl, shadowRoot.firstChild);
    } else {
      stateEl.remove();
      await flush();
      await flush();
      shadowRoot.insertBefore(stateEl, shadowRoot.firstChild);
      stateEl.setInitialState(makeState());
    }
    return { host, shadowRoot, stateEl, counts, errorSpy };
  }

  const shapes: Shape[] = ["plain", "source-before-remove", "source-after-append"];
  for (const shape of shapes) {
    it(`${shape}: ready を報告し、$connectedCallback も $streams も 1 回であること`, async () => {
      const { host, shadowRoot, stateEl, counts, errorSpy } = await pooled(shape);
      try {
        await expect(stateEl.connectedCallbackPromise).resolves.toBeUndefined();
        await flush();
        await flush();
        expect(stateEl.initialized).toBe(true);
        expect((shadowRoot.querySelector("#count") as HTMLElement).textContent).toBe("1");
        expect(counts.connected).toBe(1);
        expect(counts.source).toBe(1);
        expect(errorSpy.mock.calls.length).toBe(0);
      } finally {
        errorSpy.mockRestore();
        host.remove();
      }
    });
  }
});

describe("#257 初期化失敗: _initialize より前の raise（bind-component / DCC）", () => {
  /**
   * `_initialize` を包む catch だけでは足りない。`connectedCallback` はその前に
   * `_initializeDCC` と `_initializeBindWebComponent` も await していて、そこからの
   * raise は**着地を経ずに** connectedCallback の外へ出ていた（カスタム要素リアクションは
   * 戻り値の Promise を捨てるので、受け手はどこにも居ない ＝ 無言）。
   *
   * 一番効くのはこの PR 自身が作った形: 初期化に失敗した `bind-component` 要素を
   * 付け直すと、`bindWebComponent` → `setInitialState` の「復旧不能」raise に当たる。
   * この呼び出しは `_initialize` の外なので、第 1 ラウンドでは診断 0 件だった（実測）。
   *
   * 一方、**自分で着地を済ませた** fail-fast（`_failInitialization` と
   * `initializeMountScope` の catch）はそのまま伝播させる。あちらは
   * 「ページの残りは生きている設定ミス」で connectedCallbackPromise を解決する側の
   * クラスであり、ここで loud な着地に載せ替えると意味論が変わる（最後の it が固定）。
   */
  it("失敗済みの bind-component 要素の再接続は、例外の素通しではなく着地になること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tag = uniqueTag("initfail-bc");
    customElements.define(tag, class extends HTMLElement {
      state: Record<string, any> = { $watch: { a: 1 } };
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.shadowRoot!.innerHTML = `<wcs-state bind-component="state"></wcs-state>`;
      }
    });
    const component = document.createElement(tag);
    document.body.appendChild(component);
    const stateEl = component.shadowRoot!.querySelector("wcs-state") as State;
    try {
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/must be a function/);
      expect(errorSpy.mock.calls.length).toBe(1);
      errorSpy.mockClear();
      stateEl.remove();
      await flush();
      component.shadowRoot!.appendChild(stateEl);
      await flush();
      await flush();
      // 旧（第 1 ラウンド）: 0 件（throw が connectedCallback の外へ素通り）
      expect(errorSpy.mock.calls.length).toBe(1);
      expect(String(errorSpy.mock.calls[0][1])).toMatch(/failed to initialize/);
    } finally {
      errorSpy.mockRestore();
      component.remove();
    }
  });

  it("DCC のロード失敗も診断付きで reject すること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = document.createElement(uniqueTag("initfail-dcc"));
    host.setAttribute("data-wc-definition", "x-dcc-broken");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    try {
      await expect(stateEl.connectedCallbackPromise).rejects.toThrow(/DCC: No state source found/);
      await expect(stateEl.initializePromise).resolves.toBeUndefined();
      expect(errorSpy.mock.calls.length).toBe(1);
    } finally {
      errorSpy.mockRestore();
      host.remove();
    }
  });

  it("対照: 自分で着地する fail-fast（配線なし Light DOM の bind-component）は解決のまま・診断 0 件であること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tag = uniqueTag("initfail-plain");
    customElements.define(tag, class extends HTMLElement {
      state: Record<string, any> = { message: "hi" };
    });
    const component = document.createElement(tag);
    component.innerHTML = `<wcs-state bind-component="state"></wcs-state>`;
    document.body.appendChild(component);
    const stateEl = component.querySelector("wcs-state") as State;
    try {
      // _failInitialization は connectedCallbackPromise を解決してから raise する。
      // 二重着地させないための印（_initializationLanded）が効いていることの固定でもある
      await expect(stateEl.connectedCallbackPromise).resolves.toBeUndefined();
      await expect(stateEl.initializePromise).resolves.toBeUndefined();
      expect(errorSpy.mock.calls.length).toBe(0);
    } finally {
      errorSpy.mockRestore();
      component.remove();
    }
  });
});
