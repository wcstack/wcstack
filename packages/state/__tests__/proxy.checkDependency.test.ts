import { describe, it, expect, vi } from 'vitest';
import { checkDependency } from '../src/proxy/methods/checkDependency';
import { getPathInfo } from '../src/address/PathInfo';

function createHandler(overrides?: Partial<any>): any {
  return {
    addressStackIndex: -1,
    lastAddressStack: null,
    stateElement: {
      getterPaths: new Set<string>(),
      setterPaths: new Set<string>(),
      addDynamicDependency: vi.fn(),
    },
    ...overrides,
  };
}

describe('checkDependency', () => {
  it('addressStackIndexが負なら何もしないこと', () => {
    const handler = createHandler();
    const address = { pathInfo: getPathInfo('users.*.name') } as any;

    checkDependency(handler, address);
    expect(handler.stateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('lastAddressStackがnullなら何もしないこと', () => {
    const handler = createHandler({ addressStackIndex: 0, lastAddressStack: null });
    const address = { pathInfo: getPathInfo('users.*.name') } as any;

    checkDependency(handler, address);
    expect(handler.stateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('getterPathsに含まれない場合は依存関係を登録しないこと', () => {
    const lastInfo = getPathInfo('users.*.profile');
    const handler = createHandler({
      addressStackIndex: 0,
      lastAddressStack: { pathInfo: lastInfo },
    });
    const address = { pathInfo: getPathInfo('users.*.name') } as any;

    checkDependency(handler, address);
    expect(handler.stateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('同一パスの場合は依存関係を登録しないこと', () => {
    const lastInfo = getPathInfo('users.*.name');
    const handler = createHandler({
      addressStackIndex: 0,
      lastAddressStack: { pathInfo: lastInfo },
      stateElement: {
        getterPaths: new Set<string>([lastInfo.path]),
        addDynamicDependency: vi.fn(),
      },
    });
    const address = { pathInfo: getPathInfo('users.*.name') } as any;

    checkDependency(handler, address);
    expect(handler.stateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('getterPathsに含まれ、異なるパスなら依存関係を登録すること', () => {
    const lastInfo = getPathInfo('users.*.profile');
    const handler = createHandler({
      addressStackIndex: 0,
      lastAddressStack: { pathInfo: lastInfo },
      stateElement: {
        getterPaths: new Set<string>([lastInfo.path]),
        addDynamicDependency: vi.fn(),
      },
    });
    const address = { pathInfo: getPathInfo('users.*.name') } as any;

    checkDependency(handler, address);
    expect(handler.stateElement.addDynamicDependency).toHaveBeenCalledWith(
      'users.*.name',
      lastInfo.path
    );
  });
});
