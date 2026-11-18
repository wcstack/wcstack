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
 *
 * - DriftStateKey (`wcs/drift-state-key`, warning; since 4.26): the stateSchema applied to the page and the page's root
 *   state script disagree on the top-level keys — a key the script declares (data or a one-segment accessor) that the
 *   schema lacks, or a schema property the script does not declare. A stateSchema is derived from the script
 *   (`wcs-schema emit`); with a stale one the schema wins: a key renamed in the script but not in the markup passed
 *   (the schema still had the old name), and a key the schema lacks became `wcs/path-nonexistent` (the lending-desk
 *   seam app — `wcs-schema check` alone noticed). Said once, at the `<wcs-state>` start tag, naming the keys. Read
 *   only where both sides are known: the root state's script read in full (inline or `src=`; no spread, no computed
 *   key, no `$stream` / `$scan`, which make keys), the schema's top-level `properties`, and not a property that is a
 *   volume's mount root (`mount="cart"` grafts `cart`).
 */

import { createTemplateTester, findIgnoredRanges, parseWcsStateElements } from '../language/htmlParse.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../core/diagnostics.js';
import type { JsonSchemaNode } from '../core/sidecar/types.js';
import { readStateScriptFile, type FileReader } from './statePathResolver.js';
import { analyzeTopLevelStateKeys } from './stateAnalyzer.js';
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

export function validateStateSchemaDrift(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
  applicationSchema?: JsonSchemaNode,
): WcsDiagnostic[] {
  if (applicationSchema === undefined) return [];
  const schemaKeys = schemaTopLevelKeys(applicationSchema);
  if (schemaKeys === null) return [];
  const elements = parseWcsStateElements(html, stateTagName);
  const insideTemplate = createTemplateTester(html);
  const roots = elements.filter((e) => e.mountPath === null && !e.bindComponent && !insideTemplate(e.tagStart));
  if (roots.length !== 1) return [];
  const root = roots[0];
  // the source the runtime reads (state → src → json → the inline script): only a script is compared
  let script: string | undefined;
  if (root.stateAttr !== undefined) return [];
  if (root.srcAttr !== undefined) {
    if (root.srcAttr.endsWith('.json') || fileReader === undefined) return [];
    script = readStateScriptFile(root.srcAttr, fileReader)?.text;
  } else if (root.jsonAttr === undefined && root.scriptBlocks.length === 1) {
    script = root.scriptBlocks[0].content;
  }
  if (script === undefined) return [];
  const declared = analyzeTopLevelStateKeys(script);
  if (declared === null || declared.materializes) return [];
  // a volume grafts its state at its mount path: the schema (one tree) has that key, the root's script does not
  const mountRoots = new Set(elements.flatMap((e) => (e.mountPath === null || e.mountPath === '' ? [] : [e.mountPath.split('.')[0]])));
  const inScriptOnly = declared.keys.filter((key) => !schemaKeys.has(key));
  const inSchemaOnly = [...schemaKeys].filter((key) => !declared.keys.includes(key) && !mountRoots.has(key));
  if (inScriptOnly.length === 0 && inSchemaOnly.length === 0) return [];
  return [{
    code: WcsDiagnosticCode.DriftStateKey,
    start: root.tagStart,
    end: root.tagStart + 1 + stateTagName.length,
    message: getMessages(locale).stateSchemaDrift(inScriptOnly, inSchemaOnly),
    severity: 'warning',
  }];
}

/**
 * The top-level property names of a stateSchema (through a root `$ref` / `anyOf`), no `$` key. null when it declares
 * none (an open `{}`: nothing to compare).
 */
function schemaTopLevelKeys(schema: JsonSchemaNode): Set<string> | null {
  const defs = schema.$defs ?? {};
  const keys = new Set<string>();
  let found = false;
  const visit = (node: JsonSchemaNode | undefined, depth: number): void => {
    if (node === undefined || node === null || typeof node !== 'object' || depth > 8) return;
    if (typeof node.$ref === 'string') {
      const m = /^#\/\$defs\/(.+)$/.exec(node.$ref);
      if (m !== null) visit(defs[m[1].replace(/~1/g, '/').replace(/~0/g, '~')], depth + 1);
      return;
    }
    if (Array.isArray(node.anyOf)) for (const branch of node.anyOf) visit(branch, depth + 1);
    if (node.properties !== undefined && typeof node.properties === 'object') {
      found = true;
      for (const key of Object.keys(node.properties)) if (!key.startsWith('$')) keys.add(key);
    }
  };
  visit(schema, 0);
  return found ? keys : null;
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
