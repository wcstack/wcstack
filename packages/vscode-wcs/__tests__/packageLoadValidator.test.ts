/**
 * packageLoadValidator.test.ts — the wcstack packages a page loads, against its tags (`wcs/tag-package-missing`) and
 * against the lint it is checked with (`wcs/lint-version-behind`).
 *
 * From the homeroom seam app (written on 4.2.0, upgraded to 4.10.1): a page wrote `<wcs-upload>` (with
 * `<wcs-upload-header>`) and never loaded `@wcstack/upload/auto` — Save hung at "送信中 0%" with nothing in the console
 * or the lint. And the page, upgraded, was still checked by `@wcstack/lint@4.2.0`: that lint passed it without the 4.10
 * rules and reported correct 4.10 syntax as an error.
 */
import { describe, it, expect } from 'vitest';
import { validatePackageLoads, packageOfTag } from '../src/service/packageLoadValidator';
import { ENGINE_VERSION } from '../src/service/wcsManifest';
import { validateDocument } from '../src/core/validateDocument';
import { runValidation } from '../src/core/cli/runValidation';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics';
import type { FileReader } from '../src/service/statePathResolver';

const STATE = '<script type="module" src="https://esm.run/@wcstack/state/auto"></script>';
const reader = (files: Record<string, string>): FileReader & { requested: string[] } => {
  const requested: string[] = [];
  const read = ((path: string) => {
    requested.push(path);
    return files[path];
  }) as FileReader & { requested: string[] };
  read.requested = requested;
  return read;
};
const missing = (html: string, fileReader?: FileReader, locale = 'en'): WcsDiagnostic[] =>
  validatePackageLoads(html, locale, fileReader).filter((d) => d.code === WcsDiagnosticCode.TagPackageMissing);
const behind = (html: string, locale = 'en'): WcsDiagnostic[] =>
  validatePackageLoads(html, locale).filter((d) => d.code === WcsDiagnosticCode.LintVersionBehind);

/** The lint's own version with the minor moved by `delta` (`4.10.1` → `4.11.0`). */
const lintMinor = (delta: number, patch = '0'): string => {
  const [major, minor] = ENGINE_VERSION.split('.').map(Number);
  return `${major}.${minor + delta}.${patch}`;
};

describe('packageOfTag — タグ → パッケージ', () => {
  it('生成カタログのタグ（ヘルパータグを含む）と、カタログの外の state / router / autoloader / devtools のタグを引けること', () => {
    expect(['wcs-upload', 'wcs-upload-header', 'wcs-ws', 'wcs-throttle', 'wcs-recorder', 'wcs-fetch-body', 'wcs-voice'].map(packageOfTag))
      .toEqual(['upload', 'upload', 'websocket', 'debounce', 'camera', 'fetch', 'audio']);
    expect(['wcs-state', 'wcs-ssr', 'wcs-router', 'wcs-guard-handler', 'wcs-layout-outlet', 'wcs-autoloader', 'wcs-devtools'].map(packageOfTag))
      .toEqual(['state', 'state', 'router', 'router', 'router', 'autoloader', 'devtools']);
    expect(['wcs-unknown', 'my-upload', 'wcs-toString'].map(packageOfTag)).toEqual([undefined, undefined, undefined]);
  });
});

describe('wcs/tag-package-missing — パッケージを読み込まずに書いたタグ', () => {
  const HOMEROOM = `<!doctype html><html><head>
${STATE}
<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
</head><body>
<wcs-state><script type="module">export default { uploadUrl: "/api/notes", progress: 0 };</script></wcs-state>
<wcs-upload data-wcs="url: uploadUrl; progress: progress">
  <wcs-upload-header name="X-Token" value="t"></wcs-upload-header>
</wcs-upload>
<wcs-upload></wcs-upload>
<wcs-fetch url="/api/list"></wcs-fetch>
</body></html>`;

  it('パッケージごとに 1 回、最初のタグの名前の上に warning を出し、読み込む /auto を言うこと（homeroom）', () => {
    const found = missing(HOMEROOM);
    expect(found.map((d) => [d.severity, HOMEROOM.slice(d.start, d.end), d.tag])).toEqual([['warning', 'wcs-upload', 'wcs-upload']]);
    expect(found[0].message).toBe('<wcs-upload>, <wcs-upload-header> are tags of @wcstack/upload, and this page loads no script of @wcstack/upload: the element is never defined, so its bindings wait and nothing happens, without a word in the console. Load it with <script type="module" src="https://esm.run/@wcstack/upload/auto"></script>');
    expect(missing(HOMEROOM, undefined, 'ja')[0].message).toBe('<wcs-upload>・<wcs-upload-header> は @wcstack/upload のタグですが、このページは @wcstack/upload のスクリプトを読み込んでいません。要素は定義されないので、その束縛は待ち続けて何も起きず、コンソールにも何も出ません — <script type="module" src="https://esm.run/@wcstack/upload/auto"></script> で読み込んでください');
  });

  it('タグがヘルパータグだけでも、そのパッケージとして報告すること。state・router のタグも数えること', () => {
    const html = `<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>
<wcs-upload-header name="a" value="b"></wcs-upload-header>
<wcs-state></wcs-state>
<wcs-router><template><wcs-route path="/"></wcs-route></template></wcs-router>`;
    expect(missing(html).map((d) => d.message.replace(/ (?:is a tag|are tags) of .*$/, ''))).toEqual([
      '<wcs-upload-header>', '<wcs-state>', '<wcs-router>, <wcs-route>',
    ]);
  });

  it('ページがすべての固定を同じ版にしていれば、その版の URL を案内すること', () => {
    const html = `<script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/state@4.10.1/dist/auto.min.js"></script>
<wcs-timer interval="1000"></wcs-timer>`;
    expect(missing(html)[0].message).toContain('src="https://esm.run/@wcstack/timer@4.10.1/auto"');
  });

  it('どの書き方でパッケージを読み込んでも報告しないこと（CDN・版・dist の路・一括バンドル・import map・inline の import・文字列・modulepreload）', () => {
    const tags = '<wcs-state></wcs-state>\n<wcs-upload></wcs-upload>';
    for (const load of [
      '<script type="module" src="https://esm.run/@wcstack/upload/auto"></script>',
      '<script type="module" src="https://esm.run/@wcstack/upload@4/auto"></script>',
      '<script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/upload@4.10.1/dist/auto.min.js" integrity="sha384-x" crossorigin="anonymous"></script>',
      '<script type="module" src="https://unpkg.com/@wcstack/upload@4.10.1/dist/auto.min.js"></script>',
      '<script type="module" src="/node_modules/@wcstack/upload/dist/auto.min.js"></script>',
      '<script type="module" src="/packages/upload/dist/auto.min.js"></script>',
      '<script type="importmap">{ "imports": { "@wcstack/upload/auto": "https://esm.run/@wcstack/upload/auto" } }</script>',
      '<script type="module">import "https://esm.run/@wcstack/upload/auto";</script>',
      '<script type="module">await import("https://esm.run/@wcstack/upload/auto");</script>',
      '<script>const s = document.createElement("script"); s.type = "module"; s.src = "https://esm.run/@wcstack/upload/auto"; document.head.append(s);</script>',
      '<link rel="modulepreload" href="https://esm.run/@wcstack/upload/auto">',
    ]) {
      expect(missing(`${STATE}\n${load}\n${tags}`), load).toEqual([]);
    }
    // the bundle carries state, router, fetch, storage and autoloader
    const bundle = '<script type="module" src="https://esm.run/wcstack@4/auto"></script>';
    expect(missing(`${bundle}\n<wcs-state></wcs-state><wcs-router></wcs-router><wcs-fetch></wcs-fetch><wcs-storage></wcs-storage>`)).toEqual([]);
    expect(missing(`${bundle}\n<wcs-timer></wcs-timer>`).map((d) => d.tag)).toEqual(['wcs-timer']);
  });

  it('wcstack を自分で読み込まないページ（断片・バンドラのページ）では黙ること', () => {
    expect(missing('<wcs-state></wcs-state>\n<wcs-upload></wcs-upload>')).toEqual([]);
    expect(missing('<script type="module" src="https://cdn.example.com/other.js"></script>\n<wcs-upload></wcs-upload>')).toEqual([]);
    // a bundler's page: the entry is a local module that imports the packages by name
    const vite = '<script type="module" src="/src/main.js"></script>\n<wcs-upload></wcs-upload>';
    expect(missing(vite, reader({}))).toEqual([]);
  });

  it('コメント・スクリプトの中・エスケープしたタグは数えないこと', () => {
    expect(missing(`${STATE}
<!-- <wcs-upload></wcs-upload> -->
<script type="module">const html = "<wcs-upload></wcs-upload>"; // <wcs-timer>
</script>
<p>&lt;wcs-upload&gt;</p>
<wcs-state></wcs-state>`)).toEqual([]);
  });

  it('autoloader の @components/ の名前空間・タグのキーが覆うタグは黙ること（autoloader がいるときだけ）', () => {
    const map = (key: string) => `<script type="importmap">{ "imports": { "${key}": "./components/wcs/" } }</script>`;
    const autoloader = '<script type="module" src="https://esm.run/@wcstack/autoloader/auto"></script>';
    const tags = '<wcs-state></wcs-state>\n<wcs-upload></wcs-upload>';
    expect(missing(`${STATE}\n${autoloader}\n${map('@components/wcs/')}\n${tags}`)).toEqual([]);
    expect(missing(`${STATE}\n${autoloader}\n${map('@components/wcs|vanilla/')}\n${tags}`)).toEqual([]);
    expect(missing(`${STATE}\n${autoloader}\n${map('@components/wcs-upload')}\n${tags}`)).toEqual([]);
    // the element written in the page (its package loaded by a local script — here, by the bundle)
    expect(missing(`${STATE}\n<wcs-autoloader></wcs-autoloader>\n${map('@components/wcs/')}\n${tags}`).map((d) => d.tag)).toEqual(['wcs-autoloader']);
    // a namespace that does not cover the tag, and a map without the autoloader
    expect(missing(`${STATE}\n${autoloader}\n${map('@components/app/')}\n${tags}`).map((d) => d.tag)).toEqual(['wcs-upload']);
    expect(missing(`${STATE}\n${map('@components/wcs/')}\n${tags}`).map((d) => d.tag)).toEqual(['wcs-upload']);
  });

  it('autoloader が読み込むコンポーネントのモジュール（名前空間・個別のキー）も読んで数え、読めなければ黙ること', () => {
    const page = (key: string, value: string) => `${STATE}
<script type="module" src="https://esm.run/@wcstack/autoloader/auto"></script>
<script type="importmap">{ "imports": { "${key}": "${value}" } }</script>
<wcs-state></wcs-state>
<app-main></app-main>
<button is="app-button"></button>
<wcs-fetch url="/api"></wcs-fetch>`;
    const loadsFetch = 'import "https://esm.run/@wcstack/fetch/auto";\nexport default class extends HTMLElement {}';
    const plain = 'export default class extends HTMLElement {}';
    // a namespace: <app-main> → ./components/main.js, is="app-button" → ./components/button.js
    const ns = reader({ 'components/main.js': loadsFetch, 'components/button.js': plain });
    expect(missing(page('@components/app/', './components/'), ns)).toEqual([]);
    expect(ns.requested).toEqual(['components/main.js', 'components/button.js']);
    expect(missing(page('@components/app|vanilla/', './components/'), reader({ 'components/main.js': plain, 'components/button.js': plain })).map((d) => d.tag))
      .toEqual(['wcs-fetch']);
    // an eager entry
    expect(missing(page('@components/app-main', './main.js'), reader({ 'main.js': loadsFetch }))).toEqual([]);
    expect(missing(page('@components/app-main', './main.js'), reader({ 'main.js': plain })).map((d) => d.tag)).toEqual(['wcs-fetch']);
    // a module it cannot read
    expect(missing(page('@components/app/', './components/'), reader({}))).toEqual([]);
    // a URL is not read (the tag is reported unless something names the package)
    expect(missing(page('@components/app/', 'https://cdn.example.com/app/'), reader({})).map((d) => d.tag)).toEqual(['wcs-fetch']);
  });

  it('ローカルのスクリプトは読んで数え、読めなければ黙ること', () => {
    const page = `${STATE}\n<script type="module" src="app.js"></script>\n<wcs-state></wcs-state>\n<wcs-upload></wcs-upload>`;
    // a module that imports the package (directly, or through a relative module)
    expect(missing(page, reader({ 'app.js': 'import "https://esm.run/@wcstack/upload/auto";' }))).toEqual([]);
    const nested = reader({ 'app.js': 'import { x } from "./lib/load.js";', 'lib/load.js': 'export const x = 1;\nimport "../vendor/upload.js";', 'vendor/upload.js': 'customElements.define("wcs-upload", class extends HTMLElement {});' });
    expect(missing(page, nested)).toEqual([]);
    expect(nested.requested).toEqual(['app.js', 'lib/load.js', 'vendor/upload.js']);
    // a module that loads something else: the tag is reported
    expect(missing(page, reader({ 'app.js': 'console.log("hi");' })).map((d) => d.tag)).toEqual(['wcs-upload']);
    // unreadable (no file, no reader): what it loads is unknown
    expect(missing(page, reader({}))).toEqual([]);
    expect(missing(page)).toEqual([]);
  });

  it('ほかのものを読むスクリプト・データのブロック・壊れた import map・読み込まない link は数えず、それでもタグを報告すること', () => {
    const page = `${STATE}
<script type="application/json">{ "src": "https://esm.run/@wcstack/upload/auto" }</script>
<script type="text/plain">import "https://esm.run/@wcstack/upload/auto";</script>
<script type="text/javascript">console.log("classic");</script>
<script type="importmap">{ broken </script>
<script type="importmap">{ "scopes": {} }</script>
<link rel="stylesheet" href="https://esm.run/@wcstack/upload/style.css">
<script type="module">import "https://cdn.example.com/other.js"; import "lodash"; import "./a.js"; import "./a.js";</script>
<wcs-upload></wcs-upload>`;
    const files = reader({ 'a.js': 'import "https://cdn.example.com/x.js"; import "lodash"; import "./a.js";' });
    expect(missing(page, files).map((d) => d.tag)).toEqual(['wcs-upload']);
    expect(files.requested).toEqual(['a.js']);
  });

  it('深すぎる・多すぎる import の連鎖は読みきれないので黙ること', () => {
    const page = `${STATE}\n<script type="module" src="./m0.js"></script>\n<wcs-upload></wcs-upload>`;
    const chain: Record<string, string> = {};
    for (let i = 0; i < 8; i++) chain[`m${i}.js`] = `import "./m${i + 1}.js";`;
    chain['m8.js'] = '';
    expect(missing(page, reader(chain))).toEqual([]);
    const wide: Record<string, string> = { 'm0.js': Array.from({ length: 40 }, (_, i) => `import "./w${i}.js";`).join('\n') };
    for (let i = 0; i < 40; i++) wide[`w${i}.js`] = '';
    expect(missing(page, reader(wide))).toEqual([]);
    // within the limits, the chain is read to its end
    expect(missing(page, reader({ 'm0.js': 'import "./m1.js";', 'm1.js': '' })).map((d) => d.tag)).toEqual(['wcs-upload']);
  });

  it('ページの固定が版ごとに違えば、版の無い URL を案内すること', () => {
    const html = `<script type="module" src="https://esm.run/@wcstack/state@4.10.1/auto"></script>
<script type="module" src="https://esm.run/@wcstack/fetch@4.9.0/auto"></script>
<wcs-timer></wcs-timer>`;
    expect(missing(html)[0].message).toContain('src="https://esm.run/@wcstack/timer/auto"');
  });

  it('import map が送るローカルのファイルはページから相対に読むこと', () => {
    const page = `${STATE}
<script type="importmap">{ "imports": { "app": "./js/app.js", "lib/": "./js/lib/" } }</script>
<script type="module">import "app";</script>
<wcs-upload></wcs-upload>`;
    const files = reader({ 'js/app.js': 'import "lib/up.js";', 'js/lib/up.js': 'import "https://esm.run/@wcstack/upload/auto";' });
    expect(missing(page, files)).toEqual([]);
    expect(files.requested).toEqual(['js/app.js', 'js/lib/up.js']);
  });

  it('validateDocument と CLI: warning なので --strict では落ち、--errors-only では落ちないこと', () => {
    expect(validateDocument(HOMEROOM, { locale: 'en' }).filter((d) => d.code === WcsDiagnosticCode.TagPackageMissing)).toHaveLength(1);
    const strict = runValidation([{ source: 'homeroom.html', text: HOMEROOM, kind: 'html' }], { strict: true, locale: 'en' });
    expect(strict.exitCode).toBe(1);
    expect(strict.lines.filter((l) => l.includes('wcs/tag-package-missing')).map((l) => l.replace(/ <wcs-upload>.*$/, '')))
      .toEqual(['homeroom.html:6:2 warning wcs/tag-package-missing']);
    const errorsOnly = runValidation([{ source: 'homeroom.html', text: HOMEROOM, kind: 'html' }], { errorsOnly: true, locale: 'en' });
    expect(errorsOnly.exitCode).toBe(0);
  });
});

describe('wcs/lint-version-behind — lint の規則より新しい minor を固定したページ', () => {
  it('lint より新しい minor の固定に、ページで 1 回、いちばん新しいものの上に warning を出すこと', () => {
    const newer = lintMinor(1);
    const newest = lintMinor(2, '3');
    const html = `<script type="module" src="https://esm.run/@wcstack/state@${newer}/auto"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/@wcstack/fetch@${newest}/dist/auto.min.js"></script>`;
    const found = behind(html);
    expect(found.map((d) => [d.severity, html.slice(d.start, d.end)])).toEqual([['warning', `@wcstack/fetch@${newest}`]]);
    const minor = newest.split('.').slice(0, 2).join('.');
    expect(found[0].message).toBe(`This page pins @wcstack/fetch@${newest}, a newer minor than the rules of this lint (@wcstack ${ENGINE_VERSION}): what ${minor} added is not checked, and correct ${minor} syntax can be reported as an error. Upgrade @wcstack/lint to ${newest} (npm i -D @wcstack/lint@${newest}; the VS Code extension to its release for ${minor})`);
    expect(behind(html, 'ja')[0].message).toBe(`このページは @wcstack/fetch@${newest} を固定していますが、この lint の規則（@wcstack ${ENGINE_VERSION}）より新しい minor です。${minor} で加わった規則は検査されず、${minor} の正しい書き方が error になることもあります — @wcstack/lint を ${newest} に上げてください（npm i -D @wcstack/lint@${newest}。VS Code の拡張は ${minor} に対応する版へ）`);
  });

  it('import map・inline の import・一括バンドル・major.minor だけ・プレリリースの固定も比べること', () => {
    const v = lintMinor(1);
    const mm = v.split('.').slice(0, 2).join('.');
    for (const [html, spec] of [
      [`<script type="importmap">{ "imports": { "@wcstack/state/auto": "https://esm.run/@wcstack/state@${v}/auto" } }</script>`, `@wcstack/state@${v}`],
      [`<script type="module">import "https://esm.run/@wcstack/router@${v}/auto";</script>`, `@wcstack/router@${v}`],
      [`<script type="module" src="https://esm.run/wcstack@${v}/auto"></script>`, `wcstack@${v}`],
      [`<script type="module" src="https://esm.run/@wcstack/state@${mm}/auto"></script>`, `@wcstack/state@${mm}`],
      [`<script type="module" src="https://esm.run/@wcstack/state@${v}-rc.1/auto"></script>`, `@wcstack/state@${v}-rc.1`],
    ]) {
      const found = behind(html);
      expect(found.map((d) => html.slice(d.start, d.end)), html).toEqual([spec]);
    }
  });

  it('版の無い URL・major だけの固定・lint と同じか古い minor・別の major・コメントは比べないこと', () => {
    const [major, minor] = ENGINE_VERSION.split('.').map(Number);
    for (const html of [
      '<script type="module" src="https://esm.run/@wcstack/state/auto"></script>',
      `<script type="module" src="https://esm.run/@wcstack/state@${major}/auto"></script>`,
      `<script type="module" src="https://esm.run/@wcstack/state@${major}.${minor}.99/auto"></script>`,
      `<script type="module" src="https://esm.run/@wcstack/state@${major}.${Math.max(0, minor - 1)}.0/auto"></script>`,
      `<script type="module" src="https://esm.run/@wcstack/state@${major + 1}.0.0/auto"></script>`,
      `<!-- <script type="module" src="https://esm.run/@wcstack/state@${lintMinor(1)}/auto"></script> -->`,
      `<script type="module" src="https://esm.run/my-wcstack@${lintMinor(1)}/auto"></script>`,
    ]) {
      expect(behind(html), html).toEqual([]);
    }
  });

  it('ENGINE_VERSION は lint を作った @wcstack/state の版であること', async () => {
    const pkg = await import('../node_modules/@wcstack/state/package.json');
    expect(ENGINE_VERSION).toBe(pkg.version);
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
