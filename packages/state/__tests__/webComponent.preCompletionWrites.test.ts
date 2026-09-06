import { describe, it, expect } from 'vitest';
import {
  rememberOverwrittenObject,
  takeOverwrittenObject,
  recordInjectedKey,
  getInjectedKeys,
} from '../src/webComponent/preCompletionWrites';

describe('preCompletionWrites（完了前の親→子書き込みの控え）', () => {
  it('置き換え前のオブジェクトは最初の 1 回だけ控え、取り出すと消えること', () => {
    const el = document.createElement('my-c');
    const authored = { a: 1 };
    rememberOverwrittenObject(el, 'state', authored);
    rememberOverwrittenObject(el, 'state', { b: 2 });
    expect(takeOverwrittenObject(el, 'state')).toBe(authored);
    expect(takeOverwrittenObject(el, 'state')).toBeUndefined();
  });

  it('控えの無い要素 / プロパティは undefined を返すこと', () => {
    const el = document.createElement('my-c');
    expect(takeOverwrittenObject(el, 'state')).toBeUndefined();
    rememberOverwrittenObject(el, 'other', {});
    expect(takeOverwrittenObject(el, 'state')).toBeUndefined();
  });

  it('注入されたキーはプロパティごとに集合で持つこと', () => {
    const el = document.createElement('my-c');
    expect(getInjectedKeys(el, 'state')).toBeUndefined();
    recordInjectedKey(el, 'state', 'theme');
    recordInjectedKey(el, 'state', 'user');
    recordInjectedKey(el, 'model', 'x');
    expect([...getInjectedKeys(el, 'state')!]).toEqual(['theme', 'user']);
    expect([...getInjectedKeys(el, 'model')!]).toEqual(['x']);
    expect(getInjectedKeys(el, 'none')).toBeUndefined();
  });
});
