import { describe, it, expect } from 'vitest';
import { getNodesByContent, setNodesByContent } from '../src/bindings/nodesByContent';
import type { IContent } from '../src/structural/types';

describe('bindings/nodesByContent', () => {
  it('未設定の場合は空配列を返すこと', () => {
    const content = { firstNode: null, lastNode: null, mounted: false } as IContent;
    expect(getNodesByContent(content)).toEqual([]);
  });

  it('set/getできること', () => {
    const content = { firstNode: null, lastNode: null, mounted: false } as IContent;
    const nodes = [document.createElement('div'), document.createComment('x')];

    setNodesByContent(content, nodes);
    expect(getNodesByContent(content)).toBe(nodes);
  });
});
