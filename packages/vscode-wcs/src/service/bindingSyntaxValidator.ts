/**
 * bindingSyntaxValidator.ts
 *
 * `wcs/binding-syntax`: ランタイムが `[wcs/binding-syntax]` で拒否する書き方を、**正本パーサ**
 * （`@wcstack/state/parser`）に通して同じ判定で報告する（三面同語彙）。
 *
 * 対象は @wcstack/state 3.0 の文法の厳格化（要件 B2 / B4）: 閉じていない引用符・2 つ目の `#`
 * （`value#ro#wo`）・`else:` の後ろの値・構造ディレクティブや spread の左辺の修飾子・空のフィルタ。
 * 判定をここで複製せず、正本が投げたエラーのうち `[wcs/binding-syntax]` のものだけを拾う —
 * 他の正本エラー（`wcs/template-syntax` など）は既存の validator が自前の範囲で報告している。
 *
 * pure（DOM / vscode 非依存）。
 */

import { parseBindTextWithPositions, parseEmbeddedTextWithPositions } from "../core/parser/positionalParser.js";
import { WcsDiagnosticCode } from "../core/diagnostics.js";
import { getMessages } from "../core/messages.js";
import { findAllBindAttributes, type BindingDiagnostic } from "./bindingValidator.js";
import { findAllMustacheSyntax } from "./templateSyntax.js";

const CODE_MARKER = "[wcs/binding-syntax]";

/** 正本のメッセージから接頭辞・コード・lint への誘導を落とし、中身だけを返す。対象外なら null */
function bindingSyntaxDetail(error: string | null): string | null {
  if (error === null) return null;
  const at = error.indexOf(CODE_MARKER);
  if (at === -1) return null;
  const detail = error.slice(at + CODE_MARKER.length).trim();
  const hint = detail.indexOf(" Validate statically:");
  return hint === -1 ? detail : detail.slice(0, hint);
}

export function validateBindingSyntax(
  html: string,
  bindAttrName: string = "data-wcs",
  locale?: string,
): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];
  const msgs = getMessages(locale);

  for (const attr of findAllBindAttributes(html, bindAttrName)) {
    for (const binding of parseBindTextWithPositions(attr.value)) {
      const detail = bindingSyntaxDetail(binding.error);
      if (detail === null) continue;
      diagnostics.push({
        code: WcsDiagnosticCode.BindingSyntax,
        start: attr.valueStart + binding.exprRange.start,
        end: attr.valueStart + binding.exprRange.end,
        message: msgs.bindingSyntax(detail),
        severity: "error",
      });
    }
  }

  for (const mustache of findAllMustacheSyntax(html)) {
    const detail = bindingSyntaxDetail(parseEmbeddedTextWithPositions(mustache.expression).error);
    if (detail === null) continue;
    diagnostics.push({
      code: WcsDiagnosticCode.BindingSyntax,
      start: mustache.exprStart,
      end: mustache.exprStart + mustache.expression.length,
      message: msgs.bindingSyntax(detail),
      severity: "error",
    });
  }

  return diagnostics;
}
