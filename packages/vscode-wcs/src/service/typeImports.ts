/**
 * typeImports.ts — the types a state's JSDoc names in another module: `import("./api.ts").Reservation`.
 *
 * A team writing TypeScript keeps its API's types in one file (`shared/api.ts`) and types an inline state's keys
 * with them: `/** @type {import("./api.ts").Reservation[]} *\/ list: []`, `@returns` on a getter, a `@typedef` that
 * names one. The lint read none of it: the type did not parse, the rows had no fields, and every field bound under
 * them was a false `wcs/binding-path-missing` (the lending-desk seam app). This reads such a type where it is:
 *   - the module is read through the page's reader, relative to the module whose JSDoc names it (a `.js` specifier
 *     reads the `.ts`, then the `.d.ts`; one without an extension `.ts`, `.d.ts`, `.js`, then `/index.*`);
 *   - `Name` is a top-level `interface Name { … }` (with `extends`) or `type Name = …` of that file, exported or not, or
 *     a JSDoc `@typedef {…} Name` (a `.js`) — or an `import type` / `export … from` of it, followed to its module;
 *   - the names in its members are resolved the same way, in the file they are written in (`status: Status`), and a
 *     name read nowhere (a type parameter `T`, a namespace member, a global the lint does not know) is open: the paths
 *     under it are not reported missing.
 * The result goes into the typedefs under the name the JSDoc parser gives the type (jsdocType's `importTypeName`). A type
 * it cannot read — a file it cannot read, a name the file does not declare — keeps that name, and the analyzer leaves
 * the paths under it unchecked, said once (`wcs/path-dynamic-unknown`): unknown, not missing.
 *
 * pure (DOM / vscode 非依存): files come through the reader.
 */

import {
  collectJsDocTypedefs,
  findJsDocComments,
  importTypeName,
  isImportTypeName,
  parseJsDocType,
  type JsDocType,
  type JsDocTypedefs,
} from './jsdocType.js';
import { joinModulePath, type ModuleFileReader, type ModuleLocation } from './moduleValues.js';
import { maskCommentsAndStrings } from './stateAnalyzer.js';

/** `import("spec").Name` in a JSDoc type (the specifier in either quote; `Name` may be dotted). */
const IMPORT_TYPE = /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)\s*\.\s*([$A-Za-z_][$\w]*(?:\s*\.\s*[$A-Za-z_][$\w]*)*)/g;

/** The names that stay as they are (a value with no paths under it, or one the shape reader knows). */
const LEAF_NAMES: ReadonlySet<string> = new Set([
  'string', 'number', 'boolean', 'null', 'undefined', 'bigint', 'symbol', 'void', 'never',
  'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Function', 'Array', 'ReadonlyArray',
]);

/** An open object: any key below (the paths under it are not reported missing). */
const OPEN: JsDocType = { kind: 'object', fields: [], index: { kind: 'unknown' } };

/** A TypeScript declaration is read as one (method signatures skipped). */
const TS = { typescript: true } as const;

/** How deep one resolution goes (types naming types). */
const MAX_DEPTH = 12;

/** One module as this reads it: its type declarations and where its imported names come from. */
interface TypeModule {
  readonly path: string;
  readonly declarations: ReadonlyMap<string, JsDocType>;
  readonly imports: ReadonlyMap<string, { readonly specifier: string; readonly name: string }>;
  readonly stars: readonly string[];
}

const modulesByReader = new WeakMap<ModuleFileReader, Map<string, TypeModule | null>>();

/**
 * The types the script's JSDoc names in other modules (`import("./api.ts").Reservation`), resolved: name → type, under
 * the name jsdocType's parser reads them as. Only those it could read are in it.
 */
export function resolveImportedTypes(script: string, location: ModuleLocation | undefined): Map<string, JsDocType> {
  const out = new Map<string, JsDocType>();
  if (location === undefined || !script.includes('import')) return out;
  const scan = maskCommentsAndStrings(script);
  for (const comment of findJsDocComments(script, scan)) {
    for (const m of comment.text.matchAll(IMPORT_TYPE)) {
      const specifier = m[2];
      const name = m[3].replace(/\s+/g, '');
      const key = importTypeName(specifier, name);
      if (out.has(key)) continue;
      const target = readTypeModule(location.fileReader, location.path, specifier);
      const type = target === null ? null : resolveInModule(location.fileReader, target, name, 0, new Set());
      if (type !== null) out.set(key, type);
    }
  }
  return out;
}

/** The module a specifier names from the module at `from` (both as the page's reader takes them), or null. */
function readTypeModule(reader: ModuleFileReader, from: string, specifier: string): TypeModule | null {
  const joined = joinModulePath(from, specifier);
  if (joined === undefined) return null;
  const candidates = /\.(?:d\.)?m?ts$/.test(joined)
    ? [joined]
    : /\.m?jsx?$/.test(joined)
    ? [joined.replace(/\.(m?)jsx?$/, '.$1ts'), joined.replace(/\.(m?)jsx?$/, '.d.$1ts'), joined]
    : [`${joined}.ts`, `${joined}.d.ts`, `${joined}.js`, `${joined}/index.ts`, `${joined}/index.d.ts`, `${joined}/index.js`];
  let files = modulesByReader.get(reader);
  if (files === undefined) modulesByReader.set(reader, (files = new Map()));
  for (const path of candidates) {
    if (files.has(path)) {
      const known = files.get(path) as TypeModule | null;
      if (known !== null) return known;
      continue;
    }
    const text = reader(path);
    const module = text === undefined ? null : readDeclarations(path, text);
    files.set(path, module);
    if (module !== null) return module;
  }
  return null;
}

/** The type `name` has in `module` (a declaration, or an import of it), its names resolved; null when not found. */
function resolveInModule(
  reader: ModuleFileReader,
  module: TypeModule,
  name: string,
  depth: number,
  visiting: ReadonlySet<string>,
): JsDocType | null {
  const key = `${module.path}#${name}`;
  // a type naming itself (a tree) is open from the second level: what is under it is not read further
  if (visiting.has(key) || depth > MAX_DEPTH) return OPEN;
  const inner = new Set([...visiting, key]);
  const declared = module.declarations.get(name);
  if (declared !== undefined) return substitute(reader, module, declared, depth + 1, inner);
  const head = name.split('.')[0];
  const imported = module.imports.get(head);
  if (imported !== undefined) {
    const target = readTypeModule(reader, module.path, imported.specifier);
    const rest = name.slice(head.length);
    return target === null ? null : resolveInModule(reader, target, imported.name + rest, depth + 1, inner);
  }
  for (const specifier of module.stars) {
    const target = readTypeModule(reader, module.path, specifier);
    const found = target === null ? null : resolveInModule(reader, target, name, depth + 1, inner);
    if (found !== null) return found;
  }
  return null;
}

/** `type` with the names in it resolved in `module` (a name read nowhere is open; a leaf name stays). */
function substitute(
  reader: ModuleFileReader,
  module: TypeModule,
  type: JsDocType,
  depth: number,
  visiting: ReadonlySet<string>,
): JsDocType {
  switch (type.kind) {
    case 'name': {
      if (LEAF_NAMES.has(type.name)) return type;
      if (isImportTypeName(type.name)) {
        const m = /^import\("([^"]*)"\)\.(.+)$/.exec(type.name) as RegExpExecArray;
        const target = readTypeModule(reader, module.path, m[1]);
        return (target === null ? null : resolveInModule(reader, target, m[2], depth, visiting)) ?? type;
      }
      return resolveInModule(reader, module, type.name, depth, visiting) ?? OPEN;
    }
    case 'object':
      return {
        kind: 'object',
        fields: type.fields.map((f) => ({ name: f.name, type: substitute(reader, module, f.type, depth, visiting) })),
        ...(type.index !== undefined ? { index: substitute(reader, module, type.index, depth, visiting) } : {}),
      };
    case 'array':
      return { kind: 'array', element: substitute(reader, module, type.element, depth, visiting) };
    case 'union':
      return { kind: 'union', members: type.members.map((m) => substitute(reader, module, m, depth, visiting)) };
    case 'unknown':
      // a shape the parser does not read (a generic it does not know, a function, a conditional): open below
      return OPEN;
    default:
      return type;
  }
}

/** A head of a declaration at the top level: `interface Name`, `type Name =`. */
const DECLARATION_HEAD = /(?:^|[\n;{}])[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(interface|type)[ \t]+([$A-Za-z_][$\w]*)/g;

/** Reads a module's top-level type declarations, its `@typedef`s, and its imports and re-exports of types. */
function readDeclarations(path: string, source: string): TypeModule {
  const scan = maskCommentsAndStrings(source);
  // the declarations' text without its comments (a member's doc comment is not part of its type); strings kept
  const blanked = blankComments(source, scan);
  // only what is at the top level (brace depth 0 of the mirror)
  const depthAt = braceDepths(scan);
  const declarations = new Map<string, JsDocType>();
  for (const [name, type] of source.includes('@typedef') ? collectJsDocTypedefs(source, scan) : new Map<string, JsDocType>()) {
    declarations.set(name, type);
  }
  DECLARATION_HEAD.lastIndex = 0;
  for (const m of scan.matchAll(DECLARATION_HEAD)) {
    const at = (m.index as number) + m[0].length;
    if (depthAt[at] !== 0) continue;
    const name = m[2];
    let i = skipTypeParameters(scan, at);
    if (m[1] === 'interface') {
      // `interface A extends B, C<D> { … }`: the bases' members join A's
      const open = scan.indexOf('{', i);
      if (open < 0) continue;
      const bases = /^\s*extends\s+([\s\S]*)$/.exec(scan.slice(i, open))?.[1];
      const body = parseJsDocType(`{${blanked.slice(open + 1, matchClose(scan, open))}}`, TS);
      if (body === null) continue;
      const parents = bases === undefined ? [] : splitBases(bases).map((b) => parseJsDocType(b, TS) ?? OPEN);
      declarations.set(name, parents.length === 0 ? body : { kind: 'union', members: [...parents, body] });
    } else {
      const eq = /^\s*=/.exec(scan.slice(i));
      if (eq === null) continue;
      i += eq[0].length;
      const end = typeAliasEnd(scan, i);
      const type = parseJsDocType(blanked.slice(i, end).trim(), TS);
      if (type !== null) declarations.set(name, type);
    }
  }
  const { imports, stars } = readTypeImports(source, scan, depthAt);
  return { path, declarations, imports, stars };
}

/** `source` with its comments blanked (found on the mirror, where a string's content cannot look like one). */
function blankComments(source: string, scan: string): string {
  let out = '';
  let from = 0;
  for (const m of scan.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)) {
    const at = m.index as number;
    out += source.slice(from, at) + m[0].replace(/[^\n]/g, ' ');
    from = at + m[0].length;
  }
  return out + source.slice(from);
}

/** The brace depth of the mirror before each offset. */
function braceDepths(scan: string): number[] {
  const out = new Array<number>(scan.length + 1);
  let depth = 0;
  for (let i = 0; i < scan.length; i++) {
    out[i] = depth;
    if (scan[i] === '{') depth++;
    else if (scan[i] === '}') depth = Math.max(0, depth - 1);
  }
  out[scan.length] = depth;
  return out;
}

/** Past a type parameter list (`<T extends X = Y>`) at `at`, if there is one. */
function skipTypeParameters(scan: string, at: number): number {
  let i = at;
  while (/\s/.test(scan[i] ?? '')) i++;
  if (scan[i] !== '<') return at;
  let depth = 0;
  for (; i < scan.length; i++) {
    if (scan[i] === '<') depth++;
    else if (scan[i] === '>' && scan[i - 1] !== '=' && --depth === 0) return i + 1;
  }
  return at;
}

/** The offset of the `}` closing the `{` at `open`, or the end. */
function matchClose(scan: string, open: number): number {
  let depth = 0;
  for (let i = open; i < scan.length; i++) {
    if (scan[i] === '{') depth++;
    else if (scan[i] === '}' && --depth === 0) return i;
  }
  return scan.length;
}

/** `B, C<D, E>` → `B`, `C<D, E>` (split at the commas outside `<…>`). */
function splitBases(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '<' || text[i] === '(' || text[i] === '{' || text[i] === '[') depth++;
    else if ((text[i] === '>' && text[i - 1] !== '=') || text[i] === ')' || text[i] === '}' || text[i] === ']') depth--;
    else if (text[i] === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.filter((b) => b !== '');
}

/**
 * Where a type alias's type ends (from just after `=`): a `;` at depth 0, or a line break at depth 0 that the type does
 * not go on from (the line ends with an operator, or the next line starts with `|` / `&` / `?` / `:` / `.`).
 */
function typeAliasEnd(scan: string, start: number): number {
  let depth = 0;
  for (let i = start; i < scan.length; i++) {
    const ch = scan[i];
    if (ch === '=' && scan[i + 1] === '>') {
      i++;
    } else if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
      depth--;
    } else if (depth === 0 && ch === ';') {
      return i;
    } else if (depth === 0 && ch === '\n') {
      const before = scan.slice(start, i).trim();
      const after = scan.slice(i + 1).trimStart();
      if (before === '' || /[|&=,?:]$/.test(before) || /^[|&?:.]/.test(after)) continue;
      return i;
    }
  }
  return scan.length;
}

/**
 * The type names a module brings in from elsewhere — `import type { A, B as C } from "…"`, `import { type A } from`,
 * `export type { A } from`, `export { A } from` — by local name, and its `export * from "…"` specifiers.
 */
function readTypeImports(
  text: string,
  scan: string,
  depthAt: readonly number[],
): { imports: Map<string, { specifier: string; name: string }>; stars: string[] } {
  const imports = new Map<string, { specifier: string; name: string }>();
  const stars: string[] = [];
  const re = /\b(import|export)\s+(?:type\s+)?(\{[^}]*\}|\*)\s*from\s*(["'])/g;
  for (const m of scan.matchAll(re)) {
    const at = m.index as number;
    if (depthAt[at] !== 0) continue;
    const quoteAt = at + m[0].length - 1;
    const close = scan.indexOf(m[3], quoteAt + 1);
    if (close < 0) continue;
    const specifier = text.slice(quoteAt + 1, close);
    if (m[2] === '*') {
      if (m[1] === 'export') stars.push(specifier);
      continue;
    }
    for (const part of m[2].slice(1, -1).split(',')) {
      const spec = /^\s*(?:type\s+)?([$A-Za-z_][$\w]*)(?:\s+as\s+([$A-Za-z_][$\w]*))?\s*$/.exec(part);
      if (spec === null) continue;
      imports.set(spec[2] ?? spec[1], { specifier, name: spec[1] });
    }
  }
  return { imports, stars };
}

/** The typedefs of a script with the types it names in other modules (resolveImportedTypes) added. */
export function withImportedTypes(typedefs: JsDocTypedefs, script: string, location: ModuleLocation | undefined): JsDocTypedefs {
  const imported = resolveImportedTypes(script, location);
  if (imported.size === 0) return typedefs;
  return new Map([...typedefs, ...imported]);
}
