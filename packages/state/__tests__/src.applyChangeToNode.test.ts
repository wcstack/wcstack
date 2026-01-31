import { describe, it, expect } from 'vitest';
import { applyChangeToNode } from '../src/applyChangeToNode';

describe('applyChangeToNode', () => {
  it('elementのプロパティを更新できること', () => {
    const el = document.createElement('input') as any;
    applyChangeToNode(el, ['value'], 'abc');
    expect(el.value).toBe('abc');
  });

  it('styleを更新できること', () => {
    const el = document.createElement('div');
    applyChangeToNode(el, ['style', 'color'], 'red');
    expect(el.style.color).toBe('red');
  });

  it('attrを設定・削除できること', () => {
    const el = document.createElement('div');
    applyChangeToNode(el, ['attr', 'data-x'], '1');
    expect(el.getAttribute('data-x')).toBe('1');

    applyChangeToNode(el, ['attr', 'data-x'], null);
    expect(el.getAttribute('data-x')).toBeNull();
  });

  it('subObjectを更新できること', () => {
    const el = document.createElement('div') as any;
    el.foo = { bar: 1 };
    applyChangeToNode(el, ['foo', 'bar'], 2);
    expect(el.foo.bar).toBe(2);
  });

  it('subObjectがnullの場合は何もしないこと', () => {
    const el = document.createElement('div') as any;
    el.foo = null;
    // 例外が発生しないことを確認
    expect(() => applyChangeToNode(el, ['foo', 'bar'], 2)).not.toThrow();
    expect(el.foo).toBeNull();
  });

  it('subObjectが非オブジェクト(プリミティブ)の場合は何もしないこと', () => {
    const el = document.createElement('div') as any;
    el.foo = 'string';
    // 例外が発生しないことを確認
    expect(() => applyChangeToNode(el, ['foo', 'bar'], 2)).not.toThrow();
    expect(el.foo).toBe('string');
  });

  it('subObjectが未定義の場合は何もしないこと', () => {
    const el = document.createElement('div') as any;
    // el.foo は undefined
    expect(() => applyChangeToNode(el, ['foo', 'bar'], 2)).not.toThrow();
  });

  it('text nodeを更新できること', () => {
    const text = document.createTextNode('a');
    applyChangeToNode(text, ['textContent'], 'b');
    expect(text.textContent).toBe('b');
  });

  it('コメントノードなどELEMENT_NODEでもTEXT_NODEでもないノードでは何もしないこと', () => {
    const comment = document.createComment('test');
    // 例外が発生しないことを確認
    expect(() => applyChangeToNode(comment, ['textContent'], 'test')).not.toThrow();
  });
});
