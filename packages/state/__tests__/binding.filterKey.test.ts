/**
 * binding.filterKey.test.ts — フィルタの鍵（要件 B9）。
 *
 * ここは**実パイプライン（`parseBindTextsForElement` → `planFilters`）が作る形だけ**で検証する。
 * 手で組んだ `inFilters` は実装が作らない形なので、鍵の実装が壊れていても green になる
 * （実際 `planFilters` が `literals` を捨てていた間、手組みのテストは通っていた）。
 *
 * 鍵を作る場所は 2 つあり（`core/filterRegistry.ts` の解決キャッシュと、ハンドラ共有キー /
 * 束縛キー / devtools の宣言キー）、どちらも `binding/filterKey.ts` の `filterArgsKey` を通す。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import { parseBindTextsForElement } from "../src/bindTextParser/parseBindTextsForElement";
import { planFilters } from "../src/bindings/planFilters";
import { filterArgsKey, filterListKey } from "../src/binding/filterKey";
import type { IFilterInfo } from "../src/types";

beforeAll(() => {
  bootstrapState();
});

const flush = () => new Promise((r) => setTimeout(r));
let seq = 0;

/** 実パイプラインと同じ形の入力フィルタ（解析 → 束縛計画） */
function plannedInFilters(propPart: string): IFilterInfo[] {
  const [parsed] = parseBindTextsForElement(`${propPart}: choice`);
  return planFilters(parsed.inFilters, "input");
}

describe("planFilters — 型付きの値を落とさない", () => {
  it("束縛計画の段のフィルタが literals を持ち回すこと", () => {
    const [planned] = plannedInFilters("radio|defaults(0)");
    expect(Object.keys(planned).sort()).toEqual(["args", "filterFn", "filterName", "literals"]);
    expect(planned.args).toEqual(["0"]);
    expect(planned.literals).toEqual([0]);
  });

  it("引用符付きの引数は文字列のまま持ち回されること", () => {
    const [planned] = plannedInFilters("radio|defaults('0')");
    expect(planned.args).toEqual(["0"]);
    expect(planned.literals).toEqual(["0"]);
  });

  it("引数の無いフィルタでも literals が空配列で載ること", () => {
    const [planned] = plannedInFilters("radio|int");
    expect(planned.literals).toEqual([]);
  });
});

describe("filterArgsKey — 登録簿とハンドラ共有キーの唯一の基準", () => {
  it("原文が同じで型付きの値が違えば別の鍵になること（要件 B9）", () => {
    expect(filterArgsKey(["0"], [0])).not.toBe(filterArgsKey(["0"], ["0"]));
  });

  it("型付きの値が同じで原文が違えば別の鍵になること（Number() の正規化を跨がない）", () => {
    expect(filterArgsKey(["1"], [1])).not.toBe(filterArgsKey(["1.0"], [1]));
  });
});

describe("filterListKey — 実パイプラインの形で型を区別する", () => {
  it("`defaults(0)` と `defaults('0')` が別の鍵になること", () => {
    const numeric = filterListKey(plannedInFilters("radio|defaults(0)"));
    const text = filterListKey(plannedInFilters("radio|defaults('0')"));
    expect(numeric).not.toBe(text);
  });

  it("同じ宣言は同じ鍵になること", () => {
    expect(filterListKey(plannedInFilters("radio|defaults(0)")))
      .toBe(filterListKey(plannedInFilters("radio|defaults(0)")));
  });

  it("フィルタが無ければ空文字であること", () => {
    expect(filterListKey(plannedInFilters("radio"))).toBe("");
  });
});

/**
 * 実際の症状: `handlerByHandlerKey` はモジュール大域なので、鍵が衝突すると後から配線された
 * 束縛が**先の束縛の inFilters を閉じ込めたハンドラ**を共有し、違う型の値を state へ書く。
 */
describe("ハンドラの共有（実 DOM・実パイプライン）", () => {
  it("リテラル型だけが違う 2 つの radio 束縛がハンドラを共有しないこと", async () => {
    const host = document.createElement(`filter-key-host-${++seq}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<input id="num" type="radio" name="g1" value="" data-wcs="radio|defaults(0): choice">` +
      `<input id="str" type="radio" name="g2" value="" data-wcs="radio|defaults('0'): choice">` +
      `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({ choice: "seed" });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    const stateElement = getStateElement(shadowRoot)!;
    const read = () => {
      let out: unknown;
      stateElement.createState("readonly", (s: any) => { out = s.choice; });
      return out;
    };

    const numeric = shadowRoot.querySelector("#num") as HTMLInputElement;
    const text = shadowRoot.querySelector("#str") as HTMLInputElement;

    // 先に配線された `defaults(0)` 側 — 空文字は falsy なので数値 0 に畳まれる
    numeric.checked = true;
    numeric.dispatchEvent(new Event("input"));
    await flush();
    expect(read()).toBe(0);

    // 後から配線された `defaults('0')` 側は自分のフィルタで畳む。鍵が衝突していると
    // 先のハンドラ（数値 0 を書く）を共有して number 0 になる
    text.checked = true;
    text.dispatchEvent(new Event("input"));
    await flush();
    expect(read()).toBe("0");
    expect(typeof read()).toBe("string");
    host.remove();
  });
});

/**
 * 同じ形（propName / イベント名 / state パス / フィルタ列）で **getter だけ違う** 2 つの
 * wc-bindable タグ。ハンドラのクロージャは `valueGetter` の実体を捕捉するので、鍵が
 * 「getter があるか」の真偽しか持たないと、後から配線した方が**先のタグの getter**で
 * 畳んだ値を state に書く。`filterListKey` を入れて塞いだのと同じ不完全さだった。
 */
describe("two-way ハンドラの共有（getter の実体）", () => {
  it("getter だけが違う 2 つのタグがハンドラを共有しないこと", async () => {
    const declare = (tag: string, prefix: string): void => {
      class El extends HTMLElement {
        static wcBindable = {
          protocol: "wc-bindable",
          version: 1,
          // イベント名も同じにする（鍵の他の成分を全部揃えて getter だけ違う形にする）
          properties: [{ name: "value", event: "tw-shared:value-changed", getter: (e: Event) => `${prefix}:${(e as CustomEvent).detail}` }],
          inputs: [{ name: "value" }],
        };
        value = "";
      }
      customElements.define(tag, El);
    };
    const alpha = `tw-alpha-${++seq}`;
    const beta = `tw-beta-${seq}`;
    declare(alpha, "ALPHA");
    declare(beta, "BETA");

    const host = document.createElement(`tw-host-${seq}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML =
      `<${alpha} id="a" data-wcs="value: shared"></${alpha}>` +
      `<${beta} id="b" data-wcs="value: shared"></${beta}>` +
      `<wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({ shared: "" });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    const stateElement = getStateElement(shadowRoot)!;
    const read = () => { let v: unknown; stateElement.createState("readonly", (s: any) => { v = s.shared; }); return v; };

    // 後から配線された beta で発火する。鍵が衝突していると alpha の getter が使われる
    shadowRoot.querySelector("#b")!.dispatchEvent(new CustomEvent("tw-shared:value-changed", { detail: "x" }));
    await flush();
    expect(read()).toBe("BETA:x");

    shadowRoot.querySelector("#a")!.dispatchEvent(new CustomEvent("tw-shared:value-changed", { detail: "y" }));
    await flush();
    expect(read()).toBe("ALPHA:y");
    host.remove();
  });
});
