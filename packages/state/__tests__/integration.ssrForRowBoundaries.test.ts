/**
 * integration.ssrForRowBoundaries.test.ts — サーバー描画中に描いてあるリストを書き換えたときの、`for` の行の
 * 境界コメント（`@@wcs-for-start` / `-end`）を、**実際のサーバー出力**から固定する（#334）。
 *
 * 境界は行の Content の範囲の外にある。以前はサーバー描画中に空でないリストへ行を足すと、描いてある行は
 * Content だけが動いて自分の境界の前へ出（行の境界は空のまま末尾に残る）、足した行の境界は入れ子になった
 * （`start:1 … start:2 … end:2 end:1`）。ハイドレーションは境界の組で行を起こすので、一覧の書き換えが
 * `Cannot read properties of undefined (reading 'homeParentListIndex')` で投げ、行を `{{ }}` で描く形は
 * 読み込み直後から表示が崩れていた。
 *
 * 契約:
 *  - サーバー出力の行は、どの書き換え（足す・消す・並べ替え・要素の書き込み・丸ごと置換・祖先の if の
 *    切り替え）の後でも `start:i <行の中身> end:i` が添字の順に並ぶ（入れ子にならず、空の組を残さない）。
 *  - ハイドレーション後の一覧の書き換えは、`enable-ssr` を外した CSR と同じ表示になり、失敗を報告しない。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
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

const later = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

/** `#list` の行の表示（空白を詰める） */
const rowTexts = (): string[] =>
  Array.from(document.querySelectorAll("#list li")).map((li) => (li.textContent ?? "").replace(/\s+/g, " ").trim());

/**
 * サーバー出力の `#list` 直下の形。行の境界は `[i` / `i]`、要素はその表示、空白と置き場は落とす。
 * 境界の中の if の境界（`@@wcs-if-start` など）も落とす — 見たいのは行の境界と中身の並びだけ。
 */
function listShape(serverHtml: string): string {
  const host = document.createElement("div");
  host.innerHTML = serverHtml;
  const parts: string[] = [];
  for (const node of Array.from(host.querySelector("#list")!.childNodes)) {
    if (node.nodeType === Node.COMMENT_NODE) {
      const match = /^@@wcs-for-(start|end):\w+:items:(\d+)$/.exec((node as Comment).data);
      if (match !== null) {
        parts.push(match[1] === "start" ? `[${match[2]}` : `${match[2]}]`);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      parts.push((node.textContent ?? "").replace(/\s+/g, " ").trim());
    }
  }
  return parts.join(" ");
}

interface IRun {
  views: unknown[];
  errors: string[];
}

/** 読み込み（CSR なら描画、SSR ならハイドレーション）→ 書き込みを 1 つずつ流し、表示を集める */
async function run(html: string, make: () => any, steps: Step[]): Promise<IRun> {
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  try {
    const el = await clientLoad(html, make);
    const views: unknown[] = [rowTexts()];
    for (const step of steps) {
      try {
        write(el, step);
      } catch (error) {
        views.push(`throw: ${String(error)}`);
      }
      await settle();
      views.push(rowTexts());
    }
    return { views, errors };
  } finally {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await settle();
  }
}

async function compare(markup: string, make: () => any, steps: Step[])
  : Promise<{ csr: IRun; ssr: IRun; serverHtml: string }> {
  const csr = await run(csrMarkup(markup), make, steps);
  const serverHtml = await serverRender(markup, make);
  const ssr = await run(serverHtml, make, steps);
  return { csr, ssr, serverHtml };
}

const listMarkup = (row: string): string =>
  `<wcs-state enable-ssr></wcs-state><ul id="list"><template data-wcs="for: items">${row}</template></ul><p>{{ count }}</p>`;
const ROW_TEXT = `<li data-wcs="textContent: .n"></li>`;
const ROW_MUSTACHE = `<li>{{ .n }}</li>`;

/** Issue の表の書き込み（一覧に関係ない書き込み・行の葉・足す・消す・丸ごと置換） */
const ISSUE_STEPS: Step[] = [
  (s) => { s.count = 1; },
  (s) => { s["items.1.n"] = 20; },
  (s) => { s.items = [...s.items, { n: 99 }]; },
  (s) => { s.items = s.items.slice(1); },
  (s) => { s.items = [{ n: 7 }, { n: 8 }]; },
];
const ISSUE_VIEWS = [
  ["1", "2", "3"], ["1", "2", "3"], ["1", "20", "3"], ["1", "20", "3", "99"], ["20", "3", "99"], ["7", "8"],
];

/** サーバー描画中（`$connectedCallback` の await の後）にだけ items を書き換える state */
const serverMutation = (items: number[], mutate: (s: any) => Promise<void> | void) => (): any => ({
  items: items.map((n) => ({ n })),
  count: 0,
  async $connectedCallback(this: any) {
    await later();
    await mutate(this);
  },
});

describe("#334: サーバー描画中に空でないリストへ行を足す", () => {
  const make = serverMutation([1], (s) => { s.items = [...s.items, { n: 2 }, { n: 3 }]; });

  it("行の境界が添字の順に並び（旧: 行 0 の中身が境界の外・行 1/2 の境界が入れ子）、ハイドレーション後の一覧の書き換えが CSR と一致する（旧: homeParentListIndex で投げた）", async () => {
    const { csr, ssr, serverHtml } = await compare(listMarkup(ROW_TEXT), make, ISSUE_STEPS);
    expect(listShape(serverHtml)).toBe("[0 1 0] [1 2 1] [2 3 2]");
    expect(csr.views).toEqual(ISSUE_VIEWS);
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.errors).toEqual([]);
  });

  it("行を {{ }} で描く形も、読み込み直後から正しく表示される（旧: (空), 2, 2）", async () => {
    const { csr, ssr, serverHtml } = await compare(listMarkup(ROW_MUSTACHE), make, ISSUE_STEPS);
    expect(listShape(serverHtml)).toBe("[0 1 0] [1 2 1] [2 3 2]");
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views).toEqual(ISSUE_VIEWS);
    expect(ssr.errors).toEqual([]);
  });

  it("1 行だけ足しても、空の一覧に 2 行ずつ 3 回足しても（ページ送り）、境界が崩れない", async () => {
    const one = await compare(listMarkup(ROW_TEXT), serverMutation([1], (s) => { s.items = [...s.items, { n: 2 }]; }), ISSUE_STEPS);
    expect(listShape(one.serverHtml)).toBe("[0 1 0] [1 2 1]");
    expect(one.ssr.views).toEqual(one.csr.views);
    expect(one.ssr.errors).toEqual([]);

    const paging = await compare(listMarkup(ROW_TEXT), serverMutation([], async (s) => {
      for (let page = 0; page < 3; page++) {
        if (page > 0) await later();
        s.items = [...s.items, { n: 2 * page + 1 }, { n: 2 * page + 2 }];
      }
    }), ISSUE_STEPS);
    expect(listShape(paging.serverHtml)).toBe("[0 1 0] [1 2 1] [2 3 2] [3 4 3] [4 5 4] [5 6 5]");
    // 旧: `items.1.n` の書き込みが `ListIndex not found at index 1 of items` で投げた
    expect(paging.ssr.views[2]).toEqual(["1", "20", "3", "4", "5", "6"]);
    expect(paging.ssr.views).toEqual(paging.csr.views);
    expect(paging.ssr.errors).toEqual([]);
  });
});

describe("#334: 最初の描画だけの出力", () => {
  it("最初の描画の後にリストを書き換えなければ、出力は従来どおり（置き場の直後に start・行・end が添字の順）", async () => {
    const serverHtml = await serverRender(listMarkup(ROW_TEXT), () => ({ items: [{ n: 1 }, { n: 2 }], count: 0 }));
    expect(serverHtml).toMatch(new RegExp(
      "<!--@@wcs-for:(\\w+)--><!--@@wcs-for-start:\\1:items:0--><li[^>]*>1</li><!--@@wcs-for-end:\\1:items:0-->"
      + "<!--@@wcs-for-start:\\1:items:1--><li[^>]*>2</li><!--@@wcs-for-end:\\1:items:1--></ul>"));
  });
});

describe("#334: サーバー描画中のその他の書き換え", () => {
  const cases: [string, number[], (s: any) => void, string][] = [
    // 旧: 消す・並べ替える・要素の書き込みでは描いてあった行の中身が境界の外へ出て、丸ごと置換では
    // 外した行の空の境界の組が残った
    ["先頭の行を消す（行の境界も外し、残る行の添字を付け直す）", [1, 2, 3], (s) => { s.items = s.items.slice(1); }, "[0 2 0] [1 3 1]"],
    ["並べ替える（行を境界ごと動かす）", [1, 2, 3], (s) => { s.items = [...s.items].reverse(); }, "[0 3 0] [1 2 1] [2 1 2]"],
    ["要素を書き込む（その場で使い回す行）", [1, 2, 3], (s) => { s["items.1"] = { n: 9 }; }, "[0 1 0] [1 9 1] [2 3 2]"],
    ["丸ごと置き換える（プールから戻す行）", [1, 2], (s) => { s.items = [{ n: 7 }, { n: 8 }, { n: 9 }]; }, "[0 7 0] [1 8 1] [2 9 2]"],
  ];
  for (const [name, items, mutate, shape] of cases) {
    it(name, async () => {
      const { csr, ssr, serverHtml } = await compare(listMarkup(ROW_TEXT), serverMutation(items, mutate), ISSUE_STEPS);
      expect(listShape(serverHtml)).toBe(shape);
      expect(ssr.views).toEqual(csr.views);
      expect(ssr.errors).toEqual([]);
    });
  }

  it("行の中の if が描いたノードも、行の境界の内側のまま動く", async () => {
    const row = `<li><span data-wcs="textContent: .n"></span><template data-wcs="if: .show"><b>!</b></template></li>`;
    const make = (): any => ({
      items: [1, 2, 3].map((n) => ({ n, show: n % 2 === 1 })),
      count: 0,
      async $connectedCallback(this: any) {
        await later();
        this.items = [...this.items, { n: 4, show: false }, { n: 5, show: true }].reverse();
      },
    });
    const { csr, ssr, serverHtml } = await compare(listMarkup(row), make, [
      (s) => { s["items.1.show"] = true; },
      (s) => { s.items = [...s.items, { n: 99, show: true }]; },
      (s) => { s.items = [...s.items].reverse(); },
    ]);
    expect(listShape(serverHtml)).toBe("[0 5! 0] [1 4 1] [2 3! 2] [3 2 3] [4 1! 4]");
    expect(ssr.views).toEqual(csr.views);
    expect(ssr.views[0]).toEqual(["5!", "4", "3!", "2", "1!"]);
    expect(ssr.errors).toEqual([]);
  });

  it("行の直下の if が行の外に描いたノードも、行の境界ごと動く（サーバー出力）", async () => {
    // 行のテンプレートの直下に if があると、枝は行の Content の外（if の置き場の直後）に描かれる
    const row = `<li data-wcs="textContent: .n"></li><template data-wcs="if: .show"><li class="x">x</li></template>`;
    const serverHtml = await serverRender(listMarkup(row), () => ({
      items: [{ n: 1, show: true }, { n: 2, show: false }],
      count: 0,
      async $connectedCallback(this: any) {
        await later();
        this.items = [...this.items, { n: 3, show: true }];
        await later();
        this.items = [...this.items].reverse();
      },
    }));
    expect(listShape(serverHtml)).toBe("[0 3 x 0] [1 2 1] [2 1 x 2]");
  });

  it("祖先の if が一度隠して戻した行も、境界を置き直して中身を挟む（旧: 中身が境界の外へ出て、境界は空の組が残った）", async () => {
    const markup = `<wcs-state enable-ssr></wcs-state><ul id="list"><template data-wcs="if: shown">` +
      `<template data-wcs="for: items"><li data-wcs="textContent: .n"></li></template></template></ul>`;
    const make = (): any => ({
      shown: true,
      items: [{ n: 1 }, { n: 2 }],
      async $connectedCallback(this: any) {
        await later();
        this.items = [...this.items, { n: 3 }];
        this.shown = false;
        await later();
        this.shown = true;
        await later();
        this.items = [...this.items].reverse();
      },
    });
    const serverHtml = await serverRender(markup, make);
    expect(listShape(serverHtml)).toBe("[0 3 0] [1 2 1] [2 1 2]");
  });
});

describe("#334: SSR の外で描いた行", () => {
  it("同じ文書で後から SSR が始まっても、SSR の外で描いた（境界を持たない）行を外せる", async () => {
    document.body.innerHTML = `<wcs-state></wcs-state><ul id="list"><template data-wcs="for: items"><li data-wcs="textContent: .n"></li></template></ul>`;
    const stateEl = document.querySelector("wcs-state") as State;
    stateEl.setInitialState({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(document);
    await settle();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    document.documentElement.setAttribute("data-wcs-server", "");
    try {
      write(stateEl, (s) => { s.items = s.items.slice(1); });
      await settle();
    } finally {
      document.documentElement.removeAttribute("data-wcs-server");
    }
    expect(rowTexts()).toEqual(["2", "3"]);
    expect(errors).not.toHaveBeenCalled();
  });
});
