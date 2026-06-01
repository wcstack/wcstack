import { describe, it, expect } from 'vitest';
import { processEventTokensDeclaration } from '../src/event/processEventTokensDeclaration';
import type { IState } from '../src/types';

describe('processEventTokensDeclaration', () => {
  it('$eventTokens未宣言なら空Setを返すこと', () => {
    const names = processEventTokensDeclaration({} as IState);
    expect(names.size).toBe(0);
  });

  it('宣言された名前群をSetで返すこと', () => {
    const names = processEventTokensDeclaration({ $eventTokens: ['userCreated', 'createFailed'] } as unknown as IState);
    expect(Array.from(names)).toEqual(['userCreated', 'createFailed']);
  });

  it('配列でない場合はエラーになること', () => {
    expect(() => processEventTokensDeclaration({ $eventTokens: 'x' } as unknown as IState)).toThrow(/must be an array/);
  });

  it('非文字列要素はエラーになること', () => {
    expect(() => processEventTokensDeclaration({ $eventTokens: [123] } as unknown as IState)).toThrow(/non-empty strings/);
  });

  it('空文字列要素はエラーになること', () => {
    expect(() => processEventTokensDeclaration({ $eventTokens: [''] } as unknown as IState)).toThrow(/non-empty strings/);
  });

  it('重複する名前はエラーになること', () => {
    expect(() => processEventTokensDeclaration({ $eventTokens: ['a', 'a'] } as unknown as IState)).toThrow(/duplicated/);
  });
});
