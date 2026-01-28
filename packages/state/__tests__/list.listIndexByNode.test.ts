import { describe, it, expect } from 'vitest';
import { getListIndexByNode, setListIndexByNode } from '../src/list/listIndexByNode';
import { createListIndex } from '../src/list/createListIndex';

describe('listIndexByNode', () => {
  it('set/get できること', () => {
    const node = document.createElement('div');
    const listIndex = createListIndex(null, 0);

    setListIndexByNode(node, listIndex);
    expect(getListIndexByNode(node)).toBe(listIndex);
  });

  it('nullで削除できること', () => {
    const node = document.createElement('div');
    const listIndex = createListIndex(null, 1);

    setListIndexByNode(node, listIndex);
    setListIndexByNode(node, null);

    expect(getListIndexByNode(node)).toBeNull();
  });
});
