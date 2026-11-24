/**
 * dccDefinitions.ts — the Declarative Custom Components (`data-wc-definition`) a page uses: where they are defined, and
 * what each lets a page bind.
 *
 * A DCC is a part written in HTML alone: `<my-part data-wc-definition><template shadowrootmode="open"> … <wcs-state>
 * … </wcs-state></template></my-part>`. The markup in that template is bound by the definition's own `<wcs-state>`,
 * never by the page's, and `$bindables` / `$commands` of that state are the members a page may bind on an instance
 * (the runtime builds the tag's `static wcBindable` from them). Up to 4.28 the lint knew none of it (the garden-plots
 * seam app): a definition's keys and the page's were one set, a binding of a member the part does not have
 * (`<my-pager data-wcs="totl: n">`) was silent, and so was a definition the runtime refuses.
 *
 * A definition is read where the page says it is:
 *   - in the page itself;
 *   - in a file the import map names for `@wcstack/autoloader`'s `dcc` loader — an eager key whose file ends in
 *     `.html` or that names the loader (`"@components/my-pager": "./parts/my-pager.html"`,
 *     `"@components/my-badge|dcc": "./parts/badge.part"`), a namespace that names it (`"@components/ui|dcc/":
 *     "./parts/ui/"` and `<ui-note>` → `./parts/ui/note.html`).
 * A file the reader cannot read gives no contract, and the tag's bindings are not checked.
 *
 * pure (DOM / vscode 非依存): files come through the `FileReader`.
 */

import {
  asciiLowerCase, collectTemplateTags, createTemplateTester, findStartTagRegions, parseAttributeNames, parseWcsStateElements,
  type WcsStateInfo,
} from '../language/htmlParse.js';
import { literalKind, arrayElements } from './configDeclarationValidator.js';
import { blankComments } from './scriptCallArgs.js';
import { findTopLevelDeclaration } from './stateAnalyzer.js';
import { readStateScript, type FileReader } from './statePathResolver.js';
import type { PageElementContract } from './pageElements.js';

/** One `data-wc-definition` element with a declarative shadow root. Offsets are in the text it was found in. */
export interface DccDefinition {
  /** The tag it defines (lower case). */
  readonly tag: string;
  /** The `<` of the host's start tag. */
  readonly hostStart: number;
  /** After the host's end tag (the end of the text when it is not closed). */
  readonly hostEnd: number;
  /** Where the tag name is written in the host's start tag. */
  readonly nameStart: number;
  readonly nameEnd: number;
  /** The content of its `<template shadowrootmode>`: after the start tag, up to the end tag. */
  readonly contentStart: number;
  readonly contentEnd: number;
  /** That template with its tags: the `<` of its start tag, and after its end tag (the end of the text when not closed). */
  readonly templateStart: number;
  readonly templateEnd: number;
}

/**
 * The definitions written in `html`, outermost only (one inside another's template belongs to that one's content),
 * and not in a `<template>` of the page (such content is not in the document, and defines nothing).
 */
export function findDccDefinitions(html: string): DccDefinition[] {
  if (!html.includes('data-wc-definition')) return [];
  const regions = findStartTagRegions(html);
  const templates = collectTemplateTags(html);
  const inTemplate = createTemplateTester(html);
  const lower = asciiLowerCase(html);
  const out: DccDefinition[] = [];
  let skipUntil = 0;
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    const hostStart = region.start - region.tagName.length - 1;
    if (hostStart < skipUntil || !region.tagName.includes('-')) continue;
    if (!parseAttributeNames(html.slice(region.start, region.end)).has('data-wc-definition')) continue;
    if (inTemplate(hostStart)) continue;
    // the host's own end tag bounds the search for its template (a definition with no shadow root defines nothing)
    const closeAt = lower.indexOf(`</${region.tagName}`, region.end);
    const limit = closeAt === -1 ? html.length : closeAt;
    const template = regions.slice(i + 1).find((r) => r.tagName === 'template' && r.start < limit
      && parseAttributeNames(html.slice(r.start, r.end)).has('shadowrootmode'));
    if (template === undefined) continue;
    const templateAt = template.start - 'template'.length - 1;
    const gt = html.indexOf('>', template.end);
    const contentStart = gt === -1 ? html.length : gt + 1;
    // the matching end tag: nested templates (a `for:`, an `if:`) open and close in between
    let depth = 0;
    let contentEnd = html.length;
    for (const tag of templates) {
      if (tag.at <= templateAt) continue;
      if (!tag.close) depth++;
      else if (depth === 0) { contentEnd = tag.at; break; }
      else depth--;
    }
    const templateGt = contentEnd === html.length ? -1 : html.indexOf('>', contentEnd);
    const templateEnd = templateGt === -1 ? html.length : templateGt + 1;
    const hostClose = lower.indexOf(`</${region.tagName}`, contentEnd);
    const hostGt = hostClose === -1 ? -1 : html.indexOf('>', hostClose);
    const hostEnd = hostGt === -1 ? html.length : hostGt + 1;
    out.push({
      tag: region.tagName, hostStart, hostEnd, nameStart: hostStart + 1, nameEnd: region.start, contentStart, contentEnd,
      templateStart: templateAt, templateEnd,
    });
    skipUntil = hostEnd;
  }
  return out;
}

/** `text` with every character of the ranges turned into a space (line breaks kept): the same offsets. */
export function blankRanges(text: string, ranges: readonly (readonly [number, number])[]): string {
  let out = '';
  let at = 0;
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (to <= at) continue;
    const start = Math.max(from, at);
    out += text.slice(at, start) + text.slice(start, to).replace(/[^\r\n]/g, ' ');
    at = to;
  }
  return out + text.slice(at);
}

/** `text` with everything outside `[from, to)` turned into spaces (line breaks kept): one scope, the same offsets. */
export function keepOnly(text: string, from: number, to: number): string {
  return blankRanges(text, [[0, from], [to, text.length]]);
}

/** The `<wcs-state>` elements of a definition's content that are its own: not in a `<template>` of the content. */
export function definitionStates(content: string, stateTagName: string): WcsStateInfo[] {
  const inTemplate = createTemplateTester(content);
  return parseWcsStateElements(content, stateTagName).filter((element) => !inTemplate(element.tagStart));
}

/**
 * The names a script lists under `key` (`$bindables` / `$commands`), with where each is written in the script — `[]`
 * when it has no such key — or null when the list cannot be read: not a literal list, or an entry that is not a
 * string literal (a name, a spread, a call).
 */
export function listedNames(script: string, key: string): { readonly name: string; readonly start: number; readonly end: number }[] | null {
  const declaration = findTopLevelDeclaration(script, key);
  if (declaration === null) return [];
  if (declaration.kind !== 'data' || declaration.value === undefined || declaration.valueStart === undefined) return null;
  if (literalKind(declaration.value) !== 'array') return null;
  const out: { name: string; start: number; end: number }[] = [];
  for (const element of arrayElements(blankComments(declaration.value))) {
    if (literalKind(element.text) !== 'string') return null;
    const start = declaration.valueStart + element.start;
    out.push({ name: element.text.slice(1, -1), start, end: start + element.text.length });
  }
  return out;
}

/** The state script a definition's `<wcs-state>` loads: written in it, or the file its `src=` names. Null when neither is read. */
export function definitionScript(element: WcsStateInfo, fileReader: FileReader | undefined): string | null {
  if (element.stateAttr !== undefined || element.jsonAttr !== undefined) return null;
  if (element.srcAttr !== undefined) {
    if (fileReader === undefined || !/\.m?[jt]s$/.test(element.srcAttr)) return null;
    return readStateScript(element.srcAttr, fileReader) ?? null;
  }
  return element.scriptBlocks.length === 1 ? element.scriptBlocks[0].content : null;
}

/**
 * What a page may bind on an instance of the definition whose content this is: `$bindables` are its properties and
 * its inputs (two-way), `$commands` its commands. Null when it cannot be told — no state of its own (or two), a
 * `bind-component` one (refused), a state the validator cannot read, a list that is not literal.
 */
function contractOfContent(content: string, stateTagName: string, fileReader: FileReader | undefined): PageElementContract | null {
  const states = definitionStates(content, stateTagName);
  if (states.length !== 1 || states[0].bindComponent) return null;
  const script = definitionScript(states[0], fileReader);
  if (script === null) return null;
  const bindables = listedNames(script, '$bindables');
  const commands = listedNames(script, '$commands');
  if (bindables === null || commands === null) return null;
  return {
    properties: bindables.map((b) => b.name),
    inputs: Object.fromEntries(bindables.map((b) => [b.name, null])),
    commands: commands.map((c) => c.name),
  };
}

/**
 * The text a scope was cut from (core/validateDocument.ts checks the page and each definition as texts of their own,
 * with the rest blanked): the definitions are read from the whole of it.
 */
const sources = new Map<string, string>();

/** Says that `scope` is a part of `source` (the same offsets, the rest blanked). */
export function registerScopeSource(scope: string, source: string): void {
  if (sources.size > 64) sources.clear();
  sources.set(scope, source);
}

/** The whole text of a scope (the text itself when it is not a scope). */
export function scopeSource(text: string): string {
  return sources.get(text) ?? text;
}

/** The import map's `@components/` entries that name a DCC's file: the tag (or the namespace's prefix) and the path. */
interface DccEntry {
  /** The tag, or the prefix every tag of the namespace starts with (`ui-`). */
  readonly tag: string;
  readonly namespace: boolean;
  /** The file (an eager entry), or the directory (a namespace). */
  readonly path: string;
}

function dccEntries(imports: ReadonlyMap<string, string>): DccEntry[] {
  const out: DccEntry[] = [];
  for (const [key, value] of imports) {
    if (!key.startsWith('@components/') || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) continue;
    const body = key.slice('@components/'.length);
    const namespace = body.endsWith('/');
    const bare = namespace ? body.slice(0, -1) : body;
    const bar = bare.indexOf('|');
    const name = (bar === -1 ? bare : bare.slice(0, bar)).toLowerCase();
    const loader = bar === -1 ? null : bare.slice(bar + 1).split(',')[0].trim();
    if (name === '') continue;
    if (namespace) {
      if (loader === 'dcc') out.push({ tag: `${name.replace(/\//g, '-')}-`, namespace: true, path: value });
    } else if (loader === 'dcc' || (loader === null && /\.html$/i.test(value.replace(/[?#].*$/, '')))) {
      out.push({ tag: name, namespace: false, path: value });
    }
  }
  return out;
}

/** An import map's value as the page's reader takes it (`parts/x.html` is relative to the page, as `./parts/x.html`). */
export const pagePath = (src: string): string => (src.startsWith('./') || src.startsWith('../') || src.startsWith('/') ? src : `./${src}`);

/** The `imports` of the page's import maps (a later map's entry wins; a map that is not JSON is left out). */
export function importMapOf(html: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!/importmap/i.test(html)) return out;
  const text = html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
  const re = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!/\btype\s*=\s*(["']?)importmap\1(?=[\s>]|$)/i.test(m[1])) continue;
    try {
      const map = JSON.parse(m[2]) as { imports?: unknown };
      if (typeof map.imports !== 'object' || map.imports === null) continue;
      for (const [key, value] of Object.entries(map.imports as Record<string, unknown>)) if (typeof value === 'string') out.set(key, value);
    } catch {
      // (not JSON: the browser ignores the map too)
    }
  }
  return out;
}

/** Whether the page might use a DCC: a definition written in it, or an import map (a cheap gate before it is read). */
export function mayUseDcc(html: string): boolean {
  return /data-wc-definition|importmap/i.test(scopeSource(html));
}

/** The last document read (several validators ask for the same page's contracts in one run). */
let lastRead: { html: string; fileReader: FileReader | undefined; stateTagName: string; contracts: ReadonlyMap<string, PageElementContract> } | null = null;

/**
 * The contracts of the DCC tags a page uses, by tag: those defined in the page, and those in the files its import map
 * names (read for the tags the page writes). Only where the contract is certain.
 */
export function collectDccContracts(
  html: string,
  fileReader: FileReader | undefined,
  stateTagName: string = 'wcs-state',
): ReadonlyMap<string, PageElementContract> {
  if (lastRead !== null && lastRead.html === html && lastRead.fileReader === fileReader && lastRead.stateTagName === stateTagName) return lastRead.contracts;
  const source = scopeSource(html);
  const imports = importMapOf(source);
  const out = new Map<string, PageElementContract>();
  for (const definition of findDccDefinitions(source)) {
    if (out.has(definition.tag)) continue;
    const contract = contractOfContent(source.slice(definition.contentStart, definition.contentEnd), stateTagName, fileReader);
    if (contract !== null) out.set(definition.tag, contract);
  }
  if (fileReader !== undefined && imports.size > 0) {
    const entries = dccEntries(imports);
    if (entries.length > 0) {
      const tags = new Set<string>();
      for (const region of findStartTagRegions(source)) if (region.tagName.includes('-')) tags.add(region.tagName);
      for (const tag of tags) {
        if (out.has(tag) || tag.startsWith('wcs-')) continue;
        const entry = entries.find((e) => (e.namespace ? tag.startsWith(e.tag) && tag.length > e.tag.length : e.tag === tag));
        if (entry === undefined) continue;
        const file = entry.namespace ? `${entry.path}${tag.slice(entry.tag.length)}.html` : entry.path.replace(/[?#].*$/, '');
        const text = fileReader(pagePath(file));
        if (text === undefined) continue;
        const definition = findDccDefinitions(text).find((d) => d.tag === tag);
        if (definition === undefined) continue;
        // (a state the part's file names by `src=` is relative to the page that loads it, as the runtime reads it)
        const contract = contractOfContent(text.slice(definition.contentStart, definition.contentEnd), stateTagName, fileReader);
        if (contract !== null) out.set(tag, contract);
      }
    }
  }
  lastRead = { html, fileReader, stateTagName, contracts: out };
  return out;
}
