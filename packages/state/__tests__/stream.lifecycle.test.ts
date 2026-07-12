/**
 * stream.lifecycle.test.ts
 *
 * `$streams` の State ライフサイクル接続の統合テスト（A-6）。
 * 実 `<wcs-state>` 要素を happy-dom で connect し、setInitialState 経由で
 * state を与える既存流儀（integration.eventTokenBinding.test.ts）に従う。
 *
 * 受け入れ ID（docs/state-streams-design.md §10-2）:
 * - S1:  eager 起動（$connectedCallback → args 評価 → source の順・connect 完了で active）
 * - S2:  SSR 非起動（inSsr() で source が呼ばれない・値は initial のまま）
 * - S3:  1 tick 複数チャンク（fold は全チャンクに適用。反映はチャンクごとに 1 drain —
 *        設計書 §6-1 改定済みの契約。テスト内コメント参照）
 * - S4:  sameValueGuard（同値 primitive チャンクで $updatedCallback が呼ばれない）
 * - S12: disconnect → abort・再接続 → initial から再起動（「続きから」にならない）
 *        補: $connectedCallback の await 中の切断で startStreams を skip し
 *        connectedCallbackPromise が解決すること（切断ガードの回帰テスト）
 *        補2: $disconnectedCallback が throw しても stream の後始末が完遂すること
 *        （disconnectedCallback の try/finally の回帰テスト）
 *        補3: $connectedCallback の await 中の「切断 → 即再接続」で source が
 *        二重起動しないこと（connect 世代ガードの回帰テスト）
 * - S13: 接続中の `_state` 再 set（旧 abort・新宣言で再構築・二重起動なし）
 *        補3: $connectedCallback 内の setInitialState でもセッター起動と
 *        connectedCallback 末尾起動が重複しない（_streamsStartedGeneration ガード）
 * - S16: stream 値を読む computed がチャンク到着で再計算される
 * - S17: $updatedCallback の paths に stream 名が載る
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getActiveStateElements } from "../src/stream/activeStateElements";
import { getStreamEntries } from "../src/stream/streamRegistry";
import { startStreams } from "../src/stream/streamRuntime";
import type { IState } from "../src/types";
import { makeManualAsyncGenerator } from "./helpers/fakeStreamSources";
import { flushAsync, waitFor, makeConnectHost } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("stream-lc-host");

/** connectHost を使わず手動でホストを組むテスト（enable-ssr / 切断ガード）用の連番 */
let manualHostSeq = 0;

describe("$streams State ライフサイクル統合", () => {
  it("S1: connect 完了で status が active になり、$connectedCallback → args 評価 → source の順で呼ばれること", async () => {
    const m = makeManualAsyncGenerator<string>();
    const callLog: string[] = [];
    const { host, stateEl } = await connectHost("", {
      prompt: "hello",
      $connectedCallback() {
        callLog.push("connected");
      },
      $streams: {
        tokens: {
          args: (s: IState) => {
            callLog.push("args");
            return s.prompt;
          },
          source: (_args: unknown, _signal: AbortSignal) => {
            callLog.push("source");
            return m.iterable;
          },
          fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
          initial: "",
        },
      },
    });

    // $connectedCallback で仕込んだ初期値を args が読める後置順（設計書 §2-3）
    expect(callLog).toEqual(["connected", "args", "source"]);
    expect(getStreamEntries(stateEl).get("tokens")!.status).toBe("active");

    host.remove();
  });

  it("S1 補: enable-ssr のクライアント側でも起動すること（$connectedCallback はスキップ・startStreams は走る）", async () => {
    const m = makeManualAsyncGenerator<string>();
    const connectedFn = vi.fn();
    const source = vi.fn(() => m.iterable);
    const host = document.createElement(`stream-lc-manual-${++manualHostSeq}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state enable-ssr></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({
      $connectedCallback: connectedFn,
      $streams: { ticker: { source } },
    });
    await stateEl.connectedCallbackPromise;

    // enable-ssr クライアント: $connectedCallback は SSR 済みとしてスキップされるが、
    // stream はシリアライズ不能なランタイム副作用なので起動される（SSR スキップは inSsr() のみで判定）
    expect(connectedFn).not.toHaveBeenCalled();
    expect(source).toHaveBeenCalledTimes(1);
    expect(getStreamEntries(stateEl).get("ticker")!.status).toBe("active");

    host.remove();
  });

  it("S2: SSR モードでは source が呼ばれず、値は initial のまま（status は idle）", async () => {
    document.documentElement.setAttribute("data-wcs-server", "");
    let host: HTMLElement | null = null;
    try {
      const source = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
      const raw: IState = {
        $streams: {
          tokens: {
            source,
            fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
            initial: "seed",
          },
        },
      };
      const connected = await connectHost("", raw);
      host = connected.host;

      expect(source).not.toHaveBeenCalled();
      expect(getStreamEntries(connected.stateEl).get("tokens")!.status).toBe("idle");
      // パースと値プロパティの実体化（initial）は SSR でも行われる（§7-1）
      expect(raw.tokens).toBe("seed");
    } finally {
      host?.remove();
      document.documentElement.removeAttribute("data-wcs-server");
    }
  });

  it("S3: 1 tick に複数チャンク → fold は全チャンクに順に適用され、binding は最終値を表示すること（チャンクごとに 1 drain — §6-1 改定契約の特性化）", async () => {
    const m = makeManualAsyncGenerator<string>();
    const fold = vi.fn((acc: unknown, chunk: unknown) => `${acc}${chunk}`);
    const updatedLog: string[][] = [];
    const raw: IState = {
      $streams: { tokens: { source: () => m.iterable, fold, initial: "" } },
      $updatedCallback(paths: string[]) {
        updatedLog.push(paths);
      },
    };
    const { host, shadowRoot } = await connectHost(
      `<p data-wcs="textContent: tokens"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    updatedLog.length = 0; // 初期レンダ分をリセットして計測開始

    m.push("a");
    m.push("b");
    m.push("c");
    await flushAsync();

    // fold は全チャンクに正確に適用される（チャンクの取りこぼし・重複なし）
    expect(fold.mock.calls).toEqual([["", "a"], ["a", "b"], ["ab", "c"]]);
    expect(raw.tokens).toBe("abc");
    expect(shadowRoot.querySelector("p")!.textContent).toBe("abc");
    // 【契約の固定（裁定済み・設計書 §6-1 改定 2026-07-11）】チャンク反映の粒度は
    // 「チャンクごとに 1 drain」が正: updater の drain は microtask バッチ単位の
    // coalesce であり、async iterator 経由のチャンクは `await iterator.next()` により
    // 各々別 microtask で届くため、DOM 書き込み・$updatedCallback もチャンク数回になる
    // （flush レートはチャンク到着レートに有界。signals PoC の effect スケジューラと
    // 同一挙動＝共有契約）。docs/streams.md も同じ契約を規範化している。
    expect(updatedLog).toEqual([["tokens"], ["tokens"], ["tokens"]]);

    host.remove();
  });

  it("S4: 同値 primitive チャンクは sameValueGuard により $updatedCallback が呼ばれないこと", async () => {
    const m = makeManualAsyncGenerator<string>();
    const updatedLog: string[][] = [];
    const raw: IState = {
      // fold 省略 = latest（最新チャンクで置換）
      $streams: { ticker: { source: () => m.iterable } },
      $updatedCallback(paths: string[]) {
        updatedLog.push(paths);
      },
    };
    const { host, shadowRoot } = await connectHost(
      `<p data-wcs="textContent: ticker"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    updatedLog.length = 0;

    m.push("x");
    await flushAsync();
    expect(updatedLog).toEqual([["ticker"]]); // 初回は変化なので通知される

    m.push("x"); // 同値 primitive → setByAddress の same-value guard で丸ごとスキップ
    await flushAsync();
    expect(updatedLog).toEqual([["ticker"]]); // 追加の通知なし
    expect(raw.ticker).toBe("x");
    expect(shadowRoot.querySelector("p")!.textContent).toBe("x");

    host.remove();
  });

  it("S12: disconnect で abort・status idle になり、再接続で initial から再起動すること（「続きから」にならない）", async () => {
    const run1 = makeManualAsyncGenerator<string>();
    const run2 = makeManualAsyncGenerator<string>();
    let sourceCalls = 0;
    const raw: IState = {
      $streams: {
        tokens: {
          source: () => (++sourceCalls === 1 ? run1.iterable : run2.iterable),
          fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
          initial: "X",
        },
      },
    };
    const { host, stateEl } = await connectHost("", raw);
    const entry = getStreamEntries(stateEl).get("tokens")!;
    expect(sourceCalls).toBe(1);

    run1.push("a");
    await flushAsync();
    expect(raw.tokens).toBe("Xa");

    // disconnect → controller abort・status idle（registry は保持）
    const controller1 = entry.controller!;
    host.remove();
    expect(controller1.signal.aborted).toBe(true);
    expect(entry.status).toBe("idle");
    expect(entry.controller).toBeNull();

    // 旧 run の遅延チャンクは stale-drop され値に混ざらない
    run1.push("z");
    await flushAsync();
    expect(raw.tokens).toBe("Xa");

    // 再接続 → connectedCallback の startStreams で initial から再起動
    document.body.appendChild(host);
    await waitFor(() => sourceCalls === 2);
    expect(sourceCalls).toBe(2);
    expect(entry.status).toBe("active");
    expect(raw.tokens).toBe("X"); // 「切断前の続きから」ではなく initial にリセット

    run2.push("b");
    await flushAsync();
    expect(raw.tokens).toBe("Xb"); // 新 run は initial の上に畳む

    host.remove();
  });

  it("S12 補: $connectedCallback の await 中に切断された場合、startStreams を skip して connectedCallbackPromise が解決すること", async () => {
    // 切断ガード（connectedCallback 末尾の _rootNode !== null）の回帰テスト。
    // ガードなしだと startStream 内の createState が rootNode 解決の raiseError で
    // throw し、connectedCallbackPromise が永遠に未解決になる（wcs-router の
    // unmount 相当のシナリオ。この test は timeout で fail する）。
    const source = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    let releaseConnected!: () => void;
    const gate = new Promise<void>((r) => {
      releaseConnected = r;
    });
    const host = document.createElement(`stream-lc-manual-${++manualHostSeq}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({
      async $connectedCallback() {
        await gate;
      },
      $streams: { ticker: { source } },
    });

    // $connectedCallback が gate を await している状態まで進めてから切断する
    await flushAsync();
    host.remove();
    releaseConnected();

    // ガードにより throw せず resolve する（ここがハングしたらガード欠落）
    await stateEl.connectedCallbackPromise;

    // 切断済みなので stream は起動されない（source 未呼出・status は idle のまま）
    expect(source).not.toHaveBeenCalled();
    expect(getStreamEntries(stateEl).get("ticker")!.status).toBe("idle");
  });

  it("S12 補3: $connectedCallback の await 中に「切断 → 即再接続」されても、source が再接続 1 回につき 1 回だけ起動すること（connect 世代ガード）", async () => {
    // 世代ガード（connectedCallback 冒頭で捕捉した世代の末尾照合）の回帰テスト。
    // 陳腐化した旧 connect の再開時、_rootNode !== null ガードは新 connect が
    // _rootNode を再設定済みのため素通りする（DOM 移動・router remount 相当）。
    // ガードなしだと旧 connect と新 connect の双方が startStreams を実行し、
    // 同一の再接続に対して source が 2 回起動する（さらに旧 connect 側の起動は
    // 新 connect の $connectedCallback 完了を待たず、S1 の順序保証も破れる）。
    const source = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    let connectedCalls = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    const host = document.createElement(`stream-lc-manual-${++manualHostSeq}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({
      async $connectedCallback() {
        // 初回 connect (#1) のみ待機させ、その間に切断 → 即再接続を起こす
        if (++connectedCalls === 1) {
          await firstGate;
        }
      },
      $streams: { ticker: { source } },
    });

    // connect #1 の $connectedCallback が gate を await している状態まで進めてから
    // 切断 → 即再接続する（connect #2 は gate なしで完走する）
    await waitFor(() => connectedCalls === 1);
    host.remove();
    document.body.appendChild(host);
    await waitFor(() => source.mock.calls.length === 1);
    expect(source).toHaveBeenCalledTimes(1); // connect #2 の末尾起動のみ

    // 陳腐化した connect #1 の再開を解放しても、世代不一致で startStreams は skip される
    // （ガードなしだとここで source が 2 回目の起動をする）
    releaseFirst();
    await flushAsync();
    expect(source).toHaveBeenCalledTimes(1);
    expect(getStreamEntries(stateEl).get("ticker")!.status).toBe("active");

    // 以降の通常の再接続は世代が進んで普通に起動する（ガードの副作用がない）
    host.remove();
    document.body.appendChild(host);
    await waitFor(() => source.mock.calls.length === 2);
    expect(source).toHaveBeenCalledTimes(2);
    expect(getStreamEntries(stateEl).get("ticker")!.status).toBe("active");

    host.remove();
  });

  it("S13: 接続中の setInitialState で旧 stream が abort され、新宣言で再構築・再起動されること（二重起動なし）", async () => {
    const run1 = makeManualAsyncGenerator<string>();
    const source1 = vi.fn(() => run1.iterable);
    const raw1: IState = {
      $streams: { ticker: { source: source1 } },
    };
    const { host, stateEl } = await connectHost("", raw1);
    expect(source1).toHaveBeenCalledTimes(1);

    run1.push("old");
    await flushAsync();
    expect(raw1.ticker).toBe("old");
    const entry1 = getStreamEntries(stateEl).get("ticker")!;
    const controller1 = entry1.controller!;

    // 接続中の再 set（S13）: clearStreamRegistry → 新宣言パース → 即再起動
    const run2 = makeManualAsyncGenerator<string>();
    const source2 = vi.fn(() => run2.iterable);
    const raw2: IState = {
      $streams: {
        ticker: {
          source: source2,
          fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
          initial: "N",
        },
      },
    };
    stateEl.setInitialState(raw2);

    expect(controller1.signal.aborted).toBe(true); // 旧 stream は abort 済み
    expect(source1).toHaveBeenCalledTimes(1); // 旧 source は再起動されない
    expect(source2).toHaveBeenCalledTimes(1); // 新 source は 1 回だけ（二重起動なし）
    const entry2 = getStreamEntries(stateEl).get("ticker")!;
    expect(entry2).not.toBe(entry1); // registry は新宣言で再構築
    expect(entry2.status).toBe("active");
    expect(raw2.ticker).toBe("N");

    // 旧 run の遅延チャンクは新 state に流れない（stale-drop）
    run1.push("zombie");
    await flushAsync();
    expect(raw2.ticker).toBe("N");
    expect(raw1.ticker).toBe("old");

    // 新 run のチャンクは新 initial の上に畳まれる
    run2.push("ew");
    await flushAsync();
    expect(raw2.ticker).toBe("New");
    expect(source2).toHaveBeenCalledTimes(1);

    host.remove();
  });

  it("S13 補: 切断中の setInitialState では起動せず、再接続時に新宣言で起動すること", async () => {
    const source1 = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    const { host, stateEl } = await connectHost("", {
      $streams: { ticker: { source: source1 } },
    });
    expect(source1).toHaveBeenCalledTimes(1);
    host.remove();

    // 切断中（_rootNode === null）の再 set は宣言の再構築のみで起動しない
    const source2 = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    stateEl.setInitialState({ $streams: { ticker: { source: source2 } } });
    expect(source2).not.toHaveBeenCalled();
    expect(getStreamEntries(stateEl).get("ticker")!.status).toBe("idle");

    // 再接続で新宣言が起動する（旧 source は起動されない）
    document.body.appendChild(host);
    await waitFor(() => source2.mock.calls.length === 1);
    expect(source2).toHaveBeenCalledTimes(1);
    expect(source1).toHaveBeenCalledTimes(1);
    expect(getStreamEntries(stateEl).get("ticker")!.status).toBe("active");

    host.remove();
  });

  it("S13 補2: 旧 state の setter と同名の stream を新宣言に持つ再 set が偽陽性の衝突エラーにならないこと", async () => {
    // 旧宣言では tokens は setter（_setterPaths に載る）
    const { host, stateEl } = await connectHost("", {
      set tokens(_v: string) {
        /* 旧宣言の setter */
      },
    } as unknown as IState);

    // 再 set: 新 state に setter は無く tokens は stream 宣言。
    // State._state セッターが _setterPaths を clear しないと、旧宣言の残骸が
    // processStreamsDeclaration の衝突検査に命中して raiseError する（回帰テスト）。
    const m = makeManualAsyncGenerator<string>();
    stateEl.setInitialState({
      $streams: { tokens: { source: () => m.iterable } },
    });

    expect(getStreamEntries(stateEl).get("tokens")!.status).toBe("active");

    host.remove();
  });

  it("S13 補3: $connectedCallback 内の setInitialState でも新宣言の source が connect 1 回につき 1 回だけ起動すること（セッター起動と末尾起動の重複防止）", async () => {
    // $connectedCallback 実行中の再 set は _state セッター側の startStreams
    // （_initialized && _rootNode !== null が真）で新宣言を即起動する。
    // _streamsStartedGeneration ガードがないと connectedCallback 末尾の
    // startStreams も走り、connect 1 回で新 source が 2 回起動する
    // （1 回目は即 abort — 状態は壊れないが副作用を持つ source が 2 回発火する）。
    const source1 = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    const source2 = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    const host = document.createElement(`stream-lc-manual-${++manualHostSeq}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({
      $connectedCallback() {
        // 接続処理の途中（eager 起動前）にユーザーコードが state を差し替えるシナリオ
        stateEl.setInitialState({ $streams: { ticker: { source: source2 } } });
      },
      $streams: { ticker: { source: source1 } },
    });
    await stateEl.connectedCallbackPromise;

    // 旧宣言は eager 起動（$connectedCallback 完了後）の前に clearStreamRegistry で
    // 削除されるため一度も起動されない
    expect(source1).not.toHaveBeenCalled();
    // 新宣言はセッター側の startStreams の 1 回のみ（末尾の startStreams は skip）
    expect(source2).toHaveBeenCalledTimes(1);
    expect(getStreamEntries(stateEl).get("ticker")!.status).toBe("active");

    host.remove();

    // 再接続では末尾の startStreams が通常どおり走る（connect 世代が進み、
    // セッター起動時に記録した世代と不一致になるため skip されない）
    document.body.appendChild(host);
    await waitFor(() => source2.mock.calls.length === 2);
    expect(source2).toHaveBeenCalledTimes(2);
    expect(getStreamEntries(stateEl).get("ticker")!.status).toBe("active");

    host.remove();
  });

  it("S16: stream 値を読む computed（getter）がチャンク到着で再計算され、同一 drain で binding に反映されること", async () => {
    const m = makeManualAsyncGenerator<string>();
    const updatedLog: string[][] = [];
    const raw: IState = {
      $streams: { tokens: { source: () => m.iterable, fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`, initial: "" } },
      get shout() {
        return `${(this as Record<string, unknown>).tokens}!`;
      },
      $updatedCallback(paths: string[]) {
        updatedLog.push(paths);
      },
    };
    const { host, shadowRoot } = await connectHost(
      `<p id="raw" data-wcs="textContent: tokens"></p><p id="computed" data-wcs="textContent: shout"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    expect(shadowRoot.querySelector("#computed")!.textContent).toBe("!"); // 初期レンダは initial 由来
    updatedLog.length = 0;

    m.push("a");
    await flushAsync();

    // walkDependency により computed が dirty 化・再計算され、チャンク書き込みと同一 drain で反映される
    expect(shadowRoot.querySelector("#raw")!.textContent).toBe("a");
    expect(shadowRoot.querySelector("#computed")!.textContent).toBe("a!");
    expect(updatedLog).toHaveLength(1); // 値と computed は 1 回の flush に coalesce される
    expect([...updatedLog[0]].sort()).toEqual(["shout", "tokens"]);

    host.remove();
  });

  it("S17: $updatedCallback の paths に stream 名が載ること", async () => {
    const m = makeManualAsyncGenerator<string>();
    const updatedLog: string[][] = [];
    const raw: IState = {
      $streams: { tokens: { source: () => m.iterable, fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`, initial: "" } },
      $updatedCallback(paths: string[]) {
        updatedLog.push(paths);
      },
    };
    const { host, shadowRoot } = await connectHost(
      `<p data-wcs="textContent: tokens"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    updatedLog.length = 0;

    m.push("a");
    await flushAsync();

    expect(updatedLog.length).toBeGreaterThanOrEqual(1);
    expect(updatedLog[0]).toContain("tokens"); // 通常の更新として paths に載る（§4-4）
    host.remove();
  });

  it("S12 補2: $disconnectedCallback が throw しても stream の後始末（abort・idle・restart 対象からの除外）が実行されること", async () => {
    // disconnectedCallback の try/finally の回帰テスト。finally が無いと
    // abortAllStreams が飛び、stream が消費を続け（ゾンビ I/O）、
    // activeStateElements の強参照残留で GC・restart 除外も効かなくなる
    // （設計書 §3-2 / §5-1 違反）。
    const m = makeManualAsyncGenerator<string>();
    const fold = vi.fn((acc: unknown, chunk: unknown) => `${acc}${chunk}`);
    const raw: IState = {
      $disconnectedCallback() {
        throw new Error("user disconnect boom");
      },
      $streams: { tokens: { source: () => m.iterable, fold, initial: "" } },
    };
    const { host, stateEl } = await connectHost("", raw);
    const entry = getStreamEntries(stateEl).get("tokens")!;
    const controller = entry.controller!;

    m.push("a");
    await flushAsync();
    expect(raw.tokens).toBe("a");

    // throw は従来どおり呼び出し元（remove）へ伝播する（観測可能挙動は変えない）
    expect(() => host.remove()).toThrow("user disconnect boom");

    // finally により後始末は完遂している: abort・idle・restart 対象からの除外
    expect(controller.signal.aborted).toBe(true);
    expect(entry.status).toBe("idle");
    expect(entry.controller).toBeNull();
    expect(getActiveStateElements().has(stateEl)).toBe(false);

    // abort 済み run の遅延チャンクは stale-drop され fold に到達しない（ゾンビ I/O なし）
    const foldCallCount = fold.mock.calls.length;
    m.push("zombie");
    await flushAsync();
    expect(fold.mock.calls.length).toBe(foldCallCount);
    expect(raw.tokens).toBe("a");
  });

  it("§3-2: eager 起動（startStreams）での args throw は error 正規化されず loud fail すること（drain restart 経路との対比）", async () => {
    const m = makeManualAsyncGenerator<string>();
    const boom = new Error("eager boom");
    let shouldThrow = false;
    const { host, stateEl } = await connectHost("", {
      p: 1,
      $streams: {
        tokens: {
          source: () => m.iterable,
          args: (s: IState) => {
            if (shouldThrow) throw boom;
            return s.p;
          },
        },
      },
    });
    expect(getStreamEntries(stateEl).get("tokens")!.status).toBe("active");

    // eager 経路（connect 時と同じ startStreams 直呼び）は try/catch で飲まれず throw が伝播する。
    // drain restart 経路での error 正規化（§3-2 規範 3）との対比は stream.restart.test.ts が固定。
    // 将来 startStreams に error 正規化が混入するリグレッションをここで検出する。
    shouldThrow = true;
    expect(() => startStreams(stateEl)).toThrow("eager boom");

    host.remove();
  });
});
