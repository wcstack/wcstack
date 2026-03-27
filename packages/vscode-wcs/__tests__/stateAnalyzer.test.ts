import { describe, it, expect } from 'vitest';
import { analyzeStatePaths, analyzeJsonPaths } from '../src/service/stateAnalyzer';

describe('analyzeStatePaths', () => {
  it('プリミティブプロパティのパスを生成する', () => {
    const paths = analyzeStatePaths(`
export default {
  count: 0,
  name: "test",
  active: true,
};`);
    expect(paths.map(p => p.path)).toContain('count');
    expect(paths.map(p => p.path)).toContain('name');
    expect(paths.map(p => p.path)).toContain('active');
  });

  it('型ヒントを推定する', () => {
    const paths = analyzeStatePaths(`
export default {
  count: 0,
  name: "test",
  active: true,
};`);
    expect(paths.find(p => p.path === 'count')?.typeHint).toBe('number');
    expect(paths.find(p => p.path === 'name')?.typeHint).toBe('string');
    expect(paths.find(p => p.path === 'active')?.typeHint).toBe('boolean');
  });

  it('配列プロパティの .length パスを生成する', () => {
    const paths = analyzeStatePaths(`
export default {
  users: [{ name: "Alice" }],
};`);
    const lengthPath = paths.find(p => p.path === 'users.length');
    expect(lengthPath).toBeDefined();
    expect(lengthPath!.typeHint).toBe('number');
    expect(lengthPath!.kind).toBe('data');
  });

  it('ネストした配列の .length パスを生成する', () => {
    const paths = analyzeStatePaths(`
export default {
  cart: {
    items: [{ name: "item1" }],
  },
};`);
    expect(paths.find(p => p.path === 'cart.items.length')?.typeHint).toBe('number');
  });

  it('配列プロパティからワイルドカードパスを生成する', () => {
    const paths = analyzeStatePaths(`
export default {
  users: [
    { name: "Alice", age: 30 },
  ],
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('users');
    expect(pathNames).toContain('users.*');
    expect(pathNames).toContain('users.*.name');
    expect(pathNames).toContain('users.*.age');
  });

  it('ネストしたオブジェクトの子パスを生成する', () => {
    const paths = analyzeStatePaths(`
export default {
  cart: {
    totalPrice: 0,
    itemCount: 0,
  },
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('cart');
    expect(pathNames).toContain('cart.totalPrice');
    expect(pathNames).toContain('cart.itemCount');
  });

  it('ネストしたオブジェクト内の配列パスを生成する', () => {
    const paths = analyzeStatePaths(`
export default {
  cart: {
    items: [
      { name: "item1", price: 100 },
    ],
  },
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('cart.items');
    expect(pathNames).toContain('cart.items.*');
    expect(pathNames).toContain('cart.items.*.name');
    expect(pathNames).toContain('cart.items.*.price');
  });

  it('computed getter のパスを生成する', () => {
    const paths = analyzeStatePaths(`
export default {
  users: [],
  get "users.*.ageCategory"() {
    return "Adult";
  },
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('users.*.ageCategory');
    expect(paths.find(p => p.path === 'users.*.ageCategory')?.kind).toBe('computed');
  });

  it('メソッドは kind: method として含まれる（検証用）', () => {
    const paths = analyzeStatePaths(`
export default {
  count: 0,
  increment() {
    this.count++;
  },
};`);
    expect(paths.find(p => p.path === 'count')?.kind).toBe('data');
    expect(paths.find(p => p.path === 'increment')?.kind).toBe('method');
  });

  it('JSDoc @type から型ヒントを取得する（union 型保持）', () => {
    const paths = analyzeStatePaths(`
export default {
  /** @type {boolean|null} */
  ok: null,
  /** @type {string} */
  label: null,
  /** @type {number[]} */
  scores: null,
};`);
    expect(paths.find(p => p.path === 'ok')?.typeHint).toBe('boolean|null');
    expect(paths.find(p => p.path === 'label')?.typeHint).toBe('string');
    expect(paths.find(p => p.path === 'scores')?.typeHint).toBe('array');
  });

  it('JSDoc がない場合は値から型を推定する', () => {
    const paths = analyzeStatePaths(`
export default {
  count: 0,
  /** @type {boolean} */
  active: null,
};`);
    expect(paths.find(p => p.path === 'count')?.typeHint).toBe('number');
    expect(paths.find(p => p.path === 'active')?.typeHint).toBe('boolean');
  });

  it('defineState でラップされたオブジェクトを解析する', () => {
    const paths = analyzeStatePaths(`
import { defineState } from '@wcstack/state';
export default defineState({
  count: 0,
  name: "test",
});`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('count');
    expect(pathNames).toContain('name');
  });

  it('export default がない場合は空配列を返す', () => {
    const paths = analyzeStatePaths(`const x = 1;`);
    expect(paths).toEqual([]);
  });

  it('空のオブジェクトの場合は空配列を返す', () => {
    const paths = analyzeStatePaths(`export default {};`);
    expect(paths).toEqual([]);
  });
});

describe('analyzeJsonPaths', () => {
  it('プリミティブプロパティのパスと型ヒントを生成する', () => {
    const paths = analyzeJsonPaths('{"count": 0, "name": "test", "active": true}');
    expect(paths.find(p => p.path === 'count')?.typeHint).toBe('number');
    expect(paths.find(p => p.path === 'name')?.typeHint).toBe('string');
    expect(paths.find(p => p.path === 'active')?.typeHint).toBe('boolean');
    paths.forEach(p => expect(p.kind).toBe('data'));
  });

  it('配列プロパティからワイルドカードパスと length を生成する', () => {
    const paths = analyzeJsonPaths('{"users": [{"name": "Alice", "age": 30}]}');
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('users');
    expect(pathNames).toContain('users.*');
    expect(pathNames).toContain('users.length');
    expect(pathNames).toContain('users.*.name');
    expect(pathNames).toContain('users.*.age');
    expect(paths.find(p => p.path === 'users')?.typeHint).toBe('array');
    expect(paths.find(p => p.path === 'users.length')?.typeHint).toBe('number');
  });

  it('ネストしたオブジェクトの子パスを生成する', () => {
    const paths = analyzeJsonPaths('{"cart": {"totalPrice": 0, "itemCount": 0}}');
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('cart');
    expect(pathNames).toContain('cart.totalPrice');
    expect(pathNames).toContain('cart.itemCount');
  });

  it('ネストしたオブジェクト内の配列パスを生成する', () => {
    const paths = analyzeJsonPaths('{"cart": {"items": [{"name": "item1", "price": 100}]}}');
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('cart.items');
    expect(pathNames).toContain('cart.items.*');
    expect(pathNames).toContain('cart.items.*.name');
    expect(pathNames).toContain('cart.items.*.price');
  });

  it('null 値の型ヒントを正しく設定する', () => {
    const paths = analyzeJsonPaths('{"value": null}');
    expect(paths.find(p => p.path === 'value')?.typeHint).toBe('null');
  });

  it('stateName を指定できる', () => {
    const paths = analyzeJsonPaths('{"count": 0}', 'cart');
    expect(paths[0].stateName).toBe('cart');
  });

  it('不正な JSON の場合は空配列を返す', () => {
    expect(analyzeJsonPaths('invalid json')).toEqual([]);
  });

  it('トップレベルが配列の場合は空配列を返す', () => {
    expect(analyzeJsonPaths('[1, 2, 3]')).toEqual([]);
  });

  it('空のオブジェクトの場合は空配列を返す', () => {
    expect(analyzeJsonPaths('{}')).toEqual([]);
  });

  it('深すぎるネストは制限される', () => {
    const json = '{"a":{"b":{"c":{"d":{"e":{"f":{"g":{"h":1}}}}}}}}';
    const paths = analyzeJsonPaths(json);
    // depth 5 まで — a.b.c.d.e.f まで、g 以降は生成されない
    expect(paths.map(p => p.path)).toContain('a.b.c.d.e.f');
    expect(paths.map(p => p.path)).not.toContain('a.b.c.d.e.f.g.h');
  });
});
