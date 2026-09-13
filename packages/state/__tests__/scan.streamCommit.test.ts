/**
 * scan.streamCommit.test.ts
 *
 * `examples/state-intersect-scroll/index.html` の feed の境界を固定する（docs/state-scan-design.md §3）。
 *
 * この example は、ページ単位の run（`$streams.pageResult`）を跨いで積み上がる feed を
 * `$watch` ハンドラの `concat` で commit していた。`$scan` へ移したことで、次を宣言が担う。
 * 1. **バインドが 1 つも無くても**着地が feed に畳まれる（headless）
 * 2. progress chunk（loading / retrying）は feed を書かず、行の再評価も起こさない
 * 3. 同じ page の再着地（done 後の Retry・再接続）は fold の page キーが捨てる
 *    ＝ runtime の保証は「着地ごと 1 回」であって「page ごと 1 回」ではない
 * 4. 着地の書き込みの次のバッチで `$watch.feed` が rearm し、部分ページで止まる
 *
 * 旧 `$watch` 版の commit 境界は watch.streamCommit.test.ts が引き続き固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import type { State } from "../src/components/State";
import type { IState } from "../src/types";
import { flushAsync, makeConnectHost, waitFor } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("scan-stream-commit-host");

const PAGE_SIZE = 3;
const PAGES: Record<number, { id: number }[]> = {
  1: [{ id: 1 }, { id: 2 }, { id: 3 }],
  2: [{ id: 4 }],
};

interface IProbe {
  requests: number[];
  rearms: number[];
  labelEvaluations: number;
}

/** example の state 定義から、feed の境界に関わる部分だけを写したもの。 */
function makeState(probe: IProbe): IState {
  return {
    pageSize: PAGE_SIZE,
    page: 1,
    retryNonce: 0,
    $commandTokens: ["rearm"],
    $streams: {
      pageResult: {
        args: (state: any) => ({ page: state.page, pageSize: state.pageSize, retryNonce: state.retryNonce }),
        source: async function* ({ page, pageSize }: { page: number; pageSize: number }) {
          probe.requests.push(page);
          yield { kind: "loading", attempt: 1, page };
          yield { kind: "retrying", attempt: 1, page };
          yield { kind: "success", attempt: 1, page, pageSize, items: PAGES[page] ?? [] };
        },
      },
    },
    $scan: {
      feed: {
        from: "pageResult",
        initial: { items: [], pages: [], noMore: false },
        fold: (feed: any, chunk: any) => {
          if (chunk?.kind !== "success") return feed;
          if (feed.pages.includes(chunk.page)) return feed;
          return {
            items: feed.items.concat(chunk.items),
            pages: [...feed.pages, chunk.page],
            noMore: chunk.items.length < chunk.pageSize,
          };
        },
      },
    },
    get "feed.items.*.label"(this: any) {
      probe.labelEvaluations++;
      return `#${this["feed.items.*.id"]}`;
    },
    $watch: {
      feed(this: any, feed: any) {
        if (feed.noMore) return;
        probe.rearms.push(feed.pages.length);
        this.$command.rearm.emit();
      },
    },
  } as unknown as IState;
}

function newProbe(): IProbe {
  return { requests: [], rearms: [], labelEvaluations: 0 };
}

async function settle(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) {
    await flushAsync();
  }
}

function readFeed(stateEl: State): { ids: number[]; pages: number[]; noMore: boolean } {
  let snapshot = { ids: [] as number[], pages: [] as number[], noMore: false };
  stateEl.createState("readonly", (state: any) => {
    snapshot = {
      ids: state.feed.items.map((item: { id: number }) => item.id),
      pages: [...state.feed.pages],
      noMore: state.feed.noMore,
    };
  });
  return snapshot;
}

const ROWS = `<template data-wcs="for: feed.items"><span data-wcs="textContent: .label"></span></template>`;

describe("examples/state-intersect-scroll の feed（$scan 化）", () => {
  it("バインドが 1 つも無くても、着地が feed に畳まれ、全ページで rearm して部分ページで止まること", async () => {
    const probe = newProbe();
    const { host, stateEl } = await connectHost("", makeState(probe));
    await settle();
    expect(readFeed(stateEl)).toEqual({ ids: [1, 2, 3], pages: [1], noMore: false });
    expect(probe.rearms).toEqual([1]);

    stateEl.createState("writable", (state: any) => { state.page = 2; });
    await settle();
    expect(readFeed(stateEl)).toEqual({ ids: [1, 2, 3, 4], pages: [1, 2], noMore: true });
    // 部分ページは noMore を立てるだけで rearm しない
    expect(probe.rearms).toEqual([1]);
    expect(probe.requests).toEqual([1, 2]);
    host.remove();
  });

  it("progress chunk（loading / retrying）は feed を書かず、行の getter を再評価しないこと", async () => {
    const probe = newProbe();
    const { host, stateEl } = await connectHost(ROWS, makeState(probe));
    await settle();
    const afterFirstPage = probe.labelEvaluations;
    expect(afterFirstPage).toBe(3);

    // 同じ page をもう一度走らせる: loading → retrying → success（page キーで捨てる）
    stateEl.createState("writable", (state: any) => { state.retryNonce = 1; });
    await settle();

    expect(probe.requests).toEqual([1, 1]);
    expect(probe.labelEvaluations).toBe(afterFirstPage);
    host.remove();
  });

  it("done 後の Retry（retryNonce）で同じ page が再着地しても二重に積まれず、rearm も増えないこと", async () => {
    const probe = newProbe();
    const { host, stateEl } = await connectHost("", makeState(probe));
    await settle();

    stateEl.createState("writable", (state: any) => { state.retryNonce = 1; });
    await settle();

    expect(probe.requests).toEqual([1, 1]);
    expect(readFeed(stateEl)).toEqual({ ids: [1, 2, 3], pages: [1], noMore: false });
    expect(probe.rearms).toEqual([1]);
    host.remove();
  });

  it("再接続で現在の page が再着地しても二重に積まれず、feed は切断を跨いで保持されること", async () => {
    const probe = newProbe();
    const { host, stateEl } = await connectHost("", makeState(probe));
    await settle();

    host.remove();
    await flushAsync();
    document.body.appendChild(host);
    await waitFor(() => probe.requests.length === 2);
    await settle();

    expect(probe.requests).toEqual([1, 1]);
    expect(readFeed(stateEl)).toEqual({ ids: [1, 2, 3], pages: [1], noMore: false });
    host.remove();
  });

  it("同じ page への再代入では restart も fold も起きないこと（same-value guard）", async () => {
    const probe = newProbe();
    const { host, stateEl } = await connectHost("", makeState(probe));
    await settle();

    stateEl.createState("writable", (state: any) => { state.page = 1; });
    await settle();

    expect(probe.requests).toEqual([1]);
    expect(probe.rearms).toEqual([1]);
    host.remove();
  });
});
