/**
 * bindingHostValidator.test.ts — 束縛を書いた要素では束縛が働かない 2 つの形（継ぎ目アプリ town-archive、4.24）。
 *
 *   - `wcs/body-binding`（error）— `<body>` / `<html>` に書いた束縛（`<wcs-state>` が束ねるのは `<body>` の中）
 *   - `wcs/link-handler`（error）— `<wcs-link>` の `on*:`（ホストは display: none で、クリックは隣の `<a>` で起きる）
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';

const validate = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
  validateDocument(html, { locale, fileReader: (p: string) => files[p] });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);

describe('wcs/body-binding — <body> / <html> に書いた束縛', () => {
  const STATE = `<wcs-state><script type="module">
export default { lang: "ja", dark: false, onKey() {} };
</script></wcs-state>`;
  const bodyBindings = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.BodyBinding);

  it('<body> と <html> の束縛の属性を error で報告し、属性の全体を範囲にすること', () => {
    const html = `<!doctype html>
<html lang="ja" data-wcs="attr.lang: lang">
<head><title>archive</title></head>
<body class="app" data-wcs="onkeydown: onKey; class.dark: dark">
${STATE}
<main data-wcs="onkeydown: onKey; class.dark: dark"></main>
</body></html>`;
    const found = bodyBindings(html);
    expect(found.map((d) => [d.severity, d.tag, textOf(html, d)])).toEqual([
      ['error', 'html', 'data-wcs="attr.lang: lang"'],
      ['error', 'body', 'data-wcs="onkeydown: onKey; class.dark: dark"'],
    ]);
    expect(found[1].message).toBe('data-wcs on <body> is never bound: <wcs-state> binds what is inside <body>, not <body> or <html> themselves, so the bindings written here do nothing (an event handler never runs; class., attr. and the rest are never written). Move the binding to an element inside <body> (a wrapper, <main>), or write the value from $connectedCallback or a $watch handler (document.documentElement.lang = …)');
    const [ja] = bodyBindings(html, 'ja');
    expect(ja.message).toContain('<html> の data-wcs は束縛されません');
    expect(ja.message).toContain('束縛を <body> の中の要素（包む要素・<main>）へ移すか、値を $connectedCallback や $watch のハンドラから書いてください');
    // 束縛そのものは正しい（パスはある）ので、ほかの検査は何も言わない
    expect(validate(html).filter((d) => d.severity !== 'info').map((d) => d.code)).toEqual([
      WcsDiagnosticCode.BodyBinding, WcsDiagnosticCode.BodyBinding,
    ]);
  });

  it('コメント・スクリプトの文字列・<template> の中・raw text の中の <body …> と、束縛の無い <body> には出さないこと', () => {
    const html = `<!doctype html>
<html lang="ja">
<body class="app" data-wcs="">
${STATE}
<!-- <body data-wcs="onkeydown: onKey"> -->
<script>const page = '<body data-wcs="onkeydown: onKey">';</script>
<template id="frame"><body data-wcs="onkeydown: onKey"></body></template>
<noscript><body data-wcs="onkeydown: onKey"></noscript>
<textarea><html data-wcs="attr.lang: lang"></textarea>
<div data-wcs="onkeydown: onKey"><tbody data-wcs="class.dark: dark"></tbody></div>
</body></html>`;
    expect(bodyBindings(html)).toEqual([]);
  });

  it('束縛の属性名を変えたページではその名前で読み、data-wcs-ignore の付いた <body> は黙ること', () => {
    const custom = `<body data-bind="class.dark: dark">${STATE}</body>`;
    const found = ofCode(validateDocument(custom, { locale: 'en', bindAttribute: 'data-bind' }), WcsDiagnosticCode.BodyBinding);
    expect(found.map((d) => textOf(custom, d))).toEqual(['data-bind="class.dark: dark"']);
    expect(found[0].message).toContain('data-bind on <body> is never bound');
    expect(bodyBindings(custom)).toEqual([]);
    expect(bodyBindings(`<body data-wcs-ignore data-wcs="class.dark: dark">${STATE}</body>`)).toEqual([]);
  });

  it('CLI: error なので exit 1（--errors-only でも表示される）', () => {
    const html = `<body data-wcs="class.dark: dark">${STATE}</body>`;
    const run = runValidation([{ source: 'page.html', text: html, kind: 'html' }], { locale: 'en' });
    expect(run.errorCount).toBe(1);
    expect(run.exitCode).toBe(1);
  });
});

describe('wcs/link-handler — <wcs-link> の on*:', () => {
  const STATE = `<wcs-state><script type="module">
export default { photos: [{ id: 1, href: "/photos/1", title: "a" }], label: "x", openPhoto(event) {}, hover() {} };
</script></wcs-state>`;
  const linkHandlers = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.LinkHandler);

  it('<wcs-link> の束縛の on*: を error で報告し、範囲は on* の名前であること（town-archive の形）', () => {
    const html = `${STATE}
<template data-wcs="for: photos">
  <wcs-link data-wcs="attr.to: .href; onclick: openPhoto">{{ .title }}</wcs-link>
</template>
<wcs-link to="/about" data-wcs="onclick#prevent: openPhoto; onmouseenter: hover; attr.title: label">about</wcs-link>`;
    const found = linkHandlers(html);
    expect(found.map((d) => [d.severity, d.tag, textOf(html, d)])).toEqual([
      ['error', 'wcs-link', 'onclick'], ['error', 'wcs-link', 'onclick'], ['error', 'wcs-link', 'onmouseenter'],
    ]);
    expect(found[0].message).toBe('"onclick:" on <wcs-link> never runs "openPhoto": the <wcs-link> itself is display: none, and what the user clicks is the <a> it generates beside itself, so no event reaches the host. Put the handler on an element inside the link (its children move into the <a>) or on an element around it; to navigate from a handler, write the router\'s navigateUrl (data-wcs="navigateUrl: …" on <wcs-router>)');
    expect(found[2].message).toContain('"onmouseenter:" on <wcs-link> never runs "hover"');
    const [ja] = linkHandlers(html, 'ja');
    expect(ja.message).toContain('<wcs-link> の "onclick:" は "openPhoto" を呼びません');
    expect(ja.message).toContain('router の navigateUrl に書きます');
  });

  it('router の route の中のリンクにも出すこと', () => {
    const html = `${STATE}
<wcs-router><template><wcs-route path="/"><wcs-link to="/a" data-wcs="onclick: openPhoto">a</wcs-link></wcs-route></template></wcs-router>`;
    expect(linkHandlers(html).map((d) => textOf(html, d))).toEqual(['onclick']);
  });

  it('報告したリンクの束縛に wcs/delegated-current-target を重ねないこと（ハンドラは走らないので #direct は直しにならない）', () => {
    const html = `<wcs-state><script type="module">
export default { pick(event) { return event.currentTarget.dataset.id; } };
</script></wcs-state>
<wcs-link to="/a" data-wcs="onclick: pick"><span data-wcs="onclick: pick">a</span></wcs-link>`;
    const found = validate(html)
      .filter((d) => d.code === WcsDiagnosticCode.LinkHandler || d.code === WcsDiagnosticCode.DelegatedCurrentTarget);
    expect(found.map((d) => [d.code, d.start])).toEqual([
      [WcsDiagnosticCode.LinkHandler, html.indexOf('onclick')],
      [WcsDiagnosticCode.DelegatedCurrentTarget, html.lastIndexOf('onclick')],
    ]);
  });

  it('on*: の無いリンク・中や外の要素のハンドラ・<a> のハンドラ・明示のプロパティ形・束ねられない場所には出さないこと', () => {
    const html = `${STATE}
<div data-wcs="onclick: openPhoto">
  <wcs-link to="/a" data-wcs="attr.title: label"><span data-wcs="onclick: openPhoto">a</span></wcs-link>
</div>
<a href="/b" data-wcs="onclick: openPhoto">b</a>
<wcs-link to="/c" data-wcs=".onclick: openPhoto">c</wcs-link>
<wcs-link-like to="/d" data-wcs="onclick: openPhoto">d</wcs-link-like>
<!-- <wcs-link to="/e" data-wcs="onclick: openPhoto">e</wcs-link> -->
<template id="cloned-by-script"><wcs-link to="/f" data-wcs="onclick: openPhoto">f</wcs-link></template>
<noscript><wcs-link to="/g" data-wcs="onclick: openPhoto">g</wcs-link></noscript>`;
    expect(linkHandlers(html)).toEqual([]);
  });
});
