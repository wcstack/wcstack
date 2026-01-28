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
});
