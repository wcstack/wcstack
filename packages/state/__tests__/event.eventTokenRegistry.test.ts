import { describe, it, expect } from 'vitest';
import { getOrCreateEventToken, clearEventTokenRegistry, __private__ } from '../src/event/eventTokenRegistry';
import { EventToken } from '../src/event/EventToken';
import type { IStateElement } from '../src/components/types';

const fakeStateElement = (): IStateElement => ({} as IStateElement);

describe('eventTokenRegistry', () => {
  it('同一 stateElement・name では同じ token を返すこと', () => {
    const se = fakeStateElement();
    const a = getOrCreateEventToken(se, 'userCreated');
    const b = getOrCreateEventToken(se, 'userCreated');
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(EventToken);
  });

  it('異なる name では別 token を返すこと', () => {
    const se = fakeStateElement();
    expect(getOrCreateEventToken(se, 'a')).not.toBe(getOrCreateEventToken(se, 'b'));
  });

  it('異なる stateElement では別 token を返すこと', () => {
    expect(getOrCreateEventToken(fakeStateElement(), 'x'))
      .not.toBe(getOrCreateEventToken(fakeStateElement(), 'x'));
  });

  it('clearEventTokenRegistry で registry が破棄されること', () => {
    const se = fakeStateElement();
    getOrCreateEventToken(se, 'x');
    expect(__private__.registryByStateElement.has(se)).toBe(true);
    clearEventTokenRegistry(se);
    expect(__private__.registryByStateElement.has(se)).toBe(false);
  });

  it('clear後は新しい token インスタンスになること', () => {
    const se = fakeStateElement();
    const before = getOrCreateEventToken(se, 'x');
    clearEventTokenRegistry(se);
    const after = getOrCreateEventToken(se, 'x');
    expect(after).not.toBe(before);
  });
});
