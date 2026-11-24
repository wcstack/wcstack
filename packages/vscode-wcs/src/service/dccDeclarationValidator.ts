/**
 * dccDeclarationValidator.ts — what a Declarative Custom Component declares, and how a page hands it its inputs.
 *
 * - `wcs/dcc-declaration` (error): a definition the runtime refuses when it defines the tag (@wcstack/state
 *   scopes/dcc.ts `define` — the same conditions): `$bindables` / `$commands` that is not a list, an entry that is not
 *   a non-empty string, one that starts with `$`, one written twice, one the state does not have, a method listed in
 *   `$bindables`, a value listed in `$commands`; and a `<wcs-state bind-component>` in a definition (one mechanism or
 *   the other). The refused definition defines nothing: every instance, on every page, stays an unknown element. The
 *   garden-plots seam app made six of these on purpose and the lint said nothing of any.
 * - `wcs/dcc-attribute` (warning): an instance that carries one of the part's `$bindables` as an attribute
 *   (`<my-pager total="120">`). A DCC's inputs are properties: the attribute is not read, and the part shows its
 *   default. The runtime warns with the same code since 4.28.
 *
 * Only what is certain is said: a list that is not a literal, a state that is not an `export default { … }` literal
 * (a class, a spread) and a state in a file the reader cannot read are left alone. A definition with two states of its
 * own is reported at the second: each defines the tag, and the second is refused (`<tag> is already defined`).
 *
 * pure (DOM / vscode 非依存).
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { findStartTagRegions } from '../language/htmlParse.js';
import { literalKind } from './configDeclarationValidator.js';
import {
  collectDccContracts, definitionScript, definitionStates, listedNames, mayUseDcc, type DccDefinition,
} from './dccDefinitions.js';
import { analyzeTopLevelStateKeys, findTopLevelDeclaration } from './stateAnalyzer.js';
import { isReadableStateScript, type FileReader } from './statePathResolver.js';
import { suggestion } from './suggestion.js';

const KEYS = ['$bindables', '$commands'] as const;

/** The declarations of one definition (`text` is the text the definition's offsets are in). */
export function validateDccDeclarations(
  text: string,
  definition: DccDefinition,
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  const content = text.slice(definition.contentStart, definition.contentEnd);
  const states = definitionStates(content, stateTagName);
  if (states.length === 0) return out;
  const state = states[0];
  if (state.bindComponent) {
    out.push({
      code: WcsDiagnosticCode.DccDeclaration,
      start: definition.contentStart + state.tagStart,
      end: definition.contentStart + state.tagEnd,
      message: msgs.dccBindComponent(definition.tag),
      severity: 'error',
    });
    return out;
  }
  if (states.length > 1) {
    const second = states[1];
    out.push({
      code: WcsDiagnosticCode.DccDeclaration,
      start: definition.contentStart + second.tagStart,
      end: definition.contentStart + second.tagEnd,
      message: msgs.dccSecondState(definition.tag),
      severity: 'error',
    });
    return out;
  }
  const script = definitionScript(state, fileReader);
  if (script === null) return out;
  // where a place in the script is in the text: in the page for a script written there, the `src` value for a file
  const inline = state.srcAttr === undefined && state.scriptBlocks.length === 1 ? state.scriptBlocks[0] : null;
  const at = (start: number, end: number): { start: number; end: number } => {
    if (inline !== null) return { start: definition.contentStart + inline.contentStart + start, end: definition.contentStart + inline.contentStart + end };
    const span = state.srcSpan;
    return span === undefined
      ? { start: definition.contentStart + state.tagStart, end: definition.contentStart + state.tagEnd }
      : { start: definition.contentStart + span.valueStart, end: definition.contentStart + span.valueEnd };
  };
  const say = (start: number, end: number, message: string): void => {
    out.push({ code: WcsDiagnosticCode.DccDeclaration, ...at(start, end), message, severity: 'error' });
  };

  // the members the state has, when it is read in full (`$stream` names count as members: the runtime says so)
  const members = isReadableStateScript(script) ? analyzeTopLevelStateKeys(script) : null;
  const known = members !== null && !members.materializes;
  const values = new Set(members?.keys ?? []);
  const methods = new Set(members?.methods ?? []);

  for (const key of KEYS) {
    const declaration = findTopLevelDeclaration(script, key);
    if (declaration === null) continue;
    if (declaration.kind !== 'data' || declaration.value === undefined || declaration.valueStart === undefined) continue;
    const kind = literalKind(declaration.value);
    if (kind === 'unknown' || kind === 'undefined') continue;
    if (kind !== 'array') {
      say(declaration.start, declaration.end, msgs.dccListNotArray(key));
      continue;
    }
    const listed = listedNames(script, key);
    if (listed === null) {
      // a literal list with an entry that is not a string literal: said only when the entry is another literal
      continue;
    }
    const seen = new Set<string>();
    for (const entry of listed) {
      if (entry.name === '') {
        say(entry.start, entry.end, msgs.dccEntryEmpty(key));
        continue;
      }
      if (entry.name.startsWith('$')) {
        say(entry.start, entry.end, msgs.dccEntryInternal(key, entry.name));
        continue;
      }
      if (seen.has(entry.name)) {
        say(entry.start, entry.end, msgs.dccEntryDuplicated(key, entry.name));
        continue;
      }
      seen.add(entry.name);
      if (!known) continue;
      const isValue = values.has(entry.name);
      const isMethod = methods.has(entry.name);
      if (!isValue && !isMethod) {
        const candidates = key === '$bindables' ? [...values] : [...methods];
        say(entry.start, entry.end, msgs.dccEntryMissing(key, entry.name) + suggestion(entry.name, candidates, msgs));
      } else if (key === '$bindables' && isMethod && !isValue) {
        say(entry.start, entry.end, msgs.dccBindableIsMethod(entry.name));
      } else if (key === '$commands' && isValue && !isMethod) {
        say(entry.start, entry.end, msgs.dccCommandIsValue(entry.name));
      }
    }
  }
  return out;
}

/**
 * Instances that carry one of their part's `$bindables` as an attribute: once per tag and name, at the first such
 * attribute. An attribute bound with `attr.<name>:` is not written in the markup and is not read here.
 */
export function validateDccAttributes(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
): WcsDiagnostic[] {
  if (!mayUseDcc(html)) return [];
  const contracts = collectDccContracts(html, fileReader, stateTagName);
  if (contracts.size === 0) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  const said = new Set<string>();
  for (const region of findStartTagRegions(html)) {
    const contract = contracts.get(region.tagName);
    if (contract === undefined || contract.properties.length === 0) continue;
    const attrs = html.slice(region.start, region.end);
    if (/(?:^|\s)data-wc-definition(?=[\s=]|$)/i.test(attrs)) continue;
    const attribute = /([^\s"'<>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`=]+))?/g;
    let match: RegExpExecArray | null;
    while ((match = attribute.exec(attrs)) !== null) {
      const name = match[1].toLowerCase();
      const member = contract.properties.find((p) => p.toLowerCase() === name);
      if (member === undefined) continue;
      const key = `${region.tagName}\u0000${member}`;
      if (said.has(key)) continue;
      said.add(key);
      out.push({
        code: WcsDiagnosticCode.DccAttribute,
        start: region.start + match.index,
        end: region.start + match.index + match[0].length,
        message: msgs.dccAttribute(region.tagName, member),
        severity: 'warning',
      });
    }
  }
  return out;
}
