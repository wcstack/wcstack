/**
 * namedStateValidator.ts — 名前付き State（`<wcs-state name>` / `path@name`）の deprecation。
 *
 * v2 では名前の次元そのものが消え、`<wcs-state mount="path">` と接頭辞付きパスに
 * 置き換わる（docs/state-mount-design.md D1 / D16、impl-plan P1-7）。1.x には `mount=` が
 * 無いのでランタイムは既定で黙り（`config.debug` 下だけ warn）、この lint（warning）と
 * README の告知が主経路。
 *
 * 対象:
 *   - `<wcs-state name="x">` の name 属性（Light DOM の `bind-component` は今日 name が
 *     必須なので除く — v2 でまとめて消える）
 *   - `data-wcs` の各式の `path@name`（フィルタより前・括弧の外だけを見る）
 *   - mustache `{{ path@name }}`
 *
 * severity は warning（1.x では動く。error 昇格は v2 の parse error と同時）。
 */

import { WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { parseWcsStateElements } from '../language/htmlParse.js';
import { findAllBindAttributes, splitBindingExpressions, type BindingDiagnostic } from './bindingValidator.js';
import { findAllMustacheSyntax } from './templateSyntax.js';

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
    if (/\sbind-component(?=[\s=>/])/i.test(tagText)) continue;
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
      severity: 'warning',
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
          severity: 'warning',
        });
      }
      pos += expr.length + 1;
    }
  }

  // 3. mustache
  for (const mustache of findAllMustacheSyntax(html)) {
    const selector = findStateSelector(mustache.expression, true);
    if (selector !== null) {
      diagnostics.push({
        code: WcsDiagnosticCode.NamedStateDeprecated,
        start: mustache.exprStart + selector.start,
        end: mustache.exprStart + selector.end,
        message: msgs.namedStatePathDeprecated(selector.name),
        severity: 'warning',
      });
    }
  }

  return diagnostics;
}
