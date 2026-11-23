/**
 * componentPartsLint.test.ts — lint がクラスの部品（`bind-component`）を読む（継ぎ目アプリ garden-plots、4.29。
 * docs/v4-direction-2026-10.md §5.25）。4.28 までの検査器はクラスのファイルを読まなかった:
 *
 *   - 部品の state の getter は、マウントした所のパスとして読める（`user.display`、行なら `users.*.display`）。
 *     ページがそれを読むと「存在しない」と誤報していた
 *   - 部品のメソッドの `this.tenant.name = v` と `this.plots.push(p)` は、ページと同じく state を通らない。
 *     ページではエラー（`wcs/nested-assign`・`wcs/array-mutation`）なのに、クラスのファイルでは何も言わなかった
 *   - 部品のテンプレートのパスは、先頭のキーが部品にも・渡されたものにも・マウント先のオブジェクトにも無いときに
 *     報告する（`wcs/binding-path-missing`）。実行時（4.28）と同じ基準。マウント先の形が分からないときは黙る
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import { collectClassParts, findMountSites } from '../src/service/componentParts.js';

const CARD = `const TEMPLATE = \`
<wcs-state bind-component="state"></wcs-state>
<h3 data-wcs="textContent: name"></h3>
<template data-wcs="for: tiles"><x-tile data-wcs="state: ."></x-tile></template>
\`;
export default class XCard extends HTMLElement {
  state = {
    folded: false,
    get display() { return this.name + "!"; },
    get total() { return 1; },
    get "tiles.*.label"() { return this[".no"]; },
    toggle() { this.folded = !this.folded; },
  };
  connectedCallback() { this.attachShadow({ mode: "open" }).innerHTML = TEMPLATE; }
}`;
const TILE = `export default class XTile extends HTMLElement {
  state = {
    get short() { return String(this.no).slice(0, 2); },
  };
  connectedCallback() {
    this.attachShadow({ mode: "open" }).innerHTML = '<wcs-state bind-component="state"></wcs-state><b data-wcs="textContent: no"></b>';
  }
}`;
const MAP = `<script type="importmap">{ "imports": { "@components/x-card": "./parts/x-card.js", "@components/x-tile": "./parts/x-tile.js" } }</script>`;
const STATE = `<wcs-state><script type="module">
export default {
  user: { name: "a", tiles: [{ no: "A-01" }] },
  users: [{ name: "a", tiles: [{ no: "A-01" }] }],
  view: { filter: "all" },
};
</script></wcs-state>`;
const FILES: Record<string, string> = { './parts/x-card.js': CARD, './parts/x-tile.js': TILE };

const run = (html: string, files: Record<string, string> = FILES, locale = 'en'): WcsDiagnostic[] =>
  validateDocument(html, { locale, fileReader: (path) => files[path] });
/** ページ自身の束縛の「パスが無い」（部品のファイルの中の所見 — origin 付き — は別に見る）。 */
const missing = (html: string, files: Record<string, string> = FILES): string[] =>
  run(html, files).filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing && d.origin === undefined).map((d) => html.slice(d.start, d.end));

describe('部品が公開する getter — マウントした所のパスとして読める', () => {
  it('丸ごとマウントした部品の getter を、ページがマウント先のパスで読める。部品に無い名前は報告する', () => {
    const html = `${MAP}\n${STATE}
<x-card data-wcs="state: user"></x-card>
<p data-wcs="textContent: user.display"></p><p data-wcs="textContent: user.total"></p>
<p data-wcs="textContent: user.dispaly"></p><p data-wcs="textContent: user.folded"></p><p data-wcs="textContent: user.toggle"></p>`;
    // （非公開のデータキーとメソッドは、マウント先からは見えない）
    expect(missing(html)).toEqual(['user.dispaly', 'user.folded', 'user.toggle']);
  });

  it('行にマウントした部品の getter は、行のフィールドとして読める（.display・users.*.display）', () => {
    const html = `${MAP}\n${STATE}
<template data-wcs="for: users">
  <x-card data-wcs="state: ."></x-card>
  <p data-wcs="textContent: .display"></p><p>{{ .total }} {{ .nope }}</p>
</template>
<p data-wcs="textContent: users.0.display"></p>`;
    expect(missing(html)).toEqual(['.nope']);
  });

  it('部品の中にマウントした部品の getter も、外側のマウント先の下で読める', () => {
    const html = `${MAP}\n${STATE}
<x-card data-wcs="state: user"></x-card>
<p data-wcs="textContent: user.tiles.0.short"></p><p data-wcs="textContent: user.tiles.0.shrt"></p>`;
    expect(missing(html)).toEqual(['user.tiles.0.shrt']);
  });

  it('部品を読めなければ、これまでどおり（読めないファイル・import map に無いタグ・reader なし）', () => {
    const html = `${MAP}\n${STATE}\n<x-card data-wcs="state: user"></x-card><p data-wcs="textContent: user.display"></p>`;
    expect(missing(html, {})).toEqual(['user.display']);
    expect(missing(html.replace(MAP, ''))).toEqual(['user.display']);
    expect(validateDocument(html, { locale: 'en' }).filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing)).toHaveLength(1);
  });

  it('木が持つキーは、部品の getter より先（重ねて足さない）。キーごとの受け渡し（state.x:）は公開しない', () => {
    const state = STATE.replace('user: { name: "a",', 'user: { name: "a", display: "own",');
    const html = `${MAP}\n${state}\n<x-card data-wcs="state: user"></x-card><p data-wcs="textContent: user.display"></p>`;
    expect(run(html)).toEqual([]);
    const partial = `${MAP}\n${STATE}\n<x-card data-wcs="state.view: view"></x-card><p data-wcs="textContent: view.display"></p>`;
    expect(missing(partial)).toEqual(['view.display']);
  });

  it('#ro のマウント・名前空間のキー・ページが読み込むモジュールの customElements.define・.ts のファイルからも読む', () => {
    const page = (map: string, extra = ''): string => `${map}\n${STATE}\n${extra}<x-card data-wcs="state#ro: user"></x-card><p data-wcs="textContent: user.display"></p>`;
    expect(missing(page(MAP))).toEqual([]);
    expect(missing(page('<script type="importmap">{ "imports": { "@components/x/": "./parts/" } }</script>'), { './parts/card.js': CARD })).toEqual([]);
    const main = `import { XCard } from "./card.js";\ncustomElements.define("x-card", XCard);`;
    const card = CARD.replace('export default class XCard', 'export class XCard');
    expect(missing(page('', '<script type="module" src="./main.js"></script>'), { './main.js': main, './card.js': card })).toEqual([]);
    const ts = CARD.replace('state = {', 'state: Record<string, unknown> = {').replace('get display() {', 'get display(): string {');
    expect(missing(page('<script type="importmap">{ "imports": { "@components/x-card": "./parts/x-card.ts" } }</script>'), { './parts/x-card.ts': ts })).toEqual([]);
  });

  it('コンストラクタで this.state = { … } と書いた部品・bind-component の名前が state でない部品', () => {
    const ctor = `export default class extends HTMLElement {
  constructor() { super(); this.vm = { get display() { return "x"; } }; }
  connectedCallback() { this.innerHTML = '<wcs-state bind-component="vm"></wcs-state>'; }
}`;
    const html = `<script type="importmap">{ "imports": { "@components/x-card": "./c.js" } }</script>\n${STATE}
<x-card data-wcs="vm: user"></x-card><p data-wcs="textContent: user.display"></p>`;
    expect(missing(html, { './c.js': ctor })).toEqual([]);
    // その名前でマウントしていなければ、公開されない
    expect(missing(html.replace('vm: user', 'state: user'), { './c.js': ctor })).toEqual(['user.display']);
  });

  it('確かでない部品は読まない: スプレッド・計算されたキー・呼び出しで作る state・クラスが見つからないファイル', () => {
    const page = `<script type="importmap">{ "imports": { "@components/x-card": "./c.js" } }</script>\n${STATE}
<x-card data-wcs="state: user"></x-card><p data-wcs="textContent: user.display"></p>`;
    const cls = (state: string): string => `const base = {};\nconst k = "display";\nexport default class extends HTMLElement { state = ${state}; }`;
    expect(missing(page, { './c.js': cls('{ ...base, get display() { return 1; } }') })).toEqual(['user.display']);
    expect(missing(page, { './c.js': cls('{ [k]: 1, get display() { return 1; } }') })).toEqual(['user.display']);
    expect(missing(page, { './c.js': cls('make()') })).toEqual(['user.display']);
    expect(missing(page, { './c.js': 'export const x = 1;' })).toEqual(['user.display']);
    expect(missing(page, { './c.js': 'this is not javascript {' })).toEqual(['user.display']);
  });

  it('collectClassParts / findMountSites: 読んだ部品と、マウントの場所', () => {
    const html = `${MAP}\n${STATE}\n<template data-wcs="for: users"><x-card data-wcs="state: .; state.view: view; state.a.b: view.filter"></x-card></template>`;
    const parts = collectClassParts(html, (path) => FILES[path]);
    expect([...parts.keys()].sort()).toEqual(['x-card', 'x-tile']);
    const card = parts.get('x-card')!;
    expect(card.getters).toEqual(['display', 'total']);
    // （`get "tiles.*.label"()` は木の上のアクセサで、部品自身のキーではない）
    expect(card.keys).toEqual(['folded', 'display', 'total', 'toggle']);
    expect(card.stateName).toBe('state');
    expect(card.template!.html).toContain('bind-component="state"');
    expect(CARD.slice(card.stateStart, card.stateStart + 1)).toBe('{');
    const [site] = findMountSites(html, 'data-wcs', parts);
    expect(site.whole).toBe('users.*');
    expect([...site.handed]).toEqual([['view', 'view']]);
  });
});

describe('部品のメソッド — ページの state と同じスクリプトの規則', () => {
  const BAD = `export default class extends HTMLElement {
  state = {
    rename(v) { this.tenant.name = v; },
    add(p) { this.plots.push(p); },
    ok(v) { this["tenant.name"] = v; this.plots = this.plots.concat(v); },
  };
  connectedCallback() { this.innerHTML = '<wcs-state bind-component="state"></wcs-state>'; }
}`;
  const html = `<script type="importmap">{ "imports": { "@components/x-card": "./parts/bad.js" } }</script>\n${STATE}\n<x-card data-wcs="state: user"></x-card>`;

  it('入れ子の代入と配列の破壊的メソッドを、部品のファイルの位置（origin）で報告する（error）', () => {
    const found = run(html, { './parts/bad.js': BAD });
    expect(found.map((d) => [d.code, d.severity, d.origin?.path, BAD.slice(d.origin!.start, d.origin!.end)])).toEqual([
      [WcsDiagnosticCode.ArrayMutation, 'error', './parts/bad.js', 'this.plots.push'],
      [WcsDiagnosticCode.NestedAssign, 'error', './parts/bad.js', 'this.tenant.name ='],
    ]);
    expect(found.map((d) => d.origin!.startPosition)).toEqual([{ line: 4, column: 14 }, { line: 3, column: 17 }]);
    // ページの中では、import map がその部品を名指す値の上
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['./parts/bad.js', './parts/bad.js']);
    expect(found[1].message).toContain('this["tenant.name"]');
  });

  it('import map に無い部品（ページのモジュールが定義する）は、最初の要素のタグ名の上で報告する', () => {
    const page = `<script type="module" src="./main.js"></script>\n${STATE}\n<x-card data-wcs="state: user"></x-card>`;
    const main = `import Card from "./parts/bad.js";\ncustomElements.define("x-card", Card);`;
    const found = run(page, { './main.js': main, './parts/bad.js': BAD });
    expect(found.map((d) => [d.code, page.slice(d.start, d.end), d.origin?.path])).toEqual([
      [WcsDiagnosticCode.ArrayMutation, 'x-card', './parts/bad.js'],
      [WcsDiagnosticCode.NestedAssign, 'x-card', './parts/bad.js'],
    ]);
  });

  it('同じファイルの部品は 1 回だけ（2 つのタグが同じクラスのファイルを指す）。問題の無い部品は黙る', () => {
    const two = `<script type="importmap">{ "imports": { "@components/x-card": "./parts/bad.js", "@components/y-card": "./parts/bad.js" } }</script>
${STATE}\n<x-card data-wcs="state: user"></x-card><y-card data-wcs="state: user"></y-card>`;
    expect(run(two, { './parts/bad.js': BAD })).toHaveLength(2);
    expect(run(`${MAP}\n${STATE}\n<x-card data-wcs="state: user"></x-card>`)).toEqual([]);
  });

  it('日本語の文面。reader が無ければ何も読まない', () => {
    const ja = run(html, { './parts/bad.js': BAD }, 'ja');
    expect(ja).toHaveLength(2);
    expect(ja[0].message).not.toEqual(run(html, { './parts/bad.js': BAD })[0].message);
    expect(validateDocument(html, { locale: 'en' })).toEqual([]);
  });
});

describe('部品のテンプレートのパス — 先頭のキーがどこにも無い', () => {
  const part = (template: string, state = 'folded: false, get label() { return "x"; }, toggle() {}'): string => `const T = \`<wcs-state bind-component="state"></wcs-state>${template}\`;
export default class extends HTMLElement {
  state = { ${state} };
  connectedCallback() { this.attachShadow({ mode: "open" }).innerHTML = T; }
}`;
  const PAGE_MAP = '<script type="importmap">{ "imports": { "@components/x-card": "./c.js" } }</script>';
  const page = (use: string, state = STATE): string => `${PAGE_MAP}\n${state}\n${use}`;
  /** 部品のファイルの中の所見: [ページの中の範囲, ファイルの中の範囲]。 */
  const inPart = (html: string, file: string): [string, string][] =>
    run(html, { './c.js': file }).filter((d) => d.origin !== undefined && d.code === WcsDiagnosticCode.BindingPathMissing)
      .map((d) => [html.slice(d.start, d.end), file.slice(d.origin!.start, d.origin!.end)]);

  it('マウント先の形が分かるとき、そこに無い名前を、部品のファイルの位置で報告する（warning。近い名前を添える）', () => {
    const file = part('<h3 data-wcs="textContent: nmae"></h3><p>{{ name }} {{ nmae|upper }}</p>');
    const html = page('<x-card data-wcs="state: user"></x-card>');
    const found = run(html, { './c.js': file }).filter((d) => d.origin !== undefined);
    expect(found.map((d) => [d.code, d.severity, html.slice(d.start, d.end), file.slice(d.origin!.start, d.origin!.end), d.origin!.path])).toEqual([
      [WcsDiagnosticCode.BindingPathMissing, 'warning', 'state: user', 'nmae', './c.js'],
    ]);
    expect(found[0].message).toContain('Path "nmae" in <x-card>\'s template does not resolve');
    expect(found[0].message).toContain('the object it is mounted on ("user") has no such key');
    expect(found[0].message).toContain('Did you mean "name"?');
  });

  it('ページが渡すキーの打ち間違い（state.veiw:）は、部品が読む名前の側で分かる。行のマウントでも同じ', () => {
    const file = part('<i data-wcs="textContent: view.filter"></i>');
    const html = page('<template data-wcs="for: users"><x-card data-wcs="state: .; state.veiw: view"></x-card></template>');
    const found = run(html, { './c.js': file }).filter((d) => d.origin !== undefined);
    expect(found.map((d) => file.slice(d.origin!.start, d.origin!.end))).toEqual(['view.filter']);
    expect(found[0].message).toContain('("users.*") has no such key');
    // （`view` はページの state の最上位にあるので、近い名前でなく渡し方を言う）
    expect(found[0].message).toContain('"view" is a path of the page');
    // ページの最上位に無い名前なら、渡されたキーを近い名前として挙げる
    const other = run(page('<x-card data-wcs="state: user; state.filtre: view.filter"></x-card>'), { './c.js': part('<i data-wcs="textContent: filter"></i>') })
      .filter((d) => d.origin !== undefined);
    expect(other).toHaveLength(1);
    expect(other[0].message).toContain('Did you mean "filtre"?');
  });

  it('部品の中で読んだページのパスには、渡し方を言う。丸ごとのマウントが無い部品には、そう言う', () => {
    const file = part('<i data-wcs="textContent: view.filter"></i>');
    const whole = run(page('<x-card data-wcs="state: user"></x-card>'), { './c.js': file }).filter((d) => d.origin !== undefined);
    expect(whole).toHaveLength(1);
    expect(whole[0].message).toContain('"view" is a path of the page\'s state');
    expect(whole[0].message).toContain('state.view: view');
    const none = run(page('<x-card data-wcs="state.other: view"></x-card>'), { './c.js': part('<i data-wcs="textContent: nope.x"></i>') }).filter((d) => d.origin !== undefined);
    expect(none).toHaveLength(1);
    expect(none[0].message).toContain('the part is mounted on no object (state: …)');
  });

  it('部品自身のキー・渡されたキー・マウント先にあるキー・$ のパス・行の中のパスは黙る', () => {
    const file = part(`<b data-wcs="textContent: label; onclick: toggle; hidden: folded"></b>
<i data-wcs="textContent: view.filter"></i><i data-wcs="textContent: name"></i>
<template data-wcs="for: tiles"><em data-wcs="textContent: .no; attr.data-i: $1"></em>{{ .nope }}</template>
<button data-wcs="onclick: $command.go"></button>`, 'folded: false, get label() { return "x"; }, toggle() {}, $commandTokens: ["go"]');
    expect(inPart(page('<x-card data-wcs="state: user; state.view: view"></x-card>'), file)).toEqual([]);
  });

  it('マウント先の形が分からないとき（空で始まるリストの行・null・型の無いオブジェクト）は黙る。JSDoc の型があれば言う', () => {
    const file = part('<i data-wcs="textContent: nmae"></i>');
    const state = (users: string): string => `<wcs-state><script type="module">\nexport default {\n${users}\n};\n</script></wcs-state>`;
    const rows = '<template data-wcs="for: users"><x-card data-wcs="state: ."></x-card></template>';
    expect(inPart(page(rows, state('users: [],')), file)).toEqual([]);
    expect(inPart(page('<x-card data-wcs="state: user"></x-card>', state('user: null,')), file)).toEqual([]);
    expect(inPart(page('<x-card data-wcs="state: user"></x-card>', state('user: {},')), file)).toEqual([]);
    expect(inPart(page(rows, state('/** @type {{ id: number, name: string }[]} */\nusers: [],')), file)).toEqual([['state: .', 'nmae']]);
  });

  it('マウント先そのものがページに無ければ、ページの束縛の所見だけ（部品の中は重ねない）', () => {
    const file = part('<i data-wcs="textContent: nmae"></i>');
    const html = page('<x-card data-wcs="state: usr"></x-card>');
    expect(inPart(html, file)).toEqual([]);
    expect(missing(html, { './c.js': file })).toEqual(['usr']);
  });

  it('部品の中の部品のテンプレートも見る。所見はページの要素の上に、部品・キー・要素ごとに 1 回', () => {
    const tile = 'export default class extends HTMLElement {\n  state = {};\n  connectedCallback() { this.innerHTML = \'<wcs-state bind-component="state"></wcs-state><b data-wcs="textContent: nope"></b><i data-wcs="textContent: nope"></i>\'; }\n}';
    const html = `${MAP}\n${STATE}\n<x-card data-wcs="state: user"></x-card><x-card data-wcs="state: user"></x-card>`;
    const found = run(html, { './parts/x-card.js': CARD, './parts/x-tile.js': tile }).filter((d) => d.origin !== undefined);
    expect(found.map((d) => [html.slice(d.start, d.end), d.origin!.path, tile.slice(d.origin!.start, d.origin!.end)])).toEqual([
      ['state: user', './parts/x-tile.js', 'nope'],
      ['state: user', './parts/x-tile.js', 'nope'],
    ]);
    expect(found[0].start).not.toBe(found[1].start);
    expect(found[0].message).toContain('("user.tiles.*") has no such key');
  });

  it('テンプレートを読めない部品（テンプレートが 2 つ・文字列でない）は黙る。日本語の文面', () => {
    const two = `const A = '<wcs-state bind-component="state"></wcs-state><i data-wcs="textContent: nmae"></i>';
const B = '<wcs-state bind-component="state"></wcs-state>';
export default class extends HTMLElement { state = {}; connectedCallback() { this.innerHTML = Math.random() > 2 ? B : A; } }`;
    expect(inPart(page('<x-card data-wcs="state: user"></x-card>'), two)).toEqual([]);
    const file = part('<i data-wcs="textContent: nmae"></i>');
    const ja = run(page('<x-card data-wcs="state: user"></x-card>'), { './c.js': file }, 'ja').filter((d) => d.origin !== undefined);
    expect(ja).toHaveLength(1);
    expect(ja[0].message).toContain('<x-card> のテンプレートのパス "nmae" は解決しません');
    expect(ja[0].message).toContain('マウント先のオブジェクト（"user"）にもありません');
  });
});
