/**
 * htmlSinkInputValidator.ts — what the user types, put onto the page as markup (`wcs/html-sink-input`, warning).
 *
 * From the counter-assist seam app (an answer console where staff type a citizen's question): the question was shown
 * with `html:` instead of `textContent:`, and `住民票 <img src=x onerror=…><b>太字</b>` came out bold with the image
 * gone — the page's Trusted Types policy happened to sanitize it; without one it would have run. Nothing said so.
 *
 * Reported: an HTML sink binding — `html:`, and the properties state writes as markup (its `isHtmlSink`: `innerHTML:`,
 * `outerHTML:`, `srcdoc:`) — whose path is a path that a form control on the same page writes back through a two-way
 * `value:`: an `<input>` the user types text in (not a choice, a button, a file, a number, a slider or a picker), a
 * `<textarea>`, a `<select>`. Paths are compared as state paths: inside a `for:`, `.x` is `list.*.x` (formInputValidator's
 * `expandRowPath`). A filter on the sink does not silence it — whether it sanitizes is not known — and the message says
 * so. Once per sink binding.
 *
 * Not reported: text that reaches the sink another way (a method copies the typed question into a list the sink reads —
 * the seam app's actual shape: only the path is compared), a `#ro` control (it writes nothing back), a custom element
 * (its write-back follows its wcBindable).
 *
 * pure (DOM / vscode 非依存)。
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { indexOfOutsideQuotes } from '../core/parser/quoteAware.js';
import { findAllBindAttributes, parseBindingExpression, splitBindingExpressions, writesBack } from './bindingValidator.js';
import { NOT_ENTERED, NOT_TYPED, expandRowPath, propertyName } from './formInputValidator.js';

/** The bindings state writes as markup: `html:` and its `isHtmlSink` properties. */
const HTML_SINKS: ReadonlySet<string> = new Set(['html', 'innerHTML', 'outerHTML', 'srcdoc']);

export function validateHtmlSinkInputs(html: string, bindAttribute: string = 'data-wcs', locale?: string): WcsDiagnostic[] {
  const attrs = findAllBindAttributes(html, bindAttribute);
  if (!attrs.some((attr) => attr.tagName === 'input' || attr.tagName === 'textarea' || attr.tagName === 'select')) return [];

  // the state paths a control writes what the user enters to → the control's tag
  const written = new Map<string, string>();
  for (const attr of attrs) {
    const tag = attr.tagName;
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') continue;
    if (tag === 'input') {
      const type = (attr.inputType ?? 'text').toLowerCase();
      if (NOT_ENTERED.has(type) || NOT_TYPED.has(type) || type === 'number') continue;
    }
    for (const binding of splitBindingExpressions(attr.value)) {
      const p = parseBindingExpression(binding);
      if (p.path === null || propertyName(p.property) !== 'value' || !writesBack(attr, 'value', p.property)) continue;
      const path = expandRowPath(p.path.trim(), html, attr.valueStart, bindAttribute);
      if (path !== null && !written.has(path)) written.set(path, tag);
    }
  }
  if (written.size === 0) return [];

  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const attr of attrs) {
    let pos = 0;
    for (const binding of splitBindingExpressions(attr.value)) {
      const bindingStart = attr.valueStart + pos;
      pos += binding.length + 1;
      const p = parseBindingExpression(binding);
      if (p.path === null || !HTML_SINKS.has(propertyName(p.property))) continue;
      const path = p.path.trim();
      const statePath = expandRowPath(path, html, attr.valueStart, bindAttribute);
      const control = statePath === null ? undefined : written.get(statePath);
      if (control === undefined) continue;
      const colon = indexOfOutsideQuotes(binding, ':');
      const pathStart = bindingStart + binding.indexOf(path, colon + 1);
      out.push({
        code: WcsDiagnosticCode.HtmlSinkInput,
        start: pathStart,
        end: pathStart + path.length,
        message: msgs.htmlSinkInput(`${binding.slice(0, colon).trim()}: ${binding.slice(colon + 1).trim()}`, control, path),
        severity: 'warning',
        statePath: statePath!,
      });
    }
  }
  return out;
}
