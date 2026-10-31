/**
 * packageLoadValidator.ts — the wcstack packages a page loads, against the tags it writes and the lint it is checked
 * with. From the `homeroom` seam app (an app written on 4.2.0 and upgraded to 4.10.1):
 *
 * - TagPackageMissing (`wcs/tag-package-missing`, warning): a `wcs-*` tag of a wcstack package (`<wcs-upload>`) on a
 *   page that loads wcstack itself but no script of that package. The element is never defined, its bindings wait,
 *   and nothing in the console says so (homeroom's Save hung at "送信中 0%"). Reported once per package, at its first
 *   tag, naming the package's `/auto`. The tags of one package count together (`<wcs-upload-header>` is
 *   `@wcstack/upload`'s). Not reported:
 *     - on a page that names no wcstack script itself — no `<script src>`, import map entry or import in an inline
 *       script naming `@wcstack/<pkg>` or the `wcstack` bundle (a fragment, or a bundler's page);
 *     - for a tag an `@components/` import map entry covers when the autoloader is there (`<wcs-autoloader>`, or a
 *       script naming `@wcstack/autoloader` / the bundle) — it loads the tag's module;
 *     - when the page runs a local script the lint cannot read or follow (it may load the package): a local script it
 *       reads (and the relative modules it imports) counts what it names, and a `wcs-*` tag in its strings (a bundle
 *       that defines it, `../../dist/auto.min.js`). With the autoloader, the modules it loads for the page's own
 *       custom elements (an `@components/` entry's file) are local scripts too.
 *   "Loaded" is any mention: a `<script src>`, `<link rel="modulepreload">`, an import map key or value, an import or
 *   a string in an inline script naming `@wcstack/<pkg>` (any version, any CDN, a local path), `/packages/<pkg>/dist/`
 *   (this repository's pages), or the `wcstack` bundle (its members: state, router, fetch, storage, autoloader).
 * - LintVersionBehind (`wcs/lint-version-behind`, warning): a URL on the page pins `@wcstack/<pkg>@X.Y[.Z]` (or
 *   `wcstack@…`) with the lint's major and a newer minor than the engine the lint is built from (`ENGINE_VERSION`).
 *   That lint cannot see the newer rules, and reports correct newer syntax as an error (4.2.0's lint on a 4.10 page:
 *   `datetime(ja-JP,short,Asia/Tokyo)` → `wcs/filter-arity`). Once per page, at the newest pin. A URL without a
 *   version, or with the major only (`@4`), is not compared; a lint newer than the page is not reported.
 *
 * pure (the files come through the reader).
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { BUILTIN_TAGS } from './generated/builtinTags.generated.js';
import { ENGINE_VERSION } from './wcsManifest.js';
import { joinModulePath } from './moduleValues.js';
import { BUNDLE_PACKAGES, attrValue, blankHtmlComments, blankJsComments, extractSrc } from './documentEnvValidator.js';
import type { FileReader } from './statePathResolver.js';

/**
 * The tags of the packages the generated catalogue leaves out (it holds the I/O nodes' wc-bindable contracts):
 * `@wcstack/state`, `@wcstack/router` (its `config.tagNames`), `@wcstack/autoloader` and `@wcstack/devtools`.
 */
const CORE_TAG_PACKAGES: Readonly<Record<string, string>> = {
  'wcs-state': 'state',
  'wcs-ssr': 'state',
  'wcs-router': 'router',
  'wcs-route': 'router',
  'wcs-outlet': 'router',
  'wcs-layout': 'router',
  'wcs-layout-outlet': 'router',
  'wcs-link': 'router',
  'wcs-head': 'router',
  'wcs-guard-handler': 'router',
  'wcs-autoloader': 'autoloader',
  'wcs-devtools': 'devtools',
};

/** The wcstack package a `wcs-*` tag belongs to (the directory name: `upload`), or undefined for another tag. */
export function packageOfTag(tag: string): string | undefined {
  if (Object.hasOwn(BUILTIN_TAGS, tag)) return BUILTIN_TAGS[tag].package;
  return Object.hasOwn(CORE_TAG_PACKAGES, tag) ? CORE_TAG_PACKAGES[tag] : undefined;
}

/** `@wcstack/<pkg>` anywhere in a URL or a specifier (any version, any subpath). */
const SCOPED_NAME = /@wcstack\/([a-z0-9-]+)/g;
/** This repository's local paths: `/packages/<pkg>/dist/…`. */
const REPO_DIST = /\/packages\/([a-z0-9-]+)\/dist\//g;
/** The `wcstack` bundle: `wcstack/auto`, `wcstack@4/auto`, `wcstack@4.10.1/dist/auto.min.js`. */
const BUNDLE = /(?:^|[/"'`\s])wcstack(?:@[^/"'`\s]+)?\/(?:auto\b|dist\/)/;
/** A pinned version: `@wcstack/state@4.10.1`, `wcstack@4.11` (the major only is not a pin this compares). */
const PINNED = /(?:@wcstack\/([a-z0-9-]+)|(?:^|(?<=[/"'`\s]))wcstack)@(\d+)\.(\d+)(?:\.(\d+))?(-[0-9A-Za-z.-]+)?/g;

/** The wcstack packages a URL / specifier / text names. */
function namedPackages(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(SCOPED_NAME)) out.push(m[1]);
  for (const m of text.matchAll(REPO_DIST)) out.push(m[1]);
  if (BUNDLE.test(text)) out.push('wcstack');
  // the bundle carries its members
  return out.flatMap((p) => (p === 'wcstack' ? [...BUNDLE_PACKAGES] : [p]));
}

/** A string the page writes that can name a script: where it is, for the version pin's range. */
interface Reference {
  readonly text: string;
  readonly start: number;
}

/** What the page loads, as far as the lint can tell. */
export interface PageLoads {
  /** The packages its scripts name (the bundle's members for the bundle). */
  readonly pkgs: Set<string>;
  /** `wcs-*` tag names in the strings of the local scripts it read (a bundle that defines them). */
  readonly definedTags: Set<string>;
  /** The page itself names a wcstack script: a `<script src>`, an import map entry, an import in an inline script. */
  own: boolean;
  /** A local script it could not read or follow: what that loads is unknown. */
  unclear: boolean;
  /** The autoloader is there: a script names `@wcstack/autoloader` (or the bundle), or the page has `<wcs-autoloader>`. */
  autoloader: boolean;
  /** The import map's `imports` (the last map's entries win, as in a browser that merges them). */
  readonly imports: Map<string, string>;
  /** The import maps' keys (`@components/…` for the autoloader). */
  readonly mapKeys: string[];
  /** The URLs and specifiers the page writes (for the version pins). */
  readonly references: Reference[];
}

/** How many local files one page's scripts are followed through (a bundle's chunks, a module's imports). */
const MAX_FILES = 32;
/** How deep relative imports are followed. */
const MAX_DEPTH = 4;

export function validatePackageLoads(html: string, locale?: string, fileReader?: FileReader): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const scan = blankHtmlComments(html);
  const loads = collectPageLoads(scan, fileReader);
  const out: WcsDiagnostic[] = [];

  // --- LintVersionBehind: the newest pin on the page, against the engine the lint is built from
  const lint = parseVersion(ENGINE_VERSION);
  let newest: { pin: Pin; start: number; end: number } | null = null;
  for (const ref of loads.references) {
    for (const m of ref.text.matchAll(PINNED)) {
      const pin: Pin = {
        spec: m[0],
        version: m[0].slice(m[0].lastIndexOf('@') + 1),
        major: Number(m[2]),
        minor: Number(m[3]),
        patch: m[4] === undefined ? 0 : Number(m[4]),
      };
      if (newest === null || comparePins(pin, newest.pin) > 0) {
        newest = { pin, start: ref.start + m.index!, end: ref.start + m.index! + m[0].length };
      }
    }
  }
  if (lint !== null && newest !== null && newest.pin.major === lint.major && newest.pin.minor > lint.minor) {
    out.push({
      code: WcsDiagnosticCode.LintVersionBehind,
      start: newest.start, end: newest.end, severity: 'warning',
      message: msgs.lintVersionBehind(newest.pin.spec, newest.pin.version, `${newest.pin.major}.${newest.pin.minor}`, ENGINE_VERSION),
    });
  }

  // --- TagPackageMissing: a package's tags with no script of it (only on a page that loads wcstack itself)
  if (!loads.own || loads.unclear) return out;
  const autoloader = loads.autoloader;
  const components = loads.mapKeys.filter((k) => k.startsWith('@components/'));
  // a tag a local script names (a bundle that defines it) counts for its package: the package's other tags come with it
  const defined = new Set([...loads.definedTags].map((t) => packageOfTag(t)).filter((p) => p !== undefined));
  const byPackage = new Map<string, { tags: string[]; start: number; end: number }>();
  for (const tag of findWcsTags(scan)) {
    const pkg = packageOfTag(tag.name);
    if (pkg === undefined || loads.pkgs.has(pkg) || defined.has(pkg)) continue;
    if (autoloader && tag.name !== 'wcs-autoloader' && components.some((k) => coversTag(k, tag.name))) continue;
    const seen = byPackage.get(pkg);
    if (seen === undefined) byPackage.set(pkg, { tags: [tag.name], start: tag.start, end: tag.end });
    else if (!seen.tags.includes(tag.name)) seen.tags.push(tag.name);
  }
  const version = suggestedVersion(loads.references);
  for (const [pkg, at] of byPackage) {
    out.push({
      code: WcsDiagnosticCode.TagPackageMissing,
      start: at.start, end: at.end, severity: 'warning',
      tag: at.tags[0],
      message: msgs.tagPackageMissing(at.tags, `@wcstack/${pkg}`, `https://esm.run/@wcstack/${pkg}${version === null ? '' : `@${version}`}/auto`),
    });
  }
  return out;
}

interface Pin {
  /** As written: `@wcstack/state@4.11.0`, `wcstack@4.11`. */
  readonly spec: string;
  /** The version as written (`4.11.0`, `4.11`, `4.11.0-rc.1`). */
  readonly version: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function comparePins(a: Pin, b: Pin): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function parseVersion(version: string): { major: number; minor: number } | null {
  const m = /^(\d+)\.(\d+)/.exec(version);
  return m === null ? null : { major: Number(m[1]), minor: Number(m[2]) };
}

/** The version the page pins its wcstack scripts at, when it pins them all at one (for the suggested URL). */
function suggestedVersion(references: readonly Reference[]): string | null {
  const versions = new Set<string>();
  for (const ref of references) {
    for (const m of ref.text.matchAll(PINNED)) versions.add(m[0].slice(m[0].lastIndexOf('@') + 1));
  }
  return versions.size === 1 ? [...versions][0] : null;
}

/**
 * Whether an `@components/` import map key makes the autoloader load `tag`: a namespace (`@components/wcs/` →
 * `<wcs-*>`, slashes turned to dashes) or the tag itself (`@components/wcs-upload`), with an optional `|loader`.
 */
function coversTag(key: string, tag: string): boolean {
  const body = key.slice('@components/'.length);
  if (body.endsWith('/')) {
    const prefix = body.slice(0, -1).replace(/\|[^/]*$/, '').replace(/\//g, '-');
    return prefix !== '' && tag.startsWith(`${prefix}-`);
  }
  return body.replace(/\|.*$/, '') === tag;
}

/** The markup with the bodies of `<script>` / `<style>` blanked (offsets kept). */
function markupOf(scan: string): string {
  return scan.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (_m, open: string, _name: string, body: string, close: string) => open + ' '.repeat(body.length) + close);
}

/** The `wcs-*` opening tags of the markup (not in `<script>` / `<style>`), in document order. */
function findWcsTags(scan: string): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  for (const m of markupOf(scan).matchAll(/<(wcs-[a-z0-9-]+)(?=[\s/>])/gi)) {
    const start = m.index! + 1;
    out.push({ name: m[1].toLowerCase(), start, end: start + m[1].length });
  }
  return out;
}

/**
 * The local modules the autoloader loads for the page's custom elements (`<x-y>`, `is="x-y"`): an eager entry's file
 * (`"@components/app-main": "./main.js"`), and a namespace's file for each tag it covers (`"@components/app/": "./"`
 * and `<app-header>` → `./header.js`). They may load wcstack packages themselves. Not the `wcs-*` tags': a key that
 * covers one is its package's wrapper (the autoloader README), and the tag is not reported.
 */
function autoloaderModules(scan: string, imports: ReadonlyMap<string, string>): string[] {
  const markup = markupOf(scan);
  const tags = new Set<string>();
  for (const m of markup.matchAll(/<([a-z][a-z0-9]*-[a-z0-9-]*)(?=[\s/>])/gi)) tags.add(m[1].toLowerCase());
  for (const m of markup.matchAll(/\sis\s*=\s*["']([a-z][a-z0-9]*-[a-z0-9-]*)["']/gi)) tags.add(m[1].toLowerCase());
  for (const tag of tags) if (tag.startsWith('wcs-')) tags.delete(tag);
  const out: string[] = [];
  for (const [key, value] of imports) {
    if (!key.startsWith('@components/') || isUrl(value)) continue;
    const body = key.slice('@components/'.length);
    if (!body.endsWith('/')) {
      if (!body.startsWith('wcs-')) out.push(pagePath(value));
      continue;
    }
    const prefix = body.slice(0, -1).replace(/\|[^/]*$/, '').replace(/\//g, '-');
    for (const tag of tags) {
      if (prefix !== '' && tag.startsWith(`${prefix}-`)) out.push(pagePath(`${value}${tag.slice(prefix.length + 1)}.js`));
    }
  }
  return out;
}

/** The page's scripts, import maps and module preloads: what they name, and the local files they run. */
export function collectPageLoads(scan: string, fileReader: FileReader | undefined): PageLoads {
  const loads: PageLoads = {
    pkgs: new Set(), definedTags: new Set(), own: false, unclear: false, autoloader: false, imports: new Map(), mapKeys: [], references: [],
  };
  const name = (text: string, own: boolean): void => {
    const pkgs = namedPackages(text);
    for (const p of pkgs) loads.pkgs.add(p);
    if (own && pkgs.length > 0) loads.own = true;
  };
  /** Local modules to read: the path as the page's reader takes it. */
  const locals: string[] = [];
  /** Specifiers of the inline scripts' imports, resolved once the import maps are read. */
  const specifiers: string[] = [];

  const scriptRegex = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(scan)) !== null) {
    const attrs = match[1];
    const type = (attrValue(attrs, 'type') ?? '').trim().toLowerCase();
    const src = extractSrc(`<script${attrs}>`);
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    if (src !== null) {
      const start = match.index + src.offsetInTag;
      loads.references.push({ text: src.value, start });
      name(src.value, true);
      if (namedPackages(src.value).length === 0 && !isUrl(src.value)) locals.push(pagePath(src.value));
      continue;
    }
    if (type === 'importmap') {
      readImportMap(match[2], bodyStart, loads, name);
      continue;
    }
    // a data block (application/json, text/plain …) runs nothing
    if (type !== '' && type !== 'module' && !/^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)$/.test(type)) continue;
    const body = blankJsComments(match[2]);
    // a string naming a package (a script it creates, an import of a computed URL) counts as loading it
    name(body, false);
    for (const im of body.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]*)\1/g)) {
      const start = bodyStart + im.index! + im[0].indexOf(im[1]) + 1;
      loads.references.push({ text: im[2], start });
      name(im[2], true);
      specifiers.push(im[2]);
    }
  }
  for (const m of scan.matchAll(/<link\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi)) {
    if (!/^\s*modulepreload\s*$/i.test(attrValue(m[1], 'rel') ?? '')) continue;
    const href = attrValue(m[1], 'href');
    if (href !== null) name(href, false);
  }
  // an inline script's import: a URL or a mapped name naming a package counts above; a relative module, or a name the
  // import map sends to a local file, is read
  for (const spec of specifiers) {
    if (namedPackages(spec).length > 0) continue;
    const target = resolveSpecifier(spec, loads.imports);
    if (target === undefined || namedPackages(target).length > 0 || isUrl(target)) continue;
    if (isRelative(target)) locals.push(pagePath(target));
  }
  // the autoloader (a script naming it, the bundle, or its element in the page) loads the components' modules
  loads.autoloader = loads.pkgs.has('autoloader') || /<wcs-autoloader\b/i.test(scan);
  if (loads.autoloader) locals.push(...autoloaderModules(scan, loads.imports));
  if (locals.length > 0) readLocalModules(locals, fileReader, loads);
  return loads;
}

/** The import map's strings (keys and values — what they name, and the version pins), and its `imports`. */
function readImportMap(body: string, bodyStart: number, loads: PageLoads, name: (text: string, own: boolean) => void): void {
  for (const m of body.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    loads.references.push({ text: m[1], start: bodyStart + m.index! + 1 });
    name(m[1], true);
  }
  let parsed: { imports?: unknown } | null = null;
  try {
    parsed = JSON.parse(body) as { imports?: unknown };
  } catch {
    return;
  }
  const imports = parsed?.imports;
  if (imports === null || typeof imports !== 'object') return;
  for (const [key, value] of Object.entries(imports as Record<string, unknown>)) {
    loads.mapKeys.push(key);
    if (typeof value === 'string') loads.imports.set(key, value);
  }
}

/** Where an import specifier leads: itself when it is a URL or relative, the import map's target for a name. */
function resolveSpecifier(spec: string, imports: ReadonlyMap<string, string>): string | undefined {
  if (isUrl(spec) || isRelative(spec)) return spec;
  if (imports.has(spec)) return imports.get(spec);
  let best: string | undefined;
  for (const key of imports.keys()) {
    if (key.endsWith('/') && spec.startsWith(key) && (best === undefined || key.length > best.length)) best = key;
  }
  return best === undefined ? undefined : imports.get(best)! + spec.slice(best.length);
}

function isUrl(spec: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith('//');
}

function isRelative(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/');
}

/** A `<script src>` as the page's reader takes it (`app.js` is relative to the page, as `./app.js`). */
function pagePath(src: string): string {
  return isRelative(src) ? src : `./${src}`;
}

/**
 * Reads the local scripts and the relative modules they import (`MAX_DEPTH`, `MAX_FILES`): what they name counts as
 * loaded, and a `wcs-*` tag in their strings as defined. One the reader cannot read makes the page unclear. The text is
 * read as it is, comments too — a minified bundle's `//` in a string would blank the rest of its one line, and what a
 * comment names only makes the rule quieter.
 */
function readLocalModules(entries: readonly string[], fileReader: FileReader | undefined, loads: PageLoads): void {
  if (fileReader === undefined) {
    loads.unclear = true;
    return;
  }
  const seen = new Set<string>();
  const queue: { spec: string; from: string; depth: number }[] = entries.map((spec) => ({ spec, from: '', depth: 0 }));
  while (queue.length > 0) {
    const { spec, from, depth } = queue.shift()!;
    // (every spec here is relative — `./`, `../` or `/` — so it always has a path)
    const path = joinModulePath(from, spec) as string;
    if (seen.has(path)) continue;
    if (seen.size >= MAX_FILES || depth > MAX_DEPTH) {
      loads.unclear = true;
      return;
    }
    seen.add(path);
    const text = fileReader(path);
    if (text === undefined) {
      loads.unclear = true;
      return;
    }
    for (const p of namedPackages(text)) loads.pkgs.add(p);
    for (const m of text.matchAll(/["'`](wcs-[a-z0-9-]+)["'`]/g)) loads.definedTags.add(m[1]);
    for (const im of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]*)\1/g)) {
      if (namedPackages(im[2]).length > 0) continue;
      const target = resolveSpecifier(im[2], loads.imports);
      if (target === undefined || namedPackages(target).length > 0 || isUrl(target) || !isRelative(target)) continue;
      // a name the import map sends to a file is relative to the page, a relative specifier to the module
      queue.push({ spec: target, from: isRelative(im[2]) ? path : '', depth: depth + 1 });
    }
  }
}
