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
      expect(ctx).toEqual({ kind: 'path', propName: 'textContent', partial: '' });
    });

    it('パスの途中でパス補完', () => {
      const ctx = getBindingContext('textContent: users.', 19);
      expect(ctx).toEqual({ kind: 'path', propName: 'textContent', partial: 'users.' });
    });

    it('for ディレクティブのパス補完', () => {
      const ctx = getBindingContext('for: ', 5);
      expect(ctx).toEqual({ kind: 'path', propName: 'for', partial: '' });
    });
  });

  describe('filter コンテキスト', () => {
    it('| の直後でフィルタ補完', () => {
      const ctx = getBindingContext('textContent: count|', 19);
      expect(ctx).toEqual({ kind: 'filter', propName: 'textContent', partial: '' });
    });

    it('フィルタ名の途中で補完', () => {
      const ctx = getBindingContext('textContent: count|gt', 21);
      expect(ctx).toEqual({ kind: 'filter', propName: 'textContent', partial: 'gt' });
    });

    it('複数フィルタの2つ目', () => {
      const ctx = getBindingContext('textContent: count|gt(10)|', 26);
      expect(ctx).toEqual({ kind: 'filter', propName: 'textContent', partial: '' });
    });

    it('イベントハンドラのフィルタコンテキスト', () => {
      const ctx = getBindingContext('onclick: increment|', 19);
      expect(ctx).toEqual({ kind: 'filter', propName: 'onclick', partial: '' });
    });

    it('フィルタ引数内は none', () => {
      const ctx = getBindingContext('textContent: count|gt(', 22);
      expect(ctx).toEqual({ kind: 'none' });
    });
  });

  describe('none コンテキスト', () => {
    it('@ の後は none', () => {
      const ctx = getBindingContext('textContent: count@', 19);
      expect(ctx).toEqual({ kind: 'none' });
    });
  });
});
