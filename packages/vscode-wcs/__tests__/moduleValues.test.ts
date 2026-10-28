/**
 * moduleValues.test.ts — the values a state's keys are written as names: shorthand keys (`{ lang, t }`), a module's
 * constants, and imports, followed to the expression they are bound to (service/moduleValues.ts).
 *
 * From the city-library seam app: `<wcs-state mount="i18n" src="../i18n/state.js">` — the dictionary volume the state
 * README and examples/router-i18n recommend — is `import { lang, dir, t } from "./catalog.js"; export default { lang,
 * dir, t };`. The shorthand keys were not read at all, so every `i18n.t.*` binding was a false
 * `wcs/binding-path-missing` (103 of the page's 108 warnings). A name is followed to a literal where it can be; where
 * it cannot (`t` is computed by a merge of dynamic imports), the key's contents are unknown: nothing under it is
 * reported missing, and `wcs/path-dynamic-unknown` (info) says so once, at the key, when the page binds under it.
 */
import { describe, it, expect } from 'vitest';
import { ModuleScope, joinModulePath, parseTypeImport } from '../src/service/moduleValues';
import { analyzeStatePaths } from '../src/service/stateAnalyzer';
import { getStatePathIndex, isUnresolvedPath, type FileReader } from '../src/service/statePathResolver';
import { validateDocument } from '../src/core/validateDocument';
import { runValidation } from '../src/core/cli/runValidation';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics';

/** A reader of the given files (paths as the page's reader takes them); the paths asked for go to `requested`. */
function filesReader(files: Record<string, string>): FileReader & { requested: string[] } {
  const requested: string[] = [];
  const reader = ((path: string) => {
    requested.push(path);
    return files[path];
  }) as FileReader & { requested: string[] };
  reader.requested = requested;
  return reader;
}

const names = (script: string, files?: Record<string, string>, path = ''): string[] =>
  analyzeStatePaths(script, files === undefined ? undefined : { fileReader: filesReader(files), path }).map((p) => p.path);

describe('joinModulePath — モジュールからの相対の指定子を、ページの reader が受け取るパスにする', () => {
  it('相対の指定子をモジュールのディレクトリから解決すること', () => {
    expect(joinModulePath('', './catalog.js')).toBe('catalog.js');
    expect(joinModulePath('../i18n/state.js', './catalog.js')).toBe('../i18n/catalog.js');
    expect(joinModulePath('../i18n/state.js', '../app.js')).toBe('../app.js');
    expect(joinModulePath('a/b/c.js', '../../d.js')).toBe('d.js');
    expect(joinModulePath('x.js', '../up.js')).toBe('../up.js');
    expect(joinModulePath('./state.js', './catalog.js?v=2#x')).toBe('./catalog.js');
  });

  it('/ から始まる指定子はそのまま（reader が根を知るときだけ読む）、/ から始まるモジュールの相対はその根の下に留まること', () => {
    expect(joinModulePath('', '/i18n/catalog.js')).toBe('/i18n/catalog.js');
    expect(joinModulePath('/i18n/state.js', './catalog.js')).toBe('/i18n/catalog.js');
    expect(joinModulePath('/state.js', '../../x.js')).toBe('/x.js');
  });

  it('素の指定子・URL・protocol-relative は読まないこと', () => {
    for (const spec of ['@wcstack/state', 'lodash', 'https://esm.run/x.js', '//cdn.example/x.js']) {
      expect(joinModulePath('', spec), spec).toBeUndefined();
    }
  });
});

describe('ModuleScope — 名前が束縛する式', () => {
  const files = {
    'catalog.js': `import { mergeAndFreeze } from "./merge.js";
export const SUPPORTED = ["ja", "en"];
const FALLBACK = "en";
export const lang = SUPPORTED.includes(document.documentElement.lang) ? document.documentElement.lang : FALLBACK;
export const t = mergeAndFreeze({}, {});
/** @type {typeof import("./en.js").default} */
export const typed = mergeAndFreeze({}, {});
export { FALLBACK as fallbackLang };
export { default as en } from "./en.js";
export * from "./more.js";`,
    'en.js': 'const site = { name: "City" };\nexport default { site };',
    'more.js': 'export const extra = { a: 1 };\nexport default { never: true };',
    'ts-only.ts': 'export const fromTs = { b: 2 };',
    'loop-a.js': 'export { x } from "./loop-b.js";',
    'loop-b.js': 'export { x } from "./loop-a.js";',
  };
  const scope = new ModuleScope(`import { t, lang, SUPPORTED, typed, fallbackLang, en, extra } from "./catalog.js";
import def from "./en.js";
import * as ns from "./en.js";
import { fromTs } from "./ts-only.js";
import { x } from "./loop-a.js";
import { pkg } from "@wcstack/state";
const LOCAL = [{ id: 1 }];
const ALIAS = LOCAL;
let later = { y: 1 };
function helper() {}
export default { t };`, { fileReader: filesReader(files), path: '' });

  it('モジュールの const・その別名・import（名前付き・既定・別名の再 export・export *）を辿ること', () => {
    expect(scope.resolveName('LOCAL')?.text).toBe('[{ id: 1 }]');
    expect(scope.resolveName('ALIAS')?.text).toBe('[{ id: 1 }]');
    expect(scope.resolveName('SUPPORTED')?.text).toBe('["ja", "en"]');
    expect(scope.resolveName('fallbackLang')?.text).toBe('"en"');
    expect(scope.resolveName('def')?.text).toBe('{ site }');
    expect(scope.resolveName('en')?.text).toBe('{ site }');
    expect(scope.resolveName('extra')?.text).toBe('{ a: 1 }');
    // 読んだ式の中の名前は、その式のモジュールで解決する
    expect(scope.resolveName('def')?.scope.resolveName('site')?.text).toBe('{ name: "City" }');
  });

  it('計算する式は式のまま返す（読めるかは呼び出し側が決める）', () => {
    expect(scope.resolveName('t')?.text).toBe('mergeAndFreeze({}, {})');
    expect(scope.resolveName('lang')?.text).toContain('SUPPORTED.includes(');
  });

  it('宣言の前の JSDoc `@type {typeof import("./en.js").default}` が値を指すこと', () => {
    expect(parseTypeImport('typeof import("./en.js").default')).toEqual({ specifier: './en.js', name: 'default' });
    expect(parseTypeImport("typeof import('./catalog.js').t")).toEqual({ specifier: './catalog.js', name: 't' });
    expect(parseTypeImport('{ a: string }')).toBeNull();
    expect(parseTypeImport('typeof import("./en.js")')).toBeNull();
    expect(scope.resolveName('typed')?.text).toBe('{ site }');
  });

  it('.js が無ければ同名の .ts を読むこと', () => {
    expect(scope.resolveName('fromTs')?.text).toBe('{ b: 2 }');
  });

  it('辿れないもの — 名前空間の import・let・関数・素の指定子・循環・宣言の無い名前 — は null', () => {
    for (const name of ['ns', 'later', 'helper', 'pkg', 'x', 'undeclared']) {
      expect(scope.resolveName(name), name).toBeNull();
    }
    expect(scope.importOf('t')).toBe('./catalog.js');
    expect(scope.importOf('LOCAL')).toBeUndefined();
  });

  it('reader の無いモジュールは import を辿らず、モジュールの中の const だけを読むこと', () => {
    const bare = new ModuleScope('import { t } from "./catalog.js";\nconst A = { a: 1 };\nexport default { t, A };', undefined);
    expect(bare.resolveName('A')?.text).toBe('{ a: 1 }');
    expect(bare.resolveName('t')).toBeNull();
  });

  it('パースできないモジュール（TypeScript の型注釈）では何も辿らないこと', () => {
    const ts = new ModuleScope('const A: { a: number } = { a: 1 };\nexport default { A };', undefined);
    expect(ts.resolveName('A')).toBeNull();
  });
});

describe('analyzeStatePaths — 名前で書いたキーの値', () => {
  it('短縮プロパティ（`{ lang, t }`）をキーとして読むこと（以前はキーが 1 つも無かった）', () => {
    const paths = analyzeStatePaths(`const branches = ["main", "minor"];
const currentBranch = branches[0];
export default { branches, currentBranch, count: 0, get label() { return ""; } };`);
    expect(paths.map((p) => p.path)).toEqual(expect.arrayContaining(['branches', 'branches.*', 'branches.length', 'currentBranch', 'count', 'label']));
    // 読めた値はリストの形を持ち、計算した値は中身が分からない
    expect(paths.find((p) => p.path === 'branches')?.opaque).toBeUndefined();
    expect(paths.find((p) => p.path === 'currentBranch')?.opaque).toEqual({ name: 'currentBranch' });
  });

  it('モジュールの const・Object.freeze・入れ子の名前を辿って形を読むこと', () => {
    const all = names(`const NAV = Object.freeze({ home: "Home", search: "Search" });
const PRODUCTS = [{ id: 1, name: "a", price: 2 }];
const SITE = { name: "x", nav: NAV };
export default {
  products: PRODUCTS,
  site: SITE,
  frozen: Object.freeze({ deep: { leaf: 1 } }),
  inline: { nav: NAV },
};`);
    for (const path of ['products.*.id', 'products.*.price', 'site.name', 'site.nav.home', 'frozen.deep.leaf', 'inline.nav.search']) {
      expect(all, path).toContain(path);
    }
  });

  it('import をモジュールの位置から辿ること（ボリュームの辞書 — city-library / examples/router-i18n の形）', () => {
    const files = {
      '../i18n/catalog.js': 'import en from "./en.js";\nexport const lang = "en";\nexport const t = en;',
      '../i18n/en.js': 'export default { site: { name: "City" }, list: [{ label: "a" }] };',
    };
    const all = names('import { lang, t } from "./catalog.js";\nexport default { lang, t };', files, '../i18n/state.js');
    expect(all).toEqual(expect.arrayContaining(['lang', 't', 't.site', 't.site.name', 't.list.*.label']));
  });

  it('辿れない値は中身の分からないキー（opaque）で、何を辿ったかを持つこと', () => {
    const paths = analyzeStatePaths(`import { t } from "./catalog.js";
import { gone } from "./missing.js";
const computed = make();
export default { t, gone, computed, called: make(), plain: null };`, {
      fileReader: filesReader({ 'catalog.js': 'export const t = merge(a, b);' }),
      path: '',
    });
    const of = (path: string) => paths.find((p) => p.path === path);
    expect(of('t')?.opaque).toEqual({ name: 't', from: './catalog.js' });
    expect(of('gone')?.opaque).toEqual({ name: 'gone', from: './missing.js' });
    expect(of('computed')?.opaque).toEqual({ name: 'computed' });
    // その場に書いた式は今までどおり（中身を「無い」と読む）
    expect(of('called')?.opaque).toBeUndefined();
    expect(of('plain')?.opaque).toBeUndefined();
  });

  it('キーの JSDoc `@type` が形を宣言していれば opaque にしない・`typeof import(…)` は値を指すこと', () => {
    const paths = analyzeStatePaths(`import { t } from "./catalog.js";
export default {
  /** @type {{ site: { name: string } }} */ t,
  /** @type {typeof import("./en.js").default} */ dict: t,
};`, { fileReader: filesReader({ 'catalog.js': 'export const t = merge();', 'en.js': 'export default { nav: { home: "" } };' }), path: '' });
    const all = paths.map((p) => p.path);
    expect(paths.find((p) => p.path === 't')?.opaque).toBeUndefined();
    expect(all).toContain('t.site.name');
    expect(paths.find((p) => p.path === 'dict')?.opaque).toBeUndefined();
    expect(all).toContain('dict.nav.home');
  });

  it('名前の値から取る型ヒントは形（array / object）だけ — プリミティブの型で束縛の型の検査を変えない', () => {
    const paths = analyzeStatePaths(`const MIN = 1;
const LIST = [];
const OBJ = {};
export default { min: MIN, list: LIST, obj: OBJ };`);
    const hint = (path: string) => paths.find((p) => p.path === path)?.typeHint;
    expect([hint('min'), hint('list'), hint('obj')]).toEqual([undefined, 'array', 'object']);
  });
});

describe('statePathResolver — opaque なキーの下は「分からない」', () => {
  it('opaque なパスの下（添字のパスも）を isUnresolvedPath とし、そのパス自身とほかは分かるとすること', () => {
    const html = `<wcs-state><script type="module">
import { t } from "./catalog.js";
export default { t, count: 0, rows: [{ meta: META }] };
</script></wcs-state>`;
    const { scopes } = getStatePathIndex(html, 'wcs-state', filesReader({}));
    expect(scopes.opaquePaths).toEqual(['t', 'rows.*.meta']);
    const unresolved = (path: string) => isUnresolvedPath(path, scopes);
    expect(['t.site.name', 'rows.*.meta.x', 'rows.0.meta.x'].map(unresolved)).toEqual([true, true, true]);
    expect(['t', 'count', 'cuont', 'tt.x'].map(unresolved)).toEqual([false, false, false, false]);
  });
});

describe('validateDocument — src= で読む辞書のボリューム（city-library の継ぎ目アプリ）', () => {
  const PAGE = `<p data-wcs="textContent: i18n.t.site.name"></p>
<p data-wcs="textContent: i18n.t.nav.home"></p>
<p>{{ i18n.lang }}</p>
<p data-wcs="textContent: i18n.lnag"></p>
<template data-wcs="for: i18n.t.list"><span data-wcs="textContent: .label"></span></template>
<wcs-state mount="i18n" src="../i18n/state.js"></wcs-state>
<wcs-state><script type="module">export default { count: 0 };</script></wcs-state>`;
  const CATALOG = `import { mergeAndFreeze } from "./merge.js";
export const lang = document.documentElement.lang === "ja" ? "ja" : "en";
const [current] = await Promise.all([import(\`./\${lang}.js\`)]);
export const t = mergeAndFreeze(current.default, current.default);`;
  const STATE = 'import { lang, t } from "./catalog.js";\n\nexport default { lang, t };\n';
  const findings = (files: Record<string, string>): WcsDiagnostic[] =>
    validateDocument(PAGE, { locale: 'en', fileReader: filesReader(files) })
      .filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing || d.code === WcsDiagnosticCode.PathDynamicUnknown);

  it('計算した辞書（mergeAndFreeze）の下は黙り、その場所で 1 回だけ info で言うこと。ボリュームの打ち間違いは報告すること', () => {
    const found = findings({ '../i18n/state.js': STATE, '../i18n/catalog.js': CATALOG });
    expect(found.map((d) => [d.code, d.severity, d.origin === undefined ? PAGE.slice(d.start, d.end) : d.origin.path])).toEqual([
      [WcsDiagnosticCode.BindingPathMissing, 'warning', 'i18n.lnag'],
      [WcsDiagnosticCode.PathDynamicUnknown, 'info', '../i18n/state.js'],
    ]);
    const info = found[1];
    // ファイルの中のキーの位置（`export default { lang, t }` の t）
    expect(STATE.slice(info.origin!.start, info.origin!.end)).toBe('t');
    expect(info.message).toContain('"i18n.t" (t, imported from "./catalog.js")');
    expect(info.message).toContain('the 3 paths bound under it are not checked');
    expect(info.message).toContain('typeof import("./file.js").name');
  });

  it('辞書の宣言に `@type {typeof import("./en.js").default}` を書けば、全部のキーを持つファイルで検査すること', () => {
    const typed = CATALOG.replace('export const t =', '/** @type {typeof import("./en.js").default} */\nexport const t =');
    const found = findings({
      '../i18n/state.js': STATE,
      '../i18n/catalog.js': typed,
      '../i18n/en.js': 'const nav = { hmoe: "Home" };\nexport default { site: { name: "City" }, nav, list: [{ lable: "a" }] };',
    });
    expect(found.map((d) => PAGE.slice(d.start, d.end))).toEqual(['i18n.t.nav.home', 'i18n.lnag', '.label']);
  });

  it('import は state のファイルから相対に読み、ページからではないこと（2 回目の検査 — スクリプトをページに入れて読む — も同じ）', () => {
    const reader = filesReader({ '../i18n/state.js': STATE, '../i18n/catalog.js': CATALOG, 'catalog.js': 'export const t = { wrong: 1 };' });
    validateDocument(PAGE, { locale: 'en', fileReader: reader });
    expect(reader.requested).toContain('../i18n/catalog.js');
    expect(reader.requested).not.toContain('catalog.js');
  });

  it('ページに書いたスクリプトの import はページから相対に読むこと', () => {
    const page = `<wcs-state><script type="module">
import { dict } from "./dict.js";
export default { dict };
</script></wcs-state>
<p data-wcs="textContent: dict.title"></p>
<p data-wcs="textContent: dict.titel"></p>`;
    const found = validateDocument(page, { locale: 'en', fileReader: filesReader({ 'dict.js': 'export const dict = { title: "x" };' }) })
      .filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing);
    expect(found.map((d) => page.slice(d.start, d.end))).toEqual(['dict.titel']);
  });

  it('CLI: 辞書のボリュームのページは --strict でも exit 0 で、info は state のファイルに 1 回だけ出ること', () => {
    const reader = filesReader({ '../i18n/state.js': STATE, '../i18n/catalog.js': CATALOG });
    const page = PAGE.replace('<p data-wcs="textContent: i18n.lnag"></p>\n', '');
    const result = runValidation([
      { source: 'site/a.html', text: page, kind: 'html', fileReader: reader },
      { source: 'site/b.html', text: page, kind: 'html', fileReader: reader },
    ], { strict: true, locale: 'en' });
    expect(result.exitCode).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.lines.filter((l) => l.includes('wcs/path-dynamic-unknown')).map((l) => l.replace(/ The value.*$/, '')))
      .toEqual(['i18n/state.js:3:24 info wcs/path-dynamic-unknown']);
  });
});
