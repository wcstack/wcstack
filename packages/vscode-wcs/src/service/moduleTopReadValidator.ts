/**
 * moduleTopReadValidator.ts — `wcs/session-read-at-module-top`: a read of `localStorage` / `sessionStorage` /
 * `document.cookie` at the top level of a module that is evaluated once.
 *
 * From the `ledger-repair` seam app (a maintainer fixing a household-budget app with ten catalogued mistakes put in):
 * the route guard read the session at its module's top level, outside the function it exports. The router evaluates a
 * `<wcs-guard-handler>`'s module once and calls the default-exported function on every navigation (router README,
 * GuardHandler), so the guard kept deciding with the session there was when the page loaded — none, before the login:
 * after logging in, every guarded page bounced back to /login, and nothing said so (docs/mistake-catalogue.md,
 * session-read-at-module-top).
 *
 * - In a `<wcs-guard-handler>`'s `<script type="module">`: **error** — the guard is the whole module, and what it read
 *   at load is what it decides with on every navigation.
 * - In a `<wcs-state>`'s module (inline, or the `src=` file core/externalState.ts inlines): **warning** — the module is
 *   evaluated once per `<wcs-state>`, so the state keeps the value from load (the shift-desk variant kept sending the
 *   first token). A key seeded from storage on purpose is possible, so not an error.
 *
 * "Top level" is what runs when the module is evaluated: its statements and the expressions in them — the
 * `export default { … }` literal's values included — but not the inside of a function (a function declaration or
 * expression, an arrow, a method, a getter or setter: they run when called, so a read there is current — except a
 * function called where it is written, `(() => …)()`) or of a class body. A read is a member of `localStorage` / `sessionStorage` (also through `window.` / `globalThis.` / `self.`) other
 * than `setItem` / `removeItem` / `clear`, and `document.cookie` (also `window.document.cookie`) other than as the
 * target of a plain `=`. A script acorn cannot parse (TypeScript) says nothing.
 *
 * pure (acorn; no DOM / vscode).
 */

import { parse, type AnyNode } from 'acorn';
import { parseLoadedScriptBlocks, parseWcsScriptBlocks, type WcsScriptBlock } from '../language/htmlParse.js';
import { getMessages } from '../core/messages.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../core/diagnostics.js';

/** The router's guard element (router's default `config.tagNames.guardHandler`). */
const GUARD_TAG = 'wcs-guard-handler';

const STORAGES = new Set(['localStorage', 'sessionStorage']);
/** The global objects a storage or `document` can be read through (`window.localStorage`). */
const GLOBALS = new Set(['window', 'globalThis', 'self']);
/** The members of a storage that write rather than read. */
const STORAGE_WRITES = new Set(['setItem', 'removeItem', 'clear']);

export function validateModuleTopReads(html: string, stateTagName: string = 'wcs-state', locale?: string): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  const check = (blocks: readonly WcsScriptBlock[], guard: boolean): void => {
    for (const block of blocks) {
      for (const read of findTopLevelReads(block.content)) {
        out.push({
          code: WcsDiagnosticCode.SessionReadAtModuleTop,
          start: block.contentStart + read.start,
          end: block.contentStart + read.end,
          message: guard ? msgs.guardReadsAtModuleTop(read.text) : msgs.stateReadsAtModuleTop(read.text),
          severity: guard ? 'error' : 'warning',
        });
      }
    }
  };
  if (html.includes(GUARD_TAG)) check(parseWcsScriptBlocks(html, GUARD_TAG), true);
  check(parseLoadedScriptBlocks(html, stateTagName), false);
  return out;
}

/** The storage and cookie reads a module makes when it is evaluated (outside every function and class body). */
export function findTopLevelReads(source: string): { start: number; end: number; text: string }[] {
  if (!/localStorage|sessionStorage|cookie/.test(source)) return [];
  let program: AnyNode;
  try {
    program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) as AnyNode;
  } catch {
    return [];
  }
  const out: { start: number; end: number; text: string }[] = [];
  const visit = (node: AnyNode, assigned: boolean): void => {
    switch (node.type) {
      // run when called (a getter, a setter and a method are function expressions under their property)
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ClassDeclaration':
      case 'ClassExpression':
        return;
      case 'AssignmentExpression':
        // `document.cookie = …` writes; `+=` reads first
        visit(node.left as AnyNode, node.operator === '=');
        visit(node.right as AnyNode, false);
        return;
      case 'CallExpression': {
        // a function called where it is written (`(() => localStorage.getItem("s"))()`) runs at the top level too
        const callee = node.callee as AnyNode;
        if (callee.type === 'FunctionExpression' || callee.type === 'ArrowFunctionExpression') {
          visit(callee.body as AnyNode, false);
          for (const arg of node.arguments) visit(arg as AnyNode, false);
          return;
        }
        break;
      }
      case 'MemberExpression': {
        const read = readOf(node, assigned, source);
        if (read !== null) {
          out.push(read);
          return;
        }
        break;
      }
      default:
        break;
    }
    for (const child of children(node)) visit(child, false);
  };
  visit(program, false);
  return out;
}

/** A storage or cookie read at `node` (a member expression), or null. */
function readOf(node: AnyNode & { type: 'MemberExpression' }, assigned: boolean, source: string): { start: number; end: number; text: string } | null {
  const object = node.object as AnyNode;
  const prop = propertyName(node);
  if (isGlobal(object, STORAGES)) {
    // (`localStorage.key = …` writes the key)
    if (assigned || (prop !== null && STORAGE_WRITES.has(prop))) return null;
    return { start: node.start, end: node.end, text: source.slice(node.start, node.end) };
  }
  if (prop === 'cookie' && !assigned && isGlobal(object, new Set(['document']))) {
    return { start: node.start, end: node.end, text: source.slice(node.start, node.end) };
  }
  return null;
}

/** `name` or `window.name` / `globalThis.name` / `self.name` for a name of `names`. */
function isGlobal(node: AnyNode, names: ReadonlySet<string>): boolean {
  if (node.type === 'Identifier') return names.has(node.name);
  if (node.type !== 'MemberExpression' || node.computed) return false;
  const object = node.object as AnyNode;
  return object.type === 'Identifier' && GLOBALS.has(object.name) && node.property.type === 'Identifier' && names.has(node.property.name);
}

function propertyName(node: AnyNode & { type: 'MemberExpression' }): string | null {
  if (!node.computed) return node.property.type === 'Identifier' ? node.property.name : null;
  return node.property.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : null;
}

function children(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  for (const value of Object.values(node as unknown as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const v of value) if (v !== null && typeof v === 'object' && typeof (v as AnyNode).type === 'string') out.push(v as AnyNode);
    } else if (value !== null && typeof value === 'object' && typeof (value as AnyNode).type === 'string') {
      out.push(value as AnyNode);
    }
  }
  return out;
}
