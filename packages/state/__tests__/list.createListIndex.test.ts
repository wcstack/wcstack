import { describe, it, expect } from 'vitest';
import { createListIndex, getRowsOfSameElement, setListIndexValue } from '../src/list/createListIndex';
import { forceGc } from './helpers/forceGc';

describe('createListIndex', () => {
  it('トップレベルのindexを作成できること', () => {
    const listIndex = createListIndex(null, 2);
    expect(listIndex.parentListIndex).toBeNull();
    expect(listIndex.position).toBe(0);
    expect(listIndex.length).toBe(1);
    expect(listIndex.index).toBe(2);
    expect(listIndex.indexes).toEqual([2]);
    expect(listIndex.varName).toBe('$1');
  });

  it('親を持つindexの情報が正しいこと', () => {
    const parent = createListIndex(null, 1);
    const child = createListIndex(parent, 3);

    expect(child.parentListIndex).toBe(parent);
    expect(child.position).toBe(1);
    expect(child.length).toBe(2);
    expect(child.index).toBe(3);
    expect(child.indexes).toEqual([1, 3]);
    expect(child.varName).toBe('$2');
  });

  it('indexの更新でindexesが更新されること', () => {
    const parent = createListIndex(null, 0);
    const child = createListIndex(parent, 1);

    expect(child.indexes).toEqual([0, 1]);
    parent.index = 2;
    expect(child.indexes).toEqual([2, 1]);
    child.index = 5;
    expect(child.indexes).toEqual([2, 5]);
  });

  it('atで階層取得できること', () => {
    const root = createListIndex(null, 0);
    const child = createListIndex(root, 1);
    const grand = createListIndex(child, 2);

    expect(grand.at(0)).toBe(root);
    expect(grand.at(1)).toBe(child);
    expect(grand.at(2)).toBe(grand);
    expect(grand.at(-1)).toBe(grand);
    expect(grand.at(-2)).toBe(child);
  });

  it('listIndexesの初期化とキャッシュが機能すること', () => {
    const root = createListIndex(null, 0);
    const child = createListIndex(root, 1);

    const rootList = root.listIndexes;
    expect(rootList.length).toBe(1);
    expect(rootList[0]?.deref()).toBe(root);

    const childList = child.listIndexes;
    expect(childList.length).toBe(2);
    expect(childList[0]?.deref()).toBe(root);
    expect(childList[1]?.deref()).toBe(child);

    // cache reuse
    expect(child.listIndexes).toBe(childList);
  });

  it('atで範囲外を指定した場合はnullになること', () => {
    const root = createListIndex(null, 0);
    const child = createListIndex(root, 1);

    expect(child.at(5)).toBeNull();
    expect(child.at(-3)).toBeNull();
  });
});

describe('要素オブジェクトの索引（#393）', () => {
  it('同じ要素オブジェクトを表す別の入れ子の行を引け、要素が替わった行は外れること', () => {
    const element = { v: 1 };
    const parent = createListIndex(null, 0);
    const [a, b, c] = [createListIndex(parent, 0), createListIndex(parent, 1), createListIndex(parent, 2)];
    // 値を記録していない行・プリミティブの要素の行は索引に載らない
    expect(getRowsOfSameElement(a)).toEqual([]);
    setListIndexValue(c, 'text');
    expect(getRowsOfSameElement(c)).toEqual([]);
    // 1 つの行だけが表す要素には別の行が無い
    setListIndexValue(a, element);
    expect(getRowsOfSameElement(a)).toEqual([]);
    setListIndexValue(b, element);
    expect(getRowsOfSameElement(a)).toEqual([b]);
    expect(getRowsOfSameElement(b)).toEqual([a]);
    // 同じ要素の書き直しは索引を変えない
    setListIndexValue(b, element);
    expect(getRowsOfSameElement(a)).toEqual([b]);
    // 別の要素に替わった行は外れる
    setListIndexValue(b, { v: 2 });
    expect(getRowsOfSameElement(a)).toEqual([]);
    // ルート直下の行は載せない（別の行を引くのは、入れ子の行の下への書き込みだけ）
    const root = createListIndex(null, 1);
    setListIndexValue(root, element);
    expect(getRowsOfSameElement(a)).toEqual([]);
  });

  it('索引は行を生かさず、引いたときに消えた行を外すこと', async () => {
    const element = { v: 1 };
    const parent = createListIndex(null, 0);
    const kept = createListIndex(parent, 0);
    setListIndexValue(kept, element);
    // 索引だけが持つ行を 20 個載せる（8 個を超えたところで、集合を見直す）
    for (let i = 1; i <= 20; i++) {
      setListIndexValue(createListIndex(parent, i), element);
    }
    expect(getRowsOfSameElement(kept)).toHaveLength(20);
    await forceGc();
    expect(getRowsOfSameElement(kept)).toEqual([]);
  });
});
