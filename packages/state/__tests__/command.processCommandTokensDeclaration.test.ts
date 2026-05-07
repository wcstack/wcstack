import { describe, it, expect, vi } from 'vitest';
import { processCommandTokensDeclaration } from '../src/command/processCommandTokensDeclaration';

describe('processCommandTokensDeclaration', () => {
  it('$commandTokensが未定義なら何もしないこと', () => {
    const state: any = { foo: 1 };
    expect(() => processCommandTokensDeclaration(state)).not.toThrow();
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

  it('既存の自プロパティと衝突するとエラーになること', () => {
    const state: any = { $commandTokens: ['conflict'], conflict: 1 };
    expect(() => processCommandTokensDeclaration(state)).toThrow(/conflicts/);
  });

  it('プロトタイプ上のメソッドとも衝突検出されること', () => {
    class Base {
      doStuff(): void {}
    }
    const state: any = Object.assign(new Base(), { $commandTokens: ['doStuff'] });
    expect(() => processCommandTokensDeclaration(state)).toThrow(/conflicts/);
  });

  it('宣言された名前ごとにgetterを注入し$commandToken委譲となること', () => {
    const state: any = { $commandTokens: ['fetchUsers', 'refreshOrders'] };
    processCommandTokensDeclaration(state);
    const desc1 = Object.getOwnPropertyDescriptor(state, 'fetchUsers');
    const desc2 = Object.getOwnPropertyDescriptor(state, 'refreshOrders');
    expect(typeof desc1?.get).toBe('function');
    expect(typeof desc2?.get).toBe('function');

    const tokenA = { mark: 'A' };
    const tokenB = { mark: 'B' };
    const $commandToken = vi.fn((name: string) => name === 'fetchUsers' ? tokenA : tokenB);
    const receiver: any = Object.create(state);
    receiver.$commandToken = $commandToken;
    expect(receiver.fetchUsers).toBe(tokenA);
    expect(receiver.refreshOrders).toBe(tokenB);
    expect($commandToken).toHaveBeenCalledWith('fetchUsers');
    expect($commandToken).toHaveBeenCalledWith('refreshOrders');
  });

  it('注入されたgetterはenumerable:falseで列挙対象外になること', () => {
    const state: any = { $commandTokens: ['fetchUsers'], visible: 'yes' };
    processCommandTokensDeclaration(state);
    const desc = Object.getOwnPropertyDescriptor(state, 'fetchUsers');
    expect(desc?.enumerable).toBe(false);
    expect(Object.keys(state)).not.toContain('fetchUsers');
    const parsed = JSON.parse(JSON.stringify(state));
    expect(Object.keys(parsed)).not.toContain('fetchUsers');
  });
});
