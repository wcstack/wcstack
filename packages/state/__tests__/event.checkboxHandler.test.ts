import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IBindingInfo } from '../src/types';

vi.mock('../src/stateElementByName', () => ({
  getStateElementByName: vi.fn(),
}));

vi.mock('../src/list/loopContextByNode', () => ({
  getLoopContextByNode: vi.fn(),
}));

vi.mock('../src/raiseError', () => ({
  raiseError: vi.fn(),
}));

import { attachCheckboxEventHandler, detachCheckboxEventHandler, __private__ } from '../src/event/checkboxHandler';
import { getPathInfo } from '../src/address/PathInfo';
import { getStateElementByName } from '../src/stateElementByName';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { raiseError } from '../src/raiseError';
import { setLoopContextSymbol } from '../src/proxy/symbols';

const getStateElementByNameMock = vi.mocked(getStateElementByName);
const getLoopContextByNodeMock = vi.mocked(getLoopContextByNode);
const raiseErrorMock = vi.mocked(raiseError);

function createCheckboxBinding(node: Element, overrides?: Partial<IBindingInfo>): IBindingInfo {
  return {
    propName: 'checkbox',
    propSegments: ['checkbox'],
    propModifiers: [],
    statePathName: 'selected',
    statePathInfo: getPathInfo('selected'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'checkbox',
    uuid: null,
    node,
    replaceNode: node,
    ...overrides,
  } as IBindingInfo;
}

describe('event/checkboxHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __private__.handlerByHandlerKey.clear();
    __private__.bindingSetByHandlerKey.clear();
  });

  describe('attachCheckboxEventHandler', () => {
    it('checkbox bindingTypeでイベントを登録し、trueを返すこと', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      const binding = createCheckboxBinding(input);

      const result = attachCheckboxEventHandler(binding);

      expect(result).toBe(true);
      expect(__private__.handlerByHandlerKey.size).toBe(1);
      expect(__private__.bindingSetByHandlerKey.size).toBe(1);
    });

    it('checkbox以外のbindingTypeはfalseを返すこと', () => {
      const input = document.createElement('input');
      const binding = createCheckboxBinding(input, { bindingType: 'prop' });

      const result = attachCheckboxEventHandler(binding);

      expect(result).toBe(false);
      expect(__private__.handlerByHandlerKey.size).toBe(0);
    });

    it('roモディファイアがある場合はfalseを返すこと', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      const binding = createCheckboxBinding(input, { propModifiers: ['ro'] });

      const result = attachCheckboxEventHandler(binding);

      expect(result).toBe(false);
    });

    it('同じキーの2つ目のバインディングはハンドラを再利用すること', () => {
      const input1 = document.createElement('input');
      input1.type = 'checkbox';
      const input2 = document.createElement('input');
      input2.type = 'checkbox';
      const binding1 = createCheckboxBinding(input1);
      const binding2 = createCheckboxBinding(input2);

      attachCheckboxEventHandler(binding1);
      attachCheckboxEventHandler(binding2);

      expect(__private__.handlerByHandlerKey.size).toBe(1);
      const bindingSet = [...__private__.bindingSetByHandlerKey.values()][0];
      expect(bindingSet.size).toBe(2);
    });

    it('onchangeモディファイアでイベント名がchangeになること', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      const addSpy = vi.spyOn(input, 'addEventListener');
      const binding = createCheckboxBinding(input, { propModifiers: ['onchange'] });

      attachCheckboxEventHandler(binding);

      expect(addSpy).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('detachCheckboxEventHandler', () => {
    it('登録済みのハンドラを解除し、trueを返すこと', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      const binding = createCheckboxBinding(input);

      attachCheckboxEventHandler(binding);
      const result = detachCheckboxEventHandler(binding);

      expect(result).toBe(true);
      expect(__private__.handlerByHandlerKey.size).toBe(0);
      expect(__private__.bindingSetByHandlerKey.size).toBe(0);
    });

    it('checkbox以外のbindingTypeはfalseを返すこと', () => {
      const input = document.createElement('input');
      const binding = createCheckboxBinding(input, { bindingType: 'prop' });

      const result = detachCheckboxEventHandler(binding);

      expect(result).toBe(false);
    });

    it('ハンドラが未登録の場合はfalseを返すこと', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      const binding = createCheckboxBinding(input);

      const result = detachCheckboxEventHandler(binding);

      expect(result).toBe(false);
    });

    it('bindingSetが未登録の場合はfalseを返すこと', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      const binding = createCheckboxBinding(input);
      const eventName = __private__.getEventName(binding);
      const key = __private__.getHandlerKey(binding, eventName);

      // handlerだけ登録してbindingSetは未登録
      __private__.handlerByHandlerKey.set(key, () => {});

      const result = detachCheckboxEventHandler(binding);

      expect(result).toBe(false);
    });

    it('複数バインディングがある場合は最後の1つを削除するまでハンドラを保持すること', () => {
      const input1 = document.createElement('input');
      input1.type = 'checkbox';
      const input2 = document.createElement('input');
      input2.type = 'checkbox';
      const binding1 = createCheckboxBinding(input1);
      const binding2 = createCheckboxBinding(input2);

      attachCheckboxEventHandler(binding1);
      attachCheckboxEventHandler(binding2);

      detachCheckboxEventHandler(binding1);
      expect(__private__.handlerByHandlerKey.size).toBe(1);

      detachCheckboxEventHandler(binding2);
      expect(__private__.handlerByHandlerKey.size).toBe(0);
    });
  });

  describe('checkboxEventHandlerFunction', () => {
    it('チェックONで配列に値を追加すること', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = 'apple';
      document.body.appendChild(input);

      const currentValue = ['banana'];
      let assignedValue: any;
      const mockState: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === setLoopContextSymbol) return (_lc: any, cb: () => void) => cb();
          if (prop === 'selected') return currentValue;
          return undefined;
        },
        set(_t, prop, value) {
          if (prop === 'selected') assignedValue = value;
          return true;
        }
      });
      const createStateMock = vi.fn((_m: string, cb: (s: any) => void) => cb(mockState));
      getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);
      getLoopContextByNodeMock.mockReturnValue(null);

      const binding = createCheckboxBinding(input);
      attachCheckboxEventHandler(binding);

      input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(assignedValue).toEqual(['banana', 'apple']);
      document.body.removeChild(input);
    });

    it('チェックONで既に値が存在する場合は追加しないこと', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = 'apple';
      document.body.appendChild(input);

      const currentValue = ['apple'];
      let assignedValue: any = undefined;
      const mockState: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === setLoopContextSymbol) return (_lc: any, cb: () => void) => cb();
          if (prop === 'selected') return currentValue;
          return undefined;
        },
        set(_t, prop, value) {
          if (prop === 'selected') assignedValue = value;
          return true;
        }
      });
      const createStateMock = vi.fn((_m: string, cb: (s: any) => void) => cb(mockState));
      getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);
      getLoopContextByNodeMock.mockReturnValue(null);

      const binding = createCheckboxBinding(input);
      attachCheckboxEventHandler(binding);

      input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(assignedValue).toBeUndefined();
      document.body.removeChild(input);
    });

    it('チェックOFFで配列から値を削除すること', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = 'apple';
      document.body.appendChild(input);

      const currentValue = ['banana', 'apple'];
      let assignedValue: any;
      const mockState: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === setLoopContextSymbol) return (_lc: any, cb: () => void) => cb();
          if (prop === 'selected') return currentValue;
          return undefined;
        },
        set(_t, prop, value) {
          if (prop === 'selected') assignedValue = value;
          return true;
        }
      });
      const createStateMock = vi.fn((_m: string, cb: (s: any) => void) => cb(mockState));
      getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);
      getLoopContextByNodeMock.mockReturnValue(null);

      const binding = createCheckboxBinding(input);
      attachCheckboxEventHandler(binding);

      input.checked = false;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(assignedValue).toEqual(['banana']);
      document.body.removeChild(input);
    });

    it('チェックOFFで値が存在しない場合は何もしないこと', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = 'orange';
      document.body.appendChild(input);

      const currentValue = ['banana', 'apple'];
      let assignedValue: any = undefined;
      const mockState: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === setLoopContextSymbol) return (_lc: any, cb: () => void) => cb();
          if (prop === 'selected') return currentValue;
          return undefined;
        },
        set(_t, prop, value) {
          if (prop === 'selected') assignedValue = value;
          return true;
        }
      });
      const createStateMock = vi.fn((_m: string, cb: (s: any) => void) => cb(mockState));
      getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);
      getLoopContextByNodeMock.mockReturnValue(null);

      const binding = createCheckboxBinding(input);
      attachCheckboxEventHandler(binding);

      input.checked = false;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(assignedValue).toBeUndefined();
      document.body.removeChild(input);
    });

    it('現在値が配列でない場合、チェックONで新規配列を作成すること', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = 'apple';
      document.body.appendChild(input);

      let assignedValue: any;
      const mockState: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === setLoopContextSymbol) return (_lc: any, cb: () => void) => cb();
          if (prop === 'selected') return 'not-array';
          return undefined;
        },
        set(_t, prop, value) {
          if (prop === 'selected') assignedValue = value;
          return true;
        }
      });
      const createStateMock = vi.fn((_m: string, cb: (s: any) => void) => cb(mockState));
      getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);
      getLoopContextByNodeMock.mockReturnValue(null);

      const binding = createCheckboxBinding(input);
      attachCheckboxEventHandler(binding);

      input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(assignedValue).toEqual(['apple']);
      document.body.removeChild(input);
    });

    it('現在値が配列でない場合、チェックOFFで空配列を設定すること', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = 'apple';
      document.body.appendChild(input);

      let assignedValue: any;
      const mockState: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === setLoopContextSymbol) return (_lc: any, cb: () => void) => cb();
          if (prop === 'selected') return 'not-array';
          return undefined;
        },
        set(_t, prop, value) {
          if (prop === 'selected') assignedValue = value;
          return true;
        }
      });
      const createStateMock = vi.fn((_m: string, cb: (s: any) => void) => cb(mockState));
      getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);
      getLoopContextByNodeMock.mockReturnValue(null);

      const binding = createCheckboxBinding(input);
      attachCheckboxEventHandler(binding);

      input.checked = false;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(assignedValue).toEqual([]);
      document.body.removeChild(input);
    });

    it('event.targetがnullの場合はconsole.warnが出ること', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handler = __private__.checkboxEventHandlerFunction('default', 'selected', []);

      handler({ target: null } as any);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('event.target is null');
      warnSpy.mockRestore();
    });

    it('event.targetがcheckboxでない場合はconsole.warnが出ること', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handler = __private__.checkboxEventHandlerFunction('default', 'selected', []);

      const input = document.createElement('input');
      input.type = 'text';
      handler({ target: input } as any);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('not a checkbox');
      warnSpy.mockRestore();
    });

    it('stateElementが見つからない場合はraiseErrorが呼ばれること', () => {
      getStateElementByNameMock.mockReturnValue(null);
      raiseErrorMock.mockImplementation((msg: string) => { throw new Error(msg); });
      const handler = __private__.checkboxEventHandlerFunction('default', 'selected', []);

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = 'test';
      document.body.appendChild(input);

      expect(() => handler({ target: input } as any)).toThrow('not found');
      expect(raiseErrorMock).toHaveBeenCalledWith(expect.stringContaining('not found'));
      document.body.removeChild(input);
    });

    it('inFiltersが適用されること', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = '42';
      document.body.appendChild(input);

      const currentValue = [42];
      let assignedValue: any = undefined;
      const mockState: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === setLoopContextSymbol) return (_lc: any, cb: () => void) => cb();
          if (prop === 'selected') return currentValue;
          return undefined;
        },
        set(_t, prop, value) {
          if (prop === 'selected') assignedValue = value;
          return true;
        }
      });
      const createStateMock = vi.fn((_m: string, cb: (s: any) => void) => cb(mockState));
      getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);
      getLoopContextByNodeMock.mockReturnValue(null);

      const inFilters = [{ filterName: 'num', args: [], filterFn: (v: any) => Number(v) }];
      const binding = createCheckboxBinding(input, { inFilters });
      attachCheckboxEventHandler(binding);

      // checkedをOFF → 42をフィルター経由で比較して削除
      input.checked = false;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(assignedValue).toEqual([]);
      document.body.removeChild(input);
    });
  });

  describe('getEventName', () => {
    it('デフォルトのイベント名はinputであること', () => {
      const input = document.createElement('input');
      const binding = createCheckboxBinding(input);
      expect(__private__.getEventName(binding)).toBe('input');
    });

    it('onchangeモディファイアでchangeになること', () => {
      const input = document.createElement('input');
      const binding = createCheckboxBinding(input, { propModifiers: ['onchange'] });
      expect(__private__.getEventName(binding)).toBe('change');
    });

    it('on以外のモディファイアは無視されること', () => {
      const input = document.createElement('input');
      const binding = createCheckboxBinding(input, { propModifiers: ['trim', 'onchange'] });
      expect(__private__.getEventName(binding)).toBe('change');
    });
  });

  describe('getHandlerKey', () => {
    it('一意のキーを生成すること', () => {
      const input = document.createElement('input');
      const binding = createCheckboxBinding(input);
      const key = __private__.getHandlerKey(binding, 'input');
      expect(key).toBe('default::selected::input::');
    });

    it('フィルター情報がキーに含まれること', () => {
      const input = document.createElement('input');
      const inFilters = [{ filterName: 'num', args: [], filterFn: (v: any) => Number(v) }];
      const binding = createCheckboxBinding(input, { inFilters });
      const key = __private__.getHandlerKey(binding, 'input');
      expect(key).toBe('default::selected::input::num()');
    });
  });
});
