import { describe, it, expect } from 'vitest';
import { createListDiff } from '../src/list/createListDiff';
import { setListIndexesByList } from '../src/list/listIndexesByList';

describe('createListDiff', () => {
  it('calcDiffIndexesで位置が変わった既存要素がchangeIndexSetに含まれること', () => {
    // oldList と newList の両方にlistIndexesが登録済みの場合、calcDiffIndexesが呼ばれる
    const oldList = [1, 2, 3];
    const newList = [3, 1];

    // まず両方のリストに対してlistIndexesを生成・登録する
    const diffOld = createListDiff(null, [], oldList);
    const diffNew = createListDiff(null, [], newList);

    // oldList=[1,2,3], newList=[3,1] で diff を計算
    // 両方のリストにlistIndexesが登録済みなので calcDiffIndexes に入る
    // oldList の value 3 は oldIndex=2、newList の position=0 → index !== i → changeIndexSet に追加
    const diff = createListDiff(null, oldList, newList);

    // 位置が変わった要素が changeIndexSet に含まれること
    expect(diff.changeIndexSet.size).toBeGreaterThan(0);

    // クリーンアップ
    setListIndexesByList(oldList, null);
    setListIndexesByList(newList, null);
  });

  describe('同一バッチ内の連続 diff（未適用 diff による .index 先行変異の影響）', () => {
    it('未適用の中間 diff があっても、2回目の diff の changeIndexSet は古いリスト基準で計算されること', () => {
      const listA = ['x', 'y'];
      const first = createListDiff(null, [], listA);
      const [idxX, idxY] = first.newIndexes;

      const listB = ['y', 'x'];
      createListDiff(null, listA, listB); // 中間 diff（適用されない）が .index を変異させる

      const listC = ['y', 'x']; // 別配列・中間リストと同順
      const diff = createListDiff(null, listA, listC);
      // 両行とも描画済みリスト A からは位置が変わっている
      expect(diff.changeIndexSet.has(idxX)).toBe(true);
      expect(diff.changeIndexSet.has(idxY)).toBe(true);
      // .index は新リストの位置に同期されている
      expect(diff.newIndexes.map((li) => li.index)).toEqual([0, 1]);

      setListIndexesByList(listA, null);
      setListIndexesByList(listB, null);
      setListIndexesByList(listC, null);
    });

    it('同一参照リストへの diff で、未適用の中間 diff による .index の変異が復元されること', () => {
      const listA = ['x', 'y'];
      const first = createListDiff(null, [], listA);
      const [idxX, idxY] = first.newIndexes;

      const listB = ['y', 'x'];
      createListDiff(null, listA, listB);
      expect(idxX.index).toBe(1); // 中間 diff による変異

      const diff = createListDiff(null, listA, listA);
      expect(diff.changeIndexSet.size).toBe(0);
      expect(idxX.index).toBe(0); // 復元
      expect(idxY.index).toBe(1);

      setListIndexesByList(listA, null);
      setListIndexesByList(listB, null);
    });

    it('キャッシュヒットでも newIndexes の .index が新リストの位置に同期されること', () => {
      const listA = ['x', 'y'];
      createListDiff(null, [], listA);
      const listB = ['y', 'x'];
      const d1 = createListDiff(null, listA, listB);
      const [idxY, idxX] = d1.newIndexes;

      createListDiff(null, listA, listA); // .index を A の位置へ復元
      expect(idxX.index).toBe(0);

      const d2 = createListDiff(null, listA, listB); // キャッシュヒット
      expect(d2).toBe(d1);
      expect(idxY.index).toBe(0); // B の位置へ再同期
      expect(idxX.index).toBe(1);

      setListIndexesByList(listA, null);
      setListIndexesByList(listB, null);
    });
  });
});
