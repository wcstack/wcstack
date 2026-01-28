import { describe, it, expect } from 'vitest';
import { applyChangeToClass } from '../src/apply/applyChangeToClass';

describe('applyChangeToClass', () => {
  it('trueでクラスを付与できること', () => {
    const el = document.createElement('div');
    applyChangeToClass(el, 'active', true);
    expect(el.classList.contains('active')).toBe(true);
  });

  it('falseでクラスを削除できること', () => {
    const el = document.createElement('div');
    el.classList.add('active');
    applyChangeToClass(el, 'active', false);
    expect(el.classList.contains('active')).toBe(false);
  });

  it('boolean以外はエラーになること', () => {
    const el = document.createElement('div');
    expect(() => applyChangeToClass(el, 'active', 'yes' as any)).toThrow(/Invalid value for class application/);
  });
});
