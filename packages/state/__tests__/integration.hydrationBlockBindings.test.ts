/**
 * integration.hydrationBlockBindings.test.ts — ハイドレーションは SSR ブロックの中のバインディングにも
 * 初回値を適用する（#258 X6）。
 *
 * 旧挙動: `hydrateBindings` は `for` の行と `if` の中身のバインディングをアドレスに登録するだけで、
 * 初回値を適用するのはブロックの外の通常バインディングだけだった。getter の依存辺は getter を
 * 評価したときにしか張られないので、ブロックの中の getter バインドは、依存するパスを書いても
 * 一度も再評価されず、サーバーが書いたテキストのまま固まった（ブロックの外の集計は動くので
 * 「合計は動くのに行だけ止まる」形になる）。
 *
 * 契約（1 本ずつ固定する）:
 *  - `for` の行・`if` の中身の getter バインドが、ハイドレーション後の書き込みに追従する。
 *  - 適用してもサーバーが書いたテキストは変わらない。
 *  - 入れ子の `for`（内側の行は外側のループ文脈しか持たない — ハイドレーションの既知の制限・
 *    integration.listLedgerParentKey.test.ts）では、段数の足りないバインディングを適用しない。
 *    適用しても失敗の報告が増えるだけなので、報告は 0 件のまま。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { buildSsrDocument } from "../src/ssr/buildSsrDocument";
import { flush, read, write } from "./helpers/recursionTestUtils";

beforeAll(() => {
  bootstrapState();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.documentElement.removeAttribute("data-wcs-server");
  vi.restoreAllMocks();
});

/** サーバー側で描画し、`<wcs-ssr>` 付きの HTML を返す（integration.recursionIntegration.test.ts と同じ手順）。 */
async function serverRender(markup: string, make: () => any): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "");
  document.body.innerHTML = markup;
  const el = document.querySelector("wcs-state") as State;
  el.setInitialState(make());
  await el.connectedCallbackPromise;
  await State.getBindingsReady(document);
  await flush();
  buildSsrDocument(document);
  const html = document.body.innerHTML;
  document.documentElement.removeAttribute("data-wcs-server");
  return html;
}

async function clientHydrate(html: string, make: () => any): Promise<State> {
  document.body.innerHTML = html;
  const el = document.querySelector("wcs-state") as State;
  el.setInitialState(make());
  await el.connectedCallbackPromise;
  await State.getBindingsReady(document);
  await flush();
  return el;
}

const texts = (selector: string): (string | null)[] =>
  Array.from(document.querySelectorAll(selector)).map((element) => element.textContent);

describe("for の行", () => {
  const rows = (): any => {
    const state: any = { items: [{ n: 1 }, { n: 2 }] };
    Object.defineProperty(state, "items.*.double", {
      get(this: any) { return this["items.*.n"] * 2; },
      enumerable: false, configurable: true,
    });
    return state;
  };
  const MARKUP =
    `<wcs-state enable-ssr></wcs-state>` +
    `<ul><template data-wcs="for: items"><li class="d" data-wcs="textContent: items.*.double"></li></template></ul>`;

  it("行の getter が葉の書き込みに追従し、適用してもサーバーのテキストは変わらない", async () => {
    const html = await serverRender(MARKUP, rows);
    expect(texts(".d")).toEqual(["2", "4"]);

    const el = await clientHydrate(html, rows);
    expect(texts(".d"), "サーバーが書いたテキストのまま").toEqual(["2", "4"]);

    write(el, (s: any) => { s["items.0.n"] = 10; });
    await flush();
    expect(texts(".d")).toEqual(["20", "4"]); // 旧: ["2", "4"]
    expect(read(el, (s: any) => s.$getAll("items.*.double", []))).toEqual([20, 4]);
  });
});

describe("if の中身", () => {
  const page = (): any => {
    const state: any = { show: true, a: 1, b: 2 };
    Object.defineProperty(state, "total", {
      get(this: any) { return this.a + this.b; },
      enumerable: false, configurable: true,
    });
    return state;
  };
  const MARKUP =
    `<wcs-state enable-ssr></wcs-state>` +
    `<template data-wcs="if: show"><p class="t" data-wcs="textContent: total"></p></template>`;

  it("if の中の getter バインドが依存パスの書き込みに追従する", async () => {
    const html = await serverRender(MARKUP, page);
    expect(texts(".t")).toEqual(["3"]);

    const el = await clientHydrate(html, page);
    expect(texts(".t")).toEqual(["3"]);

    write(el, (s: any) => { s.a = 10; });
    await flush();
    expect(texts(".t")).toEqual(["12"]); // 旧: ["3"]
  });
});

describe("入れ子の for（ハイドレーションの既知の制限）", () => {
  // 手書きの SSR 断片（integration.listLedgerParentKey.test.ts と同じ形）。内側の行の DOM は外側の
  // ブロックの Content に吸収され、外側のループ文脈しか持たない
  const FIXTURE = `
    <wcs-ssr name="default">
      <script type="application/json">{"groups":[{"title":"G1","items":[{"name":"x"},{"name":"y"}]}]}</script>
      <template id="hbb2" data-wcs="for: groups">
        <div class="group"><h3 data-wcs="textContent: groups.*.title"></h3><em class="outer-index" data-wcs="textContent: $1"></em>
          <template id="hbb3" data-wcs="for: groups.*.items">
            <i data-wcs="textContent: groups.*.items.*.name"></i><b class="inner-index" data-wcs="textContent: $2"></b>
          </template>
        </div>
      </template>
    </wcs-ssr>
    <wcs-state enable-ssr json='{"groups":[]}'></wcs-state>
    <div id="outer">
      <!--@@wcs-for:hbb2-->
      <!--@@wcs-for-start:hbb2:groups:0--><div class="group"><h3 data-wcs="textContent: groups.*.title">G1</h3><em class="outer-index" data-wcs="textContent: $1">0</em>
        <!--@@wcs-for:hbb3-->
        <!--@@wcs-for-start:hbb3:groups.*.items:0--><i data-wcs="textContent: groups.*.items.*.name">x</i><b class="inner-index" data-wcs="textContent: $2">0</b><!--@@wcs-for-end:hbb3:groups.*.items:0-->
        <!--@@wcs-for-start:hbb3:groups.*.items:1--><i data-wcs="textContent: groups.*.items.*.name">y</i><b class="inner-index" data-wcs="textContent: $2">1</b><!--@@wcs-for-end:hbb3:groups.*.items:1-->
      </div><!--@@wcs-for-end:hbb2:groups:0-->
    </div>
  `;

  it("段数の足りない内側の行のバインディングと添字（$1 / $2）は適用せず、失敗を報告しない（外側の行は追従する）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = FIXTURE;
    const el = document.querySelector("wcs-state") as State;
    await el.connectedCallbackPromise;
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(texts("h3")).toEqual(["G1"]);
    expect(texts(".outer-index"), "添字は state に依存しないので、サーバーが書いたテキストのまま").toEqual(["0"]);
    expect(texts("i"), "サーバーが書いたテキストのまま").toEqual(["x", "y"]);
    expect(texts(".inner-index"), "サーバーが書いたテキストのまま").toEqual(["0", "1"]);
    expect(errorSpy.mock.calls.map((args) => String(args[0])), "失敗の報告を増やさない").toEqual([]);

    write(el, (s: any) => { s["groups.0.title"] = "G2"; });
    await flush();
    expect(texts("h3")).toEqual(["G2"]);
  });
});
