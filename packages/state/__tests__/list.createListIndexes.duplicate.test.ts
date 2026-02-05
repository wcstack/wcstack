import { describe, it, expect } from 'vitest';
import { createListDiff } from '../src/list/createListDiff';

const createListIndexes = (
  parentListIndex,
  oldList,
  newList,
  oldIndexes
) => createListDiff(parentListIndex, oldList, newList, oldIndexes).newIndexes;

describe('createListDiff Duplicate Check', () => {
  it('重複値があるリストでも正しくインデックスを生成・維持すること', () => {
    const oldList = ['a', 'a'];
    const oldIndexes = createListIndexes(null, [], oldList, []);
    
    expect(oldIndexes[0]).not.toBe(oldIndexes[1]);

    const newList = ['a', 'a'];
    const newIndexes = createListIndexes(null, oldList, newList, oldIndexes);

    // インデックスはユニークで、かつ元のものを順序よく再利用すべき
    expect(newIndexes[0]).not.toBe(newIndexes[1]);
    expect(newIndexes[0]).toBe(oldIndexes[0]);
    expect(newIndexes[1]).toBe(oldIndexes[1]);
  });
  
  it('重複値が増えた場合でも個別に生成されること', () => {
    const oldList = ['a'];
    const oldIndexes = createListIndexes(null, [], oldList, []);

    const newList = ['a', 'a'];
    const newIndexes = createListIndexes(null, oldList, newList, oldIndexes);

    expect(newIndexes[0]).not.toBe(newIndexes[1]);
    expect(newIndexes[0]).toBe(oldIndexes[0]); // 既存再利用
    // newIndexes[1] は新規
  });
});
