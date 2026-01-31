import { describe, it, expect } from 'vitest';
import { createListIndex } from '../src/list/createListIndex';

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
