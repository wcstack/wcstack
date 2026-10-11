/**
 * scopeDeclarationValidator.test.ts — ボリューム（`<wcs-state mount>`）が受け付けない宣言と、
 * `<wcs-state bind-component>` と併記した読み込み（@wcstack/state 4.0 の scopes/volume.ts・component.ts）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import {
  BIND_COMPONENT_SOURCE_ATTRIBUTES,
  VOLUME_NOT_RUN,
  VOLUME_REJECTED,
  VOLUME_REJECTED_ELSEWHERE,
  validateScopeDeclarations,
} from '../src/service/scopeDeclarationValidator';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

const volume = (body: string, mount = 'cart') =>
  `<wcs-state></wcs-state><wcs-state mount="${mount}"><script type="module">\nexport default {\n  total: 0,\n${body}\n};\n</script></wcs-state>`;

const diagnose = (html: string, locale = 'en') =>
  validateScopeDeclarations(html, 'wcs-state', locale).map(d => ({
    code: d.code,
    severity: d.severity,
    text: html.slice(d.start, d.end),
    message: d.message,
  }));

describe('ボリュームが拒む宣言（REJECTED）', () => {
  it('$stream・$watch・$listKeys・$renderedCallback は wcs/volume-declaration（error）', () => {
    const found = diagnose(volume(`  $stream: { feed: { source: async function* () {} } },
  $watch: { total() {} },
  $listKeys: { items: "id" },
  $renderedCallback() {},`));
    expect(found.map(d => [d.code, d.severity, d.text])).toEqual([
      [WcsDiagnosticCode.VolumeDeclaration, 'error', '$stream'],
      [WcsDiagnosticCode.VolumeDeclaration, 'error', '$watch'],
      [WcsDiagnosticCode.VolumeDeclaration, 'error', '$listKeys'],
      [WcsDiagnosticCode.VolumeDeclaration, 'error', '$renderedCallback'],
    ]);
    expect(found[0].message).toContain('mount="cart"');
    expect(found[0].message).toContain('refuses to graft');
    expect(found[0].message).toContain('Declare it on the root state');
  });

  it('日本語の文面は「接ぎ木を拒んで報告する・root の state に書く」', () => {
    const [d] = diagnose(volume(`  $watch: { total() {} },`), 'ja');
    expect(d.message).toContain('接ぎ木を拒んで console.error で報告します');
    expect(d.message).toContain('root の state に宣言してください');
  });

  it('値が undefined のリテラルは宣言なし扱い（ランタイムは state[key] !== undefined で判定する）', () => {
    expect(diagnose(volume(`  $watch: undefined,\n  $on: undefined /* off */,`))).toEqual([]);
  });

  it('root の state・文字列・コメントには当たらない', () => {
    expect(diagnose(`<wcs-state><script type="module">export default { $watch: { a() {} }, $on: {} };</script></wcs-state>`)).toEqual([]);
    expect(diagnose(volume(`  label: "$watch: {}", // $listKeys: {}`))).toEqual([]);
  });

  it('ほかの検査が自分の code で報告するもの（$scan・$recursion・$behavior・$features・旧名）は重ねない', () => {
    const html = volume(`  $scan: {},
  $recursion: { tree: "children" },
  $behavior: { enableMustache: false },
  $features: ["formats"],
  $streams: {},
  $updatedCallback() {},`);
    expect(diagnose(html)).toEqual([]);
    // その代わりにそれぞれの code で、ボリュームの文面が出る
    const all = validateDocument(html, { locale: 'en' });
    for (const [key, code] of Object.entries(VOLUME_REJECTED_ELSEWHERE)) {
      const hit = all.find(d => d.code === code && html.slice(d.start, d.end) === key);
      expect([key, hit?.severity]).toEqual([key, 'error']);
      expect(hit!.message).toContain('mount="cart"');
    }
  });
});

describe('ボリュームで実行されない宣言（NOT_RUN）', () => {
  it('$commandTokens・$eventTokens・$on・$errorCallback は wcs/volume-declaration（warning）', () => {
    const found = diagnose(volume(`  $commandTokens: ["reload"],
  $eventTokens: ["saved"],
  $on: { saved() {} },
  $errorCallback(e) {},`));
    expect(found.map(d => [d.code, d.severity, d.text])).toEqual([
      [WcsDiagnosticCode.VolumeDeclaration, 'warning', '$commandTokens'],
      [WcsDiagnosticCode.VolumeDeclaration, 'warning', '$eventTokens'],
      [WcsDiagnosticCode.VolumeDeclaration, 'warning', '$on'],
      [WcsDiagnosticCode.VolumeDeclaration, 'warning', '$errorCallback'],
    ]);
    expect(found[0].message).toContain('console.warn');
  });
});

describe('宣言が静的に読めない形（class 構文）', () => {
  it('正規表現で拾い、severity を 1 段下げる（REJECTED は warning、NOT_RUN は info）', () => {
    const html = `<wcs-state></wcs-state><wcs-state mount="v"><script type="module">
export default class {
  $watch = { total() {} };
  $on = undefined;
  $errorCallback(e) {}
  $streams = {};
  check() { return this.$watch == null; }
}
</script></wcs-state>`;
    expect(diagnose(html).map(d => [d.code, d.severity, d.text])).toEqual([
      [WcsDiagnosticCode.VolumeDeclaration, 'warning', '$watch'],
      [WcsDiagnosticCode.VolumeDeclaration, 'info', '$errorCallback'],
    ]);
  });
});

describe('bind-component と併記した読み込み', () => {
  it('state / src / json 属性・中の <script type="module"> は開始タグに wcs/bind-component-source（error）', () => {
    const html = `<my-card><template shadowrootmode="open"><wcs-state bind-component="state" json='{"a":1}'><script type="module">export default { $watch: {} };</script></wcs-state></template></my-card>`;
    const found = diagnose(html);
    expect(found.map(d => [d.code, d.severity, d.text])).toEqual([
      [WcsDiagnosticCode.BindComponentSource, 'error', `<wcs-state bind-component="state" json='{"a":1}'>`],
    ]);
    expect(found[0].message).toContain('<host>.state');
    expect(found[0].message).toContain('json, <script type="module">');
    expect(found[0].message).toContain('does not mount');
  });

  it('属性ごとに挙げる（値の無い属性も）', () => {
    expect(diagnose(`<x-a><wcs-state bind-component="s" src="./s.js" state></wcs-state></x-a>`)[0].message)
      .toContain('with state, src,');
  });

  it('読み込みを持たない bind-component・ボリュームの宣言としては見ない', () => {
    expect(diagnose(`<x-a><template shadowrootmode="open"><wcs-state bind-component="state"></wcs-state></template></x-a>`)).toEqual([]);
  });

  it('中のスクリプトはランタイムが読まないので、宣言・スクリプトの検査を重ねない（validateDocument の error は 1 件）', () => {
    const html = `<x-a><template shadowrootmode="open"><wcs-state bind-component="state"><script type="module">
export default {
  $recursion: { "node.*": "children.*" },
  $scan: {},
  $watch: { nope() {} },
  $behavior: { enableMustach: false },
  get "items.*.a"() { return this.$129; },
  m() { this.items.push(1); this.$trackDependency("a"); },
  zzz: 1,
  $renderedCallback() { if (this.zzz) {} },
};
</script></wcs-state></template></x-a>`;
    expect(validateDocument(html, { locale: 'en' }).map(d => [d.code, d.severity])).toEqual([
      [WcsDiagnosticCode.BindComponentSource, 'error'],
    ]);
  });

  it('日本語の文面', () => {
    const [d] = diagnose(`<x-a><wcs-state bind-component="s" json='{}'></wcs-state></x-a>`, 'ja');
    expect(d.message).toContain('<ホスト>.s');
    expect(d.message).toContain('コンポーネントはマウントされません');
  });
});

describe('同じ root の 2 つ目の <wcs-state>', () => {
  it('mount も bind-component も持たない 2 つ目以降の開始タグに wcs/second-root（error）', () => {
    const html = `<wcs-state json='{"a":1}'></wcs-state><p>{{ a }}</p><wcs-state json='{"b":1}'></wcs-state><wcs-state></wcs-state>`;
    const found = diagnose(html);
    expect(found.map(d => [d.code, d.severity, d.text])).toEqual([
      [WcsDiagnosticCode.SecondRoot, 'error', `<wcs-state json='{"b":1}'>`],
      [WcsDiagnosticCode.SecondRoot, 'error', '<wcs-state>'],
    ]);
    expect(found[0].message).toContain('one state tree per root');
    expect(found[0].message).toContain('<wcs-state mount="path">');
    expect(diagnose(html, 'ja')[0].message).toContain('root ごとに 1 つ');
  });

  it('ボリューム・bind-component・<template> の中（宣言的 Shadow DOM など別の root）・コメントの中は数えない', () => {
    const html = `<wcs-state></wcs-state>
<wcs-state mount="cart"></wcs-state>
<x-a><template shadowrootmode="open"><wcs-state></wcs-state><wcs-state bind-component="s"></wcs-state></template></x-a>
<!-- <wcs-state></wcs-state> -->`;
    expect(diagnose(html)).toEqual([]);
  });

  it('JS で作る shadow DOM（innerHTML の文字列）・script の文字列・textarea の中の <wcs-state> は文書の root ではない', () => {
    const html = `<wcs-state json='{"count":1}'></wcs-state>
<x-counter></x-counter>
<script type="module">
customElements.define("x-counter", class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = \`<wcs-state json='{"n":1}'></wcs-state><p>{{ n }}</p>\`;
  }
});
const t = "<wcs-state json='{}'></wcs-state>";
</script>
<textarea><wcs-state></wcs-state></textarea>
<title><wcs-state></wcs-state></title>
<style>/* <wcs-state> */</style>`;
    expect(diagnose(html)).toEqual([]);
    expect(validateDocument(html, { locale: 'en' }).filter(d => d.severity === 'error')).toEqual([]);
  });

  it('script の文字列の <template> で root の判定を取り違えない', () => {
    const html = `<script>const tpl = "<template>";</script>
<wcs-state></wcs-state>
<wcs-state></wcs-state>`;
    expect(diagnose(html).map(d => d.code)).toEqual([WcsDiagnosticCode.SecondRoot]);
  });

  it('<wcs-state> が 1 つだけなら解析しない', () => {
    expect(validateScopeDeclarations(`<wcs-state></wcs-state><p>{{ a }}</p>`)).toEqual([]);
  });
});

describe('文書にボリュームも bind-component も無ければ解析しない', () => {
  it('ゲート', () => {
    expect(validateScopeDeclarations(`<wcs-state><script type="module">export default { $watch: {} };</script></wcs-state><p>amount</p>`)).toEqual([]);
  });

  it('validateDocument に載っている（IDE と CLI が同じ code・範囲）', () => {
    const html = volume(`  $watch: { total() {} },`);
    const hit = validateDocument(html, { locale: 'en' }).filter(d => d.code === WcsDiagnosticCode.VolumeDeclaration);
    expect(hit.map(d => html.slice(d.start, d.end))).toEqual(['$watch']);
  });
});

describe('表が @wcstack/state 4.0 の src とずれていないこと', () => {
  // 依存の実体（packages/state）の src を読む
  const src = join(realpathSync(join(__dirname, '..', 'node_modules', '@wcstack', 'state')), 'src');
  const listOf = (text: string, name: string): string[] => {
    const body = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(text);
    expect(body).not.toBeNull();
    return [...body![1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  };

  it('VOLUME_REJECTED / VOLUME_NOT_RUN が scopes/volume.ts と一致する', () => {
    const volumeTs = readFileSync(join(src, 'scopes', 'volume.ts'), 'utf8');
    expect([...VOLUME_REJECTED]).toEqual(listOf(volumeTs, 'REJECTED'));
    expect([...VOLUME_NOT_RUN]).toEqual(listOf(volumeTs, 'NOT_RUN'));
    for (const key of Object.keys(VOLUME_REJECTED_ELSEWHERE)) expect(VOLUME_REJECTED).toContain(key);
  });

  it('bind-component と併記できない読み込みが scopes/component.ts の load と一致する', () => {
    const componentTs = readFileSync(join(src, 'scopes', 'component.ts'), 'utf8');
    const load = /async function load\([\s\S]*?raiseError\(/.exec(componentTs);
    expect(load).not.toBeNull();
    expect(load![0]).toContain(`[${BIND_COMPONENT_SOURCE_ATTRIBUTES.map(a => `"${a}"`).join(', ')}].some((a) => el.hasAttribute(a))`);
    expect(load![0]).toContain(`el.querySelector('script[type="module"]') !== null`);
  });
});
