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

import { attachRadioEventHandler, detachRadioEventHandler, __private__ } from '../src/event/radioHandler';
import { getPathInfo } from '../src/address/PathInfo';
import { getStateElementByName } from '../src/stateElementByName';
import { getLoopContextByNode } from '../src/list/loopContextByNode';
import { raiseError } from '../src/raiseError';
import { setLoopContextSymbol } from '../src/proxy/symbols';

const getStateElementByNameMock = vi.mocked(getStateElementByName);
const getLoopContextByNodeMock = vi.mocked(getLoopContextByNode);
const raiseErrorMock = vi.mocked(raiseError);

function createRadioBinding(node: Element, overrides?: Partial<IBindingInfo>): IBindingInfo {
  return {
    propName: 'radio',
    propSegments: ['radio'],
    propModifiers: [],
    statePathName: 'selectedValue',
    statePathInfo: getPathInfo('selectedValue'),
    stateName: 'default',
    outFilters: [],
    inFilters: [],
    bindingType: 'radio',
    uuid: null,
    node,
    replaceNode: node,
    ...overrides,
  } as IBindingInfo;
}

describe('event/radioHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __private__.handlerByHandlerKey.clear();
    __private__.bindingSetByHandlerKey.clear();
  });

  describe('attachRadioEventHandler', () => {
    it('radio bindingTypeでイベントを登録し、trueを返すこと', () => {
      const input = document.createElement('input');
      input.type = 'radio';
      const binding = createRadioBinding(input);

      const result = attachRadioEventHandler(binding);

      expect(result).toBe(true);
      expect(__private__.handlerByHandlerKey.size).toBe(1);
      expect(__private__.bindingSetByHandlerKey.size).toBe(1);
    });

    it('radio以外のbindingTypeはfalseを返すこと', () => {
      const input = document.createElement('input');
      const binding = createRadioBinding(input, { bindingType: 'prop' });

      const result = attachRadioEventHandler(binding);

      expect(result).toBe(false);
      expect(__private__.handlerByHandlerKey.size).toBe(0);
    });

    it('roモディファイアがある場合はfalseを返すこと', () => {
      const input = document.createElement('input');
      input.type = 'radio';
      const binding = createRadioBinding(input, { propModifiers: ['ro'] });

      const result = attachRadioEventHandler(binding);

      expect(result).toBe(false);
    });

    it('同じキーの2つ目のバインディングはハンドラを再利用すること', () => {
      const input1 = document.createElement('input');
      input1.type = 'radio';
      const input2 = document.createElement('input');
      input2.type = 'radio';
      const binding1 = createRadioBinding(input1);
      const binding2 = createRadioBinding(input2);

      attachRadioEventHandler(binding1);
      attachRadioEventHandler(binding2);

      expect(__private__.handlerByHandlerKey.size).toBe(1);
      const bindingSet = [...__private__.bindingSetByHandlerKey.values()][0];
      expect(bindingSet.size).toBe(2);
    });

    it('onchangeモディファイアでイベント名がchangeになること', () => {
      const input = document.createElement('input');
      input.type = 'radio';
      const addSpy = vi.spyOn(input, 'addEventListener');
      const binding = createRadioBinding(input, { propModifiers: ['onchange'] });

      attachRadioEventHandler(binding);

      expect(addSpy).toHaveBeenCalledWith('change', expect.any(Function));
    });
  });

  describe('detachRadioEventHandler', () => {
    it('登録済みのハンドラを解除し、trueを返すこと', () => {
      const input = document.createElement('input');
      input.type = 'radio';
      const binding = createRadioBinding(input);

      attachRadioEventHandler(binding);
      const result = detachRadioEventHandler(binding);

      expect(result).toBe(true);
      expect(__private__.handlerByHandlerKey.size).toBe(0);
      expect(__private__.bindingSetByHandlerKey.size).toBe(0);
    });

    it('radio以外のbindingTypeはfalseを返すこと', () => {
      const input = document.createElement('input');
      const binding = createRadioBinding(input, { bindingType: 'prop' });

      const result = detachRadioEventHandler(binding);

      expect(result).toBe(false);
    });

    it('ハンドラが未登録の場合はfalseを返すこと', () => {
      const input = document.createElement('input');
      input.type = 'radio';
      const binding = createRadioBinding(input);

      const result = detachRadioEventHandler(binding);

      expect(result).toBe(false);
    });

    it('bindingSetが未登録の場合はfalseを返すこと', () => {
      const input = document.createElement('input');
      input.type = 'radio';
      const binding = createRadioBinding(input);
      const eventName = __private__.getEventName(binding);
      const key = __private__.getHandlerKey(binding, eventName);

      // handlerだけ登録してbindingSetは未登録
      __private__.handlerByHandlerKey.set(key, () => {});

      const result = detachRadioEventHandler(binding);

      expect(result).toBe(false);
    });

    it('複数バインディングがある場合は最後の1つを削除するまでハンドラを保持すること', () => {
      const input1 = document.createElement('input');
      input1.type = 'radio';
      const input2 = document.createElement('input');
      input2.type = 'radio';
      const binding1 = createRadioBinding(input1);
      const binding2 = createRadioBinding(input2);

      attachRadioEventHandler(binding1);
      attachRadioEventHandler(binding2);

      detachRadioEventHandler(binding1);
      expect(__private__.handlerByHandlerKey.size).toBe(1);

      detachRadioEventHandler(binding2);
      expect(__private__.handlerByHandlerKey.size).toBe(0);
    });
  });

  describe('radioEventHandlerFunction', () => {
    it('ラジオボタンがチェックされた時に値を設定すること', () => {
      const input = document.createElement('input');
      input.type = 'radio';
      input.value = 'apple';
      document.body.appendChild(input);

      let assignedValue: any;
      const mockState: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === setLoopContextSymbol) return (_lc: any, cb: () => void) => cb();
          return undefined;
        },
        set(_t, prop, value) {
          if (prop === 'selectedValue') assignedValue = value;
          return true;
        }
      });
      const createStateMock = vi.fn((_m: string, cb: (s: any) => void) => cb(mockState));
      getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);
      getLoopContextByNodeMock.mockReturnValue(null);

      const binding = createRadioBinding(input);
      attachRadioEventHandler(binding);

      input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(assignedValue).toBe('apple');
      document.body.removeChild(input);
    });

    it('ラジオボタンがチェックされていない場合は何もしないこと', () => {
      const input = document.createElement('input');
      input.type = 'radio';
      input.value = 'apple';
      document.body.appendChild(input);

      let assignedValue: any = undefined;
      const mockState: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === setLoopContextSymbol) return (_lc: any, cb: () => void) => cb();
          return undefined;
        },
        set(_t, prop, value) {
          if (prop === 'selectedValue') assignedValue = value;
          return true;
        }
      });
      const createStateMock = vi.fn((_m: string, cb: (s: any) => void) => cb(mockState));
      getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);
      getLoopContextByNodeMock.mockReturnValue(null);

      const binding = createRadioBinding(input);
      attachRadioEventHandler(binding);

      input.checked = false;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(assignedValue).toBeUndefined();
      document.body.removeChild(input);
    });

    it('event.targetがnullの場合はconsole.warnが出ること', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handler = __private__.radioEventHandlerFunction('default', 'selectedValue', []);

      handler({ target: null } as any);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('event.target is null');
      warnSpy.mockRestore();
    });

    it('event.targetがradioでない場合はconsole.warnが出ること', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handler = __private__.radioEventHandlerFunction('default', 'selectedValue', []);

      const input = document.createElement('input');
      input.type = 'text';
      handler({ target: input } as any);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('not a radio');
      warnSpy.mockRestore();
    });

    it('stateElementが見つからない場合はraiseErrorが呼ばれること', () => {
      getStateElementByNameMock.mockReturnValue(null);
      raiseErrorMock.mockImplementation((msg: string) => { throw new Error(msg); });
      const handler = __private__.radioEventHandlerFunction('default', 'selectedValue', []);

      const input = document.createElement('input');
      input.type = 'radio';
      input.value = 'test';
      input.checked = true;
      document.body.appendChild(input);

      expect(() => handler({ target: input } as any)).toThrow('not found');
      expect(raiseErrorMock).toHaveBeenCalledWith(expect.stringContaining('not found'));
      document.body.removeChild(input);
    });

    it('inFiltersが適用されること', () => {
      const input = document.createElement('input');
      input.type = 'radio';
      input.value = '42';
      document.body.appendChild(input);

      let assignedValue: any;
      const mockState: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === setLoopContextSymbol) return (_lc: any, cb: () => void) => cb();
          return undefined;
        },
        set(_t, prop, value) {
          if (prop === 'selectedValue') assignedValue = value;
          return true;
        }
      });
      const createStateMock = vi.fn((_m: string, cb: (s: any) => void) => cb(mockState));
      getStateElementByNameMock.mockReturnValue({ createState: createStateMock } as any);
      getLoopContextByNodeMock.mockReturnValue(null);

      const inFilters = [{ filterName: 'num', args: [], filterFn: (v: any) => Number(v) }];
      const binding = createRadioBinding(input, { inFilters });
      attachRadioEventHandler(binding);

      input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(assignedValue).toBe(42);
      document.body.removeChild(input);
    });
  });

  describe('getEventName', () => {
    it('デフォルトのイベント名はinputであること', () => {
      const input = document.createElement('input');
      const binding = createRadioBinding(input);
      expect(__private__.getEventName(binding)).toBe('input');
    });

    it('onchangeモディファイアでchangeになること', () => {
      const input = document.createElement('input');
      const binding = createRadioBinding(input, { propModifiers: ['onchange'] });
      expect(__private__.getEventName(binding)).toBe('change');
    });

    it('on以外のモディファイアは無視されること', () => {
      const input = document.createElement('input');
      const binding = createRadioBinding(input, { propModifiers: ['trim', 'onchange'] });
      expect(__private__.getEventName(binding)).toBe('change');
    });
  });

  describe('getHandlerKey', () => {
    it('一意のキーを生成すること', () => {
      const input = document.createElement('input');
      const binding = createRadioBinding(input);
      const key = __private__.getHandlerKey(binding, 'input');
      expect(key).toBe('default::selectedValue::input::');
    });

    it('フィルター情報がキーに含まれること', () => {
      const input = document.createElement('input');
      const inFilters = [{ filterName: 'num', args: [], filterFn: (v: any) => Number(v) }];
      const binding = createRadioBinding(input, { inFilters });
      const key = __private__.getHandlerKey(binding, 'input');
      expect(key).toBe('default::selectedValue::input::num()');
    });
  });
});
