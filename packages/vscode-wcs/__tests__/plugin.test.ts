import { describe, it, expect } from 'vitest';
import { wrapWithDefineState, stripWcsImport } from '../src/language/plugin';
import { WCS_PREAMBLE, WCS_PREAMBLE_LENGTH } from '../src/language/preamble';
import type { WcsScriptBlock } from '../src/language/htmlParse';

function makeBlock(content: string, contentStart = 0): WcsScriptBlock {
  return {
    content,
    contentStart,
    contentEnd: contentStart + content.length,
    stateName: 'default',
  };
}

describe('stripWcsImport', () => {
  it('@wcstack/state の import を除去する', () => {
    const code = `import { defineState } from '@wcstack/state';\nexport default defineState({ count: 0 });`;
    const result = stripWcsImport(code);
    expect(result).not.toContain('import');
    expect(result).toContain('export default defineState');
  });

  it('ダブルクォートの import を除去する', () => {
    const code = `import { defineState } from "@wcstack/state";\nexport default defineState({});`;
    const result = stripWcsImport(code);
    expect(result).not.toContain('import');
  });

  it('関係ない import は残す', () => {
    const code = `import { foo } from './foo.js';\nexport default { count: 0 };`;
    const result = stripWcsImport(code);
    expect(result).toContain("import { foo } from './foo.js'");
  });

  it('改行数を維持する', () => {
    const code = `import {\n  defineState\n} from '@wcstack/state';\nexport default defineState({});`;
    const result = stripWcsImport(code);
    const originalLines = code.split('\n').length;
    const resultLines = result.split('\n').length;
    expect(resultLines).toBe(originalLines);
  });
});

describe('wrapWithDefineState', () => {
  it('export default { ... } を defineState() でラップする', () => {
    const userCode = `export default { count: 0 };`;
    const block = makeBlock(userCode);
    const { code } = wrapWithDefineState(userCode, block);
    expect(code).toContain('defineState(');
    expect(code).toContain('export default defineState({ count: 0 })');
  });

  it('既に defineState() がある場合はラップしない', () => {
    const userCode = `export default defineState({ count: 0 });`;
    const block = makeBlock(userCode);
    const { code } = wrapWithDefineState(userCode, block);
    // ユーザーコード部分（プリアンブル以降）で defineState が1回だけ
    const userPart = code.slice(WCS_PREAMBLE_LENGTH);
    const matches = userPart.match(/defineState\(/g) || [];
    expect(matches.length).toBe(1);
  });

  it('export default がない場合はそのまま', () => {
    const userCode = `const x = 1;\nconsole.log(x);`;
    const block = makeBlock(userCode);
    const { code } = wrapWithDefineState(userCode, block);
    expect(code).toBe(WCS_PREAMBLE + userCode);
  });

  it('プリアンブルが先頭に付与される', () => {
    const userCode = `export default { count: 0 };`;
    const block = makeBlock(userCode);
    const { code } = wrapWithDefineState(userCode, block);
    expect(code.startsWith(WCS_PREAMBLE)).toBe(true);
  });

  it('マッピングの generatedOffsets がプリアンブル長以上', () => {
    const userCode = `export default { count: 0 };`;
    const block = makeBlock(userCode, 100);
    const { mappings } = wrapWithDefineState(userCode, block);
    for (const mapping of mappings) {
      for (const offset of mapping.generatedOffsets) {
        expect(offset).toBeGreaterThanOrEqual(WCS_PREAMBLE_LENGTH);
      }
    }
  });

  it('マッピングの sourceOffsets が contentStart 基準', () => {
    const userCode = `export default { count: 0 };`;
    const contentStart = 150;
    const block = makeBlock(userCode, contentStart);
    const { mappings } = wrapWithDefineState(userCode, block);
    for (const mapping of mappings) {
      for (const offset of mapping.sourceOffsets) {
        expect(offset).toBeGreaterThanOrEqual(contentStart);
      }
    }
  });

  it('複数行のオブジェクトを正しくラップする', () => {
    const userCode = `export default {\n  count: 0,\n  name: "test"\n};`;
    const block = makeBlock(userCode);
    const { code } = wrapWithDefineState(userCode, block);
    expect(code).toContain('defineState({\n  count: 0,\n  name: "test"\n})');
  });

  it('セミコロンなしの場合も動作する', () => {
    const userCode = `export default {\n  count: 0\n}`;
    const block = makeBlock(userCode);
    const { code } = wrapWithDefineState(userCode, block);
    expect(code).toContain('defineState({\n  count: 0\n})');
  });
});
