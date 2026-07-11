/**
 * stream.structural.test.ts
 *
 * `$streams` と構造バインディング（for: / if:）の組み合わせの特性化テスト。
 * stream 値・コンパニオン名前空間は通常のパスとして構造バインディング・filter
 * パイプラインに乗る（特別扱いの分岐は無い）ため専用実装は存在しないが、
 * 代表ユースケースの回帰ガードとして end-to-end で固定する:
 *
 * - for: × stream 値のリスト — チャンクで行が増え、依存駆動 restart で
 *   initial の空リストに戻る（fold は新しい配列を返す有界 fold の推奨形、§6-2）
 * - if: × $streamStatus.<name>|eq(...) — active で表示・done で非表示
 *   （status 遷移が $postUpdate 経由で構造バインディングに届く、§4-3）
 * - stream 値への filter 適用（|uc）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import type { IState } from "../src/types";
import { makeManualAsyncGenerator } from "./helpers/fakeStreamSources";
import { flushAsync, makeConnectHost } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("stream-structural-host");

describe("$streams × 構造バインディング", () => {
  it("for: が stream 値のリストを描画し、チャンクで行が増え、依存駆動 restart で initial の空リストに戻ること", async () => {
    const runs: ReturnType<typeof makeManualAsyncGenerator<string>>[] = [];
    const source = () => {
      const m = makeManualAsyncGenerator<string>();
      runs.push(m);
      return m.iterable;
    };
    const raw: IState = {
      channel: "c1",
      $streams: {
        lines: {
          args: (s: IState) => s.channel,
          source,
          // 有界 fold の推奨形（新しい配列を返す — in-place 変異の禁止、§6-2）
          fold: (acc: unknown, chunk: unknown) => [...(acc as string[]), chunk as string],
          initial: [],
        },
      },
    };
    const { host, shadowRoot, stateEl } = await connectHost(
      `<ul><template data-wcs="for: lines"><li data-wcs="textContent: lines.*"></li></template></ul>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    expect(shadowRoot.querySelectorAll("li")).toHaveLength(0); // initial は空リスト

    runs[0].push("alpha");
    runs[0].push("beta");
    await flushAsync();
    const items = shadowRoot.querySelectorAll("li");
    expect(items).toHaveLength(2); // チャンクごとに行が増える（list diff で追加）
    expect(items[0].textContent).toBe("alpha");
    expect(items[1].textContent).toBe("beta");

    // 依存パスの書き込み → restart → 値は initial にリセットされ行も消える
    stateEl.createState("writable", (s) => {
      s.channel = "c2";
    });
    await flushAsync();
    expect(shadowRoot.querySelectorAll("li")).toHaveLength(0);

    // 新 run のチャンクは initial の上に畳まれ、行が再び増える
    runs[1].push("gamma");
    await flushAsync();
    const items2 = shadowRoot.querySelectorAll("li");
    expect(items2).toHaveLength(1);
    expect(items2[0].textContent).toBe("gamma");

    host.remove();
  });

  it("if: が $streamStatus.<name>|eq(active) で表示を制御し（active で表示・done で非表示）、stream 値に filter が適用されること", async () => {
    const m = makeManualAsyncGenerator<string>();
    const raw: IState = {
      $streams: {
        tokens: {
          source: () => m.iterable,
          fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
          initial: "",
        },
      },
    };
    const { host, shadowRoot } = await connectHost(
      `<template data-wcs="if: $streamStatus.tokens|eq(active)"><p id="live">streaming</p></template>
       <p id="up" data-wcs="textContent: tokens|uc"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    // eager 起動で active → if ブロックが表示される
    expect(shadowRoot.querySelector("#live")).not.toBeNull();

    m.push("ab");
    await flushAsync();
    // stream 値は通常のパスとして filter パイプラインに乗る
    expect(shadowRoot.querySelector("#up")!.textContent).toBe("AB");

    m.end(); // 正常終端 → $streamStatus.tokens: active→done → if ブロックが畳まれる
    await flushAsync();
    expect(shadowRoot.querySelector("#live")).toBeNull();
    expect(shadowRoot.querySelector("#up")!.textContent).toBe("AB"); // 値は保持される

    host.remove();
  });
});
