import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizePathname, normalizeBasename, getExtPattern } from '../src/normalizePathname';
import { setConfig } from '../src/config';
import './setup';

describe('normalizePathname', () => {
  // basenameFileExtensions のデフォルトは [".html"]。
  // 各テストで切り替える可能性があるため、毎回戻す。
  beforeEach(() => {
    setConfig({ basenameFileExtensions: ['.html'] });
  });
  afterEach(() => {
    setConfig({ basenameFileExtensions: ['.html'] });
  });

  describe('normalizePathname', () => {
    it('空文字列はルート "/" を返すこと', () => {
      expect(normalizePathname('')).toBe('/');
    });

    it('先頭スラッシュがない場合は補うこと', () => {
      expect(normalizePathname('about')).toBe('/about');
    });

    it('連続スラッシュを単一化すること', () => {
      expect(normalizePathname('//a//b///c')).toBe('/a/b/c');
    });

    it('末尾スラッシュ（ルート以外）を除去すること', () => {
      expect(normalizePathname('/about/')).toBe('/about');
    });

    it('ルート "/" はそのまま返すこと', () => {
      expect(normalizePathname('/')).toBe('/');
    });

    it('ネストパスを正しく扱うこと', () => {
      expect(normalizePathname('/users/123/edit')).toBe('/users/123/edit');
    });

    it('末尾の .html を除去してディレクトリルートとして扱うこと', () => {
      // /about.html -> "" (regex 削除) -> "/" (空文字列はルート扱い)
      expect(normalizePathname('/about.html')).toBe('/');
    });

    it('深いパスの末尾の .html を除去すること', () => {
      expect(normalizePathname('/users/profile.html')).toBe('/users');
    });

    it('.html 大文字小文字を区別しないこと', () => {
      expect(normalizePathname('/about.HTML')).toBe('/');
    });

    it('basenameFileExtensions を空にした場合は拡張子を保持すること', () => {
      setConfig({ basenameFileExtensions: [] });
      expect(normalizePathname('/about.html')).toBe('/about.html');
    });

    it('basenameFileExtensions を複数指定した場合に全て削除されること', () => {
      setConfig({ basenameFileExtensions: ['.html', '.htm'] });
      expect(normalizePathname('/page.htm')).toBe('/');
      expect(normalizePathname('/page.html')).toBe('/');
    });

    it('連続スラッシュ + 末尾拡張子の複合パターンを正しく扱うこと', () => {
      expect(normalizePathname('//about//page.html')).toBe('/about');
    });
  });

  describe('normalizeBasename', () => {
    it('空文字列は空文字列を返すこと', () => {
      expect(normalizeBasename('')).toBe('');
    });

    it('"/" のみは空文字列を返すこと', () => {
      expect(normalizeBasename('/')).toBe('');
    });

    it('先頭スラッシュがない場合は補うこと', () => {
      expect(normalizeBasename('app')).toBe('/app');
    });

    it('末尾スラッシュを除去すること', () => {
      expect(normalizeBasename('/app/')).toBe('/app');
    });

    it('連続スラッシュを単一化すること', () => {
      expect(normalizeBasename('//app//sub//')).toBe('/app/sub');
    });

    it('末尾の .html を除去すること', () => {
      expect(normalizeBasename('/app/index.html')).toBe('/app');
    });

    it('basenameFileExtensions が空の場合は拡張子を保持すること', () => {
      setConfig({ basenameFileExtensions: [] });
      expect(normalizeBasename('/app/index.html')).toBe('/app/index.html');
    });
  });

  describe('getExtPattern', () => {
    it('basenameFileExtensions が空の場合は null を返すこと', () => {
      setConfig({ basenameFileExtensions: [] });
      expect(getExtPattern()).toBeNull();
    });

    it('非空の場合は RegExp を返すこと', () => {
      setConfig({ basenameFileExtensions: ['.html'] });
      const pattern = getExtPattern();
      expect(pattern).toBeInstanceOf(RegExp);
      expect(pattern?.test('/page.html')).toBe(true);
    });

    it('同じ config なら同一インスタンスを返すこと（キャッシュ）', () => {
      setConfig({ basenameFileExtensions: ['.html'] });
      const first = getExtPattern();
      const second = getExtPattern();
      expect(first).toBe(second);
    });

    it('config 変更後は別インスタンスが生成されること', () => {
      setConfig({ basenameFileExtensions: ['.html'] });
      const first = getExtPattern();
      setConfig({ basenameFileExtensions: ['.htm'] });
      const second = getExtPattern();
      expect(first).not.toBe(second);
      // 新しいパターンは .htm にマッチする
      expect(second?.test('/page.htm')).toBe(true);
    });

    it('複数拡張子を OR で結合した pattern を生成すること', () => {
      setConfig({ basenameFileExtensions: ['.html', '.htm'] });
      const pattern = getExtPattern();
      expect(pattern?.test('/page.html')).toBe(true);
      expect(pattern?.test('/page.htm')).toBe(true);
      expect(pattern?.test('/page.txt')).toBe(false);
    });

    it('正規表現メタ文字を含む拡張子もエスケープされること', () => {
      // ピリオドが正規表現メタ文字なのでエスケープされ、任意 1 文字にマッチしない
      setConfig({ basenameFileExtensions: ['.html'] });
      const pattern = getExtPattern();
      // ".html" は "/aXhtml" のようなパスにマッチしてはいけない
      expect(pattern?.test('/aXhtml')).toBe(false);
    });
  });
});
