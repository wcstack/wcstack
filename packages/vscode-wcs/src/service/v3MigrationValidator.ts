/**
 * v3MigrationValidator.ts
 *
 * `wcs/v3-migration`: `@wcstack/state` 3.0 が拒否する（または読み方を変える）書き方を、2.x の
 * ランタイムと**同じ判定**（`@wcstack/state/parser` の findV3MigrationIssues）で知らせる
 * （次期メジャーの要件 D2 — 3.0 は互換層を持たず、2.x の最後の minor が予告する）。
 *
 * 対象は静的に分かる形だけ: 2 つ目の `#`・`else:` の後ろの値・構造ディレクティブの修飾子・
 * `radio#ro:`・閉じていない引用符・引用符の無い true / false / null を取る eq / ne / defaults。
 * フィルタの引数の超過は既存の `wcs/filter-arity`（error）が報告するので渡さない。値や API 呼び出しで
 * 決まるもの（空値・readonly の書き込み・`#ro` マウント）はランタイムの `[wcs/v3-migration]` だけ。
 *
 * severity は info — 2.x では正しく動く（か、既に黙って効いていない）書き方で、`--strict` の CI を
 * minor の更新で落とさない。
 *
 * pure（DOM / vscode 非依存）。
 */

import { findEmbeddedV3MigrationIssues, findV3MigrationIssues } from "@wcstack/state/parser";
import { parseBindTextWithPositions } from "../core/parser/positionalParser.js";
import { WcsDiagnosticCode } from "../core/diagnostics.js";
import { getMessages } from "../core/messages.js";
import { findAllBindAttributes, type BindingDiagnostic } from "./bindingValidator.js";
import { findAllCommentBindings, findAllMustacheSyntax } from "./templateSyntax.js";

export function validateV3Migration(
  html: string,
  bindAttrName: string = "data-wcs",
  locale?: string,
): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];
  const msgs = getMessages(locale);
  const push = (detail: string, start: number, end: number): void => {
    diagnostics.push({ code: WcsDiagnosticCode.V3Migration, start, end, message: msgs.v3Migration(detail), severity: "info" });
  };

  for (const attr of findAllBindAttributes(html, bindAttrName)) {
    for (const binding of parseBindTextWithPositions(attr.value)) {
      for (const detail of findV3MigrationIssues(binding.exprText)) {
        push(detail, attr.valueStart + binding.exprRange.start, attr.valueStart + binding.exprRange.end);
      }
    }
  }

  for (const item of [...findAllMustacheSyntax(html), ...findAllCommentBindings(html)]) {
    for (const detail of findEmbeddedV3MigrationIssues(item.expression)) {
      push(detail, item.exprStart, item.exprEnd);
    }
  }

  return diagnostics;
}
