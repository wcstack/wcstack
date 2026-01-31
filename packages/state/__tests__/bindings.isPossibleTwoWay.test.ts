import { describe, it, expect } from 'vitest';
import { isPossibleTwoWay } from '../src/event/isPossibleTwoWay';

describe('isPossibleTwoWay', () => {
  it('input:text の value はtrue', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    expect(isPossibleTwoWay(input, 'value')).toBe(true);
  });

  it('input:checkbox の checked はtrue', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'checkbox');
    expect(isPossibleTwoWay(input, 'checked')).toBe(true);
  });

  it('input:radio の checked はtrue', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'radio');
    expect(isPossibleTwoWay(input, 'checked')).toBe(true);
  });

  it('input:button はfalse', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'button');
    expect(isPossibleTwoWay(input, 'value')).toBe(false);
  });

  it('inputでtype指定がない場合はtext扱いになること', () => {
    const input = document.createElement('input');
    expect(isPossibleTwoWay(input, 'value')).toBe(true);
  });

  it('inputのvalueAsNumber/valueAsDateはtrue', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    expect(isPossibleTwoWay(input, 'valueAsNumber')).toBe(true);
    expect(isPossibleTwoWay(input, 'valueAsDate')).toBe(true);
  });

  it('inputでも対象外のpropはfalse', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    expect(isPossibleTwoWay(input, 'checked')).toBe(false);
  });

  it('select の value はtrue', () => {
    const select = document.createElement('select');
    expect(isPossibleTwoWay(select, 'value')).toBe(true);
  });

  it('textarea の value はtrue', () => {
    const textarea = document.createElement('textarea');
    expect(isPossibleTwoWay(textarea, 'value')).toBe(true);
  });

  it('非Elementノードはfalse', () => {
    const text = document.createTextNode('x');
    expect(isPossibleTwoWay(text, 'value')).toBe(false);
  });
});
