/**
 * ariaValidator.ts
 *
 * `attr.aria-*` バインドの属性名を WAI-ARIA の静的リストと照合する
 * (docs/a11y-design.md §8 / D9)。`attr.aria-labels` のようなタイポは
 * setAttribute がそのまま書き、支援技術が黙って無視する —「黙って無効になる」
 * クラスの誤りなので静的に捕まえる。
 *
 * severity は **warning リテラル**。exit code 契約（error のみ 1）と repo 全体の
 * CI ゲート（--errors-only）に触れない。error へ昇格する日が来たら
 * packages/lint/scripts/smoke-test.mjs の対ケース更新が必須（#180/#183 の
 * severity ドリフト再発防止線）。
 *
 * pure(DOM / vscode 非依存)。bindingValidator の走査・パーサと ioNodeValidator の
 * suggestion ヘルパを共有する（再実装すると IDE / CI で解釈が割れる）。
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { findAllBindAttributes, splitBindingExpressions, parseBindingExpression } from './bindingValidator.js';
import { suggestion } from './ioNodeValidator.js';

/**
 * WAI-ARIA の states & properties 全名の静的リスト。
 *
 * 出典: WAI-ARIA 1.2 (W3C Recommendation 2023-06-06)
 *       https://www.w3.org/TR/wai-aria-1.2/#state_prop_def
 *       + 実装が広く先行している 1.3 追加分
 *       (aria-braillelabel / aria-brailleroledescription / aria-description)。
 * 更新手順: 仕様の新属性を該当グループへ追記する。**削除はしない** —
 * deprecated (aria-dropeffect / aria-grabbed) も有効な属性名でありタイポでは
 * ない。builtinTags.generated.ts と同じ「出典コメント付き静的リスト」の流儀。
 */
const ARIA_ATTRIBUTES = new Set([
  // widget attributes
  'aria-autocomplete', 'aria-checked', 'aria-disabled', 'aria-errormessage',
  'aria-expanded', 'aria-haspopup', 'aria-hidden', 'aria-invalid',
  'aria-label', 'aria-level', 'aria-modal', 'aria-multiline',
  'aria-multiselectable', 'aria-orientation', 'aria-placeholder',
  'aria-pressed', 'aria-readonly', 'aria-required', 'aria-selected',
  'aria-sort', 'aria-valuemax', 'aria-valuemin', 'aria-valuenow',
  'aria-valuetext',
  // live region attributes
  'aria-busy', 'aria-live', 'aria-relevant', 'aria-atomic',
  // drag-and-drop (deprecated in 1.1, still valid names)
  'aria-dropeffect', 'aria-grabbed',
  // relationship attributes
  'aria-activedescendant', 'aria-colcount', 'aria-colindex',
  'aria-colindextext', 'aria-colspan', 'aria-controls', 'aria-describedby',
  'aria-details', 'aria-flowto', 'aria-labelledby', 'aria-owns',
  'aria-posinset', 'aria-rowcount', 'aria-rowindex', 'aria-rowindextext',
  'aria-rowspan', 'aria-setsize',
  // global additions
  'aria-current', 'aria-keyshortcuts', 'aria-roledescription',
  // 1.3 additions with broad implementation
  'aria-braillelabel', 'aria-brailleroledescription', 'aria-description',
]);

/**
 * HTML 中の全 `attr.aria-*` バインドの属性名を検査する。
 */
export function validateAriaAttributes(
  html: string,
  bindAttribute: string = 'data-wcs',
  locale?: string,
): WcsDiagnostic[] {
  const diagnostics: WcsDiagnostic[] = [];
  const msgs = getMessages(locale);

  for (const attr of findAllBindAttributes(html, bindAttribute)) {
    let exprOffset = 0;
    for (const expr of splitBindingExpressions(attr.value)) {
      const exprStart = attr.valueStart + exprOffset;
      exprOffset += expr.length + 1; // ';' の分
      const property = parseBindingExpression(expr).property;
      if (!property) continue;
      // 修飾子（#...）は属性名の一部ではない
      const bare = property.split('#')[0];
      if (!bare.toLowerCase().startsWith('attr.aria-')) continue;
      const ariaName = bare.slice('attr.'.length).toLowerCase();
      if (ARIA_ATTRIBUTES.has(ariaName)) continue;

      const propIndex = expr.indexOf(property);
      const start = propIndex === -1 ? exprStart : exprStart + propIndex;
      const end = propIndex === -1 ? exprStart + expr.length : start + property.length;
      diagnostics.push({
        code: WcsDiagnosticCode.AriaAttrUnknown,
        start,
        end,
        severity: 'warning',
        member: ariaName,
        message: msgs.ariaAttrUnknown(ariaName)
          + suggestion(ariaName, [...ARIA_ATTRIBUTES], msgs),
      });
    }
  }
  return diagnostics;
}
