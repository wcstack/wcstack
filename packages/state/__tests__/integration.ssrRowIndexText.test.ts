/**
 * integration.ssrRowIndexText.test.ts — サーバーが描いた行の `{{ $1 }}`（テキストの添字の束縛）を、**実際の
 * サーバー出力**から固定する（#350）。
 *
 * ハイドレーションは `{{ }}` のサーバーのテキスト（`@@wcs-text-start` 〜 `end` の間）を捨てて束縛の
 * コメントに戻し（Ssr.restoreTextBindings）、ブロックの中の束縛を 1 度適用して描き直す（#258 X6）。
 * 添字の束縛はその適用から外していた（state に依存しないので、SSR が描いた添字のままでよい、として）ので、
 * `{{ $1 }}` は行の添字が変わる（先頭の行を消す・並べ替える）まで空のままだった。属性の束縛
 * （`textContent: $1`）はサーバーの値が要素に残るのでこの穴に落ちない。
 *
 * 契約: 行の `{{ $1 }}` はハイドレーション直後から添字を出し、以後も `enable-ssr` を外した CSR と同じ表示で、
 * 失敗を報告しない。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { write } from "./helpers/recursionTestUtils";
import { clientLoad, csrMarkup, serverRender, settle } from "./helpers/ssrRoundTrip";

beforeAll(() => {
  bootstrapState();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Step = (s: any) => void;

interface IRun {
  views: string[];
  errors: string[];
}

const rows = (): string => Array.from(document.querySelectorAll("li")).map((li) => li.textContent).join(" ");

async function run(html: string, make: () => any, steps: Step[]): Promise<IRun> {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  try {
    const el = await clientLoad(html, make);
    const views = [rows()];
    for (const step of steps) {
      write(el, step);
      await settle();
      views.push(rows());
    }
    return { views, errors };
  } finally {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await settle();
  }
}

async function compare(markup: string, make: () => any, steps: Step[]): Promise<{ csr: IRun; ssr: IRun; serverHtml: string }> {
  const csr = await run(csrMarkup(markup), make, steps);
  const serverHtml = await serverRender(markup, make);
  const ssr = await run(serverHtml, make, steps);
  return { csr, ssr, serverHtml };
}

const steps: Step[] = [
  (s) => { s["items.0.id"] = "A"; },
  (s) => { s.items = [...s.items, { id: "d" }]; },
  (s) => { s.items = s.items.slice(1); },
  (s) => { s.items = [...s.items].reverse(); },
];
const make = (): any => ({ items: [{ id: "a" }, { id: "b" }, { id: "c" }] });

describe("#350: サーバーが描いた行の {{ $1 }}", () => {
  it("ハイドレーション直後から添字を出し、書き込み・追加・削除・並べ替えで CSR と同じ（旧: 添字が変わるまで空だった）", async () => {
    const { csr, ssr, serverHtml } = await compare(
      `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: items"><li><b>{{ .id }}</b>:<i>{{ $1 }}</i></li></template></ul>`,
      make, steps);
    // サーバーは添字を描いている（ハイドレーションが捨てて描き直す）
    expect(serverHtml).toContain("<!--@@wcs-text-start:$1-->0<!--@@wcs-text-end:$1-->");
    expect(csr.views).toEqual(["a:0 b:1 c:2", "A:0 b:1 c:2", "A:0 b:1 c:2 d:3", "b:0 c:1 d:2", "d:0 c:1 b:2"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("行の中の if の枝の {{ $1 }} も、ハイドレーション直後から添字を出す", async () => {
    // 行の添字が変わる手順は含めない — 入れ子のテンプレートの `{{ $1 }}` は CSR でも添字の振り直しに
    // 追従しない（#360、別件）
    const { csr, ssr } = await compare(
      `<wcs-state enable-ssr></wcs-state><ul><template data-wcs="for: items"><li><b>{{ .id }}</b>` +
      `<template data-wcs="if: .id"><i>#{{ $1 }}</i></template></li></template></ul>`,
      make, steps.slice(0, 2));
    expect(csr.views).toEqual(["a#0 b#1 c#2", "A#0 b#1 c#2", "A#0 b#1 c#2 d#3"]);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });
});
