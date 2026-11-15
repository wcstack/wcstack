/**
 * bindingHostValidator.ts — bindings written on an element where they never take effect (the town-archive seam app).
 *
 * Both are well-formed bindings on paths that exist, so the path and syntax checks pass; what is wrong is the element
 * they are written on:
 *
 * - `wcs/body-binding` (error): the bind attribute on `<body>` or `<html>`
 *   (`<body data-wcs="onkeydown: onKey; class.dark: dark">`). `<wcs-state>` binds what is inside `<body>` — the
 *   runtime walks `document.body`'s children (state's dom/mount.ts) — never `<body>` or `<html>` themselves, so every
 *   binding there does nothing: the handler never runs, `class.` / `attr.` are never written. Up to 4.23 nothing says
 *   so at run time (from 4.24 the diagnostics add-on warns with the same code). Only the document's own start tags:
 *   not one in a comment, a script or other raw text, nor one inside a `<template>` (the HTML parser drops it there).
 * - `wcs/link-handler` (error): an `on*:` binding on a `<wcs-link>`
 *   (`<wcs-link data-wcs="attr.to: .href; onclick: openPhoto">`). The link's host is `display: none` and the user
 *   clicks the `<a>` the link generates beside itself (the router's Link.ts), so no event reaches the host and the
 *   handler never runs. Reported where a state binds the element (forContext's `bound`: not in a template the page's
 *   own script clones, nor in raw text). The tag is the router's default name — `config.tagNames` is not visible here,
 *   as for the other `<wcs-link>` rules. `wcs/delegated-current-target` is not stacked on such a binding
 *   (bindingValidator): the handler never runs, so `#direct` is no fix.
 *
 * pure (no DOM, no vscode). The bindings are read with bindingValidator's scan and parser.
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { createTemplateTester } from '../language/htmlParse.js';
import { findAllBindAttributes, parseBindingExpression, splitBindingExpressions, type BindAttrLocation } from './bindingValidator.js';
import { analyzeElementContexts } from './forContext.js';

/** The elements the runtime never binds: it starts from the children of `<body>`. */
const UNBOUND_HOSTS: ReadonlySet<string> = new Set(['body', 'html']);
const LINK_TAG = 'wcs-link';

export function validateBindingHosts(
  html: string,
  bindAttribute: string = 'data-wcs',
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  const attrs = findAllBindAttributes(html, bindAttribute)
    .filter((attr) => attr.tagName !== undefined && (UNBOUND_HOSTS.has(attr.tagName) || attr.tagName === LINK_TAG));
  if (attrs.length === 0) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  const contexts = analyzeElementContexts(html, attrs.map((attr) => attr.valueStart), bindAttribute, stateTagName);
  const isBound = (attr: BindAttrLocation): boolean => contexts.get(attr.valueStart)?.bound === true;
  let insideTemplate: ((offset: number) => boolean) | null = null;

  for (const attr of attrs) {
    const tagName = attr.tagName!;
    if (UNBOUND_HOSTS.has(tagName)) {
      // (an empty attribute binds nothing anyway; `bound` is false in raw text — a `<body …>` written in a <noscript>)
      if (attr.value.trim() === '' || !isBound(attr) || (insideTemplate ??= createTemplateTester(html))(attr.valueStart)) continue;
      out.push({
        code: WcsDiagnosticCode.BodyBinding,
        start: attributeStart(html, attr, bindAttribute),
        end: attr.valueStart + attr.value.length + 1,
        severity: 'error',
        tag: tagName,
        message: msgs.bodyBinding(tagName, bindAttribute),
      });
      continue;
    }
    if (!isBound(attr)) continue;
    let pos = 0;
    for (const binding of splitBindingExpressions(attr.value)) {
      const bindingStart = attr.valueStart + pos;
      pos += binding.length + 1; // ';'
      const parsed = parseBindingExpression(binding);
      // an event binding is `on<event>:` with a handler; `.onclick:` (the explicit property form) is a property
      const property = parsed.property.replace(/#.*$/, '').trim();
      if (!/^on\w/.test(property) || parsed.path === null || parsed.path.trim() === '') continue;
      const start = bindingStart + (binding.length - binding.trimStart().length);
      out.push({
        code: WcsDiagnosticCode.LinkHandler,
        start,
        end: start + property.length,
        severity: 'error',
        tag: LINK_TAG,
        message: msgs.linkHandler(property, parsed.path.trim()),
      });
    }
  }
  return out;
}

/** Where the bind attribute's name starts (the diagnostic covers the whole attribute, `data-wcs="…"`). */
function attributeStart(html: string, attr: BindAttrLocation, bindAttribute: string): number {
  const from = attr.attrsStart ?? attr.valueStart;
  const head = html.slice(from, attr.valueStart);
  const escaped = bindAttribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = new RegExp(`${escaped}\\s*=\\s*["']$`, 'i').exec(head);
  return name === null ? attr.valueStart : from + name.index;
}
