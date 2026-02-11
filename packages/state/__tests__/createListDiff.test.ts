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
});
