/**
 * cliGlob.test.ts — CLI が自分で展開するファイルのパターン（core/cli/glob.ts、継ぎ目アプリ community-hall の L5）。
 * cmd.exe と PowerShell（npm が Windows で scripts を走らせるシェル）はパターンを展開せずに渡すので、4.19 までは
 * npm script の `wcs-validate templates/*.html` が `cannot read templates/*.html: ENOENT` で失敗していた。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandGlob, hasGlobMagic, type GlobFs } from '../src/core/cli/glob';
import { expandFileArgs } from '../src/cli';

describe('CLI がパターンを展開する（core/cli/glob.ts）', () => {
  // ディレクトリの表（名前の末尾の / はディレクトリ）
  const fsOf = (tree: Record<string, string[]>): GlobFs => ({
    readDir: (path) => tree[path]?.map((name) => ({ name: name.replace(/\/$/, ''), dir: name.endsWith('/') })),
  });
  const FS = fsOf({
    '.': ['index.html', 'about.html', '.hidden.html', 'notes.txt', 'templates/', 'node_modules/', '.git/'],
    templates: ['a.html', 'b.html', 'c.htm', 'partials/'],
    'templates/partials': ['x.html', 'y.html'],
    node_modules: ['pkg/'],
    'node_modules/pkg': ['readme.html'],
    '.git': ['config.html'],
    '/abs': ['z.html'],
  });

  it('*・?・[…]・{a,b} を 1 段の中で当て、. で始まる名前は当てない', () => {
    expect(expandGlob('*.html', FS)).toEqual(['about.html', 'index.html']);
    expect(expandGlob('templates/?.html', FS)).toEqual(['templates/a.html', 'templates/b.html']);
    expect(expandGlob('templates/[ab].htm*', FS)).toEqual(['templates/a.html', 'templates/b.html']);
    expect(expandGlob('templates/[!a].html', FS)).toEqual(['templates/b.html']);
    expect(expandGlob('templates/*.{html,htm}', FS)).toEqual(['templates/a.html', 'templates/b.html', 'templates/c.htm']);
    expect(expandGlob('{index,missing}.html', FS)).toEqual(['index.html']);
    expect(expandGlob('.*.html', FS)).toEqual(['.hidden.html']);
    expect(expandGlob('/abs/*.html', FS)).toEqual(['/abs/z.html']);
  });

  it('** は 0 段以上のディレクトリ（node_modules と . で始まるディレクトリには入らない）', () => {
    expect(expandGlob('**/*.html', FS)).toEqual([
      'about.html', 'index.html', 'templates/a.html', 'templates/b.html', 'templates/partials/x.html', 'templates/partials/y.html',
    ]);
    expect(expandGlob('templates/**/x.html', FS)).toEqual(['templates/partials/x.html']);
    expect(expandGlob('templates/**', FS)).toEqual([
      'templates/a.html', 'templates/b.html', 'templates/c.htm', 'templates/partials/x.html', 'templates/partials/y.html',
    ]);
    // 明示した node_modules は辿る
    expect(expandGlob('node_modules/*/*.html', FS)).toEqual(['node_modules/pkg/readme.html']);
    expect(expandGlob('missing/*.html', FS)).toEqual([]);
  });

  it('hasGlobMagic はパターンの文字だけを見る', () => {
    expect(['a.html', 'templates/a.html', 'C:\\x\\a.html'].map(hasGlobMagic)).toEqual([false, false, false]);
    expect(['*.html', 'a?.html', '[ab].html', '{a,b}.html'].map(hasGlobMagic)).toEqual([true, true, true, true]);
  });

  it('expandFileArgs: 在るファイルはそのまま・パターンは展開・同じファイルは 1 回・当たらないパターンは unmatched', () => {
    const exists = (path: string): boolean => path === '[draft].html';
    expect(expandFileArgs(['index.html', '[draft].html', '*.html', 'index.html'], FS, exists, false))
      .toEqual({ files: ['index.html', '[draft].html', 'about.html'] });
    expect(expandFileArgs(['*.html', 'nothing/*.html', 'index.html'], FS, exists, false))
      .toEqual({ files: ['about.html', 'index.html'], unmatched: 'nothing/*.html' });
    // Windows では \ も区切り
    expect(expandFileArgs(['templates\\*.html'], FS, exists, true)).toEqual({ files: ['templates/a.html', 'templates/b.html'] });
  });

  describe('node の fs で（一時ディレクトリ）', () => {
    let dir: string | undefined;
    afterEach(() => {
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    });

    it('絶対パスのパターンを展開し、在るファイルを名指す引数はそのまま', () => {
      dir = mkdtempSync(join(tmpdir(), 'wcs-glob-'));
      mkdirSync(join(dir, 'templates', 'partials'), { recursive: true });
      mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
      for (const file of ['templates/a.html', 'templates/partials/b.html', 'node_modules/x/c.html', 'templates/[x].html']) {
        writeFileSync(join(dir, file), '<p></p>');
      }
      const root = dir.replace(/\\/g, '/');
      expect(expandFileArgs([`${root}/**/*.html`], undefined, undefined, true).files)
        .toEqual([`${root}/templates/[x].html`, `${root}/templates/a.html`, `${root}/templates/partials/b.html`]);
      const literal = join(dir, 'templates', '[x].html');
      expect(expandFileArgs([literal]).files).toEqual([literal]);
    });
  });
});
