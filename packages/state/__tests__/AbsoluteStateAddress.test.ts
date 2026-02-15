import { describe, it, expect } from 'vitest';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { getPathInfo } from '../src/address/PathInfo';
import { createListIndex } from '../src/list/createListIndex';
import type { IStateElement } from '../src/components/types';

const testStateElement = { name: 'test' } as IStateElement;
const test2StateElement = { name: 'test2' } as IStateElement;
const defaultStateElement = { name: 'default' } as IStateElement;

describe('AbsoluteStateAddress', () => {

  it('nullのlistIndexでAbsoluteStateAddressが作成されること', () => {
    const pathInfo = getPathInfo('count');
    const absolutePathInfo = getAbsolutePathInfo(testStateElement, pathInfo);
    const absoluteAddress = createAbsoluteStateAddress(absolutePathInfo, null);

    expect(absoluteAddress).toBeDefined();
    expect(absoluteAddress.absolutePathInfo).toBe(absolutePathInfo);
    expect(absoluteAddress.listIndex).toBeNull();
  });

  it('同一のabsolutePathInfo/listIndexで呼び出すとキャッシュから返されること', () => {
    const pathInfo = getPathInfo('count');
    const absolutePathInfo = getAbsolutePathInfo(testStateElement, pathInfo);
    const absoluteAddress1 = createAbsoluteStateAddress(absolutePathInfo, null);
    const absoluteAddress2 = createAbsoluteStateAddress(absolutePathInfo, null);

    expect(absoluteAddress1).toBe(absoluteAddress2);
  });

  it('異なるabsolutePathInfoの場合は新規作成されること', () => {
    const pathInfo1 = getPathInfo('count');
    const pathInfo2 = getPathInfo('name');
    const absolutePathInfo1 = getAbsolutePathInfo(testStateElement, pathInfo1);
    const absolutePathInfo2 = getAbsolutePathInfo(testStateElement, pathInfo2);

    const absoluteAddress1 = createAbsoluteStateAddress(absolutePathInfo1, null);
    const absoluteAddress2 = createAbsoluteStateAddress(absolutePathInfo2, null);

    expect(absoluteAddress1).not.toBe(absoluteAddress2);
  });

  it('異なるstateNameでは別々にキャッシュされること', () => {
    const pathInfo = getPathInfo('count');
    const absolutePathInfo1 = getAbsolutePathInfo(testStateElement, pathInfo);
    const absolutePathInfo2 = getAbsolutePathInfo(test2StateElement, pathInfo);

    const absoluteAddress1 = createAbsoluteStateAddress(absolutePathInfo1, null);
    const absoluteAddress2 = createAbsoluteStateAddress(absolutePathInfo2, null);

    expect(absoluteAddress1).not.toBe(absoluteAddress2);
    expect(absoluteAddress1.absolutePathInfo.stateName).toBe('test');
    expect(absoluteAddress2.absolutePathInfo.stateName).toBe('test2');
  });

  it('listIndex付きでAbsoluteStateAddressが作成されること', () => {
    const pathInfo = getPathInfo('users.*');
    const absolutePathInfo = getAbsolutePathInfo(defaultStateElement, pathInfo);
    const listIndex = createListIndex(null, 0);
    const absoluteAddress = createAbsoluteStateAddress(absolutePathInfo, listIndex);

    expect(absoluteAddress.absolutePathInfo).toBe(absolutePathInfo);
    expect(absoluteAddress.listIndex).toBe(listIndex);
  });

  it('同一のlistIndex/absolutePathInfoでキャッシュされること', () => {
    const pathInfo = getPathInfo('users.*');
    const absolutePathInfo = getAbsolutePathInfo(defaultStateElement, pathInfo);
    const listIndex = createListIndex(null, 0);
    const absoluteAddress1 = createAbsoluteStateAddress(absolutePathInfo, listIndex);
    const absoluteAddress2 = createAbsoluteStateAddress(absolutePathInfo, listIndex);

    expect(absoluteAddress1).toBe(absoluteAddress2);
  });

  it('parentAbsoluteAddressが正しく解決されること', () => {
    const pathInfo = getPathInfo('users.*.name');
    const absolutePathInfo = getAbsolutePathInfo(defaultStateElement, pathInfo);
    const listIndex = createListIndex(null, 0);
    const absoluteAddress = createAbsoluteStateAddress(absolutePathInfo, listIndex);

    const parent = absoluteAddress.parentAbsoluteAddress;
    expect(parent).not.toBeNull();
    expect(parent!.absolutePathInfo.pathInfo.path).toBe('users.*');
  });

  it('parentAbsoluteAddressがキャッシュされること', () => {
    const pathInfo = getPathInfo('users.*.name');
    const absolutePathInfo = getAbsolutePathInfo(defaultStateElement, pathInfo);
    const listIndex = createListIndex(null, 0);
    const absoluteAddress = createAbsoluteStateAddress(absolutePathInfo, listIndex);

    const parent1 = absoluteAddress.parentAbsoluteAddress;
    const parent2 = absoluteAddress.parentAbsoluteAddress;
    expect(parent1).toBe(parent2);
  });

  it('トップレベルのpathではparentAbsoluteAddressがnullになること', () => {
    const pathInfo = getPathInfo('count');
    const absolutePathInfo = getAbsolutePathInfo(defaultStateElement, pathInfo);
    const absoluteAddress = createAbsoluteStateAddress(absolutePathInfo, null);

    expect(absoluteAddress.parentAbsoluteAddress).toBeNull();
  });

  it('ワイルドカード末尾でparentListIndexが使われること', () => {
    const parentListIndex = createListIndex(null, 0);
    const listIndex = createListIndex(parentListIndex, 1);
    const pathInfo = getPathInfo('users.*');
    const absolutePathInfo = getAbsolutePathInfo(defaultStateElement, pathInfo);
    const absoluteAddress = createAbsoluteStateAddress(absolutePathInfo, listIndex);

    const parent = absoluteAddress.parentAbsoluteAddress;
    expect(parent).not.toBeNull();
    expect(parent!.listIndex).toBe(parentListIndex);
  });

  it('ワイルドカード末尾でlistIndexがnullの場合parentListIndexがnullになること', () => {
    const pathInfo = getPathInfo('users.*');
    const absolutePathInfo = getAbsolutePathInfo(defaultStateElement, pathInfo);
    const absoluteAddress = createAbsoluteStateAddress(absolutePathInfo, null);

    const parent = absoluteAddress.parentAbsoluteAddress;
    expect(parent).not.toBeNull();
    expect(parent!.listIndex).toBeNull();
  });

  it('非ワイルドカード末尾でlistIndexがそのまま引き継がれること', () => {
    const listIndex = createListIndex(null, 0);
    const pathInfo = getPathInfo('users.*.name');
    const absolutePathInfo = getAbsolutePathInfo(defaultStateElement, pathInfo);
    const absoluteAddress = createAbsoluteStateAddress(absolutePathInfo, listIndex);

    const parent = absoluteAddress.parentAbsoluteAddress;
    expect(parent).not.toBeNull();
    expect(parent!.listIndex).toBe(listIndex);
  });
});
