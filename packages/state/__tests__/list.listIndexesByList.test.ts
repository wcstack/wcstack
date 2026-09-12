import { describe, it, expect } from 'vitest';
import { getLastRegisteredListIndexes, getListIndexesByList, setListIndexesByList } from '../src/list/listIndexesByList';
import { createListIndex } from '../src/list/createListIndex';
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

  // #256: 台帳のキーは (親, 配列) の組。
  it('同じ配列でも親が違えば別の行集合になること', () => {
    const list = [1, 2];
    const p0 = createListIndex(null, 0);
    const p1 = createListIndex(null, 1);
    const rows0 = [createListIndex(p0, 0), createListIndex(p0, 1)];
    const rows1 = [createListIndex(p1, 0), createListIndex(p1, 1)];

    setListIndexesByList(list, rows0);
    setListIndexesByList(list, rows1);

    // 格納先は行自身の親。後から入れた方が先の方を潰さない
    expect(getListIndexesByList(list, p0)).toBe(rows0);
    expect(getListIndexesByList(list, p1)).toBe(rows1);
    // 登録していない親のもとには無い（「この親は未展開」）
    expect(getListIndexesByList(list, null)).toBeNull();

    setListIndexesByList(list, null);
  });

  it('最後に登録した行集合は親を問わず引けること（退役専用）', () => {
    const list = ['a'];
    const p0 = createListIndex(null, 0);
    const rows = [createListIndex(p0, 0)];

    expect(getLastRegisteredListIndexes(list)).toBeNull();
    setListIndexesByList(list, rows);
    expect(getLastRegisteredListIndexes(list)).toBe(rows);

    // null 削除は組ごとの台帳も最後の登録も両方忘れる
    setListIndexesByList(list, null);
    expect(getLastRegisteredListIndexes(list)).toBeNull();
    expect(getListIndexesByList(list, p0)).toBeNull();
  });
});
