import { describe, it, expect } from 'vitest';
import {
  findAllMustacheSyntax,
  findAllCommentBindings,
  findMustacheAtOffset,
  findCommentBindingAtOffset,
} from '../src/service/templateSyntax';

describe('findAllMustacheSyntax', () => {
  it('{{ path }} を検出する', () => {
    const html = '<p>{{ count }}</p>';
    const matches = findAllMustacheSyntax(html);
    expect(matches).toHaveLength(1);
    expect(matches[0].expression).toBe('count');
    expect(matches[0].kind).toBe('mustache');
  });

  it('フィルタ付き {{ path|filter }} を検出する', () => {
    const html = '<p>{{ count|string }}</p>';
    const matches = findAllMustacheSyntax(html);
    expect(matches[0].expression).toBe('count|string');
  });

  it('複数の Mustache を検出する', () => {
    const html = '<p>{{ name }} is {{ age }} years old</p>';
    const matches = findAllMustacheSyntax(html);
    expect(matches).toHaveLength(2);
    expect(matches[0].expression).toBe('name');
    expect(matches[1].expression).toBe('age');
  });

  it('script タグ内はスキップする', () => {
    const html = '<script>const x = {{ test }};</script><p>{{ count }}</p>';
    const matches = findAllMustacheSyntax(html);
    expect(matches).toHaveLength(1);
    expect(matches[0].expression).toBe('count');
  });
});

describe('findAllCommentBindings', () => {
  it('<!--@@:path--> を検出する', () => {
    const html = '<!--@@: count-->';
    const matches = findAllCommentBindings(html);
    expect(matches).toHaveLength(1);
    expect(matches[0].expression).toBe('count');
    expect(matches[0].kind).toBe('comment');
  });

  it('<!--@@wcs-text:path--> を検出する', () => {
    const html = '<!--@@wcs-text: count-->';
    const matches = findAllCommentBindings(html);
    expect(matches).toHaveLength(1);
    expect(matches[0].expression).toBe('count');
  });

  it('フィルタ付き <!--@@:path|filter--> を検出する', () => {
    const html = '<!--@@: count|string-->';
    const matches = findAllCommentBindings(html);
    expect(matches[0].expression).toBe('count|string');
  });

  it('複数のコメントバインディングを検出する', () => {
    const html = '<!--@@: name--><!--@@: age-->';
    const matches = findAllCommentBindings(html);
    expect(matches).toHaveLength(2);
  });

  it('カスタム commentTextPrefix に対応する', () => {
    const html = '<!--@@my-text: count-->';
    const matches = findAllCommentBindings(html, 'my-text');
    expect(matches).toHaveLength(1);
    expect(matches[0].expression).toBe('count');
  });

  it('通常の HTML コメントは検出しない', () => {
    const html = '<!-- This is a comment -->';
    const matches = findAllCommentBindings(html);
    expect(matches).toHaveLength(0);
  });
});

describe('findMustacheAtOffset', () => {
  it('カーソルが Mustache 内にある場合に検出する', () => {
    const html = '<p>{{ count }}</p>';
    const result = findMustacheAtOffset(html, 8); // "count" の中
    expect(result).not.toBeNull();
    expect(result!.expression).toBe('count');
  });

  it('カーソルが Mustache 外にある場合は null', () => {
    const html = '<p>{{ count }}</p>';
    const result = findMustacheAtOffset(html, 1);
    expect(result).toBeNull();
  });
});

describe('findCommentBindingAtOffset', () => {
  it('カーソルが <!--@@:path--> 内にある場合に検出する', () => {
    const html = '<!--@@: count-->';
    const result = findCommentBindingAtOffset(html, 10);
    expect(result).not.toBeNull();
    expect(result!.expression).toBe('count');
  });

  it('カーソルが外にある場合は null', () => {
    const html = '<p>text</p><!--@@: count-->';
    const result = findCommentBindingAtOffset(html, 5);
    expect(result).toBeNull();
  });
});
