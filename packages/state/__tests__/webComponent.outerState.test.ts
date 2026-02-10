import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOuterState } from '../src/webComponent/outerState';
import { IBindingInfo } from '../src/binding/types';

describe('outerState', () => {
  it('createOuterStateでインスタンスが作成されること', () => {
    const outerState = createOuterState();
    expect(outerState).toBeDefined();
    expect(typeof outerState.$$bind).toBe('function');
  });

  describe('$$bind', () => {
    it('プロパティが定義されること', () => {
      const outerState = createOuterState();
      const binding = {
        propSegments: ['component', 'propName']
      } as IBindingInfo;
      const innerStateElement = {} as any;

      outerState.$$bind(innerStateElement, binding);
      
      const descriptor = Object.getOwnPropertyDescriptor(outerState, 'propName');
      expect(descriptor).toBeDefined();
      expect(descriptor?.enumerable).toBe(true);
      expect(descriptor?.configurable).toBe(true);
      expect(typeof descriptor?.get).toBe('function');
      expect(typeof descriptor?.set).toBe('function');
    });

    it('getter: undefinedを返すこと (現状の実装)', () => {
      const outerState = createOuterState();
      const binding = {
        propSegments: ['component', 'propName']
      } as IBindingInfo;
      const innerStateElement = {} as any;

      outerState.$$bind(innerStateElement, binding);
      
      // 現状の実装では常にundefined
      expect(outerState.propName).toBeUndefined();
    });

    it('setter: $postUpdateが呼び出されること', () => {
      const outerState = createOuterState();
      const binding = {
        propSegments: ['component', 'propName']
      } as IBindingInfo;

      const stateProxy = {
        $postUpdate: vi.fn()
      };
      
      const innerStateElement = {
        createState: vi.fn((mode, cb) => cb(stateProxy))
      } as any;

      outerState.$$bind(innerStateElement, binding);
      
      outerState.propName = 'new-value';

      expect(innerStateElement.createState).toHaveBeenCalledWith('readonly', expect.any(Function));
      expect(stateProxy.$postUpdate).toHaveBeenCalledWith('propName');
    });
  });
});
