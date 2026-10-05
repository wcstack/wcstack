/**
 * nameAliases.drift.test.ts
 *
 * 4.0 で外れた旧名の表（`src/service/removedNames.ts`）が、4.0 の正本と矛盾しないことを固定する。
 *
 * 4.0 の manifest は旧名の表（`filterAliases` / `declarationAliases` / `apiAliases`）を空にした —
 * ランタイムが受け付けない名前を配る理由が無いため。拡張は移行の案内のために 3.x の表を凍結して
 * 持つので、ここでは次を確かめる:
 *   - manifest の旧名の表が空のまま（4.0 が旧名を受け付け直したら、拡張の「外れた」という案内は嘘になる）
 *   - フィルタの旧名と `substr` が 4.0 の組み込みに無く、書き換え先（正式名・`slice`）は組み込みにある
 *   - ランタイム（`@wcstack/state` の src — `node_modules/@wcstack/state` の実体）が拒む宣言キー・API の
 *     旧名が、拡張の表と同じ（4.0.0-rc.3 の後で検出はコアから診断の後付けへ移った: 宣言キーは
 *     `features/diagnostics.ts` の `REMOVED_DECLARATIONS`、API は同じファイルの `REMOVED_APIS` — `#1701` で投げる名前）
 *
 * src は依存の実体（`packages/state`）から読む。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { getWcsManifest } from '../src/service/wcsManifest';
import { REMOVED_API_NAMES, REMOVED_DECLARATION_KEYS, REMOVED_FILTER_NAMES, SUBSTR_FILTER } from '../src/service/removedNames';

const STATE_SRC = join(realpathSync(join(__dirname, '..', 'node_modules', '@wcstack', 'state')), 'src');

describe('4.0 で外れた旧名の表が @wcstack/state 4.0 の正本と矛盾しないこと', () => {
  const manifest = getWcsManifest();

  it('manifest の旧名の表は空（4.0 は旧名を受け付けない）', () => {
    expect(manifest.filterAliases).toEqual({});
    expect(manifest.declarationAliases).toEqual({});
    expect(manifest.apiAliases).toEqual({});
  });

  it('フィルタの旧名と substr は 4.0 の組み込みに無く、書き換え先は組み込みにある', () => {
    const filters = new Set(manifest.filters);
    for (const [old, canonical] of Object.entries(REMOVED_FILTER_NAMES)) {
      expect(filters.has(old), old).toBe(false);
      expect(filters.has(canonical), canonical).toBe(true);
    }
    expect(filters.has(SUBSTR_FILTER)).toBe(false);
    expect(filters.has('slice')).toBe(true);
  });

  it('宣言キーの旧名がランタイムの REMOVED_DECLARATIONS（診断の後付け features/diagnostics.ts）と一致する', () => {
    const diagnostics = readFileSync(join(STATE_SRC, 'features', 'diagnostics.ts'), 'utf8');
    const body = /const REMOVED_DECLARATIONS[^=]*=\s*\[([\s\S]*?)\];/.exec(diagnostics);
    expect(body, '正本の宣言が見つからない（形が変わった？）').not.toBeNull();
    const pairs = Object.fromEntries([...body![1].matchAll(/\["(\$\w+)",\s*"(\$\w+)"\]/g)].map((m) => [m[1], m[2]]));
    expect(pairs).toEqual(REMOVED_DECLARATION_KEYS);
  });

  it('API の旧名がランタイムの [wcs/name-alias]（#1701）で拒む名前（診断の後付けの REMOVED_APIS）と一致する', () => {
    const diagnostics = readFileSync(join(STATE_SRC, 'features', 'diagnostics.ts'), 'utf8');
    const body = /const REMOVED_APIS[^=]*=\s*\{([\s\S]*?)\};/.exec(diagnostics);
    expect(body, '正本の宣言が見つからない（形が変わった？）').not.toBeNull();
    const pairs = Object.fromEntries([...body![1].matchAll(/"(\$\w+)":\s*"(\$\w+)"/g)].map((m) => [m[1], m[2]]));
    expect(pairs).toEqual(REMOVED_API_NAMES);
    expect(diagnostics).toMatch(/raise\(M\.ApiRemoved, \[key, REMOVED_APIS\[key\]\]\)/);
  });

  it('表が空でないこと（読み取りが壊れて「一致」に見えるのを防ぐ）', () => {
    expect(Object.keys(REMOVED_FILTER_NAMES).length).toBeGreaterThan(0);
    expect(Object.keys(REMOVED_API_NAMES).length).toBeGreaterThan(0);
    expect(Object.keys(REMOVED_DECLARATION_KEYS).length).toBeGreaterThan(0);
  });
});
