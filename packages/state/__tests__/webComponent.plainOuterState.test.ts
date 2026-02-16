import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/webComponent/stateElementByWebComponent', () => ({
  getStateElementByWebComponent: vi.fn()
}));

import { createPlainOuterState } from '../src/webComponent/plainOuterState';
import { getStateElementByWebComponent } from '../src/webComponent/stateElementByWebComponent';
import { getByAddressSymbol, setByAddressSymbol } from '../src/proxy/symbols';

const getStateElementByWebComponentMock = vi.mocked(getStateElementByWebComponent);

describe('plainOuterState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('createPlainOuterStateでProxyが作成されること', () => {
    const component = document.createElement('div');
    document.body.appendChild(component);
    getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);

    const outerState = createPlainOuterState(component, 'state');
    expect(outerState).toBeDefined();
    expect(typeof outerState).toBe('object');
  });

  it('getStateElementByWebComponentがnullの場合はエラーになること', () => {
    const component = document.createElement('div');
    getStateElementByWebComponentMock.mockReturnValue(null);

    expect(() => createPlainOuterState(component, 'state')).toThrow();
  });

  describe('get trap', () => {
    it('文字列プロパティでcreateState経由で値を取得できること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);

      const mockGetByAddress = vi.fn().mockReturnValue(42);
      const stateProxy = {
        [getByAddressSymbol]: mockGetByAddress
      };
      const innerStateElement = {
        name: 'default',
        createState: vi.fn((_mode: string, cb: Function) => cb(stateProxy))
      } as any;
      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);

      const outerState = createPlainOuterState(component, 'state');
      const value = outerState['count'];

      expect(value).toBe(42);
      expect(innerStateElement.createState).toHaveBeenCalledWith('readonly', expect.any(Function));
      expect(mockGetByAddress).toHaveBeenCalledWith(
        expect.objectContaining({
          pathInfo: expect.objectContaining({ path: 'count' }),
          listIndex: null
        })
      );
    });

    it('Symbolプロパティの場合はReflect.getを使用すること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);

      const outerState = createPlainOuterState(component, 'state');
      const sym = Symbol('test');
      expect(outerState[sym]).toBeUndefined();
    });
  });

  describe('set trap', () => {
    it('文字列プロパティでcreateState経由で値を設定できること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);

      const mockSetByAddress = vi.fn();
      const stateProxy = {
        [setByAddressSymbol]: mockSetByAddress
      };
      const innerStateElement = {
        name: 'default',
        createState: vi.fn((_mode: string, cb: Function) => cb(stateProxy))
      } as any;
      getStateElementByWebComponentMock.mockReturnValue(innerStateElement);

      const outerState = createPlainOuterState(component, 'state');
      outerState['value'] = 'new-value';

      expect(innerStateElement.createState).toHaveBeenCalledWith('writable', expect.any(Function));
      expect(mockSetByAddress).toHaveBeenCalledWith(
        expect.objectContaining({
          pathInfo: expect.objectContaining({ path: 'value' }),
          listIndex: null
        }),
        'new-value'
      );
    });

    it('Symbolプロパティの場合はReflect.setを使用すること', () => {
      const component = document.createElement('div');
      document.body.appendChild(component);
      getStateElementByWebComponentMock.mockReturnValue({ name: 'default' } as any);

      const outerState = createPlainOuterState(component, 'state');
      const sym = Symbol('test');
      outerState[sym] = 'value';
      expect(outerState[sym]).toBe('value');
    });
  });
});
