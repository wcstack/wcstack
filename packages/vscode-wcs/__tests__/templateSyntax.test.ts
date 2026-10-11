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

  it('script の本体の "<script" という文字列で範囲を数え違えない', () => {
    const html = '<script>const t = "<script>";</script><p>{{ count }}</p>';
    expect(findAllMustacheSyntax(html).map(m => m.expression)).toEqual(['count']);
  });

  it('複数行の式も 1 つの束縛として拾う（4.0 はテキストノードの {{([\\s\\S]+?)}} で読む）', () => {
    const html = '<p>{{\n  count\n  |toFixed(1)\n}}</p>';
    const matches = findAllMustacheSyntax(html);
    expect(matches).toHaveLength(1);
    expect(matches[0].expression).toBe('count\n  |toFixed(1)');
    expect(html.slice(matches[0].exprStart, matches[0].exprEnd)).toBe(matches[0].expression);
  });

  it('タグをまたいで閉じの }} を探さない（テキストノードの外へ出ない）', () => {
    const html = '<p>{{ a </p><p> b }}</p>';
    expect(findAllMustacheSyntax(html)).toHaveLength(0);
  });

  it('<textarea> / <title> の中の {{ }} は拾う（テキストノードなので 4.0 も束ねる）', () => {
    const html = '<title>{{ title }}</title><textarea>{{ body }}</textarea>';
    expect(findAllMustacheSyntax(html).map(m => m.expression)).toEqual(['title', 'body']);
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

  it('4.0 は接頭辞を変える設定（commentTextPrefix）を持たない — @@ と wcs-text 以外の語は束縛ではない', () => {
    // ランタイム（dom/plan.ts の COMMENT_BINDING）は `@@` の後に `wcs-text` だけを許す（ルーターの `@@route:` などと分ける）
    expect(findAllCommentBindings('<!--@@my-text: count-->')).toHaveLength(0);
    expect(findAllCommentBindings('<!--@@route: /a-->')).toHaveLength(0);
  });

  it('複数行の式も 1 つの束縛として拾い、式の位置は捕捉の位置を指す', () => {
    const html = '<p><!--@@:\n  items\n  |join(", ")\n--></p>';
    const matches = findAllCommentBindings(html);
    expect(matches).toHaveLength(1);
    expect(matches[0].expression).toBe('items\n  |join(", ")');
    expect(html.slice(matches[0].exprStart, matches[0].exprEnd)).toBe(matches[0].expression);
  });

  it('コメントの終わりをまたがない（空の <!--@@:--> が後ろのコメントまで呑まない）', () => {
    const html = '<!--@@:--><p>x</p><!-- note -->';
    expect(findAllCommentBindings(html)).toHaveLength(0);
  });

  it('式が接頭辞と同じ文字列でも、式の位置は区切りの後ろを指す', () => {
    const html = '<!--@@wcs-text: wcs-text-->';
    const [match] = findAllCommentBindings(html);
    expect(match.expression).toBe('wcs-text');
    expect(match.exprStart).toBe(html.lastIndexOf('wcs-text'));
  });

  it('<textarea> / <title> / <script> / <style> の中は拾わない（ランタイムが束ねない・ブラウザは文字にする）', () => {
    const html = '<title><!--@@: a--></title><textarea><!--@@: b--></textarea>'
      + '<script>"<!--@@: c-->"</script><style>/*<!--@@: d-->*/</style><p><!--@@: e--></p>';
    expect(findAllCommentBindings(html).map(m => m.expression)).toEqual(['e']);
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

describe('insideTemplate の入れ子判定', () => {
  const NESTED = `<template data-wcs="for: regions">
  <template data-wcs="for: regions.*.states">
    <span>{{ .name }}</span>
  </template>
  <b>{{ . }}</b>
</template>
<p>{{ total }}</p>`;

  it('内側の </template> の後でも外側 <template> 内なら true', () => {
    const matches = findAllMustacheSyntax(NESTED);
    expect(matches.find(m => m.expression === '.')!.insideTemplate).toBe(true);
  });

  it('外側の </template> の後は false', () => {
    const matches = findAllMustacheSyntax(NESTED);
    expect(matches.find(m => m.expression === 'total')!.insideTemplate).toBe(false);
  });

  it('コメントバインディングでも入れ子を追跡する', () => {
    const html = `<template data-wcs="for: regions">
  <template data-wcs="for: regions.*.states"><!--@@: .name--></template>
  <!--@@: .population-->
</template>
<!--@@: total-->`;
    const matches = findAllCommentBindings(html);
    expect(matches.find(m => m.expression === '.population')!.insideTemplate).toBe(true);
    expect(matches.find(m => m.expression === 'total')!.insideTemplate).toBe(false);
  });
});
