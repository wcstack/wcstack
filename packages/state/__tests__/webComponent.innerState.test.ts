import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/webComponent/stateElementByWebComponent', () => ({
  getStateElementByWebComponent: vi.fn()
}));
vi.mock('../src/address/AbsolutePathInfo', () => ({
  getAbsolutePathInfo: vi.fn()
}));
vi.mock('../src/webComponent/MappingRule', () => ({
  getOuterAbsolutePathInfo: vi.fn()
}));
vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn()
}));
vi.mock('../src/address/AbsoluteStateAddress', () => ({
  createAbsoluteStateAddress: vi.fn()
}));
vi.mock('../src/webComponent/lastValueByAbsoluteStateAddress', () => ({
  setLastValueByAbsoluteStateAddress: vi.fn()
}));

import { createInnerState } from '../src/webComponent/innerState';
import { getStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { getOuterAbsolutePathInfo } from '../src/webComponent/MappingRule';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { setLastValueByAbsoluteStateAddress } from '../src/webComponent/lastValueByAbsoluteStateAddress';
import { setLoopContextSymbol } from '../src/proxy/symbols';

const getStateElementByWebComponentMock = vi.mocked(getStateElementByWebComponent);
const getAbsolutePathInfoMock = vi.mocked(getAbsolutePathInfo);
const getOuterAbsolutePathInfoMock = vi.mocked(getOuterAbsolutePathInfo);
const getLoopContextByNodeMock = vi.mocked(getLoopContextByNode);
const createAbsoluteStateAddressMock = vi.mocked(createAbsoluteStateAddress);
const setLastValueMock = vi.mocked(setLastValueByAbsoluteStateAddress);

describe('innerState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  describe('createInnerState', () => {
    it('stateElementがnullの場合はエラーになること', () => {
      const component = document.createElement('div');
      getStateElementByWebComponentMock.mockReturnValue(null);

      expect(() => createInnerState(component, 'state')).toThrow(/State element not found for web component/);
    });

    it('boundComponentStatePropがnullの場合はエラーになること', () => {
      const component = document.createElement('div');
      getStateElementByWebComponentMock.mockReturnValue({
        boundComponentStateProp: null
      } as any);

      expect(() => createInnerState(component, 'state')).toThrow(/not bound to any component state prop/);
    });

    it('boundComponentStatePropがcomponentに存在しない場合はエラーになること', () => {
      const component = document.createElement('div');
      getStateElementByWebComponentMock.mockReturnValue({
        boundComponentStateProp: 'state'
      } as any);

      expect(() => createInnerState(component, 'state')).toThrow(/not bound to a valid component state prop/);
    });

    it('stateがオブジェクトでない場合はエラーになること', () => {
      const component = document.createElement('div') as any;
      component.state = 'not-an-object';
      getStateElementByWebComponentMock.mockReturnValue({
        boundComponentStateProp: 'state'
      } as any);

      expect(() => createInnerState(component, 'state')).toThrow(/Invalid state object/);
    });

    it('stateがnullの場合はエラーになること', () => {
      const component = document.createElement('div') as any;
      component.state = null;
      getStateElementByWebComponentMock.mockReturnValue({
        boundComponentStateProp: 'state'
      } as any);

      expect(() => createInnerState(component, 'state')).toThrow(/Invalid state object/);
    });

    it('正常にProxyが作成されること', () => {
      const component = document.createElement('div') as any;
      component.state = { user: {} };
      getStateElementByWebComponentMock.mockReturnValue({
        boundComponentStateProp: 'state'
      } as any);

      const proxy = createInnerState(component, 'state');
      expect(proxy).toBeDefined();
      expect(typeof proxy).toBe('object');
    });

    it('meltFrozenObjectにより浅いクローンが作成されること', () => {
      const component = document.createElement('div') as any;
      const originalState = { user: { name: 'original' } };
      component.state = originalState;
      getStateElementByWebComponentMock.mockReturnValue({
        boundComponentStateProp: 'state'
      } as any);

      const proxy = createInnerState(component, 'state');
      // meltFrozenObjectは浅いクローンなのでネストされたオブジェクトは同一参照
      expect(proxy['user']).toBe(originalState.user);
    });

    it('フリーズされたstateからProxyが作成できること', () => {
      const component = document.createElement('div') as any;
      component.state = Object.freeze({ count: 0 });
      getStateElementByWebComponentMock.mockReturnValue({
        boundComponentStateProp: 'state'
      } as any);

      const proxy = createInnerState(component, 'state');
      expect(proxy).toBeDefined();
      // meltFrozenObjectによりターゲットは非frozenなので、プロパティに直接アクセス可能
      expect(proxy['count']).toBe(0);
    });

    it('getterを持つフリーズされたstateからProxyが作成でき、getterが保持されること', () => {
      const component = document.createElement('div') as any;
      component.state = Object.freeze({
        get "user.title"() {
          return 'computed';
        }
      });
      getStateElementByWebComponentMock.mockReturnValue({
        boundComponentStateProp: 'state'
      } as any);

      const proxy = createInnerState(component, 'state');
      expect(proxy).toBeDefined();
      // getterがtargetに存在するのでReflect.getで返される
      expect(proxy['user.title']).toBe('computed');
    });
  });

  describe('get trap', () => {
    function createTestProxy() {
      const component = document.createElement('div') as any;
      component.state = {}; // 空オブジェクト（userプロパティは存在しない）
      const innerStateElement = { boundComponentStateProp: 'state' } as any;
      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);
      return { component, proxy: createInnerState(component, 'state') };
    }

    it('文字列プロパティでouter stateの値を取得できること', () => {
      const { component, proxy } = createTestProxy();

      const innerAbsPathInfo = { pathInfo: { path: 'user' } } as any;
      const stateProxy = {
        [setLoopContextSymbol]: vi.fn((_ctx: any, cb: Function) => cb()),
        'users.*': 'test-value'
      };
      const outerAbsPathInfo = {
        stateElement: {
          createState: vi.fn((_mode: string, cb: Function) => cb(stateProxy))
        },
        pathInfo: { path: 'users.*', wildcardCount: 0 }
      } as any;
      const absStateAddress = {} as any;

      getAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);
      getOuterAbsolutePathInfoMock.mockReturnValue(outerAbsPathInfo);
      getLoopContextByNodeMock.mockReturnValue(null);
      createAbsoluteStateAddressMock.mockReturnValue(absStateAddress);

      const value = proxy['user'];

      expect(value).toBe('test-value');
      expect(getOuterAbsolutePathInfoMock).toHaveBeenCalledWith(component, innerAbsPathInfo);
      expect(setLastValueMock).toHaveBeenCalledWith(absStateAddress, 'test-value');
    });

    it('thenプロパティはundefinedを返すこと', () => {
      const { proxy } = createTestProxy();

      expect(proxy['then']).toBeUndefined();
    });

    it('outerAbsPathInfoがnullの場合はエラーになること', () => {
      const { proxy } = createTestProxy();

      getAbsolutePathInfoMock.mockReturnValue({ pathInfo: { path: 'user' } } as any);
      getOuterAbsolutePathInfoMock.mockReturnValue(null);

      expect(() => proxy['user']).toThrow(/Outer path info not found/);
    });

    it('loopContextありでwildcardCountが正の場合はlistIndexが設定されること', () => {
      const { proxy } = createTestProxy();

      const innerAbsPathInfo = {} as any;
      const listIndex = { index: 0 } as any;
      const stateProxy = {
        [setLoopContextSymbol]: vi.fn((_ctx: any, cb: Function) => cb()),
        'users.*.name': 'Alice'
      };
      const outerAbsPathInfo = {
        stateElement: {
          createState: vi.fn((_mode: string, cb: Function) => cb(stateProxy))
        },
        pathInfo: { path: 'users.*.name', wildcardCount: 1 }
      } as any;

      getAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);
      getOuterAbsolutePathInfoMock.mockReturnValue(outerAbsPathInfo);
      getLoopContextByNodeMock.mockReturnValue({
        listIndex: { at: vi.fn(() => listIndex) }
      } as any);
      createAbsoluteStateAddressMock.mockReturnValue({} as any);

      proxy['user.name'];

      expect(createAbsoluteStateAddressMock).toHaveBeenCalledWith(outerAbsPathInfo, listIndex);
    });

    it('loopContextがnullの場合はlistIndexがnullのままであること', () => {
      const { proxy } = createTestProxy();

      const stateProxy = {
        [setLoopContextSymbol]: vi.fn((_ctx: any, cb: Function) => cb()),
        'users.*': 'value'
      };
      const outerAbsPathInfo = {
        stateElement: {
          createState: vi.fn((_mode: string, cb: Function) => cb(stateProxy))
        },
        pathInfo: { path: 'users.*', wildcardCount: 1 }
      } as any;

      getAbsolutePathInfoMock.mockReturnValue({} as any);
      getOuterAbsolutePathInfoMock.mockReturnValue(outerAbsPathInfo);
      getLoopContextByNodeMock.mockReturnValue(null);
      createAbsoluteStateAddressMock.mockReturnValue({} as any);

      proxy['user'];

      expect(createAbsoluteStateAddressMock).toHaveBeenCalledWith(outerAbsPathInfo, null);
    });

    it('loopContextありでwildcardCountが0の場合はlistIndexがnullのままであること', () => {
      const { proxy } = createTestProxy();

      const stateProxy = {
        [setLoopContextSymbol]: vi.fn((_ctx: any, cb: Function) => cb()),
        'userName': 'Bob'
      };
      const outerAbsPathInfo = {
        stateElement: {
          createState: vi.fn((_mode: string, cb: Function) => cb(stateProxy))
        },
        pathInfo: { path: 'userName', wildcardCount: 0 }
      } as any;

      getAbsolutePathInfoMock.mockReturnValue({} as any);
      getOuterAbsolutePathInfoMock.mockReturnValue(outerAbsPathInfo);
      getLoopContextByNodeMock.mockReturnValue({
        listIndex: { at: vi.fn() }
      } as any);
      createAbsoluteStateAddressMock.mockReturnValue({} as any);

      proxy['userName'];

      expect(createAbsoluteStateAddressMock).toHaveBeenCalledWith(outerAbsPathInfo, null);
    });

    it('Symbolプロパティの場合はReflect.getを使用すること', () => {
      const { proxy } = createTestProxy();

      const sym = Symbol('test');
      expect(proxy[sym]).toBeUndefined();
    });

    it('targetに存在するプロパティはReflect.getで返すこと', () => {
      const component = document.createElement('div') as any;
      component.state = { existingProp: 'value' };
      const innerStateElement = { boundComponentStateProp: 'state' } as any;
      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);

      const proxy = createInnerState(component, 'state');

      expect(proxy['existingProp']).toBe('value');
    });

    it('$で始まるプロパティはundefinedを返すこと', () => {
      const { proxy } = createTestProxy();

      expect(proxy['$someMethod']).toBeUndefined();
      expect(proxy['$postUpdate']).toBeUndefined();
    });
  });

  describe('has trap', () => {
    function createTestProxy() {
      const component = document.createElement('div') as any;
      component.state = {};
      const innerStateElement = { boundComponentStateProp: 'state' } as any;
      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);
      return { component, proxy: createInnerState(component, 'state') };
    }

    it('targetに存在するプロパティはtrueを返すこと', () => {
      const component = document.createElement('div') as any;
      component.state = { existingProp: 'value' };
      const innerStateElement = { boundComponentStateProp: 'state' } as any;
      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);

      const proxy = createInnerState(component, 'state');

      expect('existingProp' in proxy).toBe(true);
    });

    it('$で始まるプロパティはfalseを返すこと', () => {
      const { proxy } = createTestProxy();

      expect('$someMethod' in proxy).toBe(false);
      expect('$postUpdate' in proxy).toBe(false);
    });

    it('outerAbsPathInfoが見つかる場合はtrueを返すこと', () => {
      const { component, proxy } = createTestProxy();

      const innerAbsPathInfo = { pathInfo: { path: 'user' } } as any;
      const outerAbsPathInfo = { pathInfo: { path: 'users.*' } } as any;

      getAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);
      getOuterAbsolutePathInfoMock.mockReturnValue(outerAbsPathInfo);

      expect('user' in proxy).toBe(true);
    });

    it('outerAbsPathInfoがnullの場合はfalseを返すこと', () => {
      const { proxy } = createTestProxy();

      getAbsolutePathInfoMock.mockReturnValue({ pathInfo: { path: 'unknown' } } as any);
      getOuterAbsolutePathInfoMock.mockReturnValue(null);

      expect('unknown' in proxy).toBe(false);
    });

    it('Symbolプロパティの場合はReflect.hasを使用すること', () => {
      const { proxy } = createTestProxy();

      const sym = Symbol('test');
      expect(sym in proxy).toBe(false);
    });
  });

  describe('set trap', () => {
    function createTestProxy() {
      const component = document.createElement('div') as any;
      component.state = {}; // 空オブジェクト（userプロパティは存在しない）
      const innerStateElement = { boundComponentStateProp: 'state' } as any;
      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);
      return { component, proxy: createInnerState(component, 'state') };
    }

    it('文字列プロパティでouter stateに値を設定できること', () => {
      const { proxy } = createTestProxy();

      const innerAbsPathInfo = {} as any;
      const stateProxy = {
        [setLoopContextSymbol]: vi.fn((_ctx: any, cb: Function) => cb()),
        'users.*': undefined as any,
      };
      const outerAbsPathInfo = {
        stateElement: {
          createState: vi.fn((_mode: string, cb: Function) => cb(stateProxy))
        },
        pathInfo: { path: 'users.*' }
      } as any;

      getAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);
      getOuterAbsolutePathInfoMock.mockReturnValue(outerAbsPathInfo);
      getLoopContextByNodeMock.mockReturnValue(null);

      proxy['user'] = 'new-value';

      expect(outerAbsPathInfo.stateElement.createState).toHaveBeenCalledWith('writable', expect.any(Function));
      expect(stateProxy['users.*']).toBe('new-value');
    });

    it('outerAbsPathInfoがnullの場合はエラーになること', () => {
      const { proxy } = createTestProxy();

      getAbsolutePathInfoMock.mockReturnValue({ pathInfo: { path: 'user' } } as any);
      getOuterAbsolutePathInfoMock.mockReturnValue(null);

      expect(() => { proxy['user'] = 'value'; }).toThrow(/Outer path info not found/);
    });

    it('Symbolプロパティの場合はReflect.setを使用すること', () => {
      const { proxy } = createTestProxy();

      const sym = Symbol('test');
      proxy[sym] = 'value';
      expect(proxy[sym]).toBe('value');
    });
  });
});
