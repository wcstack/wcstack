/**
 * pageElements.ts
 *
 * The wc-bindable contracts of the custom elements a page defines itself: `customElements.define("tag", Class)`
 * in its scripts — inline, an `src=` module, and the modules those import by a relative path. A 7GUIs evaluation
 * found the lint silent on a typo in such an element's `eventToken.` / `command.` names (the runtime fails the
 * initialization with #1204 / #1203, and names no near member). The built-in `wcs-*` tags have their catalog
 * (generated/builtinTags.generated.ts); these contracts are read the same way the runtime reads one, from the
 * class's `static wcBindable`.
 *
 * A contract is read only when it is certain: a `static wcBindable = { … }` object literal (or a static getter
 * returning one) whose `properties` / `inputs` / `commands` are literal lists of `{ name: "…" }`. A class without
 * one inherits its superclass's when that class is defined in the page's scripts too. Anything else — a computed
 * declaration, a spread, a superclass from elsewhere, a script that does not parse — gives no contract, and the
 * element's bindings are not checked.
 *
 * pure (DOM / vscode 非依存): files come through the `FileReader`.
 */

import { parse, type AnyNode } from 'acorn';
import { extractAttribute } from '../language/htmlParse.js';
import type { FileReader } from './statePathResolver.js';

/** A page element's members, in the shape of a built-in tag's contract (ioNodeValidator). */
export interface PageElementContract {
  readonly properties: readonly string[];
  readonly inputs: Readonly<Record<string, null>>;
  readonly commands: readonly string[];
}

/** What a class says of its `static wcBindable`: a contract, none (look at the superclass), or unknown. */
type Declared = PageElementContract | 'none' | 'unknown';

interface ClassInfo {
  readonly declared: Declared;
  /** The superclass's name, when it is a plain identifier. */
  readonly superName: string | null;
}

/** At most this many module files are read for one page (a guard against a large import graph). */
const MAX_FILES = 32;

const JS_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'text/ecmascript']);

/** The scripts of the page: inline sources, and the `src=` paths (relative to the HTML file). */
function pageScripts(html: string): { inline: string[]; srcs: string[] } {
  const inline: string[] = [];
  const srcs: string[] = [];
  const re = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;
  // (comments are not markup: a script inside one is not loaded)
  const text = html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1];
    const type = (extractAttribute(attrs, 'type') ?? '').trim().toLowerCase();
    if (!JS_TYPES.has(type)) continue;
    const src = extractAttribute(attrs, 'src');
    if (src !== null) srcs.push(src);
    else if (m[2].trim() !== '') inline.push(m[2]);
  }
  return { inline, srcs };
}

/** `spec` from the module at `from` (both relative to the HTML file's directory), normalized; null when not relative. */
function joinRelative(from: string, spec: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
  const out: string[] = [];
  for (const seg of `${dir}${spec}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else out.push(seg);
  }
  return `./${out.join('/')}`;
}

function parseScript(source: string): AnyNode | null {
  for (const sourceType of ['module', 'script'] as const) {
    try {
      return parse(source, { ecmaVersion: 'latest', sourceType, allowHashBang: true }) as AnyNode;
    } catch {
      // (a classic script that is not a module, or one that does not parse)
    }
  }
  return null;
}

/** Every node under `node`, depth first. */
function* nodes(node: AnyNode): Generator<AnyNode> {
  yield node;
  for (const value of Object.values(node as unknown as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const v of value) if (v !== null && typeof v === 'object' && typeof (v as AnyNode).type === 'string') yield* nodes(v as AnyNode);
    } else if (value !== null && typeof value === 'object' && typeof (value as AnyNode).type === 'string') {
      yield* nodes(value as AnyNode);
    }
  }
}

const keyName = (key: AnyNode, computed: boolean): string | null =>
  computed ? null : key.type === 'Identifier' ? key.name : key.type === 'Literal' && typeof key.value === 'string' ? key.value : null;

/** The names of a literal list of `{ name: "…" }` under `key`: undefined when the key is absent, null when unreadable. */
function names(obj: AnyNode & { type: 'ObjectExpression' }, key: string): string[] | null | undefined {
  const prop = obj.properties.find((p) => p.type === 'Property' && keyName(p.key, p.computed) === key);
  if (prop === undefined || prop.type !== 'Property') return undefined;
  if (prop.value.type !== 'ArrayExpression') return null;
  const out: string[] = [];
  for (const el of prop.value.elements) {
    if (el === null || el.type !== 'ObjectExpression' || el.properties.some((p) => p.type !== 'Property')) return null;
    const name = el.properties.find((p) => p.type === 'Property' && keyName(p.key, p.computed) === 'name');
    if (name === undefined || name.type !== 'Property' || name.value.type !== 'Literal' || typeof name.value.value !== 'string') return null;
    out.push(name.value.value);
  }
  return out;
}

function contractOf(value: AnyNode): Declared {
  if (value.type !== 'ObjectExpression' || value.properties.some((p) => p.type !== 'Property')) return 'unknown';
  const properties = names(value, 'properties');
  const inputs = names(value, 'inputs');
  const commands = names(value, 'commands');
  if (properties === null || inputs === null || commands === null) return 'unknown';
  return {
    properties: properties ?? [],
    inputs: Object.fromEntries((inputs ?? []).map((n) => [n, null])),
    commands: commands ?? [],
  };
}

/** What a class body says of its `static wcBindable` (a field, or a getter returning an object literal). */
function declaredBy(cls: AnyNode & { type: 'ClassDeclaration' | 'ClassExpression' }): ClassInfo {
  let declared: Declared = 'none';
  for (const member of cls.body.body) {
    if ((member.type !== 'PropertyDefinition' && member.type !== 'MethodDefinition') || !member.static) continue;
    if (keyName(member.key as AnyNode, member.computed) !== 'wcBindable') continue;
    if (member.type === 'PropertyDefinition') {
      declared = member.value === null || member.value === undefined ? 'unknown' : contractOf(member.value as AnyNode);
    } else {
      const body = member.kind === 'get' ? member.value.body.body : [];
      const ret = body.length === 1 && body[0].type === 'ReturnStatement' ? body[0].argument : null;
      declared = ret === null || ret === undefined ? 'unknown' : contractOf(ret as AnyNode);
    }
  }
  const sup = cls.superClass;
  return { declared, superName: sup !== null && sup !== undefined && sup.type === 'Identifier' ? sup.name : null };
}

/** `customElements.define` (also `window.` / `globalThis.` / `self.customElements.define`). */
function isDefine(callee: AnyNode): boolean {
  if (callee.type !== 'MemberExpression' || keyName(callee.property as AnyNode, callee.computed) !== 'define') return false;
  const o = callee.object;
  return (o.type === 'Identifier' && o.name === 'customElements')
    || (o.type === 'MemberExpression' && keyName(o.property as AnyNode, o.computed) === 'customElements');
}

/**
 * The contracts of the custom elements the page defines, by tag. Only elements whose contract is certain are in
 * it (see the module comment). `wcs-*` tags are the catalog's and are left out.
 */
export function collectPageElementContracts(html: string, fileReader?: FileReader): Map<string, PageElementContract> {
  const { inline, srcs } = pageScripts(html);
  const programs: AnyNode[] = [];
  const read = new Set<string>();
  const queue: { from: string; spec: string }[] = srcs.map((spec) => ({ from: '', spec: spec.startsWith('.') ? spec : `./${spec}` }));
  const visit = (program: AnyNode, from: string): void => {
    programs.push(program);
    for (const n of nodes(program)) {
      const source = n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || n.type === 'ExportNamedDeclaration'
        ? n.source
        : n.type === 'ImportExpression' ? n.source : null;
      if (source !== null && source !== undefined && source.type === 'Literal' && typeof source.value === 'string') queue.push({ from, spec: source.value });
    }
  };
  for (const source of inline) {
    const program = parseScript(source);
    if (program !== null) visit(program, '');
  }
  while (queue.length > 0 && fileReader !== undefined && read.size < MAX_FILES) {
    const { from, spec } = queue.shift()!;
    const path = joinRelative(from, spec);
    if (path === null || read.has(path) || !/\.m?js$/.test(path)) continue;
    read.add(path);
    const text = fileReader(path);
    const program = text === undefined ? null : parseScript(text);
    if (program !== null) visit(program, path);
  }

  // the classes by name (the first of a name), and the defines
  const classes = new Map<string, ClassInfo>();
  const defines: { tag: string; info: ClassInfo | string }[] = [];
  for (const program of programs) {
    for (const n of nodes(program)) {
      if (n.type === 'ClassDeclaration' && n.id !== null && !classes.has(n.id.name)) classes.set(n.id.name, declaredBy(n));
      else if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init?.type === 'ClassExpression' && !classes.has(n.id.name)) {
        classes.set(n.id.name, declaredBy(n.init));
      } else if (n.type === 'CallExpression' && isDefine(n.callee as AnyNode) && n.arguments.length >= 2) {
        const [tag, cls] = n.arguments;
        if (tag.type !== 'Literal' || typeof tag.value !== 'string') continue;
        if (cls.type === 'ClassExpression') defines.push({ tag: tag.value, info: declaredBy(cls) });
        else if (cls.type === 'Identifier') defines.push({ tag: tag.value, info: cls.name });
      }
    }
  }

  const resolve = (info: ClassInfo, depth: number): PageElementContract | null => {
    if (info.declared === 'unknown') return null;
    if (info.declared !== 'none') return info.declared;
    const sup = info.superName === null ? undefined : classes.get(info.superName);
    return sup === undefined || depth > 16 ? null : resolve(sup, depth + 1);
  };
  const out = new Map<string, PageElementContract>();
  for (const { tag, info } of defines) {
    const name = tag.toLowerCase();
    if (name.startsWith('wcs-') || out.has(name)) continue;
    const cls = typeof info === 'string' ? classes.get(info) : info;
    const contract = cls === undefined ? null : resolve(cls, 0);
    if (contract !== null) out.set(name, contract);
  }
  return out;
}

/** Whether the page might define custom elements (a cheap gate before the scripts are read). */
export function mayDefineElements(html: string): boolean {
  return /customElements|<script\b[^>]*\bsrc\s*=/i.test(html);
}

