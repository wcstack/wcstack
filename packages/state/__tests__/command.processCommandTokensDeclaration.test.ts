import { describe, it, expect } from 'vitest';
import { processCommandTokensDeclaration } from '../src/command/processCommandTokensDeclaration';

describe('processCommandTokensDeclaration', () => {
  it('$commandTokensが未定義なら空のSetを返すこと', () => {
    const state: any = { foo: 1 };
    const names = processCommandTokensDeclaration(state);
    expect(names.size).toBe(0);
    expect(state.foo).toBe(1);
  });

  it('配列以外を指定するとエラーになること', () => {
    const state: any = { $commandTokens: 'oops' };
    expect(() => processCommandTokensDeclaration(state)).toThrow(/must be an array/);
  });

  it('要素が文字列でなければエラーになること', () => {
    const state: any = { $commandTokens: [123] };
    expect(() => processCommandTokensDeclaration(state)).toThrow(/non-empty strings/);
  });

  it('空文字列の要素を含むとエラーになること', () => {
    const state: any = { $commandTokens: [''] };
    expect(() => processCommandTokensDeclaration(state)).toThrow(/non-empty strings/);
  });

  it('予約名 "$command" と衝突するとエラーになること', () => {
    const state: any = { $commandTokens: ['$command'] };
    expect(() => processCommandTokensDeclaration(state)).toThrow(/reserved namespace/);
  });

  it('重複した名前があるとエラーになること', () => {
    const state: any = { $commandTokens: ['fetchUsers', 'fetchUsers'] };
    expect(() => processCommandTokensDeclaration(state)).toThrow(/duplicated/);
  });

  it('宣言された名前一覧をSetで返し、stateには注入しないこと', () => {
    const state: any = { $commandTokens: ['fetchUsers', 'refreshOrders'] };
    const names = processCommandTokensDeclaration(state);
    expect(Array.from(names)).toEqual(['fetchUsers', 'refreshOrders']);
    expect('fetchUsers' in state).toBe(false);
    expect('refreshOrders' in state).toBe(false);
  });

  it('リアクティブ値と同名でも衝突エラーにはならないこと（namespaceに集約されるため）', () => {
    const state: any = { $commandTokens: ['count'], count: 0 };
    const names = processCommandTokensDeclaration(state);
    expect(names.has('count')).toBe(true);
    expect(state.count).toBe(0);
  });
});
