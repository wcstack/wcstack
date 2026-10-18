/**
 * scriptStateUseValidator.ts
 *
 * What a state's script uses of itself that the runtime does not report. A 7GUIs evaluation of @wcstack/state
 * 4.2.0 found each of these silent, or a generic TypeError (docs/mistake-catalogue.md):
 *
 * - `wcs/token-undeclared` (error): `this.$command.<name>` whose name `$commandTokens` does not declare. `$command`
 *   holds the declared tokens only, so `.emit()` on it throws a TypeError that names nothing.
 * - `wcs/command-token-unbound` (warning): a declared token that is emitted — `.emit()` in the script, or
 *   `on*: $command.<name>` in the markup — while no `command.<method>: $command.<name>` binding in the document
 *   receives it. The emit reaches nothing, without a word.
 * - `wcs/write-path-missing` (warning): `this.<key> = …` where the state declares no `<key>` but a near one
 *   (`this.selectedID` beside `selectedId`). The write creates a new key, and the declared key's bindings stay as
 *   they were. Only with a near name: a key the state adds on purpose is not a mistake.
 *
 * Each needs the state to be readable (an `export default { … }` literal); the command checks need its
 * `$commandTokens` to be a literal list. A volume's `$commandTokens` are ignored by the runtime
 * (`wcs/volume-declaration`), so the command checks read the page's root states only.
 */

import { parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../core/diagnostics.js';
import { buildReferenceIndex } from '../core/index/referenceIndex.js';
import { analyzeStatePaths, maskCommentsAndStrings } from './stateAnalyzer.js';
import { isReadableStateScript } from './statePathResolver.js';
import { suggestion } from './suggestion.js';

/** `.$command.<name>` (on `this`, or on the state a handler receives). */
const COMMAND_USE = /\.\s*\$command\s*\.\s*([A-Za-z_$][\w$]*)/dg;
/** What follows a token that is emitted. */
const EMIT_AFTER = /^\s*\.\s*emit\s*\(/;
/** `this.<key> = …` (and the compound assignments, `++` / `--` after it). */
const THIS_WRITE = /\bthis\s*\.\s*([A-Za-z_][\w$]*)\s*(?:=(?![=>])|[-+*/%&|^]=|\*\*=|<<=|>>>?=|&&=|\|\|=|\?\?=|\+\+|--)/dg;
/** `++this.<key>` / `--this.<key>`. */
const PRE_THIS_WRITE = /(?:\+\+|--)\s*this\s*\.\s*([A-Za-z_][\w$]*)/dg;

export function validateScriptStateUses(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
  bindAttrName: string = 'data-wcs',
): WcsDiagnostic[] {
  const blocks = parseLoadedScriptBlocks(html, stateTagName).filter((block) => isReadableStateScript(block.content));
  if (blocks.length === 0) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];

  // the document's command bindings: the tokens a `command.<method>:` receives, and the `on*:` that emit one
  let receivers: Set<string> | null = null;
  let markupEmits: Map<string, { start: number; end: number }> | null = null;
  const bindings = (): void => {
    if (receivers !== null) return;
    receivers = new Set();
    markupEmits = new Map();
    for (const o of buildReferenceIndex(html, { bindAttribute: bindAttrName, stateTagName }).occurrences) {
      if (!o.path.startsWith('$command.')) continue;
      const name = o.path.slice('$command.'.length);
      const prop = o.propName ?? '';
      if (prop.startsWith('command.')) receivers.add(name);
      else if (prop.startsWith('on') && !markupEmits.has(name)) markupEmits.set(name, o.pathRange);
    }
  };

  for (const block of blocks) {
    const paths = analyzeStatePaths(block.content);
    const masked = maskCommentsAndStrings(block.content);

    // --- the command tokens (the root's)
    const declared = paths.filter((p) => p.kind === 'command').map((p) => p.path.slice('$command.'.length));
    if (block.mountPath === null && declared.length > 0) {
      const emitted = new Map<string, { start: number; end: number }>();
      COMMAND_USE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = COMMAND_USE.exec(masked)) !== null) {
        const name = match[1];
        const [start, end] = match.indices![1];
        if (!declared.includes(name)) {
          out.push({
            code: WcsDiagnosticCode.TokenUndeclared,
            start: block.contentStart + start,
            end: block.contentStart + end,
            // `$command` holds the declared tokens only: `.emit()` on what it lacks is a TypeError
            message: msgs.commandTokenUndeclared(`$command.${name}`) + suggestion(name, declared, msgs),
            severity: 'error',
          });
        } else if (!emitted.has(name) && EMIT_AFTER.test(masked.slice(match.index + match[0].length))) {
          emitted.set(name, { start: block.contentStart + start, end: block.contentStart + end });
        }
      }
      bindings();
      for (const name of declared) {
        if (receivers!.has(name)) continue;
        const at = emitted.get(name) ?? markupEmits!.get(name);
        if (at === undefined) continue;
        out.push({
          code: WcsDiagnosticCode.CommandTokenUnbound,
          start: at.start,
          end: at.end,
          message: msgs.commandTokenUnbound(`$command.${name}`),
          severity: 'warning',
        });
      }
    }

    // --- writes of a key the state does not declare (a likely typo of one it does)
    const keys = [...new Set(paths.map((p) => p.path.split('.')[0]).filter((key) => key !== '' && !key.startsWith('$')))];
    const reported = new Set<string>();
    for (const pattern of [THIS_WRITE, PRE_THIS_WRITE]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(masked)) !== null) {
        const key = match[1];
        if (keys.includes(key) || reported.has(key)) continue;
        const near = suggestion(key, keys, msgs);
        if (near === '') continue;
        reported.add(key);
        const [start, end] = match.indices![1];
        out.push({
          code: WcsDiagnosticCode.WritePathMissing,
          start: block.contentStart + start,
          end: block.contentStart + end,
          message: msgs.writePathMissing(key) + near,
          severity: 'warning',
        });
      }
    }
  }
  return out;
}
