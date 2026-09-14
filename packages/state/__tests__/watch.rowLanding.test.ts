/**
 * watch.rowLanding.test.ts
 *
 * ワイルドカードの `$watch` の行の着地を、drain の時点のリストの位置 1 つにつき 1 つに絞る
 * （#274・watch/rowLanding.ts）。`$scan` の `from` と同じ選別で、scan.from.test.ts の D3 の各形と対にする。
 *
 * 修理前の `$watch` は行のアドレスを添字で読んで発火していたので、同じ job でリストを短くした・空にした形は
 * 範囲外の読みを評価の失敗として報告し、置き換えた・途中から取り除いた形は、その位置にいま居る別の行の値で発火した。
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import type { IState } from "../src/types";
import * as rowLanding from "../src/watch/rowLanding";
import { flushTimes, makeConnectHost, writeState } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("watch-row-landing-host");
const LIST = `<template data-wcs="for: items"><span data-wcs="textContent: .qty"></span></template>`;

/** `items.*.qty` を watch した 3 行の state に、1 つの job で書き、発火と console.error を集める */
async function watchItems(write: (s: any) => void): Promise<{ calls: unknown[][]; errors: unknown[][] }> {
  const watch = vi.fn();
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const { host, stateEl } = await connectHost(LIST, {
      items: [{ qty: 1 }, { qty: 2 }, { qty: 3 }],
      $watch: { "items.*.qty": watch },
    } as unknown as IState);
    await flushTimes();
    writeState(stateEl, write);
    await flushTimes(3);
    host.remove();
    return { calls: [...watch.mock.calls], errors: [...errorSpy.mock.calls] };
  } finally {
    errorSpy.mockRestore();
  }
}

describe("$watch の行の着地（#274）", () => {
  it("行を書いた同じ job でその行をリストの途中から取り除くと、移ってきた変わっていない行で発火しないこと", async () => {
    // 修理前は取り除いた行のアドレスを添字で読み、移ってきた行の値 3 を取り除いた行の prev 2 で渡していた
    const { calls, errors } = await watchItems((s) => {
      s.$resolve("items.*.qty", [1], 20);
      s.items = [s.items[0], s.items[2]];
    });
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("行を書いてからリストを短くしたら、残った行だけで発火し、消えた行を読んで報告しないこと", async () => {
    const { calls, errors } = await watchItems((s) => {
      s.$resolve("items.*.qty", [0], 10);
      s.$resolve("items.*.qty", [2], 30);
      s.items = s.items.slice(0, 2);
    });
    expect(calls).toEqual([[10, 1, 0]]);
    expect(errors).toEqual([]);
  });

  it("複数の行を書いてからリストを 1 行に短くしたら、消えた行をどれも読まず、残った行だけで発火すること", async () => {
    const { calls, errors } = await watchItems((s) => {
      s.$resolve("items.*.qty", [0], 10);
      s.$resolve("items.*.qty", [1], 20);
      s.$resolve("items.*.qty", [2], 30);
      s.items = s.items.slice(0, 1);
    });
    expect(calls).toEqual([[10, 1, 0]]);
    expect(errors).toEqual([]);
  });

  it("行を書いてからリストを空にしたら、発火も報告もしないこと", async () => {
    const { calls, errors } = await watchItems((s) => {
      s.$resolve("items.*.qty", [0], 10);
      s.items = [];
    });
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("行を書いてからリストを新しい行で置き換えたら、退役した行では発火せず、新しい行で 1 回ずつ発火すること", async () => {
    // 修理前は退役した行 0 のアドレスが新しい行 0 の値 7 を prev 1 で読み、位置 0 で 2 回発火していた
    const { calls, errors } = await watchItems((s) => {
      s.$resolve("items.*.qty", [0], 10);
      s.items = [{ qty: 7 }, { qty: 8 }];
    });
    expect(calls).toEqual([[7, undefined, 0], [8, undefined, 1]]);
    expect(errors).toEqual([]);
  });

  it("同じ位置に、移ってきた行の着地と取り除いた行の着地が並んだら、移ってきた行で 1 回だけ発火すること", async () => {
    const { calls } = await watchItems((s) => {
      s.$resolve("items.*.qty", [2], 30);
      s.$resolve("items.*.qty", [1], 20);
      s.items = [s.items[0], s.items[2]];
    });
    expect(calls).toEqual([[30, 3, 1]]);
  });

  it("list.* へ要素を書き込んだ位置（差分を通らない行の差し込み）は、その位置のいまの値で 1 回発火すること", async () => {
    const { calls } = await watchItems((s) => {
      s.$resolve("items.*", [1], { qty: 9 });
    });
    expect(calls).toEqual([[9, undefined, 1]]);
  });

  it("list.* へ要素を書き込んだ位置に、差し込まれた行の着地も並んだら、差し込まれた行で 1 回だけ発火すること", async () => {
    const { calls } = await watchItems((s) => {
      s.$resolve("items.*.qty", [1], 20);
      s.$resolve("items.*", [1], { qty: 9 });
      s.$resolve("items.*.qty", [1], 10);
    });
    expect(calls).toEqual([[10, 9, 1]]);
  });

  it("位置を引く読みが throw したら、その watch のヒットは発火せず評価の失敗として 1 回報告し、他の watch は発火すること", async () => {
    const itemsWatch = vi.fn();
    const countWatch = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, stateEl } = await connectHost(LIST, {
      count: 0,
      items: [{ qty: 1 }, { qty: 2 }, { qty: 3 }],
      $watch: { "items.*.qty": itemsWatch, count: countWatch },
    } as unknown as IState);
    await flushTimes();
    const selectSpy = vi.spyOn(rowLanding, "selectLandedRows").mockImplementation(() => {
      throw new Error("placement read failed");
    });
    try {
      writeState(stateEl, (s) => {
        s.$resolve("items.*.qty", [1], 20);
        s.items = [s.items[0], s.items[2]];
        s.count = 1;
      });
      await flushTimes(3);

      expect(selectSpy).toHaveBeenCalledTimes(1);
      expect(itemsWatch).not.toHaveBeenCalled();
      expect(countWatch).toHaveBeenCalledWith(1, 0);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toBe(`[@wcstack/state] $watch evaluation of "items.*.qty" threw.`);
    } finally {
      selectSpy.mockRestore();
      errorSpy.mockRestore();
      host.remove();
    }
  });
});
