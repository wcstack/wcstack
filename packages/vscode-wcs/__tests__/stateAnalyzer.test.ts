import { describe, it, expect } from 'vitest';
import { analyzeStatePaths } from '../src/service/stateAnalyzer';

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
