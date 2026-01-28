import { describe, it, expect } from 'vitest';
import { applyChangeToAttribute } from '../src/apply/applyChangeToAttribute';

describe('applyChangeToAttribute', () => {
  it('同じ値の場合は変更しないこと', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', 'a');
    applyChangeToAttribute(el, 'data-test', 'a');
    expect(el.getAttribute('data-test')).toBe('a');
  });

  it('値が異なる場合は更新すること', () => {
    const el = document.createElement('div');
    el.setAttribute('data-test', 'a');
    applyChangeToAttribute(el, 'data-test', 'b');
    expect(el.getAttribute('data-test')).toBe('b');
  });
});
