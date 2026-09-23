import { describe, it, expect } from 'vitest';
import { getBindingContext } from '../src/service/bindingContext';

describe('getBindingContext', () => {
  describe('property コンテキスト', () => {
    it('空の属性値でプロパティ補完', () => {
      const ctx = getBindingContext('', 0);
      expect(ctx).toEqual({ kind: 'property', partial: '' });
    });

    it('部分入力でプロパティ補完', () => {
      const ctx = getBindingContext('text', 4);
      expect(ctx).toEqual({ kind: 'property', partial: 'text' });
    });

    it('コロンの直前でプロパティ補完', () => {
      const ctx = getBindingContext('textContent: count', 11);
      expect(ctx).toEqual({ kind: 'property', partial: 'textContent' });
    });

    it('; の後の新しいバインディングでプロパティ補完', () => {
      const ctx = getBindingContext('textContent: count; ', 20);
      expect(ctx).toEqual({ kind: 'property', partial: '' });
    });

    it('class. プレフィックスのプロパティ補完', () => {
      const ctx = getBindingContext('class.act', 9);
      expect(ctx).toEqual({ kind: 'property', partial: 'class.act' });
    });
  });

  describe('modifier コンテキスト', () => {
    it('# の後で修飾子補完', () => {
      const ctx = getBindingContext('onclick#', 8);
      expect(ctx).toEqual({ kind: 'modifier', propName: 'onclick', partial: '' });
    });

    it('部分入力の修飾子', () => {
      const ctx = getBindingContext('onclick#pre', 11);
      expect(ctx).toEqual({ kind: 'modifier', propName: 'onclick', partial: 'pre' });
    });
  });

  describe('path コンテキスト', () => {
    it('コロンの直後でパス補完', () => {
      const ctx = getBindingContext('textContent: ', 13);
      expect(ctx).toEqual({ kind: 'path', propName: 'textContent', partial: ''});
    });

    it('パスの途中でパス補完', () => {
      const ctx = getBindingContext('textContent: users.', 19);
      expect(ctx).toEqual({ kind: 'path', propName: 'textContent', partial: 'users.'});
    });

    it('for ディレクティブのパス補完', () => {
      const ctx = getBindingContext('for: ', 5);
      expect(ctx).toEqual({ kind: 'path', propName: 'for', partial: ''});
    });
  });

  describe('filter コンテキスト', () => {
    it('| の直後でフィルタ補完', () => {
      const ctx = getBindingContext('textContent: count|', 19);
      expect(ctx).toEqual({ kind: 'filter', propName: 'textContent', partial: ''});
    });

    it('フィルタ名の途中で補完', () => {
      const ctx = getBindingContext('textContent: count|gt', 21);
      expect(ctx).toEqual({ kind: 'filter', propName: 'textContent', partial: 'gt'});
    });

    it('複数フィルタの2つ目', () => {
      const ctx = getBindingContext('textContent: count|gt(10)|', 26);
      expect(ctx).toEqual({ kind: 'filter', propName: 'textContent', partial: ''});
    });

    it('イベントハンドラのフィルタコンテキスト', () => {
      const ctx = getBindingContext('onclick: increment|', 19);
      expect(ctx).toEqual({ kind: 'filter', propName: 'onclick', partial: ''});
    });

    it('@stateName 指定ありのフィルタコンテキスト', () => {
      const ctx = getBindingContext('textContent: count@cart|', 24);
      expect(ctx).toEqual({ kind: 'filter', propName: 'textContent', partial: ''});
    });

    it('フィルタ引数内は none', () => {
      const ctx = getBindingContext('textContent: count|gt(', 22);
      expect(ctx).toEqual({ kind: 'none' });
    });
  });

  // Fixed by review（サイクル 3）— 区切り走査が引用符を見ておらず、カーソル位置の文脈を
  // 取り違えていた（実測）。診断ではないので false error にはならないが、補完候補が
  // 「フィルタ名の入力中」になったり、別のバインディング式を見たりしていた。
  describe('引用符の中の区切り文字（要件 B1）', () => {
    const at = (text: string) => getBindingContext(text, text.length);

    it('フィルタ引数の中の `|` は区切りではない（引数の中身以外は引用符無しと同じ扱い）', () => {
      // 修正前: { kind: 'filter', partial: "')" } — 引数の中の `|` を区切りと数えていた
      const quoted = at("textContent: items|join('|')");
      const plain = at("textContent: items|join('x')");
      expect(quoted.kind).toBe(plain.kind);
      expect(quoted).toEqual({
        kind: 'filter', propName: 'textContent', partial: "join('|')",
      });
      expect(at("textContent: items|join('a|b')")).toEqual({
        kind: 'filter', propName: 'textContent', partial: "join('a|b')",
      });
    });

    it('引用符の外の `|` では従来どおりフィルタ文脈になる', () => {
      expect(at("textContent: items|join('|')|")).toEqual({
        kind: 'filter', propName: 'textContent', partial: '',
      });
      expect(at("textContent: items|join('|')|up")).toEqual({
        kind: 'filter', propName: 'textContent', partial: 'up',
      });
    });

    it('入力途中で引用符が開きっぱなしなら引数の中とみなして補完しない', () => {
      // 手前の実区切りが選ばれ、`join('…` はフィルタ引数の中（`(` はあるが `)` が無い）
      expect(at("textContent: items|join('")).toEqual({ kind: 'none' });
      expect(at("textContent: items|join('|")).toEqual({ kind: 'none' });
    });

    it('引用符の中の `;` はバインディングの区切りではない', () => {
      // 修正前: { kind: 'property', partial: "b'" } — 式そのものを取り違えていた
      expect(at("textContent: 'a;b'")).toEqual({
        kind: 'path', propName: 'textContent', partial: "'a;b'",
      });
      // 引用符の外の `;` では従来どおり後続の式を見る
      expect(at("textContent: a|join(';'); title: b")).toEqual({
        kind: 'path', propName: 'title', partial: 'b',
      });
    });
  });

  describe('@ を含む式（v2: 名前次元は撤去）', () => {
    it('@ の後では補完しない（式は parse error）', () => {
      expect(getBindingContext('textContent: count@', 19)).toEqual({ kind: 'none' });
      expect(getBindingContext('textContent: count@car', 22)).toEqual({ kind: 'none' });
    });
  });
});
