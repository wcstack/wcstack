/**
 * filters.errors.test.ts — フィルタのエラー文言と did-you-mean
 * （@wcstack/state の filters.errorMessages.test.ts と errorGuidance.test.ts のフィルタ部分の移植）。
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  optionsRequired,
  optionMustBeNumber,
  valueMustBeNumber,
  valueMustBeDate,
  valueMustBeArray,
} from "../src/filters/errorMessages";
import { raiseError } from "../src/parser/raiseError";
import { didYouMean, LINT_HINT } from "../src/diagnostics/guidance";
import { installCoreFilters } from "../src/filters/core";
import { installFormats } from "../src/filters/formats";
import { resolveFilter } from "../src/filters/registry";
import { installFeatures } from "../src/hooks";
import { diagnostics } from "../src/features/diagnostics";

// messages as the full bundle shows them: the diagnostics add-on appends the guidance
installFeatures([diagnostics]);

beforeAll(() => {
  installCoreFilters();
  installFormats();
});

describe("filter errorMessages", () => {
  it("raiseError は @wcstack/state と同じ接頭辞を付けること", () => {
    expect(() => raiseError("boom")).toThrow("[@wcstack/state] boom");
  });

  describe("optionsRequired", () => {
    it("エラーメッセージにフィルター名が含まれること", () => {
      expect(() => optionsRequired("testFilter")).toThrow(/testFilter/);
      expect(() => optionsRequired("testFilter")).toThrow(/requires at least one option/);
    });
  });

  describe("optionMustBeNumber", () => {
    it("エラーメッセージにフィルター名が含まれること", () => {
      expect(() => optionMustBeNumber("testFilter")).toThrow(/testFilter/);
      expect(() => optionMustBeNumber("testFilter")).toThrow(/requires a number as option/);
    });
  });

  describe("valueMustBeNumber", () => {
    it("エラーメッセージにフィルター名が含まれること", () => {
      expect(() => valueMustBeNumber("testFilter")).toThrow(/testFilter/);
      expect(() => valueMustBeNumber("testFilter")).toThrow(/requires a number value/);
    });
  });

  describe("valueMustBeDate", () => {
    it("エラーメッセージにフィルター名が含まれること", () => {
      expect(() => valueMustBeDate("testFilter")).toThrow(/testFilter/);
      expect(() => valueMustBeDate("testFilter")).toThrow(/requires a date value/);
    });
  });

  describe("valueMustBeArray", () => {
    it("エラーメッセージにフィルター名が含まれること", () => {
      expect(() => valueMustBeArray("testFilter")).toThrow(/testFilter/);
      expect(() => valueMustBeArray("testFilter")).toThrow(/requires an array value/);
    });
  });
});

describe("didYouMean（編集距離 2・同距離先勝ち = lint の suggestion と同規準）", () => {
  it("距離 1（挿入・削除・置換）の候補を提案すること", () => {
    expect(didYouMean("uc2", ["uc", "lc"])).toBe(' Did you mean "uc"?');
    expect(didYouMean("trm", ["trim"])).toBe(' Did you mean "trim"?');
    expect(didYouMean("dete", ["date"])).toBe(' Did you mean "date"?');
  });

  it("距離 2 までは提案し、距離 3 以上は提案しないこと", () => {
    expect(didYouMean("trn", ["trim"])).toBe(' Did you mean "trim"?');
    expect(didYouMean("xyz", ["trim"])).toBe("");
    // 長さ差 3 以上の早期打ち切り経路
    expect(didYouMean("a", ["abcdef"])).toBe("");
  });

  it("同距離なら先の候補が勝つこと・候補が空なら空文字を返すこと", () => {
    expect(didYouMean("ac", ["ab", "ad"])).toBe(' Did you mean "ab"?');
    expect(didYouMean("anything", [])).toBe("");
  });

  it("大小文字を畳んで比較すること（lint の suggestion と同規準）・提案は元の表記で返すこと", () => {
    expect(didYouMean("innerHtml", ["innerHTML"])).toBe(' Did you mean "innerHTML"?');
  });

  it("空入力には提案しないこと（`a|` の末尾パイプ等で無意味な候補を出さない）", () => {
    expect(didYouMean("", ["uc", "lc"])).toBe("");
  });
});

describe("埋め込みサイトのメッセージ契約", () => {
  it("未知フィルタ: [wcs/filter-unknown] + did-you-mean + lint 誘導", () => {
    let message = "";
    try {
      resolveFilter("uppr", [], []);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(`[@wcstack/state] [wcs/filter-unknown] filter not found: uppr. Did you mean "upper"?${LINT_HINT}`);
  });

  it("formats を入れたページでは、formats 機能への案内を付けないこと", () => {
    let message = "";
    try {
      resolveFilter("zzzzzz", [], []);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe(`[@wcstack/state] [wcs/filter-unknown] filter not found: zzzzzz.${LINT_HINT}`);
  });

  it("引数の個数: [wcs/filter-arity] + lint 誘導（不足と過剰の 2 つの文言）", () => {
    expect(() => resolveFilter("clamp", ["0"], [0]))
      .toThrow(`[@wcstack/state] [wcs/filter-arity] filter "clamp" requires at least 2 argument(s) (1 given).${LINT_HINT}`);
    expect(() => resolveFilter("upper", ["x"], ["x"]))
      .toThrow(`[@wcstack/state] [wcs/filter-arity] filter "upper" accepts at most 0 argument(s) (1 given).${LINT_HINT}`);
  });
});
