import { describe, it, expect } from 'vitest';
import {
  getCacheEntryByAbsoluteStateAddress,
  setCacheEntryByAbsoluteStateAddress,
  dirtyCacheEntryByAbsoluteStateAddress
} from '../src/cache/cacheEntryByAbsoluteStateAddress';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { getPathInfo } from '../src/address/PathInfo';
import type { IStateElement } from '../src/components/types';

const defaultStateElement = { name: 'default' } as IStateElement;

function createAddress(path: string) {
  const pathInfo = getPathInfo(path);
  const absPathInfo = getAbsolutePathInfo(defaultStateElement, pathInfo);
  return createAbsoluteStateAddress(absPathInfo, null);
}

describe('cacheEntryByAbsoluteStateAddress', () => {
  it('エントリがない場合はnullを返すこと', () => {
    const addr = createAddress('noentry');
    expect(getCacheEntryByAbsoluteStateAddress(addr)).toBeNull();
  });

  it('エントリをセットして取得できること', () => {
    const addr = createAddress('foo');
    setCacheEntryByAbsoluteStateAddress(addr, { value: 42, dirty: false });
    const entry = getCacheEntryByAbsoluteStateAddress(addr);
    expect(entry).not.toBeNull();
    expect(entry!.value).toBe(42);
    expect(entry!.dirty).toBe(false);
    // クリーンアップ
    setCacheEntryByAbsoluteStateAddress(addr, null);
  });

  it('nullをセットするとエントリが削除されること', () => {
    const addr = createAddress('bar');
    setCacheEntryByAbsoluteStateAddress(addr, { value: 1, dirty: false });
    setCacheEntryByAbsoluteStateAddress(addr, null);
    expect(getCacheEntryByAbsoluteStateAddress(addr)).toBeNull();
  });

  it('dirtyCacheEntryByAbsoluteStateAddressでdirtyがtrueになること', () => {
    const addr = createAddress('baz');
    setCacheEntryByAbsoluteStateAddress(addr, { value: 10, dirty: false });
    dirtyCacheEntryByAbsoluteStateAddress(addr);
    const entry = getCacheEntryByAbsoluteStateAddress(addr);
    expect(entry!.dirty).toBe(true);
    // クリーンアップ
    setCacheEntryByAbsoluteStateAddress(addr, null);
  });

  it('エントリがない場合はdirtyは何もしないこと', () => {
    const addr = createAddress('notexist');
    // エラーにならないこと
    dirtyCacheEntryByAbsoluteStateAddress(addr);
    expect(getCacheEntryByAbsoluteStateAddress(addr)).toBeNull();
  });
});
