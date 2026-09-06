/**
 * referenceIndex.test.ts — 参照インデックス(結線の一級データ化)の契約検証 +
 * リポジトリ実 HTML への正本パリティ・コーパステスト。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildReferenceIndex } from '../src/core/index/referenceIndex';
import { findAllBindAttributes, splitBindingExpressions } from '../src/service/bindingValidator';
import { parseBindTextWithPositions } from '../src/core/parser/positionalParser';

const SAMPLE = `
<wcs-state>
  <script type="module">
export default {
  count: 0,
  user: { name: "a" },
  items: [{ label: "x" }],
  get "items.*.upper"() { return this["items.*.label"]; },
  addItem() {},
};
  </script>
</wcs-state>
<wcs-state name="cart">
  <script type="module">
export default { total: 0 };
  </script>
</wcs-state>
<span data-wcs="textContent: user.name"></span>
<input data-wcs="value#ro: count; onclick: addItem">
<template data-wcs="for: items"><span data-wcs="textContent: .label"></span></template>
<p data-wcs="textContent: total"></p>
<p>{{ count | fix(0) }}</p>
<p><!--@@:user.name--></p>
`;

describe('buildReferenceIndex', () => {
  const index = buildReferenceIndex(SAMPLE);

  it('属性・mustache・コメントの 3 形からパス出現を収集すること', () => {
    const counts = new Map<string, number>();
    for (const occurrence of index.occurrences) {
      counts.set(occurrence.source, (counts.get(occurrence.source) ?? 0) + 1);
    }
    expect(counts.get('attribute')).toBeGreaterThanOrEqual(5);
    expect(counts.get('mustache')).toBe(1);
    expect(counts.get('comment')).toBe(1);
    expect(index.problems).toHaveLength(0);
  });

  it('referencesOf がパス単位の出現を返し、スパンが原文と一致すること', () => {
    const refs = index.referencesOf('user.name');
    expect(refs).toHaveLength(2); // 属性 + コメントバインディング
    for (const ref of refs) {
      expect(SAMPLE.slice(ref.pathRange.start, ref.pathRange.end)).toBe('user.name');
    }
    const mustacheRef = index.referencesOf('count').find(r => r.source === 'mustache');
    expect(mustacheRef).toBeDefined();
    expect(SAMPLE.slice(mustacheRef!.pathRange.start, mustacheRef!.pathRange.end)).toBe('count');
  });

  it('@state を含む式は v2 の parse error として problems に落ちること', () => {
    const idx = buildReferenceIndex('<p data-wcs="textContent: total@cart"></p>');
    expect(idx.problems).toHaveLength(1);
    expect(idx.problems[0].message).toContain('removed in v2');
    expect(idx.referencesOf('total')).toHaveLength(0);
  });

  it('declarationOf が完全一致 → 第 1 セグメントの順で解決すること', () => {
    const exact = index.declarationOf('count');
    expect(exact).not.toBeNull();
    expect(SAMPLE.slice(exact!.range.start, exact!.range.end)).toBe('count');

    // ドット付きパスはトップレベル名へフォールバック
    const fallback = index.declarationOf('user.name');
    expect(fallback?.name).toBe('user');

    // 引用符付き getter はフルパス名で完全一致
    const getter = index.declarationOf('items.*.upper');
    expect(getter?.kind).toBe('getter');
    expect(SAMPLE.slice(getter!.range.start, getter!.range.end)).toBe('items.*.upper');

    // 別 state の宣言
    expect(index.declarationOf('nosuch')).toBeNull();
  });

  it('occurrenceAt がパス文字列上のオフセットだけにヒットすること', () => {
    const ref = index.referencesOf('user.name')[0];
    expect(index.occurrenceAt(ref.pathRange.start)).toBe(ref);
    expect(index.occurrenceAt(ref.pathRange.end - 1)).toBe(ref);
    expect(index.occurrenceAt(ref.pathRange.end)).not.toBe(ref);
  });

  it('壊れた式は problems に落ち、他の出現を止めないこと', () => {
    const broken = buildReferenceIndex('<span data-wcs="oops"></span><span data-wcs="textContent: ok"></span>');
    expect(broken.problems).toHaveLength(1);
    expect(broken.referencesOf('ok')).toHaveLength(1);
  });

  it('eventToken の右辺はパス空間に入れないこと（データプロパティ同名の誤解決防止）', () => {
    const html = `
<wcs-state><script type="module">
export default { changed: 0, $eventTokens: ["changed"] };
</script></wcs-state>
<wcs-ws data-wcs="eventToken.message: changed"></wcs-ws>
<span data-wcs="textContent: changed"></span>
`;
    const idx = buildReferenceIndex(html);
    const tokenOccurrence = idx.occurrences.find(o => o.kind === 'eventToken');
    expect(tokenOccurrence).toBeDefined();
    expect(tokenOccurrence!.path).toBe('changed');
    // referencesOf はデータパス出現(textContent 側)だけを返す
    const refs = idx.referencesOf('changed');
    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe('path');
  });

  it('referencesOf は複製を返すこと（呼び出し側の変異でインデックスが壊れない）', () => {
    const refs = index.referencesOf('user.name');
    refs.length = 0;
    expect(index.referencesOf('user.name')).toHaveLength(2);
  });

  it('propRange が出現に載ること', () => {
    const ref = index.referencesOf('total')[0];
    expect(SAMPLE.slice(ref.propRange!.start, ref.propRange!.end)).toBe('textContent');
  });

  it('text チャネルはランタイムと同じく `;` を分割しないこと（embedded 経路の正本化）', () => {
    // ランタイムは {{ a; b }} を parseBindTextForEmbeddedNode（無分割）で
    // 「a; b」1 本のパスとして束縛する。v1.29.0 で同関数が subpath export され、
    // ここも同一経路になった — 分割由来の偽 problems は出ない。
    const html = '<template><p>{{ a; b }}</p></template>';
    const idx = buildReferenceIndex(html);
    expect(idx.problems).toHaveLength(0);
    expect(idx.referencesOf('a')).toHaveLength(0);
    const refs = idx.referencesOf('a; b');
    expect(refs).toHaveLength(1);
    expect(html.slice(refs[0].pathRange.start, refs[0].pathRange.end)).toBe('a; b');
  });

  it('text チャネルの壊れた式は problems に載り、位置は式全体を指すこと', () => {
    const html = '<template><p>{{ count | }}</p></template>';
    const idx = buildReferenceIndex(html);
    expect(idx.problems).toHaveLength(1);
    const problem = idx.problems[0];
    expect(html.slice(problem.range.start, problem.range.end)).toBe('count |');
  });
});

describe('コーパスパリティ — リポジトリ実 HTML を正本パーサが全件受理すること', () => {
  // CI の wcs-validate はリポジトリ全 HTML を 0 errors でゲートしており、全 examples は
  // ランタイム(= 正本パーサ)で実際に動いている。したがって正本ベースのインデックスは
  // 実在コーパスで problems ゼロでなければならない。同時に、式分割数が既存の
  // splitBindingExpressions(括弧深度考慮)と一致することも確認する — 乖離があれば
  // そのファイルが既知乖離(括弧内セミコロン)の実例ということになる。
  const repoRoot = join(__dirname, '..', '..', '..');
  const roots = [join(repoRoot, 'examples')];
  // 各パッケージの examples/ も対象（test-fixture 等の意図的に壊れた HTML は含めない）
  for (const pkg of readdirSync(join(repoRoot, 'packages'))) {
    const examplesDir = join(repoRoot, 'packages', pkg, 'examples');
    try {
      if (statSync(examplesDir).isDirectory()) roots.push(examplesDir);
    } catch {
      // examples を持たないパッケージ
    }
  }
  const htmlFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.html')) htmlFiles.push(full);
    }
  };
  for (const root of roots) walk(root);

  it(`examples の全 HTML(${htmlFiles.length} ファイル)で problems ゼロ・分割数一致`, () => {
    expect(htmlFiles.length).toBeGreaterThan(10);
    const failures: string[] = [];
    for (const file of htmlFiles) {
      const html = readFileSync(file, 'utf8');
      for (const attr of findAllBindAttributes(html, 'data-wcs')) {
        const canonical = parseBindTextWithPositions(attr.value);
        for (const binding of canonical) {
          if (binding.parsed === null) {
            failures.push(`${file}: "${attr.value}" -> ${binding.error}`);
          }
        }
        const regexCount = splitBindingExpressions(attr.value).filter(e => e.trim().length > 0).length;
        if (canonical.length !== regexCount) {
          failures.push(`${file}: split divergence "${attr.value}" (canonical ${canonical.length} vs regex ${regexCount})`);
        }
      }
    }
    expect(failures, failures.join('\n')).toHaveLength(0);
  });
});
