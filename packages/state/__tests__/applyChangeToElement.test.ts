import { describe, it, expect } from 'vitest';
import { applyChangeToElement } from '../src/apply/applyChangeToElement';

describe('applyChangeToElement', () => {
  it('propSegmentが空の場合は何もしないこと', () => {
    const el = document.createElement('div');
    applyChangeToElement(el, [], 'value');
    expect(el.getAttribute('data-test')).toBeNull();
  });

  it('classを更新できること', () => {
    const el = document.createElement('div');
    applyChangeToElement(el, ['class', 'active'], true as any);
    expect(el.classList.contains('active')).toBe(true);
  });

  it('attrを更新できること', () => {
    const el = document.createElement('div');
    applyChangeToElement(el, ['attr', 'data-test'], 'x');
    expect(el.getAttribute('data-test')).toBe('x');
  });

  it('styleを更新できること', () => {
    const el = document.createElement('div');
    applyChangeToElement(el, ['style', 'color'], 'red');
    expect(el.style.color).toBe('red');
  });

  it('プロパティを更新できること', () => {
    const input = document.createElement('input');
    applyChangeToElement(input, ['value'], 'abc');
    expect(input.value).toBe('abc');
  });

  it('サブオブジェクトを更新できること', () => {
    const el = document.createElement('div') as any;
    el.foo = { bar: { baz: 1 } };
    applyChangeToElement(el, ['foo', 'bar', 'baz'], 2 as any);
    expect(el.foo.bar.baz).toBe(2);
  });
});
