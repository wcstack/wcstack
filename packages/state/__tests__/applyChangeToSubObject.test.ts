import { describe, it, expect } from 'vitest';
import { applyChangeToSubObject } from '../src/apply/applyChangeToSubObject';

describe('applyChangeToSubObject', () => {
  it('ネストしたプロパティを更新できること', () => {
    const el = document.createElement('div') as any;
    el.foo = { bar: { baz: 1 } };
    applyChangeToSubObject(el, ['foo', 'bar', 'baz'], 2);
    expect(el.foo.bar.baz).toBe(2);
  });

  it('同じ値の場合は変更しないこと', () => {
    const el = document.createElement('div') as any;
    el.foo = { bar: { baz: 1 } };
    applyChangeToSubObject(el, ['foo', 'bar', 'baz'], 1);
    expect(el.foo.bar.baz).toBe(1);
  });

  it('途中のオブジェクトがnullの場合は何もしないこと', () => {
    const el = document.createElement('div') as any;
    el.foo = null;
    applyChangeToSubObject(el, ['foo', 'bar', 'baz'], 2);
    expect(el.foo).toBeNull();
  });
});
