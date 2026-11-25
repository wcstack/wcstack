/**
 * collectionMutationValidator.ts — `wcs/collection-mutation`: a `Set` or a `Map` of the state changed in place.
 *
 * The street-reports seam app (a React app ported to wcstack) kept the selection in `selected: new Set()` and wrote
 * `this.selected.add(id)`. The state's reactivity runs on property assignment, so the change is not seen: nothing bound
 * to the key, nor a getter that reads it, is updated, and nothing says so. Where `wcs/array-mutation` looks (the
 * state's methods, setters, `$watch` / `$on` handlers — every loaded script of a `<wcs-state>`), a call of a mutating
 * method on a top-level key whose initial value in the state literal is `new Set(…)` (`add` / `delete` / `clear`) or
 * `new Map(…)` (`set` / `delete` / `clear`) is an error.
 *
 * Only the certain cases: the call is on `this.<key>` itself (not a copy), the key is a data key of the literal, and
 * the method body does not assign the key again (`this.selected.add(id); this.selected = new Set(this.selected)` works).
 *
 * pure (DOM / vscode 非依存)。
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { analyzeCallableBodies, findTopLevelDeclaration, maskCommentsAndStrings } from './stateAnalyzer.js';
import { ID, execAllMasked, isApiRoot } from './scriptPatterns.js';

const METHODS: Readonly<Record<'Set' | 'Map', ReadonlySet<string>>> = {
  Set: new Set(['add', 'delete', 'clear']),
  Map: new Set(['set', 'delete', 'clear']),
};

/** `this.<key>.<method>(` — the key a single segment, the method name ending the range. */
const CALL = String.raw`\bthis\s*\??\.\s*(${ID})\s*\??\.\s*(add|set|delete|clear)(?=\s*\()`;

export function validateCollectionMutations(html: string, stateTagName: string = 'wcs-state', locale?: string): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const block of parseLoadedScriptBlocks(html, stateTagName)) {
    const script = block.content;
    if (!/new\s+(?:Set|Map)\b/.test(script)) continue;
    const kinds = new Map<string, 'Set' | 'Map' | null>();
    const kindOf = (key: string): 'Set' | 'Map' | null => {
      if (!kinds.has(key)) {
        const declaration = findTopLevelDeclaration(script, key);
        const seed = declaration?.kind === 'data' ? /^new\s+(Set|Map)\s*\(/.exec(declaration.value ?? '') : null;
        kinds.set(key, seed === null ? null : (seed[1] as 'Set' | 'Map'));
      }
      return kinds.get(key)!;
    };
    let bodies: ReturnType<typeof analyzeCallableBodies> | null = null;
    for (const match of execAllMasked(CALL, script)) {
      const [key, method] = match.groups;
      if (key === undefined || method === undefined || isApiRoot(key)) continue;
      const kind = kindOf(key);
      if (kind === null || !METHODS[kind].has(method)) continue;
      // the body the call is in: assigning the key there again tells the state
      bodies ??= analyzeCallableBodies(script);
      const body = bodies.find((b) => match.index >= b.bodyStart && match.index < b.bodyStart + b.body.length);
      const scope = body === undefined ? script : body.body;
      if (new RegExp(String.raw`\bthis\s*\??\.\s*${key}\s*=(?!=)`).test(maskCommentsAndStrings(scope))) continue;
      const start = block.contentStart + match.index;
      out.push({
        code: WcsDiagnosticCode.CollectionMutation,
        start,
        end: start + match.length,
        message: msgs.collectionMutation(key, method, kind),
        severity: 'error',
        statePath: key,
      });
    }
  }
  return out;
}
