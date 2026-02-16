import { describe, it, expect } from 'vitest';
import { meltFrozenObject } from '../src/webComponent/meltFrozenObject';

describe('meltFrozenObject', () => {
  it('通常のオブジェクトをクローンできること', () => {
    const obj = { name: 'Alice', age: 30 };
    const clone = meltFrozenObject(obj);

    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
  });

  it('フリーズされたオブジェクトを解凍できること', () => {
    const frozen = Object.freeze({ name: 'Alice', age: 30 });
    const clone = meltFrozenObject(frozen);

    expect(Object.isFrozen(frozen)).toBe(true);
    // オブジェクト自体はfrozenでない（extensible）
    expect(Object.isFrozen(clone)).toBe(false);
    expect(Object.isExtensible(clone)).toBe(true);
  });

  it('getterを保持してクローンできること', () => {
    const obj = Object.freeze({
      firstName: 'Alice',
      lastName: 'Smith',
      get fullName() {
        return this.firstName + ' ' + this.lastName;
      }
    });
    const clone = meltFrozenObject(obj) as typeof obj;

    // getterが保持されていること
    const desc = Object.getOwnPropertyDescriptor(clone, 'fullName');
    expect(typeof desc?.get).toBe('function');
    expect(desc?.value).toBeUndefined();

    // getterが正しく評価されること
    expect(clone.fullName).toBe('Alice Smith');
  });

  it('ドット区切りパスのgetterを保持できること', () => {
    const obj = Object.freeze({
      get "user.title"() {
        return this["user.name"] + " (Age: " + this["user.age"] + ")";
      }
    });
    const clone = meltFrozenObject(obj);

    const desc = Object.getOwnPropertyDescriptor(clone, 'user.title');
    expect(typeof desc?.get).toBe('function');
  });

  it('setterを保持してクローンできること', () => {
    let _value = 0;
    const obj = {
      get value() { return _value; },
      set value(v: number) { _value = v; }
    };
    const clone = meltFrozenObject(obj) as typeof obj;

    const desc = Object.getOwnPropertyDescriptor(clone, 'value');
    expect(typeof desc?.get).toBe('function');
    expect(typeof desc?.set).toBe('function');

    clone.value = 42;
    expect(clone.value).toBe(42);
  });

  it('空オブジェクトをクローンできること', () => {
    const obj = Object.freeze({});
    const clone = meltFrozenObject(obj);

    expect(clone).toEqual({});
    expect(Object.isFrozen(clone)).toBe(false);
  });

  it('クローン後の変更が元のオブジェクトに影響しないこと', () => {
    const obj = { name: 'Alice', nested: { age: 30 } };
    const clone = meltFrozenObject(obj) as typeof obj;

    clone.name = 'Bob';
    expect(obj.name).toBe('Alice');
  });

  it('プロトタイプチェーンが保持されること', () => {
    const proto = { greet() { return 'hello'; } };
    const obj = Object.freeze(Object.create(proto, {
      name: { value: 'Alice', writable: true, enumerable: true, configurable: true }
    }));
    const clone = meltFrozenObject(obj);

    expect(Object.getPrototypeOf(clone)).toBe(proto);
    expect(clone.greet()).toBe('hello');
  });
});
