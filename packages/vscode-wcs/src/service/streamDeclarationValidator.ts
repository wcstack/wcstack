/**
 * streamDeclarationValidator.ts — `$stream` entries the runtime refuses when it takes the state in
 * (`wcs/stream-declaration`, error).
 *
 * From the counter-assist seam app (an LLM-answer console on `$stream`): a `fold` written without its `initial` made
 * the runtime raise `$stream entry "answer": fold needs an initial value.` when it took the state in — the state failed
 * to initialize, so every route of the console was dead — and the lint said nothing (it did not read `$stream`).
 *
 * Reported, as the runtime checks them (state's temporal/stream.ts `parseStreams`), the first that applies per entry:
 *   - no `source` key — `$stream entry "<name>" needs a source function.`
 *   - a `fold` key and no `initial` key — `$stream entry "<name>": fold needs an initial value.` (the runtime asks
 *     `"initial" in def`, so `initial: undefined` is an initial value)
 *
 * Only what is certain: an entry that is an object literal written in full (`analyzeStreamEntries` /
 * `literalKeyNames`) — not one that is a name or a call, not one with a spread or a computed key, not one a spread
 * written after it may replace. The states read are those the `$watch` checks read: not a volume's (`mount=` — the
 * runtime refuses its `$stream` outright, `wcs/volume-declaration`), not a `bind-component` one's (its script is not
 * loaded, `wcs/bind-component-source`). A state in a `src=` file is read in the second pass (core/externalState.ts).
 *
 * pure (DOM / vscode 非依存)。
 */

import { parseWcsStateElements } from '../language/htmlParse.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { analyzeStreamEntries } from './stateAnalyzer.js';

export function validateStreamDeclarations(html: string, stateTagName: string = 'wcs-state', locale?: string): WcsDiagnostic[] {
  if (!html.includes('$stream')) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const element of parseWcsStateElements(html, stateTagName)) {
    if (element.bindComponent || element.mountPath !== null) continue;
    for (const block of element.scriptBlocks) {
      if (!block.content.includes('$stream')) continue;
      for (const entry of analyzeStreamEntries(block.content)) {
        if (entry.keys === null) continue;
        const message = !entry.keys.includes('source')
          ? msgs.streamSourceMissing(entry.name)
          : entry.keys.includes('fold') && !entry.keys.includes('initial')
            ? msgs.streamFoldWithoutInitial(entry.name)
            : null;
        if (message === null) continue;
        out.push({
          code: WcsDiagnosticCode.StreamDeclaration,
          start: block.contentStart + entry.start,
          end: block.contentStart + entry.end,
          message,
          severity: 'error',
        });
      }
    }
  }
  return out;
}
