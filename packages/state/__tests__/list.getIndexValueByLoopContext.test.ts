import { describe, it, expect } from 'vitest';
import { getIndexValueByLoopContext } from '../src/list/getIndexValueByLoopContext';
import { createListIndex } from '../src/list/createListIndex';
import { getPathInfo } from '../src/address/PathInfo';
import { ILoopContext } from '../src/list/types';

describe('getIndexValueByLoopContext', () => {
  it('$1 でトップレベルのインデックス値を取得できること', () => {
    const listIndex = createListIndex(null, 5);
    const loopContext: ILoopContext = {
      elementPathInfo: getPathInfo('items.*'),
      listIndex,
    };

    const result = getIndexValueByLoopContext(loopContext, '$1');
    expect(result).toBe(5);
  });

  it('$2 でネストされた2階層目のインデックス値を取得できること', () => {
    const parentListIndex = createListIndex(null, 1);
    const childListIndex = createListIndex(parentListIndex, 3);
    const loopContext: ILoopContext = {
      elementPathInfo: getPathInfo('categories.*.items.*'),
      listIndex: childListIndex,
    };

    const result = getIndexValueByLoopContext(loopContext, '$2');
    expect(result).toBe(3);
  });

  it('$1 でネストされたループの1階層目のインデックス値を取得できること', () => {
    const parentListIndex = createListIndex(null, 2);
    const childListIndex = createListIndex(parentListIndex, 0);
    const loopContext: ILoopContext = {
      elementPathInfo: getPathInfo('categories.*.items.*'),
      listIndex: childListIndex,
    };

    const result = getIndexValueByLoopContext(loopContext, '$1');
    expect(result).toBe(2);
  });

  it('listIndex が null の場合はエラーになること', () => {
    const loopContext = {
      elementPathInfo: getPathInfo('items.*'),
      listIndex: null,
    } as any;

    expect(() => getIndexValueByLoopContext(loopContext, '$1')).toThrow(/ListIndex not found for loopContext/);
  });

  it('無効なインデックス名の場合はエラーになること', () => {
    const listIndex = createListIndex(null, 0);
    const loopContext: ILoopContext = {
      elementPathInfo: getPathInfo('items.*'),
      listIndex,
    };

    expect(() => getIndexValueByLoopContext(loopContext, '$0')).toThrow(/Invalid index name/);
  });

  it('存在しない階層のインデックスを参照した場合はエラーになること', () => {
    const listIndex = createListIndex(null, 0);
    const loopContext: ILoopContext = {
      elementPathInfo: getPathInfo('items.*'),
      listIndex,
    };

    expect(() => getIndexValueByLoopContext(loopContext, '$2')).toThrow(/Index not found at position/);
  });
});
