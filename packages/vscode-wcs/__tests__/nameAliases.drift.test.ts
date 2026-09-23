/**
 * nameAliases.drift.test.ts
 *
 * 旧名 → 正式名の表（@wcstack/state 3.2・要件 B12）が正本とずれていないことを固定する。
 *
 * フィルタの別名は manifest から導出済み（`wcsManifest.ts` の `builtinFilterAliases`・番人は
 * `filterMeta.manifest.test.ts`）でドリフトしない。一方 **API と宣言キーの別名は拡張側に
 * 手書き**で、テストが 1 件も無かった — state が 3 つ目の別名を足しても拡張は黙って
 * 取りこぼす。ここがその番人。
 *
 * **なぜ導出でなく突き合わせなのか**: 正本（`packages/state/src/manifest.ts` の
 * `STATE_API_ALIASES` と `src/declarationAliases.ts` の `DECLARATION_ALIASES`）は
 * **コミット済みの dist にまだ載っていない**（`@wcstack/state/manifest` が export するのは
 * `STRUCTURAL_BINDING_TYPE_SET / WCS_MANIFEST_VERSION / builtinFilterAliases /
 * builtinFilterMeta / getWcsManifest` の 5 つだけ）。ESM の名前付き import は export が
 * 無い dist で即死するので、`core/parser/quoteAware.ts` の TODO と同じ扱い —
 * **次のリリースビルドで dist に載ったら導出へ切り替える**。それまでは state の src を
 * 読んで突き合わせる。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OLD_API_NAMES, OLD_DECLARATION_KEYS } from '../src/service/semanticValidator';

const STATE_SRC = join(__dirname, '..', '..', 'state', 'src');

/** `export const NAME = 'value';` の値を読む（定数名の参照を実値へ解決するため）。 */
function constValue(source: string, name: string): string {
  const match = new RegExp(String.raw`export const ${name}\s*=\s*["']([^"']+)["']`).exec(source);
  expect(match, `${name} が define.ts に見つからない`).not.toBeNull();
  return match![1];
}

/** `{ key: value, key: CONST }` 形のリテラルを読み、定数名は define.ts で解決する。 */
function readAliasTable(body: string, define: string): Record<string, string> {
  const out: Record<string, string> = {};
  const entry = /([$\w]+)\s*:\s*(?:["']([^"']+)["']|([A-Z_][A-Z0-9_]*))/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(body)) !== null) {
    out[match[1]] = match[2] !== undefined ? match[2] : constValue(define, match[3]);
  }
  return out;
}

describe('旧名テーブルが @wcstack/state の正本とずれていないこと', () => {
  const define = readFileSync(join(STATE_SRC, 'define.ts'), 'utf8');

  it('API の別名が STATE_API_ALIASES（manifest.ts）と一致すること', () => {
    const manifest = readFileSync(join(STATE_SRC, 'manifest.ts'), 'utf8');
    const body = /export const STATE_API_ALIASES[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(manifest);
    expect(body, '正本の宣言が見つからない（形が変わった？）').not.toBeNull();
    expect(OLD_API_NAMES).toEqual(readAliasTable(body![1], define));
  });

  it('宣言キーの別名が DECLARATION_ALIASES（declarationAliases.ts）と一致すること', () => {
    const source = readFileSync(join(STATE_SRC, 'declarationAliases.ts'), 'utf8');
    const body = /export const DECLARATION_ALIASES[^=]*=\s*\{([\s\S]*?)\};/.exec(source);
    expect(body, '正本の宣言が見つからない（形が変わった？）').not.toBeNull();
    expect(OLD_DECLARATION_KEYS).toEqual(readAliasTable(body![1], define));
  });

  it('正本の表が空でないこと（読み取りが壊れて「一致」に見えるのを防ぐ）', () => {
    expect(Object.keys(OLD_API_NAMES).length).toBeGreaterThan(0);
    expect(Object.keys(OLD_DECLARATION_KEYS).length).toBeGreaterThan(0);
  });
});
