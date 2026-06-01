import { describe, it, expect, vi } from 'vitest';
import { processOnDeclaration } from '../src/event/processOnDeclaration';
import { getOrCreateEventToken, clearEventTokenRegistry } from '../src/event/eventTokenRegistry';
import type { IStateElement } from '../src/components/types';
import type { IState } from '../src/types';

const fakeStateElement = (): IStateElement => ({} as IStateElement);

describe('processOnDeclaration', () => {
  it('$on未宣言なら何もしないこと', () => {
    const se = fakeStateElement();
    expect(() => processOnDeclaration(se, {} as IState, new Set())).not.toThrow();
  });

  it('$onがオブジェクトでない場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processOnDeclaration(se, { $on: 'x' } as unknown as IState, new Set(['a'])))
      .toThrow(/must be an object/);
  });

  it('$onがnullの場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processOnDeclaration(se, { $on: null } as unknown as IState, new Set(['a'])))
      .toThrow(/must be an object/);
  });

  it('$eventTokensに無いキーはエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processOnDeclaration(se, { $on: { unknown: () => {} } } as unknown as IState, new Set(['a'])))
      .toThrow(/not declared in \$eventTokens/);
  });

  it('ハンドラが関数でない場合はエラーになること', () => {
    const se = fakeStateElement();
    expect(() => processOnDeclaration(se, { $on: { a: 123 } } as unknown as IState, new Set(['a'])))
      .toThrow(/must be a function/);
  });

  it('宣言済みハンドラをtokenにsubscribeすること', () => {
    const se = fakeStateElement();
    const handler = vi.fn();
    processOnDeclaration(se, { $on: { userCreated: handler } } as unknown as IState, new Set(['userCreated']));
    const token = getOrCreateEventToken(se, 'userCreated');
    expect(token.size).toBe(1);
    token.emit('state', 'event');
    expect(handler).toHaveBeenCalledWith('state', 'event');
    clearEventTokenRegistry(se);
  });
});
