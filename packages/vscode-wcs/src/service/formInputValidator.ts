/**
 * formInputValidator.ts — what a form control's bindings do with what the user enters.
 *
 * The ekiden-entry seam app (a heavy data-entry wizard: IME, autofill, rows of inputs) made three mistakes on purpose
 * that run without a word — the runtime has nothing to throw on, and the lint said nothing:
 *
 * - `wcs/radio-name-shared` (warning): radios in a `for:` row with a literal `name` and a binding of the row's
 *   (`<input type="radio" name="sex" data-wcs="radio: .sex">`). Every row's radios get the same name, so the browser
 *   makes one group of all the rows: only one radio on the whole page stays checked, and the page disagrees with the
 *   rows' values from the first render. Quiet when the name is bound (`attr.name:` / `name:`), when the bound path is
 *   not a row's (`radio: selectedId` — one group over the rows is what is meant), and when the rows that vary the
 *   path each hold their own `<form>` (a radio group ends at its form). Said once per name and list.
 * - `wcs/number-written-as-string` (warning): a two-way `value:` with no conversion on the way in, bound to a data
 *   path the state holds as a number (its seed, a JSDoc `@type`, a stateSchema). An element's `value` is a string:
 *   after the user enters 5 the state holds `"5"`, and `count + 1` is `"51"`. Quiet with an input filter chain that
 *   gives a number (`value|number:`, `|int`, `|float`), on `valueAsNumber:`, with `#ro`, on a getter / setter pair
 *   (the setter may convert), and on a path whose declared type takes a string too.
 * - `wcs/two-way-output-filter` (warning): an output filter on a two-way `value:` / `valueAsNumber:`
 *   (`value: code|upper`, `value: price|locale`). In a field the user types in, written back on `input` (the
 *   default), the filter formats what the state holds on every keystroke: the field is rewritten under the user (the
 *   caret jumps to the end, an IME composition is cut), and the state receives the field's formatted text, since an
 *   output filter is not undone on the way back. Where a committed value is written back — `#onchange`, a slider, a
 *   picker, a `<select>` — nothing is rewritten while typing, and an input filter is the author's way back
 *   (`value#onchange|number: price|toFixed(2)`): reported only without one. Quiet with `#ro`, and for the filters
 *   that give back what the element wrote: `string`, `nullIfEmpty`, `coalesce(…)` (an element never writes null —
 *   unless an input `nullIfEmpty` does and the fallback is not empty) and `defaults('')`. Where it speaks,
 *   `wcs/number-written-as-string` is not stacked on the binding.
 *
 * Only native `<input>` / `<textarea>` / `<select>` are read: a custom element's write-back follows its wcBindable.
 * An input the user does not enter a value in (`checkbox`, `radio`, `hidden`, the buttons, `file`) is left out of the
 * two `value:` rules.
 *
 * pure (DOM / vscode 非依存)。
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { indexOfOutsideQuotes } from '../core/parser/quoteAware.js';
import type { JsonSchemaNode } from '../core/sidecar/types.js';
import {
  findAllBindAttributes, parseBindingExpression, splitBindingExpressions, writesBack,
  type BindAttrLocation, type ParsedBinding,
} from './bindingValidator.js';
import { BUILTIN_FILTERS, type FilterInfo } from './completionData.js';
import { countWildcardSegments, getEnclosingFors, getResolvedForListPath, getRowShorthandForPath } from './forContext.js';
import { candidateKeyOf } from './indexPath.js';
import { mergeSchemaCandidates, type PathCandidate } from './stateAnalyzer.js';
import { getStatePathIndex, type FileReader } from './statePathResolver.js';

const filterMap = new Map<string, FilterInfo>(BUILTIN_FILTERS.map((f) => [f.name, f]));

/** The `<input>` types whose `value` the user does not enter (a choice, a button, a file): not read by the `value:` rules. */
const NOT_ENTERED: ReadonlySet<string> = new Set(['checkbox', 'radio', 'hidden', 'button', 'submit', 'reset', 'image', 'file']);
/** The `<input>` types that are not typed in (a slider, a picker): no caret, no IME. */
const NOT_TYPED: ReadonlySet<string> = new Set(['range', 'color', 'date', 'datetime-local', 'month', 'week', 'time']);
/** The `<input>` types that have `valueAsNumber`. */
const AS_NUMBER: ReadonlySet<string> = new Set(['number', 'range', 'date', 'datetime-local', 'month', 'week', 'time']);

/** The state's candidates, read once when a binding needs a type. */
interface Types {
  readonly candidates: readonly PathCandidate[];
  readonly has: (path: string) => boolean;
  /** The paths a script declares as a getter (a setter beside it may convert what is written). */
  readonly computed: ReadonlySet<string>;
}

export function validateFormInputs(
  html: string,
  bindAttribute: string = 'data-wcs',
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
  applicationSchema?: JsonSchemaNode,
): WcsDiagnostic[] {
  const attrs = findAllBindAttributes(html, bindAttribute)
    .filter((attr) => attr.tagName === 'input' || attr.tagName === 'textarea' || attr.tagName === 'select');
  if (attrs.length === 0) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  let types: Types | null = null;
  const getTypes = (): Types => {
    if (types === null) {
      const index = getStatePathIndex(html, stateTagName, fileReader);
      const candidates = mergeSchemaCandidates(index.paths, applicationSchema);
      const set = new Set(candidates.map((p) => p.path));
      types = {
        candidates,
        has: (path) => set.has(path),
        computed: new Set(index.paths.filter((p) => p.kind === 'computed').map((p) => p.path)),
      };
    }
    return types;
  };
  // (the list whose rows share the name, the name) already reported
  const saidRadio = new Set<string>();

  for (const attr of attrs) {
    const bindings = splitBindingExpressions(attr.value);
    const parsed = bindings.map(parseBindingExpression);
    const type = (attr.inputType ?? 'text').toLowerCase();

    if (attr.tagName === 'input' && type === 'radio') {
      const shared = sharedRadioName(html, attr, parsed, bindAttribute);
      if (shared !== null && !saidRadio.has(shared.key)) {
        saidRadio.add(shared.key);
        out.push({
          code: WcsDiagnosticCode.RadioNameShared,
          start: shared.start,
          end: shared.end,
          message: msgs.radioNameShared(shared.name, shared.binding),
          severity: 'warning',
        });
      }
      continue;
    }
    if (attr.tagName === 'input' && NOT_ENTERED.has(type)) continue;
    const typed = attr.tagName === 'textarea' || (attr.tagName === 'input' && !NOT_TYPED.has(type));

    let pos = 0;
    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i];
      const bindingStart = attr.valueStart + pos;
      pos += binding.length + 1;
      const p = parsed[i];
      if (p.path === null) continue;
      const name = propertyName(p.property);
      if (name !== 'value' && name !== 'valueAsNumber') continue;
      if (!writesBack(attr, name, p.property)) continue;
      const path = p.path.trim();
      // the two sides as written: `value#onchange|trim` and `count|round` (the `:` between them is outside quotes)
      const colon = indexOfOutsideQuotes(binding, ':');
      const left = binding.slice(0, colon).trim();
      const rhs = binding.slice(colon + 1).trim();

      // --- an output filter on a two-way value
      const harmful = p.filters.find((filter) => !givesBackWhatWasWritten(filter, p));
      // written back on every keystroke: a field the user types in, on `input` (the default; `#onchange` waits for
      // the field to be committed, and a slider, a picker or a `<select>` is not typed in)
      const keystroke = typed && writeBackEvent(p.property) === 'input';
      // Where the value is written back once it is committed, an input filter is the author's way back
      // (`value#onchange|number: price|toFixed(2)` — the number is parsed again): quiet. On every keystroke the
      // field is rewritten under the user whatever the way back is
      if (harmful !== undefined && (keystroke || p.inputFilters.length === 0)) {
        // an unknown filter stops the state (wcs/filter-unknown, error): nothing is stacked on it
        if (p.filters.some((filter) => !filterMap.has(filter.name))) continue;
        out.push({
          code: WcsDiagnosticCode.TwoWayOutputFilter,
          start: bindingStart + harmful.offset,
          end: bindingStart + harmful.offset + harmful.name.length,
          message: msgs.twoWayOutputFilter(name, `|${binding.slice(p.filters[0].offset).trim()}`, left, rhs, keystroke),
          severity: 'warning',
        });
        continue;
      }

      // --- a string written into a number
      if (name !== 'value' || inputGivesNumber(p) !== false) continue;
      const statePath = expandRowPath(path, html, attr.valueStart, bindAttribute);
      if (statePath === null) continue;
      const t = getTypes();
      const key = candidateKeyOf(statePath, t.has);
      const candidate = t.candidates.find((c) => c.path === key);
      if (candidate === undefined || candidate.kind !== 'data' || t.computed.has(key) || !isNumberType(candidate.typeHint)) continue;
      const pathStart = bindingStart + binding.indexOf(p.path, colon + 1);
      out.push({
        code: WcsDiagnosticCode.NumberWrittenAsString,
        start: pathStart,
        end: pathStart + path.length,
        message: msgs.numberWrittenAsString(path, left, attr.tagName === 'input' && AS_NUMBER.has(type))
          + (path.startsWith('.') ? msgs.expansionSuffix(statePath) : ''),
        severity: 'warning',
        statePath,
      });
    }
  }
  return out;
}

/** The property a binding's left side names: without modifiers, and without the dot of the explicit property form. */
function propertyName(property: string): string {
  const name = property.replace(/#.*$/, '').trim();
  return name.startsWith('.') ? name.slice(1) : name;
}

/**
 * The event a native two-way binding writes back on, when the left side names one: `value#onchange` → `change`
 * (state's dom/plan.ts reads the modifier `on<event>`). `input` when it names none — an `<input>`'s and a
 * `<textarea>`'s default (a `<select>`'s is `change`; the caller does not ask for one).
 */
function writeBackEvent(property: string): string {
  const hash = property.indexOf('#');
  if (hash === -1) return 'input';
  const named = property.slice(hash + 1).split(',').map((m) => m.trim()).find((m) => /^on\w+$/.test(m));
  return named === undefined ? 'input' : named.slice(2);
}

/** A type hint that is a number, alone or with null (`number|null`): a string is not among what was declared. */
function isNumberType(typeHint: string | undefined): boolean {
  if (typeHint === undefined) return false;
  const parts = typeHint.split('|');
  return parts.includes('number') && parts.every((part) => part === 'number' || part === 'null');
}

/**
 * Whether the input filters turn the element's string into a number: true (`value|number:`, `|int`, `|float`, a
 * chain that ends in one), false (none, or a chain that leaves a string — `value|trim:`), or null when a filter is not
 * a built-in one (it is reported as such; nothing is said about what it gives).
 */
function inputGivesNumber(p: ParsedBinding): boolean | null {
  let current = 'string';
  for (const filter of p.inputFilters) {
    const info = filterMap.get(filter.name);
    if (info === undefined) return null;
    if (info.resultType !== 'passthrough') current = info.resultType;
  }
  return current === 'number';
}

/** A filter argument that is the empty string: `''`, `""`, or nothing before a comma (`defaults(,)`). */
function isEmptyArgument(args: readonly string[]): boolean {
  return args.length === 1 && (args[0] === '' || args[0] === "''" || args[0] === '""');
}

/**
 * Whether an output filter gives back, as the same text, whatever the element writes — so nothing is rewritten while
 * the user enters it:
 *   - `string`: the element wrote a string;
 *   - `nullIfEmpty`: an empty field becomes null, which is shown as an empty field;
 *   - `coalesce(v)`: replaces null / undefined only, and an element never writes those — unless an input
 *     `nullIfEmpty` does (`value|nullIfEmpty: note|coalesce(-)` puts `-` back into a field the user emptied);
 *   - `defaults(v)` with an empty `v`: replaces a falsy value, the empty field included, by the empty string.
 * Everything else changes the text (`upper`, `trim`, `locale`, `number` — "1." is rewritten "1"), a filter the lint
 * does not know included.
 */
function givesBackWhatWasWritten(filter: ParsedBinding['filters'][number], p: ParsedBinding): boolean {
  switch (filter.name) {
    case 'string':
    case 'nullIfEmpty':
      return true;
    case 'coalesce':
      return isEmptyArgument(filter.args) || !p.inputFilters.some((input) => input.name === 'nullIfEmpty');
    case 'defaults':
      return isEmptyArgument(filter.args);
    default:
      return false;
  }
}

/**
 * The state path a binding's path names: a path relative to the row (`.qty`) under the list its `for:` renders
 * (`rows.*.qty`). null where it cannot be told: outside a `for:`, or under one the parser refuses.
 */
function expandRowPath(path: string, html: string, offset: number, bindAttribute: string): string | null {
  if (!path.startsWith('.')) return path;
  if (getRowShorthandForPath(html, offset, bindAttribute) === null) return null;
  const list = getResolvedForListPath(html, offset, bindAttribute);
  if (list === null || list.startsWith('.')) return null;
  return path === '.' ? `${list}.*` : `${list}.*.${path.slice(1)}`;
}

/** One attribute of a start tag as written: its name (lower case), its value, and where the whole attribute is. */
interface WrittenAttribute {
  readonly name: string;
  readonly value: string | null;
  readonly start: number;
  readonly end: number;
}

/** The attributes of a start tag's attribute region, in order (a value is skipped as a value, never read as a name). */
function writtenAttributes(html: string, from: number, to: number): WrittenAttribute[] {
  const out: WrittenAttribute[] = [];
  const attribute = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+)))?/g;
  const text = html.slice(from, to);
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(text)) !== null) {
    out.push({
      name: match[1].toLowerCase(),
      value: match[2] ?? match[3] ?? match[4] ?? null,
      start: from + match.index,
      end: from + match.index + match[0].length,
    });
  }
  return out;
}

/**
 * A radio whose literal `name` every row of a list shares: where the `name` attribute is, and the key that says it
 * once (the list's template, the name). null when the radio is not such a one.
 */
function sharedRadioName(
  html: string,
  attr: BindAttrLocation,
  parsed: readonly ParsedBinding[],
  bindAttribute: string,
): { readonly name: string; readonly binding: 'radio' | 'checked'; readonly start: number; readonly end: number; readonly key: string } | null {
  if (attr.attrsStart === undefined || attr.attrsEnd === undefined) return null;
  const names = parsed.map((p) => propertyName(p.property));
  // a name the state gives: the attribute, or the property (which reflects it)
  if (names.includes('attr.name') || names.includes('name')) return null;
  const at = names.findIndex((name) => name === 'radio' || name === 'checked');
  if (at === -1) return null;
  const path = parsed[at].path?.trim() ?? '';
  // a path of the row: relative to it, or with a `*` a loop resolves. A path outside the rows (`radio: selectedId`)
  // is one value for all of them — one group over the rows is right there
  const wildcards = countWildcardSegments(path);
  if (!path.startsWith('.') && wildcards === 0) return null;
  const literal = writtenAttributes(html, attr.attrsStart, attr.attrsEnd).find((a) => a.name === 'name');
  if (literal === undefined || literal.value === null || literal.value.trim() === '') return null;
  const fors = getEnclosingFors(html, attr.valueStart, bindAttribute);
  if (fors.length === 0) return null;
  // the loop whose rows the path varies with: the innermost one for a relative path, the one of its last `*` otherwise
  const level = path.startsWith('.') || wildcards > fors.length ? fors.length - 1 : wildcards - 1;
  const loop = fors[level];
  // a `<form>` opened inside that loop's row and still open here: each row has its own form, and a radio group ends
  // at its form owner
  const row = html.slice(loop.anchor, attr.attrsStart).toLowerCase();
  const form = row.lastIndexOf('<form');
  if (form !== -1 && /^<form[\s>]/.test(row.slice(form)) && row.indexOf('</form', form) === -1) return null;
  return {
    name: literal.value,
    binding: names[at] as 'radio' | 'checked',
    start: literal.start,
    end: literal.end,
    key: `${loop.anchor}\u0000${literal.value}`,
  };
}
