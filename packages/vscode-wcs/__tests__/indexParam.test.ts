/**
 * indexParam.test.ts — ループの添字の範囲（`$1`〜`$128`）の外（@wcstack/state 4.0）。
 *
 *   - マークアップの `$129`（for の中）→ `wcs/index-param-range`（error。ランタイムはバインディングを失敗させる）
 *   - マークアップの `$0` / `$01` / `$1000` → `wcs/binding-path-missing`（error。添字でもパスでもない — ランタイムと同じ code）
 *   - スクリプトの `this.$0` / `this.$129` / `this.$1000` → `wcs/index-param-range`（error。読んだ時点で throw）
 *
 * 上限は manifest（`syntax.indexParam.maxDepth`）から取り、添字の形はランタイムの正規表現と突き合わせる。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { classifyIndexParam, isOutOfRangeIndexRead, MAX_INDEX_PARAM } from '../src/service/indexPath';
import { getWcsManifest } from '../src/service/wcsManifest';
import { validateBindings } from '../src/service/bindingValidator';
import { validateTemplateSyntax } from '../src/service/templateSyntaxValidator';
import { validateSemantics } from '../src/service/semanticValidator';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

const STATE = `<wcs-state><script type="module">export default { items: [{ n: 1 }], matrix: [[1]] };</script></wcs-state>`;

const pick = (html: string, diagnostics: { code: string; start: number; end: number; severity: string }[], ...codes: string[]) =>
  diagnostics.filter(d => codes.includes(d.code)).map(d => [d.code, d.severity, html.slice(d.start, d.end)]);

describe('添字の形と上限は 4.0 の正本と同じ', () => {
  // 依存の実体（packages/state）の src を読む
  const src = join(realpathSync(join(__dirname, '..', 'node_modules', '@wcstack', 'state')), 'src');

  it('上限は manifest の syntax.indexParam.maxDepth（128）', () => {
    expect(MAX_INDEX_PARAM).toBe(getWcsManifest().syntax.indexParam.maxDepth);
    expect(MAX_INDEX_PARAM).toBe(128);
  });

  it('添字と読む名前はランタイムの INDEX_PARAM と一致する', () => {
    const define = readFileSync(join(src, 'parser', 'define.ts'), 'utf8');
    const literal = /export const INDEX_PARAM = \/(.+)\/;/.exec(define);
    expect(literal).not.toBeNull();
    const runtime = new RegExp(literal![1]);
    const max = Number(/export const MAX_INDEX_PARAM = (\d+);/.exec(define)![1]);
    expect(max).toBe(MAX_INDEX_PARAM);
    const samples = ['$0', '$00', '$01', '$1', '$9', '$10', '$99', '$128', '$129', '$999', '$1000', '$10000'];
    for (const s of samples) {
      const kind = classifyIndexParam(s)!.kind;
      const expected = !runtime.test(s) ? 'notIndex' : Number(s.slice(1)) <= max ? 'index' : 'range';
      expect([s, kind]).toEqual([s, expected]);
    }
  });

  it('スクリプトの読みはランタイムの dollar と同じ規則で投げる（$ の次が数字なら $1〜$128 のほかはすべて）', () => {
    for (const name of ['$0', '$01', '$129', '$999', '$1000', '$1x']) expect([name, isOutOfRangeIndexRead(name)]).toEqual([name, true]);
    for (const name of ['$1', '$64', '$128', '$command', '$', 'x1', '$$1']) expect([name, isOutOfRangeIndexRead(name)]).toEqual([name, false]);
  });

  it('$ と数字だけでないパスは分類しない', () => {
    expect(classifyIndexParam('$1.x')).toBeNull();
    expect(classifyIndexParam('$command.x')).toBeNull();
    expect(classifyIndexParam('items.*')).toBeNull();
  });
});

describe('マークアップ（data-wcs）', () => {
  it('for の中の $129 は wcs/index-param-range（error）で、段数の検査は重ねない', () => {
    const html = `${STATE}<template data-wcs="for: items"><li data-wcs="textContent: $129"></li></template>`;
    expect(pick(html, validateBindings(html, 'data-wcs', 'wcs-state', 'en'), WcsDiagnosticCode.IndexParamRange, WcsDiagnosticCode.WildcardRank, WcsDiagnosticCode.TemplateSyntax))
      .toEqual([[WcsDiagnosticCode.IndexParamRange, 'error', '$129']]);
    const [d] = validateBindings(html, 'data-wcs', 'wcs-state', 'en').filter(x => x.code === WcsDiagnosticCode.IndexParamRange);
    expect(d.message).toContain('from $1 to $128');
  });

  it('$0・$01・$1000 は wcs/binding-path-missing（error）— for の中でも外でも、「for の外のループ添字」は出さない', () => {
    for (const key of ['$0', '$01', '$1000']) {
      const inside = `${STATE}<template data-wcs="for: items"><li data-wcs="textContent: ${key}"></li></template>`;
      expect(pick(inside, validateBindings(inside, 'data-wcs', 'wcs-state', 'en'),
        WcsDiagnosticCode.BindingPathMissing, WcsDiagnosticCode.IndexParamRange, WcsDiagnosticCode.WildcardRank, WcsDiagnosticCode.TemplateSyntax))
        .toEqual([[WcsDiagnosticCode.BindingPathMissing, 'error', key]]);
      const outside = `${STATE}<p data-wcs="textContent: ${key}"></p>`;
      expect(pick(outside, validateBindings(outside, 'data-wcs', 'wcs-state', 'en'),
        WcsDiagnosticCode.BindingPathMissing, WcsDiagnosticCode.TemplateSyntax))
        .toEqual([[WcsDiagnosticCode.BindingPathMissing, 'error', key]]);
    }
  });

  it('state の候補が無くても $0 は断定する（$ の名前空間に状態のパスは無い）', () => {
    const html = `<template data-wcs="for: items"><li data-wcs="textContent: $0"></li></template>`;
    expect(pick(html, validateBindings(html, 'data-wcs', 'wcs-state', 'en'), WcsDiagnosticCode.BindingPathMissing))
      .toEqual([[WcsDiagnosticCode.BindingPathMissing, 'error', '$0']]);
  });

  it('for の外の $1・$129 は「for の外のループ添字」— ランタイムと同じ wcs/wildcard-rank（範囲より先に #1401 で投げる）', () => {
    for (const key of ['$1', '$129']) {
      const html = `${STATE}<p data-wcs="textContent: ${key}"></p><p>{{ ${key} }}</p>`;
      const all = [...validateBindings(html, 'data-wcs', 'wcs-state', 'en'), ...validateTemplateSyntax(html, 'wcs-state', 'data-wcs', 'en')];
      expect(pick(html, all, WcsDiagnosticCode.IndexParamRange, WcsDiagnosticCode.WildcardRank))
        .toEqual([[WcsDiagnosticCode.WildcardRank, 'warning', key], [WcsDiagnosticCode.WildcardRank, 'warning', key]]);
    }
  });

  it('$1〜$128 は範囲の検査に当たらない（段数の検査は従来どおり）', () => {
    const html = `${STATE}<template data-wcs="for: items"><li data-wcs="textContent: $1"></li><li data-wcs="textContent: $128"></li></template>`;
    expect(pick(html, validateBindings(html, 'data-wcs', 'wcs-state', 'en'), WcsDiagnosticCode.IndexParamRange, WcsDiagnosticCode.BindingPathMissing, WcsDiagnosticCode.WildcardRank))
      .toEqual([[WcsDiagnosticCode.WildcardRank, 'warning', '$128']]);
  });
});

describe('マークアップ（mustache）', () => {
  it('for の中の {{ $129 }} は wcs/index-param-range、{{ $0 }} は wcs/binding-path-missing（どちらも error）', () => {
    const html = `${STATE}<template data-wcs="for: items"><li>{{ $129 }}</li><li>{{ $0 }}</li><li>{{ $1 }}</li></template>`;
    expect(pick(html, validateTemplateSyntax(html, 'wcs-state', 'data-wcs', 'en'),
      WcsDiagnosticCode.IndexParamRange, WcsDiagnosticCode.BindingPathMissing, WcsDiagnosticCode.WildcardRank))
      .toEqual([
        [WcsDiagnosticCode.IndexParamRange, 'error', '$129'],
        [WcsDiagnosticCode.BindingPathMissing, 'error', '$0'],
      ]);
  });
});

describe('スクリプト（this.$N）', () => {
  const script = (body: string) => `<wcs-state><script type="module">export default {\n  items: [1],\n${body}\n};</script></wcs-state>`;
  const found = (html: string) => pick(html, validateSemantics(html, 'wcs-state', 'en'), WcsDiagnosticCode.IndexParamRange);

  it('getter・メソッド・$watch のハンドラの this.$0 / this.$129 / this["$1000"] は error', () => {
    const html = script(`  get "items.*.a"() { return this.$0; },
  get "items.*.b"() { return this.$129; },
  m() { return this["$1000"]; },
  $watch: { items() { return this.$01; } },`);
    expect(found(html)).toEqual([
      [WcsDiagnosticCode.IndexParamRange, 'error', '$0'],
      [WcsDiagnosticCode.IndexParamRange, 'error', '$129'],
      [WcsDiagnosticCode.IndexParamRange, 'error', '$1000'],
      [WcsDiagnosticCode.IndexParamRange, 'error', '$01'],
    ]);
  });

  it('$1〜$128・this でないもの・アロー関数のデータ値・文字列とコメントは報告しない', () => {
    const html = script(`  get "items.*.a"() { return this.$1 + this.$128 + other.$0 + "this.$0"; /* this.$129 */ },
  probe: () => this.$0,`);
    expect(found(html)).toEqual([]);
  });

  it('宣言が静的に読めない形（class 構文）は正規表現で拾い、warning に留める', () => {
    const html = `<wcs-state><script type="module">export default class { get x() { return this.$129 + this.$2; } }</script></wcs-state>`;
    expect(found(html)).toEqual([[WcsDiagnosticCode.IndexParamRange, 'warning', '$129']]);
  });

  it('validateDocument からも同じ code と範囲で出る（IDE と CLI が同じ）', () => {
    const html = script(`  get "items.*.a"() { return this.$129; },`);
    expect(pick(html, validateDocument(html, { locale: 'ja' }), WcsDiagnosticCode.IndexParamRange))
      .toEqual([[WcsDiagnosticCode.IndexParamRange, 'error', '$129']]);
    const [d] = validateDocument(html, { locale: 'ja' }).filter(x => x.code === WcsDiagnosticCode.IndexParamRange);
    expect(d.message).toContain('$1 から $128 まで');
  });
});
