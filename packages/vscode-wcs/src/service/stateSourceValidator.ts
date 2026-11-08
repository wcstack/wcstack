/**
 * stateSourceValidator.ts — the states whose paths the lint cannot check, said once where they would be:
 *
 * - StateSrcUnread (`wcs/state-src-unread`, info): a `<wcs-state src>` the lint cannot read. The validators read a
 *   state's file for its paths and run the script rules on it (core/externalState.ts). A file they could not read left
 *   the state unreadable: none of its bindings was checked, and the page passed with no finding and no word — a path
 *   from `/` (the form docs/csp.md §4 gives under a `<base>`), a URL, a file that is not there (the prod-booking seam
 *   app, docs/seam-apps.md). That is the lint's limit, not the author's mistake: said once, at the attribute, as
 *   `wcs/path-dynamic-unknown` says it at a spread.
 *
 *   Left out: a `bind-component` element (its sources are refused — `wcs/bind-component-source`), one with `state=`
 *   (the runtime reads that one instead), and a page validated without a file reader (nothing can be read there).
 *   A file is readable when the reader returns it: `.json` as is, `.js` / `.ts` as `readStateScriptFile` reads them.
 *
 * - StateAbsent (`wcs/state-absent`, info): a file with bindings — a `data-wcs` attribute or a comment binding — and no
 *   `<wcs-state>` at all: a CMS's partial template, a route's content in a file of its own, a page whose state a script
 *   makes. No path of it is checked (there are no candidates), and the file printed nothing and was not listed under
 *   `nothing to check:` either — it looked checked, and `booking.totl` passed (the community-hall seam app). Said once,
 *   at the first binding (outside `data-wcs-ignore`). Not said with a `stateSchema` (the paths are checked against it),
 *   nor for a file whose only text bindings are `{{ }}` — braces alone may be another template engine's.
 */

import { findIgnoredRanges, parseWcsStateElements } from '../language/htmlParse.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../core/diagnostics.js';
import type { JsonSchemaNode } from '../core/sidecar/types.js';
import { readStateScriptFile, type FileReader } from './statePathResolver.js';
import { findAllBindAttributes } from './bindingValidator.js';
import { findAllCommentBindings } from './templateSyntax.js';

export function validateStateSources(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
): WcsDiagnostic[] {
  if (fileReader === undefined) return [];
  const out: WcsDiagnostic[] = [];
  for (const element of parseWcsStateElements(html, stateTagName)) {
    const src = element.srcAttr;
    const span = element.srcSpan;
    if (src === undefined || span === undefined || element.stateAttr !== undefined || element.bindComponent) continue;
    const readable = src.endsWith('.json') ? Boolean(fileReader(src)) : readStateScriptFile(src, fileReader) !== undefined;
    if (readable) continue;
    out.push({
      code: WcsDiagnosticCode.StateSrcUnread,
      start: span.start,
      end: span.end,
      message: getMessages(locale).stateSrcUnread(src),
      severity: 'info',
    });
  }
  return out;
}

export function validateStateAbsent(
  html: string,
  bindAttribute: string = 'data-wcs',
  stateTagName: string = 'wcs-state',
  locale?: string,
  applicationSchema?: JsonSchemaNode,
): WcsDiagnostic[] {
  if (applicationSchema !== undefined) return [];
  // キー入力ごとに走るので、束縛の書き方が文書のどこにも無ければ走査しない
  if (!html.includes(bindAttribute) && !html.includes('@@')) return [];
  if (parseWcsStateElements(html, stateTagName).length > 0) return [];
  const ignored = findIgnoredRanges(html, bindAttribute);
  const bindings = [
    ...findAllBindAttributes(html, bindAttribute)
      .filter((attr) => attr.value.trim() !== '')
      .map((attr) => ({ start: attr.valueStart, end: attr.valueStart + attr.value.length })),
    ...findAllCommentBindings(html).map((m) => ({ start: m.exprStart, end: m.exprEnd })),
  ].filter((b) => !ignored.some(([start, end]) => b.start >= start && b.start < end));
  if (bindings.length === 0) return [];
  const first = bindings.reduce((a, b) => (b.start < a.start ? b : a));
  return [{
    code: WcsDiagnosticCode.StateAbsent,
    start: first.start,
    end: first.end,
    message: getMessages(locale).stateAbsent(stateTagName),
    severity: 'info',
  }];
}
