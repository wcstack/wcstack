/**
 * v4Migration.test.ts — @wcstack/state 4.0 で変わる書き方を、3.x の lint がどう知らせるか。
 *
 * 3.x では動き 4.0 で外れる形は `wcs/v4-migration`（info — `--strict` でも CI を落とさない）、
 * 3.x でも既に壊れていて 4.0 が初期化で拒む形は、その形の code の warning。error は 1 件も足さない。
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument';
import { runValidation } from '../src/core/cli/runValidation';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics';
import { getHoverAt } from '../src/core/navigation/wiringLens';
import { analyzeElementContexts, findOtherListWildcard } from '../src/service/forContext';
import { readsEventCurrentTarget } from '../src/service/scriptAst';
import { classifyIndexParam, substrRewrite } from '../src/service/v4Migration';
import { WCS_PREAMBLE } from '../src/language/preamble';
import { asciiLowerCase, createTemplateTester, RAW_TEXT_ELEMENTS } from '../src/language/htmlParse';

const validate = (html: string, locale = 'en'): WcsDiagnostic[] => validateDocument(html, { locale });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);

const state = (body: string): string => `<wcs-state><script type="module">
export default { ${body} };
</script></wcs-state>
`;

describe('wcs/v4-migration — $scan（4.0 で削除）', () => {
  it('root の state の $scan 宣言に info を 1 件出し、書き換え先（$watch / $on）を言うこと', () => {
    const html = state(`count: 0, $scan: { total: { from: "count", initial: 0, fold: (a, c) => a + c } }`);
    const diags = ofCode(validate(html), WcsDiagnosticCode.V4Migration);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('info');
    expect(textOf(html, diags[0])).toBe('$scan');
    expect(diags[0].message).toContain('Preparing for 4.0');
    expect(diags[0].message).toContain('$watch');
    expect(diags[0].message).toContain('$on');
  });

  it('日本語の文面も「4.0 への準備」で始まること', () => {
    const html = state(`count: 0, $scan: { total: { from: "count", initial: 0, fold: (a, c) => a + c } }`);
    const [diag] = ofCode(validate(html, 'ja'), WcsDiagnosticCode.V4Migration);
    expect(diag.message).toMatch(/^4\.0 への準備（3\.x ではこのまま動きます）/);
  });

  it('値が undefined のリテラルなら宣言なし扱いで黙ること', () => {
    expect(ofCode(validate(state(`count: 0, $scan: undefined`)), WcsDiagnosticCode.V4Migration)).toEqual([]);
    expect(ofCode(validate(state(`count: 0, "$scan": undefined`)), WcsDiagnosticCode.V4Migration)).toEqual([]);
  });

  it('ボリューム・マウントしたコンポーネントの $scan には重ねないこと（3.x でも動かず、既存の診断が報告する）', () => {
    const html = `<wcs-state mount="sub"><script type="module">
export default { count: 0, $scan: { total: { from: "count", initial: 0, fold: (a) => a } } };
</script></wcs-state>
<wcs-state bind-component="state"><script type="module">
export default { $scan: {} };
</script></wcs-state>`;
    const diags = validate(html);
    expect(ofCode(diags, WcsDiagnosticCode.V4Migration)).toEqual([]);
    expect(ofCode(diags, WcsDiagnosticCode.ScanDeclarationInvalid)).toHaveLength(2);
  });

  it('$scan の綴りが値の中だけにある state（他のキーの文字列）には出さないこと', () => {
    expect(ofCode(validate(state(`note: "$scan was removed"`)), WcsDiagnosticCode.V4Migration)).toEqual([]);
  });
});

describe('wcs/v4-migration — substr フィルタ（4.0 で削除）', () => {
  const S = state(`name: "hello world"`);

  it('data-wcs の substr に info を出し、0 以上のリテラルなら slice の具体形を言うこと', () => {
    const html = `${S}<p data-wcs="textContent: name|substr(2, 3)"></p>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.V4Migration);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('info');
    expect(textOf(html, diags[0])).toBe('substr');
    expect(diags[0].message).toContain('slice(start, start + length)');
    expect(diags[0].message).toContain('slice(2, 5)');
  });

  it('mustache・コメント束縛の substr にも同じ info を出すこと', () => {
    const html = `${S}<template data-wcs="if: name"><p>{{ name | substr(0, 4) }}</p></template><!--@@: name|substr(1, 1) -->`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.V4Migration);
    expect(diags.map((d) => textOf(html, d))).toEqual(['substr', 'substr']);
    expect(diags[0].message).toContain('slice(0, 4)');
    expect(diags[1].message).toContain('slice(1, 2)');
  });

  it('負の数・引用符付き・識別子の引数には具体形を出さず、一般形だけを案内すること', () => {
    for (const args of ['-3, 2', '2, -1', "'2', '3'"]) {
      const html = `${S}<p data-wcs="textContent: name|substr(${args})"></p>`;
      const [diag] = ofCode(validate(html), WcsDiagnosticCode.V4Migration);
      expect(diag.message, args).toContain('slice(start, start + length)');
      expect(diag.message, args).not.toContain('(here:');
    }
  });

  it('substrRewrite: 0 以上の整数リテラル 2 つだけを具体形にすること', () => {
    expect(substrRewrite(['2', '3'])).toBe('slice(2, 5)');
    expect(substrRewrite([' 0 ', ' 10 '])).toBe('slice(0, 10)');
    expect(substrRewrite(['02', '3'])).toBe('slice(2, 5)');
    expect(substrRewrite(['-1', '2'])).toBeNull();
    expect(substrRewrite(['1', '-2'])).toBeNull();
    expect(substrRewrite(['1.5', '2'])).toBeNull();
    expect(substrRewrite(['1'])).toBeNull();
  });

  it('入力フィルタの substr にも出すこと', () => {
    const html = `${S}<input data-wcs="value|substr(0, 3): name">`;
    expect(ofCode(validate(html), WcsDiagnosticCode.V4Migration)).toHaveLength(1);
  });

  it('slice には出さないこと', () => {
    const html = `${S}<p data-wcs="textContent: name|slice(2, 5)"></p>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.V4Migration)).toEqual([]);
  });
});

describe('wcs/name-alias — 文面が「4.0 で削除」を言うこと', () => {
  it('フィルタの旧名（data-wcs / mustache）と API の旧名', () => {
    const html = `${state(`name: "a", get upperName() { return this.$trackDependency("name"), this.name; }`)}
<p data-wcs="textContent: name|uc"></p><template data-wcs="if: name"><p>{{ name | uc }}</p></template>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.NameAlias);
    expect(diags.length).toBeGreaterThanOrEqual(3);
    for (const d of diags) {
      expect(d.severity).toBe('info');
      expect(d.message).toContain('removed in 4.0');
    }
    for (const d of ofCode(validate(html, 'ja'), WcsDiagnosticCode.NameAlias)) {
      expect(d.message).toContain('4.0 で削除される');
    }
  });

  it('フィルタの旧名の hover も「4.0 で削除」を言うこと', () => {
    const html = `${state(`name: "a"`)}<p data-wcs="textContent: name|uc"></p>`;
    const hover = getHoverAt(html, html.indexOf('|uc') + 2, { locale: 'en' })!;
    expect(hover.markdown).toContain('removed in 4.0');
  });
});

describe('outerHTML: / outerText: が for / if テンプレートの中（wcs/template-syntax・warning）', () => {
  const S = state(`items: ["<i>1</i>"], on: true, h: "<b>x</b>"`);

  it('for の行・if / elseif / else の枝の中の outerHTML: / outerText: を warning で報告すること', () => {
    const html = `${S}<template data-wcs="for: items"><span data-wcs="outerHTML: ."></span></template>
<template data-wcs="if: on"><div><span data-wcs="outerText: h"></span></div></template>
<template data-wcs="elseif: on"><span data-wcs=".outerHTML: h"></span></template>
<template data-wcs="else:"><span data-wcs="outerHTML: h"></span></template>`;
    const diags = validate(html).filter((d) => d.message.includes('replaces its element'));
    expect(diags.map((d) => [d.code, d.severity, textOf(html, d)])).toEqual([
      [WcsDiagnosticCode.TemplateSyntax, 'warning', 'outerHTML'],
      [WcsDiagnosticCode.TemplateSyntax, 'warning', 'outerText'],
      [WcsDiagnosticCode.TemplateSyntax, 'warning', '.outerHTML'],
      [WcsDiagnosticCode.TemplateSyntax, 'warning', 'outerHTML'],
    ]);
    expect(diags[0].message).toContain('innerHTML:');
  });

  it('テンプレートの外・class.outerHTML:・構造でない template の中・中身を置き換える要素の子孫は報告しないこと', () => {
    const html = `${S}<span data-wcs="outerHTML: h"></span>
<template data-wcs="for: items"><span data-wcs="class.outerHTML: on"></span></template>
<template id="plain"><span data-wcs="outerHTML: h"></span></template>
<template data-wcs="for: items"><div data-wcs="innerHTML: h"><span data-wcs="outerHTML: h"></span></div></template>
<template data-wcs="for: items"><textarea><span data-wcs="outerHTML: h"></span></textarea></template>`;
    expect(validate(html).filter((d) => d.message.includes('replaces its element'))).toEqual([]);
  });

  it('終了タグの省略で閉じた要素の後ろも、テンプレートの中として判定すること', () => {
    const html = `${S}<ul><template data-wcs="for: items"><li>a<li><span data-wcs="outerHTML: ."></span></template></ul>`;
    expect(validate(html).filter((d) => d.message.includes('replaces its element'))).toHaveLength(1);
  });

  it('<div> が暗に閉じた <p data-wcs="textContent: …"> の子孫とは数えないこと（HTML のパーサと同じ）', () => {
    const html = `${S}<template data-wcs="for: items"><p data-wcs="textContent: h">t<div><span data-wcs="outerHTML: ."></span></div></template>`;
    expect(validate(html).filter((d) => d.message.includes('replaces its element'))).toHaveLength(1);
  });

  it('analyzeElementContexts: 複数の offset を 1 回の走査で判定すること（自前の state は offset の後ろにあっても効く）', () => {
    const html = `<template data-wcs="for: a"><p data-wcs="x: y"></p></template><p data-wcs="x: y"></p>`
      + `<template id="t"><p data-wcs="x: y"></p></template>`
      + `<template shadowrootmode="open"><p data-wcs="x: y"></p><wcs-state></wcs-state></template>`
      + `<template data-wcs="for: a"><template id="inner"><p data-wcs="x: y"></p></template></template>`
      + `<noscript><p data-wcs="x: y"></p></noscript>`;
    const offsets: number[] = [];
    for (let at = html.indexOf('x: y'); at !== -1; at = html.indexOf('x: y', at + 1)) offsets.push(at);
    const contexts = analyzeElementContexts(html, offsets);
    expect(offsets.map((o) => contexts.get(o))).toEqual([
      { bound: true, rowOrBranch: true, ownStateTemplate: false },
      { bound: true, rowOrBranch: false, ownStateTemplate: false },
      // 自前の state を持たない template（router の route・雛形）は文書の一部
      { bound: true, rowOrBranch: false, ownStateTemplate: false },
      // 自前の <wcs-state> を持つ template（宣言的 shadow root・DCC）— 後ろの <wcs-state> で決まる
      { bound: true, rowOrBranch: false, ownStateTemplate: true },
      // 行の中の構造でない template は複製されても inert
      { bound: false, rowOrBranch: false, ownStateTemplate: false },
      // noscript の中身は raw text（共有の RAW_TEXT_ELEMENTS）
      { bound: false, rowOrBranch: false, ownStateTemplate: false },
    ]);
  });

  it('route の中に入れ子にした構造でない <template>（アプリの JS が複製する雛形）の中は束縛ではないので黙ること', () => {
    const html = `${S}<wcs-state><script type="module">export default { pick(e) { return e.currentTarget; } };</script></wcs-state>
<wcs-router><template><wcs-route path="/">
<template id="inner-inert"><template data-wcs="if: on"><span data-wcs="outerHTML: h"></span></template><button data-wcs="onclick: pick"></button></template>
<template data-wcs="if: on"><span data-wcs="outerText: h"></span></template>
</wcs-route></template></wcs-router>`;
    const diags = validate(html);
    // route そのものの中（文書の一部）だけが報告される
    expect(diags.filter((d) => d.message.includes('replaces its element')).map((d) => textOf(html, d))).toEqual(['outerText']);
    expect(ofCode(diags, WcsDiagnosticCode.V4Migration)).toEqual([]);
  });

  it('route の中の if: の枝に置いた <wcs-state> で、route 全体を「自前の state を持つ template」とみなさないこと', () => {
    const html = `${S}<wcs-router><template><wcs-route path="/">
<template data-wcs="if: on"><wcs-state json='{}'></wcs-state></template>
<template data-wcs="for: items"><span data-wcs="outerHTML: ."></span></template>
</wcs-route></template></wcs-router>`;
    expect(validate(html).filter((d) => d.message.includes('replaces its element'))).toHaveLength(1);
  });

  it('router の route の <template> の中の for でも報告し、自前の state を持つ template（宣言的 shadow root）の中は黙ること', () => {
    const html = `${S}<wcs-router><template><wcs-route path="/">
<template data-wcs="for: items"><span data-wcs="outerHTML: ."></span></template>
<wcs-state mount="sub" json='{}'></wcs-state>
</wcs-route></template></wcs-router>
<div><template shadowrootmode="open"><wcs-state json='{"items":[]}'></wcs-state>
<template data-wcs="for: items"><span data-wcs="outerHTML: ."></span></template></template></div>`;
    const diags = validate(html).filter((d) => d.message.includes('replaces its element'));
    expect(diags).toHaveLength(1);
    expect(diags[0].start).toBe(html.indexOf('outerHTML: .'));
  });
});

describe('行の中の別のリストの "*"（wcs/wildcard-rank・warning）', () => {
  const S = state(`a: [1], b: [{ y: 1 }], groups: [{ items: [{ v: 1 }], other: [{ w: 1 }] }]`);

  it('for: a の行の中の b.*.y を報告し、囲むループのリストを文面に出すこと', () => {
    const html = `${S}<template data-wcs="for: a"><span data-wcs="textContent: b.*.y"></span></template>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.WildcardRank);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(textOf(html, diags[0])).toBe('b.*.y');
    expect(diags[0].message).toContain('"b"');
    expect(diags[0].message).toContain('"a"');
  });

  it('mustache の中も同じ規則で報告すること', () => {
    const html = `${S}<template data-wcs="for: a"><span>{{ b.*.y }}</span></template>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.WildcardRank)).toHaveLength(1);
  });

  it('入れ子の段ごとに比べること（相対 for・絶対 for・for の右辺）', () => {
    const html = `${S}<template data-wcs="for: groups">
  <template data-wcs="for: .items">
    <span data-wcs="textContent: groups.*.items.*.v"></span>
    <span data-wcs="textContent: groups.*.other.*.w"></span>
  </template>
  <template data-wcs="for: a"><span data-wcs="textContent: groups.*.items"></span></template>
</template>
<template data-wcs="for: a"><template data-wcs="for: groups.*.items"><i data-wcs="textContent: .v"></i></template></template>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.WildcardRank);
    expect(diags.map((d) => textOf(html, d))).toEqual(['groups.*.other.*.w', 'groups.*.items', 'groups.*.items']);
  });

  it('囲むループの行（省略パス・同じリスト）は報告しないこと', () => {
    const html = `${S}<template data-wcs="for: groups"><template data-wcs="for: .items">
<span data-wcs="textContent: .v"></span><span data-wcs="textContent: groups.*.items.*.v"></span><span>{{ groups.*.items.*.v }}</span>
</template></template>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.WildcardRank)).toEqual([]);
  });

  it('for: items; のように末尾に ; を書いた for でも、行の束縛（属性・{{ }}・省略パス・相対 for）を取り違えないこと', () => {
    const html = `<wcs-state><script type="module">export default { items: [{ name: "a", tags: [{ t: 1 }] }] };</script></wcs-state>
<template data-wcs="for: items;"><span data-wcs="textContent: items.*.name"></span>{{ items.*.name }}<i data-wcs="textContent: .name"></i></template>
<template data-wcs="for: items"><template data-wcs="for: .tags;"><span data-wcs="textContent: items.*.tags.*.t"></span>{{ items.*.tags.*.t }}<b data-wcs="textContent: .t"></b></template></template>`;
    const diags = validate(html);
    expect(ofCode(diags, WcsDiagnosticCode.WildcardRank)).toEqual([]);
    expect(ofCode(diags, WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
  });

  it('findOtherListWildcard: 段数の不足は段数の検査に任せて null を返すこと', () => {
    expect(findOtherListWildcard('b.*.y', 'a')).toEqual({ over: 'b', loop: 'a' });
    expect(findOtherListWildcard('a.*.y', 'a')).toBeNull();
    expect(findOtherListWildcard('m.*.*', 'm')).toBeNull();
    expect(findOtherListWildcard('b.*.y', '.rel')).toBeNull();
  });
});

describe('ループの添字の表の外（$0 / $01 / $129）', () => {
  const S = state(`items: [1, 2]`);

  it('マークアップの $0 / $01 / $129 を wcs/binding-path-missing（warning）で報告し、段数の検査を重ねないこと', () => {
    const html = `${S}<template data-wcs="for: items">
<span data-wcs="textContent: $0"></span><span data-wcs="textContent: $01"></span><span data-wcs="textContent: $129"></span><span data-wcs="textContent: $1"></span>
</template>`;
    const diags = validate(html);
    const missing = ofCode(diags, WcsDiagnosticCode.BindingPathMissing);
    expect(missing.map((d) => [d.severity, textOf(html, d)])).toEqual([
      ['warning', '$0'], ['warning', '$01'], ['warning', '$129'],
    ]);
    expect(missing[0].message).toContain('$1 to $128');
    expect(ofCode(diags, WcsDiagnosticCode.WildcardRank)).toEqual([]);
  });

  it('for の外の $0 は「for の外のループ添字」ではなく存在しないパスとして報告すること（$1 は従来どおり）', () => {
    const html = `${S}<span data-wcs="textContent: $0"></span><span data-wcs="textContent: $1"></span><p>{{ $0 }}</p>`;
    const diags = validate(html);
    expect(ofCode(diags, WcsDiagnosticCode.BindingPathMissing).map((d) => textOf(html, d))).toEqual(['$0', '$0']);
    expect(ofCode(diags, WcsDiagnosticCode.TemplateSyntax).filter((d) => d.message.includes('Loop index')).map((d) => textOf(html, d))).toEqual(['$1']);
  });

  it('スクリプトの this.$0 / this.$129 / this["$01"] を wcs/index-param-range（warning）で報告すること', () => {
    const html = state(`items: [1], get "items.*.x"() { return this.$1 + this.$0 + this.$129 + this["$01"] + this.$128; }`);
    const diags = ofCode(validate(html), WcsDiagnosticCode.IndexParamRange);
    expect(diags.map((d) => [d.severity, textOf(html, d)])).toEqual([
      ['warning', '$0'], ['warning', '$129'], ['warning', '$01'],
    ]);
  });

  // レビューの 3 つの入力: base（「for の外のループ添字」「129 段のループが要る」）と同じく 2 件の warning が出ること
  describe('宣言を確かめられないときは黙らないこと（base が出していた warning を隠さない）', () => {
    const BIND = `<template data-wcs="for: items"><span data-wcs="textContent: $129"></span></template>
<p data-wcs="textContent: $0"></p>`;
    const missing = (html: string, fileReader?: (p: string) => string | undefined): string[] =>
      ofCode(validateDocument(html, { locale: 'en', fileReader }), WcsDiagnosticCode.BindingPathMissing).map((d) => textOf(html, d));

    it('(i) src= の state（fileReader で読めて $0 を宣言していない・読めない・fileReader が無い）', () => {
      const html = `<wcs-state src="./q4-state.js"></wcs-state>\n${BIND}`;
      const reader = (path: string): string | undefined =>
        path === './q4-state.js' ? 'export default { items: [1], name: "a" };' : undefined;
      expect(missing(html, reader)).toEqual(['$129', '$0']);
      expect(missing(html, () => undefined)).toEqual(['$129', '$0']);
      expect(missing(html)).toEqual(['$129', '$0']);
    });

    it('(i\') src= の state が $0 を宣言していれば（.js・同名の .ts を優先・.json）$0 だけ黙ること', () => {
      const js = `<wcs-state src="./q4-state.js"></wcs-state>\n${BIND}`;
      expect(missing(js, (path) => (path === './q4-state.js' ? 'export default { items: [1], $0: "z" };' : undefined))).toEqual(['$129']);
      // .ts があれば .ts を読む（statePathResolver と同じ）
      expect(missing(js, (path) => (path === './q4-state.ts' ? 'export default { items: [1], $0: "z" };'
        : path === './q4-state.js' ? 'export default { items: [1] };' : undefined))).toEqual(['$129']);
      const json = `<wcs-state src="./q4-state.json"></wcs-state>\n${BIND}`;
      expect(missing(json, (path) => (path === './q4-state.json' ? '{"items":[1],"$0":"z"}' : undefined))).toEqual(['$129']);
    });

    it('(ii) 宣言の無い class 構文の state', () => {
      const html = `<wcs-state><script type="module">export default class { items = [1]; name = "a"; }</script></wcs-state>\n${BIND}`;
      expect(missing(html)).toEqual(['$129', '$0']);
    });

    it('(iii) 宣言的 shadow root の state のキー（文書の root の state は $0 を宣言していない）', () => {
      const html = `<wcs-state json='{"items":[1],"name":"a"}'></wcs-state>
<div><template shadowrootmode="open"><wcs-state json='{"$0":"z"}'></wcs-state></template></div>
${BIND}`;
      expect(missing(html)).toEqual(['$129', '$0']);
    });
  });

  it('root の state が $0 というキーを宣言していれば、マークアップの $0 は報告しないこと（3.x はそのキーを読む）', () => {
    const declared = `${state(`items: [1], $0: "zero"`)}<template data-wcs="for: items"><span data-wcs="textContent: $0"></span>{{ $0 }}</template><p data-wcs="textContent: $0"></p>`;
    expect(ofCode(validate(declared), WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
    const json = `<wcs-state json='{"items":[1],"$129":1}'></wcs-state><p data-wcs="textContent: $129"></p>`;
    expect(ofCode(validate(json), WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
    const classState = `<wcs-state><script type="module">export default class { items = [1]; $0 = 1; }</script></wcs-state><p data-wcs="textContent: $0"></p>`;
    expect(ofCode(validate(classState), WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
    // ボリュームのキーは root のトップレベルではない
    const volume = `${state(`items: [1]`)}<wcs-state mount="v" json='{"$0":1}'></wcs-state><p data-wcs="textContent: $0"></p>`;
    expect(ofCode(validate(volume), WcsDiagnosticCode.BindingPathMissing)).toHaveLength(1);
  });

  it('this.$0 への単純代入（読まずに書くだけ — 3.x の set トラップは範囲を見ない）は報告せず、複合代入は報告すること', () => {
    const html = state(`items: [1], m() { this.$0 = 1; [this.$01] = [1]; ({ a: this.$129 } = { a: 1 }); this.$1000 += 1; this.$0.x = 2; }`);
    expect(ofCode(validate(html), WcsDiagnosticCode.IndexParamRange).map((d) => textOf(html, d))).toEqual(['$1000', '$0']);
  });

  it('入れ子の function の中の this・文字列の中・class 構文の state は黙ること', () => {
    const html = `${state(`items: [1], m() { const f = function () { return this.$0; }; return "this.$0"; }`)}
<wcs-state mount="v"><script type="module">export default class { get x() { return this.$0; } }</script></wcs-state>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.IndexParamRange)).toEqual([]);
  });

  it('classifyIndexParam: 3.x の表（$1〜$128・先頭 0 なし）', () => {
    expect(classifyIndexParam('$1')).toBe('index');
    expect(classifyIndexParam('$128')).toBe('index');
    expect(classifyIndexParam('$129')).toBe('notIndex');
    expect(classifyIndexParam('$0')).toBe('notIndex');
    expect(classifyIndexParam('$01')).toBe('notIndex');
    expect(classifyIndexParam('$1x')).toBeNull();
    expect(classifyIndexParam('items')).toBeNull();
  });
});

describe('同じ root の 2 つ目の <wcs-state>（wcs/second-root・warning）', () => {
  it('文書の root の <wcs-state> が 2 つあれば 2 つ目を報告すること', () => {
    const html = `<!doctype html><?xml-stylesheet x?><p>1 < 2</p><wcs-state json='{"a":1}'></wcs-state>\n<wcs-state json='{"b":1}'></wcs-state>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.SecondRoot);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(textOf(html, diags[0])).toBe(`<wcs-state json='{"b":1}'>`);
    expect(diags[0].message).toContain('mount=');
  });

  it('mount / bind-component・template の中・コメント・script の文字列・textarea の中は数えないこと', () => {
    const html = `<wcs-state json='{"a":1}'></wcs-state>
<wcs-state mount="sub" json='{"b":1}'></wcs-state>
<wcs-state bind-component="state"></wcs-state>
<template shadowrootmode="open"><wcs-state json='{}'></wcs-state></template>
<wcs-router><template><wcs-route path="/"><wcs-state json='{}'></wcs-state></wcs-route></template></wcs-router>
<!-- <wcs-state></wcs-state> -->
<script>host.innerHTML = '<wcs-state></wcs-state>';</script>
<textarea><wcs-state></wcs-state></textarea>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.SecondRoot)).toEqual([]);
  });

  it('name= の <wcs-state>（v2 で撤去 — 登録の前に失敗する）は root を占めないこと', () => {
    const html = `<wcs-state name="cart" json='{}'></wcs-state>\n<wcs-state json='{"a":1}'></wcs-state>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.SecondRoot)).toEqual([]);
    expect(ofCode(validate(html), WcsDiagnosticCode.NamedStateDeprecated)).toHaveLength(1);
  });

  it('タグ名の設定（stateTagName）に従うこと', () => {
    const html = `<my-state json='{}'></my-state><MY-STATE json='{}'></MY-STATE>`;
    expect(ofCode(validateDocument(html, { stateTagName: 'my-state' }), WcsDiagnosticCode.SecondRoot)).toHaveLength(1);
  });
});

describe('#direct 修飾子（4.0 で効く — 3.x は無視する）', () => {
  it('onclick#direct: を error / warning にしないこと', () => {
    const html = `${state(`save(e) {}`)}<button data-wcs="onclick#direct: save"></button><button data-wcs="onclick#prevent,direct: save"></button>`;
    expect(validate(html).filter((d) => d.severity !== 'info')).toEqual([]);
  });

  it('#direct の hover が「4.0 で効く・3.x はもともと要素に付ける」と説明すること', () => {
    const html = `${state(`save(e) {}`)}<button data-wcs="onclick#direct: save"></button>`;
    const hover = getHoverAt(html, html.indexOf('#direct') + 3, { locale: 'en' })!;
    expect(hover.markdown).toContain('#direct');
    expect(hover.markdown).toContain('4.0');
    expect(hover.markdown).toContain('3.x');
  });
});

describe('wcs/v4-migration — 委譲されるイベントのハンドラが読む event.currentTarget', () => {
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

  it('#direct の無い onclick: / oninput: … で、ハンドラが currentTarget を読むなら info を出すこと', () => {
    const html = `${handlerState}<button data-wcs="onclick: pick"></button>
<button data-wcs="onclick#prevent: pickDestructured"></button>
<input data-wcs="oninput: pickLocal">
<template data-wcs="for: items"><button data-wcs="onclick: pick"></button></template>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.V4Migration);
    expect(diags.map((d) => [d.severity, textOf(html, d)])).toEqual([
      ['info', 'onclick'], ['info', 'onclick'], ['info', 'oninput'], ['info', 'onclick'],
    ]);
    expect(diags[0].message).toContain('"onclick#direct:"');
    expect(diags[0].message).toContain('event.target.closest');
    expect(diags[0].message).toContain('"pick"');
  });

  it('#direct 付き・委譲されないイベント・カスタム要素が自分で出しうるイベント・自前の state を持つ template の中・読まないハンドラには出さないこと', () => {
    const html = `${handlerState}<button data-wcs="onclick#direct: pick"></button>
<button data-wcs="onfocus: pick"></button>
<my-input data-wcs="oninput: pick; onchange: pick"></my-input>
<my-form data-wcs="onsubmit: pick"></my-form>
<div><template shadowrootmode="open"><wcs-state json='{}'></wcs-state><button data-wcs="onclick: pick"></button></template></div>
<template data-wcs="for: items"><template id="inert-in-row"><button data-wcs="onclick: pick"></button></template></template>
<button data-wcs="onclick: plain"></button>
<button data-wcs="onclick: later"></button>
<button data-wcs="onclick: afterAwait"></button>
<button data-wcs="onclick: shadowed"></button>
<button data-wcs="onclick: $command.pick"></button>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.V4Migration)).toEqual([]);
  });

  it('カスタム要素の click（4.0 もネイティブの bubbling は root で聞く）と router の route の中には出すこと', () => {
    const html = `${handlerState}<my-button data-wcs="onclick: pick"></my-button>
<wcs-router><template><wcs-route path="/"><button data-wcs="onclick: pick"></button></wcs-route></template></wcs-router>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.V4Migration);
    expect(diags.map((d) => textOf(html, d))).toEqual(['onclick', 'onclick']);
  });

  it('書き換え先は書かれた修飾子に direct を足した形（onclick#prevent → onclick#prevent,direct）', () => {
    const html = `${handlerState}<button data-wcs="onclick#prevent,stop: pick"></button><button data-wcs="onclick: pick"></button>`;
    const diags = ofCode(validate(html), WcsDiagnosticCode.V4Migration);
    expect(diags[0].message).toContain('"onclick#prevent,stop,direct:"');
    expect(diags[1].message).toContain('"onclick#direct:"');
    const [ja] = ofCode(validate(html, 'ja'), WcsDiagnosticCode.V4Migration);
    expect(ja.message).toContain('"onclick#prevent,stop,direct:"');
  });

  it('async の submit で、最初の await の被演算子の中の e.currentTarget は同期的な読みとして拾うこと', () => {
    const html = `${state(`async submit(e) { e.preventDefault(); await fetch("/api", { method: "POST", body: new FormData(e.currentTarget) }); }`)}
<form data-wcs="onsubmit: submit"></form>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.V4Migration).map((d) => textOf(html, d))).toEqual(['onsubmit']);
  });

  it('<template> の中の <wcs-state>（宣言的 shadow root）のメソッドで、文書の束縛を報告しないこと', () => {
    const html = `<wcs-state><script type="module">export default { pick(e) { return e.target; } };</script></wcs-state>
<div><template shadowrootmode="open"><wcs-state><script type="module">export default { pick(e) { return e.currentTarget; } };</script></wcs-state></template></div>
<button data-wcs="onclick: pick"></button>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.V4Migration)).toEqual([]);
  });

  it('ボリュームのメソッドは見ないこと（root の state のハンドラだけ）', () => {
    const html = `<wcs-state><script type="module">export default { go() {} };</script></wcs-state>
<wcs-state mount="sub"><script type="module">export default { pick(e) { return e.currentTarget; } };</script></wcs-state>
<button data-wcs="onclick: pick"></button>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.V4Migration)).toEqual([]);
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
});

describe('preamble・共有の HTML 部品', () => {
  it('preamble の旧名 API の @deprecated も「4.0 で削除」を言うこと', () => {
    expect(WCS_PREAMBLE).not.toContain('4.0 で外れる');
    const lines = WCS_PREAMBLE.split('\n').filter((line) => line.includes('@deprecated'));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(line).toContain('4.0 で削除される');
      expect(line).toContain('removed in 4.0');
    }
  });

  it('createTemplateTester: コメント・script の文字列の中の <template> を数えないこと', () => {
    const html = `<!-- <template> --><script>const s = "<template>";</script><p id="a"></p><template><p id="b"></p></template><p id="c"></p>`;
    const inside = createTemplateTester(html);
    expect(inside(html.indexOf('id="a"'))).toBe(false);
    expect(inside(html.indexOf('id="b"'))).toBe(true);
    expect(inside(html.indexOf('id="c"'))).toBe(false);
  });

  it('RAW_TEXT_ELEMENTS は 1 か所（htmlParse.ts）にあり、2 つ目の root の判定も同じ集合を使うこと', () => {
    expect(RAW_TEXT_ELEMENTS.has('noscript')).toBe(true);
    expect(asciiLowerCase('İ<TEMPLATE>')).toBe('İ<template>');
    const html = `<wcs-state json='{}'></wcs-state><noembed><wcs-state></wcs-state></noembed><xmp><wcs-state></wcs-state></xmp>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.SecondRoot)).toEqual([]);
  });
});

describe('CLI: 4.0 の予告は exit code を動かさないこと', () => {
  it('wcs/v4-migration（info）だけの文書は --strict でも exit 0', () => {
    const html = `${state(`name: "abc", $scan: { n: { from: "name", initial: 0, fold: (a) => a + 1 } }`)}<p data-wcs="textContent: name|substr(0, 1)"></p>`;
    const result = runValidation([{ source: 'page.html', text: html, kind: 'html' }], { strict: true, locale: 'en' });
    const codes = [...result.diagnosticsBySource.get('page.html')!].map((d) => d.code);
    expect(codes.filter((c) => c === WcsDiagnosticCode.V4Migration)).toHaveLength(2);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.exitCode).toBe(0);
  });
});
