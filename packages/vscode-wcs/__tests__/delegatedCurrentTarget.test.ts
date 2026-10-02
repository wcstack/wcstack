/**
 * delegatedCurrentTarget.test.ts — main（3.5 の #407）から 4.0 の規則へ移した検査。
 *
 *   - 委譲されるイベントのハンドラが読む `event.currentTarget`（`wcs/delegated-current-target`、warning）。
 *     3.5 は 3.x の利用者への予告（`wcs/v4-migration`、info）だったが、4.0 ではその場で壊れる形なので warning。
 *   - 要素の置かれた文脈（analyzeElementContexts — 1 回の走査）: router の route の `<template>` の中の for / if も
 *     行・枝として数え（#203 の `outerHTML:` も対象）、自前の `<wcs-state>` を持つ `<template>`（宣言的 shadow
 *     root・DCC）の中は文書の root の state の束縛として数えない。
 *   - `for: items;`（末尾の `;`）の for のリストを `items;` と読まない（firstExpressionOf）。
 *   - raw text 要素（`<noscript>` / `<iframe>` / `<xmp>` / `<noembed>` …）の中身は要素でも束縛でもない
 *     （htmlParse.ts の RAW_TEXT_ELEMENTS 1 か所）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { validateDocument } from '../src/core/validateDocument';
import { runValidation } from '../src/core/cli/runValidation';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics';
import { analyzeElementContexts } from '../src/service/forContext';
import { readsEventCurrentTarget } from '../src/service/scriptAst';
import { DELEGATED_EVENTS } from '../src/service/bindingValidator';
import { createTemplateTester, RAW_TEXT_ELEMENTS } from '../src/language/htmlParse';

const validate = (html: string, locale = 'en'): WcsDiagnostic[] => validateDocument(html, { locale });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);

const state = (body: string): string => `<wcs-state><script type="module">
export default { ${body} };
</script></wcs-state>
`;

describe('wcs/delegated-current-target — 委譲されるイベントのハンドラが読む event.currentTarget', () => {
  const handlerState = state(`
  items: [1],
  pick(e) { this.picked = e.currentTarget.dataset.id; },
  pickDestructured({ currentTarget }) { this.picked = currentTarget.id; },
  pickLocal(e) { const { currentTarget } = e; this.picked = currentTarget.id; },
  plain(e) { this.picked = e.target.closest("button").id; },
  later(e) { setTimeout(() => e.currentTarget, 0); },
  async afterAwait(e) { await 0; this.picked = e.currentTarget; },
  shadowed(e) { let e2 = 1; { const e = {}; return e.currentTarget; } },
  picked: "",`);

  it('#direct の無い onclick: / oninput: … で、ハンドラが currentTarget を読むなら warning を出すこと', () => {
    const html = `${handlerState}<button data-wcs="onclick: pick"></button>
<button data-wcs="onclick#prevent: pickDestructured"></button>
<input data-wcs="oninput: pickLocal">
<template data-wcs="for: items"><button data-wcs="onclick: pick"></button></template>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.DelegatedCurrentTarget);
    expect(diags.map((d) => [d.severity, textOf(html, d)])).toEqual([
      ['warning', 'onclick'], ['warning', 'onclick'], ['warning', 'oninput'], ['warning', 'onclick'],
    ]);
    expect(diags[0].message).toContain('"onclick#direct:"');
    expect(diags[0].message).toContain('event.target.closest');
    expect(diags[0].message).toContain('"pick"');
    expect(diags[0].message).toContain('is the root');
  });

  it('#direct 付き・委譲されないイベント・カスタム要素が自分で出しうるイベント・自前の state を持つ template の中・読まないハンドラには出さないこと', () => {
    const html = `${handlerState}<button data-wcs="onclick#direct: pick"></button>
<button data-wcs="onfocus: pick"></button>
<my-input data-wcs="oninput: pick; onchange: pick"></my-input>
<my-form data-wcs="onsubmit: pick"></my-form>
<div><template shadowrootmode="open"><wcs-state json='{}'></wcs-state><button data-wcs="onclick: pick"></button></template></div>
<template data-wcs="for: items"><template id="inert-in-row"><button data-wcs="onclick: pick"></button></template></template>
<noscript><button data-wcs="onclick: pick"></button></noscript>
<button data-wcs="onclick: plain"></button>
<button data-wcs="onclick: later"></button>
<button data-wcs="onclick: afterAwait"></button>
<button data-wcs="onclick: shadowed"></button>
<button data-wcs="onclick: $command.pick"></button>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.DelegatedCurrentTarget)).toEqual([]);
  });

  it('カスタム要素の click（ネイティブの bubbling は root で聞く）と router の route の中には出すこと', () => {
    const html = `${handlerState}<my-button data-wcs="onclick: pick"></my-button>
<wcs-router><template><wcs-route path="/"><button data-wcs="onclick: pick"></button></wcs-route></template></wcs-router>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.DelegatedCurrentTarget);
    expect(diags.map((d) => textOf(html, d))).toEqual(['onclick', 'onclick']);
  });

  // The same scope as #203: inside a top-level non-structural <template>, only the content the state binds (a route
  // template, a template a `<wcs-layout layout>` names — not one only enable-shadow-root layouts name)
  it('アプリの JS が複製するだけの最上位の <template> の中は黙り、レイアウトの雛形の中には出すこと（#203 と同じ範囲）', () => {
    const html = `${handlerState}<template id="row-tpl"><button data-wcs="onclick: pick"></button></template>
<template id="main-layout"><button data-wcs="onclick: pick"></button><slot></slot></template>
<template id="shadow-layout"><button data-wcs="onclick: pick"></button><slot></slot></template>
<wcs-router><template><wcs-route path="/"><wcs-layout layout="main-layout"><p>a</p></wcs-layout></wcs-route>
<wcs-route path="/s"><wcs-layout layout="shadow-layout" enable-shadow-root><p>b</p></wcs-layout></wcs-route></template></wcs-router>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.DelegatedCurrentTarget);
    expect(diags.map((d) => d.start)).toEqual([html.indexOf('onclick', html.indexOf('id="main-layout"'))]);
  });

  it('書き換え先は書かれた修飾子に direct を足した形（onclick#prevent,stop → onclick#prevent,stop,direct）', () => {
    const html = `${handlerState}<button data-wcs="onclick#prevent,stop: pick"></button><button data-wcs="onclick: pick"></button>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.DelegatedCurrentTarget);
    expect(diags[0].message).toContain('"onclick#prevent,stop,direct:"');
    expect(diags[1].message).toContain('"onclick#direct:"');
    const [ja] = ofCode(validate(html, 'ja'), WcsDiagnosticCode.DelegatedCurrentTarget);
    expect(ja.message).toContain('"onclick#prevent,stop,direct:"');
    expect(ja.message).toContain('root になります');
  });

  it('async の submit で、最初の await の被演算子の中の e.currentTarget は同期的な読みとして拾うこと', () => {
    const html = `${state(`async submit(e) { e.preventDefault(); await fetch("/api", { method: "POST", body: new FormData(e.currentTarget) }); }`)}
<form data-wcs="onsubmit: submit"></form>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.DelegatedCurrentTarget).map((d) => textOf(html, d))).toEqual(['onsubmit']);
  });

  it('<template> の中の <wcs-state>（宣言的 shadow root）のメソッドで、文書の束縛を報告しないこと', () => {
    const html = `<wcs-state><script type="module">export default { pick(e) { return e.target; } };</script></wcs-state>
<div><template shadowrootmode="open"><wcs-state><script type="module">export default { pick(e) { return e.currentTarget; } };</script></wcs-state></template></div>
<button data-wcs="onclick: pick"></button>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.DelegatedCurrentTarget)).toEqual([]);
  });

  it('ボリュームのメソッドは root のハンドラ名（pick）としては見ないこと（マウントパスの下の名前 sub.pick だけ）', () => {
    const html = `<wcs-state><script type="module">export default { go() {} };</script></wcs-state>
<wcs-state mount="sub"><script type="module">export default { pick(e) { return e.currentTarget; } };</script></wcs-state>
<button data-wcs="onclick: pick"></button>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.DelegatedCurrentTarget)).toEqual([]);
  });

  // 4.0 grafts a volume's methods at <mount>.<name> and invokes onclick: cart.pick like a root method (engine.invoke
  // with the dotted path), so under delegation currentTarget is the root
  it('ボリュームのメソッド（中のスクリプト・読める src=）も、マウントパスの下のハンドラ名で報告すること', () => {
    const html = `<wcs-state><script type="module">export default { count: 0 };</script></wcs-state>
<wcs-state mount="cart"><script type="module">export default { pick(e) { return e.currentTarget.dataset.id; }, plain(e) { return e.target; } };</script></wcs-state>
<wcs-state mount="ext" src="./ext.js"></wcs-state>
<div><template shadowrootmode="open"><wcs-state mount="inner"><script type="module">export default { pick(e) { return e.currentTarget; } };</script></wcs-state></template></div>
<button data-wcs="onclick: cart.pick"></button>
<button data-wcs="onclick#direct: cart.pick"></button>
<button data-wcs="onclick: cart.plain"></button>
<button data-wcs="onsubmit: ext.send"></button>
<button data-wcs="onclick: inner.pick"></button>`;
    const fileReader = (path: string) => (path === './ext.js' ? 'export default { send(e) { new FormData(e.currentTarget); } };' : undefined);
    const diags = ofCode(validateDocument(html, { locale: 'en', fileReader }), WcsDiagnosticCode.DelegatedCurrentTarget);
    expect(diags.map((d) => textOf(html, d))).toEqual(['onclick', 'onsubmit']);
    expect(diags[0].message).toContain('"cart.pick"');
    expect(diags[1].message).toContain('"ext.send"');
    // without a reader, a volume's src= is not read
    expect(ofCode(validate(html), WcsDiagnosticCode.DelegatedCurrentTarget).map((d) => textOf(html, d))).toEqual(['onclick']);
  });

  it('examples/state-tilt-maze の形（pointer capture・getBoundingClientRect）: #direct なら黙ること', () => {
    const tilt = state(`dragStart(e) { e.currentTarget.setPointerCapture(e.pointerId); },
  dragMove(e) { const r = e.currentTarget.getBoundingClientRect(); this.x = r.left; }, x: 0`);
    const broken = `${tilt}<div data-wcs="onpointerdown: dragStart; onpointermove: dragMove"></div>`;
    // pointermove は委譲されない（BUBBLING に無い）ので、要素のまま
    expect(ofCode(validate(broken), WcsDiagnosticCode.DelegatedCurrentTarget).map((d) => textOf(broken, d))).toEqual(['onpointerdown']);
    const fixed = `${tilt}<div data-wcs="onpointerdown#direct: dragStart; onpointermove#direct: dragMove"></div>`;
    expect(ofCode(validate(fixed), WcsDiagnosticCode.DelegatedCurrentTarget)).toEqual([]);
  });

  it('CLI: warning なので既定では exit 0、--strict では exit 1', () => {
    const html = `${handlerState}<button data-wcs="onclick: pick"></button>`;
    const loose = runValidation([{ source: 'page.html', text: html, kind: 'html' }], { locale: 'en' });
    expect(loose.warningCount).toBe(1);
    expect(loose.exitCode).toBe(0);
    const strict = runValidation([{ source: 'page.html', text: html, kind: 'html' }], { strict: true, locale: 'en' });
    expect(strict.exitCode).toBe(1);
  });

  it('readsEventCurrentTarget: 同期的な読みだけを拾い、束縛し直しは黙ること', () => {
    expect(readsEventCurrentTarget('e', 'return e.currentTarget;')).toBe(true);
    expect(readsEventCurrentTarget('e', 'return e["currentTarget"];')).toBe(true);
    expect(readsEventCurrentTarget('{ currentTarget: el }', 'return el;')).toBe(true);
    expect(readsEventCurrentTarget('e = null, i', 'return e.currentTarget;')).toBe(true);
    expect(readsEventCurrentTarget('e', 'return e.target;')).toBe(false);
    expect(readsEventCurrentTarget('e', 'e = other; return e.currentTarget;')).toBe(false);
    expect(readsEventCurrentTarget('e', 'try {} catch (e) {} return e.currentTarget;')).toBe(false);
    expect(readsEventCurrentTarget('e', 'list.forEach((e) => e.currentTarget);')).toBe(false);
    expect(readsEventCurrentTarget('e', 'await x; return e.currentTarget;')).toBe(false);
    // 被演算子は中断の前に評価される
    expect(readsEventCurrentTarget('e', 'await send(new FormData(e.currentTarget));')).toBe(true);
    expect(readsEventCurrentTarget('e', 'await send(await prep(), e.currentTarget);')).toBe(false);
    expect(readsEventCurrentTarget('e', 'for await (const x of e.currentTarget.items) {} ')).toBe(true);
    expect(readsEventCurrentTarget('e', 'for await (const x of list) { e.currentTarget; }')).toBe(false);
    expect(readsEventCurrentTarget('', 'return 1;')).toBe(false);
    expect(readsEventCurrentTarget('e', 'return (')).toBe(false);
  });

  it('DELEGATED_EVENTS が @wcstack/state 4.0 の dom/view.ts の BUBBLING と一致すること', () => {
    // 依存の実体（今は packages/state-next、4.0 の差し替えの後は packages/state）の src を読む
    const src = join(realpathSync(join(__dirname, '..', 'node_modules', '@wcstack', 'state')), 'src');
    const view = readFileSync(join(src, 'dom', 'view.ts'), 'utf8');
    const body = /export const BUBBLING = new Set\(\[([^\]]*)\]\)/.exec(view);
    expect(body).not.toBeNull();
    expect([...DELEGATED_EVENTS]).toEqual([...body![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  });
});

describe('#203 の outerHTML: / outerText: と要素の文脈（analyzeElementContexts）', () => {
  const S = state(`items: ["<i>1</i>"], on: true, h: "<b>x</b>"`);
  const outer = (diags: readonly WcsDiagnostic[]): WcsDiagnostic[] => diags.filter((d) => d.message.includes('replaces its element'));

  it('router の route の <template> の中の for でも報告し、自前の state を持つ template（宣言的 shadow root）の中は黙ること', () => {
    const html = `${S}<wcs-router><template><wcs-route path="/">
<template data-wcs="for: items"><span data-wcs="outerHTML: ."></span></template>
<wcs-state mount="sub" json='{}'></wcs-state>
</wcs-route></template></wcs-router>
<div><template shadowrootmode="open"><wcs-state json='{"items":[]}'></wcs-state>
<template data-wcs="for: items"><span data-wcs="outerHTML: ."></span></template></template></div>`;
    const diags = outer(validate(html));
    expect(diags.map((d) => [d.code, d.severity])).toEqual([[WcsDiagnosticCode.TemplateSyntax, 'error']]);
    expect(diags[0].start).toBe(html.indexOf('outerHTML: .'));
  });

  it('route の中に入れ子にした構造でない <template>（アプリの JS が複製する雛形）の中は束縛ではないので黙ること', () => {
    const html = `${S}<wcs-state mount="m"><script type="module">export default { pick(e) { return e.currentTarget; } };</script></wcs-state>
<wcs-router><template><wcs-route path="/">
<template id="inner-inert"><template data-wcs="if: on"><span data-wcs="outerHTML: h"></span></template></template>
<template data-wcs="if: on"><span data-wcs="outerText: h"></span></template>
</wcs-route></template></wcs-router>`;
    expect(outer(validate(html)).map((d) => textOf(html, d))).toEqual(['outerText']);
  });

  // The non-structural <template>s whose content the state binds: a route template (under `<wcs-router>`) and a
  // layout template a `<wcs-layout layout="id">` names (the light-DOM outlet hands its content to the binder). A
  // top-level `<template id="tpl">` that only app code clones is not bound — silent
  it('アプリの JS が複製するだけの最上位の <template> の中の for / if は黙り、router の route は報告すること', () => {
    const html = `${S}<template id="row-tpl"><template data-wcs="for: items"><span data-wcs="outerHTML: ."></span></template>
<template data-wcs="if: on"><b data-wcs="outerText: h"></b></template></template>
<wcs-router><template><wcs-route path="/"><template data-wcs="if: on"><i data-wcs="outerHTML: h"></i></template></wcs-route></template></wcs-router>`;
    const diags = outer(validate(html));
    expect(diags).toHaveLength(1);
    expect(diags[0].start).toBe(html.indexOf('outerHTML: h'));
  });

  it('<wcs-layout layout="id"> が指すレイアウトの雛形は、文書のどこにあっても報告し、enable-shadow-root のレイアウトだけが指す雛形は黙ること', () => {
    const html = `${S}<template id="main-layout"><template data-wcs="for: items"><span data-wcs="outerHTML: ."></span></template><slot></slot></template>
<template id="shadow-layout"><template data-wcs="if: on"><b data-wcs="outerText: h"></b></template><slot></slot></template>
<wcs-router><template><wcs-route path="/"><wcs-layout layout="main-layout"><p>a</p></wcs-layout></wcs-route>
<wcs-route path="/s"><wcs-layout layout="shadow-layout" enable-shadow-root><p>b</p></wcs-layout></wcs-route></template></wcs-router>
<template id="late-layout"><template data-wcs="if: on"><u data-wcs="outerHTML: h"></u></template></template>
<wcs-layout layout="late-layout"></wcs-layout>`;
    expect(outer(validate(html)).map((d) => d.start)).toEqual([html.indexOf('outerHTML: .'), html.indexOf('outerHTML: h')]);
  });

  it('route の中の if: の枝に置いた <wcs-state> で、route 全体を「自前の state を持つ template」とみなさないこと', () => {
    const html = `${S}<wcs-router><template><wcs-route path="/">
<template data-wcs="if: on"><wcs-state json='{}'></wcs-state></template>
<template data-wcs="for: items"><span data-wcs="outerHTML: ."></span></template>
</wcs-route></template></wcs-router>`;
    expect(outer(validate(html))).toHaveLength(1);
  });

  it('analyzeElementContexts: 複数の offset を 1 回の走査で判定すること（自前の state は offset の後ろにあっても効く）', () => {
    const html = `<template data-wcs="for: a"><p data-wcs="x: y"></p></template><p data-wcs="x: y"></p>`
      + `<template id="t"><p data-wcs="x: y"></p></template>`
      + `<template shadowrootmode="open"><p data-wcs="x: y"></p><wcs-state></wcs-state></template>`
      + `<template data-wcs="for: a"><template id="inner"><p data-wcs="x: y"></p></template></template>`
      + `<noscript><p data-wcs="x: y"></p></noscript>`
      + `<template data-wcs="for: a"><div data-wcs="text: t"><p data-wcs="x: y"></p></div></template>`
      + `<wcs-router><template><p data-wcs="x: y"></p><template data-wcs="if: a"><p data-wcs="x: y"></p></template></template></wcs-router>`;
    const offsets: number[] = [];
    for (let at = html.indexOf('x: y'); at !== -1; at = html.indexOf('x: y', at + 1)) offsets.push(at);
    const contexts = analyzeElementContexts(html, offsets);
    expect(offsets.map((o) => contexts.get(o))).toEqual([
      { bound: true, rowOrBranch: true, ownStateTemplate: false },
      { bound: true, rowOrBranch: false, ownStateTemplate: false },
      // a top-level template the state does not bind (one app code clones): not bound
      { bound: false, rowOrBranch: false, ownStateTemplate: false },
      // 自前の <wcs-state> を持つ template（宣言的 shadow root・DCC）— 後ろの <wcs-state> で決まる
      { bound: true, rowOrBranch: false, ownStateTemplate: true },
      // 行の中の構造でない template は複製されても inert
      { bound: false, rowOrBranch: false, ownStateTemplate: false },
      // noscript の中身は raw text（htmlParse.ts の RAW_TEXT_ELEMENTS）
      { bound: false, rowOrBranch: false, ownStateTemplate: false },
      // 中身を置き換える束縛（4.0 の text: も）を持つ要素の子孫
      { bound: false, rowOrBranch: false, ownStateTemplate: false },
      // a route template is bound where it is inserted (an if in it is a branch)
      { bound: true, rowOrBranch: false, ownStateTemplate: false },
      { bound: true, rowOrBranch: true, ownStateTemplate: false },
    ]);
  });
});

describe('for: items;（末尾の ;）', () => {
  it('行の束縛（属性・{{ }}・省略パス・相対 for）を別のリストの "*" や存在しないパスと取り違えないこと', () => {
    const html = `<wcs-state><script type="module">export default { items: [{ name: "a", tags: [{ t: 1 }] }] };</script></wcs-state>
<template data-wcs="for: items;"><span data-wcs="textContent: items.*.name"></span>{{ items.*.name }}<i data-wcs="textContent: .name"></i></template>
<template data-wcs="for: items"><template data-wcs="for: .tags;"><span data-wcs="textContent: items.*.tags.*.t"></span>{{ items.*.tags.*.t }}<b data-wcs="textContent: .t"></b></template></template>`;
    const diags = validate(html);
    expect(ofCode(diags, WcsDiagnosticCode.WildcardRank)).toEqual([]);
    expect(ofCode(diags, WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
  });
});

describe('raw text 要素の中身（htmlParse.ts の RAW_TEXT_ELEMENTS）', () => {
  it('<noembed> / <xmp> / <noscript> / <iframe> の中の <wcs-state> を 2 つ目の root と数えないこと', () => {
    expect(RAW_TEXT_ELEMENTS.has('noscript')).toBe(true);
    const html = `<wcs-state json='{}'></wcs-state><noembed><wcs-state></wcs-state></noembed><xmp><wcs-state></wcs-state></xmp>`
      + `<noscript><wcs-state></wcs-state></noscript><iframe><wcs-state></wcs-state></iframe>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.SecondRoot)).toEqual([]);
  });

  it('<plaintext> は終了タグを持たず、文書の終わりまで文字であること', () => {
    const html = `<wcs-state json='{}'></wcs-state><plaintext></plaintext><wcs-state json='{}'></wcs-state>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.SecondRoot)).toEqual([]);
  });

  it('createTemplateTester: コメント・script の文字列・noscript の中の <template> を数えないこと', () => {
    const html = `<!-- <template> --><script>const s = "<template>";</script><noscript><template></noscript><p id="a"></p><template><p id="b"></p></template><p id="c"></p>`;
    const inside = createTemplateTester(html);
    expect(inside(html.indexOf('id="a"'))).toBe(false);
    expect(inside(html.indexOf('id="b"'))).toBe(true);
    expect(inside(html.indexOf('id="c"'))).toBe(false);
  });
});
