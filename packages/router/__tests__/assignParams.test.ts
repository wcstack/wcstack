import { describe, it, expect } from 'vitest';
import { assignParams } from '../src/assignParams';

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
    
    assignParams(element, { count: 5, active: true });
    
    expect(element.states.count).toBe(5);
    expect(element.states.active).toBe(true);
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
});
