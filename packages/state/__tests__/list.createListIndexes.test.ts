import { describe, it, expect } from 'vitest';
import { createListIndexes } from '../src/list/createListIndexes';
import { createListIndex } from '../src/list/createListIndex';

describe('createListIndexes', () => {
  it('配列の長さ分のListIndexを生成すること', () => {
    const list = ['a', 'b', 'c'];
    const indexes = createListIndexes(null, [], list, []);

    expect(indexes).toHaveLength(3);
    expect(indexes[0].index).toBe(0);
    expect(indexes[1].index).toBe(1);
    expect(indexes[2].index).toBe(2);
  });

  it('親ListIndexを受け継ぐこと', () => {
    const parent = createListIndex(null, 9);
    const list = [10, 11];
    const indexes = createListIndexes(parent, [], list, []);

    expect(indexes[0].parentListIndex).toBe(parent);
    expect(indexes[1].parentListIndex).toBe(parent);
    expect(indexes[0].indexes).toEqual([9, 0]);
    expect(indexes[1].indexes).toEqual([9, 1]);
  });

  it('新しいリストが空なら空配列を返すこと', () => {
    const oldIndexes = [createListIndex(null, 0)];
    const indexes = createListIndexes(null, [1], [], oldIndexes);
    expect(indexes).toEqual([]);
  });

  it('同一リストなら既存インデックスを返すこと', () => {
    const list = ['a', 'b'];
    const oldIndexes = createListIndexes(null, [], list, []);
    const indexes = createListIndexes(null, list, ['a', 'b'], oldIndexes);
    expect(indexes).toBe(oldIndexes);
  });

  it('値の再配置はインデックスを更新して再利用すること', () => {
    const oldList = ['a', 'b', 'c'];
    const oldIndexes = createListIndexes(null, [], oldList, []);

    const indexes = createListIndexes(null, oldList, ['b', 'a', 'd'], oldIndexes);
    expect(indexes[0]).toBe(oldIndexes[1]);
    expect(indexes[1]).toBe(oldIndexes[0]);
    expect(indexes[2]).not.toBe(oldIndexes[2]);
    expect(indexes[0].index).toBe(0);
    expect(indexes[1].index).toBe(1);
    expect(indexes[2].index).toBe(2);
  });

  it('位置が変わらない要素はインデックス更新しないこと', () => {
    const oldList = ['a', 'b'];
    const oldIndexes = createListIndexes(null, [], oldList, []);

    const indexes = createListIndexes(null, oldList, ['a', 'b', 'c'], oldIndexes);
    expect(indexes[0]).toBe(oldIndexes[0]);
    expect(indexes[1]).toBe(oldIndexes[1]);
    expect(indexes[0].index).toBe(0);
    expect(indexes[1].index).toBe(1);
    expect(indexes[2].index).toBe(2);
  });

  it('重複値は順序通りに再利用すること', () => {
    const oldList = ['x', 'y', 'x'];
    const oldIndexes = createListIndexes(null, [], oldList, []);

    const indexes = createListIndexes(null, oldList, ['x'], oldIndexes);
    expect(indexes[0]).toBe(oldIndexes[0]);
    expect(indexes[0].index).toBe(0);
  });

  it('配列以外の入力は空配列として扱うこと', () => {
    const indexes = createListIndexes(null, { a: 1 }, null, []);
    expect(indexes).toEqual([]);
  });

  it('一度計算したリストの差分をキャッシュから利用すること', () => {
    const oldList = ['old1'];
    const newList = ['new1'];
    // Initial call to setup empty->oldList cache (not strictly needed for this test but mimics flow)
    const oldIndexes = createListIndexes(null, [], oldList, []);

    // First diff calculation
    const indexes1 = createListIndexes(null, oldList, newList, oldIndexes);

    // Second diff calculation with SAME Array references
    const indexes2 = createListIndexes(null, oldList, newList, oldIndexes);

    // Result should be exactly the same object (reference equality)
    // because it comes from the cache
    expect(indexes2).toBe(indexes1);
  });
});
