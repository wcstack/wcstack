import { describe, it, expect } from 'vitest';
import { applyChangeToProperty } from '../src/apply/applyChangeToProperty';

describe('applyChangeToProperty', () => {
  it('同じ値の場合は変更しないこと', () => {
    const input = document.createElement('input');
    input.value = 'a';
    applyChangeToProperty(input, 'value', 'a');
    expect(input.value).toBe('a');
  });

  it('値が異なる場合は更新すること', () => {
    const input = document.createElement('input');
    input.value = 'a';
    applyChangeToProperty(input, 'value', 'b');
    expect(input.value).toBe('b');
  });
});
