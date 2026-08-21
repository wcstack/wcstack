/**
 * errorGuidance.test.ts — self-fix 誘導（GTM 2-5 / static-wiring-dx-design.md §3）。
 *
 * did-you-mean の規準（編集距離 2・同距離先勝ち）と、各埋め込みサイトの
 * メッセージ契約（`wcs/*` code の三面同語彙・候補・lint 誘導）を固定する。
 */
import { describe, it, expect } from "vitest";
import { didYouMean, LINT_HINT } from "../src/errorGuidance";
import { builtinFilterFn, outputBuiltinFilters } from "../src/filters/builtinFilters";
import { parseBindTextsForElement } from "../src/bindTextParser/parseBindTextsForElement";
import { processDccDeclarations } from "../src/dcc/processDccDeclarations";

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
      builtinFilterFn("uc2", [])(outputBuiltinFilters);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("[wcs/filter-unknown]");
    expect(message).toContain('Did you mean "uc"?');
    expect(message).toContain(LINT_HINT);
  });

  it("構造型の単独バインディング違反: [wcs/template-syntax] + 正しい形（lint は未検出のため誘導なし）", () => {
    let message = "";
    try {
      parseBindTextsForElement("for: items; textContent: a");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("[wcs/template-syntax]");
    expect(message).toContain('<template data-wcs="for: items">');
    // lint に単独バインディング検査は未実装 — 誘導が空振りしないよう hint は付けない
    expect(message).not.toContain(LINT_HINT);
  });

  it("DCC 非実在名: state の宣言名からの did-you-mean（$ 予約名は候補に出さない・lint 誘導なし）", () => {
    const state = { count: 0, $bindables: ["count2"] };
    let message = "";
    try {
      processDccDeclarations(state as never);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('"count2" is not declared on the state');
    expect(message).toContain('Did you mean "count"?');
    expect(message).not.toContain(LINT_HINT);
  });

  it("DCC の候補は宣言種別で分けること（$commands のタイポに値プロパティを提案しない）", () => {
    const state = { incr: 0, inc() { /* method */ } };
    let message = "";
    try {
      processDccDeclarations({ ...state, $commands: ["incc"] } as never);
    } catch (e) {
      message = (e as Error).message;
    }
    // "incc" は値プロパティ "incr"(距離1)よりメソッド "inc"(距離1)を提案する
    // (値側を提案すると次は「is not a method」エラーに嵌まるため)
    expect(message).toContain('Did you mean "inc"?');
  });

  it("watch 宣言: lint が検出する shape にだけ誘導が付くこと", async () => {
    const { processWatchDeclaration } = await import("../src/watch/processWatchDeclaration");
    const fakeElement = { setPathInfo: () => {} };
    const messageOf = (watch: unknown): string => {
      try {
        processWatchDeclaration(fakeElement as never, { $watch: watch } as never);
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    };
    // lint 検出 shape($ 始まり)→ code + 誘導
    const dollar = messageOf({ "$streams": () => {} });
    expect(dollar).toContain("[wcs/watch-declaration-invalid]");
    expect(dollar).toContain(LINT_HINT);
    // lint 未検出 shape(非オブジェクト)→ code のみ・誘導なし
    const nonObject = messageOf("not an object");
    expect(nonObject).toContain("[wcs/watch-declaration-invalid]");
    expect(nonObject).not.toContain(LINT_HINT);
  });
});
