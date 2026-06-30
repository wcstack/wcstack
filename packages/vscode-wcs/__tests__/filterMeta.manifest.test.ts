/**
 * filterMeta.manifest.test.ts — BUILTIN_FILTERS が @wcstack/state の filterMeta 正本から
 * 自動導出され、手リストの二重実装が解消されていることを保証する（route-a A2-1 / ②）。
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_FILTERS, STRUCTURAL_DIRECTIVES } from '../src/service/completionData';
import {
  builtinFilterMeta,
  STRUCTURAL_BINDING_TYPE_SET,
} from '../src/service/wcsManifest';

describe('BUILTIN_FILTERS は manifest（filterMeta 正本）から導出される', () => {
  it('フィルタ名集合が正本と完全一致する（手リスト撤去・ドリフト不可）', () => {
    expect(BUILTIN_FILTERS.map((f) => f.name).sort()).toEqual(Object.keys(builtinFilterMeta).sort());
  });

  it('各エントリが正本のメタデータをそのまま保持する', () => {
    for (const f of BUILTIN_FILTERS) {
      const meta = builtinFilterMeta[f.name];
      expect(meta, f.name).toBeDefined();
      expect(f.description).toBe(meta.description);
      expect(f.hasArgs).toBe(meta.hasArgs);
      expect(f.resultType).toBe(meta.resultType);
      expect(f.minArgs).toBe(meta.minArgs);
      expect(f.maxArgs).toBe(meta.maxArgs);
    }
  });

  it('代表的なフィルタが補完情報として引ける', () => {
    const byName = new Map(BUILTIN_FILTERS.map((f) => [f.name, f]));
    expect(byName.get('eq')?.hasArgs).toBe(true);
    expect(byName.get('slice')?.maxArgs).toBe(2);
    expect(byName.get('null')?.resultType).toBe('passthrough');
    expect(BUILTIN_FILTERS.length).toBe(40);
  });
});

describe('STRUCTURAL_DIRECTIVES も正本（STRUCTURAL_BINDING_TYPE_SET）から導出される', () => {
  it('ディレクティブ名集合が正本と一致する', () => {
    expect(STRUCTURAL_DIRECTIVES.map((d) => d.name).sort()).toEqual([...STRUCTURAL_BINDING_TYPE_SET].sort());
  });
  it('各ディレクティブに説明と insertColon が付く', () => {
    for (const d of STRUCTURAL_DIRECTIVES) {
      expect(d.description, d.name).toBeTruthy();
      expect(typeof d.insertColon, d.name).toBe('boolean');
    }
  });
});
