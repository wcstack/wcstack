import { describe, it, expect } from 'vitest';
import { parseCommentNode, getCommentNodeBindText } from '../src/bindings/parseCommentNode';

const makeComment = (text: string) => document.createComment(text);

describe('parseCommentNode', () => {
  it('コメント以外のノードはnullになること', () => {
    const el = document.createElement('div');
    expect(parseCommentNode(el)).toBeNull();
    expect(getCommentNodeBindText(el)).toBeNull();
  });

  it('埋め込みバインドのコメントを判定できること', () => {
    const comment = makeComment('@@wcs-text: message');
    expect(parseCommentNode(comment)).toBe('message');
    expect(getCommentNodeBindText(comment)).toBe('message');
  });

  it('未知のキーワードはnullになること', () => {
    const comment = makeComment('@@unknown: message');
    expect(parseCommentNode(comment)).toBeNull();
    expect(getCommentNodeBindText(comment)).toBeNull();
  });

  it('フォーマット不正はnullになること', () => {
    const comment = makeComment('not a binding');
    expect(parseCommentNode(comment)).toBeNull();
  });

  describe('短縮形 @@:path', () => {
    it('@@:path 形式をテキストバインディングとして認識すること', () => {
      const comment = makeComment('@@:message');
      expect(parseCommentNode(comment)).toBe('message');
      expect(getCommentNodeBindText(comment)).toBe('message');
    });

    it('@@:path 形式でスペースを含む場合も認識すること', () => {
      const comment = makeComment('  @@  :  message  ');
      expect(parseCommentNode(comment)).toBe('message');
      expect(getCommentNodeBindText(comment)).toBe('message');
    });

    it('@@:path 形式でネストしたパスを認識すること', () => {
      const comment = makeComment('@@:user.name');
      expect(parseCommentNode(comment)).toBe('user.name');
      expect(getCommentNodeBindText(comment)).toBe('user.name');
    });

    it('@@:path 形式でフィルター付きパスを認識すること', () => {
      const comment = makeComment('@@:count|inc(1)');
      expect(parseCommentNode(comment)).toBe('count|inc(1)');
      expect(getCommentNodeBindText(comment)).toBe('count|inc(1)');
    });
  });

  describe('他のバインディングタイプ', () => {
    it('wcs-for を認識すること', () => {
      const comment = makeComment('@@wcs-for: items');
      expect(parseCommentNode(comment)).toBe('items');
      expect(getCommentNodeBindText(comment)).toBe('items');
    });

    it('wcs-if を認識すること', () => {
      const comment = makeComment('@@wcs-if: visible');
      expect(parseCommentNode(comment)).toBe('visible');
      expect(getCommentNodeBindText(comment)).toBe('visible');
    });

    it('wcs-elseif を認識すること', () => {
      const comment = makeComment('@@wcs-elseif: condition');
      expect(parseCommentNode(comment)).toBe('condition');
      expect(getCommentNodeBindText(comment)).toBe('condition');
    });

    it('wcs-else を認識すること', () => {
      const comment = makeComment('@@wcs-else: fallback');
      expect(parseCommentNode(comment)).toBe('fallback');
      expect(getCommentNodeBindText(comment)).toBe('fallback');
    });
  });
});
