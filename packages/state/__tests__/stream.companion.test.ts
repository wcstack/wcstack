/**
 * stream.companion.test.ts
 *
 * `$streamStatus` / `$streamError` コンパニオン名前空間の reactive 反映の
 * end-to-end 統合テスト（B-3）。updateStreamStatus の $postUpdate が updater を
 * 経由して実際の binding 更新・$updatedCallback・computed 再計算に到達することを
 * 固定する。実 `<wcs-state>` を happy-dom で connect する流儀は
 * helpers/streamTestUtils.ts の connectHost（makeConnectHost）/ flushAsync / waitFor を共用。
 *
 * 受け入れ ID（docs/state-streams-design.md §10-2 / §4-3 / §4-4）:
 * - S9:       $streamStatus.<name> の binding が status 遷移（active → done / error）に追従
 * - S10:      $streamError.<name> の binding — error 格納・値プロパティは直前 fold 結果を保持
 * - S10 補:   restart（S13 経路 = setInitialState 再 set）で error が null にリセットされ
 *             DOM binding もクリアされる（通知 dedup は「最後に通知した観測値」基準 — §4-3）
 * - S17 完結: binding された $streamStatus.<name> が status 遷移時の $updatedCallback paths に載る
 * - S12 補:   disconnect → 再 connect で binding が継続動作（二重適用なし・console.error なし）
 * - S12 補3:  再接続ウィンドウ内の fresh 読み（idle 描画）後も restart の active 通知が
 *             dedup されない（abortAllStreams の無通知ミューテーションと台帳の同期 — §4-3）
 * - computed: $streamStatus を読む getter が status 変化で再計算される（$postUpdate → walkDependency）
 * - same-value skip: status/error とも変化なしの updateStreamStatus は何も通知しない
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getPathInfo } from "../src/address/PathInfo";
import { getAbsolutePathInfo } from "../src/address/AbsolutePathInfo";
import { createAbsoluteStateAddress } from "../src/address/AbsoluteStateAddress";
import { peekBindingsByAbsoluteStateAddress } from "../src/binding/getBindingSetByAbsoluteStateAddress";

/** 台帳エントリ（単一 binding | Set | undefined）の登録数 */
function countLedgerBindings(entry: unknown): number {
  if (typeof entry === "undefined") return 0;
  return entry instanceof Set ? entry.size : 1;
}
import { getStreamEntries } from "../src/stream/streamRegistry";
import { updateStreamStatus } from "../src/stream/streamRuntime";
import type { IState } from "../src/types";
import type { IStateProxy } from "../src/proxy/types";
import { makeManualAsyncGenerator, makeManualFailableSource } from "./helpers/fakeStreamSources";
import { flushAsync, waitFor, makeConnectHost } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const connectHost = makeConnectHost("stream-cp-host");

const concatFold = (acc: unknown, chunk: unknown) => `${acc}${chunk}`;

describe("$streamStatus / $streamError の reactive 反映 end-to-end（B-3）", () => {
  it("S9: $streamStatus.tokens の binding が connect 後 active、正常終端後 done に追従すること", async () => {
    const m = makeManualAsyncGenerator<string>();
    const raw: IState = {
      $streams: { tokens: { source: () => m.iterable, fold: concatFold, initial: "" } },
    };
    const { host, shadowRoot } = await connectHost(
      `<p id="st" data-wcs="textContent: $streamStatus.tokens"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();

    // 初期レンダは起動（connect 完了）後なので "active"。起動前の "idle" は binding からは
    // 観測されない — 中間 status の観測は保証しない（coalesce 保証の範囲、設計書 §4-4）
    const st = shadowRoot.querySelector("#st")!;
    expect(st.textContent).toBe("active");

    // チャンク到着では status は変わらない（値プロパティのみ更新）
    m.push("a");
    await flushAsync();
    expect(st.textContent).toBe("active");

    // 正常終端 → updateStreamStatus("done") → $postUpdate → drain → binding 反映
    m.end();
    await flushAsync();
    expect(st.textContent).toBe("done");

    host.remove();
  });

  it("S9 補: source のエラー終端で $streamStatus.tokens の binding が error 表示になること", async () => {
    const m = makeManualFailableSource<string>();
    const raw: IState = {
      $streams: { tokens: { source: () => m.iterable, fold: concatFold, initial: "" } },
    };
    const { host, shadowRoot } = await connectHost(
      `<p id="st" data-wcs="textContent: $streamStatus.tokens"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("active");

    m.fail(new Error("boom"));
    await flushAsync();
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("error");

    host.remove();
  });

  it("S10: source エラーで $streamError.tokens が binding に表示され、値プロパティは直前の fold 結果を保持すること", async () => {
    const m = makeManualFailableSource<string>();
    const failure = new Error("stream broke");
    const raw: IState = {
      $streams: { tokens: { source: () => m.iterable, fold: concatFold, initial: "" } },
    };
    const { host, shadowRoot } = await connectHost(
      `<p id="val" data-wcs="textContent: tokens"></p>` +
        `<p id="err" data-wcs="textContent: $streamError.tokens"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();

    m.push("a");
    m.push("b");
    await flushAsync();
    expect(shadowRoot.querySelector("#val")!.textContent).toBe("ab");
    // error 前は null（textContent への null 書き込みは空文字化）
    expect(shadowRoot.querySelector("#err")!.textContent).toBe("");

    m.fail(failure);
    await flushAsync();

    // error は $streamError の binding に反映され、値プロパティ（tokens）はリセットされない
    expect(shadowRoot.querySelector("#err")!.textContent).toBe(String(failure));
    expect(shadowRoot.querySelector("#val")!.textContent).toBe("ab");
    expect(raw.tokens).toBe("ab");

    host.remove();
  });

  it("S10 補: setInitialState 再 set（S13 経路の restart）で $streamError が null にリセットされ、DOM の error 表示もクリアされること", async () => {
    const m1 = makeManualFailableSource<string>();
    const failure = new Error("first run failed");
    const raw1: IState = {
      $streams: { tokens: { source: () => m1.iterable, fold: concatFold, initial: "" } },
    };
    const { host, shadowRoot, stateEl } = await connectHost(
      `<p id="err" data-wcs="textContent: $streamError.tokens"></p>`,
      raw1,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();

    m1.fail(failure);
    await flushAsync();
    expect(shadowRoot.querySelector("#err")!.textContent).toBe(String(failure));

    // 再 set（S13 経路）: 旧 registry 破棄 → 新宣言で再構築・再起動（= restart セマンティクス）
    const m2 = makeManualAsyncGenerator<string>();
    stateEl.setInitialState({
      $streams: { tokens: { source: () => m2.iterable, fold: concatFold, initial: "" } },
    });
    await flushAsync();

    // 値レベル: 新 entry の error は null（(re)start で null にリセット、設計書 §4-1）
    stateEl.createState("readonly", (s: IStateProxy) => {
      expect(s["$streamError.tokens"]).toBeNull();
      expect(s["$streamStatus.tokens"]).toBe("active");
    });
    // DOM binding もクリアされる（null → textContent 空文字）。
    // 通知の same-value 判定は entry フィールドでなく「最後に通知した観測値」
    // （lastNotifiedByStateElement — entry 再生成を跨いで生存）に対して行われるため、
    // 再 set で entry が作り直されても error 表示中 → null の遷移が $postUpdate で
    // 通知される（updateStreamStatus の dedup 修正・設計書 §4-3）。
    expect(shadowRoot.querySelector("#err")!.textContent).toBe("");

    host.remove();
  });

  it("§4-4 既知エッジ: 再 set で stream 宣言自体が消えた場合、コンパニオン binding は直前表示が残り、以後の読みは undefined になること（特性化）", async () => {
    const m = makeManualAsyncGenerator<string>();
    const { host, shadowRoot, stateEl } = await connectHost(
      `<p id="st" data-wcs="textContent: $streamStatus.tokens"></p>`,
      { $streams: { tokens: { source: () => m.iterable, fold: concatFold, initial: "" } } },
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("active");

    // 再 set で宣言が消える → 削除の通知は飛ばず直前表示が残る（設計書 §4-4 の許容エッジ。
    // 将来削除通知や台帳掃除を入れる場合はこの特性化と §4-4 を同時に更新すること）
    stateEl.setInitialState({ other: 1 });
    await flushAsync();
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("active");

    // 以後の読みは undefined 解決（registry から消えた名前は寛容規約で undefined）
    stateEl.createState("readonly", (s: IStateProxy) => {
      expect(s["$streamStatus.tokens"]).toBeUndefined();
      expect(s["$streamError.tokens"]).toBeUndefined();
    });

    host.remove();
  });

  it("S12 補2: error 状態のまま disconnect → 再 connect で status/error の binding が復旧すること（同一機序の再接続経路）", async () => {
    const m1 = makeManualFailableSource<string>();
    const m2 = makeManualAsyncGenerator<string>();
    const failure = new Error("stale error");
    // 1 run 目は失敗する source・2 run 目（再接続）は健全な iterable を返す
    // （makeManualFailableSource の failure は永続するため、同じ iterable を再消費すると
    //  新 run も即再失敗してしまい「復旧」を観測できない）
    let run = 0;
    const raw: IState = {
      $streams: {
        tokens: {
          source: () => (++run === 1 ? m1.iterable : m2.iterable),
          fold: concatFold,
          initial: "",
        },
      },
    };
    const { host, shadowRoot, stateEl } = await connectHost(
      `<p id="st" data-wcs="textContent: $streamStatus.tokens"></p>` +
        `<p id="err" data-wcs="textContent: $streamError.tokens"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();

    m1.fail(failure);
    await flushAsync();
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("error");
    expect(shadowRoot.querySelector("#err")!.textContent).toBe(String(failure));

    // error 表示のまま disconnect（abortAllStreams は registry 直接ミューテーションで通知しない）
    host.remove();
    expect(getStreamEntries(stateEl).get("tokens")!.status).toBe("idle");

    // 再 connect: startStream の updateStreamStatus("active", null) が
    // 「最後に通知した観測値」（error / failure）との差分で両パスを通知し、DOM が復旧する
    document.body.appendChild(host);
    await waitFor(() => shadowRoot.querySelector("#st")!.textContent === "active");
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("active");
    expect(shadowRoot.querySelector("#err")!.textContent).toBe("");

    host.remove();
  });

  it("S12 補3: 再接続ウィンドウ内の fresh 読みで idle を描画した computed が、restart の active 通知で復旧すること（abortAllStreams の無通知ミューテーションと dedup 台帳の同期・設計書 §4-3）", async () => {
    // 再接続の connectedCallback は $connectedCallback 完了後に startStreams を呼ぶため、
    // $connectedCallback 内の書き込み（n++）で enqueue された drain が startStreams より
    // 先に走り、動的依存（n → label）経由の getter 再計算が abortAllStreams 直後の
    // registry（idle）を fresh 読みして DOM に描画する。その後の
    // updateStreamStatus("active") が切断前の通知値（active）との同値判定で skip されると、
    // 無限 stream では以後 status 遷移が来ず DOM が恒久陳腐化する（台帳 invalidate で防ぐ）。
    const raw: IState = {
      n: 0,
      $connectedCallback() {
        (this as { n: number }).n++;
      },
      get label() {
        const self = this as Record<string, unknown>;
        return `${self.n}:${self["$streamStatus.tokens"]}`;
      },
      $streams: {
        tokens: {
          // 無限 stream（チャンクも終端も来ない）: run ごとに新しい pending iterable
          source: () => makeManualAsyncGenerator<string>().iterable,
          fold: concatFold,
          initial: "",
        },
      },
    };
    const { host, shadowRoot, stateEl } = await connectHost(
      `<p id="lb" data-wcs="textContent: label"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    expect(shadowRoot.querySelector("#lb")!.textContent).toBe("1:active");

    // disconnect: abortAllStreams が registry を無通知で idle / null にミューテーションする
    host.remove();
    expect(getStreamEntries(stateEl).get("tokens")!.status).toBe("idle");

    // 再 connect: fresh 読みが "2:idle" を経由しても、restart の active 通知は
    // dedup されず DOM が registry の正本（active）へ収束する
    document.body.appendChild(host);
    await waitFor(() => shadowRoot.querySelector("#lb")!.textContent === "2:active");
    expect(getStreamEntries(stateEl).get("tokens")!.status).toBe("active");
    expect(shadowRoot.querySelector("#lb")!.textContent).toBe("2:active");

    host.remove();
  });

  it("S17 完結: $streamStatus.tokens を binding した状態で、status 遷移時の $updatedCallback paths に $streamStatus.tokens が載ること", async () => {
    const m = makeManualAsyncGenerator<string>();
    const updatedLog: string[][] = [];
    const raw: IState = {
      $streams: { tokens: { source: () => m.iterable, fold: concatFold, initial: "" } },
      $updatedCallback(paths: string[]) {
        updatedLog.push(paths);
      },
    };
    const { host, shadowRoot } = await connectHost(
      `<p id="st" data-wcs="textContent: $streamStatus.tokens"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    updatedLog.length = 0; // 初期レンダ分をリセットして計測開始

    m.end();
    await flushAsync();

    // active → done 遷移が通常の更新として $updatedCallback に載る（設計書 §4-4）
    expect(updatedLog).toEqual([["$streamStatus.tokens"]]);
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("done");

    host.remove();
  });

  it("S12 補: disconnect → 再 connect 後も binding が継続動作すること（チャンクが DOM に反映・二重適用なし・console.error なし）", async () => {
    const errorSpy = vi.spyOn(console, "error");
    const run1 = makeManualAsyncGenerator<string>();
    const run2 = makeManualAsyncGenerator<string>();
    let sourceCalls = 0;
    const fold = vi.fn(concatFold);
    const raw: IState = {
      $streams: {
        tokens: {
          source: () => (++sourceCalls === 1 ? run1.iterable : run2.iterable),
          fold,
          initial: "X",
        },
      },
    };
    const { host, shadowRoot, stateEl } = await connectHost(
      `<p id="val" data-wcs="textContent: tokens"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();

    run1.push("a");
    await flushAsync();
    const val = shadowRoot.querySelector("#val")!;
    expect(val.textContent).toBe("Xa");

    // binding は絶対アドレス単位で登録される。再接続で二重登録されないことの基準値を取る
    const tokensAbsAddress = createAbsoluteStateAddress(
      getAbsolutePathInfo(stateEl, getPathInfo("tokens")),
      null,
    );
    const bindingCountBefore = countLedgerBindings(peekBindingsByAbsoluteStateAddress(tokensAbsAddress));
    expect(bindingCountBefore).toBeGreaterThanOrEqual(1);

    // disconnect → 再 connect（initial から再起動、S12。値のリセットも binding に反映される）
    host.remove();
    document.body.appendChild(host);
    await waitFor(() => sourceCalls === 2);
    expect(sourceCalls).toBe(2);
    await flushAsync();
    expect(val.textContent).toBe("X"); // initial リセットが再接続後の binding に届く

    // 再接続後のチャンクも DOM に反映される（binding の継続動作）
    run2.push("b");
    await flushAsync();
    expect(val.textContent).toBe("Xb");

    // 二重適用なし: fold は各チャンクにちょうど 1 回（二重 consume なし）、
    // binding 登録数も再接続前と同一（再スキャンによる重複登録なし）
    expect(fold.mock.calls).toEqual([["X", "a"], ["X", "b"]]);
    expect(countLedgerBindings(peekBindingsByAbsoluteStateAddress(tokensAbsAddress))).toBe(bindingCountBefore);
    expect(errorSpy).not.toHaveBeenCalled();

    host.remove();
  });

  it("computed 連動: $streamStatus.tokens を読む getter が done 遷移で再計算され binding に反映されること（$postUpdate → walkDependency、設計書 §4-3）", async () => {
    const m = makeManualAsyncGenerator<string>();
    const updatedLog: string[][] = [];
    const raw: IState = {
      $streams: { tokens: { source: () => m.iterable, fold: concatFold, initial: "" } },
      get streaming() {
        // happy-dom の textContent セッターは falsy 値（false）を空文字扱いする
        // （実ブラウザは "false" を表示する）ため、環境非依存の固定になるよう文字列化して
        // 返す。依存追跡の機構（getter 内 dotted 読み → 動的依存登録 → $postUpdate の
        // walkDependency で dirty 化）は boolean 版とまったく同一。
        return String((this as Record<string, unknown>)["$streamStatus.tokens"] === "active");
      },
      $updatedCallback(paths: string[]) {
        updatedLog.push(paths);
      },
    };
    const { host, shadowRoot } = await connectHost(
      `<p id="c" data-wcs="textContent: streaming"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    expect(shadowRoot.querySelector("#c")!.textContent).toBe("true"); // active 中
    updatedLog.length = 0;

    m.end();
    await flushAsync();

    // $postUpdate("$streamStatus.tokens") の walkDependency が動的依存
    // （getter 内の dotted 読みで登録済み）を辿って computed を dirty 化・再計算する
    expect(shadowRoot.querySelector("#c")!.textContent).toBe("false");
    expect(updatedLog.length).toBe(1);
    expect(updatedLog[0]).toContain("streaming");

    host.remove();
  });

  it("same-value skip: status/error とも変化なしの updateStreamStatus では $updatedCallback が発火しないこと（runtime 側の同値ガード）", async () => {
    const m = makeManualAsyncGenerator<string>();
    const updatedLog: string[][] = [];
    const raw: IState = {
      $streams: { tokens: { source: () => m.iterable, fold: concatFold, initial: "" } },
      $updatedCallback(paths: string[]) {
        updatedLog.push(paths);
      },
    };
    const { host, shadowRoot, stateEl } = await connectHost(
      `<p id="st" data-wcs="textContent: $streamStatus.tokens"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    updatedLog.length = 0;

    // active 中に同値（"active", null）を再セット → 名前空間パスは setByAddress を
    // 通らないため sameValueGuard は効かず、runtime 側の同値判定が enqueue ごと skip する
    const entry = getStreamEntries(stateEl).get("tokens")!;
    expect(entry.status).toBe("active");
    updateStreamStatus(stateEl, entry, "active", null);
    await flushAsync();
    expect(updatedLog).toEqual([]); // 通知なし（binding 適用も起きない）
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("active");

    // 計測器の健全性確認: 実変化は同じ器械でちゃんと観測される
    m.end();
    await flushAsync();
    expect(updatedLog).toEqual([["$streamStatus.tokens"]]);
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("done");

    host.remove();
  });

  it("S9/S10 補: 1 回の error 遷移で status と error の両 binding が同一 drain に coalesce されて反映されること", async () => {
    const m = makeManualFailableSource<string>();
    const failure = new Error("coalesce check");
    const updatedLog: string[][] = [];
    const raw: IState = {
      $streams: { tokens: { source: () => m.iterable, fold: concatFold, initial: "" } },
      $updatedCallback(paths: string[]) {
        updatedLog.push(paths);
      },
    };
    const { host, shadowRoot } = await connectHost(
      `<p id="st" data-wcs="textContent: $streamStatus.tokens"></p>` +
        `<p id="err" data-wcs="textContent: $streamError.tokens"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    updatedLog.length = 0;

    m.fail(failure);
    await flushAsync();

    // updateStreamStatus は status / error の 2 つの $postUpdate を同期発行する →
    // updater の microtask バッチにまとまり、binding 反映と $updatedCallback は 1 drain
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("error");
    expect(shadowRoot.querySelector("#err")!.textContent).toBe(String(failure));
    expect(updatedLog.length).toBe(1);
    expect([...updatedLog[0]].sort()).toEqual(["$streamError.tokens", "$streamStatus.tokens"]);

    host.remove();
  });
});
