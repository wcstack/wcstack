/**
 * moduleValues.ts — the value a name in a state's module is bound to, following its imports.
 *
 * A state written `export default { lang, t }` takes its keys' values from names: a constant of the module
 * (`const ITEMS = [ … ]`) or an import (`import { lang, t } from "./catalog.js"` — the dictionary volume the state
 * README and examples/router-i18n recommend, `<wcs-state mount="i18n" src="./i18n/state.js">`). The analyzer read none
 * of them: a shorthand key was not a key at all, and `key: NAME` had no shape, so every path under it was a false
 * `wcs/binding-path-missing` (the city-library seam app: 103 of its 108 warnings). This follows a name to the
 * expression it is bound to:
 *   - a `const` of the module (`const t = { … }`, `export const t = …`) — another name in turn;
 *   - an import from a relative path (`./`, `../`; `/…` where the reader resolves it — `wcs-validate --root`): the
 *     module is read through the page's file reader, relative to the module that imports it (a `.js` that is not there
 *     reads the same-named `.ts`), and the export looked up — `export const`, `export default`, `export { a as b }`,
 *     `export { a } from "…"`, `export * from "…"`;
 *   - a JSDoc `@type {typeof import("./en.js").default}` before the declaration names the value it stands for: the way
 *     to give a computed dictionary (`mergeAndFreeze(fallback, current)`) the full catalog's shape.
 * What it cannot follow — a call or another computed expression, a `let` / `var`, a namespace import, a bare specifier
 * or a URL, a module it cannot read or parse (TypeScript) — is null, and the caller treats the key's contents as
 * unknown (statePathResolver's opaque paths): nothing under it is reported missing.
 *
 * pure (acorn; the files come through the reader).
 */

import { parse, type AnyNode } from 'acorn';
import { readJsDocTypeBefore } from './jsdocType.js';

/** Reads a file by the path the page's reader takes (relative to the page). undefined when it cannot. */
export type ModuleFileReader = (path: string) => string | undefined;

/** Where a module is: the page's reader, and the module's path as that reader takes it ('' for a script in the page). */
export interface ModuleLocation {
  readonly fileReader: ModuleFileReader;
  readonly path: string;
}

/** An expression a name is bound to, and the module it is written in (its own names resolve there). */
export interface ResolvedValue {
  readonly text: string;
  readonly scope: ModuleScope;
}

/** How many names / imports one resolution follows at most (a cycle, or a chain of re-exports). */
const MAX_HOPS = 16;

/** `typeof import("./en.js").default` / `typeof import("./catalog.js").t` (a JSDoc type naming a value). */
const TYPE_IMPORT = /^typeof\s+import\s*\(\s*(["'])([^"']+)\1\s*\)\s*\.\s*([$A-Za-z_][$\w]*)\s*$/;

/** A JSDoc `@type` that names a module's value: its specifier and export, or null. */
export function parseTypeImport(type: string | undefined): { readonly specifier: string; readonly name: string } | null {
  const m = type === undefined ? null : TYPE_IMPORT.exec(type.trim());
  return m === null ? null : { specifier: m[2], name: m[3] };
}

// parsed programs by text (the same state script is analyzed by many validators)
const programs = new Map<string, AnyNode | null>();
const MAX_PROGRAMS = 64;

function parseModule(text: string): AnyNode | null {
  if (programs.has(text)) return programs.get(text) as AnyNode | null;
  let program: AnyNode | null;
  try {
    program = parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, allowAwaitOutsideFunction: true });
  } catch {
    program = null;
  }
  if (programs.size >= MAX_PROGRAMS) programs.delete(programs.keys().next().value as string);
  programs.set(text, program);
  return program;
}

// module scopes by reader and path (a module several states import is read once per page)
const filesByReader = new WeakMap<ModuleFileReader, Map<string, ModuleScope | null>>();

/** One module's top-level names. */
export class ModuleScope {
  constructor(
    /** The module's text. */
    readonly text: string,
    /** Where it is; undefined when no file can be read (its imports are not followed). */
    readonly location: ModuleLocation | undefined,
  ) {}

  private get body(): readonly AnyNode[] {
    const program = parseModule(this.text);
    return program !== null && program.type === 'Program' ? program.body as AnyNode[] : [];
  }

  /** The specifier a top-level name is imported from, if it is imported. */
  importOf(name: string): string | undefined {
    for (const statement of this.body) {
      if (statement.type !== 'ImportDeclaration') continue;
      if (statement.specifiers.some((s) => s.local.name === name)) return String(statement.source.value);
    }
    return undefined;
  }

  /** The value a top-level name of the module is bound to, or null when it cannot be followed. */
  resolveName(name: string, hops = 0): ResolvedValue | null {
    if (hops > MAX_HOPS) return null;
    for (const statement of this.body) {
      if (statement.type === 'ImportDeclaration') {
        const specifier = statement.specifiers.find((s) => s.local.name === name);
        if (specifier === undefined) continue;
        // `import * as en from "./en.js"`: the module itself, not a value this reads
        if (specifier.type === 'ImportNamespaceSpecifier') return null;
        const exported = specifier.type === 'ImportDefaultSpecifier' ? 'default' : exportName(specifier.imported);
        return this.module(String(statement.source.value))?.resolveExport(exported, hops + 1) ?? null;
      }
      const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
      if (declaration === null || declaration === undefined || declaration.type !== 'VariableDeclaration') continue;
      for (const declarator of declaration.declarations) {
        if (declarator.id.type !== 'Identifier' || declarator.id.name !== name) continue;
        // a `let` / `var` may be reassigned before the state reads it
        if (declaration.kind !== 'const') return null;
        return this.declared(statement.start, declarator.init ?? null, hops);
      }
    }
    return null;
  }

  /** The value a module exports under `name` ('default' for the default export), or null. */
  resolveExport(name: string, hops = 0): ResolvedValue | null {
    if (hops > MAX_HOPS) return null;
    const stars: string[] = [];
    for (const statement of this.body) {
      if (statement.type === 'ExportDefaultDeclaration') {
        if (name !== 'default') continue;
        const value = statement.declaration;
        if (value.type === 'FunctionDeclaration' || value.type === 'ClassDeclaration') return null;
        return this.declared(statement.start, value, hops);
      }
      if (statement.type === 'ExportAllDeclaration') {
        if (statement.exported === null || statement.exported === undefined) stars.push(String(statement.source.value));
        continue;
      }
      if (statement.type !== 'ExportNamedDeclaration') continue;
      const declaration = statement.declaration;
      if (declaration !== null && declaration !== undefined) {
        if (declaration.type === 'VariableDeclaration'
          && declaration.declarations.some((d) => d.id.type === 'Identifier' && d.id.name === name)) {
          return this.resolveName(name, hops + 1);
        }
        continue;
      }
      for (const specifier of statement.specifiers) {
        if (exportName(specifier.exported) !== name) continue;
        const local = exportName(specifier.local);
        return statement.source === null || statement.source === undefined
          ? this.resolveName(local, hops + 1)
          : this.module(String(statement.source.value))?.resolveExport(local, hops + 1) ?? null;
      }
    }
    // `export * from "./more.js"` brings in its named exports (never the default)
    if (name !== 'default') {
      for (const specifier of stars) {
        const found = this.module(specifier)?.resolveExport(name, hops + 1) ?? null;
        if (found !== null) return found;
      }
    }
    return null;
  }

  /** The value a JSDoc `typeof import("…").name` names, read from that module. */
  resolveTypeImport(type: { readonly specifier: string; readonly name: string }, hops = 0): ResolvedValue | null {
    return this.module(type.specifier)?.resolveExport(type.name, hops + 1) ?? null;
  }

  /** A declaration's value: a JSDoc `typeof import(…)` before it wins, a name is followed, anything else is the text. */
  private declared(statementStart: number, value: AnyNode | null, hops: number): ResolvedValue | null {
    const type = parseTypeImport(readJsDocTypeBefore(this.text, statementStart));
    if (type !== null) return this.resolveTypeImport(type, hops);
    if (value === null) return null;
    if (value.type === 'Identifier') return this.resolveName(value.name, hops + 1);
    return { text: this.text.slice(value.start, value.end), scope: this };
  }

  /** The module a specifier names, relative to this one (null when it cannot be read or is not relative). */
  module(specifier: string): ModuleScope | null {
    const location = this.location;
    if (location === undefined) return null;
    const path = joinModulePath(location.path, specifier);
    if (path === undefined) return null;
    let files = filesByReader.get(location.fileReader);
    if (files === undefined) filesByReader.set(location.fileReader, (files = new Map()));
    if (files.has(path)) return files.get(path) as ModuleScope | null;
    const text = location.fileReader(path) ?? (path.endsWith('.js') ? location.fileReader(path.replace(/\.js$/, '.ts')) : undefined);
    const scope = text === undefined ? null : new ModuleScope(text, { fileReader: location.fileReader, path });
    files.set(path, scope);
    return scope;
  }
}

function exportName(node: AnyNode): string {
  return node.type === 'Identifier' ? node.name : String((node as AnyNode & { value: unknown }).value);
}

/**
 * The path of the module `specifier` names, as the page's reader takes it, from the module at `from` (relative to the
 * page; '' for the page itself). A path from `/` goes to the reader as it is (it reads one only when told where the
 * site's root is). A bare specifier or a URL is undefined: an import map or the network decides it, not a file.
 */
export function joinModulePath(from: string, specifier: string): string | undefined {
  const bare = specifier.replace(/[?#].*$/, '');
  if (bare.startsWith('/')) return bare.startsWith('//') ? undefined : bare;
  if (!bare.startsWith('./') && !bare.startsWith('../')) return undefined;
  const slash = from.lastIndexOf('/');
  const out = slash === -1 ? [] : from.slice(0, slash).split('/');
  for (const segment of bare.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment !== '..') {
      out.push(segment);
    } else if (out.length > 0 && out[out.length - 1] !== '..') {
      // the root of a path from `/` stays
      if (!(out.length === 1 && out[0] === '')) out.pop();
    } else {
      out.push('..');
    }
  }
  return out.join('/');
}
