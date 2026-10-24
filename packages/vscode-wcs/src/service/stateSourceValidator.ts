/**
 * stateSourceValidator.ts — a `<wcs-state src>` the lint cannot read (`wcs/state-src-unread`, info).
 *
 * The validators read a state's file for its paths and run the script rules on it (core/externalState.ts). A file
 * they could not read left the state unreadable: none of its bindings was checked, and the page passed with no
 * finding and no word — a path from `/` (the form docs/csp.md §4 gives under a `<base>`), a URL, a file that is not
 * there (the prod-booking seam app, docs/seam-apps.md). That is the lint's limit, not the author's mistake: said
 * once, at the attribute, as `wcs/path-dynamic-unknown` says it at a spread.
 *
 * Left out: a `bind-component` element (its sources are refused — `wcs/bind-component-source`), one with `state=`
 * (the runtime reads that one instead), and a page validated without a file reader (nothing can be read there).
 * A file is readable when the reader returns it: `.json` as is, `.js` / `.ts` as `readStateScriptFile` reads them.
 */

import { parseWcsStateElements } from '../language/htmlParse.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../core/diagnostics.js';
import { readStateScriptFile, type FileReader } from './statePathResolver.js';

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
