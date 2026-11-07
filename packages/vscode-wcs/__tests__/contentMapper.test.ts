import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it, expect } from 'vitest';
import { CODE_INVALID_OPTION, CODE_UNKNOWN_OPTION, DEFAULT_MAPPER_OPTIONS, parseMapperOptions } from '../src/contentMapper/options';
import type { MappedOutput, TransformResult } from '../src/contentMapper/protocol';
import { createFrameReader, frame, MapperSession, startStdioMapper, type RpcResponse } from '../src/contentMapper/server';
import { exactSegments, transformHtml, urlSpecifiers, utf8Offsets, VIRTUAL_EXTENSION } from '../src/contentMapper/transform';
import { WCS_PREAMBLE, WCS_PREAMBLE_LENGTH } from '../src/language/preamble';

const PAGE = `<!doctype html>
<p>前置き 🎉</p>
<wcs-state><script type="module">
import { defineState } from "https://esm.run/@wcstack/state";
import confetti from "https://esm.run/canvas-confetti";
import "https://esm.run/side-effect";
export default defineState({
  count: 0,
  // コメント 🎉
  get first() { return this.items[0]; },
  items: [1],
  async load() { const m = await import("https://esm.run/lazy"); await fetch("https://example.com/api"); return m; },
});
</script></wcs-state>
<wcs-state><script type="module">
export default { name: "あ", rename() { this.nmae = "い"; } };
</script></wcs-state>
<my-state><script type="module">export default { other: 1 };</script></my-state>`;

const utf16 = { ...DEFAULT_MAPPER_OPTIONS, encoding: 'utf-16' as const, strictMappings: true };

/** 範囲がどれも両側で同じテキストを指すこと（TypeScript の `Verbatim` の検査と同じ）。 */
function expectVerbatim(output: MappedOutput, content: string, encoding: 'utf-8' | 'utf-16'): void {
  for (const [vs, vl, os, ol, kind] of output.mappings) {
    expect(kind).toBe(0);
    expect(vl).toBe(ol);
    if (encoding === 'utf-16') expect(output.text.slice(vs, vs + vl)).toBe(content.slice(os, os + ol));
    else expect(Buffer.from(output.text, 'utf8').subarray(vs, vs + vl).equals(Buffer.from(content, 'utf8').subarray(os, os + ol))).toBe(true);
  }
  // 仮想側は昇順・重なり無し
  for (let i = 1; i < output.mappings.length; i++) {
    expect(output.mappings[i][0]).toBeGreaterThanOrEqual(output.mappings[i - 1][0] + output.mappings[i - 1][1]);
  }
}

const directives = (output: MappedOutput): number[][] => (output.diagnosticDirectives?.directives ?? []).map((d) => [...d]);

describe('transformHtml — content mapper の出力', () => {
  it('<wcs-state> の無いページは空の正規の出力だけ', () => {
    const result = transformHtml('/p/plain.html', '<p>{{ hello }}</p>', utf16);
    expect(result).toEqual({ text: '', extension: '.mts', mappings: [] });
  });

  it('ブロックごとに .mts の supplemental 1 つ。プリアンブル + ユーザーコードで、範囲は元のテキストと一致する', () => {
    const result = transformHtml('/p/index.html', PAGE, utf16);
    expect(result.text).toBe('');
    expect(result.extension).toBe(VIRTUAL_EXTENSION);
    expect(result.supplemental).toHaveLength(2);
    for (const output of result.supplemental!) {
      expect(output.extension).toBe('.mts');
      expect(output.text.startsWith(WCS_PREAMBLE)).toBe(true);
      // 合成の export は足さない（.mts はいつもモジュール）
      expect(output.text.trimEnd().endsWith('export {};')).toBe(false);
      expectVerbatim(output, PAGE, 'utf-16');
    }
    expect(result.supplemental![0].text).toContain('export default defineState({');
    expect(result.supplemental![1].text).toContain('export default defineState({ name: "あ"');
    // 空白にした @wcstack/state の import はどの範囲にも入らない
    const importAt = PAGE.indexOf('import { defineState }');
    expect(result.supplemental![0].mappings.some(([, , os, ol]) => os <= importAt && importAt < os + ol)).toBe(false);
  });

  it('プリアンブルの仮想範囲に ignore の directive、urlImports: "any" なら URL の module specifier にも', () => {
    const [first, second] = transformHtml('/p/index.html', PAGE, utf16).supplemental!;
    const ds = directives(first);
    expect(ds[0].slice(2)).toEqual([0, WCS_PREAMBLE_LENGTH, 0]);
    const literals = ds.slice(1).map(([os, ol, vs, ve, policy]) => {
      expect(policy).toBe(0);
      expect(first.text.slice(vs, ve)).toBe(PAGE.slice(os, os + ol));
      return first.text.slice(vs, ve);
    });
    expect(literals).toEqual(['"https://esm.run/canvas-confetti"', '"https://esm.run/side-effect"', '"https://esm.run/lazy"']);
    // module specifier でない URL（fetch）は覆わない
    expect(literals.join()).not.toContain('example.com');
    // 仮想範囲は重ならない
    for (let i = 1; i < ds.length; i++) expect(ds[i][2]).toBeGreaterThanOrEqual(ds[i - 1][3]);
    expect(directives(second)).toHaveLength(1);
  });

  it('urlImports: "error" ならプリアンブルの directive だけ', () => {
    const [first] = transformHtml('/p/index.html', PAGE, { ...utf16, urlImports: 'error' }).supplemental!;
    expect(directives(first)).toHaveLength(1);
  });

  it('stateTagName のブロックだけを読む', () => {
    const result = transformHtml('/p/index.html', PAGE, { ...utf16, stateTagName: 'my-state' });
    expect(result.supplemental).toHaveLength(1);
    expect(result.supplemental![0].text).toContain('other: 1');
  });

  it('utf-8 では両側をバイトのオフセットにする（非 ASCII の前置き・コメント・サロゲートペア）', () => {
    const result = transformHtml('/p/index.html', PAGE, { ...utf16, encoding: 'utf-8' });
    for (const output of result.supplemental!) {
      expectVerbatim(output, PAGE, 'utf-8');
      // URL の specifier の directive は両側が同じリテラル（プリアンブルの directive の元の範囲は長さ 0）
      for (const [os, ol, vs, ve] of directives(output).filter(([, ol]) => ol > 0)) {
        expect(Buffer.from(output.text, 'utf8').subarray(vs, ve).toString('utf8')).toBe(Buffer.from(PAGE, 'utf8').subarray(os, os + ol).toString('utf8'));
      }
    }
    // プリアンブルは日本語のコメントを持つので、utf-8 の終端は文字数より大きい
    expect(directives(result.supplemental![0])[0][3]).toBe(Buffer.byteLength(WCS_PREAMBLE, 'utf8'));
  });

  it('リポジトリの examples の全ページで、範囲を分けずに済む（プラグインの mapping がどれも元のテキストと一致する）', () => {
    const repoRoot = join(__dirname, '..', '..', '..');
    const roots = [join(repoRoot, 'examples')];
    for (const pkg of readdirSync(join(repoRoot, 'packages'))) {
      const dir = join(repoRoot, 'packages', pkg, 'examples');
      try {
        if (statSync(dir).isDirectory()) roots.push(dir);
      } catch {
        // examples を持たないパッケージ
      }
    }
    const pages: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.html')) pages.push(full);
      }
    };
    for (const root of roots) walk(root);
    let blocks = 0;
    for (const page of pages) {
      const content = readFileSync(page, 'utf8');
      for (const encoding of ['utf-16', 'utf-8'] as const) {
        const result: TransformResult = transformHtml(page, content, { ...utf16, encoding });
        for (const output of result.supplemental ?? []) {
          expectVerbatim(output, content, encoding);
          if (encoding === 'utf-16') blocks++;
        }
      }
    }
    expect(pages.length).toBeGreaterThan(30);
    expect(blocks).toBeGreaterThan(20);
  });
});

describe('exactSegments — 安全網', () => {
  it('一致しない mapping は一致する区間に分け、サロゲートペアの途中では分けない', () => {
    const original = 'ab🎉cd';
    const generated = 'aX🎉cY';
    const mapping = { sourceOffsets: [0], generatedOffsets: [0], lengths: [original.length], data: {} };
    expect(exactSegments([mapping], generated, original, false)).toEqual([[0, 1, 0, 1], [2, 5, 2, 5]]);
    expect(() => exactSegments([mapping], generated, original, true)).toThrow(/does not match/);
  });

  it('長さ 0 の mapping は捨てる', () => {
    expect(exactSegments([{ sourceOffsets: [0], generatedOffsets: [0], lengths: [0], data: {} }], 'a', 'a', true)).toEqual([]);
  });
});

describe('urlSpecifiers / utf8Offsets', () => {
  it('from・import・import() の URL の文字列リテラルだけを拾う', () => {
    const code = [
      `import a from "https://x/a";`,
      `export * from 'http://x/b';`,
      `export { c } from"https://x/c";`,
      `import 'https://x/d';`,
      `await import ( "https://x/e" );`,
      `fetch("https://x/f"); Array.from("https://x/g"); obj.import("https://x/h");`,
      `const from = "https://x/i"; import x from "./local.js";`,
    ].join('\n');
    expect(urlSpecifiers(code).map(([s, e]) => code.slice(s, e))).toEqual([
      '"https://x/a"', "'http://x/b'", '"https://x/c"', "'https://x/d'", '"https://x/e"',
    ]);
    expect(urlSpecifiers(code, code.indexOf('export *')).length).toBe(4);
  });

  it('UTF-16 のオフセットを UTF-8 のバイトにする', () => {
    const at = utf8Offsets('aé😀b');
    expect([0, 1, 2, 4, 5].map(at)).toEqual([0, 1, 3, 7, 8]);
  });
});

describe('parseMapperOptions', () => {
  it('無ければ既定（wcs-state・any）', () => {
    expect(parseMapperOptions(undefined)).toEqual({ options: { stateTagName: 'wcs-state', urlImports: 'any' }, diagnostics: [] });
    expect(parseMapperOptions(null).options).toEqual(DEFAULT_MAPPER_OPTIONS);
  });

  it('正しい値を受ける', () => {
    expect(parseMapperOptions({ stateTagName: 'my-state', urlImports: 'error' })).toEqual({ options: { stateTagName: 'my-state', urlImports: 'error' }, diagnostics: [] });
  });

  it('知らないキー・値の誤りは診断にして、その項目は既定値で続ける', () => {
    const { options, diagnostics } = parseMapperOptions({ urlImport: 'any', stateTagName: 'State', urlImports: 'none' });
    expect(options).toEqual(DEFAULT_MAPPER_OPTIONS);
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      [CODE_UNKNOWN_OPTION, ['urlImport']],
      [CODE_INVALID_OPTION, ['stateTagName']],
      [CODE_INVALID_OPTION, ['urlImports']],
    ]);
    expect(parseMapperOptions({ stateTagName: 3 }).diagnostics[0].messageText).toContain('got 3');
  });

  it('オブジェクトでなければ path [] の診断', () => {
    for (const raw of ['x', [], 1]) {
      const { options, diagnostics } = parseMapperOptions(raw);
      expect(options).toEqual(DEFAULT_MAPPER_OPTIONS);
      expect(diagnostics).toEqual([{ path: [], code: CODE_INVALID_OPTION, messageText: expect.any(String) }]);
    }
  });
});

describe('MapperSession — JSON-RPC の受け答え', () => {
  const request = (session: MapperSession, id: number, method: string, params?: unknown): RpcResponse =>
    session.handle({ jsonrpc: '2.0', id, method, params })!;
  const opened = (options?: unknown): MapperSession => {
    const session = new MapperSession();
    request(session, 1, 'initialize', { positionEncodings: ['utf-8', 'utf-16'] });
    request(session, 2, 'openProject', { configFileName: '/p/tsconfig.json', projectHandle: 'h1', options, compilerOptions: {} });
    return session;
  };

  it('initialize は utf-16 を選び、無ければ utf-8、どちらも無ければエラー', () => {
    expect(request(new MapperSession(), 1, 'initialize', { positionEncodings: ['utf-8', 'utf-16'] }).result).toEqual({ positionEncoding: 'utf-16', diagnosticSource: 'wcs' });
    expect(request(new MapperSession(), 1, 'initialize', { positionEncodings: ['utf-8'], locale: 'ja' }).result).toEqual({ positionEncoding: 'utf-8', diagnosticSource: 'wcs' });
    expect(request(new MapperSession(), 1, 'initialize', { positionEncodings: ['utf-32'] }).error?.code).toBe(-32602);
    expect(request(new MapperSession(), 1, 'initialize', {}).error?.code).toBe(-32602);
  });

  it('openProject は {} か { optionDiagnostics } だけを返す（configIdentity / watchedFiles は返さない）', () => {
    const session = new MapperSession();
    request(session, 1, 'initialize', { positionEncodings: ['utf-16'] });
    expect(request(session, 2, 'openProject', { configFileName: '', projectHandle: 'a', compilerOptions: {} }).result).toEqual({});
    const withErrors = request(session, 3, 'openProject', { configFileName: '/c.json', projectHandle: 'b', options: { nope: 1 }, compilerOptions: {} }).result;
    expect(withErrors).toEqual({ optionDiagnostics: [{ path: ['nope'], code: 1001, messageText: expect.any(String) }] });
    expect(request(session, 4, 'openProject', { projectHandle: 'c' }).error?.code).toBe(-32602);
  });

  it('transform はプロジェクトのオプションで変換する。1 つのプロセスに 2 つのハンドル', () => {
    const session = opened();
    request(session, 3, 'openProject', { configFileName: '/q/tsconfig.json', projectHandle: 'h2', options: { stateTagName: 'my-state' }, compilerOptions: {} });
    const a = request(session, 4, 'transform', { fileName: '/p/index.html', content: PAGE, projectHandle: 'h1' }).result as TransformResult;
    const b = request(session, 5, 'transform', { fileName: '/p/index.html', content: PAGE, projectHandle: 'h2' }).result as TransformResult;
    expect(a.supplemental).toHaveLength(2);
    expect(b.supplemental).toHaveLength(1);
  });

  it('closeProject は null。閉じたハンドルの transform はエラーで、同じハンドルで開き直せる', () => {
    const session = opened();
    expect(request(session, 3, 'closeProject', { projectHandle: 'h1' })).toEqual({ jsonrpc: '2.0', id: 3, result: null });
    expect(request(session, 4, 'transform', { fileName: '/p/a.html', content: '', projectHandle: 'h1' }).error).toEqual({ code: -32603, message: 'Project has not been opened: h1' });
    request(session, 5, 'openProject', { configFileName: '', projectHandle: 'h1', compilerOptions: {} });
    expect(request(session, 6, 'transform', { fileName: '/p/a.html', content: '', projectHandle: 'h1' }).result).toEqual({ text: '', extension: '.mts', mappings: [] });
    expect(request(session, 7, 'closeProject', {}).error?.code).toBe(-32602);
  });

  it('初期化の前・params の誤り・知らないメソッド', () => {
    const fresh = new MapperSession();
    expect(request(fresh, 1, 'transform', { fileName: '/a.html', content: '', projectHandle: 'h' }).error?.message).toBe('The mapper has not been initialized');
    expect(request(opened(), 3, 'transform', { fileName: '/a.html' }).error?.code).toBe(-32602);
    expect(request(fresh, 2, 'shutdown').error).toEqual({ code: -32601, message: 'Method not found: shutdown' });
  });

  it('JSON の誤り・要求の形の誤り・通知', () => {
    const session = new MapperSession();
    expect(session.handleText('{')).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    expect(session.handleText('[1]')?.error?.code).toBe(-32600);
    expect(session.handle({ jsonrpc: '2.0', id: 7 })?.error).toEqual({ code: -32600, message: 'Invalid request' });
    expect(session.handle({ jsonrpc: '1.0', id: 7, method: 'initialize' })?.id).toBe(7);
    expect(session.handle({ jsonrpc: '2.0', method: 'initialize', params: { positionEncodings: ['utf-16'] } })).toBeUndefined();
  });

  it('答えの中で起きた例外は -32603 にして返す（プロセスは落とさない）', () => {
    const session = new MapperSession();
    const params = { configFileName: '', projectHandle: 'h', compilerOptions: {}, get options(): unknown { throw new Error('boom'); } };
    expect(session.handle({ jsonrpc: '2.0', id: 1, method: 'openProject', params })?.error).toEqual({ code: -32603, message: 'boom' });
    const nonError = { configFileName: '', projectHandle: 'h', compilerOptions: {}, get options(): unknown { throw 'text'; } };
    expect(session.handle({ jsonrpc: '2.0', id: 2, method: 'openProject', params: nonError })?.error?.message).toBe('text');
  });
});

describe('Content-Length の枠', () => {
  it('分かれたチャンク・1 つのチャンクに 2 つ・多バイトの本文・余分なヘッダー', () => {
    const bodies: string[] = [];
    const bad: string[] = [];
    const read = createFrameReader((body) => bodies.push(body), (header) => bad.push(header));
    const one = frame({ text: 'あ🎉' });
    read(one.subarray(0, 5));
    read(one.subarray(5, one.length - 2));
    expect(bodies).toEqual([]);
    read(Buffer.concat([one.subarray(one.length - 2), frame({ n: 2 })]));
    const typed = Buffer.from('Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: 2\r\n\r\n{}', 'ascii');
    read(Buffer.concat([Buffer.from('X-Junk: 1\r\n\r\n', 'ascii'), typed]));
    expect(bodies).toEqual(['{"text":"あ🎉"}', '{"n":2}', '{}']);
    expect(bad).toEqual(['X-Junk: 1']);
  });

  it('startStdioMapper は標準入出力で受け答えし、通知には答えない', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    startStdioMapper({ stdin, stdout, stderr });
    const responses: unknown[] = [];
    const read = createFrameReader((body) => responses.push(JSON.parse(body)), () => {});
    stdout.on('data', (chunk: Buffer) => read(chunk));
    const errors: string[] = [];
    stderr.on('data', (chunk: Buffer) => errors.push(chunk.toString()));
    stdin.write(frame({ jsonrpc: '2.0', method: 'notify' }));
    stdin.write(frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { positionEncodings: ['utf-16'] } }));
    stdin.write('Bad: header\r\n\r\n');
    stdin.write(frame({ jsonrpc: '2.0', id: 2, method: 'openProject', params: { configFileName: '', projectHandle: 'h', compilerOptions: {} } }).toString('utf8'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(responses).toEqual([
      { jsonrpc: '2.0', id: 1, result: { positionEncoding: 'utf-16', diagnosticSource: 'wcs' } },
      { jsonrpc: '2.0', id: 2, result: {} },
    ]);
    expect(errors.join('')).toContain('without Content-Length');
  });
});
