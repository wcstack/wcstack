/**
 * core/validateDocument.ts
 *
 * HTML ドキュメント検証の単一入口(Phase 5a §7.1)。VS Code の provideDiagnostics と
 * CI CLI が **同じこの関数** を呼ぶことで、同一入力から同一の {code, range, severity}
 * が出ることを構造的に保証する(§8 完了条件「IDE と CI の diagnostic code / range が
 * 一致」)。
 *
 * pure(DOM / vscode 非依存)。呼び出し側(plugin / CLI)が offset → position を担う。
 */

import { WcsDiagnostic, WcsDiagnosticCode, sortDiagnostics } from "./diagnostics.js";
import { validateBindings } from "../service/bindingValidator.js";
import { validateStateTypes } from "../service/stateTypeValidator.js";
import { validateNestedAssigns } from "../service/nestedAssignValidator.js";
import { validateTemplateSyntax } from "../service/templateSyntaxValidator.js";
import { validateIoNodes } from "../service/ioNodeValidator.js";
import { validateDocumentEnv } from "../service/documentEnvValidator.js";

export interface ValidateDocumentOptions {
  /** バインド属性名(既定 data-wcs)。 */
  readonly bindAttribute?: string;
  /** state タグ名(既定 wcs-state)。 */
  readonly stateTagName?: string;
  /**
   * 診断メッセージのロケール('ja' / 'en'、'ja-JP' 等も可)。既定 ja。
   * 安定契約は {code, range, severity} — message はロケールで変わってよい。
   */
  readonly locale?: string;
}

/**
 * HTML テキストを全 validator で検査し、code 付き診断を安定順で返す。
 */
export function validateDocument(text: string, options: ValidateDocumentOptions = {}): WcsDiagnostic[] {
  const bindAttribute = options.bindAttribute ?? "data-wcs";
  const stateTagName = options.stateTagName ?? "wcs-state";
  const locale = options.locale;

  const out: WcsDiagnostic[] = [];
  // bindingValidator / templateSyntaxValidator / ioNodeValidator / documentEnvValidator は既に code 付き。
  out.push(...validateBindings(text, bindAttribute, stateTagName, locale));
  out.push(...validateTemplateSyntax(text, stateTagName, bindAttribute, locale));
  out.push(...validateIoNodes(text, bindAttribute, stateTagName, locale));
  out.push(...validateDocumentEnv(text, locale));
  // 単一カテゴリの validator は集約時に code を付与する。
  for (const d of validateStateTypes(text, stateTagName, locale)) {
    out.push({ code: WcsDiagnosticCode.TypeAnnotation, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  for (const d of validateNestedAssigns(text, stateTagName, locale)) {
    out.push({ code: WcsDiagnosticCode.NestedAssign, start: d.start, end: d.end, message: d.message, severity: d.severity });
  }
  return sortDiagnostics(out);
}
