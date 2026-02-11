import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInnerState } from '../src/webComponent/innerState';
import { getStateElementByName } from '../src/stateElementByName';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { raiseError } from '../src/raiseError';
import { IBindingInfo } from '../src/binding/types';
import { bindSymbol } from '../src/webComponent/symbols';
import { setLoopContextSymbol } from '../src/proxy/symbols';

vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn()
}));

vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn()
}));

vi.mock('../src/raiseError', () => ({
  raiseError: vi.fn((msg) => { throw new Error(msg); })
}));

const getStateElementByNameMock = vi.mocked(getStateElementByName);
const getLoopContextByNodeMock = vi.mocked(getLoopContextByNode);
const raiseErrorMock = vi.mocked(raiseError);

const createMockBinding = (overrides: Partial<IBindingInfo> = {}): IBindingInfo => ({
  propSegments: ['component', 'propName'],
  stateName: 'defaultState',
  statePathName: 'outer.path',
  node: document.createElement('div'),
  replaceNode: document.createElement('div'),
  ...overrides
} as IBindingInfo);

describe('innerState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createInnerStateでインスタンスが作成されること', () => {
    const innerState = createInnerState();
    expect(innerState).toBeDefined();
    expect(typeof innerState[bindSymbol]).toBe('function');
  });

  describe('[bindSymbol]', () => {
    it('プロパティが定義されること', () => {
      const innerState = createInnerState();
      const binding = createMockBinding();
      
      // モックの設定 (getter/setterの初期化時に呼ばれる可能性があるため)
      getStateElementByNameMock.mockReturnValue({ createState: vi.fn() } as any);

      innerState[bindSymbol](binding);
      
      const descriptor = Object.getOwnPropertyDescriptor(innerState, 'propName');
      expect(descriptor).toBeDefined();
      expect(descriptor?.enumerable).toBe(true);
      expect(descriptor?.configurable).toBe(true);
      expect(typeof descriptor?.get).toBe('function');
      expect(typeof descriptor?.set).toBe('function');
    });

    it('getter: 値を取得できること', () => {
      const innerState = createInnerState();
      const binding = createMockBinding({
        propSegments: ['cmp', 'value'],
        stateName: 'myState',
        statePathName: 'data.val'
      });
      const rootNode = binding.replaceNode.getRootNode();

      const stateProxy = {
        [setLoopContextSymbol]: vi.fn((ctx, cb) => cb()),
        'data.val': 'test-value'
      };

      const stateEl = {
        createState: vi.fn((mode, cb) => cb(stateProxy))
      };

      getStateElementByNameMock.mockReturnValue(stateEl as any);
      getLoopContextByNodeMock.mockReturnValue('mockLoopContext' as any);

      innerState[bindSymbol](binding);
      
      const value = innerState.value;

      expect(getStateElementByNameMock).toHaveBeenCalledTimes(2);
      expect(getStateElementByNameMock).toHaveBeenCalledWith(rootNode, 'myState');
      expect(stateEl.createState).toHaveBeenCalledWith('readonly', expect.any(Function));
      expect(getLoopContextByNodeMock).toHaveBeenCalledWith(binding.node);
      expect(stateProxy[setLoopContextSymbol]).toHaveBeenCalledWith('mockLoopContext', expect.any(Function));
      expect(value).toBe('test-value');
    });

    it('getter: State要素が見つからない場合はエラーになること', () => {
      const innerState = createInnerState();
      const binding = createMockBinding({ stateName: 'missing' });

      getStateElementByNameMock.mockReturnValue(null);

      // $$bindは定義時にgetterを作成するが、getterは実行時にエラーになるのではなく、
      // 今回の実装ではgetterFnの実行時(つまり$$bind時)にgetStateElementByNameを呼んでいる
      // ソースを確認すると:
      // const getterFn = (binding) => {
      //   const outerStateElement = getStateElementByName(...)
      //   if (outerStateElement === null) raiseError(...)
      //   return () => { ... }
      // }
      // つまり [bindSymbol] を呼んだ時点でエラーになるはず

      expect(() => innerState[bindSymbol](binding)).toThrow(/State element with name "missing" not found/);
    });

    it('setter: 値を設定できること', () => {
      const innerState = createInnerState();
      const binding = createMockBinding({
        propSegments: ['cmp', 'value'],
        stateName: 'myState',
        statePathName: 'data.val'
      });
      const rootNode = binding.replaceNode.getRootNode();

      const stateProxy = {
        [setLoopContextSymbol]: vi.fn((ctx, cb) => cb()),
        'data.val': 'initial'
      };

      const stateEl = {
        createState: vi.fn((mode, cb) => cb(stateProxy))
      };

      getStateElementByNameMock.mockReturnValue(stateEl as any);
      getLoopContextByNodeMock.mockReturnValue('mockLoopContext' as any);

      innerState[bindSymbol](binding);
      
      innerState.value = 'new-value';

      expect(getStateElementByNameMock).toHaveBeenCalledTimes(2);
      expect(getStateElementByNameMock).toHaveBeenCalledWith(rootNode, 'myState');
      expect(stateEl.createState).toHaveBeenCalledWith('writable', expect.any(Function));
      expect(getLoopContextByNodeMock).toHaveBeenCalledWith(binding.node);
      expect(stateProxy[setLoopContextSymbol]).toHaveBeenCalledWith('mockLoopContext', expect.any(Function));
      
      // プロキシへの代入が行われたか確認
      expect(stateProxy['data.val']).toBe('new-value');
    });

    it('setter: State要素が見つからない場合はエラーになること', () => {
      const innerState = createInnerState();
      const binding = createMockBinding({ stateName: 'missing' });
      
      // getterFn呼び出し時は成功させ、setterFn呼び出し時に失敗させる
      getStateElementByNameMock
        .mockReturnValueOnce({ createState: vi.fn() } as any)
        .mockReturnValueOnce(null);

      expect(() => innerState[bindSymbol](binding)).toThrow(/State element with name "missing" not found/);
    });
  });
});
