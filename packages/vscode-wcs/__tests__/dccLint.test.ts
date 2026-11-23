/**
 * dccLint.test.ts — lint が Declarative Custom Component（`data-wc-definition`）を読む（継ぎ目アプリ garden-plots、4.29。
 * docs/v4-direction-2026-10.md §5.25）。4.28 までの検査器は DCC を知らなかった:
 *
 *   - 定義の中のマークアップは、定義の `<wcs-state>` に束ねられる。ページの state とは別の範囲
 *   - `wcs/dcc-declaration`: 実行時がタグを定義するときに拒む定義（`$bindables` / `$commands` の誤り）
 *   - `wcs/tag-member-unknown`: ページが DCC に束ねるメンバーを、定義（ページの中・import map が名指すファイル）と突き合わせる
 *   - `wcs/dcc-attribute`: `$bindables` のメンバーを属性で書いたインスタンス
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import { blankRanges, findDccDefinitions, importMapOf, keepOnly } from '../src/service/dccDefinitions.js';

const pager = (state: string, markup = '<span class="info">{{ page }} / {{ pages }}</span>', tag = 'my-pager'): string => `<${tag} data-wc-definition>
  <template shadowrootmode="open">
    ${markup}
    <wcs-state><script type="module">
${state}
    </script></wcs-state>
  </template>
</${tag}>`;
const PAGER_STATE = `export default {
  page: 1, total: 0, per: 20,
  get pages() { return Math.ceil(this.total / this.per); },
  next() { this.page++; },
  $bindables: ["page", "total", "per"],
  $commands: ["next"],
};`;
const ROOT = `<wcs-state><script type="module">
export default { n: 120, p: 2, title: "t", $commandTokens: ["go"] };
</script></wcs-state>`;

const run = (html: string, files: Record<string, string> = {}, locale = 'en'): WcsDiagnostic[] =>
  validateDocument(html, { locale, fileReader: (path) => files[path] });
/** code と、診断の範囲の文字。 */
const said = (html: string, files: Record<string, string> = {}): [string, string][] =>
  run(html, files).map((d) => [d.code, html.slice(d.start, d.end)]);
const only = (html: string, code: string, files: Record<string, string> = {}): string[] =>
  run(html, files).filter((d) => d.code === code).map((d) => html.slice(d.start, d.end));

describe('findDccDefinitions — 文書の中の定義', () => {
  it('ホスト・テンプレート・中身の位置を返す。中身の for: のテンプレートは終わりを取り違えない', () => {
    const html = `<p>before</p>${pager(PAGER_STATE, '<ul><template data-wcs="for: rows"><li>{{ . }}</li></template></ul><i>after</i>')}<p>after</p>`;
    const [definition, ...rest] = findDccDefinitions(html);
    expect(rest).toEqual([]);
    expect(definition.tag).toBe('my-pager');
    expect(html.slice(definition.nameStart, definition.nameEnd)).toBe('my-pager');
    expect(html.slice(definition.hostStart, definition.hostStart + 9)).toBe('<my-pager');
    expect(html.slice(definition.hostEnd)).toBe('<p>after</p>');
    const content = html.slice(definition.contentStart, definition.contentEnd);
    expect(content).toContain('<i>after</i>');
    expect(content).toContain('$bindables');
    expect(content).not.toContain('shadowrootmode');
    expect(html.slice(definition.templateStart, definition.templateStart + 9)).toBe('<template');
    expect(html.slice(definition.templateEnd - 11, definition.templateEnd)).toBe('</template>');
  });

  it('shadow root の無い定義・ページの <template> の中の定義・定義の中の定義は数えない', () => {
    expect(findDccDefinitions('<my-x data-wc-definition><p>no shadow root</p></my-x>')).toEqual([]);
    expect(findDccDefinitions(`<template>${pager(PAGER_STATE)}</template>`)).toEqual([]);
    const nested = pager(PAGER_STATE, pager('export default {};', '<b></b>', 'my-inner'), 'my-outer');
    expect(findDccDefinitions(nested).map((d) => d.tag)).toEqual(['my-outer']);
    expect(findDccDefinitions('<div data-wc-definition><template shadowrootmode="open"></template></div>')).toEqual([]);
  });

  it('閉じていない定義は、文書の終わりまでを中身とする', () => {
    const html = '<my-x data-wc-definition><template shadowrootmode="open"><b>x</b>';
    const [definition] = findDccDefinitions(html);
    expect(html.slice(definition.contentStart, definition.contentEnd)).toBe('<b>x</b>');
    expect(definition.templateEnd).toBe(html.length);
    expect(definition.hostEnd).toBe(html.length);
  });

  it('blankRanges / keepOnly は長さと改行を変えない', () => {
    const text = 'ab\ncd\r\nef';
    expect(blankRanges(text, [[1, 4], [3, 6]])).toBe('a \n  \r\nef');
    expect(keepOnly(text, 3, 5)).toBe('  \ncd\r\n  ');
    expect(blankRanges(text, [])).toBe(text);
  });

  it('importMapOf は imports を読む。JSON でない map・コメントの中の map は読まない', () => {
    expect([...importMapOf('<script type="importmap">{ "imports": { "a": "./a.js", "n": 1 } }</script><script type=importmap>{ "imports": { "b": "./b.js" } }</script>')])
      .toEqual([['a', './a.js'], ['b', './b.js']]);
    expect([...importMapOf('<script type="importmap">{ not json }</script><!-- <script type="importmap">{ "imports": { "c": "./c.js" } }</script> --><script type="importmap">{ "scopes": {} }</script>')])
      .toEqual([]);
  });
});

describe('範囲 — 定義の中のマークアップは定義の state に、ページのマークアップはページの state に', () => {
  it('ページの束縛は、定義だけが持つキーでは通らない。定義の中の束縛は、ページだけが持つキーでは通らない', () => {
    const html = `${pager(PAGER_STATE, '<span>{{ page }} {{ title }}</span>')}
${ROOT}
<p data-wcs="textContent: pages"></p><p data-wcs="textContent: title"></p>`;
    expect(only(html, WcsDiagnosticCode.BindingPathMissing)).toEqual(['title', 'pages']);
  });

  it('定義の中の打ち間違いは、定義の state に対して報告する（定義の中の {{ }} に FOUC の info は出ない）', () => {
    const html = `${pager(PAGER_STATE, '<span>{{ page }} / {{ pagse }}</span><button data-wcs="onclick: nxt">n</button>')}
${ROOT}`;
    expect(said(html)).toEqual([
      [WcsDiagnosticCode.BindingPathMissing, 'pagse'],
      [WcsDiagnosticCode.BindingPathMissing, 'nxt'],
    ]);
  });

  it('定義だけのファイル（部品のファイル）も同じに検査する', () => {
    const file = pager(PAGER_STATE, '<span>{{ page }} / {{ pagse }}</span>');
    expect(said(file)).toEqual([[WcsDiagnosticCode.BindingPathMissing, 'pagse']]);
  });

  it('定義が無ければ、これまでと同じ 1 つの範囲', () => {
    const html = `${ROOT}<p data-wcs="textContent: nope"></p>`;
    expect(said(html)).toEqual([[WcsDiagnosticCode.BindingPathMissing, 'nope']]);
  });
});

describe('wcs/dcc-declaration — 実行時が拒む定義', () => {
  const declares = (state: string): string[] => only(pager(state, '<b></b>'), WcsDiagnosticCode.DccDeclaration);

  it('state に無い項目（近い名前を添える）・$bindables のメソッド・$commands の値・2 回書いた項目（error）', () => {
    const html = pager(`export default {
  page: 1, total: 0,
  get pages() { return 1; },
  next() {},
  $bindables: ["page", "totl", "next", "page", "pages"],
  $commands: ["next", "total", "nxt"],
};`, '<b></b>');
    const found = run(html).filter((d) => d.code === WcsDiagnosticCode.DccDeclaration);
    expect(found.map((d) => [html.slice(d.start, d.end), d.severity])).toEqual([
      ['"totl"', 'error'], ['"next"', 'error'], ['"page"', 'error'], ['"total"', 'error'], ['"nxt"', 'error'],
    ]);
    expect(found[0].message).toContain('"totl" in $bindables is not a member of this definition\'s state');
    expect(found[0].message).toContain('"total"');
    expect(found[1].message).toContain('"next" in $bindables is a method: list it in $commands');
    expect(found[2].message).toContain('"page" is listed twice in $bindables');
    expect(found[3].message).toContain('"total" in $commands is not a method');
    expect(found[4].message).toContain('"next"');
  });

  it('リストでない宣言・空の項目・$ で始まる項目', () => {
    expect(declares('export default { a: 1, $bindables: "a" };')).toEqual(['$bindables']);
    expect(declares('export default { a: 1, $commands: { a: true } };')).toEqual(['$commands']);
    expect(declares('export default { a: 1, $bindables: ["", "$a", "a"] };')).toEqual(['""', '"$a"']);
  });

  it('定義の中の <wcs-state bind-component>・2 つ目の <wcs-state>', () => {
    const bound = '<my-x data-wc-definition><template shadowrootmode="open"><wcs-state bind-component="state"></wcs-state><b></b></template></my-x>';
    expect(only(bound, WcsDiagnosticCode.DccDeclaration)).toEqual(['<wcs-state bind-component="state">']);
    const two = `<my-x data-wc-definition><template shadowrootmode="open">
<wcs-state><script type="module">export default { a: 1 };</script></wcs-state>
<wcs-state json='{"b":2}'></wcs-state>
<template data-wcs="if: a"><wcs-state json='{"c":3}'></wcs-state></template>
</template></my-x>`;
    expect(only(two, WcsDiagnosticCode.DccDeclaration)).toEqual([`<wcs-state json='{"b":2}'>`]);
  });

  it('確かでないものは言わない: リテラルでないリスト・リテラルでない項目・読み切れない state・$stream のある state', () => {
    expect(declares('const names = ["a"];\nexport default { a: 1, $bindables: names };')).toEqual([]);
    expect(declares('const n = "zz";\nexport default { a: 1, $bindables: [n] };')).toEqual([]);
    expect(declares('const base = { b: 2 };\nexport default { ...base, a: 1, $bindables: ["b"] };')).toEqual([]);
    expect(declares('export default class { a = 1; static $bindables = ["zz"]; }')).toEqual([]);
    expect(declares('export default { a: 1, $stream: { feed: { source() {} } }, $bindables: ["feed"] };')).toEqual([]);
    // 読み切れない state でも、リストそのものの誤り（2 回・空）は言う
    expect(declares('const base = { b: 2 };\nexport default { ...base, a: 1, $bindables: ["b", "b"] };')).toEqual(['"b"']);
    // state の無い定義・JSON の state は宣言を持たない
    expect(only('<my-x data-wc-definition><template shadowrootmode="open"><b></b></template></my-x>', WcsDiagnosticCode.DccDeclaration)).toEqual([]);
    expect(only(`<my-x data-wc-definition><template shadowrootmode="open"><wcs-state json='{"a":1}'></wcs-state></template></my-x>`, WcsDiagnosticCode.DccDeclaration)).toEqual([]);
  });

  it('src= のファイルの state も読み、src の値の上で報告する。読めないファイルは黙る', () => {
    const html = '<my-x data-wc-definition><template shadowrootmode="open"><wcs-state src="./x-state.js"></wcs-state><b></b></template></my-x>';
    expect(only(html, WcsDiagnosticCode.DccDeclaration, { './x-state.js': 'export default { a: 1, $bindables: ["b"] };' })).toEqual(['./x-state.js']);
    expect(only(html, WcsDiagnosticCode.DccDeclaration)).toEqual([]);
    expect(validateDocument(html, { locale: 'en' }).filter((d) => d.code === WcsDiagnosticCode.DccDeclaration)).toEqual([]);
  });

  it('日本語の文面', () => {
    const html = pager('export default { a: 1, go() {}, $bindables: ["go"] };', '<b></b>');
    const ja = run(html, {}, 'ja').filter((d) => d.code === WcsDiagnosticCode.DccDeclaration);
    expect(ja).toHaveLength(1);
    expect(ja[0].message).toContain('$bindables の "go" はメソッドです');
  });
});

describe('wcs/tag-member-unknown — ページが DCC に束ねるメンバー', () => {
  const USE = '<my-pager data-wcs="total: n; page: p; totl: n; command.nxt: $command.go; command.next: $command.go"></my-pager>';

  it('ページの中の定義と突き合わせる: 無いプロパティ・無いコマンド（error、近い名前を添える）', () => {
    const html = `${pager(PAGER_STATE)}\n${ROOT}\n${USE}`;
    const found = run(html).filter((d) => d.code === WcsDiagnosticCode.TagMemberUnknown);
    expect(found.map((d) => [html.slice(d.start, d.end), d.severity])).toEqual([['totl', 'error'], ['command.nxt', 'error']]);
    expect(found[0].message).toContain('"totl" is not a wcBindable member of <my-pager>');
    expect(found[0].message).toContain('"total"');
    expect(found[1].message).toContain('"next"');
  });

  it('import map が名指すファイルの定義と突き合わせる: .html の eager・|dcc を名指した eager・|dcc の名前空間', () => {
    const page = (map: string, use = USE): string => `<script type="importmap">{ "imports": { ${map} } }</script>\n${ROOT}\n${use}`;
    const file = pager(PAGER_STATE);
    expect(only(page('"@components/my-pager": "./parts/my-pager.html"'), WcsDiagnosticCode.TagMemberUnknown, { './parts/my-pager.html': file }))
      .toEqual(['totl', 'command.nxt']);
    expect(only(page('"@components/my-pager": "parts/my-pager.html?v=3"'), WcsDiagnosticCode.TagMemberUnknown, { './parts/my-pager.html': file }))
      .toEqual(['totl', 'command.nxt']);
    expect(only(page('"@components/my-pager|dcc": "./parts/pager.part"'), WcsDiagnosticCode.TagMemberUnknown, { './parts/pager.part': file }))
      .toEqual(['totl', 'command.nxt']);
    expect(only(page('"@components/my|dcc/": "./parts/my/"'), WcsDiagnosticCode.TagMemberUnknown, { './parts/my/pager.html': file }))
      .toEqual(['totl', 'command.nxt']);
  });

  it('読めない・当てはまらないものは黙る: 読めないファイル・.js の eager・dcc でないローダー・タグの違う定義・URL', () => {
    const page = (map: string): string => `<script type="importmap">{ "imports": { ${map} } }</script>\n${ROOT}\n${USE}`;
    const file = pager(PAGER_STATE);
    expect(only(page('"@components/my-pager": "./parts/my-pager.html"'), WcsDiagnosticCode.TagMemberUnknown)).toEqual([]);
    expect(only(page('"@components/my-pager": "./parts/my-pager.js"'), WcsDiagnosticCode.TagMemberUnknown, { './parts/my-pager.js': file })).toEqual([]);
    expect(only(page('"@components/my-pager|lit": "./parts/my-pager.html"'), WcsDiagnosticCode.TagMemberUnknown, { './parts/my-pager.html': file })).toEqual([]);
    expect(only(page('"@components/my/": "./parts/my/"'), WcsDiagnosticCode.TagMemberUnknown, { './parts/my/pager.html': file })).toEqual([]);
    expect(only(page('"@components/my-pager": "./parts/other.html"'), WcsDiagnosticCode.TagMemberUnknown, { './parts/other.html': pager(PAGER_STATE, '<b></b>', 'other-tag') })).toEqual([]);
    expect(only(page('"@components/my-pager": "https://example.com/my-pager.html"'), WcsDiagnosticCode.TagMemberUnknown, { 'https://example.com/my-pager.html': file })).toEqual([]);
    // reader の無い実行（import map はあるがファイルは読めない）
    expect(validateDocument(page('"@components/my-pager": "./parts/my-pager.html"'), { locale: 'en' }).filter((d) => d.code === WcsDiagnosticCode.TagMemberUnknown)).toEqual([]);
  });

  it('メンバーを宣言しない定義・宣言を読めない定義は、束縛を検査しない', () => {
    const none = pager('export default { a: 1 };', '<b></b>');
    expect(only(`${none}\n${ROOT}\n<my-pager data-wcs="anything: n"></my-pager>`, WcsDiagnosticCode.TagMemberUnknown)).toEqual([]);
    const unreadable = pager('const names = ["a"];\nexport default { a: 1, $bindables: names };', '<b></b>');
    expect(only(`${unreadable}\n${ROOT}\n<my-pager data-wcs="anything: n"></my-pager>`, WcsDiagnosticCode.TagMemberUnknown)).toEqual([]);
  });

  it('別の定義の中で使ったインスタンスも検査する', () => {
    const outer = pager('export default { count: 3, $bindables: ["count"] };', '<my-pager data-wcs="total: count; pagee: count"></my-pager>', 'my-list');
    const html = `${pager(PAGER_STATE)}\n${outer}\n${ROOT}`;
    expect(only(html, WcsDiagnosticCode.TagMemberUnknown)).toEqual(['pagee']);
  });
});

describe('wcs/dcc-attribute — $bindables のメンバーを属性で書いた', () => {
  it('インスタンスの属性を、タグと名前ごとに 1 回、属性の上で報告する（warning）', () => {
    const html = `${pager(PAGER_STATE)}\n${ROOT}\n<my-pager total="120" per=20></my-pager><my-pager total="60"></my-pager>`;
    const found = run(html).filter((d) => d.code === WcsDiagnosticCode.DccAttribute);
    expect(found.map((d) => [html.slice(d.start, d.end), d.severity])).toEqual([['total="120"', 'warning'], ['per=20', 'warning']]);
    expect(found[0].message).toContain('<my-pager>\'s input "total" is written as an attribute');
    expect(found[0].message).toContain('data-wcs="total: <path>"');
  });

  it('属性名は大文字小文字を区別しない（HTML の属性は小文字になる）。日本語の文面', () => {
    const def = pager('export default { pageSize: 20, $bindables: ["pageSize"] };', '<b></b>');
    const html = `${def}\n${ROOT}\n<my-pager pagesize="10"></my-pager>`;
    expect(only(html, WcsDiagnosticCode.DccAttribute)).toEqual(['pagesize="10"']);
    const ja = run(html, {}, 'ja').filter((d) => d.code === WcsDiagnosticCode.DccAttribute);
    expect(ja[0].message).toContain('<my-pager> の入力 "pageSize" を属性で書いています');
  });

  it('束ねた入力・$bindables に無い属性・定義のホスト・DCC でないタグは黙る', () => {
    const html = `${pager(PAGER_STATE)}\n${ROOT}
<my-pager class="x" id="p" data-wcs="total: n; attr.title: title"></my-pager>
<other-tag total="120"></other-tag>`;
    expect(only(html, WcsDiagnosticCode.DccAttribute)).toEqual([]);
    const host = '<my-pager data-wc-definition total="1"><template shadowrootmode="open"><wcs-state><script type="module">export default { total: 0, $bindables: ["total"] };</script></wcs-state></template></my-pager>';
    expect(only(host, WcsDiagnosticCode.DccAttribute)).toEqual([]);
  });
});
