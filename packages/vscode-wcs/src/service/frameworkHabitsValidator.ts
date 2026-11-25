/**
 * frameworkHabitsValidator.ts — what a page written from another framework's habits (React / JSX, a server
 * template) is told.
 *
 * The street-reports seam app had a first-time author port a React app to wcstack. Each habit below ran without a word,
 * or the lint described it as something else (an expression reported as a missing path, a template literal not reported
 * at all). The author decided on 2026-11-25: what the runtime refuses or silently drops is an error, the rest a warning,
 * and only what is certain is said.
 *
 * - `wcs/binding-expression` (error): the right side of a binding (before the first `|`) is an expression, not a path —
 *   `hidden: !loading`, `textContent: count + 1`, `class.active: status === 'new'`, `` attr.href: `/r/${id}` ``,
 *   `{{ count + 1 }}`, `<!--@@: a ? b : c -->`. An expression is a right side with whitespace in it, or with one of
 *   `! ? = < > + ( ) ' " ` & ,` — none of which a path the runtime resolves can hold (`parser/parseStatePart.ts` takes
 *   the text as the path; the engine then looks it up as keys). On an event binding (`onclick: remove(.id)`,
 *   `onchange: () => toggle(.id)`) it says that a handler is a method name. Where it speaks, the path checks of the
 *   same text (`wcs/binding-path-missing`, `wcs/path-nonexistent`, …) are dropped (core/validateDocument.ts): one finding.
 *   Not said for `a || b` (the parser refuses the empty filter: `wcs/binding-syntax` already says it), for a path with
 *   `@` (`wcs/named-state-deprecated`), nor for `else:`.
 * - `wcs/attribute-mustache` (warning): `{{ }}` in the value of an attribute (`href="/r/{{ id }}"`). The runtime reads
 *   `{{ }}` in text only, so the attribute keeps the braces — unless a server template fills it before the page is
 *   served, which is why it is a warning. Only in a scope with a `<wcs-state>` (a file without one is someone else's
 *   template), and not where the page's state declares `$behavior: { enableMustache: false }` (it said its `{{ }}` are
 *   another template's). Once per attribute; never the bind attribute.
 * - `wcs/structural-element` (error): `if:` / `elseif:` / `else:` / `for:` alone in the `data-wcs` of an element that is
 *   not a `<template>`: the runtime sets a property of that name and nothing else. Beside another binding the
 *   existing `wcs/template-syntax` error speaks instead.
 * - `wcs/row-id-shared` (warning): a literal `id` on an element of a `for:` row, not bound on the element
 *   (`attr.id:` / `id:` / a spread): every row gets the same id. Once per (innermost loop, id). Only directly in the
 *   row: under an `if:` / `elseif:` / `else:` branch in the row the branch may be drawn for one row at a time
 *   (`if: .answering` in examples/homeroom), and a `<template shadowrootmode>` scopes its ids.
 * - `wcs/event-name-case` (warning): `onSubmit:` — an event binding whose first letter after `on` is upper case. The
 *   listener is added for an event named `Submit`.
 * - `wcs/key-binding` (warning): `key:` on a native element — React's key; the runtime sets a property named `key`.
 *   Not on a custom element, whose `key` may be an input (`<wcs-storage data-wcs="key: …">`).
 * - `wcs/inline-import` (error): a static `import … from "./x.js"` (or `../`, `/`) in an inline `<wcs-state>` or
 *   `<wcs-guard-handler>` script: it is evaluated from a `blob:` URL, against which the specifier does not resolve.
 *   Not for a full URL, a bare specifier (the import map may give it), nor a `src=` state.
 *
 * pure (DOM / vscode 非依存)。
 */

import type { AnyNode } from 'acorn';
import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { indexOfOutsideQuotes, splitOutsideQuotes } from '../core/parser/quoteAware.js';
import { createTemplateChain, findStartTagRegions, parseLoadedScriptBlocks, parseWcsScriptBlocks, parseWcsStateElements, type WcsScriptBlock } from '../language/htmlParse.js';
import { findAllBindAttributes, splitBindingExpressions } from './bindingValidator.js';
import { getEnclosingFors } from './forContext.js';
import { findAllCommentBindings, findAllMustacheSyntax } from './templateSyntax.js';
import { parseErasingTypes } from './typeErasure.js';
import { STRUCTURAL_BINDING_TYPE_SET } from './wcsManifest.js';
import { isMustacheDisabled } from './stateBehavior.js';
import type { FileReader } from './statePathResolver.js';

/** The characters no path can hold, and that every expression of another framework's habit has one of. */
const EXPRESSION_CHARACTER = /[\s!?=<>+()'"`&,]/;

/** A path as a filter hint may take it: a row path, a dotted path, a loop index (no expression character, no `|`). */
const PATH = /^(?:\.|\.?[^\s!?=<>+()'"`&,|.@][^\s!?=<>+()'"`&,|@]*)$/;
/** A literal a filter argument can be written as: a number, a quoted string, a bare word. */
const NUMBER = /^-?\d+(?:\.\d+)?$/;

/** A right side that is an expression: where it is in the binding (offsets into `text`), and the text. */
export interface ExpressionSite {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Whether a right side (before the first `|`, trimmed) is an expression rather than a path. */
export function isBindingExpression(path: string): boolean {
  if (path === '' || path.includes('@')) return false;
  return EXPRESSION_CHARACTER.test(path);
}

/**
 * The filter that writes an expression as a path and filters, or null (a getter is the way): `!x` → `x|not`,
 * `x > 0` → `x|gt(0)`, `x === 'new'` → `x|eq(new)`, `x + 1` → `x|add(1)`.
 */
export function filterHint(expression: string): string | null {
  const text = expression.trim();
  const not = /^!\s*(\S+)$/.exec(text);
  if (not !== null && PATH.test(not[1])) return `${not[1]}|not`;
  const binary = /^(\S+)\s*(===|!==|==|!=|>=|<=|>|<|\+|-|\*|\/|%)\s*(\S+)$/.exec(text);
  if (binary === null || !PATH.test(binary[1])) return null;
  const [, path, op, raw] = binary;
  const quoted = /^(['"])(.*)\1$/.exec(raw);
  const value = quoted !== null ? quoted[2] : raw;
  const isNumber = quoted === null && NUMBER.test(raw);
  // a bare word on the right is a path, not a literal (`a === b`): no filter compares two paths
  if (quoted === null && !isNumber && !['true', 'false', 'null'].includes(raw)) return null;
  // (a filter argument is cut at `,` and `)`, so such a literal has no plain spelling)
  if (/[,()|]/.test(value)) return null;
  const name = ({
    '===': 'eq', '==': 'eq', '!==': 'ne', '!=': 'ne',
    '>': 'gt', '>=': 'ge', '<': 'lt', '<=': 'le',
    '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'mod',
  } as Record<string, string>)[op];
  if (name !== 'eq' && name !== 'ne' && !isNumber) return null;
  return `${path}|${name}(${value})`;
}

/** The method an event handler expression calls (`remove(.id)` → remove, `() => this.toggle(x)` → toggle), or null. */
function calledMethod(expression: string): string | null {
  const arrow = expression.indexOf('=>');
  const body = arrow === -1 ? expression : expression.slice(arrow + 2);
  const call = /^\s*\{?\s*(?:this\s*\.\s*)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/.exec(body);
  return call === null ? null : call[1];
}

/** The property a binding's left side names (without input filters and modifiers). */
function propertyOf(left: string): string {
  return (splitOutsideQuotes(left, '|')[0] ?? '').replace(/#.*$/, '').trim();
}

/**
 * The right sides that are expressions: in the bind attributes, the `{{ }}` text and the comment bindings of `html`,
 * with the finding for each (the caller drops the path checks of the same text).
 */
export function validateBindingExpressions(
  html: string,
  bindAttribute: string = 'data-wcs',
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  if (html.includes(bindAttribute)) {
    for (const attr of findAllBindAttributes(html, bindAttribute)) {
      let pos = 0;
      for (const binding of splitBindingExpressions(attr.value)) {
        const bindingStart = attr.valueStart + pos;
        pos += binding.length + 1;
        const colon = indexOfOutsideQuotes(binding, ':');
        if (colon === -1) continue;
        const property = propertyOf(binding.slice(0, colon));
        if (property === 'else') continue;
        const site = expressionIn(binding, colon + 1);
        if (site === null) continue;
        const handler = property.startsWith('on');
        out.push({
          code: WcsDiagnosticCode.BindingExpression,
          start: bindingStart + site.start,
          end: bindingStart + site.end,
          message: handler
            ? msgs.handlerExpression(property, site.text, calledMethod(site.text))
            : msgs.bindingExpression(site.text, filterHint(site.text)),
          severity: 'error',
        });
      }
    }
  }
  // `{{ }}` and comments in a file without a `<wcs-state>` are someone else's template (Handlebars' `{{#each}}` /
  // `{{> card}}` in examples/community-hall): said only where a state binds them
  if ((html.includes('{{') || html.includes('@@')) && parseWcsStateElements(html, stateTagName).length > 0) {
    const texts = [...findAllMustacheSyntax(html).filter((m) => !m.inDocumentHead), ...findAllCommentBindings(html).filter((m) => !m.inDocumentHead)];
    for (const m of texts) {
      const site = expressionIn(m.expression, 0);
      if (site === null) continue;
      out.push({
        code: WcsDiagnosticCode.BindingExpression,
        start: m.exprStart + site.start,
        end: m.exprStart + site.end,
        message: msgs.bindingExpression(site.text, filterHint(site.text)),
        severity: 'error',
      });
    }
  }
  return out;
}

/** The right side of `text` from `from` up to its first `|` outside quotes, when it is an expression. */
function expressionIn(text: string, from: number): ExpressionSite | null {
  const rhs = text.slice(from);
  const segments = splitOutsideQuotes(rhs, '|');
  // `a || b`: the parser refuses the empty filter (`wcs/binding-syntax`) — said there
  if (segments.slice(1).some((s) => s.trim() === '')) return null;
  const raw = segments[0] ?? '';
  const path = raw.trim();
  if (!isBindingExpression(path)) return null;
  const start = from + raw.indexOf(path);
  return { start, end: start + path.length, text: path };
}

/** One attribute of a start tag as written (formInputValidator.ts reads them the same way). */
interface WrittenAttribute {
  readonly name: string;
  readonly value: string | null;
  readonly start: number;
  readonly end: number;
  /** Where the value starts (after the quote), when there is one. */
  readonly valueStart: number;
}

function writtenAttributes(html: string, from: number, to: number): WrittenAttribute[] {
  const out: WrittenAttribute[] = [];
  const attribute = /([^\s"'<>/=]+)(?:(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+)))?/g;
  const text = html.slice(from, to);
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(text)) !== null) {
    const value = match[3] ?? match[4] ?? match[5] ?? null;
    const quoted = match[3] !== undefined || match[4] !== undefined ? 1 : 0;
    out.push({
      name: match[1].toLowerCase(),
      value,
      start: from + match.index,
      end: from + match.index + match[0].length,
      valueStart: from + match.index + match[1].length + (match[2]?.length ?? 0) + quoted,
    });
  }
  return out;
}

/** `{{ }}` in an attribute other than the bind attribute, in a scope with a `<wcs-state>`. */
export function validateAttributeMustaches(
  html: string,
  bindAttribute: string = 'data-wcs',
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
): WcsDiagnostic[] {
  if (!html.includes('{{')) return [];
  if (parseWcsStateElements(html, stateTagName).length === 0) return [];
  // `$behavior: { enableMustache: false }`: the page says its `{{ }}` are a server template's or a CMS's
  if (isMustacheDisabled(html, stateTagName, fileReader)) return [];
  const msgs = getMessages(locale);
  const bind = bindAttribute.toLowerCase();
  const out: WcsDiagnostic[] = [];
  for (const tag of findStartTagRegions(html)) {
    if (!html.slice(tag.start, tag.end).includes('{{')) continue;
    for (const a of writtenAttributes(html, tag.start, tag.end)) {
      if (a.value === null || a.name === bind) continue;
      const open = a.value.indexOf('{{');
      if (open === -1) continue;
      const close = a.value.indexOf('}}', open + 2);
      if (close === -1) continue;
      out.push({
        code: WcsDiagnosticCode.AttributeMustache,
        start: a.valueStart + open,
        end: a.valueStart + close + 2,
        message: msgs.attributeMustache(a.name),
        severity: 'warning',
      });
    }
  }
  return out;
}

/**
 * The markup habits read from each bind attribute: a structural binding on an element that is not a `<template>`,
 * an event name in JSX's case, `key:`, and a literal id every row of a `for:` shares.
 */
export function validateMarkupHabits(
  html: string,
  bindAttribute: string = 'data-wcs',
  locale?: string,
): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  /** The elements whose id a binding gives: the start of their attribute region. */
  const boundId = new Set<number>();
  if (html.includes(bindAttribute)) {
    for (const attr of findAllBindAttributes(html, bindAttribute)) {
      const bindings = splitBindingExpressions(attr.value);
      const nonEmpty = bindings.filter((b) => b.trim() !== '').length;
      let pos = 0;
      for (const binding of bindings) {
        const bindingStart = attr.valueStart + pos;
        pos += binding.length + 1;
        if (binding.trim() === '') continue;
        const colon = indexOfOutsideQuotes(binding, ':');
        const rawLeft = colon === -1 ? binding : binding.slice(0, colon);
        const exact = rawLeft.trim();
        const leftStart = bindingStart + (rawLeft.length - rawLeft.trimStart().length);
        const property = propertyOf(rawLeft);
        if (property === 'id' || property === 'attr.id' || property === '.id' || property === '...') {
          if (attr.attrsStart !== undefined) boundId.add(attr.attrsStart);
        }
        // a structural binding is matched as written, before modifiers are split (`for#x` is a property — the parser's rule)
        if ((STRUCTURAL_BINDING_TYPE_SET as ReadonlySet<string>).has(exact) && nonEmpty === 1 && attr.tagName !== 'template') {
          out.push({
            code: WcsDiagnosticCode.StructuralElement,
            start: leftStart,
            end: leftStart + exact.length,
            message: msgs.structuralElement(exact, attr.tagName ?? ''),
            severity: 'error',
          });
          continue;
        }
        if (/^on[A-Z]/.test(property)) {
          out.push({
            code: WcsDiagnosticCode.EventNameCase,
            start: leftStart,
            end: leftStart + property.length,
            message: msgs.eventNameCase(property, `on${property.slice(2).toLowerCase()}`),
            severity: 'warning',
          });
        } else if (property === 'key' && attr.tagName !== undefined && !attr.tagName.includes('-')) {
          out.push({
            code: WcsDiagnosticCode.KeyBinding,
            start: leftStart,
            end: leftStart + property.length,
            message: msgs.keyBinding(),
            severity: 'warning',
          });
        }
      }
    }
  }
  out.push(...sharedRowIds(html, bindAttribute, boundId, msgs));
  return out;
}

/** A literal `id` inside a `for:` template that the element does not bind: once per (innermost loop, id). */
function sharedRowIds(html: string, bindAttribute: string, boundId: ReadonlySet<number>, msgs: WcsMessageCatalog): WcsDiagnostic[] {
  if (!/<template[^>]*for\s*:/i.test(html)) return [];
  const out: WcsDiagnostic[] = [];
  const said = new Set<string>();
  const chainAt = createTemplateChain(html);
  for (const tag of findStartTagRegions(html)) {
    if (boundId.has(tag.start)) continue;
    const id = writtenAttributes(html, tag.start, tag.end).find((a) => a.name === 'id');
    if (id === undefined || id.value === null || id.value.trim() === '') continue;
    const fors = getEnclosingFors(html, tag.start, bindAttribute);
    if (fors.length === 0) continue;
    const loop = fors[fors.length - 1];
    // Directly in the row only. Under another template in the row the id is not one per row for certain: a branch
    // (`if: .answering` may hold for one row at a time — the homeroom example), a shadow root (it scopes its ids), an
    // inert template
    const chain = chainAt(tag.start);
    if (chain[chain.length - 1] !== loop.anchor) continue;
    const key = `${loop.anchor}\u0000${id.value}`;
    if (said.has(key)) continue;
    said.add(key);
    out.push({
      code: WcsDiagnosticCode.RowIdShared,
      start: id.start,
      end: id.end,
      message: msgs.rowIdShared(id.value),
      severity: 'warning',
    });
  }
  return out;
}

/** The router's guard element (router's default `config.tagNames.guardHandler`). */
const GUARD_TAG = 'wcs-guard-handler';

/** A specifier a `blob:` URL cannot resolve: relative (`./`, `../`) or root-relative (`/`, not `//`). */
const RELATIVE_SPECIFIER = /^(?:\.{1,2}\/|\/(?!\/))/;

/** A static import of a relative or root-relative specifier in an inline state or guard script. */
export function validateInlineImports(html: string, stateTagName: string = 'wcs-state', locale?: string): WcsDiagnostic[] {
  if (!/\bimport\b|\bexport\b/.test(html)) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  const check = (blocks: readonly WcsScriptBlock[], guard: boolean): void => {
    for (const block of blocks) {
      // a state file the validator inlined (`src=`) is a module of its own, not a blob
      if (block.modulePath !== undefined) continue;
      for (const s of relativeImports(block.content)) {
        out.push({
          code: WcsDiagnosticCode.InlineImport,
          start: block.contentStart + s.start,
          end: block.contentStart + s.end,
          message: msgs.inlineImport(s.specifier, guard),
          severity: 'error',
        });
      }
    }
  };
  if (html.includes(GUARD_TAG)) check(parseWcsScriptBlocks(html, GUARD_TAG), true);
  check(parseLoadedScriptBlocks(html, stateTagName), false);
  return out;
}

/** The static imports and re-exports of a module whose specifier is relative or root-relative (the string's range). */
function relativeImports(source: string): { specifier: string; start: number; end: number }[] {
  if (!/\b(?:import|export)\b/.test(source)) return [];
  let program: AnyNode;
  try {
    program = parseErasingTypes(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) as AnyNode;
  } catch {
    return [];
  }
  const out: { specifier: string; start: number; end: number }[] = [];
  for (const node of (program as AnyNode & { body: AnyNode[] }).body) {
    if (node.type !== 'ImportDeclaration' && node.type !== 'ExportAllDeclaration' && node.type !== 'ExportNamedDeclaration') continue;
    const src = (node as { source?: AnyNode | null }).source;
    if (src === undefined || src === null || src.type !== 'Literal' || typeof src.value !== 'string') continue;
    if (!RELATIVE_SPECIFIER.test(src.value)) continue;
    out.push({ specifier: src.value, start: src.start, end: src.end });
  }
  return out;
}
