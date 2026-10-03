import { describe, it, expect } from 'vitest';
import { BEHAVIOR_KEYS, FEATURE_NAMES, validateConfigDeclarations } from '../src/service/configDeclarationValidator';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode } from '../src/core/diagnostics';
import { getWcsManifest } from '../src/service/wcsManifest';

/**
 * 4.0 の設定の宣言（docs/state-engine-rewrite/config-impl-plan.ja.md §2.2〜§2.4・§4 段 4）:
 * 状態の `$behavior` / `$features` と、文書の root の `<wcs-state features=…>`。
 */
const diagnose = (html: string, locale = 'en') =>
  validateConfigDeclarations(html, 'wcs-state', locale).map(d => ({
    code: d.code,
    severity: d.severity,
    text: html.slice(d.start, d.end),
    message: d.message,
  }));

const state = (body: string, attrs = '') =>
  `<wcs-state${attrs}><script type="module">\nexport default {\n${body}\n};\n</script></wcs-state>`;

describe('$behavior', () => {
  it('3 つのキーと boolean の値は通す（識別子・式の値は断定しない）', () => {
    expect(diagnose(state(`  $behavior: { enableMustache: false, sameValueGuard: true, enableDirectionalInitialSync: FLAG },`))).toEqual([]);
    expect(diagnose(state(`  $behavior: { enableMustache: !DEV },`))).toEqual([]);
  });

  it('知らないキーは wcs/behavior-invalid（error）で、近い名前を提案する', () => {
    const found = diagnose(state(`  $behavior: { enableMustach: false, debug: true },`));
    expect(found.map(d => [d.code, d.severity, d.text])).toEqual([
      [WcsDiagnosticCode.BehaviorInvalid, 'error', 'enableMustach'],
      [WcsDiagnosticCode.BehaviorInvalid, 'error', 'debug'],
    ]);
    expect(found[0].message).toContain('Did you mean "enableMustache"?');
    expect(found[1].message).not.toContain('Did you mean');
  });

  it('boolean でない値（文字列・数値・null・undefined・オブジェクト・関数）は値の範囲に error', () => {
    const found = diagnose(state(`  $behavior: {
    enableMustache: "no",
    sameValueGuard: 0,
    enableDirectionalInitialSync: undefined,
  },`), 'ja');
    expect(found.map(d => d.text)).toEqual(['"no"', '0', 'undefined']);
    expect(found[0].message).toContain('true か false');
    const more = diagnose(state(`  $behavior: { enableMustache: null, sameValueGuard: {}, enableDirectionalInitialSync() { return true; } },`));
    expect(more.map(d => d.text)).toEqual(['null', '{}', 'enableDirectionalInitialSync']);
  });

  it('オブジェクトでない $behavior（null・配列も）は error、値が読めない式は黙る', () => {
    for (const value of ['"off"', '1', 'true', '() => ({})', 'null', '[]', '[{ enableMustache: false }]']) {
      const found = diagnose(state(`  $behavior: ${value},`));
      expect(found.map(d => [d.code, d.text]), value).toEqual([[WcsDiagnosticCode.BehaviorInvalid, '$behavior']]);
    }
    expect(diagnose(state(`  $behavior() { return {}; },`)).map(d => d.text)).toEqual(['$behavior']);
    for (const value of ['undefined', 'BEHAVIOR', 'make()']) {
      expect(diagnose(state(`  $behavior: ${value},`)), value).toEqual([]);
    }
  });

  it('ボリューム（mount=）の $behavior は error、マウントしたコンポーネントは自分のエンジンなので通す', () => {
    const volume = diagnose(state(`  $behavior: { enableMustache: false },`, ' mount="cart"'));
    expect(volume.map(d => [d.code, d.text])).toEqual([[WcsDiagnosticCode.BehaviorInvalid, '$behavior']]);
    expect(volume[0].message).toContain('mount="cart"');
    // ボリュームは読み込みを通らない — ランタイムは接ぎ木を拒んで console.error で報告する（throw ではない）
    expect(volume[0].message).toContain('console.error');
    expect(volume[0].message).not.toContain('throws');
    expect(diagnose(state(`  $behavior: { enableMustache: false },`, ' bind-component="card"'))).toEqual([]);
  });
});

describe('$features', () => {
  it('後付けの名前の配列は通す（識別子・spread は断定しない）', () => {
    expect(diagnose(state(`  $features: ["formats", 'temporal', "list-keys", NAME, ...MORE],`))).toEqual([]);
    expect(diagnose(state(`  $features: undefined,`))).toEqual([]);
  });

  it('知らない名前は wcs/feature-unknown（error）で、範囲は名前そのもの・近い名前を提案する', () => {
    const found = diagnose(state(`  $features: ["temporl", "formats", 1],`));
    expect(found.map(d => [d.code, d.severity, d.text])).toEqual([
      [WcsDiagnosticCode.FeatureUnknown, 'error', 'temporl'],
      [WcsDiagnosticCode.FeatureUnknown, 'error', '1'],
    ]);
    expect(found[0].message).toContain('Did you mean "temporal"?');
  });

  it('要素や値の隣のコメントがあっても名前・値を判定する（範囲はリテラルだけ）', () => {
    const found = diagnose(state(`  $features: [/* a */ "temporl" /* x */, "formats" // y
  ],
  $behavior: { enableMustache: "no" /* z */ },`));
    expect(found.map(d => [d.code, d.text])).toEqual([
      [WcsDiagnosticCode.BehaviorInvalid, '"no"'],
      [WcsDiagnosticCode.FeatureUnknown, 'temporl'],
    ]);
  });

  it('配列でない $features（文字列・null・オブジェクト・メソッド）は wcs/features-invalid', () => {
    for (const value of ['"formats"', 'null', '{}', '1']) {
      const found = diagnose(state(`  $features: ${value},`));
      expect(found.map(d => [d.code, d.text]), value).toEqual([[WcsDiagnosticCode.FeaturesInvalid, '$features']]);
    }
    expect(diagnose(state(`  $features() { return []; },`)).map(d => d.code)).toEqual([WcsDiagnosticCode.FeaturesInvalid]);
  });

  it('ボリュームの $features は error', () => {
    const found = diagnose(state(`  $features: ["temporal"],`, ' mount="cart"'), 'ja');
    expect(found.map(d => [d.code, d.text])).toEqual([[WcsDiagnosticCode.FeaturesInvalid, '$features']]);
    expect(found[0].message).toContain('ボリューム');
  });

  it('ボリュームでも、値が undefined のリテラルは宣言なし扱い（ランタイムは state[key] !== undefined で拒む）', () => {
    expect(diagnose(state(`  $features: undefined,\n  $behavior: undefined /* off */,`, ' mount="cart"'))).toEqual([]);
  });
});

describe('<wcs-state features="…">', () => {
  it('root の名前を検査する（知らない名前は名前の範囲に wcs/feature-unknown）', () => {
    const html = `<wcs-state features="scopes  diagnosticz devtools"></wcs-state>`;
    const found = diagnose(html);
    expect(found.map(d => [d.code, d.severity, d.text])).toEqual([[WcsDiagnosticCode.FeatureUnknown, 'error', 'diagnosticz']]);
    expect(found[0].message).toContain('Did you mean "diagnostics"?');
    expect(diagnose(`<wcs-state features='formats'></wcs-state>`)).toEqual([]);
    expect(diagnose(`<wcs-state features=formats></wcs-state>`)).toEqual([]);
    expect(diagnose(`<wcs-state features></wcs-state>`)).toEqual([]);
  });

  it('root 以外（mount・bind-component・2 つ目の root・<template> の中）の features= は「読まれない」warning', () => {
    const html = `
<template><wcs-state features="formats"></wcs-state></template>
<wcs-state features="scopes"></wcs-state>
<wcs-state mount="cart" features="formats"></wcs-state>
<x-card><wcs-state bind-component="card" features="formats"></wcs-state></x-card>
<wcs-state features="formats"></wcs-state>`;
    const found = validateConfigDeclarations(html, 'wcs-state', 'en');
    expect(found.map(d => [d.code, d.severity, html.slice(d.start, d.end)])).toEqual([
      [WcsDiagnosticCode.FeaturesInvalid, 'warning', 'features'],
      [WcsDiagnosticCode.FeaturesInvalid, 'warning', 'features'],
      [WcsDiagnosticCode.FeaturesInvalid, 'warning', 'features'],
      [WcsDiagnosticCode.FeaturesInvalid, 'warning', 'features'],
    ]);
    // 報告するのは root（<template> の外の、mount も bind-component も持たない最初の要素）以外の 4 つ
    const tagOf = (start: number) => html.slice(html.lastIndexOf('<wcs-state', start), start);
    expect(found.map(d => tagOf(d.start))).toEqual([
      '<wcs-state ',
      '<wcs-state mount="cart" ',
      '<wcs-state bind-component="card" ',
      '<wcs-state ',
    ]);
    expect(found[0].start).toBeLessThan(html.indexOf('</template>'));
    expect(found[3].start).toBeGreaterThan(html.indexOf('</x-card>'));
    expect(found[0].message).toContain("document's root");
  });

  it('属性値の中の "features" という文字列は属性とみなさない', () => {
    expect(diagnose(`<wcs-state data-note="features=x"></wcs-state>`)).toEqual([]);
  });
});

describe('validateDocument に配線され、エディタと CLI で同じ code と範囲になる', () => {
  it('$behavior / $features / features= が 1 つの入口から出る', () => {
    const html = `<wcs-state features="scope"><script type="module">
export default { $behavior: { enableMustach: true }, $features: ["formatz"] };
</script></wcs-state>`;
    const found = validateDocument(html, { locale: 'en' })
      .filter(d => d.code === WcsDiagnosticCode.BehaviorInvalid || d.code === WcsDiagnosticCode.FeatureUnknown)
      .map(d => [d.code, html.slice(d.start, d.end)]);
    expect(found).toEqual([
      [WcsDiagnosticCode.FeatureUnknown, 'scope'],
      [WcsDiagnosticCode.BehaviorInvalid, 'enableMustach'],
      [WcsDiagnosticCode.FeatureUnknown, 'formatz'],
    ]);
  });
});

describe('名前の表は @wcstack/state 4.0 の manifest から読む', () => {
  // manifest がランタイムの読む表（engine.ts の BEHAVIOR_KEYS・load.ts の FEATURE_NAMES）と一致することは、
  // @wcstack/state の __tests__/public-surface.test.ts が固定する。ここでは拡張が manifest をそのまま使うことを固定する
  const manifest = getWcsManifest();

  it('BEHAVIOR_KEYS は manifest の behaviorOptions のキー', () => {
    expect([...BEHAVIOR_KEYS]).toEqual(Object.keys(manifest.behaviorOptions));
    expect([...BEHAVIOR_KEYS]).toEqual(['enableMustache', 'sameValueGuard', 'enableDirectionalInitialSync']);
    expect(Object.values(manifest.behaviorOptions).every(o => o.type === 'boolean')).toBe(true);
  });

  it('FEATURE_NAMES は manifest の features', () => {
    expect([...FEATURE_NAMES]).toEqual([...manifest.features]);
    expect(FEATURE_NAMES).toContain('scopes');
  });
});
