import { describe, it, expect } from 'vitest';
import { isCommentNode, getCommentNodeBindText } from '../src/bindings/isCommentNode';

const makeComment = (text: string) => document.createComment(text);

describe('isCommentNode', () => {
  it('埋め込みバインドのコメントを判定できること', () => {
    const comment = makeComment('@@wcs-text: message');
    expect(isCommentNode(comment)).toBe(true);
    expect(getCommentNodeBindText(comment)).toBe('message');
  });

  it('未知のキーワードはfalseになること', () => {
    const comment = makeComment('@@unknown: message');
    expect(isCommentNode(comment)).toBe(false);
    expect(getCommentNodeBindText(comment)).toBeNull();
  });

  it('フォーマット不正はfalseになること', () => {
    const comment = makeComment('not a binding');
    expect(isCommentNode(comment)).toBe(false);
  });

  describe('短縮形 @@:path', () => {
    it('@@:path 形式をテキストバインディングとして認識すること', () => {
      const comment = makeComment('@@:message');
      expect(isCommentNode(comment)).toBe(true);
      expect(getCommentNodeBindText(comment)).toBe('message');
    });

    it('@@:path 形式でスペースを含む場合も認識すること', () => {
      const comment = makeComment('  @@  :  message  ');
      expect(isCommentNode(comment)).toBe(true);
      expect(getCommentNodeBindText(comment)).toBe('message');
    });

    it('@@:path 形式でネストしたパスを認識すること', () => {
      const comment = makeComment('@@:user.name');
      expect(isCommentNode(comment)).toBe(true);
      expect(getCommentNodeBindText(comment)).toBe('user.name');
    });

    it('@@:path 形式でフィルター付きパスを認識すること', () => {
      const comment = makeComment('@@:count|inc(1)');
      expect(isCommentNode(comment)).toBe(true);
      expect(getCommentNodeBindText(comment)).toBe('count|inc(1)');
    });
  });

  describe('他のバインディングタイプ', () => {
    it('wcs-for を認識すること', () => {
      const comment = makeComment('@@wcs-for: items');
      expect(isCommentNode(comment)).toBe(true);
      expect(getCommentNodeBindText(comment)).toBe('items');
    });

    it('wcs-if を認識すること', () => {
      const comment = makeComment('@@wcs-if: visible');
      expect(isCommentNode(comment)).toBe(true);
      expect(getCommentNodeBindText(comment)).toBe('visible');
    });

    it('wcs-elseif を認識すること', () => {
      const comment = makeComment('@@wcs-elseif: condition');
      expect(isCommentNode(comment)).toBe(true);
      expect(getCommentNodeBindText(comment)).toBe('condition');
    });

    it('wcs-else を認識すること', () => {
      const comment = makeComment('@@wcs-else: fallback');
      expect(isCommentNode(comment)).toBe(true);
      expect(getCommentNodeBindText(comment)).toBe('fallback');
    });
  });
});
