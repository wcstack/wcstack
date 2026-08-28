import { describe, it, expect } from 'vitest';
import { splitUrlTarget, effectiveSearch } from '../src/splitUrlTarget';

describe('splitUrlTarget', () => {
  it('パスのみのターゲットを分解すること', () => {
    expect(splitUrlTarget('/path')).toEqual({ pathname: '/path', search: '', hash: '' });
    expect(splitUrlTarget('path')).toEqual({ pathname: 'path', search: '', hash: '' });
  });

  it('クエリ付きターゲットを分解すること', () => {
    expect(splitUrlTarget('/path?k=v')).toEqual({ pathname: '/path', search: '?k=v', hash: '' });
    expect(splitUrlTarget('/path?a=1&b=2')).toEqual({ pathname: '/path', search: '?a=1&b=2', hash: '' });
  });

  it('ハッシュ付きターゲットを分解すること', () => {
    expect(splitUrlTarget('/path#top')).toEqual({ pathname: '/path', search: '', hash: '#top' });
  });

  it('クエリとハッシュの複合ターゲットを分解すること', () => {
    expect(splitUrlTarget('/path?k=v#top')).toEqual({ pathname: '/path', search: '?k=v', hash: '#top' });
  });

  it('ハッシュより後の ? はハッシュの一部として扱うこと（URL のセマンティクス）', () => {
    expect(splitUrlTarget('/path#top?not-search')).toEqual({
      pathname: '/path',
      search: '',
      hash: '#top?not-search',
    });
  });

  it('クエリのみターゲットは pathname 空で分解すること', () => {
    expect(splitUrlTarget('?k=v')).toEqual({ pathname: '', search: '?k=v', hash: '' });
  });

  it('`?` 単独（クエリ全消去）は search "?" として分解すること', () => {
    expect(splitUrlTarget('?')).toEqual({ pathname: '', search: '?', hash: '' });
  });

  it('ハッシュのみターゲットは pathname 空で分解すること', () => {
    expect(splitUrlTarget('#sec')).toEqual({ pathname: '', search: '', hash: '#sec' });
  });

  it('空文字列は全て空で分解すること', () => {
    expect(splitUrlTarget('')).toEqual({ pathname: '', search: '', hash: '' });
  });
});

describe('effectiveSearch', () => {
  it('`?` 単独はクエリ全消去として "" を返すこと', () => {
    expect(effectiveSearch('?')).toBe('');
  });

  it('通常のクエリはそのまま返すこと', () => {
    expect(effectiveSearch('?k=v')).toBe('?k=v');
  });

  it('空文字列はそのまま返すこと', () => {
    expect(effectiveSearch('')).toBe('');
  });
});
