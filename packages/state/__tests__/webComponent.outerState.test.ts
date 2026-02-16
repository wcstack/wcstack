import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/webComponent/stateElementByWebComponent', () => ({
  getStateElementByWebComponent: vi.fn()
}));
vi.mock('../src/address/AbsolutePathInfo', () => ({
  getAbsolutePathInfo: vi.fn()
}));
vi.mock('../src/address/AbsoluteStateAddress', () => ({
  createAbsoluteStateAddress: vi.fn()
}));
vi.mock('../src/webComponent/lastValueByAbsoluteStateAddress', () => ({
  getLastValueByAbsoluteStateAddress: vi.fn()
}));

import { createOuterState } from '../src/webComponent/outerState';
import { getStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { getLastValueByAbsoluteStateAddress } from '../src/webComponent/lastValueByAbsoluteStateAddress';

const getStateElementByWebComponentMock = vi.mocked(getStateElementByWebComponent);
const getAbsolutePathInfoMock = vi.mocked(getAbsolutePathInfo);
const createAbsoluteStateAddressMock = vi.mocked(createAbsoluteStateAddress);
const getLastValueMock = vi.mocked(getLastValueByAbsoluteStateAddress);

describe('outerState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('createOuterStateでProxyが作成されること', () => {
    const component = document.createElement('div');
    document.body.appendChild(component);
    getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);

    const outerState = createOuterState(component, 'state');
    expect(outerState).toBeDefined();
    expect(typeof outerState).toBe('object');
  });

  it('getStateElementByWebComponentがnullの場合はエラーになること', () => {
    const component = document.createElement('div');
    getStateElementByWebComponentMock.mockReturnValue(null);

    expect(() => createOuterState(component, 'state')).toThrow();
  });

  describe('get trap', () => {
    it('文字列プロパティで値を取得できること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      const innerStateElement = { name: 'default' } as any;
      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);

      const innerAbsPathInfo = { pathInfo: { path: 'count' } } as any;
      const absStateAddress = {} as any;

      getAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);
      createAbsoluteStateAddressMock.mockReturnValue(absStateAddress);
      getLastValueMock.mockReturnValue(42);

      const outerState = createOuterState(component, 'state');
      const value = outerState['count'];

      expect(value).toBe(42);
      expect(getAbsolutePathInfoMock).toHaveBeenCalledWith(innerStateElement, expect.objectContaining({ path: 'count' }));
      expect(createAbsoluteStateAddressMock).toHaveBeenCalledWith(innerAbsPathInfo, null);
      expect(getLastValueMock).toHaveBeenCalledWith(absStateAddress);
    });

    it('Symbolプロパティの場合はReflect.getを使用すること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);

      const outerState = createOuterState(component, 'state');
      const sym = Symbol('test');
      expect(outerState[sym]).toBeUndefined();
    });
  });

  describe('set trap', () => {
    it('文字列プロパティで$postUpdateが呼び出されること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      const stateProxy = { $postUpdate: vi.fn() };
      const innerStateElement = {
        name: 'default',
        createState: vi.fn((_mode: string, cb: Function) => cb(stateProxy))
      } as any;
      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);

      const innerAbsPathInfo = { pathInfo: { path: 'value' } } as any;
      getAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);

      const outerState = createOuterState(component, 'state');
      outerState['value'] = 'new-value';

      expect(innerStateElement.createState).toHaveBeenCalledWith('readonly', expect.any(Function));
      expect(stateProxy.$postUpdate).toHaveBeenCalledWith('value');
    });

    it('Symbolプロパティの場合はReflect.setを使用すること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);

      const outerState = createOuterState(component, 'state');
      const sym = Symbol('test');
      outerState[sym] = 'value';
      expect(outerState[sym]).toBe('value');
    });
  });
});
