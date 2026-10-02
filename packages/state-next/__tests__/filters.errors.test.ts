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
import { registerFilters, resolveFilter } from "../src/filters/registry";
import { RENAMED_FILTERS } from "../src/diagnostics/explain";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  describe("3.2 で改名し 4.0 で外した旧名", () => {
    /** 3.x の `filterAliases`（packages/state/src/filters/filterAliases.ts）と同じ表 */
    const OLD = {
      inc: "add", dec: "sub", fix: "toFixed", uc: "upper", lc: "lower", cap: "capitalize",
      rep: "repeat", rev: "reverse", pad: "padStart", null: "nullIfEmpty",
    };
    const thrown = (name: string, args: string[] = []): string => {
      try {
        resolveFilter(name, args, args);
      } catch (e) {
        return (e as Error).message;
      }
      return "no error";
    };

    it.each(Object.entries(OLD))("%s: 正式名 %s を名指し、編集距離の近い別のフィルタ（did-you-mean）は出さない", (old, name) => {
      expect(thrown(old)).toBe(`[@wcstack/state] [wcs/filter-unknown] filter not found: ${old}. "${old}" was renamed "${name}" in 3.2 and removed in 4.0 — write "${name}".${LINT_HINT}`);
    });

    it("dec(1) は eq(1) を勧めない（従うと意味が黙って変わる）", () => {
      const message = thrown("dec", ["1"]);
      expect(message).not.toContain("Did you mean");
      expect(message).not.toContain('"eq"');
      expect(message).toContain('write "sub"');
    });

    it("substr は slice(start, start + length) を案内し、did-you-mean は出さない", () => {
      expect(thrown("substr", ["1", "3"])).toBe(`[@wcstack/state] [wcs/filter-unknown] filter not found: substr. "substr" was removed in 4.0 — write slice(start, start + length): slice takes the end index, not a length.${LINT_HINT}`);
    });

    it("表は lint（vscode-wcs の removedNames.ts）の旧名の表と同じ", () => {
      const src = readFileSync(join(__dirname, "../../vscode-wcs/src/service/removedNames.ts"), "utf8");
      const body = /REMOVED_FILTER_NAMES[^{]*\{([\s\S]*?)\}/.exec(src)![1];
      expect(Object.fromEntries([...body.matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]))).toEqual(OLD);
      expect(RENAMED_FILTERS).toEqual(OLD);
    });

    it("ページが同じ名前のフィルタを登録すれば、それが使われる（旧名の案内は出ない）", () => {
      registerFilters({ uc: { factory: () => (v: unknown) => `own:${String(v)}`, arity: [0, 0] } });
      expect(resolveFilter("uc", [], [])("a")).toBe("own:a");
    });

    it("旧名でない打ち間違いには、これまでどおり did-you-mean を出す", () => {
      expect(thrown("uppr")).toContain('Did you mean "upper"?');
      // a prototype key is not an old name
      expect(thrown("constructor")).not.toContain("was renamed");
    });
  });

  it("引数の個数: [wcs/filter-arity] + lint 誘導（不足と過剰の 2 つの文言）", () => {
    expect(() => resolveFilter("clamp", ["0"], [0]))
      .toThrow(`[@wcstack/state] [wcs/filter-arity] filter "clamp" requires at least 2 argument(s) (1 given).${LINT_HINT}`);
    expect(() => resolveFilter("upper", ["x"], ["x"]))
      .toThrow(`[@wcstack/state] [wcs/filter-arity] filter "upper" accepts at most 0 argument(s) (1 given).${LINT_HINT}`);
  });
});
