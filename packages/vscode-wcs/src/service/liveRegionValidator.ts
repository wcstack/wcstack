/**
 * liveRegionValidator.ts — a live region inserted together with its text (`wcs/live-region-inserted`, warning).
 *
 * A screen reader announces a live region — `aria-live` (not `off`), `role="status"`, `role="alert"`, `role="log"` —
 * when its text changes while it is in the page. One inside a `<template data-wcs="if: …">` (`elseif:`, `else:`), a
 * `for:` row or a `<wcs-route>`'s content is inserted when the branch, row or route appears; if its text is there at
 * that moment, nothing announces it. The city-library seam app made it on purpose (a login error `role="alert"` in
 * `<template data-wcs="if: loginErrorMessage">`, a route's status) and measured no announcement in Chromium; nothing in
 * the console, the lint or axe said so. Keep the region outside, always in the page, and write its text.
 *
 * Reported when the lint can tell the region arrives with its text:
 *   - it holds text of its own — written in the markup, not replaced by a binding (`<p role="alert">Failed to load</p>`
 *     in an `if:` branch, a row or a route);
 *   - in an `if:` / `elseif:` branch, its text is bound to what the condition reads — the path itself, a path above or
 *     below it, or a path the condition's getter reads (`if: notice` with `textContent: notice`): the branch appears
 *     exactly when the text is set.
 * A region whose text is bound to something else is in the page, empty, before that text changes (a form's error in
 * its route, a row's field error), and is announced then: not reported. (A route-body region whose text is set before
 * the navigation, or arrives while `<wcs-view-transition>` holds the swap, is not announced either — the markup does not
 * show that; docs say to keep such a region at the page level.)
 *
 * The region's attribute is read as written in the markup (a bound `attr.aria-live:` / `attr.role:` is not). Where it
 * sits comes from the walk the other element checks use (forContext's analyzeElementContexts): the content of a raw text
 * element, of an inert nested template or of a template that only app code clones is not a region the page builds.
 *
 * pure (DOM / vscode 非依存)。
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { extractAttribute, extractAttributeSpan, parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { analyzeElementContexts } from './forContext.js';
import { findAllBindAttributes, parseBindingExpression, splitBindingExpressions } from './bindingValidator.js';
import { findAllCommentBindings, findAllMustacheSyntax } from './templateSyntax.js';
import { analyzeCallableBodies } from './stateAnalyzer.js';
import { collectGetterReads } from './scriptAst.js';

/** The roles whose element is a live region by itself (WAI-ARIA 1.2: implicit `aria-live` polite / assertive). */
const LIVE_ROLES: ReadonlySet<string> = new Set(['status', 'alert', 'log']);
/** The bindings that replace an element's content (its markup text is not what it shows). */
const CONTENT_PROPERTIES: ReadonlySet<string> = new Set(['textContent', 'innerText', 'innerHTML', 'text', 'html']);
const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const TAG = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/** A live region's start tag: the attribute that makes it one (`role="status"`), and where its content is. */
interface Region {
  readonly start: number;
  readonly end: number;
  readonly contentStart: number;
  /** Where its end tag starts (the content's end); contentStart for a void element. */
  readonly contentEnd: number;
  /** The paths its own content-replacing bindings show (`textContent: notice`). */
  readonly ownText: readonly string[];
  /**
   * `role="alert"` (and no `aria-live`): a user agent may report a new alert by itself (a system alert event), so
   * inserting one with its text is announced by some browsers and screen readers, not surely.
   */
  readonly alert: boolean;
}

export function validateLiveRegions(
  html: string,
  bindAttribute: string = 'data-wcs',
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  const regions = findLiveRegions(html, bindAttribute);
  if (regions.length === 0) return [];
  const contexts = analyzeElementContexts(html, regions.map((r) => r.start), bindAttribute, stateTagName);
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  let bound: { readonly at: number; readonly paths: readonly string[]; readonly replaces: boolean }[] | null = null;
  let texts: { readonly at: number; readonly path: string }[] | null = null;
  let getterReads: Map<string, readonly string[]> | null = null;
  for (const region of regions) {
    const context = contexts.get(region.start);
    const by = context?.insertedBy ?? null;
    if (context === undefined || by === null) continue;
    const inside = (at: number): boolean => at > region.contentStart && at < region.contentEnd;
    bound ??= findAllBindAttributes(html, bindAttribute).map((attr) => {
      const props = splitBindingExpressions(attr.value).map(parseBindingExpression);
      const shown = props.filter((p) => CONTENT_PROPERTIES.has(p.property.split('#')[0]) && p.path !== null);
      return { at: attr.valueStart, paths: shown.map((p) => (p.path as string).trim()), replaces: shown.length > 0 };
    });
    // the text it holds: none when its own binding replaces its content, else what the markup writes outside the
    // descendants whose bindings replace theirs
    const ownReplaces = region.ownText.length > 0;
    const replacing = bound.filter((b) => b.replaces && inside(b.at));
    const holdsText = !ownReplaces && hasMarkupText(html, region.contentStart, region.contentEnd, replacing.map((b) => b.at));
    let tied: string | null = null;
    if (!holdsText && by === 'if' && context.insertedPath !== null) {
      texts ??= [...findAllMustacheSyntax(html), ...findAllCommentBindings(html)]
        .map((m) => ({ at: m.exprStart, path: m.expression.split('|')[0].trim() }));
      const shown = [
        ...region.ownText,
        ...(ownReplaces ? [] : [...replacing.flatMap((b) => b.paths), ...texts.filter((t) => inside(t.at)).map((t) => t.path)]),
      ].map((p) => p.split('|')[0].trim()).filter((p) => p !== '' && !p.startsWith('.'));
      const condition = context.insertedPath;
      getterReads ??= collectGetterReadsByName(html, stateTagName);
      // what the condition reads and what the text reads — through a getter on either side
      const family = [condition, ...(getterReads.get(condition) ?? [])];
      const reads = shown.flatMap((p) => [p, ...(getterReads!.get(p) ?? [])]);
      if (reads.some((p) => family.some((c) => related(p, c)))) tied = condition;
    }
    if (!holdsText && tied === null) continue;
    out.push({
      code: WcsDiagnosticCode.LiveRegionInserted,
      start: region.start,
      end: region.end,
      message: msgs.liveRegionInserted(html.slice(region.start, region.end), by, tied, region.alert),
      severity: 'warning',
    });
  }
  return out;
}

/** One path is the other, or above or below it (`error` / `error.message`). */
function related(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

/**
 * The paths each getter of the page's states reads (by its path: a volume's getter under its mount path), for an
 * `if:` whose condition is a getter (`if: hasNotice` reading `this.notice`).
 */
function collectGetterReadsByName(html: string, stateTagName: string): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const block of parseLoadedScriptBlocks(html, stateTagName)) {
    const prefix = block.mountPath === null || block.mountPath === '' ? '' : `${block.mountPath}.`;
    for (const callable of analyzeCallableBodies(block.content)) {
      if (callable.kind !== 'getter' || callable.accessor === 'set') continue;
      const reads = collectGetterReads(callable.body) ?? [];
      out.set(prefix + callable.name, reads.map((r) => prefix + r.path));
    }
  }
  return out;
}

/**
 * Whether the markup between `from` and `to` writes text a reader would hear: non-blank text outside comments, tags,
 * `{{ … }}`, the content of a `<template>` / `<script>` / `<style>`, and the content of the elements whose start tags hold
 * the content-replacing bindings at `replaced` (offsets of their attribute values).
 */
function hasMarkupText(html: string, from: number, to: number, replaced: readonly number[]): boolean {
  const content = html.slice(from, to);
  const tag = new RegExp(TAG.source, 'g');
  // per open element: whether its content is not text the region holds
  const stack: { name: string; silent: boolean }[] = [];
  let last = 0;
  const silent = (): boolean => stack.some((e) => e.silent);
  let match: RegExpExecArray | null;
  const text = (s: string): boolean => /\S/.test(s.replace(/\{\{[\s\S]*?\}\}/g, '').replace(/&nbsp;|&#160;/g, ''));
  while ((match = tag.exec(content)) !== null) {
    if (!silent() && text(content.slice(last, match.index))) return true;
    last = match.index + match[0].length;
    if (match[2] === undefined) continue; // a comment
    const name = match[2].toLowerCase();
    if (match[1] === '/') {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }
    if (VOID_ELEMENTS.has(name) || /\/\s*$/.test(match[3])) continue;
    const at = from + match.index;
    const end = from + last;
    const quiet = name === 'template' || name === 'script' || name === 'style' || replaced.some((r) => r > at && r < end);
    stack.push({ name, silent: quiet });
  }
  return !silent() && text(content.slice(last));
}

/**
 * The start tags of the document that make a live region, with the attribute that does it: `aria-live` with a value
 * other than `off`, else a `role` whose first token is a live role. HTML comments are skipped; a tag inside a raw text
 * element is dropped later (its context is not bound).
 */
function findLiveRegions(html: string, bindAttribute: string): Region[] {
  const out: Region[] = [];
  const tag = new RegExp(TAG.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) !== null) {
    if (match[2] === undefined || match[1] === '/') continue;
    const name = match[2].toLowerCase();
    const attrs = match[3];
    if (name === 'template' || !/\baria-live\b|\brole\b/i.test(attrs)) continue;
    const at = match.index + 1 + match[2].length;
    const live = extractAttribute(attrs, 'aria-live');
    if (live !== null && live.trim().toLowerCase() === 'off') continue;
    const role = extractAttribute(attrs, 'role');
    const attribute = live !== null ? 'aria-live' : role !== null && LIVE_ROLES.has(role.trim().split(/\s+/)[0].toLowerCase()) ? 'role' : null;
    if (attribute === null) continue;
    const span = extractAttributeSpan(attrs, attribute, at);
    if (span === null) continue;
    const contentStart = match.index + match[0].length;
    const own = extractAttribute(attrs, bindAttribute);
    const ownText = own === null ? [] : splitBindingExpressions(own).map(parseBindingExpression)
      .filter((p) => CONTENT_PROPERTIES.has(p.property.split('#')[0]) && p.path !== null)
      .map((p) => (p.path as string).trim());
    out.push({
      start: span.start,
      end: span.end,
      contentStart,
      contentEnd: VOID_ELEMENTS.has(name) || /\/\s*$/.test(attrs) ? contentStart : closingTagStart(html, contentStart, name),
      ownText,
      alert: attribute === 'role' && role!.trim().split(/\s+/)[0].toLowerCase() === 'alert',
    });
  }
  return out;
}

/** Where the end tag of the element named `name` whose content starts at `from` starts (same-named elements nest). */
function closingTagStart(html: string, from: number, name: string): number {
  const tag = new RegExp(TAG.source, 'g');
  tag.lastIndex = from;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) !== null) {
    if (match[2] === undefined || match[2].toLowerCase() !== name) continue;
    if (match[1] !== '/') {
      if (!/\/\s*$/.test(match[3])) depth++;
    } else if (depth-- === 0) {
      return match.index;
    }
  }
  return html.length;
}
