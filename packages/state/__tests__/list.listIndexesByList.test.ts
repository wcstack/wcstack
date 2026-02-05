import { describe, it, expect } from 'vitest';
import { getListIndexesByList, setListIndexesByList } from '../src/list/listIndexesByList';
import { createListDiff } from '../src/list/createListDiff';

const createListIndexes = (
  parentListIndex,
  oldList,
  newList,
  oldIndexes
) => createListDiff(parentListIndex, oldList, newList, oldIndexes).newIndexes;

describe('listIndexesByList', () => {
  it('set/get できること', () => {
    const list = [1, 2, 3];
    const listIndexes = createListIndexes(null, [], list, []);

    setListIndexesByList(list, listIndexes);
    expect(getListIndexesByList(list)).toBe(listIndexes);
  });

  it('nullで削除できること', () => {
    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);

    setListIndexesByList(list, listIndexes);
    setListIndexesByList(list, null);

    expect(getListIndexesByList(list)).toBeNull();
  });
});
