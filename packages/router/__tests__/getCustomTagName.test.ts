import { describe, expect, it } from 'vitest';
import { getCustomTagName } from '../src/getCustomTagName';

describe('getCustomTagName', () => {
  it('タグ名にハイフンがある場合はタグ名を返すこと', () => {
    const element = document.createElement('my-element');

    const result = getCustomTagName(element);

    expect(result).toBe('my-element');
  });

  it('is属性にハイフンがある場合はis属性を返すこと', () => {
    const element = document.createElement('button');
    element.setAttribute('is', 'x-button');

    const result = getCustomTagName(element);

    expect(result).toBe('x-button');
  });

  it('タグ名にもis属性にもハイフンがない場合はnullを返すこと', () => {
    const element = document.createElement('div');
    element.setAttribute('is', 'plain');

    const result = getCustomTagName(element);

    expect(result).toBeNull();
  });
});
