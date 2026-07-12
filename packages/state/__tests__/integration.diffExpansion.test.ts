/**
 * integration.diffExpansion.test.ts — リスト置換時の diff-filter 依存展開の
 * エンドツーエンド契約（docs/list-replacement-dependency-scaling.md）。
 *
 * - 未変更行の getter はリスト置換で再評価されない（スケーリング根治の観測面）
 * - 他行を読む getter（隣接項目参照）は自動検出され全行展開へフォールバックする
 * - $getAll 集計は削除・クリアでも更新される（コンテナ動的エッジ）
 * - 同一参照の再代入（in-place 変異リフレッシュ）は従来通り全行更新する
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`diffexp-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElementByName(shadowRoot, "default")!;
  return { host, shadowRoot, stateElement };
}

describe("リスト置換の diff-filter 展開（統合）", () => {
  it("末尾追加では未変更行のバインディング・行外参照のみの getter が再評価されないこと", async () => {
    // 注: 行データ（this["items.*.x"]）を読む getter は、親走査が container エッジ
    // （items → getter）を登録するため全行展開経路が残る（docs §4.1）。ここでは
    // スカラーと $1 のみを読む getter（container エッジ無し）で diff-filter の
    // 効果を観測する。plain パス（.v の mustache）は静的展開のフィルタで担保される。
    let evals = 0;
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ v: 1 }, { v: 2 }],
        cursor: 1,
        get "items.*.sel"(this: any) { evals++; return String(this.$1 === this.cursor); },
      },
      `<ul><template data-wcs="for: items"><li><span class="v">{{ .v }}</span>:<span class="s" data-wcs="textContent: .sel"></span></li></template></ul>`,
    );
    const texts = (cls: string) => Array.from(shadowRoot.querySelectorAll(`span.${cls}`)).map(el => el.textContent);
    expect(texts("v")).toEqual(["1", "2"]);
    expect(texts("s")).toEqual(["false", "true"]);
    expect(evals).toBe(2); // 初期描画で各行 1 回
    const before = evals;

    stateElement.createState("writable", (s: any) => {
      s.items = [...s.items, { v: 3 }];
    });
    await flush();

    expect(texts("v")).toEqual(["1", "2", "3"]);
    expect(texts("s")).toEqual(["false", "true", "false"]);
    expect(evals - before).toBe(1); // 追加行の 1 回のみ（従来は全行再評価）
    host.remove();
  });

  it("隣接項目参照 getter は自動検出され、未変更位置の行も正しく更新されること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ v: 10 }, { v: 30 }, { v: 60 }],
        get "items.*.diff"(this: any) {
          const i = this.$1;
          if (i === 0) return this["items.*.v"];
          return this["items.*.v"] - this.$resolve("items.*.v", [i - 1]);
        },
      },
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: .diff"></li></template></ul>`,
    );
    const texts = () => Array.from(shadowRoot.querySelectorAll("li")).map(li => li.textContent);
    expect(texts()).toEqual(["10", "20", "30"]);
    // 初期評価で他行読み取り（$resolve [i-1]）が検出されている
    expect(stateElement.crossRowListPaths!.has("items")).toBe(true);

    // 先頭要素だけ新しいオブジェクトに置換（行 1,2 は同一オブジェクト・同一位置 =
    // diff 上は未変更）。行 1 の diff は前行の値に依存するため、全行展開への
    // フォールバックが無ければ古い値のまま残る。
    stateElement.createState("writable", (s: any) => {
      s.items = [{ v: 25 }, s.items[1], s.items[2]];
    });
    await flush();
    expect(texts()).toEqual(["25", "5", "30"]);
    host.remove();
  });

  it("$getAll 集計は末尾削除・クリアでも更新されること（コンテナ動的エッジ）", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ p: 1 }, { p: 2 }, { p: 3 }],
        // String() は happy-dom の textContent falsy quirk 回避（数値 0 を代入すると
        // 空になる。実ブラウザは "0" を描画する）
        get total(this: any) { return String(this.$getAll("items.*.p", []).reduce((a: number, b: number) => a + b, 0)); },
      },
      `<div id="total" data-wcs="textContent: total"></div>
       <ul><template data-wcs="for: items"><li data-wcs="textContent: .p"></li></template></ul>`,
    );
    const total = () => shadowRoot.querySelector("#total")!.textContent;
    expect(total()).toBe("6");

    // 末尾削除: changeIndexSet/addIndexSet とも空 = diff-filter 展開はゼロ。
    // total の更新はコンテナ動的エッジ（items → total）のみが担う。
    stateElement.createState("writable", (s: any) => {
      s.items = s.items.slice(0, 2);
    });
    await flush();
    expect(total()).toBe("3");
    expect(shadowRoot.querySelectorAll("li")).toHaveLength(2);

    stateElement.createState("writable", (s: any) => {
      s.items = [];
    });
    await flush();
    expect(total()).toBe("0");
    expect(shadowRoot.querySelectorAll("li")).toHaveLength(0);
    host.remove();
  });

  it("同一参照の再代入は in-place 変異後のリフレッシュとして機能すること（全行展開フォールバック）", async () => {
    // バインド済み plain パス（items.*.v）は静的展開の対象。同一参照の再代入では
    // diff が空になるため、全行展開へのフォールバックが無ければ再適用されない。
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ v: 1 }, { v: 2 }],
      },
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: .v"></li></template></ul>`,
    );
    const texts = () => Array.from(shadowRoot.querySelectorAll("li")).map(li => li.textContent);
    expect(texts()).toEqual(["1", "2"]);

    stateElement.createState("writable", (s: any) => {
      const arr = s.items; // 生配列（getByAddress は生値を返す）
      arr[0].v = 5;        // in-place 変異（通知されない）
      s.items = arr;       // 同一参照の再代入 = リフレッシュイディオム
    });
    await flush();
    expect(texts()).toEqual(["5", "2"]);

    // spread コピー再代入（同じイディオムの別綴り）も同様にリフレッシュされること
    stateElement.createState("writable", (s: any) => {
      const arr = s.items;
      arr[1].v = 7;
      s.items = [...arr]; // 新配列・同一行オブジェクト = diff に変化ゼロ
    });
    await flush();
    expect(texts()).toEqual(["5", "7"]);
    host.remove();
  });

  it("中間行の削除では位置が変わった行の $1 依存 getter が更新されること", async () => {
    const { host, shadowRoot, stateElement } = await mount(
      {
        items: [{ name: "a" }, { name: "b" }, { name: "c" }],
        get "items.*.label"(this: any) { return `${this.$1}:${this["items.*.name"]}`; },
      },
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: .label"></li></template></ul>`,
    );
    const texts = () => Array.from(shadowRoot.querySelectorAll("li")).map(li => li.textContent);
    expect(texts()).toEqual(["0:a", "1:b", "2:c"]);

    // 中間行を削除: c は位置 2→1 に移動（changeIndexSet）なので再評価される
    stateElement.createState("writable", (s: any) => {
      s.items = [s.items[0], s.items[2]];
    });
    await flush();
    expect(texts()).toEqual(["0:a", "1:c"]);
    host.remove();
  });
});
