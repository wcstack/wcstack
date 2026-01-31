import { describe, it, expect } from 'vitest';
import { getListIndexesByList, setListIndexesByList } from '../src/list/listIndexesByList';
import { createListIndexes } from '../src/list/createListIndexes';

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
