import { describe, it, expect, vi } from 'vitest';
import { checkDependency } from '../src/proxy/methods/checkDependency';
import { getPathInfo } from '../src/address/PathInfo';

function createHandler(overrides?: Partial<any>): any {
  return {
    addressStackLength: 0,
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
  it('addressStackLengthが0なら何もしないこと', () => {
    const handler = createHandler();
    const address = { pathInfo: getPathInfo('users.*.name') } as any;

    checkDependency(handler, address);
    expect(handler.stateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('lastAddressStackがnullなら何もしないこと', () => {
    const handler = createHandler({ addressStackLength: 1, lastAddressStack: null });
    const address = { pathInfo: getPathInfo('users.*.name') } as any;

    checkDependency(handler, address);
    expect(handler.stateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('getterPathsに含まれない場合は依存関係を登録しないこと', () => {
    const lastInfo = getPathInfo('users.*.profile');
    const handler = createHandler({
      addressStackLength: 1,
      lastAddressStack: { pathInfo: lastInfo },
    });
    const address = { pathInfo: getPathInfo('users.*.name') } as any;

    checkDependency(handler, address);
    expect(handler.stateElement.addDynamicDependency).not.toHaveBeenCalled();
  });

  it('同一パスの場合は依存関係を登録しないこと', () => {
    const lastInfo = getPathInfo('users.*.name');
    const handler = createHandler({
      addressStackLength: 1,
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
      addressStackLength: 1,
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

  describe('他行読み取り（cross-row）の検出', () => {
    // IListIndex の at() だけを模す（トップレベルの listIndex は自分自身を返す）
    function makeRowIndex(): any {
      const row: any = { at: () => row };
      return row;
    }

    function createGetterHandler(getterPath: string, getterListIndex: any) {
      const lastInfo = getPathInfo(getterPath);
      return createHandler({
        addressStackLength: 1,
        lastAddressStack: { pathInfo: lastInfo, listIndex: getterListIndex },
        stateElement: {
          getterPaths: new Set<string>([lastInfo.path]),
          addDynamicDependency: vi.fn(),
          addCrossRowListPath: vi.fn(),
        },
      });
    }

    it('別の行を読んだ場合は共有リストパスを登録すること', () => {
      const rowA = makeRowIndex();
      const rowB = makeRowIndex();
      const handler = createGetterHandler('items.*.diff', rowA);
      const address = { pathInfo: getPathInfo('items.*.value'), listIndex: rowB } as any;

      checkDependency(handler, address);
      expect(handler.stateElement.addCrossRowListPath).toHaveBeenCalledWith('items');
    });

    it('自行の読み取りでは登録しないこと', () => {
      const row = makeRowIndex();
      const handler = createGetterHandler('items.*.diff', row);
      const address = { pathInfo: getPathInfo('items.*.value'), listIndex: row } as any;

      checkDependency(handler, address);
      expect(handler.stateElement.addCrossRowListPath).not.toHaveBeenCalled();
    });

    it('ワイルドカードを共有しない読み取りでは登録しないこと（スカラー読み）', () => {
      const row = makeRowIndex();
      const handler = createGetterHandler('items.*.selected', row);
      const address = { pathInfo: getPathInfo('selectedIndex'), listIndex: null } as any;

      checkDependency(handler, address);
      expect(handler.stateElement.addCrossRowListPath).not.toHaveBeenCalled();
      // 動的依存自体は登録される
      expect(handler.stateElement.addDynamicDependency).toHaveBeenCalledWith(
        'selectedIndex',
        'items.*.selected'
      );
    });

    it('別リストの行を読んだ場合は登録しないこと（コンテナエッジが担う）', () => {
      const rowA = makeRowIndex();
      const rowB = makeRowIndex();
      const handler = createGetterHandler('items.*.x', rowA);
      const address = { pathInfo: getPathInfo('others.*.y'), listIndex: rowB } as any;

      checkDependency(handler, address);
      expect(handler.stateElement.addCrossRowListPath).not.toHaveBeenCalled();
    });

    it('addCrossRowListPath 未実装のモックでも落ちないこと', () => {
      const rowA = makeRowIndex();
      const rowB = makeRowIndex();
      const lastInfo = getPathInfo('items.*.diff');
      const handler = createHandler({
        addressStackLength: 1,
        lastAddressStack: { pathInfo: lastInfo, listIndex: rowA },
        stateElement: {
          getterPaths: new Set<string>([lastInfo.path]),
          addDynamicDependency: vi.fn(),
        },
      });
      const address = { pathInfo: getPathInfo('items.*.value'), listIndex: rowB } as any;

      expect(() => checkDependency(handler, address)).not.toThrow();
    });
  });
});
