import { describe, it, expect, vi } from 'vitest';
import { trackDependency } from '../src/proxy/apis/trackDependency';
import { getPathInfo } from '../src/address/PathInfo';

function createHandler(overrides?: Partial<any>): any {
  return {
    addressStackLength: 0,
    lastAddressStack: null,
    stateElement: {
      getterPaths: new Set<string>(),
      addDynamicDependency: vi.fn(),
    },
    ...overrides,
  };
}

describe('trackDependency', () => {
  it('addressStackLengthが0の場合エラーになること', () => {
    const handler = createHandler({ addressStackLength: 0 });
    const fn = trackDependency({}, 'prop', undefined, handler);
    expect(() => fn('some.path')).toThrow(/No active state reference/);
  });

  it('lastAddressStackがnullの場合エラーになること', () => {
    const handler = createHandler({
      addressStackLength: 1,
      lastAddressStack: null,
    });
    const fn = trackDependency({}, 'prop', undefined, handler);
    expect(() => fn('some.path')).toThrow(/Internal error/);
  });

  it('getterPathsに含まれない場合は依存を登録しないこと', () => {
    const lastInfo = getPathInfo('users.*.profile');
    const handler = createHandler({
      addressStackLength: 1,
      lastAddressStack: { pathInfo: lastInfo },
    });
    const fn = trackDependency({}, 'prop', undefined, handler);
    fn('users.*.name');
    expect(handler.stateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('同一パスの場合は依存を登録しないこと', () => {
    const lastInfo = getPathInfo('users.*.name');
    const handler = createHandler({
      addressStackLength: 1,
      lastAddressStack: { pathInfo: lastInfo },
      stateElement: {
        getterPaths: new Set<string>([lastInfo.path]),
        addDynamicDependency: vi.fn(),
      },
    });
    const fn = trackDependency({}, 'prop', undefined, handler);
    fn('users.*.name');
    expect(handler.stateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('異なるパスでgetterPathsに含まれる場合は依存を登録すること', () => {
    const lastInfo = getPathInfo('users.*.profile');
    const handler = createHandler({
      addressStackLength: 1,
      lastAddressStack: { pathInfo: lastInfo },
      stateElement: {
        getterPaths: new Set<string>([lastInfo.path]),
        addDynamicDependency: vi.fn(),
      },
    });
    const fn = trackDependency({}, 'prop', undefined, handler);
    fn('users.*.name');
    expect(handler.stateElement.addDynamicDependency).toHaveBeenCalledWith('users.*.name', lastInfo.path);
  });
});
