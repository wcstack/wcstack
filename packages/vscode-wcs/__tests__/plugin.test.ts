import { describe, it, expect } from 'vitest';
import { wrapWithDefineState, stripWcsImport } from '../src/language/plugin';
import { WCS_PREAMBLE, WCS_PREAMBLE_LENGTH } from '../src/language/preamble';
import type { WcsScriptBlock } from '../src/language/htmlParse';

function makeBlock(content: string, contentStart = 0): WcsScriptBlock {
  return {
    content,
    contentStart,
    contentEnd: contentStart + content.length,
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

  it('改行数と文字数を維持する（import 以降のオフセットが動かない）', () => {
    const code = `import {\n  defineState\n} from '@wcstack/state';\nexport default defineState({});`;
    const result = stripWcsImport(code);
    const originalLines = code.split('\n').length;
    const resultLines = result.split('\n').length;
    expect(resultLines).toBe(originalLines);
    expect(result.length).toBe(code.length);
    expect(result.indexOf('export default')).toBe(code.indexOf('export default'));
  });

  it('CDN の URL import（esm.run / jsDelivr、@version・/path・?query 付き）も除去し、他パッケージの URL は残す', () => {
    const cases = [
      `import { defineState } from "https://esm.run/@wcstack/state";\n`,
      `import { defineState } from 'https://esm.run/@wcstack/state@1.32.0';\n`,
      `import { defineState } from "https://cdn.jsdelivr.net/npm/@wcstack/state@1.32.0/+esm";\n`,
      `import { defineState } from "https://cdn.jsdelivr.net/npm/@wcstack/state/dist/index.esm.js?module";\n`,
    ];
    for (const line of cases) {
      const code = `${line}export default defineState({ count: 0 });`;
      const result = stripWcsImport(code);
      expect(result, line).not.toContain('import');
      expect(result.split('\n').length).toBe(code.split('\n').length);
    }
    const other = `import { bootstrapFetch } from "https://esm.run/@wcstack/fetch";\nexport default {};`;
    expect(stripWcsImport(other)).toContain('@wcstack/fetch');
    const local = `import { defineState } from "./state-helpers.js";\nexport default {};`;
    expect(stripWcsImport(local)).toContain('./state-helpers.js');
  });
});

describe('buildCombinedScript — tsc モードの 1 ファイル 1 サービススクリプト合成', () => {
  const html = `<wcs-state><script type="module">
import { defineState } from "https://esm.run/@wcstack/state";
import { debounce } from "https://esm.run/lodash-es";
export default defineState({
  count: 0,
  inc() { this.count++; debounce(() => {}, 1); },
});
</script></wcs-state>
<wcs-state name="other"><script type="module">
const initial = 1;
export default { items: [] as string[], initial };
</script></wcs-state>`;

  it('プリアンブル 1 回・import は巻き上げ・各ブロックはスコープ内の const、export default は残らない', async () => {
    const { parseWcsScriptBlocks } = await import('../src/language/htmlParse');
    const { buildCombinedScript } = await import('../src/language/plugin');
    const blocks = parseWcsScriptBlocks(html, 'wcs-state');
    expect(blocks).toHaveLength(2);
    const { code, mappings } = buildCombinedScript(blocks);
    expect(code.startsWith(WCS_PREAMBLE)).toBe(true);
    expect(code.split(WCS_PREAMBLE).length).toBe(2);
    const userPart = code.slice(WCS_PREAMBLE.length);
    expect(userPart).not.toContain('export default');
    expect(userPart).not.toContain('@wcstack/state');
    expect(code).toContain('import { debounce } from "https://esm.run/lodash-es";');
    expect(code.indexOf('import { debounce }')).toBeLessThan(code.indexOf('const __wcs_state_0'));
    expect(code).toContain('const __wcs_state_0 = defineState({');
    expect(code).toContain('const __wcs_state_1 = defineState({ items: [] as string[], initial })');
    expect(code).toContain('void __wcs_state_0;');
    expect(code).toContain('void __wcs_state_1;');

    // mapping: 合成コード内のトークン位置が HTML 内の同じトークンに戻る
    const back = (generated: number): number => {
      for (const m of mappings) {
        for (let i = 0; i < m.generatedOffsets.length; i++) {
          const g = m.generatedOffsets[i];
          if (generated >= g && generated < g + m.lengths[i]) return m.sourceOffsets[i] + (generated - g);
        }
      }
      throw new Error(`no mapping for generated offset ${generated}`);
    };
    for (const token of ['this.count++', 'items: [] as string[]', 'const initial = 1', 'from "https://esm.run/lodash-es"']) {
      const g = code.indexOf(token);
      expect(g, token).toBeGreaterThan(-1);
      expect(html.slice(back(g), back(g) + token.length)).toBe(token);
    }
    // 巻き上げた import の元位置は空白になり、ブロック内のオフセットは保たれる
    const bodyStart = code.indexOf('const __wcs_state_0');
    expect(code.slice(bodyStart).indexOf('import ')).toBe(-1);
  });

  it('tsc モードの plugin は getServiceScript で合成スクリプトを返し、getExtraServiceScripts は空', async () => {
    const { createWcsLanguagePlugin, COMBINED_SCRIPT_ID } = await import('../src/language/plugin');
    const plugin = createWcsLanguagePlugin('wcs-state', { mode: 'tsc' });
    const snapshot = { getText: (s: number, e: number) => html.slice(s, e), getLength: () => html.length, getChangeRange: () => undefined };
    const root = plugin.createVirtualCode!('/proj/index.html', 'html', snapshot, {} as any)!;
    expect(root.embeddedCodes?.map((c) => c.id)).toEqual([COMBINED_SCRIPT_ID]);
    const service = plugin.typescript!.getServiceScript(root);
    expect(service?.extension).toBe('.ts');
    expect(service?.code.id).toBe(COMBINED_SCRIPT_ID);
    // 定義するだけで proxyCreateProgram が警告を出すので、tsc モードでは持たない
    expect(plugin.typescript!.getExtraServiceScripts).toBeUndefined();
    // <wcs-state> の無いページ: tsc モードは空のサービススクリプト（undefined だと HTML が
    // 素の TS として読まれ構文エラーになる）、Language Server モードは undefined のまま
    const plain = `<!doctype html><html><body><p>{{ hello }}</p></body></html>`;
    const plainSnapshot = { getText: (s: number, e: number) => plain.slice(s, e), getLength: () => plain.length, getChangeRange: () => undefined };
    const plainRoot = plugin.createVirtualCode!('/proj/plain.html', 'html', plainSnapshot, {} as any)!;
    const plainService = plugin.typescript!.getServiceScript(plainRoot)!;
    expect(plainService.code.snapshot.getText(0, plainService.code.snapshot.getLength())).toBe('');
    expect(createWcsLanguagePlugin().createVirtualCode!('/proj/plain.html', 'html', plainSnapshot, {} as any)).toBeUndefined();

    // 既定（language-server）モードは従来どおり
    const ls = createWcsLanguagePlugin();
    const lsRoot = ls.createVirtualCode!('/proj/index.html', 'html', snapshot, {} as any)!;
    expect(ls.typescript!.getServiceScript(lsRoot)).toBeUndefined();
    expect(ls.typescript!.getExtraServiceScripts!('/proj/index.html', lsRoot)).toHaveLength(2);
  });
});

describe('createWcsLanguagePlugin — 識別子は URI でも string でもよい（runTsc 経路）', () => {
  it('string のファイルパスで getLanguageId が html を返し、仮想コードを生成する', async () => {
    const { createWcsLanguagePlugin } = await import('../src/language/plugin');
    const plugin = createWcsLanguagePlugin();
    expect(plugin.getLanguageId('/proj/index.html')).toBe('html');
    expect(plugin.getLanguageId('/proj/index.htm')).toBe('html');
    expect(plugin.getLanguageId('/proj/app.ts')).toBeUndefined();
    const html = `<wcs-state><script type="module">export default { count: 0 };</script></wcs-state>`;
    const snapshot = { getText: (s: number, e: number) => html.slice(s, e), getLength: () => html.length, getChangeRange: () => undefined };
    const code = plugin.createVirtualCode!('/proj/index.html', 'html', snapshot, {} as any);
    expect(code?.embeddedCodes?.[0]?.id).toBe('wcs-script-0');
    expect(plugin.createVirtualCode!('/proj/app.ts', 'typescript', snapshot, {} as any)).toBeUndefined();
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
