/**
 * ssr.renderIsolation.test.ts — SSR のレンダリング 1 回分が、他のレンダリングへ漏れないこと。
 *
 * `@wcstack/server` の `renderToString` は 1 プロセスで何枚も描くが、state 側の台帳
 * （`structural/fragmentInfoByUUID` の構造テンプレート・`apply/ssrPropertyStore` の props）は
 * モジュール寿命で削除の口が無かった。スナップショットの直列化がその台帳を**丸ごと**読んでいたため、
 * 前のリクエストのテンプレートと props が次のページの HTML に載っていた（実測済みのデータ漏れ）。
 *
 * ここで固定する契約:
 *  - `<wcs-ssr>` に載るテンプレートは、**その文書のプレースホルダから辿れるもの**だけ。
 *  - `<wcs-ssr>` に載る props は、**その文書に今も繋がっているノード**のものだけ。
 *  - `for` / `if` テンプレートの中の `{{ }}` がスナップショットに残り、ハイドレーション後も生きる。
 *  - ハイドレーションは SSR の帳簿（`data-wcs-ssr-id`）を DOM に残さない。
 *  - ハイドレーションも未定義カスタム要素への `...: path` を定義待ちへ予約する。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { BindingSession } from "../src/bindings/BindingSession";
import { Ssr } from "../src/ssr/Ssr";
import { buildSsrDocument, resetSsrRenderState } from "../src/ssr/buildSsrDocument";
import { getAllSsrPropertyNodes } from "../src/apply/ssrPropertyStore";
import { getAllFragmentUUIDs } from "../src/structural/fragmentInfoByUUID";
import { getSsrSnapshotBuilder } from "../src/protocol/ssrSnapshot";

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

const flush = (): Promise<unknown> => new Promise((r) => setTimeout(r));

let seq = 0;
const uniqueTag = (prefix: string): string => `${prefix}-${++seq}`;

/** サーバー側の 1 レンダリング。返すのは `document.body.innerHTML`（renderToString と同じ形） */
async function serverRender(markup: string, state: Record<string, unknown>): Promise<string> {
  document.documentElement.setAttribute("data-wcs-server", "");
  document.body.innerHTML = markup;
  const el = document.querySelector("wcs-state") as State;
  el.setInitialState(state);
  await el.connectedCallbackPromise;
  await State.getBindingsReady(document);
  await flush();
  buildSsrDocument(document);
  const html = document.body.innerHTML;
  document.documentElement.removeAttribute("data-wcs-server");
  document.body.innerHTML = "";
  return html;
}

async function clientHydrate(html: string, state: Record<string, unknown>): Promise<State> {
  document.body.innerHTML = html;
  const el = document.querySelector("wcs-state") as State;
  el.setInitialState(state);
  await el.connectedCallbackPromise;
  await State.getBindingsReady(document);
  await flush();
  return el;
}

const snapshotOf = (html: string): string => html.slice(html.indexOf("<wcs-ssr"), html.indexOf("</wcs-ssr>"));

describe("レンダリング間の分離（モジュール大域の台帳）", () => {
  it("前のページの構造テンプレートが次のページの <wcs-ssr> に載らないこと", async () => {
    const pageA = await serverRender(
      `<wcs-state enable-ssr></wcs-state>` +
      `<ul><template data-wcs="for: secretItems"><li class="row-a" data-wcs="textContent: secretItems.*.n"></li></template></ul>`,
      { secretItems: [{ n: "SECRET-A" }] },
    );
    // ページ A 自身には載っている（対照）
    expect(snapshotOf(pageA)).toContain("row-a");

    const pageB = await serverRender(
      `<wcs-state enable-ssr></wcs-state>` +
      `<ul><template data-wcs="for: publicItems"><li class="row-b" data-wcs="textContent: publicItems.*.n"></li></template></ul>`,
      { publicItems: [{ n: "PUBLIC-B" }] },
    );
    const snapshotB = snapshotOf(pageB);
    expect(snapshotB).toContain("row-b");
    // ページ A の痕跡が 1 つも無いこと（データ漏れなので「痕跡ゼロ」を直接見る）
    expect(snapshotB).not.toContain("row-a");
    expect(snapshotB).not.toContain("secretItems");
    expect(snapshotB.match(/<template/g)).toHaveLength(1);
  });

  it("繰り返し描いてもテンプレート数が増えないこと（台帳の線形増加）", async () => {
    const markup = `<wcs-state enable-ssr></wcs-state>` +
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: items.*.n"></li></template></ul>`;
    const counts: number[] = [];
    for (let i = 0; i < 4; i++) {
      const html = await serverRender(markup, { items: [{ n: i }] });
      counts.push((snapshotOf(html).match(/<template/g) ?? []).length);
    }
    expect(counts).toEqual([1, 1, 1, 1]);
  });

  it("入れ子のテンプレートも辿れること（行ごとに同じ uuid が現れても 1 回だけ載る）", async () => {
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state>` +
      `<ul><template data-wcs="for: groups">` +
      `<li><ol><template data-wcs="for: groups.*.rows"><li data-wcs="textContent: groups.*.rows.*.n"></li></template></ol></li>` +
      `</template></ul>`,
      { groups: [{ rows: [{ n: 1 }, { n: 2 }] }, { rows: [{ n: 3 }] }] },
    );
    const snapshot = snapshotOf(html);
    // 外側と内側で 2 枚。内側は行ごとにプレースホルダが出るが重複して載らない
    expect(snapshot.match(/<template/g)).toHaveLength(2);
    expect(snapshot).toContain("for: groups");
    expect(snapshot).toContain("for: groups.*.rows");
  });

  it("if が偽で一度も描かれていない枝の中のテンプレートも載ること", async () => {
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state>` +
      `<template data-wcs="if: shown"><ul><template data-wcs="for: items"><li data-wcs="textContent: items.*.n"></li></template></ul></template>`,
      { shown: false, items: [{ n: 1 }] },
    );
    const snapshot = snapshotOf(html);
    expect(snapshot).toContain("if: shown");
    expect(snapshot).toContain("for: items");
  });

  it("台帳に無い uuid のプレースホルダは黙って落とすこと（reset の後に描き直しても落ちない）", async () => {
    document.documentElement.setAttribute("data-wcs-server", "");
    document.body.innerHTML =
      `<wcs-state enable-ssr></wcs-state>` +
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: items.*.n"></li></template></ul>`;
    const el = document.querySelector("wcs-state") as State;
    el.setInitialState({ items: [{ n: 1 }] });
    await el.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();

    // 文書にはプレースホルダが残ったまま台帳だけを捨てる（後始末の順序を間違えた形）
    resetSsrRenderState();
    const ssrEl = document.createElement("wcs-ssr");
    expect(() => Ssr.buildContent(ssrEl, { items: [{ n: 1 }] }, document)).not.toThrow();
    // 辿れない uuid は黙って落ち、テンプレートは 1 枚も載らない
    expect(ssrEl.querySelectorAll("template").length).toBe(0);
    document.documentElement.removeAttribute("data-wcs-server");
  });

  it("`enable-ssr` の無いページの props が、次のページの props JSON に載らないこと", async () => {
    // ページ A: SSR モードだが enable-ssr 無し → buildContent を通らない
    document.documentElement.setAttribute("data-wcs-server", "");
    document.body.innerHTML = `<wcs-state></wcs-state><input data-wcs="valueAsNumber: secret">`;
    const elA = document.querySelector("wcs-state") as State;
    elA.setInitialState({ secret: "PRIVATE-C" });
    await elA.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();
    document.documentElement.removeAttribute("data-wcs-server");
    document.body.innerHTML = "";

    const pageB = await serverRender(`<wcs-state enable-ssr></wcs-state><p>hi</p>`, { other: 1 });
    expect(pageB).not.toContain("PRIVATE-C");
    expect(pageB).not.toContain("data-wcs-ssr-props");
  });

  it("`enable-ssr` の無いページの後でも props の台帳が空になっていること（強参照 Set を跨がせない）", async () => {
    document.documentElement.setAttribute("data-wcs-server", "");
    document.body.innerHTML = `<wcs-state></wcs-state><input data-wcs="valueAsNumber: secret">`;
    const el = document.querySelector("wcs-state") as State;
    el.setInitialState({ secret: 1 });
    await el.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await flush();
    expect(getAllSsrPropertyNodes().length).toBeGreaterThan(0);
    // サーバーの最終パスは `enable-ssr` が 0 件でも後始末を通る
    buildSsrDocument(document);
    expect(getAllSsrPropertyNodes()).toEqual([]);
    document.documentElement.removeAttribute("data-wcs-server");
  });

  it("自分のページの props は今までどおり載ること（フィルタが効きすぎていないこと）", async () => {
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state><div data-wcs="innerHTML: html"></div>`,
      { html: "<b>bold</b>" },
    );
    expect(html).toContain("data-wcs-ssr-props");
    expect(html).toContain("data-wcs-ssr-id");
  });

  it("登録した snapshot builder が reset を提供すること（レンダラはこれ越しに呼ぶ）", () => {
    // パッケージの import ではなくプロトコル越しに渡す — グローバル symbol は
    // 「実際に動いた state のコピー」を指すので、捨てるべき台帳を持っている当人に届く。
    // 分割エントリを直接 import すると core がもう 1 つ読み込まれ、別の台帳を空にして終わる
    const registered = getSsrSnapshotBuilder();
    expect(registered).not.toBeNull();
    expect(registered!.reset).toBe(resetSsrRenderState);
  });

  it("resetSsrRenderState() が両方の台帳を空にすること", async () => {
    const markup = `<wcs-state enable-ssr></wcs-state>` +
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: items.*.n"></li></template></ul>`;
    await serverRender(markup, { items: [{ n: 1 }] });
    expect(getAllFragmentUUIDs().length).toBeGreaterThan(0);
    resetSsrRenderState();
    expect(getAllFragmentUUIDs()).toEqual([]);
    expect(getAllSsrPropertyNodes()).toEqual([]);
    // 台帳が空でも、次のレンダリングは自分のテンプレートを自分で登録するので影響を受けない
    const after = await serverRender(markup, { items: [{ n: 2 }] });
    expect((snapshotOf(after).match(/<template/g) ?? [])).toHaveLength(1);
  });
});

describe("for / if テンプレートの中の {{ }}", () => {
  it("スナップショットにテキスト束縛が残ること（空 Text に潰したまま直列化しない）", async () => {
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state>` +
      `<ul><template data-wcs="for: items"><li>row {{ .n }}!</li></template></ul>`,
      { items: [{ n: 1 }, { n: 2 }] },
    );
    const snapshot = snapshotOf(html);
    expect(snapshot).toContain("@@: items.*.n");
    // サーバーが描いた本文はこれまでどおり正しい
    expect(html).toContain("@@wcs-text-start:items.*.n");
  });

  it("ハイドレーション後もテキストが残り、その後の書き込みが届くこと", async () => {
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state>` +
      `<ul><template data-wcs="for: items"><li>row {{ .n }}!</li></template></ul>`,
      { items: [{ n: 1 }, { n: 2 }] },
    );
    const el = await clientHydrate(html, { items: [{ n: 1 }, { n: 2 }] });
    const texts = (): (string | null)[] => Array.from(document.querySelectorAll("li")).map((li) => li.textContent);
    expect(texts()).toEqual(["row 1!", "row 2!"]);

    el.createState("writable", (s: any) => { s.items = [{ n: 7 }, { n: 8 }, { n: 9 }]; });
    await flush();
    expect(texts()).toEqual(["row 7!", "row 8!", "row 9!"]);
  });

  it("if テンプレートの中の {{ }} も同じであること", async () => {
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state>` +
      `<template data-wcs="if: shown"><p>hello {{ who }}!</p></template>`,
      { shown: true, who: "Alice" },
    );
    expect(snapshotOf(html)).toContain("@@: who");
    const el = await clientHydrate(html, { shown: true, who: "Alice" });
    expect(document.querySelector("p")!.textContent).toBe("hello Alice!");
    el.createState("writable", (s: any) => { s.who = "Bob"; });
    await flush();
    expect(document.querySelector("p")!.textContent).toBe("hello Bob!");
  });
});

describe("ハイドレーションの後始末と予約", () => {
  it("data-wcs-ssr-id を DOM に残さないこと（cleanupDom と対称）", async () => {
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state><div data-wcs="innerHTML: html"></div>`,
      { html: "<b>bold</b>" },
    );
    expect(html).toContain("data-wcs-ssr-id");
    await clientHydrate(html, { html: "<b>bold</b>" });
    // props は復元されている
    expect(document.querySelector("div")!.innerHTML).toBe("<b>bold</b>");
    // 帳簿は残らない
    expect(document.querySelectorAll("[data-wcs-ssr-id]").length).toBe(0);
  });

  it("props の復元が 1 件ごとに querySelector しないこと（件数に対して二次だった）", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => `<p data-wcs="textContent: rows.${i}"></p>`).join("");
    const state = (): Record<string, unknown> => ({ rows: Array.from({ length: 12 }, (_, i) => `r${i}`) });
    const html = await serverRender(`<wcs-state enable-ssr></wcs-state>${rows}`, state());

    const byIdSelector: string[] = [];
    let allSelectorCalls = 0;
    const original = document.querySelector.bind(document);
    const originalAll = document.querySelectorAll.bind(document);
    vi.spyOn(document, "querySelector").mockImplementation((sel: string) => {
      if (sel.indexOf("data-wcs-ssr-id=") !== -1) byIdSelector.push(sel);
      return original(sel);
    });
    vi.spyOn(document, "querySelectorAll").mockImplementation((sel: string) => {
      if (sel.indexOf("data-wcs-ssr-id") !== -1) allSelectorCalls++;
      return originalAll(sel) as never;
    });
    await clientHydrate(html, state());
    // 索引は querySelectorAll で作る（= spy が刺さっている証拠でもある）。
    // id ごとの querySelector は 1 件も出ない
    expect(allSelectorCalls).toBeGreaterThan(0);
    expect(byIdSelector).toEqual([]);
    expect(Array.from(document.querySelectorAll("p")).map((p) => p.textContent)).toEqual(state().rows);
  });

  it("未定義カスタム要素への `...: path` を定義待ちへ予約すること（通常経路と同じ）", async () => {
    const tag = uniqueTag("ssr-spread");
    const html = await serverRender(
      `<wcs-state enable-ssr></wcs-state><${tag} data-wcs="...: cfg"></${tag}>`,
      { cfg: { label: "X" } },
    );

    // `customElements.whenDefined` は DefinitionCoordinator が registry+tag ごとに 1 本へ束ねるので、
    // サーバー側の予約が残っていると観測できない。予約そのものを見る
    const deferred: string[] = [];
    const originalDefer = BindingSession.prototype.deferUntilDefined;
    vi.spyOn(BindingSession.prototype, "deferUntilDefined").mockImplementation(
      function (this: BindingSession, node: Node, tagName: string, cb: () => void, rej?: (e: unknown) => void) {
        deferred.push(tagName);
        return originalDefer.call(this, node, tagName, cb, rej);
      } as typeof BindingSession.prototype.deferUntilDefined,
    );

    await clientHydrate(html, { cfg: { label: "X" } });
    expect(deferred).toContain(tag);
  });
});
