import { describe, it, expect } from 'vitest';
import { getOrCreateCommandToken, __private__ } from '../src/command/commandTokenRegistry';
import type { IStateElement } from '../src/components/types';

function makeStateElement(): IStateElement {
  return {} as IStateElement;
}

describe('commandTokenRegistry', () => {
  it('同じ名前で呼ぶと同一トークンを返すこと（memo化）', () => {
    const se = makeStateElement();
    const t1 = getOrCreateCommandToken(se, 'fetchUsers');
    const t2 = getOrCreateCommandToken(se, 'fetchUsers');
    expect(t1).toBe(t2);
  });

  it('異なる名前で呼ぶと別トークンを返すこと', () => {
    const se = makeStateElement();
    const t1 = getOrCreateCommandToken(se, 'a');
    const t2 = getOrCreateCommandToken(se, 'b');
    expect(t1).not.toBe(t2);
    expect(t1.name).toBe('a');
    expect(t2.name).toBe('b');
  });

  it('stateElementが異なれば独立したトークンになること', () => {
    const se1 = makeStateElement();
    const se2 = makeStateElement();
    const t1 = getOrCreateCommandToken(se1, 'shared');
    const t2 = getOrCreateCommandToken(se2, 'shared');
    expect(t1).not.toBe(t2);
  });

  it('registry は state 要素をキーに作られること（切断では捨てない — #273）', () => {
    const se = makeStateElement();
    expect(__private__.registryByStateElement.has(se)).toBe(false);
    const t1 = getOrCreateCommandToken(se, 'x');
    expect(__private__.registryByStateElement.get(se)?.get('x')).toBe(t1);
  });
});
