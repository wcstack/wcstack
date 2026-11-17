/**
 * elementMembers.ts — what a binding on a custom element is bound to: an output, an input, or both.
 *
 * The runtime takes a property binding's direction from the element's `static wcBindable` (state's dom/wc.ts
 * `attachProperty`): a member declared in `properties` is written by the element — at the first sync when it is
 * output-only, and each time its event fires — and one declared in `inputs` is written by the state. The lint has
 * that declaration for the built-in `wcs-*` tags (generated/builtinTags.generated.ts) and for an element the page
 * defines with a literal `static wcBindable` (pageElements.ts). Several rules ask the same question of it:
 *
 *   - `wcs/path-readonly`: an output bound to a getter without a setter (the write is refused)
 *   - `wcs/output-path-written`: a script writing `true` to a path only outputs are bound to
 *   - `wcs/path-dynamic-unknown`: a path under a slot an output writes (its shape is the element's, not the seed's)
 *
 * pure (DOM / vscode 非依存): files come through the `FileReader`.
 */

import { findIgnoredRanges } from '../language/htmlParse.js';
import { parseBindTextWithPositions } from '../core/parser/positionalParser.js';
import { findAllBindAttributes } from './bindingValidator.js';
import { getResolvedForListPath, getRowShorthandForPath } from './forContext.js';
import { BUILTIN_TAGS } from './generated/builtinTags.generated.js';
import { collectPageElementContracts, mayDefineElements } from './pageElements.js';
import type { FileReader } from './statePathResolver.js';

/** A custom element's declared members: a built-in tag's catalog entry, or a page element's `static wcBindable`. */
export interface ElementContract {
  readonly properties: readonly string[];
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly commands: readonly string[];
  /** A built-in tag's: the parameters each command's method declares (generated/builtinTags.generated.ts). */
  readonly commandArity?: Readonly<Record<string, number>>;
}

/**
 * How the runtime wires a member: `output` — declared in `properties` only (the element writes the state, the state
 * never writes it); `input` — in `inputs` only; `two-way` — in both.
 */
export type MemberRole = 'output' | 'two-way' | 'input';

const own = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

/** The role of `member` in `contract`, or null when the element does not declare it. */
export function memberRole(contract: ElementContract, member: string): MemberRole | null {
  const output = contract.properties.includes(member);
  const input = own(contract.inputs, member);
  return output ? (input ? 'two-way' : 'output') : input ? 'input' : null;
}

/** Looks a tag's contract up: null for a native element, a helper tag without `wcBindable`, or an element the lint has no declaration of. */
export type ContractLookup = (tag: string | undefined) => ElementContract | null;

/**
 * The contracts of the document's custom elements. The built-in tags come from the catalog; the page's own are read
 * from its scripts the first time one is asked for (pageElements.ts — only a literal declaration gives a contract).
 */
export function createContractLookup(html: string, fileReader?: FileReader): ContractLookup {
  let page: ReadonlyMap<string, ElementContract> | null = null;
  return (tag) => {
    if (tag === undefined || !tag.includes('-')) return null;
    if (own(BUILTIN_TAGS, tag)) return BUILTIN_TAGS[tag].hasWcBindable ? BUILTIN_TAGS[tag] : null;
    if (tag.startsWith('wcs-')) return null;
    page ??= mayDefineElements(html) ? collectPageElementContracts(html, fileReader) : new Map();
    return page.get(tag) ?? null;
  };
}

/** One member of a custom element bound to a state path — written out (`held: awake`) or through a spread (`...: lock`). */
export interface MemberBinding {
  readonly tag: string;
  readonly member: string;
  readonly role: MemberRole;
  /**
   * The path as the state has it: a row's relative path under the list its `for:` renders (`items.*.on`), a spread's
   * member under the spread's path (`lock.held`).
   */
  readonly path: string;
  /** The binding's modifiers (`ro`, `init=none`, …); none for a spread's members. */
  readonly modifiers: readonly string[];
  readonly spread: boolean;
  /** Where the path is written in the document (the spread's own path for its members). */
  readonly start: number;
  readonly end: number;
}

/**
 * The value of a binding's `#init=` modifier (`element` / `state` / `auto` / `none`), or null when it has none.
 * Read as the runtime reads it (state's dom/plan.ts `flags`): the key and the value are trimmed (`init = none`).
 */
export function initModifier(modifiers: readonly string[]): string | null {
  for (const modifier of modifiers) {
    const match = /^\s*init\s*=(.*)$/.exec(modifier);
    if (match !== null) return match[1].trim();
  }
  return null;
}

/**
 * Whether the element writes the bound path. An output-only member is written at the first sync (unless `#init=none`)
 * and on each event (unless `#ro`); a two-way member on each event (unless `#ro`), and at the first sync with
 * `#init=element`. An input is never written by its element.
 */
export function elementWrites(binding: Pick<MemberBinding, 'role' | 'modifiers'>): boolean {
  if (binding.role === 'input') return false;
  if (!binding.modifiers.some((modifier) => modifier.trim() === 'ro')) return true;
  const init = initModifier(binding.modifiers);
  return binding.role === 'output' ? init !== 'none' : init === 'element';
}

/**
 * Every member binding on the document's custom elements whose contract the lint has (`lookup`), as the runtime plans
 * them: a property binding of a declared member, and each member a spread binds (but one bound explicitly after the
 * spread — the last wins). Not in a `data-wcs-ignore` element; a relative path outside a `for:` is left out.
 */
export function collectMemberBindings(html: string, bindAttribute: string, lookup: ContractLookup): MemberBinding[] {
  const out: MemberBinding[] = [];
  let ignored: Array<readonly [number, number]> | null = null;
  for (const attr of findAllBindAttributes(html, bindAttribute)) {
    // (a cheap test first: most elements with bindings are native)
    if (attr.tagName === undefined || !attr.tagName.includes('-')) continue;
    const contract = lookup(attr.tagName);
    if (contract === null) continue;
    ignored ??= findIgnoredRanges(html, bindAttribute);
    if (ignored.some(([start, end]) => attr.valueStart >= start && attr.valueStart < end)) continue;
    const tag = attr.tagName;
    const bindings = parseBindTextWithPositions(attr.value);
    bindings.forEach((binding, index) => {
      const parsed = binding.parsed;
      if (parsed === null || binding.pathRange === null) return;
      const start = attr.valueStart + binding.pathRange.start;
      const end = attr.valueStart + binding.pathRange.end;
      let path = parsed.statePathName;
      if (path.startsWith('.')) {
        const list = getRowShorthandForPath(html, start, bindAttribute) === null ? null : getResolvedForListPath(html, start, bindAttribute);
        if (list === null || list.startsWith('.')) return;
        path = path === '.' ? `${list}.*` : `${list}.*.${path.slice(1)}`;
      }
      if (parsed.bindingType === 'spread') {
        const later = new Set(bindings.slice(index + 1).flatMap((b) => (b.parsed?.bindingType === 'prop' ? [b.parsed.propName] : [])));
        for (const member of new Set([...contract.properties, ...Object.keys(contract.inputs)])) {
          if (later.has(member)) continue;
          out.push({ tag, member, role: memberRole(contract, member)!, path: `${path}.${member}`, modifiers: [], spread: true, start, end });
        }
        return;
      }
      if (parsed.bindingType !== 'prop' || parsed.propSegments.length !== 1) return;
      const role = memberRole(contract, parsed.propName);
      if (role === null) return;
      out.push({ tag, member: parsed.propName, role, path, modifiers: parsed.propModifiers, spread: false, start, end });
    });
  }
  return out;
}

/** The last document read: the validators of one run each ask for the same page's member bindings. */
let lastRead: { html: string; bindAttribute: string; fileReader: FileReader | undefined; bindings: readonly MemberBinding[] } | null = null;

/**
 * `collectMemberBindings` for a document, with the contracts read from it (`createContractLookup`). The answer for the
 * last document is kept — the same text, attribute and reader — as several validators ask for it in one run (a run
 * makes its own reader, so a file changed between two runs is read again).
 */
export function documentMemberBindings(html: string, bindAttribute: string, fileReader?: FileReader): readonly MemberBinding[] {
  if (lastRead !== null && lastRead.fileReader === fileReader && lastRead.bindAttribute === bindAttribute && lastRead.html === html) {
    return lastRead.bindings;
  }
  const bindings = collectMemberBindings(html, bindAttribute, createContractLookup(html, fileReader));
  lastRead = { html, bindAttribute, fileReader, bindings };
  return bindings;
}

/** A state path an element's output writes: what it holds is what the element gives, whatever the state seeds it with. */
export interface OutputSlot {
  readonly path: string;
  readonly tag: string;
  readonly member: string;
  /** Where the binding names the path in the document. */
  readonly start: number;
  readonly end: number;
}

/**
 * The paths an output-only member writes (the first binding of each): `value: picked` on `<wcs-contacts>`, the
 * `value` a spread on `<wcs-fetch>` puts under its path. A two-way member's path is not one: the state writes it too,
 * and its seed says what the page puts there.
 */
export function collectOutputSlots(bindings: readonly MemberBinding[]): OutputSlot[] {
  const slots = new Map<string, OutputSlot>();
  for (const binding of bindings) {
    if (binding.role !== 'output' || !elementWrites(binding) || slots.has(binding.path)) continue;
    slots.set(binding.path, { path: binding.path, tag: binding.tag, member: binding.member, start: binding.start, end: binding.end });
  }
  return [...slots.values()];
}
