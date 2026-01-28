import { describe, it, expect } from 'vitest';
import { applyChangeToText } from '../src/apply/applyChangeToText';

describe('applyChangeToText', () => {
  it('同じ値の場合は変更しないこと', () => {
    const textNode = document.createTextNode('hello');
    applyChangeToText(textNode, 'hello');
    expect(textNode.nodeValue).toBe('hello');
  });

  it('値が異なる場合は更新すること', () => {
    const textNode = document.createTextNode('hello');
    applyChangeToText(textNode, 'world');
    expect(textNode.nodeValue).toBe('world');
  });
});
