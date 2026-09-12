import { describe, it, expect } from 'vitest';
import { getListIndexesByList, retireListIndexes, setListIndexesByList } from '../src/list/listIndexesByList';
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
    expect(getListIndexesByList(list, null)).toBe(listIndexes);
  });

  it('nullで削除できること', () => {
    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);

    setListIndexesByList(list, listIndexes);
    setListIndexesByList(list, null);

    expect(getListIndexesByList(list, null)).toBeNull();
  });

  /**
   * #256: 「生きた共有」と「陳腐化」を分ける。行集合は 1 本の配列につき 1 組のままで、
   * 陳腐化したときだけ**行の identity を保ったまま**新しい親へ付け替える。
   */
  describe('退役した親の付け替え（#256）', () => {
    it('親が生きているなら付け替えない ── 2 つの親が 1 組の行集合を共有すること', () => {
      const list = [1, 2];
      const p0 = createListIndex(null, 0);
      const p1 = createListIndex(null, 1);
      const rows = [createListIndex(p0, 0), createListIndex(p0, 1)];
      setListIndexesByList(list, rows);

      // 別の生きた親から引いても同じ行集合が返り、親ポインタは動かない
      expect(getListIndexesByList(list, p1)).toBe(rows);
      expect(rows.map((r) => r.parentListIndex)).toEqual([p0, p0]);

      setListIndexesByList(list, null);
    });

    it('親が退役していたら、同じ行オブジェクトのまま新しい親へ付け替えること', () => {
      const list = [1, 2];
      const oldParent = createListIndex(null, 0);
      const newParent = createListIndex(null, 0); // 同じ深さ・同じ位置・別オブジェクト
      const rows = [createListIndex(oldParent, 0), createListIndex(oldParent, 1)];
      setListIndexesByList(list, rows);
      retireListIndexes([oldParent]);

      const got = getListIndexesByList(list, newParent)!;

      // 行集合も行オブジェクトも作り直さない（消費者が握っている content が生き残る）
      expect(got).toBe(rows);
      expect(got[0]).toBe(rows[0]);
      expect(got.map((r) => r.parentListIndex)).toEqual([newParent, newParent]);
      // WeakRef 連鎖も張り替わる（at() が死んだ親を返さない）
      expect(got[0].at(0)).toBe(newParent);

      setListIndexesByList(list, null);
    });

    it('差し替え先も退役していたら付け替えないこと', () => {
      const list = [1];
      const oldParent = createListIndex(null, 0);
      const newParent = createListIndex(null, 0);
      const rows = [createListIndex(oldParent, 0)];
      setListIndexesByList(list, rows);
      retireListIndexes([oldParent, newParent]);

      expect(getListIndexesByList(list, newParent)).toBe(rows);
      expect(rows[0].parentListIndex).toBe(oldParent);

      setListIndexesByList(list, null);
    });

    it('深さ（position）が違う親へは付け替えないこと', () => {
      const list = [1];
      const grandParent = createListIndex(null, 0);
      const oldParent = createListIndex(grandParent, 0); // position 1
      const shallowParent = createListIndex(null, 0);    // position 0
      const rows = [createListIndex(oldParent, 0)];
      setListIndexesByList(list, rows);
      retireListIndexes([oldParent]);

      expect(getListIndexesByList(list, shallowParent)).toBe(rows);
      expect(rows[0].parentListIndex).toBe(oldParent);

      setListIndexesByList(list, null);
    });

    it('ルート直下の行（親 null）と、親 null の要求は付け替えの対象外であること', () => {
      const rootList = [1];
      const rootRows = [createListIndex(null, 0)];
      setListIndexesByList(rootList, rootRows);
      const someParent = createListIndex(null, 0);
      // 行の親が null（＝ルート直下）: 付け替える先の深さが合わない
      expect(getListIndexesByList(rootList, someParent)).toBe(rootRows);
      expect(rootRows[0].parentListIndex).toBeNull();

      // 要求側が null: 同上
      const childList = [2];
      const oldParent = createListIndex(null, 0);
      const childRows = [createListIndex(oldParent, 0)];
      setListIndexesByList(childList, childRows);
      retireListIndexes([oldParent]);
      expect(getListIndexesByList(childList, null)).toBe(childRows);
      expect(childRows[0].parentListIndex).toBe(oldParent);

      setListIndexesByList(rootList, null);
      setListIndexesByList(childList, null);
    });

    it('空の行集合（空リスト）でも落ちないこと', () => {
      const list: unknown[] = [];
      const parent = createListIndex(null, 0);
      setListIndexesByList(list, []);

      expect(getListIndexesByList(list, parent)).toEqual([]);

      setListIndexesByList(list, null);
    });
  });
});
