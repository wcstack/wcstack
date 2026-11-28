/**
 * packageLoadValidator.ts — the wcstack packages a page loads, against the tags it writes and the lint it is checked
 * with. From the `homeroom` seam app (an app written on 4.2.0 and upgraded to 4.10.1):
 *
 * - TagPackageMissing (`wcs/tag-package-missing`, error since 4.21 — a warning up to 4.20, which `--errors-only` hid from
 *   the ledger-repair seam app's maintainer): a `wcs-*` tag of a wcstack package (`<wcs-upload>`) on a
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
 * - LinkRouterMissing (`wcs/link-router-missing`, warning): from the `community-hall` seam app (islands on a page a
 *   server renders): a `<wcs-link to="/…">` on a page with no `<wcs-router>`. The link throws `[@wcstack/router]
 *   wcs-link is not connected to a router.` when it connects and its host stays `display: none` — the link is gone.
 *   Once per page, at the first such link. Only where TagPackageMissing would speak (a page that loads wcstack itself,
 *   with no local script it cannot read), and only when the link is defined — the router package is loaded, or the
 *   autoloader covers the tag. A fragment — a route's content, a layout file the router page includes — loads no
 *   wcstack script and is left out; so is a page that names `wcs-router` anywhere outside its HTML comments (a
 *   `<wcs-router>`, in a `<template>` too, or a script that makes one), a `to` that is a URL or a query, and a `to`
 *   bound with `attr.to:`.
 * - LintVersionBehind (`wcs/lint-version-behind`, warning): a URL on the page pins `@wcstack/<pkg>@X.Y[.Z]` (or
 *   `wcstack@…`) with the lint's major and a newer minor than the engine the lint is built from (`ENGINE_VERSION`).
 *   That lint cannot see the newer rules, and reports correct newer syntax as an error (4.2.0's lint on a 4.10 page:
 *   `datetime(ja-JP,short,Asia/Tokyo)` → `wcs/filter-arity`). Once per page, at the newest pin. A URL without a
 *   version, or with the major only (`@4`), is not compared; a lint newer than the page is not reported. Since 4.33
 *   the imports of the local modules the page runs count too (a signals page that loads everything from `./app.js`):
 *   such a finding is reported in the module (`origin`), and shown on what led the page to it.
 * - SignalsDualEntry (`wcs/signals-dual-entry`): from the counter-assist seam app (a call display written with
 *   `@wcstack/signals`, its modules loaded from one local script): `signal` imported from
 *   `https://cdn.jsdelivr.net/npm/@wcstack/signals@4.32.0/+esm` and the rest from `…/dist/dom.esm.min.js` — two
 *   reactive cores, so the effect that drew the clock never saw its signal, and the clock never moved; the lint listed
 *   the page as having nothing to check. An error when two loads of `@wcstack/signals` each carry a core of their own:
 *   two entries (`.` and `./dom`) where one comes from a CDN that bundles each entry (esm.run, jsDelivr's `+esm`,
 *   esm.sh), or both are `dist` files of two builds (`.esm.js` and `.esm.min.js` have separate core chunks); or two
 *   versions, from any source. Two entries served as files of one build share its core chunk and are fine. What is
 *   counted: `<script src>`, the inline scripts' imports, the imports of the local modules they run (a bare name
 *   through the import map; one no entry gives is a bundler's, and left out). At the later load, once per page.
 *   Otherwise a warning for an import map that maps both entries to CDN bundles though the page imports one (a module
 *   the lint does not read may import the other — docs/seam-apps.md, signals-shop).
 *
 * pure (the files come through the reader).
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages } from '../core/messages.js';
import { createPositionMapper } from '../core/offsetToPosition.js';
import { BUILTIN_TAGS } from './generated/builtinTags.generated.js';
import { ENGINE_VERSION } from './wcsManifest.js';
import { joinModulePath } from './moduleValues.js';
import { BUNDLE_PACKAGES, attrValue, blankHtmlComments, blankJsComments, extractSrc } from './documentEnvValidator.js';
import type { FileReader } from './statePathResolver.js';
import { extractAttribute, findStartTagRegions } from '../language/htmlParse.js';

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
  /** In the page; for one in a local module, the start of what led the page to that module (`file` says where). */
  readonly start: number;
  /** In a local module the page runs: where the string is in it. */
  readonly file?: ModuleSite;
}

/** Where a specifier is in a local module the page runs (and the page range that led there). */
export interface ModuleSite {
  /** The module, as the page's reader takes its path (relative to the page, or from `/`). */
  readonly path: string;
  readonly text: string;
  /** The specifier's range in the module. */
  readonly start: number;
  readonly end: number;
  /** The page's range that led to the module: a `<script src>` value, an inline import's specifier, an import map key. */
  readonly anchorEnd: number;
}

/** A module the page runs or imports, as far as the lint reads: where it is written, and where it leads. */
export interface PageImport {
  /** As written: a `<script src>` value, or an import's specifier. */
  readonly spec: string;
  /** Where it leads: the import map's target for a name (undefined when no entry gives it), itself otherwise. */
  readonly target: string | undefined;
  /** In the page: the specifier itself, or — for one in a local module — what led the page to that module. */
  readonly start: number;
  readonly end: number;
  /** In a local module the page runs: where the specifier is in it. */
  readonly file?: ModuleSite;
}

/** A local module to read, and the page range that leads to it. */
interface LocalEntry {
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

/** An import (`import … from "x"`, `export … from "x"`, `import "x"`, `import("x")`): the quote, then the specifier. */
const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"'\n]*)\1/g;

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
  /** The URLs and specifiers the page writes (for the version pins), and those its local modules import. */
  readonly references: Reference[];
  /** The scripts the page runs and the modules it imports — in the page, then in the local modules read (in reading order). */
  readonly imported: PageImport[];
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

  // --- LintVersionBehind: the newest pin on the page (or in a local module it runs), against the engine the lint is
  // built from
  const lint = parseVersion(ENGINE_VERSION);
  let newest: { pin: Pin; at: Site } | null = null;
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
        newest = { pin, at: siteOf(ref.start, ref.file, m.index!, m[0].length) };
      }
    }
  }
  if (lint !== null && newest !== null && newest.pin.major === lint.major && newest.pin.minor > lint.minor) {
    out.push({
      code: WcsDiagnosticCode.LintVersionBehind,
      ...newest.at, severity: 'warning',
      message: msgs.lintVersionBehind(newest.pin.spec, newest.pin.version, `${newest.pin.major}.${newest.pin.minor}`, ENGINE_VERSION),
    });
  }

  // --- SignalsDualEntry: two loads of @wcstack/signals that each carry their own reactive core (error); otherwise an
  // import map that maps both entries to CDN bundles (warning — a module the lint does not read may import the other)
  const dual = findSignalsDualEntry(loads.imported);
  if (dual !== null) {
    const { later, earlier, versions } = dual;
    out.push({
      code: WcsDiagnosticCode.SignalsDualEntry,
      ...siteOf(later.start, later.file, 0, later.spec.length), severity: 'error',
      message: msgs.signalsDualEntry(later.spec, earlier.spec, versions),
    });
  } else {
    const both = findSignalsImportMapBoth(scan);
    if (both !== null) {
      out.push({
        code: WcsDiagnosticCode.SignalsDualEntry,
        start: both.start, end: both.end, severity: 'warning',
        message: msgs.signalsImportMapBoth(),
      });
    }
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
      start: at.start, end: at.end, severity: 'error',
      tag: at.tags[0],
      message: msgs.tagPackageMissing(at.tags, `@wcstack/${pkg}`, `https://esm.run/@wcstack/${pkg}${version === null ? '' : `@${version}`}/auto`),
    });
  }

  // --- LinkRouterMissing: <wcs-link> to an internal path on a page with no <wcs-router> (the link is defined: the
  // router package is loaded, or the autoloader covers the tag — without either, TagPackageMissing above says so)
  const linkDefined = loads.pkgs.has('router') || defined.has('router')
    || (autoloader && components.some((k) => coversTag(k, 'wcs-link')));
  if (linkDefined) {
    const links = findLinksWithoutRouter(scan);
    if (links.length > 0) {
      out.push({
        code: WcsDiagnosticCode.LinkRouterMissing,
        start: links[0].start, end: links[0].end, severity: 'warning',
        tag: 'wcs-link',
        message: msgs.linkRouterMissing(links[0].to, links.length),
      });
    }
  }
  return out;
}

/**
 * The `<wcs-link>` start tags whose `to` is an internal path (`/…`), outside comments, `<script>` and `<style>`, on a
 * page that does not name `wcs-router` anywhere outside its HTML comments — a `<wcs-router>` (in a `<template>` too),
 * or a script that makes one (`createElement("wcs-router")`, a string of markup) silences it. Such a link looks for its
 * router when it connects (the router's Link.ts: `closest()`, then the root's `querySelector()`), throws `wcs-link is
 * not connected to a router.`, and its host stays `display: none` with no `<a>`. A `to` that is a URL or a query
 * (`?page=2`) does not need the router to render, and one bound with `attr.to:` is not known: both are left out. The
 * range is the tag name.
 */
function findLinksWithoutRouter(scan: string): { to: string; start: number; end: number }[] {
  if (/\bwcs-router\b/i.test(scan)) return [];
  const out: { to: string; start: number; end: number }[] = [];
  for (const region of findStartTagRegions(scan)) {
    if (region.tagName !== 'wcs-link') continue;
    const to = extractAttribute(scan.slice(region.start, region.end), 'to');
    if (to === null || !to.startsWith('/')) continue;
    out.push({ to, start: region.start - 'wcs-link'.length, end: region.start });
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

/** Where a finding goes: a range of the page, and — for one in a local module — where it is in that module. */
type Site = Pick<WcsDiagnostic, 'start' | 'end' | 'origin'>;

/**
 * The site of `length` characters at `offset` into a string the page writes at `start` — or, with `file`, into a
 * specifier of a local module: then the page range is what led there (the IDE shows it), and `origin` is in the file
 * (the CLI reports it there, as a finding in a `src=` state).
 */
function siteOf(start: number, file: ModuleSite | undefined, offset: number, length: number): Site {
  if (file === undefined) return { start: start + offset, end: start + offset + length };
  const position = createPositionMapper(file.text);
  const from = file.start + offset;
  return {
    start,
    end: file.anchorEnd,
    origin: { path: file.path, start: from, end: from + length, startPosition: position(from), endPosition: position(from + length) },
  };
}

// ============================================================
// @wcstack/signals: one reactive core per page (wcs/signals-dual-entry)
// ============================================================

/** What one load of `@wcstack/signals` is, as far as its URL says. */
interface SignalsLoad {
  /** The entry: `.` or `./dom`; null when the URL does not say. */
  readonly entry: '.' | 'dom' | null;
  /** The version written (`4.32.0`, `4`), or null. */
  readonly version: string | null;
  /** The URL carries a copy of the core of its own: a CDN that bundles each entry (esm.run, jsDelivr's `+esm`, esm.sh). */
  readonly bundled: boolean;
  /**
   * A file of the package's `dist`: its directory (as written, up to `/dist/`) and its build — the `.esm.js` files
   * share one core chunk, the `.esm.min.js` files another (packages/signals/rollup.config.js). null for any other form.
   */
  readonly build: { readonly dir: string; readonly kind: 'esm' | 'min' } | null;
}

/** `@wcstack/signals`, its version and the path after it. */
const SIGNALS_URL = /@wcstack\/signals(?![\w-])(?:@([^/?#"'`\s]+))?(\/[^?#"'`\s]*)?/;
/** This repository's local paths: `/packages/signals/dist/<file>`. */
const REPO_SIGNALS = /\/packages\/signals\/dist\/([^?#"'`\s]*)/;
/** The CDNs that bundle each entry of a package on its own (with the package's own chunks inside). */
const BUNDLING_HOST = /^(?:https?:)?\/\/(?:esm\.run|esm\.sh)\//i;
const JSDELIVR_NPM = /^(?:https?:)?\/\/cdn\.jsdelivr\.net\/npm\//i;

/** A file of the signals `dist`: its entry (null for the core chunk) and its build. */
function signalsDistFile(name: string): { entry: '.' | 'dom' | null; build: 'esm' | 'min' } | null {
  const m = /^(?:(index|dom)|core-[\w-]+)\.esm(\.min)?\.js$/.exec(name);
  if (m === null) return null;
  return { entry: m[1] === undefined ? null : m[1] === 'index' ? '.' : 'dom', build: m[2] === undefined ? 'esm' : 'min' };
}

/**
 * What a URL or a path that loads `@wcstack/signals` is (null for anything else, a bare name the import map does not
 * give included — a bundler resolves those, and it shares the chunk).
 */
function signalsLoadOf(target: string | undefined): SignalsLoad | null {
  if (target === undefined || !(isUrl(target) || isRelative(target))) return null;
  const repo = REPO_SIGNALS.exec(target);
  if (repo !== null) {
    const file = signalsDistFile(repo[1]);
    return file === null ? null : { entry: file.entry, version: null, bundled: false, build: { dir: `${target.slice(0, repo.index)}/packages/signals/dist/`, kind: file.build } };
  }
  const m = SIGNALS_URL.exec(target);
  if (m === null) return null;
  const version = m[1] ?? null;
  const rest = m[2] ?? '';
  const path = target.replace(/[?#].*$/, '');
  if (BUNDLING_HOST.test(target) || (JSDELIVR_NPM.test(target) && path.endsWith('/+esm'))) {
    const sub = rest.replace(/\/\+esm$/, '').replace(/\/$/, '');
    const file = sub.startsWith('/dist/') ? signalsDistFile(sub.slice('/dist/'.length)) : null;
    const entry = sub === '' ? '.' : sub === '/dom' ? 'dom' : file?.entry ?? null;
    return { entry, version, bundled: true, build: null };
  }
  const file = rest.startsWith('/dist/') ? signalsDistFile(rest.slice('/dist/'.length)) : null;
  if (file !== null) {
    return { entry: file.entry, version, bundled: false, build: { dir: `${target.slice(0, m.index + m[0].length - rest.length)}/dist/`, kind: file.build } };
  }
  return { entry: rest === '' ? '.' : rest === '/dom' ? 'dom' : null, version, bundled: false, build: null };
}

/**
 * Whether two loads carry two reactive cores, and why: two versions (any form — each URL is a module of its own), or
 * two entries where at least one is bundled by its CDN, or both are dist files of two builds (one directory) or of two
 * directories at full URLs. Two entries served as files of one build share its core chunk. Two directories written as
 * paths (`/packages/…` and `../../packages/…`) may be one: not said.
 */
function twoCores(a: SignalsLoad, b: SignalsLoad): 'versions' | 'entries' | null {
  if (a.version !== null && b.version !== null && a.version !== b.version) return 'versions';
  if (a.entry === null || b.entry === null || a.entry === b.entry) return null;
  if (a.bundled || b.bundled) return 'entries';
  if (a.build === null || b.build === null) return null;
  if (a.build.dir === b.build.dir) return a.build.kind !== b.build.kind ? 'entries' : null;
  return isUrl(a.build.dir) && isUrl(b.build.dir) ? 'entries' : null;
}

/** The first load of `@wcstack/signals` that makes a second core, with the one before it it differs from. */
function findSignalsDualEntry(imported: readonly PageImport[]): { later: PageImport; earlier: PageImport; versions: [string, string] | null } | null {
  const seen: { load: SignalsLoad; at: PageImport }[] = [];
  for (const at of imported) {
    const load = signalsLoadOf(at.target);
    if (load === null) continue;
    for (const before of seen) {
      const why = twoCores(before.load, load);
      if (why === null) continue;
      return { later: at, earlier: before.at, versions: why === 'versions' ? [load.version!, before.load.version!] : null };
    }
    seen.push({ load, at });
  }
  return null;
}

/**
 * `<script type="importmap">` が `@wcstack/signals` と `@wcstack/signals/dom`（または接頭辞の
 * `@wcstack/signals/`）の両方を割り当てていれば、前者のキーの範囲。どちらも `dist/` のファイル
 * （チャンクを共有する）なら null。
 */
function findSignalsImportMapBoth(html: string): { start: number; end: number } | null {
  const mapRegex = /<script\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)<\/script\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = mapRegex.exec(html)) !== null) {
    if (!/\btype\s*=\s*(["'])importmap\1/i.test(match[1])) continue;
    let imports: Record<string, unknown> | undefined;
    try {
      imports = (JSON.parse(match[2]) as { imports?: Record<string, unknown> }).imports;
    } catch {
      continue;
    }
    if (imports === null || typeof imports !== 'object') continue;
    const core = imports['@wcstack/signals'];
    const dom = imports['@wcstack/signals/dom'] ?? imports['@wcstack/signals/'];
    if (typeof core !== 'string' || typeof dom !== 'string') continue;
    if (core.includes('/dist/') && dom.includes('/dist/')) continue;
    const key = '"@wcstack/signals"';
    const at = match[2].indexOf(key);
    const bodyStart = match.index + match[0].indexOf('>') + 1;
    const start = bodyStart + (at === -1 ? 0 : at + 1);
    return { start, end: start + key.length - 2 };
  }
  return null;
}

/**
 * Whether the rules about what a page loads find something to read on a page with no binding, `<wcs-*>` tag or wcstack
 * script of its own (the CLI's `nothing to check:` — core/cli/runValidation.ts): a module it runs, read with the
 * modules that imports, loads `@wcstack/signals` (wcs/signals-dual-entry) or pins a wcstack version
 * (wcs/lint-version-behind). A signals page that loads its modules from a local script was listed as having nothing
 * to check, and had (docs/seam-apps.md, counter-assist).
 */
export function loadRulesApply(html: string, fileReader?: FileReader): boolean {
  const loads = collectPageLoads(blankHtmlComments(html), fileReader);
  return loads.imported.some((i) => /@wcstack\/signals(?![\w-])|\/packages\/signals\/dist\//.test(i.target ?? i.spec))
    || loads.references.some((r) => [...r.text.matchAll(PINNED)].length > 0);
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
function autoloaderModules(scan: string, imports: ReadonlyMap<string, string>): LocalEntry[] {
  const markup = markupOf(scan);
  const tags = new Set<string>();
  for (const m of markup.matchAll(/<([a-z][a-z0-9]*-[a-z0-9-]*)(?=[\s/>])/gi)) tags.add(m[1].toLowerCase());
  for (const m of markup.matchAll(/\sis\s*=\s*["']([a-z][a-z0-9]*-[a-z0-9-]*)["']/gi)) tags.add(m[1].toLowerCase());
  for (const tag of tags) if (tag.startsWith('wcs-')) tags.delete(tag);
  const out: LocalEntry[] = [];
  for (const [key, value] of imports) {
    if (!key.startsWith('@components/') || isUrl(value)) continue;
    // (what leads the page there: the key in the import map)
    const at = scan.indexOf(JSON.stringify(key));
    const anchor = at === -1 ? { start: 0, end: 0 } : { start: at + 1, end: at + 1 + key.length };
    const body = key.slice('@components/'.length);
    if (!body.endsWith('/')) {
      if (!body.startsWith('wcs-')) out.push({ path: pagePath(value), ...anchor });
      continue;
    }
    const prefix = body.slice(0, -1).replace(/\|[^/]*$/, '').replace(/\//g, '-');
    for (const tag of tags) {
      if (prefix !== '' && tag.startsWith(`${prefix}-`)) out.push({ path: pagePath(`${value}${tag.slice(prefix.length + 1)}.js`), ...anchor });
    }
  }
  return out;
}

/** The page's scripts, import maps and module preloads: what they name, and the local files they run. */
export function collectPageLoads(scan: string, fileReader: FileReader | undefined): PageLoads {
  const loads: PageLoads = {
    pkgs: new Set(), definedTags: new Set(), own: false, unclear: false, autoloader: false, imports: new Map(), mapKeys: [], references: [], imported: [],
  };
  const name = (text: string, own: boolean): void => {
    const pkgs = namedPackages(text);
    for (const p of pkgs) loads.pkgs.add(p);
    if (own && pkgs.length > 0) loads.own = true;
  };
  /** Local modules to read: the path as the page's reader takes it, and what leads there. */
  const locals: LocalEntry[] = [];
  /**
   * What the page runs, in document order: a `<script src>` (`target` is itself) or an inline script's import (its
   * specifier, resolved once the import maps are read).
   */
  const written: { spec: string; start: number; inline: boolean }[] = [];

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
      written.push({ spec: src.value, start, inline: false });
      name(src.value, true);
      if (namedPackages(src.value).length === 0 && !isUrl(src.value)) locals.push({ path: pagePath(src.value), start, end: start + src.value.length });
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
    for (const im of body.matchAll(IMPORT_SPECIFIER)) {
      const start = bodyStart + im.index! + im[0].indexOf(im[1]) + 1;
      loads.references.push({ text: im[2], start });
      written.push({ spec: im[2], start, inline: true });
      name(im[2], true);
    }
  }
  for (const m of scan.matchAll(/<link\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi)) {
    if (!/^\s*modulepreload\s*$/i.test(attrValue(m[1], 'rel') ?? '')) continue;
    const href = attrValue(m[1], 'href');
    if (href !== null) name(href, false);
  }
  for (const w of written) {
    const target = w.inline ? resolveSpecifier(w.spec, loads.imports) : w.spec;
    loads.imported.push({ spec: w.spec, target, start: w.start, end: w.start + w.spec.length });
    // an inline script's import: a URL or a mapped name naming a package counts above; a relative module, or a name the
    // import map sends to a local file, is read
    if (!w.inline || namedPackages(w.spec).length > 0) continue;
    if (target === undefined || namedPackages(target).length > 0 || isUrl(target)) continue;
    if (isRelative(target)) locals.push({ path: pagePath(target), start: w.start, end: w.start + w.spec.length });
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
 * comment names only makes the rule quieter. What each module imports (with its comments blanked: a commented-out
 * import loads nothing) is recorded in `imported` and `references`, at the module and at what led the page to it.
 */
function readLocalModules(entries: readonly LocalEntry[], fileReader: FileReader | undefined, loads: PageLoads): void {
  if (fileReader === undefined) {
    loads.unclear = true;
    return;
  }
  const seen = new Set<string>();
  const queue: { spec: string; from: string; depth: number; start: number; end: number }[] =
    entries.map((entry) => ({ spec: entry.path, from: '', depth: 0, start: entry.start, end: entry.end }));
  while (queue.length > 0) {
    const { spec, from, depth, start, end } = queue.shift()!;
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
    for (const im of text.matchAll(IMPORT_SPECIFIER)) {
      if (namedPackages(im[2]).length > 0) continue;
      const target = resolveSpecifier(im[2], loads.imports);
      if (target === undefined || namedPackages(target).length > 0 || isUrl(target) || !isRelative(target)) continue;
      // a name the import map sends to a file is relative to the page, a relative specifier to the module
      queue.push({ spec: target, from: isRelative(im[2]) ? path : '', depth: depth + 1, start, end });
    }
    for (const im of blankJsComments(text).matchAll(IMPORT_SPECIFIER)) {
      const at = im.index! + im[0].indexOf(im[1]) + 1;
      const file: ModuleSite = { path, text, start: at, end: at + im[2].length, anchorEnd: end };
      loads.imported.push({ spec: im[2], target: moduleTarget(im[2], path, loads.imports), start, end, file });
      loads.references.push({ text: im[2], start, file });
    }
  }
}

/**
 * Where a local module's import leads, for the rules that read URLs: the import map's target for a name, the specifier
 * for a URL or a path from `/`, and a relative specifier as a path from the page (`./x.js` of `js/a.js` is `js/x.js`,
 * kept relative so the page's reader takes it).
 */
function moduleTarget(spec: string, from: string, imports: ReadonlyMap<string, string>): string | undefined {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return resolveSpecifier(spec, imports);
  const path = joinModulePath(from, spec);
  return path === undefined ? undefined : pagePath(path);
}
