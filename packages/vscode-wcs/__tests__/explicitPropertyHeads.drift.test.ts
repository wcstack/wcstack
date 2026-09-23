/**
 * explicitPropertyHeads.drift.test.ts
 *
 * 明示のプロパティ形（`.name:`）の先頭に置けない語の集合が、ランタイム正本
 * （`packages/state/src/bindTextParser/parseBindTextsForElement.ts` の
 * `EXPLICIT_PROPERTY_REJECTED_HEADS`）とずれていないことを固定する。
 *
 * 5 語は manifest から導出できるが、6 語目の `state`（`VOLUME_INJECTION_PROP`）は manifest に
 * 載っていないので拡張側で手書きしている。手書きが 1 語でもずれると、正本パーサが
 * `[wcs/binding-syntax]`（error）で落とす形に `wcs/tag-member-unknown`（warning）を重ねて
 * 同じ 1 か所に 2 件出る（`.state.x:` で実際に起きていた）。
 *
 * 突き合わせは**state の src を読む**（コミット済み dist は src に遅行するため）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPLICIT_PROPERTY_REJECTED_HEADS } from '../src/service/ioNodeValidator';
import { getWcsManifest } from '../src/service/wcsManifest';

const STATE_SRC = join(__dirname, '..', '..', 'state', 'src');

/** `export const NAME = 'value';` の値を読む。 */
function constValue(source: string, name: string): string {
  const match = new RegExp(String.raw`export const ${name}\s*=\s*["']([^"']+)["']`).exec(source);
  expect(match, `${name} が define.ts に見つからない`).not.toBeNull();
  return match![1];
}

describe('明示プロパティ形の拒否語が正本とずれていないこと', () => {
  const define = readFileSync(join(STATE_SRC, 'define.ts'), 'utf8');
  const parser = readFileSync(join(STATE_SRC, 'bindTextParser', 'parseBindTextsForElement.ts'), 'utf8');

  it('正本の EXPLICIT_PROPERTY_REJECTED_HEADS と同じ語の集合であること', () => {
    // 正本は定数名の列挙なので、定数名 → 値を define.ts から引いて実値の集合にする
    const body = /const EXPLICIT_PROPERTY_REJECTED_HEADS = new Set<string>\(\[([\s\S]*?)\]\)/.exec(parser);
    expect(body, '正本の宣言が見つからない（形が変わった？）').not.toBeNull();
    const constNames = body![1]
      .split(',')
      .map(s => s.replace(/\/\/[^\n]*/g, '').trim())
      .filter(s => s.length > 0);
    expect(constNames.length).toBeGreaterThan(0);
    const expected = new Set(constNames.map(n => constValue(define, n)));

    expect([...EXPLICIT_PROPERTY_REJECTED_HEADS].sort()).toEqual([...expected].sort());
  });

  it('5 語は manifest 由来・6 語目の `state` だけが手書きであること（導出の範囲を固定）', () => {
    const fromManifest = Object.values(getWcsManifest().syntax.bindingTypes.propNamespaces);
    for (const word of fromManifest) {
      expect(EXPLICIT_PROPERTY_REJECTED_HEADS.has(word), word).toBe(true);
    }
    expect(EXPLICIT_PROPERTY_REJECTED_HEADS.has('state')).toBe(true);
    expect(EXPLICIT_PROPERTY_REJECTED_HEADS.size).toBe(fromManifest.length + 1);
    // `state` は manifest に無い（あるなら導出へ切り替えるべき合図）
    expect(fromManifest).not.toContain('state');
  });
});
