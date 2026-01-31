import { describe, it, expect } from 'vitest';
import { getContextListIndex } from '../src/proxy/methods/getContextListIndex';
import { createListIndex } from '../src/list/createListIndex';
import { getPathInfo } from '../src/address/PathInfo';
import { createStateAddress } from '../src/address/StateAddress';

function createHandler(overrides?: Partial<any>) {
  return {
    lastAddressStack: null,
    ...overrides,
  };
}

describe('getContextListIndex', () => {
  it('lastAddressStackがnullならnullを返すこと', () => {
    const handler = createHandler();
    expect(getContextListIndex(handler as any, 'users.*')).toBeNull();
  });

  it('pathInfoがnullならnullを返すこと', () => {
    const handler = createHandler({ lastAddressStack: { pathInfo: null } });
    expect(getContextListIndex(handler as any, 'users.*')).toBeNull();
  });

  it('listIndexがnullならnullを返すこと', () => {
    const pathInfo = getPathInfo('users.*');
    const handler = createHandler({ lastAddressStack: { pathInfo, listIndex: null } });
    expect(getContextListIndex(handler as any, 'users.*')).toBeNull();
  });

  it('structuredPathが見つからない場合はnullを返すこと', () => {
    const listIndex = createListIndex(null, 0);
    const address = createStateAddress(getPathInfo('users.*.orders.*'), listIndex);
    const handler = createHandler({ lastAddressStack: address });

    expect(getContextListIndex(handler as any, 'users.*.missing')).toBeNull();
  });

  it('structuredPathに対応するlistIndexを返すこと', () => {
    const rootIndex = createListIndex(null, 0);
    const childIndex = createListIndex(rootIndex, 1);
    const address = createStateAddress(getPathInfo('users.*.orders.*.id'), childIndex);
    const handler = createHandler({ lastAddressStack: address });

    const result = getContextListIndex(handler as any, 'users.*.orders.*');
    expect(result).toBe(childIndex);
  });
});
