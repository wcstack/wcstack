import { describe, it, expect } from 'vitest';
import { getCommandNamespace, clearCommandNamespace } from '../src/command/commandNamespace';

function makeStateElement(names: string[]): any {
  return { commandTokenNames: new Set(names) };
}

describe('commandNamespace', () => {
  describe('getCommandNamespace', () => {
    it('同一stateElementに対して同じproxyを返す（memo化）', () => {
      const se = makeStateElement(['a']);
      const ns1 = getCommandNamespace(se);
      const ns2 = getCommandNamespace(se);
      expect(ns1).toBe(ns2);
    });

    it('異なるstateElementには別々のproxyを返す', () => {
      const ns1 = getCommandNamespace(makeStateElement(['a']));
      const ns2 = getCommandNamespace(makeStateElement(['a']));
      expect(ns1).not.toBe(ns2);
    });

    it('symbolプロパティアクセスはundefined', () => {
      const ns = getCommandNamespace(makeStateElement(['a'])) as any;
      const sym = Symbol('s');
      expect(ns[sym]).toBeUndefined();
    });

    it('symbolはin演算子でfalse', () => {
      const ns = getCommandNamespace(makeStateElement(['a'])) as any;
      const sym = Symbol('s');
      expect(sym in ns).toBe(false);
    });
  });

  describe('clearCommandNamespace', () => {
    it('クリア後は新しいproxyを返す', () => {
      const se = makeStateElement(['a']);
      const ns1 = getCommandNamespace(se);
      clearCommandNamespace(se);
      const ns2 = getCommandNamespace(se);
      expect(ns1).not.toBe(ns2);
    });

    it('未登録のstateElementをclearしてもエラーにならない', () => {
      const se = makeStateElement(['a']);
      expect(() => clearCommandNamespace(se)).not.toThrow();
    });
  });
});
