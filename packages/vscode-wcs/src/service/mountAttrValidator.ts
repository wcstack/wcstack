/**
 * mountAttrValidator.ts — `<wcs-state mount="path">` の値検証。
 *
 * runtime（state の src/scopes/volume.ts の `validPath`）が拒む値を、同じ条件で編集時 error にする。
 * runtime はボリュームを接ぎ木せず、`<wcs-state mount="…"> has an invalid mount path: it must be a
 * static path (no "*", "$", "#", "@").` を console.error に出す（形によらず同じ文面）。lint の文面は
 * 形ごとに理由を言う。name= の検査（namedStateValidator）と対称 — mount= だけ無診断だと、runtime で初めて落ちる。
 *
 * runtime の条件（4.0 — 段ごとに `/[*$#@\s]/` を拒む）:
 *   - 空文字列は不可
 *   - 空の段（`a..b`）は不可
 *   - `*` は段の中のどこにあっても不可（静的パスのみ）
 *   - 空白は不可
 *   - 予約文字 `$` / `#` / `@` は位置を問わず不可
 *
 * pure（DOM / vscode 非依存）。
 */

import { WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages, type MountPathProblem } from '../core/messages.js';
import { parseWcsStateElements } from '../language/htmlParse.js';
import type { BindingDiagnostic } from './bindingValidator.js';

/** runtime の `validPath` と同じ判定（拒む形の種類を返す。妥当なら null）。 */
export function findMountPathProblem(mountPath: string): MountPathProblem | null {
  if (mountPath.length === 0) return 'empty';
  for (const segment of mountPath.split('.')) {
    if (segment.length === 0) return 'emptySegment';
    if (segment.includes('*')) return 'wildcard';
    if (/\s/.test(segment)) return 'whitespace';
    if (segment.includes('$') || segment.includes('#') || segment.includes('@')) return 'reserved';
  }
  return null;
}

export function validateMountAttributes(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
): BindingDiagnostic[] {
  const msgs = getMessages(locale);
  const diagnostics: BindingDiagnostic[] = [];

  for (const element of parseWcsStateElements(html, stateTagName)) {
    if (element.mountPath === null) continue;
    const problem = findMountPathProblem(element.mountPath);
    if (problem === null) continue;
    // 値の位置: namedStateValidator の name= と同じ切り出し
    const tagText = html.slice(element.tagStart, element.tagEnd);
    const match = /(?:^|\s)mount\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tagText);
    if (match === null) continue;
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    const quoted = match[1] !== undefined || match[2] !== undefined;
    const valueEnd = element.tagStart + match.index + match[0].length - (quoted ? 1 : 0);
    // 空値（mount=""）はゼロ幅にならないよう属性全体を範囲にする
    const attrStart = element.tagStart + match.index + (/^\s/.test(match[0]) ? 1 : 0);
    diagnostics.push({
      code: WcsDiagnosticCode.MountPathInvalid,
      start: value.length === 0 ? attrStart : valueEnd - value.length,
      end: valueEnd + (quoted && value.length === 0 ? 1 : 0),
      message: msgs.mountPathInvalid(problem, element.mountPath),
      severity: 'error',
    });
  }

  return diagnostics;
}
