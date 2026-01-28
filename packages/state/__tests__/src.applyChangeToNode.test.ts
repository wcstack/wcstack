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

  it('text nodeを更新できること', () => {
    const text = document.createTextNode('a');
    applyChangeToNode(text, ['textContent'], 'b');
    expect(text.textContent).toBe('b');
  });
});
