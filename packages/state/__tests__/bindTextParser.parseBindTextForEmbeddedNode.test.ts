import { describe, it, expect } from 'vitest';
import { parseBindTextForEmbeddedNode } from '../src/bindTextParser/parseBindTextForEmbeddedNode';

describe('parseBindTextForEmbeddedNode', () => {
  it('textバインディングとしてパースできること', () => {
    const result = parseBindTextForEmbeddedNode('message');
    expect(result.bindingType).toBe('text');
    expect(result.propName).toBe('textContent');
    expect(result.statePathName).toBe('message');
  });
});
