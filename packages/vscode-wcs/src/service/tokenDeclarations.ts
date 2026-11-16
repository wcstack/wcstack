/**
 * tokenDeclarations.ts — whether a state declares no command / event token at all.
 *
 * The token checks (`wcs/token-undeclared`) compared a name with the names `$commandTokens` / `$eventTokens` list, and
 * were silent when the list was empty — which is also what an absent key looks like. A state with no `$commandTokens`
 * and a `command.select: $command.select` binding fails to initialize (#1302), and the lint said nothing (the
 * stamp-rally seam app: the contacts README's Quick Start as it was written). "The state declares none" can be said
 * only where the state is read in full — the key is absent, or a literal list — so this answers three ways: the names,
 * or null when they cannot be known.
 *
 * pure (no DOM, no vscode).
 */

import { findScriptJsonById, type WcsStateInfo } from '../language/htmlParse.js';
import { arrayElements, literalKind } from './configDeclarationValidator.js';
import { blankComments } from './scriptCallArgs.js';
import { findTopLevelDeclaration, maskCommentsAndStrings } from './stateAnalyzer.js';
import { isReadableStateScript } from './statePathResolver.js';

/** The declarations that list a state's tokens. */
export type TokenKey = '$commandTokens' | '$eventTokens';

/**
 * The names a state script's `key` lists — `[]` when the state has no such key (or an empty list) — or null when they
 * cannot be known: the script is not read in full (no `export default { … }` literal, a top-level spread), the value
 * is not a literal list of strings (a name, a spread, a call), or the key is named somewhere the analyzer does not
 * read it as a declaration (a shorthand `{ $commandTokens }`, an assignment after the literal).
 */
export function scriptTokenNames(script: string, key: TokenKey): string[] | null {
  if (!isReadableStateScript(script)) return null;
  const declaration = findTopLevelDeclaration(script, key);
  if (declaration === null) return maskCommentsAndStrings(script).includes(key) ? null : [];
  if (declaration.kind !== 'data' || declaration.value === undefined || literalKind(declaration.value) !== 'array') return null;
  const names: string[] = [];
  for (const element of arrayElements(blankComments(declaration.value))) {
    if (literalKind(element.text) !== 'string') return null;
    names.push(element.text.slice(1, -1));
  }
  return names;
}

/** The names a JSON state lists under `key` (`[]` when it has no such key), or null when it is not an object or the value is not a list of strings. */
function jsonTokenNames(text: string, key: TokenKey): string[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const value = (data as Record<string, unknown>)[key];
  if (value === undefined) return [];
  return Array.isArray(value) && value.every((name) => typeof name === 'string') ? (value as string[]) : null;
}

/**
 * Whether no state of the document declares a `key` token: every `<wcs-state>` whose tree a binding can belong to —
 * the page's root and the ones inside a `<template>` (a declarative shadow root, a DCC) — was read in full and lists
 * none. Volumes do not count: the runtime ignores their token declarations (`wcs/volume-declaration`). False (not
 * known) when there is no such state, one is a mounted component's (`bind-component`: its tokens are its class's), one
 * waits for a file (`src=` — read on the second pass, core/externalState.ts) or for `setInitialState()`, or one's
 * list cannot be read.
 */
export function documentDeclaresNoTokens(html: string, elements: readonly WcsStateInfo[], key: TokenKey): boolean {
  const states = elements.filter((element) => element.mountPath === null);
  if (states.length === 0) return false;
  for (const element of states) {
    if (element.bindComponent || element.srcAttr !== undefined) return false;
    // the source the runtime reads: `state=` (a JSON script), then `json=`, then the scripts inside
    let names: string[] | null;
    if (element.stateAttr !== undefined) {
      const json = findScriptJsonById(html, element.stateAttr);
      names = json === null ? null : jsonTokenNames(json, key);
    } else if (element.jsonAttr !== undefined) {
      names = jsonTokenNames(element.jsonAttr, key);
    } else if (element.scriptBlocks.length === 0) {
      names = null;
    } else {
      names = [];
      for (const block of element.scriptBlocks) {
        const listed = scriptTokenNames(block.content, key);
        if (listed === null) return false;
        names.push(...listed);
      }
    }
    if (names === null || names.length > 0) return false;
  }
  return true;
}
