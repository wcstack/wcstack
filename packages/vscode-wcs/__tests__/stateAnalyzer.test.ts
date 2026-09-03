import { describe, it, expect } from 'vitest';
import { analyzeStatePaths, analyzeJsonPaths, analyzeSchemaPaths, mergeSchemaCandidates, type PathCandidate } from '../src/service/stateAnalyzer';

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

  it('配列要素内の配列・オブジェクトへ再帰して深い候補を導出する', () => {
    const paths = analyzeStatePaths(`
export default {
  rows: [{ tags: ['a'], cols: [{ c: 1 }], meta: { title: 't' } }],
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('rows.*.tags.*');
    expect(pathNames).toContain('rows.*.tags.length');
    expect(pathNames).toContain('rows.*.cols.*.c');
    expect(pathNames).toContain('rows.*.meta.title');
  });

  it('配列の配列（先頭要素が非オブジェクト）から偽の子候補を作らないこと', () => {
    // ランタイムの実形は weird.*.*.a — 内側の { を拾って weird.*.a を候補化すると
    // 実在しないパスへの hover / 補完が生まれる（JSON 側の !Array.isArray ガードと同一規則）
    const paths = analyzeStatePaths(`
export default {
  weird: [[{ a: 1 }]],
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('weird.*');
    expect(pathNames).not.toContain('weird.*.a');
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

  it('2 階層より深いネストしたオブジェクトも展開する', () => {
    const paths = analyzeStatePaths(`
export default {
  createFetch: {
    url: "/api/users",
    body: { name: "", email: "", role: "viewer" },
  },
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('createFetch.body');
    expect(pathNames).toContain('createFetch.body.name');
    expect(pathNames).toContain('createFetch.body.email');
    expect(pathNames).toContain('createFetch.body.role');
  });

  it('ネストしたオブジェクトの展開は深さ 5 で打ち切る（analyzeJsonPaths と同じ予算）', () => {
    const paths = analyzeStatePaths(`
export default {
  a: { b: { c: { d: { e: { f: { g: 1 } } } } } },
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('a.b.c.d.e.f');
    expect(pathNames).not.toContain('a.b.c.d.e.f.g');
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

  it('深すぎるネストは制限される（script 側と同じ MAX_OBJECT_NEST_DEPTH 予算）', () => {
    const json = '{"a":{"b":{"c":{"d":{"e":{"f":{"g":{"h":1}}}}}}}}';
    const paths = analyzeJsonPaths(json);
    // 深度予算は script 側（pushDataPropertyPathsAt）と共有 — a.b.c.d.e まで。
    // 旧実装は JSON 側だけ 1 段深く辿れており、両解析の到達範囲が揃っていなかった
    expect(paths.map(p => p.path)).toContain('a.b.c.d.e');
    expect(paths.map(p => p.path)).not.toContain('a.b.c.d.e.f');
  });
});

describe('analyzeStatePaths — $ 予約キー（@wcstack/state define.ts の予約名）', () => {
  const STREAMS_SCRIPT = `
export default {
  filter: "all",
  $streams: {
    metrics: {
      args() { return this.filter; },
      async *source(args, signal) { yield 1; },
      fold(acc, chunk) { return [...acc, chunk]; },
      initial: [],
    },
    latestPrice: {
      source(args, signal) { return makeStream(); },
    },
  },
};`;

  it('$streams のエントリ名を値プロパティとして実体化する', () => {
    const paths = analyzeStatePaths(STREAMS_SCRIPT);
    const metrics = paths.find(p => p.path === 'metrics');
    expect(metrics).toBeDefined();
    expect(metrics!.kind).toBe('data');
    expect(paths.find(p => p.path === 'latestPrice')).toBeDefined();
  });

  it('$streams エントリの initial から型ヒント・配列パスを導出する', () => {
    const paths = analyzeStatePaths(STREAMS_SCRIPT);
    expect(paths.find(p => p.path === 'metrics')?.typeHint).toBe('array');
    expect(paths.map(p => p.path)).toContain('metrics.*');
    expect(paths.map(p => p.path)).toContain('metrics.length');
  });

  it('$streamStatus / $streamError の名前空間パスを生成する', () => {
    const paths = analyzeStatePaths(STREAMS_SCRIPT);
    expect(paths.find(p => p.path === '$streamStatus.metrics')?.typeHint).toBe('string');
    expect(paths.map(p => p.path)).toContain('$streamError.metrics');
    expect(paths.map(p => p.path)).toContain('$streamStatus.latestPrice');
  });

  it('$streams 自体や宣言オブジェクトの中身はパスにしない', () => {
    const paths = analyzeStatePaths(STREAMS_SCRIPT);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).not.toContain('$streams');
    expect(pathNames).not.toContain('streams');
    expect(pathNames).not.toContain('$streams.metrics');
    expect(pathNames).not.toContain('$streams.metrics.initial');
  });

  it('明示宣言された同名プロパティが $streams の実体化より優先される', () => {
    const paths = analyzeStatePaths(`
export default {
  metrics: "explicit",
  $streams: {
    metrics: { source(a, s) { return x; }, initial: [] },
  },
};`);
    const metrics = paths.filter(p => p.path === 'metrics');
    expect(metrics).toHaveLength(1);
    expect(metrics[0].typeHint).toBe('string');
  });

  it('$commandTokens から $command.<name> 候補を生成する', () => {
    const paths = analyzeStatePaths(`
export default {
  $commandTokens: ["play", "pause"],
};`);
    const play = paths.find(p => p.path === '$command.play');
    expect(play).toBeDefined();
    expect(play!.kind).toBe('command');
    expect(paths.find(p => p.path === '$command.pause')).toBeDefined();
    expect(paths.map(p => p.path)).not.toContain('$commandTokens');
    expect(paths.map(p => p.path)).not.toContain('commandTokens');
  });

  it('$eventTokens からトークン名候補を生成する', () => {
    const paths = analyzeStatePaths(`
export default {
  $eventTokens: ["userChanged"],
};`);
    const token = paths.find(p => p.path === 'userChanged');
    expect(token).toBeDefined();
    expect(token!.kind).toBe('eventToken');
    expect(paths.map(p => p.path)).not.toContain('$eventTokens');
  });

  it('$on / $bindables / ライフサイクルフックはパスにしない', () => {
    const paths = analyzeStatePaths(`
export default {
  count: 0,
  $on: {
    userChanged(state, event) {},
  },
  $bindables: ["count"],
  async $connectedCallback() { this.count = 1; },
  $updatedCallback() {},
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('count');
    expect(pathNames).not.toContain('$on');
    expect(pathNames).not.toContain('on');
    expect(pathNames).not.toContain('$bindables');
    expect(pathNames).not.toContain('$connectedCallback');
    expect(pathNames).not.toContain('connectedCallback');
    expect(pathNames).not.toContain('$updatedCallback');
  });

  const LIST_KEYS_SCRIPT = `
export default {
  items: [],
  $listKeys: {
    "items": "id",
    "items.*.children": (row) => row.uid,
  },
};`;

  it('$listKeys のリストパスから .* / .length 候補を実体化する', () => {
    const paths = analyzeStatePaths(LIST_KEYS_SCRIPT);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('items.*');
    expect(pathNames).toContain('items.length');
    expect(paths.find(p => p.path === 'items.*')?.kind).toBe('list');
  });

  it('$listKeys の文字列キー指定から行のキーフィールド候補を導出する', () => {
    const paths = analyzeStatePaths(LIST_KEYS_SCRIPT);
    const keyField = paths.find(p => p.path === 'items.*.id');
    expect(keyField).toBeDefined();
    expect(keyField!.kind).toBe('data');
  });

  it('$listKeys の関数キー指定ではリストパスのみ導出する（フィールド名は不明）', () => {
    const paths = analyzeStatePaths(LIST_KEYS_SCRIPT);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('items.*.children');
    expect(pathNames).toContain('items.*.children.*');
    expect(pathNames).toContain('items.*.children.length');
    expect(pathNames.filter(p => p.startsWith('items.*.children.*.'))).toHaveLength(0);
  });

  it('$listKeys 自体や宣言オブジェクトの中身はパスにしない', () => {
    const paths = analyzeStatePaths(LIST_KEYS_SCRIPT);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).not.toContain('$listKeys');
    expect(pathNames).not.toContain('listKeys');
    expect(pathNames).not.toContain('$listKeys.items');
  });

  it('明示宣言された同名プロパティが $listKeys の実体化より優先される', () => {
    const paths = analyzeStatePaths(`
export default {
  items: [{ id: 1, name: "a" }],
  $listKeys: { "items": "id" },
};`);
    expect(paths.filter(p => p.path === 'items')).toHaveLength(1);
    expect(paths.filter(p => p.path === 'items.*')).toHaveLength(1);
    expect(paths.filter(p => p.path === 'items.*.id')).toHaveLength(1);
    expect(paths.map(p => p.path)).toContain('items.*.name');
  });

  it('$streams 実体化されたリストにも $listKeys の宣言が効く', () => {
    const paths = analyzeStatePaths(`
export default {
  $streams: {
    rows: { source(a, s) { return x; }, initial: [] },
  },
  $listKeys: { "rows": "id" },
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('rows.*.id');
    expect(paths.filter(p => p.path === 'rows.*')).toHaveLength(1);
  });

  it('ランタイムが弾く $listKeys 宣言からは候補を作らない', () => {
    const paths = analyzeStatePaths(`
export default {
  $listKeys: {
    "items.*": "id",
    "bad..path": "id",
    "rows": "a.b",
  },
};`);
    const pathNames = paths.map(p => p.path);
    // 末尾 `*`（要素パス）／空セグメントは宣言自体が無効
    expect(pathNames).not.toContain('items.*.*');
    expect(pathNames).not.toContain('bad..path');
    // キーフィールド名が非フラットなら行のフィールド候補だけ落とす（リストパスは有効）
    expect(pathNames).toContain('rows.*');
    expect(pathNames).not.toContain('rows.*.a.b');
  });

  it('JSON のトップレベル $ キーはパスにしない', () => {
    const paths = analyzeJsonPaths('{"count": 0, "$streams": {"metrics": {}}}');
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('count');
    expect(pathNames).not.toContain('$streams');
    expect(pathNames).not.toContain('$streams.metrics');
  });
});

describe('analyzeStatePaths — トップレベル走査のトークン境界', () => {
  it('行コメント内の `word:` をプロパティにせず、後続の宣言も見失わない', () => {
    const paths = analyzeStatePaths(`
export default {
  // note: 行コメント内のコロン
  count: 0,
  total: 0,
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).not.toContain('note');
    expect(pathNames).toContain('count');
    expect(pathNames).toContain('total');
  });

  it('ブロックコメント内の `word:` をプロパティにせず、後続の宣言も見失わない', () => {
    const paths = analyzeStatePaths(`
export default {
  /* memo: ブロックコメント内のコロン
     more: 複数行 */
  count: 0,
  total: 0,
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).not.toContain('memo');
    expect(pathNames).not.toContain('more');
    expect(pathNames).toContain('count');
    expect(pathNames).toContain('total');
  });

  it('文字列リテラル内の `word:` をプロパティにせず、後続の宣言も見失わない', () => {
    // 既定引数に `)` を含むメソッドは走査対象の構文として認識できないため、
    // 走査位置が本体内に入る。その中の文字列が構文として読まれないことを確かめる。
    const paths = analyzeStatePaths(`
export default {
  count: 0,
  format(value = String(0)) {
    return "ratio: " + value;
  },
  total: 0,
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).not.toContain('ratio');
    expect(pathNames).toContain('count');
    expect(pathNames).toContain('total');
  });

  it('文字列リテラル内の `//` をコメント開始と誤認しない', () => {
    const paths = analyzeStatePaths(`
export default {
  endpoint: "https://example.com/api",
  ready: false,
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).toContain('endpoint');
    expect(pathNames).toContain('ready');
  });

  it('getter 本体をスキップして後続の宣言を見失わない', () => {
    const paths = analyzeStatePaths(`
export default {
  a: 1,
  get u() { return "https:"; },
  b: 2,
};`);
    const pathNames = paths.map(p => p.path);
    expect(pathNames).not.toContain('https');
    expect(pathNames).toContain('a');
    expect(pathNames).toContain('u');
    expect(pathNames).toContain('b');
  });

  it('setter をアクセサとして認識する', () => {
    const paths = analyzeStatePaths(`
export default {
  set "form.name"(value) { this._name = value; },
};`);
    expect(paths.map(p => p.path)).toContain('form.name');
    expect(paths.find(p => p.path === 'form.name')?.kind).toBe('computed');
  });

  it('get/set ペアは 1 つの候補にまとめ、引数名をメソッドとして拾わない', () => {
    const paths = analyzeStatePaths(`
export default {
  _last: null,
  get "ws.message"() { return this._last; },
  set "ws.message"(value) { this._last = value; },
  ready: false,
};`);
    const pathNames = paths.map(p => p.path);
    expect(paths.filter(p => p.path === 'ws.message')).toHaveLength(1);
    expect(pathNames).not.toContain('value');
    expect(pathNames).toContain('ready');
  });
});

describe('analyzeSchemaPaths — stateSchema（sidecar）からの候補', () => {
  it('properties → data（typeHint は type から・integer は number）、配列 → .* / .length、items の子へ再帰', () => {
    const schema = {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        name: { type: 'string' },
        users: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    };
    const byPath = new Map(analyzeSchemaPaths(schema).map(p => [p.path, p]));
    expect(byPath.get('count')).toMatchObject({ kind: 'data', typeHint: 'number', fromSchema: true });
    expect(byPath.get('name')).toMatchObject({ typeHint: 'string' });
    expect(byPath.get('users')).toMatchObject({ kind: 'data', typeHint: 'array' });
    expect(byPath.get('users.*')).toMatchObject({ kind: 'list', fromSchema: true });
    expect(byPath.get('users.length')).toMatchObject({ kind: 'data', typeHint: 'number' });
    expect(byPath.get('users.*.name')).toMatchObject({ typeHint: 'string' });
    expect(byPath.get('users.*.tags')).toMatchObject({ typeHint: 'array' });
    expect(byPath.get('users.*.tags.*')).toMatchObject({ kind: 'list', typeHint: 'string' });
    expect(byPath.get('users.*.tags.length')).toMatchObject({ typeHint: 'number' });
  });

  it('anyOf は null を除いて合併、enum / const は要素型、$ref は $defs で解決し循環は打ち切る', () => {
    const schema = {
      $defs: {
        user: {
          type: 'object',
          properties: { name: { type: 'string' }, friend: { $ref: '#/$defs/user' } },
        },
      },
      type: 'object',
      properties: {
        maybe: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        mode: { enum: ['a', 'b'] },
        flag: { const: true },
        owner: { $ref: '#/$defs/user' },
        mixed: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        dangling: { $ref: '#/$defs/nope' },
        external: { $ref: 'https://example.com/x' },
      },
    };
    const paths = analyzeSchemaPaths(schema, 'other');
    const byPath = new Map(paths.map(p => [p.path, p]));
    expect(byPath.get('maybe')).toMatchObject({ typeHint: 'string' });
    expect(byPath.get('mode')).toMatchObject({ typeHint: 'string' });
    expect(byPath.get('flag')).toMatchObject({ typeHint: 'boolean' });
    expect(byPath.get('owner')).toMatchObject({ typeHint: 'object' });
    expect(byPath.get('owner.name')).toMatchObject({ typeHint: 'string' });
    expect(byPath.get('owner.friend.name')).toMatchObject({ typeHint: 'string' });
    expect(byPath.get('mixed')).toMatchObject({ typeHint: 'string|number' });
    // 未解決 / 外部 $ref は型未確定のまま候補にはなる（存在判定は resolveSchemaPath の担当）
    expect(byPath.get('dangling')).toBeDefined();
    expect(byPath.get('dangling')!.typeHint).toBeUndefined();
    expect(byPath.get('external')!.typeHint).toBeUndefined();
    // 再帰は深さ上限で止まる（無限に展開しない）
    expect(paths.length).toBeLessThan(60);
  });

  it('トップレベルの $ キーは捨て、素の {} は typeHint 無し、深さ上限（5）で打ち切る', () => {
    const schema = {
      type: 'object',
      properties: {
        $watch: { type: 'object', properties: { x: { type: 'number' } } },
        meta: {},
        a: { type: 'object', properties: { b: { type: 'object', properties: { c: { type: 'object', properties: { d: { type: 'object', properties: { e: { type: 'object', properties: { f: { type: 'number' } } } } } } } } } } },
      },
    };
    const names = analyzeSchemaPaths(schema).map(p => p.path);
    expect(names.some(n => n.startsWith('$watch'))).toBe(false);
    expect(names).toContain('meta');
    expect(analyzeSchemaPaths(schema).find(p => p.path === 'meta')!.typeHint).toBeUndefined();
    expect(names).toContain('a.b.c.d.e');
    expect(names).not.toContain('a.b.c.d.e.f');
  });
});

describe('mergeSchemaCandidates — script / JSON 候補との合流（D12: schema 優先）', () => {
  const script: PathCandidate[] = [
    { path: 'count', kind: 'data', typeHint: 'string', rawInitial: '"0"' },
    { path: 'inc', kind: 'method' },
    { path: 'other', kind: 'data', typeHint: 'string' },
  ];

  it('同じパスは schema が勝ち、schema に無い候補（メソッド等）は残る', () => {
    const merged = mergeSchemaCandidates(script, new Map([['default', { type: 'object', properties: { count: { type: 'number' } } }]]));
    const countCands = merged.filter(p => p.path === 'count');
    expect(countCands).toHaveLength(1);
    expect(countCands[0]).toMatchObject({ typeHint: 'number', fromSchema: true });
    expect(merged.some(p => p.path === 'inc' && p.kind === 'method')).toBe(true);
    expect(merged.find(p => p.path === 'other')).toMatchObject({ typeHint: 'string' });
  });

  it('applicationStates が無い / 空ならそのまま返す', () => {
    expect(mergeSchemaCandidates(script)).toBe(script);
    expect(mergeSchemaCandidates(script, new Map())).toBe(script);
  });
});
