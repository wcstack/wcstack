import { describe, it, expect } from 'vitest';
import { getAllPropertyDescriptors } from '../src/getAllPropertyDescriptors';

describe('getAllPropertyDescriptors', () => {
  it('オブジェクトリテラルではown descriptorのみと同じ結果になること', () => {
    const obj = { a: 1, get b() { return 2; } };
    const descriptors = getAllPropertyDescriptors(obj);
    expect(Object.keys(descriptors).sort()).toEqual(['a', 'b']);
    expect(typeof descriptors.b.get).toBe('function');
  });

  it('プロトタイプチェーン上のdescriptorも拾うこと', () => {
    class Base {
      get fromBase() { return 'base'; }
      method() { return 'm'; }
    }
    class Derived extends Base {
      own = 1;
      get fromDerived() { return 'derived'; }
    }
    const descriptors = getAllPropertyDescriptors(new Derived());
    expect(Object.keys(descriptors).sort())
      .toEqual(['constructor', 'fromBase', 'fromDerived', 'method', 'own']);
  });

  it('Object.prototypeのメンバは含まれないこと', () => {
    // 戻り値自体は素の {} なので `in` ではなく own チェックで見る
    const descriptors = getAllPropertyDescriptors({ a: 1 });
    expect(Object.keys(descriptors)).toEqual(['a']);
    expect(Object.hasOwn(descriptors, 'hasOwnProperty')).toBe(false);
    expect(Object.hasOwn(descriptors, 'toString')).toBe(false);
  });

  it('同名は手前（自身に近い側）が勝つこと', () => {
    // 遠いプロトタイプから畳むので、プロパティ解決の実際の優先順位と一致する
    const proto = { shadowed: 'from-proto' };
    const obj = Object.create(proto);
    obj.shadowed = 'from-own';
    expect(getAllPropertyDescriptors(obj).shadowed.value).toBe('from-own');
  });

  it('Object.create(null)でも走査できること', () => {
    const obj = Object.create(null);
    obj.a = 1;
    expect(Object.keys(getAllPropertyDescriptors(obj))).toEqual(['a']);
  });
});
