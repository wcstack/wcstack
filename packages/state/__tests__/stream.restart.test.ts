/**
 * stream.restart.test.ts
 *
 * `$streams` の依存駆動 cancel/restart（Phase C の核心・C-3）の統合テスト。
 * 実 `<wcs-state>` を happy-dom で connect する connectHost 流儀
 * （stream.lifecycle.test.ts と同型）＋ fakeStreamSources。
 *
 * 受け入れ ID（docs/state-streams-design.md §3-2 / §10）:
 * - P5:  依存パス書き込み → 旧 run abort・値 initial リセット・新 args で張り直し・
 *        旧 run の遅延チャンクは混ざらない（stale-drop）
 * - S5:  同一 tick の複数依存書き込み（同一依存・異なる依存とも）は 1 restart に coalesce
 * - S6:  無関係パスの書き込みでは restart しない
 * - S7:  args が getter（computed）を読む → getter の依存元の書き換えで restart
 * - S18: stream 間連鎖（A の値 / $streamStatus.A を B の args が読む → A の更新で B が restart）
 * - ほか: 同一 drain 同居は restart が勝つ / done・error からの再試行（status 不問）/
 *        restart 中の args throw の error 正規化と他 entry の継続 /
 *        args throw 後も前回成功 run の deps 保持で依存書き込みから再試行・回復できる /
 *        切断済み stateElement は restart しない（hits 収集後の同期切断も含む）/
 *        depAddresses の per-run 再捕捉
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getActiveStateElements } from "../src/stream/activeStateElements";
import { getStreamEntries } from "../src/stream/streamRegistry";
import type { IState } from "../src/types";
import { makeManualAsyncGenerator } from "./helpers/fakeStreamSources";

beforeAll(() => {
  bootstrapState();
});

/** マイクロタスクを出し切る（updater の drain・consume ループ・restart 連鎖の全てを進める） */
const flushAsync = () => new Promise<void>((r) => setTimeout(r, 0));

let hostSeq = 0;

/**
 * ShadowRoot 内に <wcs-state> と任意のマークアップを持つホストを組み立てて接続する。
 * ShadowRoot 単位で state 名前空間と binding 構築が閉じるため、テスト間で干渉しない。
 */
async function connectHost(markup: string, initialState: IState): Promise<{
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  stateEl: State;
}> {
  const host = document.createElement(`stream-restart-host-${++hostSeq}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${markup}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initialState);
  await stateEl.connectedCallbackPromise;
  return { host, shadowRoot, stateEl };
}

/** writable proxy 経由で state を書き換える（外部からの依存パス書き込みを模す） */
function writeState(stateEl: State, mutate: (s: IState) => void): void {
  stateEl.createState("writable", mutate);
}

/**
 * run ごとに新しい manual generator を払い出し、受け取った args / signal を記録する
 * source を作る（P5 系の張り直し観測用）。
 */
function makeRecordingSource() {
  const runs: ReturnType<typeof makeManualAsyncGenerator<string>>[] = [];
  const received: unknown[] = [];
  const signals: AbortSignal[] = [];
  const source = vi.fn((args: unknown, signal: AbortSignal) => {
    received.push(args);
    signals.push(signal);
    const m = makeManualAsyncGenerator<string>();
    runs.push(m);
    return m.iterable;
  });
  return { source, runs, received, signals };
}

describe("$streams 依存駆動 restart（Phase C）", () => {
  it("P5: 依存パスの書き換えで旧 run が abort・値が initial にリセットされ、新 args で source が張り直されること（旧 run の遅延チャンクは stale-drop）", async () => {
    const { source, runs, received, signals } = makeRecordingSource();
    const raw: IState = {
      prompt: "one",
      $streams: {
        tokens: {
          args: (s: IState) => s.prompt,
          source,
          fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
          initial: "",
        },
      },
    };
    const { host, stateEl } = await connectHost("", raw);
    expect(received).toEqual(["one"]); // eager 起動は現在の依存値で

    runs[0].push("a");
    await flushAsync();
    expect(raw.tokens).toBe("a");

    // 依存パス書き込み → drain → restart
    writeState(stateEl, (s) => {
      s.prompt = "two";
    });
    await flushAsync();

    expect(signals[0].aborted).toBe(true); // 旧 run は abort
    expect(source).toHaveBeenCalledTimes(2); // 新 args で張り直し
    expect(received[1]).toBe("two");
    expect(raw.tokens).toBe(""); // 値は initial にリセット
    expect(getStreamEntries(stateEl).get("tokens")!.status).toBe("active");

    // 旧 run の遅延チャンクは stale-drop され新しい値に混ざらない
    runs[0].push("zombie");
    await flushAsync();
    expect(raw.tokens).toBe("");

    // 新 run のチャンクは initial の上に畳まれる
    runs[1].push("b");
    await flushAsync();
    expect(raw.tokens).toBe("b");

    host.remove();
  });

  it("S5: 同一 tick に同一依存を 3 回書いても restart はちょうど 1 回に coalesce されること", async () => {
    const { source, received } = makeRecordingSource();
    const raw: IState = {
      prompt: "p0",
      $streams: { tokens: { args: (s: IState) => s.prompt, source } },
    };
    const { host, stateEl } = await connectHost("", raw);
    expect(source).toHaveBeenCalledTimes(1);

    // 同一 tick の複数書き込みは updater の microtask バッチに coalesce され、
    // drain リスナーの hit 収集 → 一括実行で restart は entry あたり最大 1 回になる。
    // restart 起因の書き込み（initial リセット・status 通知）は新しいバッチを作るが
    // 自分の依存（prompt）には当たらないため再 hit しない（drain 再入なし）。
    writeState(stateEl, (s) => {
      s.prompt = "p1";
    });
    writeState(stateEl, (s) => {
      s.prompt = "p2";
    });
    writeState(stateEl, (s) => {
      s.prompt = "p3";
    });
    await flushAsync();

    expect(source).toHaveBeenCalledTimes(2); // eager + restart 1 回
    expect(received[1]).toBe("p3"); // restart は tick 終了時の最終状態の args で走る

    host.remove();
  });

  it("S5 補: 同一 tick に異なる依存 2 つを書いても restart は 1 回であること", async () => {
    const { source, received } = makeRecordingSource();
    const raw: IState = {
      p: "P0",
      q: "Q0",
      $streams: { tokens: { args: (s: IState) => `${s.p}/${s.q}`, source } },
    };
    const { host, stateEl } = await connectHost("", raw);
    expect(source).toHaveBeenCalledTimes(1);
    expect(received[0]).toBe("P0/Q0");

    // 両方とも depAddresses 内 → 同一バッチで hit しても entry あたり 1 restart
    writeState(stateEl, (s) => {
      s.p = "P1";
      s.q = "Q1";
    });
    await flushAsync();

    expect(source).toHaveBeenCalledTimes(2);
    expect(received[1]).toBe("P1/Q1"); // 両方の最終値が 1 回の restart に反映される

    host.remove();
  });

  it("S6: 無関係パスの書き込みでは restart しないこと", async () => {
    const { source, runs } = makeRecordingSource();
    const raw: IState = {
      prompt: "p0",
      other: "x0",
      $streams: {
        tokens: {
          args: (s: IState) => s.prompt,
          source,
          fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
          initial: "",
        },
      },
    };
    const { host, stateEl } = await connectHost("", raw);
    runs[0].push("a");
    await flushAsync();
    expect(raw.tokens).toBe("a");

    writeState(stateEl, (s) => {
      s.other = "x1"; // depAddresses と交差しない
    });
    await flushAsync();

    expect(source).toHaveBeenCalledTimes(1); // restart なし
    expect(raw.tokens).toBe("a"); // 値もリセットされない
    expect(getStreamEntries(stateEl).get("tokens")!.status).toBe("active");

    host.remove();
  });

  it("S7: args が getter（computed）を読む場合、getter の依存元の書き換えで restart すること", async () => {
    const { source, received } = makeRecordingSource();
    const raw: IState = {
      count: 2,
      unit: 10,
      get total(): number {
        return (this as IState).count * (this as IState).unit;
      },
      $streams: { tokens: { args: (s: IState) => s.total, source } },
    };
    const { host, stateEl } = await connectHost("", raw);
    expect(source).toHaveBeenCalledTimes(1);
    expect(received[0]).toBe(20);

    // 依存元 count の書き換え → walkDependency が total もバッチに載せる →
    // depAddresses（total を含む）と交差して restart（キャッシュ命中/ミスどちらの
    // 捕捉形でも成立する — stream.argsTrace.test.ts で単体側を固定済み）
    writeState(stateEl, (s) => {
      s.count = 3;
    });
    await flushAsync();

    expect(source).toHaveBeenCalledTimes(2);
    expect(received[1]).toBe(30); // 新 args は再計算後の computed 値

    host.remove();
  });

  it("S18: stream A の値を stream B の args が読む場合、A のチャンク到着 drain で B が restart すること", async () => {
    const aRun = makeManualAsyncGenerator<string>();
    const bReceived: unknown[] = [];
    const bSource = vi.fn((args: unknown) => {
      bReceived.push(args);
      return makeManualAsyncGenerator<string>().iterable;
    });
    const raw: IState = {
      $streams: {
        a: {
          source: () => aRun.iterable,
          fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
          initial: "",
        },
        b: { args: (s: IState) => s.a, source: bSource },
      },
    };
    const { host, stateEl } = await connectHost("", raw);
    await flushAsync();
    // 起動時の A の initial リセット（"" → ""）は sameValueGuard で enqueue されない
    // ため、connect 直後に B の余計な restart は起きない
    expect(bSource).toHaveBeenCalledTimes(1);
    expect(bReceived[0]).toBe(""); // eager 起動時は A の initial を読む

    aRun.push("v1");
    await flushAsync();

    // A のチャンク書き込み drain で B が restart（switchMap のチェーン相当、§3-2）
    expect(bSource).toHaveBeenCalledTimes(2);
    expect(bReceived[1]).toBe("v1");
    expect(getStreamEntries(stateEl).get("b")!.status).toBe("active");
    // A 自身は args なし（depAddresses 空）なので自分のチャンクで restart しない
    expect(getStreamEntries(stateEl).get("a")!.status).toBe("active");

    host.remove();
  });

  it("S18 補: B の args が $streamStatus.A を読む場合、A の done 遷移で B が restart すること（status 依存の連鎖）", async () => {
    const aRun = makeManualAsyncGenerator<string>();
    const bReceived: unknown[] = [];
    const bSource = vi.fn((args: unknown) => {
      bReceived.push(args);
      return makeManualAsyncGenerator<string>().iterable;
    });
    const raw: IState = {
      $streams: {
        a: { source: () => aRun.iterable },
        b: { args: (s: IState) => s["$streamStatus.a"], source: bSource },
      },
    };
    const { host, stateEl } = await connectHost("", raw);
    await flushAsync();
    // 起動 drain（$streamStatus.a: idle→active の通知）も依存変化として B を restart
    // し得る（status 依存を宣言した以上、起動遷移も正当な依存変化）。以降は
    // 相対値で検証する。
    const callsAfterConnect = bSource.mock.calls.length;
    expect(bReceived[bReceived.length - 1]).toBe("active");

    aRun.end(); // A 正常終端 → $streamStatus.a: active→done → $postUpdate → drain
    await flushAsync();

    expect(bSource.mock.calls.length).toBe(callsAfterConnect + 1);
    expect(bReceived[bReceived.length - 1]).toBe("done"); // 新 args は遷移後の status
    expect(getStreamEntries(stateEl).get("a")!.status).toBe("done");
    expect(getStreamEntries(stateEl).get("b")!.status).toBe("active");

    host.remove();
  });

  it("同一 tick にチャンク反映と依存書き込みが同居した場合、restart が勝ち最終状態は initial リセット後の新 run になること", async () => {
    const { source, runs, received } = makeRecordingSource();
    const raw: IState = {
      prompt: "one",
      $streams: {
        tokens: {
          args: (s: IState) => s.prompt,
          source,
          fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
          initial: "X",
        },
      },
    };
    const { host, stateEl } = await connectHost("", raw);
    runs[0].push("a");
    await flushAsync();
    expect(raw.tokens).toBe("Xa");
    const controller1 = getStreamEntries(stateEl).get("tokens")!.controller!;

    // 同一 tick: 旧 run へのチャンク供給と依存書き込みを同居させる。
    // チャンク "b" の fold 書き込みが依存書き込みと同一 drain に乗るか隣接 drain に
    // 落ちるかは microtask ホップ数依存だが、契約（§3-2: restart が勝つ）は同じ:
    // fold が先なら restart の initial リセットが上書きし、restart が先なら
    // 旧 run の abort により "b" は stale-drop される。最終状態のみを固定する。
    runs[0].push("b");
    writeState(stateEl, (s) => {
      s.prompt = "two";
    });
    await flushAsync();

    expect(controller1.signal.aborted).toBe(true);
    expect(source).toHaveBeenCalledTimes(2);
    expect(received[1]).toBe("two");
    expect(raw.tokens).toBe("X"); // "b" の畳み込み有無に関わらず initial リセット後

    runs[1].push("c");
    await flushAsync();
    expect(raw.tokens).toBe("Xc"); // 新 run は initial の上に畳む

    host.remove();
  });

  it("done / error になった stream も依存変化で restart すること（再試行セマンティクス・status 不問）", async () => {
    const runs: ReturnType<typeof makeManualAsyncGenerator<string>>[] = [];
    const retryError = new Error("retry-me");
    let mode: "ok" | "fail" = "ok";
    const source = vi.fn(() => {
      if (mode === "fail") {
        throw retryError;
      }
      const m = makeManualAsyncGenerator<string>();
      runs.push(m);
      return m.iterable;
    });
    const raw: IState = {
      prompt: "p0",
      $streams: { tokens: { args: (s: IState) => s.prompt, source } },
    };
    const { host, stateEl } = await connectHost("", raw);
    const entry = getStreamEntries(stateEl).get("tokens")!;

    // 正常終端 → done
    runs[0].end();
    await flushAsync();
    expect(entry.status).toBe("done");

    // done 後の依存変化 → 再起動（自動再接続ではなく依存の叩き直し、§2-2）
    writeState(stateEl, (s) => {
      s.prompt = "p1";
    });
    await flushAsync();
    expect(source).toHaveBeenCalledTimes(2);
    expect(entry.status).toBe("active");

    // 次の run を同期 throw させて error に落とす（P7 経路）
    mode = "fail";
    writeState(stateEl, (s) => {
      s.prompt = "p2";
    });
    await flushAsync();
    expect(source).toHaveBeenCalledTimes(3);
    expect(entry.status).toBe("error");
    expect(entry.error).toBe(retryError);

    // error 後の依存変化 → 再試行（error は (re)start で null にリセットされる）
    mode = "ok";
    writeState(stateEl, (s) => {
      s.prompt = "p3";
    });
    await flushAsync();
    expect(source).toHaveBeenCalledTimes(4);
    expect(entry.status).toBe("active");
    expect(entry.error).toBeNull();

    host.remove();
  });

  it("restart 中の args throw はその entry だけ error に正規化され、他 entry の restart と後続の drain は継続すること", async () => {
    const userError = new Error("args-boom");
    let badArgsCalls = 0;
    const badSource = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    const goodReceived: unknown[] = [];
    const goodSource = vi.fn((args: unknown) => {
      goodReceived.push(args);
      return makeManualAsyncGenerator<string>().iterable;
    });
    const raw: IState = {
      trigger: 0,
      label: "before",
      $streams: {
        // 宣言順 = hit 実行順: 先に bad が throw しても good の restart は継続する
        bad: {
          args: (s: IState) => {
            const value = s.trigger;
            if (++badArgsCalls >= 2) {
              throw userError; // 2 回目（restart 時）の trace で throw
            }
            return value;
          },
          source: badSource,
        },
        good: { args: (s: IState) => s.trigger, source: goodSource },
      },
    };
    const { host, shadowRoot, stateEl } = await connectHost(
      `<p data-wcs="textContent: label"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    expect(badSource).toHaveBeenCalledTimes(1); // eager 起動（1 回目の trace）は成功
    expect(goodSource).toHaveBeenCalledTimes(1);
    const badEntry = getStreamEntries(stateEl).get("bad")!;
    const badController1 = badEntry.controller!;

    writeState(stateEl, (s) => {
      s.trigger = 1;
    });
    await flushAsync();

    // bad: restart の traceArgs throw → error 経路に正規化（§3-2 規範 3）
    expect(badEntry.status).toBe("error");
    expect(badEntry.error).toBe(userError);
    expect(badController1.signal.aborted).toBe(true); // 旧 run は startStream 冒頭で abort 済み
    expect(badEntry.controller!.signal.aborted).toBe(true); // 新 controller も catch で abort
    expect(badSource).toHaveBeenCalledTimes(1); // source までは到達しない
    let observedError: unknown = null;
    stateEl.createState("readonly", (s) => {
      observedError = s["$streamError.bad"];
    });
    expect(observedError).toBe(userError); // $streamError に格納され読み取れる

    // good: bad の throw に巻き込まれず同じ drain で restart される
    expect(goodSource).toHaveBeenCalledTimes(2);
    expect(goodReceived[1]).toBe(1);
    expect(getStreamEntries(stateEl).get("good")!.status).toBe("active");

    // 後続の drain も正常（updater の drain は壊れていない）: binding が更新される
    writeState(stateEl, (s) => {
      s.label = "after";
    });
    await flushAsync();
    expect(shadowRoot.querySelector("p")!.textContent).toBe("after");

    // 失敗した run でも entry.depAddresses は前回成功 run の検証済み捕捉を保持する
    // （argsTrace の規範）ため、以後の依存書き込みで bad も再試行される
    // （§2-2「error からも依存変化で restart」）。args が throw し続ける限り
    // error のまま source には到達しないが、再試行は依存書き込み 1 回につき
    // 高々 1 回で有界（無限に叩き直されるループにはならない）
    writeState(stateEl, (s) => {
      s.trigger = 2;
    });
    await flushAsync();
    expect(badArgsCalls).toBe(3); // 再試行で args は再評価される
    expect(badSource).toHaveBeenCalledTimes(1); // throw し続ける限り source 未到達
    expect(badEntry.status).toBe("error");
    expect(goodSource).toHaveBeenCalledTimes(3);

    host.remove();
  });

  it("restart 中の args throw で error になっても、前回成功 run の依存への書き込みで再試行され回復できること（§2-2 error からの再試行）", async () => {
    const { source, received } = makeRecordingSource();
    const raw: IState = {
      ready: true,
      query: "q0",
      $streams: {
        tokens: {
          // 一時的な状態依存 throw: ready が false の間だけ args が throw する
          args: (s: IState) => {
            if (!(s.ready as boolean)) {
              throw new Error("not ready");
            }
            return s.query;
          },
          source,
        },
      },
    };
    const { host, stateEl } = await connectHost("", raw);
    const entry = getStreamEntries(stateEl).get("tokens")!;
    expect(source).toHaveBeenCalledTimes(1); // eager 起動成功（deps: {ready, query}）
    expect(received[0]).toBe("q0");

    // ready=false → drain restart → traceArgs throw → error 正規化
    writeState(stateEl, (s) => {
      s.ready = false;
    });
    await flushAsync();
    expect(entry.status).toBe("error");
    expect(source).toHaveBeenCalledTimes(1); // source には到達しない
    // 前回成功 run の検証済み deps は保持される（clear で恒久固着させない）
    expect(entry.depAddresses.size).toBe(2);

    // 保持された依存 ready への書き込みで再試行 → 回復（disconnect や再 set は不要）
    writeState(stateEl, (s) => {
      s.ready = true;
    });
    await flushAsync();
    expect(entry.status).toBe("active");
    expect(entry.error).toBeNull();
    expect(source).toHaveBeenCalledTimes(2);
    expect(received[1]).toBe("q0");

    // 回復後は成功 run の再捕捉 deps で通常どおり restart する
    writeState(stateEl, (s) => {
      s.query = "q1";
    });
    await flushAsync();
    expect(source).toHaveBeenCalledTimes(3);
    expect(received[2]).toBe("q1");

    host.remove();
  });

  it("切断済み stateElement は restart しないこと（切断前に enqueue された依存書き込みの drain が切断後に走っても）", async () => {
    const { source } = makeRecordingSource();
    const raw: IState = {
      prompt: "p0",
      $streams: { tokens: { args: (s: IState) => s.prompt, source } },
    };
    const { host, stateEl } = await connectHost("", raw);
    expect(source).toHaveBeenCalledTimes(1);
    expect(getActiveStateElements().has(stateEl)).toBe(true); // startStreams で登録

    // 依存書き込みを enqueue した直後（drain 前）に同期で切断する
    writeState(stateEl, (s) => {
      s.prompt = "p1";
    });
    host.remove(); // disconnectedCallback → abortAllStreams → activeStateElements から削除
    expect(getActiveStateElements().has(stateEl)).toBe(false);

    await flushAsync(); // batch に prompt が載った drain が走るが、切断済みなので restart しない

    expect(source).toHaveBeenCalledTimes(1);
    const entry = getStreamEntries(stateEl).get("tokens")!;
    expect(entry.status).toBe("idle"); // abortAllStreams のまま（restart で active に戻らない）
    expect(entry.controller).toBeNull();
  });

  it("hit 収集後に先行 restart の source が他の stateElement を同期切断した場合、切断済み要素の restart はスキップされ error に汚染されないこと", async () => {
    // 独立した 2 ホストの <wcs-state> A / B を接続し、同一 tick に両者の依存を書いて
    // 同一 batch（updater は単一インスタンス）で両 entry を hit させる。A の restart
    // source は consumeSource の同期プレフィックスで同期呼び出しされるため、そこで
    // B のホストを remove すると B は activeStateElements から外れるが収集済み hits
    // には残る。実行時の再チェックがないと切断済み B への startStream が rootNode
    // 不在で throw し、catch 内の updateStreamStatus も同じ理由で再 throw して
    // drain リスナー外へ未捕捉例外が漏れ、entry が idle でなく error に汚染される
    // （§3-2「未接続の stateElement の entry は restart しない」・§5-1 に違反する）。
    let hostB: HTMLElement | null = null;
    let aCalls = 0;
    const sourceA = vi.fn(() => {
      aCalls++;
      if (aCalls >= 2) {
        // 2 回目（restart）の同期呼び出しで B を切断する
        hostB?.remove();
      }
      return makeManualAsyncGenerator<string>().iterable;
    });
    const sourceB = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    const rawA: IState = { t: 0, $streams: { x: { args: (s: IState) => s.t, source: sourceA } } };
    const rawB: IState = { u: 0, $streams: { y: { args: (s: IState) => s.u, source: sourceB } } };
    const a = await connectHost("", rawA); // 先に接続 = hits 実行順で A が先行
    const b = await connectHost("", rawB);
    hostB = b.host;
    const entryY = getStreamEntries(b.stateEl).get("y")!;
    expect(sourceA).toHaveBeenCalledTimes(1);
    expect(sourceB).toHaveBeenCalledTimes(1);

    // 同一 tick に両方の依存を書く → 同一 batch で x（A）・y（B）の両方が hit
    writeState(a.stateEl, (s) => {
      s.t = 1;
    });
    writeState(b.stateEl, (s) => {
      s.u = 1;
    });
    await flushAsync();

    // A は正常に restart。B は A の source が同期切断したため実行時再チェックでスキップ
    expect(sourceA).toHaveBeenCalledTimes(2);
    expect(sourceB).toHaveBeenCalledTimes(1); // restart されない
    expect(getActiveStateElements().has(b.stateEl)).toBe(false);
    expect(entryY.status).toBe("idle"); // abortAllStreams のまま（error に汚染されない、§5-1）
    expect(entryY.error).toBeNull();

    a.host.remove();
  });

  it("depAddresses の per-run 再捕捉: args の条件分岐で読むパスが変わると、restart 後は新しい依存だけが効くこと", async () => {
    const { source, received } = makeRecordingSource();
    const raw: IState = {
      mode: true,
      a: "a0",
      b: "b0",
      $streams: {
        tokens: {
          args: (s: IState) => ((s.mode as boolean) ? s.a : s.b),
          source,
        },
      },
    };
    const { host, stateEl } = await connectHost("", raw);
    expect(source).toHaveBeenCalledTimes(1); // 初回 deps: {mode, a}
    expect(received[0]).toBe("a0");

    writeState(stateEl, (s) => {
      s.b = "b1"; // b はまだ依存外
    });
    await flushAsync();
    expect(source).toHaveBeenCalledTimes(1);

    writeState(stateEl, (s) => {
      s.a = "a1"; // a は依存
    });
    await flushAsync();
    expect(source).toHaveBeenCalledTimes(2);
    expect(received[1]).toBe("a1");

    writeState(stateEl, (s) => {
      s.mode = false; // 分岐が切り替わり restart 時の再捕捉で deps: {mode, b} に置換
    });
    await flushAsync();
    expect(source).toHaveBeenCalledTimes(3);
    expect(received[2]).toBe("b1");

    writeState(stateEl, (s) => {
      s.a = "a2"; // a はもう依存ではない
    });
    await flushAsync();
    expect(source).toHaveBeenCalledTimes(3);

    writeState(stateEl, (s) => {
      s.b = "b2"; // b が新しい依存
    });
    await flushAsync();
    expect(source).toHaveBeenCalledTimes(4);
    expect(received[3]).toBe("b2");

    host.remove();
  });

  it("restart 中の source が同一要素の _state を同期再 set した場合、収集済みの旧 entry は restart されないこと（孤児 consume run の防止）", async () => {
    // hits 実行ループの activeStateElements.has() チェックだけでは、同期再 set
    // （clearStreamRegistry → startStreams で要素が Set に再 add される）を素通しする。
    // entry の identity 再検証がないと、registry から到達不能になった旧 entry が
    // restart され、abortAllStreams でも abort できない孤児 consume run がリークする。
    const sourceX2 = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    const sourceY2 = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    const sourceY = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    let stateElRef: State | null = null;
    let xCalls = 0;
    const sourceX = vi.fn(() => {
      xCalls++;
      if (xCalls >= 2) {
        // 2 回目（依存駆動 restart）の同期プレフィックスで同一要素を同期再 set する
        stateElRef!.setInitialState({
          t: 0,
          $streams: {
            x: { args: (s: IState) => s.t, source: sourceX2 },
            y: { args: (s: IState) => s.t, source: sourceY2 },
          },
        });
      }
      return makeManualAsyncGenerator<string>().iterable;
    });
    const raw: IState = {
      t: 0,
      $streams: {
        x: { args: (s: IState) => s.t, source: sourceX },
        y: { args: (s: IState) => s.t, source: sourceY },
      },
    };
    const { host, stateEl } = await connectHost("", raw);
    stateElRef = stateEl;
    const oldEntryY = getStreamEntries(stateEl).get("y")!;
    expect(sourceX).toHaveBeenCalledTimes(1);
    expect(sourceY).toHaveBeenCalledTimes(1);

    // t の書き込みで x・y の両 entry が同一 batch で hit → x の restart 中に再 set が走る
    writeState(stateEl, (s) => {
      s.t = 1;
    });
    await flushAsync();

    // 再 set 内の startStreams で新宣言は 1 回ずつ起動する
    expect(sourceX2).toHaveBeenCalledTimes(1);
    expect(sourceY2).toHaveBeenCalledTimes(1);
    // 旧 y entry は registry から置換済みのため restart されない（identity 再検証）。
    // これが素通しされると sourceY が 2 回目に呼ばれ、registry 到達不能な孤児 run になる。
    expect(sourceY).toHaveBeenCalledTimes(1);
    expect(oldEntryY.controller).toBeNull(); // clearStreamRegistry が abort → null にしたまま
    expect(getStreamEntries(stateEl).get("y")).not.toBe(oldEntryY);

    // 新宣言側の依存駆動 restart は正常に機能する（ガードの副作用がない）
    writeState(stateEl, (s) => {
      s.t = 2;
    });
    await flushAsync();
    expect(sourceX2).toHaveBeenCalledTimes(2);
    expect(sourceY2).toHaveBeenCalledTimes(2);
    expect(sourceY).toHaveBeenCalledTimes(1);

    host.remove();
  });

  it("restart 中の args が自ホストを同期切断してから throw しても、drain リスナー外へ例外が漏れず後続 entry の restart が継続すること", async () => {
    // hits 実行前の active 再チェックは startStream 実行中（args 内）の自己切断を
    // ガードできない。catch 内の error 正規化（updateStreamStatus → createState）が
    // rootNode 不在で再 throw すると、notifyUpdateBatchListeners を突き抜けて
    // 同一 batch の後続 hits の restart がスキップされる（§3-2 規範 3 の穴）。
    let hostA: HTMLElement | null = null;
    let argsCalls = 0;
    const sourceA = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    const sourceB = vi.fn(() => makeManualAsyncGenerator<string>().iterable);
    const rawA: IState = {
      t: 0,
      $streams: {
        x: {
          args: (s: IState) => {
            argsCalls++;
            if (argsCalls >= 2) {
              // 2 回目（restart）の trace で自ホストを同期切断してから throw する
              hostA?.remove();
              throw new Error("self-destruct");
            }
            return s.t;
          },
          source: sourceA,
        },
      },
    };
    const rawB: IState = { u: 0, $streams: { y: { args: (s: IState) => s.u, source: sourceB } } };
    const a = await connectHost("", rawA); // 先に接続 = hits 実行順で A が先行
    const b = await connectHost("", rawB);
    hostA = a.host;
    const entryX = getStreamEntries(a.stateEl).get("x")!;
    expect(sourceB).toHaveBeenCalledTimes(1);

    // 同一 tick に両方の依存を書く → 同一 batch で x（A）・y（B）の両方が hit
    writeState(a.stateEl, (s) => {
      s.t = 1;
    });
    writeState(b.stateEl, (s) => {
      s.u = 1;
    });
    await flushAsync();

    // A の args throw + 自己切断でも、後続の B の restart は継続する
    expect(sourceB).toHaveBeenCalledTimes(2);
    // 切断済み要素の entry は error に汚染されない（abortAllStreams の idle のまま、§5-1）
    expect(getActiveStateElements().has(a.stateEl)).toBe(false);
    expect(entryX.status).toBe("idle");
    expect(entryX.error).toBeNull();

    b.host.remove();
  });
});
