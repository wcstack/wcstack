/**
 * outputPathValidator.ts — `wcs/output-path-written` (warning): a script that writes `true` to a path an element's
 * output is bound to, and nothing takes.
 *
 * `<wcs-fullscreen data-wcs="active: viewerFs">` binds an output: the element writes `viewerFs`, and nothing the
 * state writes there reaches the element (state's dom/wc.ts `attachProperty` — an output-only member is never
 * applied). A method that does `this.viewerFs = true` to "go fullscreen" changes the flag and nothing else: nothing
 * fills the screen, and what reads the flag now says it did (the stamp-rally seam app — "active is bound to viewerFs:
 * surely writing it fills the screen"). The binding is one-way by its declaration, so the runtime has nothing to
 * refuse.
 *
 * Narrow on purpose — a write to such a path is often right:
 *   - only an assignment of the literal `true`. Putting a consumed output back (`false`, `null`, a value) is the
 *     normal way to clear it, and is never reported
 *   - only a path bound to an output-only member of a custom element the lint has the declaration of (the built-in
 *     tags' catalog, the page's own literal `static wcBindable`) — written out or through a spread — and to nothing
 *     that takes a value from the state as its own: not a path also bound to an input or two-way member of a custom
 *     element (`trigger: flag` — the write starts that element), to a native two-way binding (`checked: flag` on a
 *     checkbox — the script sets what the user sets), or to a member of a custom element the lint has no declaration
 *     of (it may be an input)
 *   - not a path the state declares an accessor for (a setter may be the one that asks the element)
 * A path that is otherwise only *shown* — `class.fullscreen: viewerFs`, `attr.`, `textContent:`, `{{ }}`, an `if:` —
 * is reported: that is the real page's shape, where the write made the page say what the element had not done
 * (the button read "close", a `$watch` locked the orientation, and nothing was fullscreen).
 * The writes are read with the write-set machinery (scriptAst's collectGetterReads — docs/script-write-checks.md):
 * methods and setters, `$watch` handlers, and `$on` handlers through their state argument; aliases of `this` and
 * nested functions included. A getter's write is `wcs/getter-write`'s.
 *
 * pure (no DOM, no vscode): files come through the `FileReader`.
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { parseBindTextWithPositions } from '../core/parser/positionalParser.js';
import { findIgnoredRanges, parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { findAllBindAttributes, writesBack } from './bindingValidator.js';
import { createContractLookup, documentMemberBindings, type ContractLookup, type MemberBinding } from './elementMembers.js';
import { collectGetterReads, type CollectOptions } from './scriptAst.js';
import { onHandlerStateParam } from './semanticValidator.js';
import {
  accessorRow, analyzeCallableBodies, analyzeOnHandlerSources, analyzeStatePaths, analyzeWatchHandlerSources,
  hasDefaultExportObject, maskCommentsAndStrings, type WatchHandlerSource,
} from './stateAnalyzer.js';
import type { FileReader } from './statePathResolver.js';

/** An assignment of `true` (a cheap gate before anything is parsed). */
const ASSIGNS_TRUE = /=\s*true\b/;

/** A body the runtime runs with the state: its text, where it starts in the script, and how the state is named in it. */
interface StateBody {
  readonly text: string;
  readonly start: number;
  readonly options: CollectOptions;
}

export function validateOutputPathWrites(
  html: string,
  bindAttribute: string = 'data-wcs',
  stateTagName: string = 'wcs-state',
  locale?: string,
  fileReader?: FileReader,
): WcsDiagnostic[] {
  if (!ASSIGNS_TRUE.test(html)) return [];
  // (a custom element is the only thing an output can be bound on)
  if (!/<[a-z][\w.]*-/i.test(html)) return [];
  const blocks = parseLoadedScriptBlocks(html, stateTagName)
    .filter((block) => ASSIGNS_TRUE.test(block.content) && hasDefaultExportObject(block.content));
  if (blocks.length === 0) return [];
  const members = documentMemberBindings(html, bindAttribute, fileReader);
  // the paths an output-only member is bound to (the first binding of each)
  const outputs = new Map<string, MemberBinding>();
  for (const member of members) {
    // (a row's path — `items.*.on` — is another matter: which row a script writes is not read here)
    if (member.role === 'output' && !member.path.includes('*') && !outputs.has(member.path)) outputs.set(member.path, member);
  }
  if (outputs.size === 0) return [];

  // the assignments of `true` to such a path
  const writes: { block: (typeof blocks)[number]; path: string; local: string; start: number; end: number }[] = [];
  for (const block of blocks) {
    const prefix = block.mountPath === null || block.mountPath === '' ? '' : `${block.mountPath}.`;
    for (const body of stateBodies(block.content, block.mountPath === null)) {
      if (!ASSIGNS_TRUE.test(body.text)) continue;
      for (const read of collectGetterReads(body.text, { ...body.options, writes: true }) ?? []) {
        // the state's own path set to the literal `true` (`this.a.b = true` is not a state write: wcs/nested-assign)
        if (read.form !== 'write' || read.assignsTrue !== true || read.chain === null || read.chain.length !== 1) continue;
        if (!outputs.has(prefix + read.path)) continue;
        writes.push({ block, path: prefix + read.path, local: read.path, start: body.start + read.start, end: body.start + read.end });
      }
    }
  }
  if (writes.length === 0) return [];

  const msgs = getMessages(locale);
  const lookup = createContractLookup(html, fileReader);
  const taken = takenPaths(html, bindAttribute, members, lookup);
  const accessors = new Map<(typeof blocks)[number], ReadonlySet<string>>();
  const out: WcsDiagnostic[] = [];
  for (const write of writes) {
    if (taken(write.path)) continue;
    // (a path the state declares an accessor for: its setter may be what asks the element)
    let computed = accessors.get(write.block);
    if (computed === undefined) {
      computed = new Set(analyzeStatePaths(write.block.content).filter((p) => p.kind === 'computed').map((p) => p.path));
      accessors.set(write.block, computed);
    }
    if (computed.has(write.local)) continue;
    const binding = outputs.get(write.path)!;
    out.push({
      code: WcsDiagnosticCode.OutputPathWritten,
      start: write.block.contentStart + write.start,
      end: write.block.contentStart + write.end,
      severity: 'warning',
      tag: binding.tag,
      member: binding.member,
      statePath: write.path,
      message: msgs.outputPathWritten(write.path, binding.tag, binding.member, lookup(binding.tag)?.commands ?? []),
    });
  }
  return out;
}

/**
 * Whether a path is bound to something that takes a value from the state as its own — what a script's write of
 * `true` may be meant for:
 *   - an input or two-way member of a custom element (`trigger: flag`, `active: flag` on `<wcs-wakelock>`; a spread's
 *     input members too)
 *   - a native two-way binding — `value:` / `checked:` / `radio:` / `checkbox:` that writes back (bindingValidator's
 *     `writesBack`: not with `#ro`): the script sets what the user sets
 *   - a member of a custom element the lint has no declaration of (`<their-el data-wcs="active: flag">`, the router's
 *     tags): it may be an input. A spread on such an element covers the paths one step under its own
 * A binding that only shows the path (`class.`, `attr.`, `style.`, `textContent:`, `hidden:`, a structural `if:`,
 * a `{{ }}`) takes nothing as its own: the page says what the flag says. Not in a `data-wcs-ignore` element.
 */
function takenPaths(
  html: string,
  bindAttribute: string,
  members: readonly MemberBinding[],
  lookup: ContractLookup,
): (path: string) => boolean {
  const taken = new Set<string>();
  const unknownSpreads: string[] = [];
  for (const member of members) if (member.role !== 'output') taken.add(member.path);
  const ignored = findIgnoredRanges(html, bindAttribute);
  for (const attr of findAllBindAttributes(html, bindAttribute)) {
    const custom = attr.tagName !== undefined && attr.tagName.includes('-');
    // (an element whose declaration the lint has: its members are in `members`)
    if (custom && lookup(attr.tagName) !== null) continue;
    if (ignored.some(([start, end]) => attr.valueStart >= start && attr.valueStart < end)) continue;
    for (const binding of parseBindTextWithPositions(attr.value)) {
      const parsed = binding.parsed;
      // (a row's relative path is another list's rows: the paths looked up here have no `*`)
      if (parsed === null || parsed.statePathName.startsWith('.')) continue;
      const path = parsed.statePathName;
      if (custom) {
        if (parsed.bindingType === 'spread') unknownSpreads.push(path);
        else if (parsed.bindingType === 'prop' && parsed.propSegments.length === 1) taken.add(path);
      } else if (parsed.bindingType === 'radio' || parsed.bindingType === 'checkbox' || parsed.bindingType === 'prop') {
        if (writesBack(attr, parsed.propName, `${parsed.propName}#${parsed.propModifiers.join(',')}`)) taken.add(path);
      }
    }
  }
  return (path) => taken.has(path)
    || unknownSpreads.some((spread) => path.startsWith(`${spread}.`) && !path.slice(spread.length + 1).includes('.'));
}

/**
 * The bodies of a state script that write the state when they run: its methods and setters (`this`), and — for a root
 * state; a volume's are not run — its `$watch` handlers (`this`) and its `$on` handlers (their first parameter).
 */
function stateBodies(script: string, root: boolean): StateBody[] {
  const out: StateBody[] = [];
  for (const callable of analyzeCallableBodies(script)) {
    // (a getter that writes throws on every evaluation: wcs/getter-write)
    if (callable.kind === 'getter' && callable.accessor !== 'set') continue;
    // (an accessor declared for several paths has one body: read at the first of them)
    if (callable.listed !== undefined && callable.listed.paths[0] !== callable.name) continue;
    out.push({ text: callable.body, start: callable.bodyStart, options: { row: accessorRow(callable) } });
  }
  if (!root) return out;
  for (const handler of analyzeWatchHandlerSources(script)) {
    // (`$watch` binds `this` for a method or a `function` — an arrow function's `this` is the module's)
    const body = handler.kind === 'body' ? { text: handler.text, start: handler.start, param: null } : functionBody(handler, false);
    if (body !== null) out.push({ text: body.text, start: body.start, options: {} });
  }
  for (const handler of analyzeOnHandlerSources(script)) {
    const body = handler.kind === 'body'
      ? { text: handler.text, start: handler.start, param: onHandlerStateParam(script, handler) }
      : functionBody(handler, true);
    if (body !== null && body.param !== null) out.push({ text: body.text, start: body.start, options: { stateParam: body.param } });
  }
  return out;
}

// (a TypeScript return type may stand before the body: `function (cur: number): void {`, `(state: S): void => {`)
const FUNCTION_HEAD = /^\s*(?:async\s+)?function\b[^(]*\(\s*([A-Za-z_$][\w$]*)?[^()]*\)\s*(?::[^{}=;]*)?\{/;
const ARROW_HEAD = /^\s*(?:async\s+)?(?:\(\s*([A-Za-z_$][\w$]*)?[^()]*\)\s*(?::[^{}=;]*)?|([A-Za-z_$][\w$]*)\s*)=>\s*\{/;

/**
 * The block body of a handler written as a value (`name: function (state) { … }`, `name: (state) => { … }`), with its
 * first parameter's name. Null for anything else (a name, an arrow function returning an expression), and for an
 * arrow function when `arrows` is false.
 */
function functionBody(handler: WatchHandlerSource, arrows: boolean): { text: string; start: number; param: string | null } | null {
  // (matched on the mirror: a `{` or a `)` inside a string or a comment is not the function's)
  const scan = maskCommentsAndStrings(handler.text);
  const head = FUNCTION_HEAD.exec(scan) ?? (arrows ? ARROW_HEAD.exec(scan) : null);
  const close = scan.trimEnd().length - 1;
  if (head === null || scan[close] !== '}') return null;
  const open = head[0].length;
  return { text: handler.text.slice(open, close), start: handler.start + open, param: head[1] ?? head[2] ?? null };
}
