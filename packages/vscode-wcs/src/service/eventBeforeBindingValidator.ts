/**
 * eventBeforeBindingValidator.ts — an event an I/O node dispatches before its `eventToken.` binding is attached
 * (`wcs/event-before-binding`, warning). The static twin of the runtime's warning of the same code.
 *
 * From the counter-assist seam app (a call display fed by one SSE stream): `<wcs-sse url="/api/queue/stream"
 * data-wcs="eventToken.message: queueEvent">`. The element is defined when its package loads, and with a literal `url`
 * it connects at once — before the state's file has loaded and bound the event token. The stream's first event (the
 * snapshot of the queue) is dispatched to nobody: the page showed 0 waiting with 8 waiting (Chromium, Firefox), and
 * nothing said so.
 *
 * Reported: an element that starts on its own from a literal attribute — `url` on `<wcs-sse>` and `<wcs-ws>`, `name`
 * (the channel) on `<wcs-broadcast>`; not with `manual` — whose bind attribute holds `eventToken.<output>:` for an
 * output its wc-bindable contract declares `semantics: "event"` (the generated catalogue's `events`). Once per element,
 * on the token's left side.
 *
 * Quiet when:
 *   - the attribute is bound (`url:` / `attr.url:` / `.url:`) or absent (or empty): the element starts once the page
 *     gives it, after the binding;
 *   - the output is bound as a property too (`message: path`, or a spread, which binds every output): the binding
 *     seeds the state from the element's value;
 *   - the element is inside a `<template>` (a `for:` / `if:` row, a route): it is inserted and bound in one go;
 *   - the text has no `<wcs-state>` (a fragment the router inserts and hands to the state in one go).
 *
 * pure (DOM / vscode 非依存)。
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { createTemplateTester, findStartTagRegions } from '../language/htmlParse.js';
import { BUILTIN_TAGS } from './generated/builtinTags.generated.js';
import { parseBindingExpression, splitBindingExpressions } from './bindingValidator.js';
import { propertyName, writtenAttributes } from './formInputValidator.js';

/** The I/O nodes that open their connection on their own, and the input (an attribute of the same name) that opens it. */
const STARTED_BY: Readonly<Record<string, string>> = {
  'wcs-sse': 'url',
  'wcs-ws': 'url',
  'wcs-broadcast': 'name',
};

export function validateEventsBeforeBinding(
  html: string,
  bindAttribute: string = 'data-wcs',
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  if (!/<wcs-(?:sse|ws|broadcast)\b/i.test(html) || !html.toLowerCase().includes(`<${stateTagName.toLowerCase()}`)) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  let insideTemplate: ((offset: number) => boolean) | null = null;
  for (const region of findStartTagRegions(html)) {
    const attribute = STARTED_BY[region.tagName];
    if (attribute === undefined) continue;
    const events = BUILTIN_TAGS[region.tagName]?.events ?? [];
    if (events.length === 0) continue;
    const attributes = writtenAttributes(html, region.start, region.end);
    const bind = attributes.find((a) => a.name === bindAttribute.toLowerCase());
    if (bind === undefined || bind.value === null || !bind.value.includes('eventToken.')) continue;
    if (attributes.some((a) => a.name === 'manual')) continue;
    const literal = attributes.find((a) => a.name === attribute);
    if (literal === undefined || literal.value === null || literal.value.trim() === '') continue;

    // the bindings, with where each one's left side starts in the HTML
    const eq = /=\s*["']?/.exec(html.slice(bind.start, bind.end))!;
    const valueStart = bind.start + eq.index + eq[0].length;
    const bindings: { name: string; start: number; property: string }[] = [];
    let pos = 0;
    for (const binding of splitBindingExpressions(bind.value)) {
      const p = parseBindingExpression(binding);
      const property = p.property.trim();
      const leading = binding.length - binding.trimStart().length;
      bindings.push({ name: propertyName(property), start: valueStart + pos + leading, property });
      pos += binding.length + 1;
    }
    const names = new Set(bindings.map((b) => b.name));
    // the input bound from the state: the element starts once the page gives it
    if (names.has(attribute) || names.has(`attr.${attribute}`)) continue;
    // a spread binds every output as a property: the state is seeded from the element
    if (bindings.some((b) => b.property === '...')) continue;
    const token = bindings.find((b) => {
      if (!b.name.startsWith('eventToken.')) return false;
      const output = b.name.slice('eventToken.'.length);
      return events.includes(output) && !names.has(output);
    });
    if (token === undefined) continue;
    if ((insideTemplate ??= createTemplateTester(html))(region.start)) continue;
    const output = token.name.slice('eventToken.'.length);
    out.push({
      code: WcsDiagnosticCode.EventBeforeBinding,
      start: token.start,
      end: token.start + token.property.length,
      message: msgs.eventBeforeBinding(region.tagName, output, attribute),
      severity: 'warning',
      tag: region.tagName,
      member: output,
    });
  }
  return out;
}
