/**
 * watch.streamCommit.test.ts
 *
 * `examples/state-intersect-scroll/index.html` の commit 境界を固定する。
 *
 * この example は元々 `$updatedCallback` で `$streamStatus.pageResult` の遷移を拾って
 * ページを feed へ commit していた。`$updatedCallback` は binding 駆動なので、
 * **画面のステータス表示（`.stream-status`）が commit の購読そのもの**になっており、
 * その `<b>` を消すとフィードが止まるという結合があった（HTML に「load-bearing」と
 * 注記されていた）。`$watch` へ移してこの結合を切ったのが変更点。
 *
 * ここで固定するのは 3 点:
 * 1. **バインディングが 1 つも無くても** status 遷移で commit が走る（結合が切れたこと）
 * 2. `$streamStatus.*` は `$` 名前空間で watch のキーにできないため、非 `$` の getter を
 *    1 枚挟む形が成立する（watch した getter は eager になる規約に乗る）
 * 3. 1 回の run で "done" は 1 度しか観測されない ＝ concat に冪等ガードが要らない
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import type { IState } from "../src/types";
import { flushAsync, makeConnectHost } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("watch-stream-commit-host");

const PAGE_SIZE = 3;

/** 1 run = 1 ページ要求。example の loadPage を最小化したもの。 */
function makeSource(pages: Record<number, unknown[]>) {
  return async function* loadPage({ page }: { page: number }) {
    yield { kind: "success", page, items: pages[page] ?? [] };
  };
}

/** example の state 定義から commit 境界に関わる部分だけを取り出したもの。 */
function makeState(pages: Record<number, unknown[]>, log: string[]): IState {
  return {
    pageSize: PAGE_SIZE,
    page: 1,
    items: [] as unknown[],
    noMore: false,

    $streams: {
      pageResult: {
        args: (state: any) => ({ page: state.page }),
        source: makeSource(pages),
      },
    },

    // `$watch` のキーは `$` 始まりを受け付けないので、非 `$` パスへ写す getter を挟む
    get streamStatus(this: any) {
      return this["$streamStatus.pageResult"];
    },

    $watch: {
      streamStatus(this: any, status: unknown, previousStatus: unknown) {
        log.push(`${String(previousStatus)}->${String(status)}`);
        if (status !== "done" || this.pageResult?.kind !== "success") return;
        const batch = this.pageResult.items as unknown[];
        this.items = this.items.concat(batch);
        if (batch.length < this.pageSize) {
          this.noMore = true;
        }
      },
    },
  } as unknown as IState;
}

async function settle(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) {
    await flushAsync();
  }
}

describe("examples/state-intersect-scroll の commit 境界（$watch 化）", () => {
  it("バインディングが 1 つも無くても、stream の done で commit が走ること", async () => {
    // markup を空にする ＝ 旧 $updatedCallback 版なら commit が一度も走らない構成
    const log: string[] = [];
    const { host, stateEl } = await connectHost("", makeState({ 1: ["a", "b", "c"] }, log));
    await settle();

    stateEl.createState("readonly", (state) => {
      expect(state.items).toEqual(["a", "b", "c"]);
      expect(state.noMore).toBe(false);
    });
    host.remove();
  });

  it("接続時の初回評価は発火せず、idle→active→done の遷移だけを観測すること", async () => {
    const log: string[] = [];
    const { host } = await connectHost("", makeState({ 1: ["a", "b", "c"] }, log));
    await settle();

    // 初回評価（prime）はスナップショットを埋めるだけでハンドラを呼ばない。
    // watch は「バッチに載ったアドレス」をそのまま発火するので、遷移そのものが並ぶ。
    expect(log).toEqual(["idle->active", "active->done"]);
    host.remove();
  });

  it("1 run につき done は 1 度だけ ＝ concat に冪等ガードが要らないこと", async () => {
    const log: string[] = [];
    const { host, stateEl } = await connectHost("", makeState({ 1: ["a", "b", "c"], 2: ["d"] }, log));
    await settle();

    // 依存（page）を動かして 2 run 目へ。restart は initial リセット → active → done。
    stateEl.createState("writable", (state) => { state.page = 2; });
    await settle();

    stateEl.createState("readonly", (state) => {
      // ページが二重に積まれていない
      expect(state.items).toEqual(["a", "b", "c", "d"]);
      // 部分ページ（batch.length < pageSize）が終端シグナルになる
      expect(state.noMore).toBe(true);
    });
    expect(log.filter((entry) => entry.endsWith("->done"))).toHaveLength(2);
    host.remove();
  });

  it("同じ page への再代入では restart も commit も起きないこと（same-value guard）", async () => {
    const log: string[] = [];
    const { host, stateEl } = await connectHost("", makeState({ 1: ["a", "b", "c"] }, log));
    await settle();
    const before = log.length;

    // example の「derive, don't increment」— 同じ page を書き戻す edge は no-op
    stateEl.createState("writable", (state) => { state.page = 1; });
    await settle();

    expect(log).toHaveLength(before);
    stateEl.createState("readonly", (state) => {
      expect(state.items).toEqual(["a", "b", "c"]);
    });
    host.remove();
  });
});

describe("対比: 旧 $updatedCallback 版が同じ構成で成立しないこと", () => {
  // 上のテスト群が「$watch だから通る」ものであることの裏取り。この 1 本が無いと、
  // 「バインディング無しで commit できる」が $watch の手柄なのか判別できない。
  it("バインディングが 1 つも無いと $updatedCallback は一度も呼ばれず commit が走らないこと", async () => {
    const calls: string[][] = [];
    const state = {
      pageSize: PAGE_SIZE,
      page: 1,
      items: [] as unknown[],
      $streams: {
        pageResult: {
          args: (s: any) => ({ page: s.page }),
          source: makeSource({ 1: ["a", "b", "c"] }),
        },
      },
      $updatedCallback(this: any, paths: string[]) {
        calls.push(paths);
        if (!paths.includes("$streamStatus.pageResult")) return;
        if (this["$streamStatus.pageResult"] !== "done") return;
        this.items = this.items.concat(this.pageResult.items);
      },
    } as unknown as IState;

    const { host, stateEl } = await connectHost("", state);
    await settle();

    // binding 駆動なので、適用された binding が無ければ呼び出し自体が発生しない
    expect(calls).toEqual([]);
    stateEl.createState("readonly", (s) => {
      expect(s.items).toEqual([]);
    });
    host.remove();
  });
});
