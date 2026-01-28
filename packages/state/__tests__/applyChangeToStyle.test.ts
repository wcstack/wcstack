import { describe, it, expect } from 'vitest';
import { applyChangeToStyle } from '../src/apply/applyChangeToStyle';

describe('applyChangeToStyle', () => {
  it('同じ値の場合は変更しないこと', () => {
    const el = document.createElement('div');
    el.style.color = 'red';
    applyChangeToStyle(el, 'color', 'red');
    expect(el.style.color).toBe('red');
  });

  it('値が異なる場合は更新すること', () => {
    const el = document.createElement('div');
    el.style.color = 'red';
    applyChangeToStyle(el, 'color', 'blue');
    expect(el.style.color).toBe('blue');
  });
});
