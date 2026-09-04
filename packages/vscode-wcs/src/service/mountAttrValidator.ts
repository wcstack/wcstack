/**
 * mountAttrValidator.ts — `<wcs-state mount="path">` の値検証（v2）。
 *
 * runtime（state/src/webComponent/volume.ts の validateVolumeMountPath）が raise する
 * 値を **同条件・同文言**で編集時 error にする。name= の fail-fast 鏡映
 * （namedStateValidator）と対称 — mount= だけ無診断だと、runtime で初めて落ちる。
 *
 * runtime の条件（v2）:
 *   - 空文字列は不可
 *   - 空セグメント（`a..b`）は不可
 *   - ワイルドカード `*` セグメントは不可（静的パスのみ）
 *   - 予約文字 `$` / `#` / `@` は位置を問わず不可
 *
 * pure（DOM / vscode 非依存）。
 */

import { WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages, type MountPathProblem } from '../core/messages.js';
import { parseWcsStateElements } from '../language/htmlParse.js';
import type { BindingDiagnostic } from './bindingValidator.js';

/** runtime の validateVolumeMountPath と同じ判定（raise の種類を返す。妥当なら null）。 */
export function findMountPathProblem(mountPath: string): MountPathProblem | null {
  if (mountPath.length === 0) return 'empty';
  for (const segment of mountPath.split('.')) {
    if (segment.length === 0) return 'emptySegment';
    if (segment === '*') return 'wildcard';
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
