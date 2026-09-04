/**
 * namedStateValidator.ts — 名前付き State（`<wcs-state name>` / `path@name`）は v2 で撤去。
 *
 * 名前の次元そのものが消え、`<wcs-state mount="path">` と接頭辞付きパスに置き換わった
 * （docs/state-mount-design.md D1 / D16、impl-plan P4-1）。ランタイムは name 属性で
 * fail-fast し、`@` を含むパスは parse error にする — この lint はそれと同じ文言を
 * 編集時に error で出す。
 *
 * 対象:
 *   - `<wcs-state name="x">` の name 属性（bind-component 込み — v1 の Light DOM
 *     name 必須はまとめて消えた）
 *   - `data-wcs` の各式の `path@name`（フィルタより前・括弧の外だけを見る）
 *   - mustache `{{ path@name }}`
 *   - コメントバインディング `<!--@@: path@name-->`（mustache の変換先 — 直書きも同じ構文）
 */

import { WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { parseWcsStateElements } from '../language/htmlParse.js';
import { findAllBindAttributes, splitBindingExpressions, type BindingDiagnostic } from './bindingValidator.js';
import { findAllCommentBindings, findAllMustacheSyntax } from './templateSyntax.js';

interface StateSelectorMatch {
  /** `@` の式内オフセット */
  start: number;
  /** 名前の末尾の式内オフセット（exclusive） */
  end: number;
  /** `@` の後ろの名前（空なら 'default'） */
  name: string;
}

/**
 * `prop: path@name|filters` の `@name` を探す。`embedded`（mustache）は `:` を持たない。
 * フィルタ（括弧の外の `|`）より前だけを見る — `|default(@)` の引数の `@` は対象外。
 */
export function findStateSelector(expr: string, embedded = false): StateSelectorMatch | null {
  const colon = embedded ? -1 : expr.indexOf(':');
  const from = colon + 1;
  let depth = 0;
  let end = expr.length;
  for (let i = from; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === '|' && depth === 0) {
      end = i;
      break;
    }
  }
  const at = expr.indexOf('@', from);
  if (at === -1 || at >= end) return null;
  const raw = expr.slice(at + 1, end);
  const name = raw.trim();
  const nameStart = at + 1 + (raw.length - raw.trimStart().length);
  return { start: at, end: name.length === 0 ? at + 1 : nameStart + name.length, name: name.length === 0 ? 'default' : name };
}

export function validateNamedState(
  html: string,
  attrName: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
): BindingDiagnostic[] {
  const msgs = getMessages(locale);
  const diagnostics: BindingDiagnostic[] = [];

  // 1. <wcs-state name="x">
  for (const element of parseWcsStateElements(html, stateTagName)) {
    const tagText = html.slice(element.tagStart, element.tagEnd);
    const match = /(?:^|\s)name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tagText);
    if (match === null) continue;
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    // 値の位置: マッチ末尾から値の長さぶん戻る（引用符付きなら閉じ引用符の 1 文字前）
    const quoted = match[1] !== undefined || match[2] !== undefined;
    const valueEnd = element.tagStart + match.index + match[0].length - (quoted ? 1 : 0);
    diagnostics.push({
      code: WcsDiagnosticCode.NamedStateDeprecated,
      start: valueEnd - value.length,
      end: valueEnd,
      message: msgs.namedStateAttrDeprecated(value),
      severity: 'error',
    });
  }

  // 2. data-wcs の各式
  for (const attr of findAllBindAttributes(html, attrName)) {
    let pos = 0;
    for (const expr of splitBindingExpressions(attr.value)) {
      const selector = findStateSelector(expr);
      if (selector !== null) {
        diagnostics.push({
          code: WcsDiagnosticCode.NamedStateDeprecated,
          start: attr.valueStart + pos + selector.start,
          end: attr.valueStart + pos + selector.end,
          message: msgs.namedStatePathDeprecated(selector.name),
          severity: 'error',
        });
      }
      pos += expr.length + 1;
    }
  }

  // 3. mustache / コメントバインディング（`<!--@@: path@name-->` — 実 DOM では
  // mustache がこの形へ変換される。直書きも同じ runtime parse error になる）
  for (const item of [...findAllMustacheSyntax(html), ...findAllCommentBindings(html)]) {
    const selector = findStateSelector(item.expression, true);
    if (selector !== null) {
      diagnostics.push({
        code: WcsDiagnosticCode.NamedStateDeprecated,
        start: item.exprStart + selector.start,
        end: item.exprStart + selector.end,
        message: msgs.namedStatePathDeprecated(selector.name),
        severity: 'error',
      });
    }
  }

  return diagnostics;
}
