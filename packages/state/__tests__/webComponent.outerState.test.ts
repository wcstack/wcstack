import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/webComponent/stateElementByWebComponent', () => ({
  getStateElementByWebComponent: vi.fn()
}));
vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn()
}));
vi.mock('../src/address/AbsolutePathInfo', () => ({
  getAbsolutePathInfo: vi.fn()
}));
vi.mock('../src/webComponent/MappingRule', () => ({
  getInnerAbsolutePathInfo: vi.fn()
}));
vi.mock('../src/address/AbsoluteStateAddress', () => ({
  createAbsoluteStateAddress: vi.fn()
}));
vi.mock('../src/webComponent/lastValueByAbsoluteStateAddress', () => ({
  getLastValueByAbsoluteStateAddress: vi.fn()
}));

import { createOuterState } from '../src/webComponent/outerState';
import { getStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { getStateElementByName } from '../src/stateElementByName';
import { getAbsolutePathInfo } from '../src/address/AbsolutePathInfo';
import { getInnerAbsolutePathInfo } from '../src/webComponent/MappingRule';
import { createAbsoluteStateAddress } from '../src/address/AbsoluteStateAddress';
import { getLastValueByAbsoluteStateAddress } from '../src/webComponent/lastValueByAbsoluteStateAddress';

const getStateElementByWebComponentMock = vi.mocked(getStateElementByWebComponent);
const getStateElementByNameMock = vi.mocked(getStateElementByName);
const getAbsolutePathInfoMock = vi.mocked(getAbsolutePathInfo);
const getInnerAbsolutePathInfoMock = vi.mocked(getInnerAbsolutePathInfo);
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

    const outerState = createOuterState(component);
    expect(outerState).toBeDefined();
    expect(typeof outerState).toBe('object');
  });

  it('getStateElementByWebComponentがnullの場合はエラーになること', () => {
    const component = document.createElement('div');
    getStateElementByWebComponentMock.mockReturnValue(null);

    expect(() => createOuterState(component)).toThrow();
  });

  describe('get trap', () => {
    it('文字列プロパティで値を取得できること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);

      const outerStateElement = { name: 'default' } as any;
      const outerAbsPathInfo = { pathInfo: { path: 'count' } } as any;
      const innerAbsPathInfo = { pathInfo: { path: 'count' } } as any;
      const absStateAddress = {} as any;

      getStateElementByNameMock.mockReturnValue(outerStateElement);
      getAbsolutePathInfoMock.mockReturnValue(outerAbsPathInfo);
      getInnerAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);
      createAbsoluteStateAddressMock.mockReturnValue(absStateAddress);
      getLastValueMock.mockReturnValue(42);

      const outerState = createOuterState(component);
      const value = outerState['count'];

      expect(value).toBe(42);
      expect(getStateElementByNameMock).toHaveBeenCalledWith(expect.anything(), 'default');
      expect(getInnerAbsolutePathInfoMock).toHaveBeenCalledWith(component, outerAbsPathInfo);
      expect(createAbsoluteStateAddressMock).toHaveBeenCalledWith(innerAbsPathInfo, null);
      expect(getLastValueMock).toHaveBeenCalledWith(absStateAddress);
    });

    it('@stateName付きプロパティで異なるstate名を使用できること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);

      getStateElementByNameMock.mockReturnValue({ name: 'custom' } as any);
      getAbsolutePathInfoMock.mockReturnValue({} as any);
      getInnerAbsolutePathInfoMock.mockReturnValue({ pathInfo: { path: 'value' } } as any);
      createAbsoluteStateAddressMock.mockReturnValue({} as any);
      getLastValueMock.mockReturnValue('value');

      const outerState = createOuterState(component);
      outerState['count@custom'];

      expect(getStateElementByNameMock).toHaveBeenCalledWith(expect.anything(), 'custom');
    });

    it('stateElementが見つからない場合はエラーになること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);
      getStateElementByNameMock.mockReturnValue(null);

      const outerState = createOuterState(component);
      expect(() => outerState['count']).toThrow(/State element with name "default" not found/);
    });

    it('innerAbsPathInfoがnullの場合はエラーになること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);
      getStateElementByNameMock.mockReturnValue({} as any);
      getAbsolutePathInfoMock.mockReturnValue({ pathInfo: { path: 'count' } } as any);
      getInnerAbsolutePathInfoMock.mockReturnValue(null);

      const outerState = createOuterState(component);
      expect(() => outerState['count']).toThrow(/Inner path info not found/);
    });

    it('Symbolプロパティの場合はReflect.getを使用すること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);

      const outerState = createOuterState(component);
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

      const outerAbsPathInfo = {} as any;
      const innerAbsPathInfo = { pathInfo: { path: 'value' } } as any;

      getStateElementByNameMock.mockReturnValue({ name: 'default' } as any);
      getAbsolutePathInfoMock.mockReturnValue(outerAbsPathInfo);
      getInnerAbsolutePathInfoMock.mockReturnValue(innerAbsPathInfo);

      const outerState = createOuterState(component);
      outerState['value'] = 'new-value';

      expect(innerStateElement.createState).toHaveBeenCalledWith('readonly', expect.any(Function));
      expect(stateProxy.$postUpdate).toHaveBeenCalledWith('value');
    });

    it('set trapでstateElementが見つからない場合はエラーになること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);
      getStateElementByNameMock.mockReturnValue(null);

      const outerState = createOuterState(component);
      expect(() => { outerState['count'] = 1; }).toThrow(/State element with name "default" not found/);
    });

    it('set trapでinnerAbsPathInfoがnullの場合はエラーになること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);
      getStateElementByNameMock.mockReturnValue({} as any);
      getAbsolutePathInfoMock.mockReturnValue({} as any);
      getInnerAbsolutePathInfoMock.mockReturnValue(null);

      const outerState = createOuterState(component);
      expect(() => { outerState['count'] = 1; }).toThrow(/Inner path info not found/);
    });

    it('Symbolプロパティの場合はReflect.setを使用すること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);

      const outerState = createOuterState(component);
      const sym = Symbol('test');
      outerState[sym] = 'value';
      expect(outerState[sym]).toBe('value');
    });
  });
});
