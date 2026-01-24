import { describe, it, expect, vi } from 'vitest';
import { assignParams } from '../src/assignParams';
import * as raiseErrorModule from '../src/raiseError';

describe('assignParams', () => {
  it('data-bind="" の場合、プロパティに直接割り当てること', () => {
    const element = document.createElement('div');
    element.setAttribute('data-bind', '');
    
    assignParams(element, { userId: '123', userName: 'test' });
    
    expect((element as any).userId).toBe('123');
    expect((element as any).userName).toBe('test');
  });

  it('data-bind="attr" の場合、属性として割り当てること', () => {
    const element = document.createElement('div');
    element.setAttribute('data-bind', 'attr');
    
    assignParams(element, { 'data-id': '456', title: 'test title' });
    
    expect(element.getAttribute('data-id')).toBe('456');
    expect(element.getAttribute('title')).toBe('test title');
  });

  it('data-bind="props" の場合、propsオブジェクトに割り当てること', () => {
    const element = document.createElement('div') as any;
    element.setAttribute('data-bind', 'props');
    element.props = { existing: 'value' };
    
    assignParams(element, { newProp: 'new value' });
    
    expect(element.props.existing).toBe('value');
    expect(element.props.newProp).toBe('new value');
  });

  it('data-bind="states" の場合、statesオブジェクトに割り当てること', () => {
    const element = document.createElement('div') as any;
    element.setAttribute('data-bind', 'states');
    element.states = { count: 0 };
    
    assignParams(element, { count: '5', active: 'true' });
    
    expect(element.states.count).toBe('5');
    expect(element.states.active).toBe('true');
  });

  it('data-bind属性がない場合、エラーをthrowすること', () => {
    const element = document.createElement('div');
    
    expect(() => {
      assignParams(element, { id: '123' });
    }).toThrow();
  });

  it('無効なdata-bind値の場合、エラーをthrowすること', () => {
    const element = document.createElement('div');
    element.setAttribute('data-bind', 'invalid-type');
    
    expect(() => {
      assignParams(element, { id: '123' });
    }).toThrow();
  });

  it('複数のパラメータを一度に割り当てられること', () => {
    const element = document.createElement('div');
    element.setAttribute('data-bind', '');
    
    assignParams(element, {
      id: '999',
      name: 'multi test',
      active: 'true',
      count: '42'
    });
    
    expect((element as any).id).toBe('999');
    expect((element as any).name).toBe('multi test');
    expect((element as any).active).toBe('true');
    expect((element as any).count).toBe('42');
  });

  it('未定義のカスタム要素の場合は定義後に割り当てられること', async () => {
    const tagName = `x-assign-params-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const element = document.createElement('div');
    element.setAttribute('is', tagName);
    element.setAttribute('data-bind', 'attr');
    document.body.appendChild(element);

    const getSpy = vi.spyOn(customElements, 'get').mockReturnValue(undefined);
    const whenDefinedSpy = vi.spyOn(customElements, 'whenDefined').mockResolvedValue(undefined as any);

    assignParams(element, { customProp: 'late' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(whenDefinedSpy).toHaveBeenCalledWith(tagName);
    expect(element.getAttribute('customProp')).toBe('late');
    element.remove();
    getSpy.mockRestore();
    whenDefinedSpy.mockRestore();
  });

  it('未接続の要素は定義後も割り当てを行わないこと', async () => {
    const tagName = `x-assign-params-disconnected-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const element = document.createElement('div');
    element.setAttribute('is', tagName);
    element.setAttribute('data-bind', 'attr');

    const getSpy = vi.spyOn(customElements, 'get').mockReturnValue(undefined);
    const whenDefinedSpy = vi.spyOn(customElements, 'whenDefined').mockResolvedValue(undefined as any);

    assignParams(element, { customProp: 'skip' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(whenDefinedSpy).toHaveBeenCalledWith(tagName);
    expect(element.getAttribute('customProp')).toBeNull();

    getSpy.mockRestore();
    whenDefinedSpy.mockRestore();
  });

  it('定義済みのカスタム要素の場合は即時に割り当てられること', () => {
    const tagName = `x-assign-params-ready-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    class ReadyElement extends HTMLElement {}
    customElements.define(tagName, ReadyElement);
    const getSpy = vi.spyOn(customElements, 'get').mockReturnValue(ReadyElement);

    const element = document.createElement('div');
    element.setAttribute('is', tagName);
    element.setAttribute('data-bind', 'attr');
    document.body.appendChild(element);

    assignParams(element, { customProp: 'ready' });

    expect(element.getAttribute('customProp')).toBe('ready');
    element.remove();
    getSpy.mockRestore();
  });

  it('whenDefinedがrejectした場合にraiseErrorを呼び出すこと', async () => {
    const tagName = `x-assign-params-reject-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const element = document.createElement('div');
    element.setAttribute('is', tagName);
    element.setAttribute('data-bind', 'attr');

    const getSpy = vi.spyOn(customElements, 'get').mockReturnValue(undefined);
    const whenDefinedSpy = vi.spyOn(customElements, 'whenDefined').mockRejectedValue(new Error('fail'));
    const raiseErrorSpy = vi.spyOn(raiseErrorModule, 'raiseError').mockImplementation(() => {});

    assignParams(element, { customProp: 'reject' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(whenDefinedSpy).toHaveBeenCalledWith(tagName);
    expect(raiseErrorSpy).toHaveBeenCalledWith(`Failed to define custom element: ${tagName}`);

    getSpy.mockRestore();
    whenDefinedSpy.mockRestore();
    raiseErrorSpy.mockRestore();
  });
});
