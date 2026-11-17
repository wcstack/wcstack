/**
 * ioAttributeValidator.ts — literal attribute values of the built-in `wcs-*` tags that do not mean what was written.
 *
 * ioNodeValidator checks what a tag's `data-wcs` binds against its contract; this checks a value written in the markup
 * that the element reads as it is.
 *
 * - `wcs/root-margin-unit` (warning): a literal `root-margin` on `<wcs-intersect>` or `<wcs-infinite-scroll>` that
 *   `IntersectionObserver` refuses — `root-margin="200"`, `"0 0 900 0"` (the town-archive seam app). Both elements
 *   pass the attribute to the constructor's `rootMargin`, which takes one to four values, each a number with `px` or
 *   `%`; a `0` needs its unit too (checked in Chromium and Firefox: `"0"` and `"0 0 900px 0"` throw `rootMargin must
 *   be specified in pixels or percent`, as `1em` and a fifth value do). `<wcs-intersect>` catches the throw and
 *   observes nothing (`observing` stays false); `<wcs-infinite-scroll>` loads no page. An empty value is the default
 *   (`0px`).
 * - `wcs/frequency-invalid` (warning): a literal `frequency` on `<wcs-accelerometer>`, `<wcs-gyroscope>`,
 *   `<wcs-magnetometer>` or `<wcs-ambient-light-sensor>` that is not a positive finite number — `"60hz"`, `"0"`,
 *   `"-5"` (the stamp-rally seam app). The element's getter reads such a value as "none" (`Number(value)`, finite and
 *   above 0 — the same test here), so the sensor runs at the browser's default rate without a word; from 4.25 the
 *   element warns with the same code. An empty value is "none" by design.
 * - `wcs/target-selector` (warning): a literal `target` on `<wcs-fullscreen>`, `<wcs-pip>`, `<wcs-pointer-lock>`,
 *   `<wcs-intersect>` or `<wcs-resize>` written as a bare word (`target="viewer"`) where the document has an element
 *   with that id and none with that tag name. The five resolve `target` the same way — `"self"`, nothing (the first
 *   child), or a CSS selector handed to `querySelector` — so the word selects `<viewer>` elements and finds none; the
 *   author meant `#viewer` (stamp-rally). Only in a document that holds the element with the id: a fragment whose
 *   target is elsewhere is not judged.
 *
 * Not checked, for all three: a value a server template fills in (`{{ }}`), and an element whose `data-wcs` binds the
 * input (`rootMargin:` / `frequency:` / `target:` — the state's value replaces the attribute, and cannot be read here).
 *
 * pure (no DOM, no vscode).
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { asciiLowerCase, extractAttribute, extractAttributeSpan, findStartTagRegions, type StartTagRegion } from '../language/htmlParse.js';
import { parseBindingExpression, splitBindingExpressions } from './bindingValidator.js';

/** The tags that hand `root-margin` to `IntersectionObserver` (their packages' default names). */
const ROOT_MARGIN_TAGS: ReadonlySet<string> = new Set(['wcs-intersect', 'wcs-infinite-scroll']);
const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
/** One value `rootMargin` takes: a number with px or % (`200px`, `-50%`, `.5px`). */
const ROOT_MARGIN_VALUE = new RegExp(`^${NUMBER}(?:px|%)$`, 'i');
/** A number with no unit (`200`, `0`, `-50`): pixels are meant. */
const UNITLESS_NUMBER = new RegExp(`^${NUMBER}$`, 'i');

/** The sensor tags whose `frequency` attribute is the sampling rate in Hz (their packages' default names). */
const FREQUENCY_TAGS: ReadonlySet<string> = new Set([
  'wcs-accelerometer', 'wcs-gyroscope', 'wcs-magnetometer', 'wcs-ambient-light-sensor',
]);
/** The positive number a value starts with (`60` of `60hz`, `59.94` of `59.94 fps`). */
const LEADING_NUMBER = /^\s*\+?((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/i;

/** The tags whose `target` is `"self"`, nothing, or a CSS selector for `querySelector` (their packages' default names). */
const TARGET_SELECTOR_TAGS: ReadonlySet<string> = new Set([
  'wcs-fullscreen', 'wcs-pip', 'wcs-pointer-lock', 'wcs-intersect', 'wcs-resize',
]);
/** The sentinel the tags read before they try a selector: the element itself. */
const TARGET_SELF = 'self';
/** A bare word: letters, digits, `-`, `_` — as a selector, a tag name (or nothing a selector can be). */
const BARE_WORD = /^[\w-]+$/;

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

/**
 * A sensor's `frequency` attribute the element reads as "none" although something is written: the same test as the
 * elements' getter (blank → none by design; otherwise `Number(value)` must be finite and above 0). `suggested` is the
 * positive number the value starts with (`"60hz"` → `60`), or null. Null when the value is usable or blank.
 */
export function checkFrequency(value: string): { suggested: string | null } | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return null;
  const lead = LEADING_NUMBER.exec(value);
  const number = lead === null ? NaN : Number(lead[1]);
  return { suggested: Number.isFinite(number) && number > 0 ? lead![1] : null };
}

export function validateIoAttributes(html: string, bindAttribute: string = 'data-wcs', locale?: string): WcsDiagnostic[] {
  if (!/root-margin|frequency|target/i.test(html)) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  const regions = findStartTagRegions(html);
  // the ids and the tag names of the document's elements, read once when a `target` is a bare word
  let names: { ids: ReadonlySet<string>; tags: ReadonlySet<string> } | null = null;
  for (const region of regions) {
    const tag = region.tagName;
    const content = html.slice(region.start, region.end);
    if (ROOT_MARGIN_TAGS.has(tag)) {
      const literal = literalAttribute(html, region, content, 'root-margin', 'rootMargin', bindAttribute);
      const problem = literal === null ? null : checkRootMargin(literal.value);
      if (literal !== null && problem !== null) {
        out.push({
          code: WcsDiagnosticCode.RootMarginUnit,
          start: literal.start,
          end: literal.end,
          severity: 'warning',
          tag,
          message: msgs.rootMarginUnit(tag, literal.value, problem.refused, problem.suggested),
        });
      }
    }
    if (FREQUENCY_TAGS.has(tag)) {
      const literal = literalAttribute(html, region, content, 'frequency', 'frequency', bindAttribute);
      const problem = literal === null ? null : checkFrequency(literal.value);
      if (literal !== null && problem !== null) {
        out.push({
          code: WcsDiagnosticCode.FrequencyInvalid,
          start: literal.start,
          end: literal.end,
          severity: 'warning',
          tag,
          member: 'frequency',
          message: msgs.frequencyInvalid(tag, literal.value, problem.suggested),
        });
      }
    }
    if (TARGET_SELECTOR_TAGS.has(tag)) {
      const literal = literalAttribute(html, region, content, 'target', 'target', bindAttribute);
      const word = literal === null ? '' : literal.value.trim();
      if (literal === null || word === TARGET_SELF || !BARE_WORD.test(word)) continue;
      names ??= documentNames(html, regions);
      // (a selector that is a tag name matches whatever the letters' case: `Viewer` selects <viewer>)
      if (!names.ids.has(word) || names.tags.has(asciiLowerCase(word))) continue;
      out.push({
        code: WcsDiagnosticCode.TargetSelector,
        start: literal.start,
        end: literal.end,
        severity: 'warning',
        tag,
        member: 'target',
        message: msgs.targetSelector(tag, word),
      });
    }
  }
  return out;
}

/**
 * The attribute `name` as written on the element, with where its value is — null when it is absent, a server
 * template fills it in (`{{ }}`), or the element's bindings write the input it backs (`input`).
 */
function literalAttribute(
  html: string,
  region: StartTagRegion,
  content: string,
  name: string,
  input: string,
  bindAttribute: string,
): { value: string; start: number; end: number } | null {
  const span = extractAttributeSpan(content, name, region.start);
  if (span === null) return null;
  const value = html.slice(span.valueStart, span.valueEnd);
  if (value.includes('{{') || bindsInput(extractAttribute(content, bindAttribute), input)) return null;
  return { value, start: span.valueStart, end: span.valueEnd };
}

/** Whether the element's bindings write the input (`rootMargin: margin`, with modifiers or the explicit `.` form). */
function bindsInput(bindings: string | null, input: string): boolean {
  if (bindings === null) return false;
  return splitBindingExpressions(bindings)
    .some((binding) => parseBindingExpression(binding).property.replace(/#.*$/, '').trim().replace(/^\./, '') === input);
}

/** The literal ids and the tag names of the document's start tags (a `<template>`'s content included). */
function documentNames(html: string, regions: readonly StartTagRegion[]): { ids: ReadonlySet<string>; tags: ReadonlySet<string> } {
  const ids = new Set<string>();
  const tags = new Set<string>();
  for (const region of regions) {
    tags.add(region.tagName);
    const content = html.slice(region.start, region.end);
    if (!/\sid\s*=/i.test(content)) continue;
    const id = extractAttribute(content, 'id');
    if (id !== null) ids.add(id);
  }
  return { ids, tags };
}
