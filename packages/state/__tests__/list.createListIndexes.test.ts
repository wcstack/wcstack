import { describe, it, expect } from 'vitest';
import { createListIndexes } from '../src/list/createListIndexes';
import { createListIndex } from '../src/list/createListIndex';

describe('createListIndexes', () => {
  it('配列の長さ分のListIndexを生成すること', () => {
    const list = ['a', 'b', 'c'];
    const indexes = createListIndexes(list, null);

    expect(indexes).toHaveLength(3);
    expect(indexes[0].index).toBe(0);
    expect(indexes[1].index).toBe(1);
    expect(indexes[2].index).toBe(2);
  });

  it('親ListIndexを受け継ぐこと', () => {
    const parent = createListIndex(null, 9);
    const list = [10, 11];
    const indexes = createListIndexes(list, parent);

    expect(indexes[0].parentListIndex).toBe(parent);
    expect(indexes[1].parentListIndex).toBe(parent);
    expect(indexes[0].indexes).toEqual([9, 0]);
    expect(indexes[1].indexes).toEqual([9, 1]);
  });
});
