/**
 * componentParts.ts — the class parts a page mounts on its data (`bind-component`): what each class's state
 * declares, where its template is, and where a page mounts it.
 *
 * A class part is `class X extends HTMLElement` with `<wcs-state bind-component="state">` in its template and
 * `state = { … }` on the instance: the page hands it an object of its own data (`<x-card data-wcs="state: user">`,
 * in a row `state: .`), and the getters the state declares are readable at the mount point (`user.display`). Up to
 * 4.28 the lint read no class (the garden-plots seam app): a page that read an exported getter was told the path
 * does not exist, and `this.tenant.name = v` in a part's method — an error on a page — said nothing.
 *
 * A class is read where the page says it is:
 *   - the file the import map names for `@wcstack/autoloader` — an eager key (`"@components/x-card":
 *     "./parts/x-card.js"`: the file's default export, or what it defines for the tag), a namespace
 *     (`"@components/x/": "./parts/"` and `<x-card>` → `./parts/card.js`);
 *   - the modules the page loads (`<script type="module" src>` and what they import by a relative path) that call
 *     `customElements.define("x-card", X)`.
 * Only what is certain is read: `state = { … }` as an object literal on the class (a field, or `this.state = { … }`
 * in its constructor), with no spread and no computed key. Anything else — a file the reader cannot read, a state
 * built by a call — gives no part, and nothing is said about the tag.
 *
 * pure (DOM / vscode 非依存): files come through the `FileReader`.
 */

import type { AnyNode } from 'acorn';
import { findAllBindAttributes, parseBindingExpression, splitBindingExpressions } from './bindingValidator.js';
import { importMapOf, pagePath, scopeSource } from './dccDefinitions.js';
import { getResolvedForListPath } from './forContext.js';
import { findAllCommentBindings, findAllMustacheSyntax } from './templateSyntax.js';
import { isDefine, joinRelative, keyName, nodes, pageScripts, parseScript } from './pageElements.js';
import type { PathCandidate } from './stateAnalyzer.js';
import type { FileReader } from './statePathResolver.js';

/** A class part as far as it is read. */
export interface ClassPart {
  readonly tag: string;
  /** The file the class is in, as the page's reader takes it. */
  readonly path: string;
  /** The file's text. */
  readonly text: string;
  /** The property `<wcs-state bind-component>` names (`state` when the template is not found). */
  readonly stateName: string;
  /** The state's object literal in the file: `{` … `}`. */
  readonly stateStart: number;
  readonly stateEnd: number;
  /** The getters with a one-segment key: readable at the mount point. */
  readonly getters: readonly string[];
  /** The keys of the part's own: every one-segment key its state declares (data, accessors, methods). */
  readonly keys: readonly string[];
  /** The part's template (the string that holds its `<wcs-state bind-component>`), and where it starts in the file. */
  readonly template: { readonly html: string; readonly start: number } | null;
}

/** Where a text mounts a part: the element's bindings of the part's state property. */
export interface MountSite {
  readonly part: ClassPart;
  /** The host path of the whole-object mount (`state: user` → `user`; `state: .` in `for: users` → `users.*`); null without one, or when it cannot be told. */
  readonly whole: string | null;
  /** The keys handed beside it (`state.view: map.view` → `view`), with the host path each names (null when it cannot be told). */
  readonly handed: ReadonlyMap<string, string | null>;
  /** Where the bind attribute's value is in the text. */
  readonly valueStart: number;
  readonly valueEnd: number;
}

const MAX_FILES = 48;

interface Module {
  readonly path: string;
  readonly text: string;
  readonly program: AnyNode;
}

type ClassNode = AnyNode & { type: 'ClassDeclaration' | 'ClassExpression' };

function readModule(path: string, fileReader: FileReader, cache: Map<string, Module | null>): Module | null {
  if (cache.has(path)) return cache.get(path)!;
  const text = fileReader(path);
  const program = text === undefined ? null : parseScript(text);
  const module = text === undefined || program === null ? null : { path, text, program };
  cache.set(path, module);
  return module;
}

/** The class a name refers to in a module: a class declaration, or a variable holding a class expression. */
function classNamed(program: AnyNode, name: string): ClassNode | null {
  for (const n of nodes(program)) {
    if (n.type === 'ClassDeclaration' && n.id !== null && n.id.name === name) return n;
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === name && n.init?.type === 'ClassExpression') return n.init;
  }
  return null;
}

/** A class and the module it is written in. */
interface Found {
  readonly module: Module;
  readonly cls: ClassNode;
}

/** The module a relative import of `module` names, read (a `.js` import reads the `.ts` beside it when there is no `.js`). */
function importedModule(module: Module, spec: string, fileReader: FileReader, cache: Map<string, Module | null>): Module | null {
  const joined = spec.startsWith('/') ? spec : joinRelative(module.path, spec);
  if (joined === null || !/\.m?[jt]s$/.test(joined)) return null;
  return readModule(joined, fileReader, cache) ?? (/\.m?js$/.test(joined) ? readModule(joined.replace(/js$/, 'ts'), fileReader, cache) : null);
}

/** The default export of a module, when it is a class. */
function defaultClass(module: Module, fileReader: FileReader, cache: Map<string, Module | null>, depth: number): Found | null {
  for (const n of nodes(module.program)) {
    if (n.type !== 'ExportDefaultDeclaration') continue;
    const d = n.declaration as AnyNode;
    if (d.type === 'ClassDeclaration' || d.type === 'ClassExpression') return { module, cls: d as ClassNode };
    if (d.type === 'Identifier') return classOfName(module, d.name, fileReader, cache, depth);
  }
  return null;
}

/** The class a name refers to in a module: written there, or imported from a module beside it (its default, or a named export). */
function classOfName(module: Module, name: string, fileReader: FileReader, cache: Map<string, Module | null>, depth: number): Found | null {
  const local = classNamed(module.program, name);
  if (local !== null) return { module, cls: local };
  if (depth > 4) return null;
  for (const n of nodes(module.program)) {
    if (n.type !== 'ImportDeclaration' || n.source.type !== 'Literal' || typeof n.source.value !== 'string') continue;
    for (const specifier of n.specifiers) {
      if (specifier.local.name !== name) continue;
      const from = importedModule(module, n.source.value, fileReader, cache);
      if (from === null) return null;
      if (specifier.type === 'ImportDefaultSpecifier') return defaultClass(from, fileReader, cache, depth + 1);
      if (specifier.type === 'ImportSpecifier') {
        const imported = specifier.imported.type === 'Identifier' ? specifier.imported.name : String(specifier.imported.value);
        return imported === 'default' ? defaultClass(from, fileReader, cache, depth + 1) : classOfName(from, imported, fileReader, cache, depth + 1);
      }
      return null;
    }
  }
  return null;
}

/** The class a module gives for `tag`: what it defines for the tag, or (an import map's file) its default export. */
function classFor(module: Module, tag: string, defaultExport: boolean, fileReader: FileReader, cache: Map<string, Module | null>): Found | null {
  for (const n of nodes(module.program)) {
    if (n.type !== 'CallExpression' || !isDefine(n.callee as AnyNode) || n.arguments.length < 2) continue;
    const [name, cls] = n.arguments;
    if (name.type !== 'Literal' || typeof name.value !== 'string' || name.value.toLowerCase() !== tag) continue;
    if (cls.type === 'ClassExpression') return { module, cls };
    if (cls.type === 'Identifier') return classOfName(module, cls.name, fileReader, cache, 0);
  }
  return defaultExport ? defaultClass(module, fileReader, cache, 0) : null;
}

/** The module's strings that hold a part's template (`bind-component` in them), with where each starts. */
function templatesOf(module: Module): { html: string; start: number }[] {
  const out: { html: string; start: number }[] = [];
  for (const n of nodes(module.program)) {
    if (n.type === 'TemplateLiteral' && n.expressions.length === 0 && n.quasis.length === 1) {
      const html = n.quasis[0].value.raw;
      if (html.includes('bind-component')) out.push({ html, start: n.quasis[0].start });
    } else if (n.type === 'Literal' && typeof n.value === 'string' && n.value.includes('bind-component')) {
      out.push({ html: module.text.slice(n.start + 1, n.end - 1), start: n.start + 1 });
    }
  }
  return out;
}

/** The property a template's `<wcs-state bind-component>` names. */
function stateNameOf(html: string): string {
  const m = /<wcs-state\b[^>]*\bbind-component\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html);
  const name = (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
  return name === '' ? 'state' : name;
}

/** The object literal a class gives `name`: a field, or `this.name = { … }` in its constructor. */
function stateObjectOf(cls: ClassNode, name: string): (AnyNode & { type: 'ObjectExpression' }) | null {
  for (const member of cls.body.body) {
    if (member.type === 'PropertyDefinition' && !member.static && keyName(member.key as AnyNode, member.computed) === name) {
      return member.value?.type === 'ObjectExpression' ? member.value : null;
    }
  }
  for (const member of cls.body.body) {
    if (member.type !== 'MethodDefinition' || member.kind !== 'constructor') continue;
    for (const n of nodes(member.value.body as AnyNode)) {
      if (n.type !== 'AssignmentExpression' || n.operator !== '=' || n.left.type !== 'MemberExpression') continue;
      if (n.left.object.type !== 'ThisExpression' || keyName(n.left.property as AnyNode, n.left.computed) !== name) continue;
      return n.right.type === 'ObjectExpression' ? n.right : null;
    }
  }
  return null;
}

function partOf(tag: string, module: Module, cls: ClassNode): ClassPart | null {
  const templates = templatesOf(module);
  const template = templates.length === 1 ? templates[0] : null;
  const stateName = template === null ? 'state' : stateNameOf(template.html);
  const object = stateObjectOf(cls, stateName);
  if (object === null) return null;
  const getters: string[] = [];
  const keys: string[] = [];
  for (const property of object.properties) {
    if (property.type !== 'Property') return null;
    const key = keyName(property.key as AnyNode, property.computed);
    if (key === null) return null;
    // (a dotted key — `get "tiles.*.label"()` — is an accessor over the mounted tree, not a key of the part's own)
    if (!key.includes('.') && !keys.includes(key)) keys.push(key);
    if (property.kind === 'get' && !key.includes('.') && !key.startsWith('$') && !getters.includes(key)) getters.push(key);
  }
  return { tag, path: module.path, text: module.text, stateName, stateStart: object.start, stateEnd: object.end, getters, keys, template };
}

/** The last document read (several validators ask for the same page's parts in one run). */
let lastRead: { html: string; fileReader: FileReader | undefined; parts: ReadonlyMap<string, ClassPart> } | null = null;

/** Whether the page might mount a class part (a cheap gate before files are read). */
export function mayMountParts(html: string): boolean {
  const source = scopeSource(html);
  return /importmap|<script\b[^>]*\bsrc\s*=/i.test(source);
}

/**
 * The class parts of the custom tags a page writes, by tag — read from the import map's files and from the modules
 * the page loads. A part's own template is read for the tags it writes too (a card of tiles), so a nested part is
 * found through the same import map.
 */
export function collectClassParts(html: string, fileReader: FileReader | undefined): ReadonlyMap<string, ClassPart> {
  if (lastRead !== null && lastRead.html === html && lastRead.fileReader === fileReader) return lastRead.parts;
  const parts = new Map<string, ClassPart>();
  lastRead = { html, fileReader, parts };
  if (fileReader === undefined || !mayMountParts(html)) return parts;
  const source = scopeSource(html);
  const cache = new Map<string, Module | null>();

  // the modules the page loads, and what they import by a relative path: the tags they define
  const defined: Module[] = [];
  const queue = pageScripts(source).srcs.map((spec) => ({ from: '', spec: spec.startsWith('.') || spec.startsWith('/') ? spec : `./${spec}` }));
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < MAX_FILES) {
    const { from, spec } = queue.shift()!;
    // (a URL is not read: the network is not the lint's)
    if (/^[a-z][a-z0-9+.-]*:/i.test(spec.startsWith('./') ? spec.slice(2) : spec) || spec.startsWith('//')) continue;
    const joined = spec.startsWith('/') ? spec : joinRelative(from, spec);
    if (joined === null || !/\.m?[jt]s$/.test(joined) || seen.has(joined)) continue;
    seen.add(joined);
    const module = readModule(joined, fileReader, cache);
    if (module === null) continue;
    defined.push(module);
    for (const n of nodes(module.program)) {
      const src = n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || n.type === 'ExportNamedDeclaration' ? n.source : null;
      if (src !== null && src !== undefined && src.type === 'Literal' && typeof src.value === 'string') queue.push({ from: joined, spec: src.value });
    }
  }

  // the import map's entries for the autoloader's module loaders (a `dcc` entry is a designers' part: dccDefinitions.ts)
  const eager = new Map<string, string>();
  const namespaces: { prefix: string; path: string }[] = [];
  for (const [key, value] of importMapOf(source)) {
    if (!key.startsWith('@components/') || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) continue;
    const body = key.slice('@components/'.length);
    const namespace = body.endsWith('/');
    const bare = namespace ? body.slice(0, -1) : body;
    const bar = bare.indexOf('|');
    const name = (bar === -1 ? bare : bare.slice(0, bar)).toLowerCase();
    const loader = bar === -1 ? null : bare.slice(bar + 1).split(',')[0].trim();
    if (name === '' || (loader !== null && loader !== 'vanilla')) continue;
    if (namespace) namespaces.push({ prefix: `${name.replace(/\//g, '-')}-`, path: value });
    else if (/\.m?[jt]s$/.test(value.replace(/[?#].*$/, ''))) eager.set(name, value.replace(/[?#].*$/, ''));
  }

  const find = (tag: string): ClassPart | null => {
    for (const module of defined) {
      const found = classFor(module, tag, false, fileReader, cache);
      if (found !== null) return partOf(tag, found.module, found.cls);
    }
    const namespace = namespaces.find((n) => tag.startsWith(n.prefix) && tag.length > n.prefix.length);
    const file = eager.get(tag) ?? (namespace === undefined ? undefined : `${namespace.path}${tag.slice(namespace.prefix.length)}.js`);
    if (file === undefined) return null;
    const module = readModule(pagePath(file), fileReader, cache);
    const found = module === null ? null : classFor(module, tag, true, fileReader, cache);
    return found === null ? null : partOf(tag, found.module, found.cls);
  };

  // the tags the page writes, then the tags its parts' templates write
  const pending = customTags(source);
  const looked = new Set<string>();
  while (pending.length > 0 && looked.size < 256) {
    const tag = pending.shift()!;
    if (looked.has(tag) || tag.startsWith('wcs-')) continue;
    looked.add(tag);
    const part = find(tag);
    if (part === null) continue;
    parts.set(tag, part);
    if (part.template !== null) pending.push(...customTags(part.template.html));
  }
  return parts;
}

/** The custom tags a markup writes. */
function customTags(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<([a-z][a-z0-9]*-[a-z0-9-]*)(?=[\s/>])/gi)) out.add(m[1].toLowerCase());
  return [...out];
}

/** A path as written in a binding, as a path of the text's state: a row's path under its list; null when it cannot be told. */
function hostPathOf(path: string, text: string, offset: number, bindAttribute: string): string | null {
  const p = path.trim();
  if (p === '' || p.startsWith('$') || p.includes('|')) return null;
  if (!p.startsWith('.')) return p;
  const list = getResolvedForListPath(text, offset, bindAttribute);
  if (list === null || list.startsWith('.')) return null;
  return p === '.' ? `${list}.*` : `${list}.*.${p.slice(1)}`;
}

/** Where `text` (a page, or a part's template) mounts the parts. */
export function findMountSites(text: string, bindAttribute: string, parts: ReadonlyMap<string, ClassPart>): MountSite[] {
  const out: MountSite[] = [];
  if (parts.size === 0) return out;
  for (const attr of findAllBindAttributes(text, bindAttribute)) {
    const part = attr.tagName === undefined ? undefined : parts.get(attr.tagName);
    if (part === undefined) continue;
    let whole: string | null = null;
    let mounted = false;
    const handed = new Map<string, string | null>();
    for (const binding of splitBindingExpressions(attr.value)) {
      const parsed = parseBindingExpression(binding);
      if (parsed.path === null) continue;
      const property = parsed.property.replace(/#.*$/, '').trim();
      if (property === part.stateName) {
        mounted = true;
        whole = hostPathOf(parsed.path, text, attr.valueStart, bindAttribute);
      } else if (property.startsWith(`${part.stateName}.`)) {
        mounted = true;
        const key = property.slice(part.stateName.length + 1).split('.')[0];
        // (only a one-segment entry maps the key: `state.a.b:` leaves the rest of `a` the part's own)
        if (key !== '' && !property.slice(part.stateName.length + 1).includes('.')) handed.set(key, hostPathOf(parsed.path, text, attr.valueStart, bindAttribute));
      }
    }
    if (mounted) out.push({ part, whole, handed, valueStart: attr.valueStart, valueEnd: attr.valueStart + attr.value.length });
  }
  return out;
}

/** Where a path of some scope lands: a path of the page's tree, a part's own key (not the page's to know), or nowhere. */
export type Landing = { readonly kind: 'page'; readonly path: string } | { readonly kind: 'own' } | { readonly kind: 'none' };

/** One mount site met while walking a page and the templates of the parts it mounts. */
export interface SiteVisit {
  readonly site: MountSite;
  /** Where a path written inside this part's template lands (its own key, a key it was handed, the object it is mounted on). */
  readonly inside: (path: string) => Landing;
  /** Where the object the part is mounted on is in the page's tree; null when it is not there, or cannot be told. */
  readonly at: string | null;
  /** The site in the page itself this one is under (itself, at the top). */
  readonly top: MountSite;
}

/**
 * Walks the mount sites of `text` and, through each part's template, the parts mounted inside it. Inside a part a
 * path is one of the part's own keys, a key it was handed (`state.view: map.view`), or a path of the object it is
 * mounted on — and that object's path lands the same way in the scope around it.
 */
export function walkMountSites(text: string, bindAttribute: string, parts: ReadonlyMap<string, ClassPart>, visit: (v: SiteVisit) => void): void {
  const walk = (scope: string, outer: (path: string) => Landing, top: MountSite | null, depth: number): void => {
    for (const site of findMountSites(scope, bindAttribute, parts)) {
      const whole: Landing = site.whole === null ? { kind: 'none' } : outer(site.whole);
      const inside = (path: string): Landing => {
        const first = path.split('.')[0];
        if (site.handed.has(first)) {
          const to = site.handed.get(first);
          if (to === null || to === undefined) return { kind: 'own' };
          const landed = outer(to);
          return landed.kind === 'page' ? { kind: 'page', path: `${landed.path}${path.slice(first.length)}` } : landed;
        }
        if (site.part.keys.includes(first)) return { kind: 'own' };
        return whole.kind === 'page' ? { kind: 'page', path: `${whole.path}.${path}` } : whole;
      };
      const here = top ?? site;
      visit({ site, inside, at: whole.kind === 'page' ? whole.path : null, top: here });
      if (site.part.template !== null && depth < 6) walk(site.part.template.html, inside, here, depth + 1);
    }
  };
  walk(text, (path) => ({ kind: 'page', path }), null, 0);
}

/** The last answer (the path index is built many times for one page in a run). */
let lastExports: { html: string; fileReader: FileReader | undefined; bindAttribute: string; out: PathCandidate[] } | null = null;

/**
 * The paths the parts mounted in a page answer: each getter of a part's state, at the path the part is mounted on
 * (`<x-card data-wcs="state: user">` with `get display()` → `user.display`; in a row, `users.*.display`). A part
 * mounted inside another part's template answers under that one's mount point. `has` says whether the tree already
 * has a path: a key the tree has wins over the part's getter, and is not added again.
 */
export function mountedExports(
  html: string,
  bindAttribute: string,
  fileReader: FileReader | undefined,
  has: (path: string) => boolean,
): PathCandidate[] {
  if (lastExports !== null && lastExports.html === html && lastExports.fileReader === fileReader && lastExports.bindAttribute === bindAttribute) return lastExports.out;
  const out: PathCandidate[] = [];
  lastExports = { html, fileReader, bindAttribute, out };
  if (fileReader === undefined || !mayMountParts(html) || !html.includes(bindAttribute)) return out;
  const parts = collectClassParts(html, fileReader);
  if (parts.size === 0) return out;
  const added = new Set<string>();
  walkMountSites(html, bindAttribute, parts, ({ site, at }) => {
    if (at === null) return;
    for (const getter of site.part.getters) {
      const path = `${at}.${getter}`;
      if (added.has(path) || has(path)) continue;
      added.add(path);
      out.push({ path, kind: 'computed' });
    }
  });
  return out;
}

/** A path a part's template reads: its first key, the path as written, and where it is in the template. */
export interface TemplateUse {
  readonly key: string;
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The first keys a part's template reads, each at the first place it is read: the paths of its bindings (a row's path
 * under its `for:` list), of its `{{ }}` and of its comment bindings. A `$` path (a loop index, a token) is not a
 * key of any state.
 */
export function templateUses(html: string, bindAttribute: string): TemplateUse[] {
  const out = new Map<string, TemplateUse>();
  const use = (written: string, start: number): void => {
    const path = written.trim();
    if (path === '' || path.startsWith('$')) return;
    let full = path;
    if (path.startsWith('.')) {
      const list = getResolvedForListPath(html, start, bindAttribute);
      if (list === null || list.startsWith('.')) return;
      full = list;
    }
    const key = full.split('.')[0];
    if (key === '' || key === '*' || /^\d+$/.test(key) || !/^[A-Za-z_][\w-]*$/.test(key)) return;
    const at = start + (written.length - written.trimStart().length);
    const known = out.get(key);
    if (known === undefined || at < known.start) out.set(key, { key, path, start: at, end: at + path.length });
  };
  for (const attr of findAllBindAttributes(html, bindAttribute)) {
    let pos = 0;
    for (const binding of splitBindingExpressions(attr.value)) {
      const parsed = parseBindingExpression(binding);
      if (parsed.path !== null) {
        const at = binding.indexOf(parsed.path, Math.max(0, binding.indexOf(':')));
        if (at !== -1) use(parsed.path, attr.valueStart + pos + at);
      }
      pos += binding.length + 1;
    }
  }
  for (const item of [...findAllMustacheSyntax(html), ...findAllCommentBindings(html)]) {
    const path = item.expression.split('|')[0];
    use(path, item.exprStart);
  }
  return [...out.values()].sort((a, b) => a.start - b.start);
}
