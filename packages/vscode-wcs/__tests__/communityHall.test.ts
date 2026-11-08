/**
 * communityHall.test.ts — 継ぎ目アプリ community-hall（サーバーが描く CMS ＋ htmx のサイトに置いた wcstack の
 * アイランド）で lint が誤った・黙った形（4.20）。
 *
 *   - L1: `$behavior.enableMustache: false` の state のページの `{{ }}`（CMS のもの）を束縛として検査していた。
 *         属性の値・HTML コメント・文書の `<head>` の `{{ }}` はランタイムが束ねない。`<title>` / `<textarea>` の
 *         中ではコメントの形を勧めない
 *   - L2: 束縛があるのに `<wcs-state>` の無いファイル（CMS の部分テンプレート）は何も出ず、検査済みに見えた（`wcs/state-absent`）
 *   - L3: getter の `@returns {Record<string, boolean>}` の下のパスを `wcs/binding-path-missing` にしていた（jsdocType.test.ts）
 *   - L4: コメント束縛 1 つごとの「wcs-text バインディング」の info
 *   - L5: CLI がパターン（`templates/*.html`）を展開しなかった（cmd.exe はそのまま渡す — cliGlob.test.ts）
 *   - L6: router の無いページの `<wcs-link>`（`wcs/link-router-missing`）
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics';
import { findAllMustacheSyntax, findAllCommentBindings } from '../src/service/templateSyntax';
import { isMustacheDisabled } from '../src/service/stateBehavior';
import { runValidation } from '../src/core/cli/runValidation';
import type { FileReader } from '../src/service/statePathResolver';

const validate = (html: string, fileReader?: FileReader): WcsDiagnostic[] => validateDocument(html, { locale: 'en', fileReader });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const spans = (html: string, diags: readonly WcsDiagnostic[]): string[][] => diags.map((d) => [d.code, html.slice(d.start, d.end)]);
const readerOf = (files: Record<string, string>): FileReader => (path) => files[path.replace(/^\.\//, '')];

// community-hall の repro（l-mustache.html と pub/s.js）
const STATE_JS = `export default {
  $behavior: { enableMustache: false },
  booking: { total: 0 },
  events: [{ id: 12, open: true }],
  /** @returns {Record<string, boolean>} */
  get soldOut() { return Object.fromEntries(this.events.map((e) => ["e" + e.id, !e.open])); },
};
`;
const CMS_PAGE = (stateTag: string): string => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>{{pageTitle}}</title>
<script type="module" src="https://esm.run/@wcstack/state@4.19.0/auto"></script></head>
<body>${stateTag}
<nav><a href="/" aria-current="{{navHome}}">home</a></nav>
<main>{{{content}}}</main>
<p data-wcs="textContent: booking.total"></p>
<p data-wcs="textContent: soldOut.e12"></p>
<p><!--@@: booking.total--></p><p><!--@@: booking.totl--></p>
</body></html>`;

describe('L1 — $behavior.enableMustache: false のページの {{ }} は束縛ではない', () => {
  it('src= の state（読める）が false と宣言すれば、{{ }} について何も言わない。コメント束縛は検査する', () => {
    const html = CMS_PAGE('<wcs-state src="./s.js"></wcs-state>');
    const diags = validate(html, readerOf({ 's.js': STATE_JS }));
    expect(spans(html, diags)).toEqual([[WcsDiagnosticCode.BindingPathMissing, 'booking.totl']]);
  });

  it('中の <script type="module"> の state・json= の state でも同じ', () => {
    const inline = CMS_PAGE(`<wcs-state><script type="module">${STATE_JS}</script></wcs-state>`);
    expect(spans(inline, validate(inline))).toEqual([[WcsDiagnosticCode.BindingPathMissing, 'booking.totl']]);
    const json = CMS_PAGE(`<wcs-state json='{"$behavior":{"enableMustache":false},"booking":{"total":0},"soldOut":{"e12":true}}'></wcs-state>`);
    expect(spans(json, validate(json))).toEqual([[WcsDiagnosticCode.BindingPathMissing, 'booking.totl']]);
  });

  it('宣言が無い（既定の true）なら本文の {{ }} は従来どおり束縛として検査する — 属性の値の {{ }} は束ねないので言わない', () => {
    const html = CMS_PAGE(`<wcs-state><script type="module">${STATE_JS.replace('$behavior: { enableMustache: false },', '')}</script></wcs-state>`);
    const diags = validate(html);
    const said = spans(html, diags);
    // <main> の {{{content}}} はランタイムでもパス "{content" の束縛
    expect(said).toContainEqual([WcsDiagnosticCode.BindingPathMissing, '{content']);
    // <head> の <title> は束ねない（パスは検査せず、そう言う）
    const head = diags.find((d) => html.slice(d.start, d.end) === '{{pageTitle}}');
    expect(head?.code).toBe(WcsDiagnosticCode.TemplateSyntax);
    expect(head?.severity).toBe('warning');
    expect(head?.message).toContain("in the document's <head>");
    expect(said.some(([, text]) => text === 'pageTitle')).toBe(false);
    // 属性の値は束縛ではない
    expect(said.some(([, text]) => text.includes('navHome'))).toBe(false);
  });

  it('state を読めなければ（src= で reader なし）従来どおり — isMustacheDisabled は false', () => {
    const html = CMS_PAGE('<wcs-state src="./s.js"></wcs-state>');
    expect(isMustacheDisabled(html, 'wcs-state')).toBe(false);
    expect(isMustacheDisabled(html, 'wcs-state', readerOf({ 's.js': STATE_JS }))).toBe(true);
    expect(isMustacheDisabled(html, 'wcs-state', readerOf({}))).toBe(false);
  });

  it('値がリテラルの false でない・ボリュームの宣言・<template> の中の state は数えない', () => {
    const script = (body: string, attrs = ''): string => `<wcs-state${attrs}><script type="module">export default { ${body} };</script></wcs-state>`;
    expect(isMustacheDisabled(script('$behavior: { enableMustache: flag }'))).toBe(false);
    expect(isMustacheDisabled(script('$behavior: { enableMustache: true }'))).toBe(false);
    expect(isMustacheDisabled(script('$behavior: { enableMustache: false /* CMS */ }'))).toBe(true);
    expect(isMustacheDisabled(script('$behavior: { enableMustache: false }', ' mount="cart"'))).toBe(false);
    expect(isMustacheDisabled(`<template>${script('$behavior: { enableMustache: false }')}</template>`)).toBe(false);
    // state= の JSON の script・.json の src
    expect(isMustacheDisabled(`<script type="application/json" id="s">{"$behavior":{"enableMustache":false}}</script><wcs-state state="s"></wcs-state>`)).toBe(true);
    expect(isMustacheDisabled('<wcs-state src="./s.json"></wcs-state>', 'wcs-state', readerOf({ 's.json': '{"$behavior":{"enableMustache":false}}' }))).toBe(true);
    expect(isMustacheDisabled('<wcs-state json="{bad"></wcs-state>')).toBe(false);
    // state の無いページ・root の無いページ
    expect(isMustacheDisabled('<p>{{ x }}</p>')).toBe(false);
  });
});

describe('L1 — {{ }} はテキストノードだけ（属性の値・コメントの中は束ねない）', () => {
  it('findAllMustacheSyntax は属性の値・HTML コメント・<!doctype> の中を拾わない', () => {
    const html = `<!doctype html><a title="{{ a }}" data-x='{{ b }}'>{{ c }}</a><!-- {{ d }} --><p>{{ e }}</p>`;
    expect(findAllMustacheSyntax(html).map((m) => m.expression)).toEqual(['c', 'e']);
  });

  it('属性の値の {{ の後でも、その後のテキストの {{ }} を拾い、位置は原文を指す', () => {
    const html = `<a title="{{">{{ x }}</a>`;
    const found = findAllMustacheSyntax(html);
    expect(found.map((m) => m.expression)).toEqual(['x']);
    expect(html.slice(found[0].exprStart, found[0].exprEnd)).toBe('x');
  });

  it('<title> / <textarea> の中（RCDATA）の <b> はタグではない — {{ }} を拾う', () => {
    const html = `<textarea><b>{{ body }}</b></textarea>`;
    expect(findAllMustacheSyntax(html).map((m) => [m.expression, m.textParent])).toEqual([['body', 'textarea']]);
  });

  it('文書の <head> の中かを印す（<head> の無い断片は false）', () => {
    const page = `<html><head><title>{{ a }}</title></head><body><p>{{ b }}</p></body></html>`;
    expect(findAllMustacheSyntax(page).map((m) => [m.expression, m.inDocumentHead])).toEqual([['a', true], ['b', false]]);
    const noClose = `<head><title>{{ a }}</title><body>{{ b }}`;
    expect(findAllMustacheSyntax(noClose).map((m) => m.inDocumentHead)).toEqual([true, false]);
    const fragment = `<wcs-head><title>{{ a }}</title></wcs-head>`;
    expect(findAllMustacheSyntax(fragment).map((m) => m.inDocumentHead)).toEqual([false]);
    expect(findAllCommentBindings(`<head><!--@@: a--></head>`)[0].inDocumentHead).toBe(true);
  });
});

describe('L1 — FOUC の info は束ねられる場所でだけ、そこで動く書き方を勧める', () => {
  const STATE = `<wcs-state><script type="module">export default { t: "", body: "", count: 0 };</script></wcs-state>`;

  it('<title> / <textarea> の中ではコメントの形を勧めず、要素への束縛を勧める', () => {
    const html = `${STATE}<wcs-head><title>{{ t }}</title></wcs-head><textarea>{{ body }}</textarea><p>{{ count }}</p>`;
    const fouc = validate(html).filter((d) => d.message.includes('FOUC'));
    expect(fouc.map((d) => html.slice(d.start, d.end))).toEqual(['{{ t }}', '{{ body }}', '{{ count }}']);
    expect(fouc[0].message).not.toContain('<!--@@');
    expect(fouc[0].message).toContain('<title data-wcs="textContent: t">');
    expect(fouc[1].message).toContain('<textarea data-wcs="value: body">');
    expect(fouc[2].message).toContain('<!--@@:count-->');
  });

  it('文書の <head> の {{ }}・コメント束縛は「束ねない」warning を 1 つずつ（ja も）', () => {
    const html = `<html><head><title>{{ t }} - <!--@@: t--></title><!--@@: t--></head><body>${STATE}</body></html>`;
    const diags = validateDocument(html, { locale: 'ja' });
    const head = diags.filter((d) => d.message.includes('<head>'));
    expect(head.map((d) => [d.severity, html.slice(d.start, d.end)])).toEqual([['warning', '{{ t }}'], ['warning', '<!--@@: t-->']]);
    expect(head[0].message).toContain('文書の <head> の中');
  });

  it('文書の <head> の中は文法・名前付き state も問わない（ランタイムは読まない — CMS の {{#if}} など）', () => {
    const html = `<html><head><title>{{#if a}}x{{/if}} {{ t@other }}</title></head><body>${STATE}</body></html>`;
    const diags = validate(html);
    expect(diags.filter((d) => d.code === WcsDiagnosticCode.BindingSyntax || d.code === WcsDiagnosticCode.NamedStateDeprecated)).toEqual([]);
    expect(diags.every((d) => d.code === WcsDiagnosticCode.TemplateSyntax && d.severity === 'warning')).toBe(true);
  });
});

describe('L2 — 束縛があるのに <wcs-state> の無いファイル（wcs/state-absent）', () => {
  const FRAGMENT = `<section><h2>予約</h2>
<span data-wcs="textContent: booking.totl"></span>
<span data-wcs="textContent: seats.e{{id}}"></span>
</section>`;

  it('最初の束縛の上に info を 1 つ（CMS の部分テンプレート — community-hall の l-fragment.html）', () => {
    const diags = validate(FRAGMENT);
    expect(spans(FRAGMENT, diags)).toEqual([[WcsDiagnosticCode.StateAbsent, 'textContent: booking.totl']]);
    expect(diags[0].severity).toBe('info');
    expect(diags[0].message).toContain('no <wcs-state>');
    // --state-tag で変えた名前で言う
    expect(validateDocument(FRAGMENT, { locale: 'en', stateTagName: 'my-state' })[0].message).toContain('no <my-state>');
  });

  it('CLI の行に出て、exit code は変えない', () => {
    const result = runValidation([{ source: 'l-fragment.html', text: FRAGMENT, kind: 'html' }], { locale: 'en' });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^l-fragment\.html:2:\d+ info wcs\/state-absent /);
    expect(result.exitCode).toBe(0);
    expect(result.nothingToCheck).toEqual([]);
  });

  it('コメント束縛だけのファイルも言う。{{ }} だけ・data-wcs-ignore の中だけ・束縛の無いファイルは言わない', () => {
    expect(ofCode(validate('<p><!--@@: total--></p>'), WcsDiagnosticCode.StateAbsent)).toHaveLength(1);
    expect(ofCode(validate('<p>{{ total }}</p>'), WcsDiagnosticCode.StateAbsent)).toHaveLength(0);
    expect(ofCode(validate('<div data-wcs-ignore><p data-wcs="textContent: x"></p></div>'), WcsDiagnosticCode.StateAbsent)).toHaveLength(0);
    expect(ofCode(validate('<p data-wcs=""></p><wcs-fetch></wcs-fetch>'), WcsDiagnosticCode.StateAbsent)).toHaveLength(0);
  });

  it('state のあるファイル（<template> の中でも・読めなくても）・stateSchema のあるファイルは言わない', () => {
    expect(ofCode(validate(`<wcs-state src="./x.js"></wcs-state>${FRAGMENT}`), WcsDiagnosticCode.StateAbsent)).toHaveLength(0);
    expect(ofCode(validate(`<template><wcs-state json='{}'></wcs-state></template>${FRAGMENT}`), WcsDiagnosticCode.StateAbsent)).toHaveLength(0);
    const schema = { type: 'object', properties: { booking: { type: 'object', properties: { total: { type: 'number' } } } } } as const;
    const withSchema = validateDocument(FRAGMENT, { locale: 'en', applicationSchema: schema });
    expect(ofCode(withSchema, WcsDiagnosticCode.StateAbsent)).toHaveLength(0);
    // stateSchema があればパスを検査する（typo は error）
    expect(spans(FRAGMENT, ofCode(withSchema, WcsDiagnosticCode.PathNonexistent))).toContainEqual([WcsDiagnosticCode.PathNonexistent, 'booking.totl']);
  });
});

describe('L4 — コメント束縛そのものは報告しない', () => {
  it('束縛が正しければ何も出ない（4.19 までは 1 つずつ「wcs-text binding」の info）', () => {
    const html = `<wcs-state json='{"booking":{"total":0}}'></wcs-state><p><!--@@: booking.total--></p><p><!--@@wcs-text: booking.total--></p>`;
    expect(validate(html)).toEqual([]);
  });
});

describe('L6 — router の無いページの <wcs-link>（wcs/link-router-missing）', () => {
  const ROUTER = '<script type="module" src="https://esm.run/@wcstack/router@4.19.0/auto"></script>';
  const page = (head: string, body: string): string =>
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>x</title>${head}</head><body>${body}</body></html>`;

  it('router を読み込み <wcs-router> の無いページの <wcs-link to="/…"> は warning（community-hall の l-wcslink.html）', () => {
    const html = page(ROUTER, '<wcs-link to="/events/1">event</wcs-link>');
    const found = ofCode(validate(html), WcsDiagnosticCode.LinkRouterMissing);
    expect(spans(html, found)).toEqual([[WcsDiagnosticCode.LinkRouterMissing, 'wcs-link']]);
    expect(found[0].severity).toBe('warning');
    expect(found[0].message).toContain('<a href="/events/1">');
    expect(found[0].message).toContain('wcs-link is not connected to a router.');
  });

  it('ページに 1 回、最初のリンクに（数を添える）。URL・クエリ・束縛の to は数えない', () => {
    const html = page(ROUTER, '<wcs-link to="https://example.com/">ext</wcs-link><wcs-link to="?page=2">2</wcs-link>'
      + '<wcs-link data-wcs="attr.to: url">x</wcs-link><wcs-link to="/a">a</wcs-link><wcs-link to="/b">b</wcs-link><wcs-link to="/c">c</wcs-link>');
    const found = ofCode(validate(html), WcsDiagnosticCode.LinkRouterMissing);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('<wcs-link to="/a"> (and the 2 others on the page)');
    expect(ofCode(validate(page(ROUTER, '<wcs-link to="https://example.com/">ext</wcs-link>')), WcsDiagnosticCode.LinkRouterMissing)).toHaveLength(0);
  });

  it('<wcs-router> がどこかにあるページ・wcstack を読み込まない断片（ルートの中身・レイアウト）は黙る', () => {
    expect(ofCode(validate(page(ROUTER, '<wcs-router><template><wcs-route path="/"><wcs-link to="/a">a</wcs-link></wcs-route></template></wcs-router>')),
      WcsDiagnosticCode.LinkRouterMissing)).toHaveLength(0);
    expect(ofCode(validate('<nav><wcs-link to="/a">a</wcs-link></nav>'), WcsDiagnosticCode.LinkRouterMissing)).toHaveLength(0);
    // コメントの中の <wcs-router> は数えない。router を作るスクリプトは数える
    expect(ofCode(validate(page(ROUTER, '<!-- <wcs-router> --><wcs-link to="/a">a</wcs-link>')), WcsDiagnosticCode.LinkRouterMissing)).toHaveLength(1);
    const made = page(ROUTER, '<wcs-link to="/a">a</wcs-link><script type="module">document.body.append(document.createElement("wcs-router"));</script>');
    expect(ofCode(validate(made), WcsDiagnosticCode.LinkRouterMissing)).toHaveLength(0);
  });

  it('router を読み込まないページは wcs/tag-package-missing だけ。一括バンドル・autoloader が覆うタグは router 扱い', () => {
    const state = '<script type="module" src="https://esm.run/@wcstack/state@4.19.0/auto"></script>';
    const noRouter = validate(page(state, '<wcs-link to="/a">a</wcs-link>'));
    expect(ofCode(noRouter, WcsDiagnosticCode.LinkRouterMissing)).toHaveLength(0);
    expect(ofCode(noRouter, WcsDiagnosticCode.TagPackageMissing)).toHaveLength(1);
    const bundle = '<script type="module" src="https://esm.run/wcstack@4.19.0/auto"></script>';
    expect(ofCode(validate(page(bundle, '<wcs-link to="/a">a</wcs-link>')), WcsDiagnosticCode.LinkRouterMissing)).toHaveLength(1);
    const autoloader = '<script type="importmap">{"imports":{"@components/wcs/":"https://esm.run/@wcstack/"}}</script>'
      + '<script type="module" src="https://esm.run/@wcstack/autoloader@4.19.0/auto"></script>';
    expect(ofCode(validate(page(autoloader, '<wcs-link to="/a">a</wcs-link>')), WcsDiagnosticCode.LinkRouterMissing)).toHaveLength(1);
  });
});
