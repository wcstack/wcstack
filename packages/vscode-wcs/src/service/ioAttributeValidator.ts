/**
 * ioAttributeValidator.ts — literal attribute values of the built-in `wcs-*` tags that the platform refuses.
 *
 * ioNodeValidator checks what a tag's `data-wcs` binds against its contract; this checks a value written in the markup
 * that the element hands to a Web API as it is.
 *
 * - `wcs/root-margin-unit` (warning): a literal `root-margin` on `<wcs-intersect>` or `<wcs-infinite-scroll>` that
 *   `IntersectionObserver` refuses — `root-margin="200"`, `"0 0 900 0"` (the town-archive seam app). Both elements
 *   pass the attribute to the constructor's `rootMargin`, which takes one to four values, each a number with `px` or
 *   `%`; a `0` needs its unit too (checked in Chromium and Firefox: `"0"` and `"0 0 900px 0"` throw `rootMargin must
 *   be specified in pixels or percent`, as `1em` and a fifth value do). `<wcs-intersect>` catches the throw and
 *   observes nothing (`observing` stays false); `<wcs-infinite-scroll>` loads no page. An empty value is the default
 *   (`0px`). Not checked: a value a server template fills in (`{{ }}`), and an element whose `data-wcs` binds
 *   `rootMargin:` (the state's value replaces the attribute, and cannot be read here).
 *
 * pure (no DOM, no vscode).
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { extractAttribute, extractAttributeSpan, findStartTagRegions } from '../language/htmlParse.js';
import { parseBindingExpression, splitBindingExpressions } from './bindingValidator.js';

/** The tags that hand `root-margin` to `IntersectionObserver` (their packages' default names). */
const ROOT_MARGIN_TAGS: ReadonlySet<string> = new Set(['wcs-intersect', 'wcs-infinite-scroll']);
const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
/** One value `rootMargin` takes: a number with px or % (`200px`, `-50%`, `.5px`). */
const ROOT_MARGIN_VALUE = new RegExp(`^${NUMBER}(?:px|%)$`, 'i');
/** A number with no unit (`200`, `0`, `-50`): pixels are meant. */
const UNITLESS_NUMBER = new RegExp(`^${NUMBER}$`, 'i');

/**
 * What the browser refuses in a `rootMargin` string: the values that are not a number with px or % (`refused`), and
 * the string with `px` added to its unitless numbers when that makes it valid (`suggested`). Null when it is valid —
 * one to four values, each with its unit, or nothing (the default).
 */
export function checkRootMargin(value: string): { refused: string[]; suggested: string | null } | null {
  const values = value.split(/\s+/).filter((v) => v !== '');
  const refused = [...new Set(values.filter((v) => !ROOT_MARGIN_VALUE.test(v)))];
  if (refused.length === 0 && values.length <= 4) return null;
  const fixable = values.length <= 4 && refused.every((v) => UNITLESS_NUMBER.test(v));
  return { refused, suggested: fixable ? values.map((v) => (UNITLESS_NUMBER.test(v) ? `${v}px` : v)).join(' ') : null };
}

export function validateIoAttributes(html: string, bindAttribute: string = 'data-wcs', locale?: string): WcsDiagnostic[] {
  if (!/root-margin/i.test(html)) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const region of findStartTagRegions(html)) {
    if (!ROOT_MARGIN_TAGS.has(region.tagName)) continue;
    const content = html.slice(region.start, region.end);
    const span = extractAttributeSpan(content, 'root-margin', region.start);
    if (span === null) continue;
    const value = html.slice(span.valueStart, span.valueEnd);
    if (value.includes('{{') || bindsRootMargin(extractAttribute(content, bindAttribute))) continue;
    const problem = checkRootMargin(value);
    if (problem === null) continue;
    out.push({
      code: WcsDiagnosticCode.RootMarginUnit,
      start: span.valueStart,
      end: span.valueEnd,
      severity: 'warning',
      tag: region.tagName,
      message: msgs.rootMarginUnit(region.tagName, value, problem.refused, problem.suggested),
    });
  }
  return out;
}

/** Whether the element's bindings write `rootMargin` (`rootMargin: margin`, with modifiers or the explicit `.` form). */
function bindsRootMargin(bindings: string | null): boolean {
  if (bindings === null) return false;
  return splitBindingExpressions(bindings)
    .some((binding) => parseBindingExpression(binding).property.replace(/#.*$/, '').trim().replace(/^\./, '') === 'rootMargin');
}
