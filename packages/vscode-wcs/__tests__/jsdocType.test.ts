/**
 * jsdocType.test.ts
 *
 * JSDoc `@type` / `@typedef` の型表現から、`null` / `[]` で始まるリストの行の形を読む。
 * `<wcs-fetch>` / `<wcs-storage>` から届くデータは初期値から形が読めず、行の `.name` が
 * `wcs/binding-path-missing` になっていた（チュートリアル Part 2 の試作で 7 件）。
 */
import { describe, it, expect } from 'vitest';
import {
  collectJsDocTypedefs,
  jsDocShape,
  jsDocTypeHint,
  parseJsDocType,
  readJsDocTypeBefore,
} from '../src/service/jsdocType.js';
import { analyzeStatePaths, maskCommentsAndStrings } from '../src/service/stateAnalyzer.js';
import { validateBindings } from '../src/service/bindingValidator.js';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';

describe('parseJsDocType — 型表現のパース', () => {
  it('名前・配列・合併・オブジェクトを読むこと', () => {
    expect(parseJsDocType('string')).toEqual({ kind: 'name', name: 'string' });
    expect(parseJsDocType('number[]')).toEqual({ kind: 'array', element: { kind: 'name', name: 'number' } });
    expect(parseJsDocType('string | null')).toEqual({
      kind: 'union',
      members: [{ kind: 'name', name: 'string' }, { kind: 'name', name: 'null' }],
    });
    expect(parseJsDocType('{ id: number, "full-name"?: string; tags: string[] }')).toEqual({
      kind: 'object',
      fields: [
        { name: 'id', type: { kind: 'name', name: 'number' } },
        { name: 'full-name', type: { kind: 'name', name: 'string' } },
        { name: 'tags', type: { kind: 'array', element: { kind: 'name', name: 'string' } } },
      ],
    });
  });

  it('Array<T> / Array.<T> / ReadonlyArray<T> / (A | B)[] を配列として読むこと', () => {
    for (const text of ['Array<{ id: number }>', 'Array.<{ id: number }>', 'ReadonlyArray<{ id: number }>', '{ id: number }[]']) {
      const type = parseJsDocType(text);
      expect(type?.kind, text).toBe('array');
    }
    const union = parseJsDocType('(string | number)[]');
    expect(union).toEqual({
      kind: 'array',
      element: { kind: 'union', members: [{ kind: 'name', name: 'string' }, { kind: 'name', name: 'number' }] },
    });
  });

  it('?T は T | null、!T は T として読むこと', () => {
    expect(jsDocTypeHint(parseJsDocType('?string')!)).toBe('null|string');
    expect(jsDocTypeHint(parseJsDocType('!string')!)).toBe('string');
  });

  it('関数型・リテラル型・ほかの総称は形を持たない（unknown）として読み切ること', () => {
    for (const text of ['(a: number) => void', '() => string', 'function(number): string', '"a" | "b"', 'Map<string, number>', '*', 'typeof x']) {
      const type = parseJsDocType(text);
      expect(type, text).not.toBeNull();
      expect(jsDocShape(type!, new Map())).toEqual({ element: null, fields: [] });
    }
  });

  it('索引シグネチャ・Record<string, T>・Object<string, T> は任意のキーのオブジェクト（index）として読むこと（community-hall）', () => {
    // 索引シグネチャはフィールドに数えず（任意のキー）、値の型を index に持つ
    expect(parseJsDocType('{ [key: string]: number, id: number }')).toEqual({
      kind: 'object',
      fields: [{ name: 'id', type: { kind: 'name', name: 'number' } }],
      index: { kind: 'name', name: 'number' },
    });
    const bool = { kind: 'name', name: 'boolean' };
    for (const text of ['Record<string, boolean>', 'Object<string, boolean>', 'Object.<string, boolean>', '{ [id: string]: boolean }', '{ [K in Keys]?: boolean }']) {
      expect(jsDocShape(parseJsDocType(text)!, new Map()), text).toEqual({ element: null, fields: [], index: bool });
    }
    // 合併・null を挟んでも、@typedef の名前の先でも index は残る
    const typedefs = new Map([['Flags', parseJsDocType('Record<string, boolean>')!]]);
    expect(jsDocShape(parseJsDocType('Flags | null')!, typedefs).index).toEqual(bool);
    expect(jsDocTypeHint(parseJsDocType('Record<string, boolean> | null')!)).toBe('null|object');
  });

  it('キーが文字列リテラルの合併の Record はその名前のフィールド、Readonly / Partial / Required は引数の形', () => {
    expect(jsDocShape(parseJsDocType('Record<"open" | \'closed\', number>')!, new Map())).toEqual({
      element: null,
      fields: [{ name: 'open', type: { kind: 'name', name: 'number' } }, { name: 'closed', type: { kind: 'name', name: 'number' } }],
    });
    expect(jsDocShape(parseJsDocType('Readonly<{ id: number }>')!, new Map()).fields.map((f) => f.name)).toEqual(['id']);
    expect(jsDocShape(parseJsDocType('Partial<Record<string, number>>')!, new Map()).index).toEqual({ kind: 'name', name: 'number' });
    expect(parseJsDocType('Required<{ id: number }[]>')?.kind).toBe('array');
    // 閉じない形は null（推測しない）
    expect(parseJsDocType('Record<"a", number')).toBeNull();
  });

  it('読めない表現は null（推測で形を作らない）', () => {
    for (const text of ['', '{ id: }', '{ id number }', 'Array<', 'string |', '{ foo(): void }', '-']) {
      expect(parseJsDocType(text), text).toBeNull();
    }
  });
});

describe('jsDocTypeHint — 型ヒント', () => {
  it('既存の推定と同じ語彙で、構成員を | で結ぶこと', () => {
    expect(jsDocTypeHint(parseJsDocType('{ id: number }[] | null')!)).toBe('array|null');
    expect(jsDocTypeHint(parseJsDocType('Array | null')!)).toBe('array|null');
    expect(jsDocTypeHint(parseJsDocType('{ id: number }')!)).toBe('object');
    expect(jsDocTypeHint(parseJsDocType('undefined | boolean')!)).toBe('boolean|null');
    // ヒントにならない名前だけなら undefined（値からの推定に任せる）
    expect(jsDocTypeHint(parseJsDocType('Product')!)).toBeUndefined();
  });

  it('@typedef の名前を解決してヒントにすること', () => {
    const typedefs = new Map([['Product', parseJsDocType('{ id: number }')!]]);
    expect(jsDocTypeHint(parseJsDocType('Product[] | null')!, typedefs)).toBe('array|null');
    expect(jsDocTypeHint(parseJsDocType('Product')!, typedefs)).toBe('object');
  });
});

describe('parseJsDocType — 交差型（docs/seam-apps.md、shift-desk）', () => {
  it('A & B は形を知るために合併と同じに読み、フィールドを合わせること', () => {
    const typedefs = new Map([['Ticket', parseJsDocType('{ id: number, subject: string }')!]]);
    const type = parseJsDocType('(Ticket & { messages: { text: string }[] }) | null')!;
    expect(jsDocShape(type, typedefs).fields.map((f) => f.name)).toEqual(['id', 'subject', 'messages']);
    expect(jsDocTypeHint(type, typedefs)).toBe('null|object');
  });
});

describe('readJsDocTypeBefore / collectJsDocTypedefs — コメントの読み出し', () => {
  it('1 行の JSDoc と、説明文を含む複数行の JSDoc の @type を読むこと', () => {
    const oneLine = `  /** @type {{ id: number }[] | null} */\n  catalog: null,`;
    expect(readJsDocTypeBefore(oneLine, oneLine.indexOf('catalog'))).toBe('{ id: number }[] | null');
    const multi = `  /**\n   * The products, once loaded.\n   * @type {{\n   *   id: number,\n   *   name: string\n   * }[] | null}\n   */\n  catalog: null,`;
    expect(parseJsDocType(readJsDocTypeBefore(multi, multi.indexOf('catalog'))!)).toEqual({
      kind: 'union',
      members: [
        {
          kind: 'array',
          element: {
            kind: 'object',
            fields: [
              { name: 'id', type: { kind: 'name', name: 'number' } },
              { name: 'name', type: { kind: 'name', name: 'string' } },
            ],
          },
        },
        { kind: 'name', name: 'null' },
      ],
    });
  });

  it('直前が JSDoc でなければ読まないこと（間にコードがある・/* */ の普通のコメント）', () => {
    const code = `/** @type {string} */ a: 1,\n  b: null,`;
    expect(readJsDocTypeBefore(code, code.indexOf('b:'))).toBeUndefined();
    const plain = `/* @type {string} */ b: null,`;
    expect(readJsDocTypeBefore(plain, plain.indexOf('b:'))).toBeUndefined();
  });

  it('@typedef を集め、文字列の中の /** は拾わないこと', () => {
    const script = `/** @typedef {{ id: number, name: string }} Product */
const s = "/** @typedef {{ x: number }} Fake */";
/**
 * A line in the cart.
 * @typedef {{ id: number, quantity: number }} Line
 */
export default {};`;
    const typedefs = collectJsDocTypedefs(script, maskCommentsAndStrings(script));
    expect([...typedefs.keys()]).toEqual(['Product', 'Line']);
  });
});

describe('analyzeStatePaths — JSDoc で宣言した形', () => {
  const pathsOf = (script: string) => analyzeStatePaths(script).map((p) => p.path);

  it('null で始まるリストの行の形を @type から読むこと（fetch の結果）', () => {
    const script = `export default {
  /** @type {{ id: number, name: string, price: number }[] | null} */
  catalog: null,
};`;
    const paths = analyzeStatePaths(script);
    expect(paths.map((p) => p.path)).toEqual(
      expect.arrayContaining(['catalog', 'catalog.*', 'catalog.length', 'catalog.*.id', 'catalog.*.name', 'catalog.*.price']),
    );
    const catalog = paths.find((p) => p.path === 'catalog')!;
    expect(catalog.typeHint).toBe('array|null');
    // シードの検査（storage / trigger）は本当の初期値を見る
    expect(catalog.rawInitial).toBe('null');
    expect(paths.find((p) => p.path === 'catalog.*.price')!.typeHint).toBe('number');
    // 初期値ではないので rawInitial は付けない
    expect(paths.find((p) => p.path === 'catalog.*.id')!.rawInitial).toBeUndefined();
  });

  it('@typedef の名前と入れ子のリストを解決すること', () => {
    const script = `/** @typedef {{ id: number, tags: { label: string }[] }} Product */
export default {
  /** @type {Product[] | null} */
  catalog: null,
};`;
    expect(pathsOf(script)).toEqual(expect.arrayContaining(['catalog.*.id', 'catalog.*.tags', 'catalog.*.tags.*', 'catalog.*.tags.*.label']));
  });

  it('[] で始まるリストにも足し、値から読めた候補は上書きしないこと', () => {
    const script = `export default {
  /** @type {{ id: number, name: string }[]} */
  items: [{ id: 1, extra: true }],
};`;
    const paths = analyzeStatePaths(script);
    expect(paths.map((p) => p.path)).toEqual(expect.arrayContaining(['items.*.id', 'items.*.extra', 'items.*.name']));
    // 同じパスを 2 度載せない
    expect(paths.filter((p) => p.path === 'items.*').length).toBe(1);
    expect(paths.filter((p) => p.path === 'items.*.id').length).toBe(1);
  });

  it('オブジェクトの子にも足すこと', () => {
    const script = `export default {
  /** @type {{ user: { name: string } | null }} */
  session: {},
};`;
    expect(pathsOf(script)).toEqual(expect.arrayContaining(['session.user', 'session.user.name']));
  });

  it('自己参照の @typedef で止まること', () => {
    const script = `/** @typedef {{ name: string, children: Node[] }} Node */
export default {
  /** @type {Node[]} */
  tree: [],
};`;
    const paths = pathsOf(script);
    expect(paths).toEqual(expect.arrayContaining(['tree.*.name', 'tree.*.children.*.name']));
    expect(paths.length).toBeLessThan(100);
  });

  it('getter が写す元の形にもなること（catalog ?? []）', () => {
    const script = `export default {
  /** @type {{ id: number, name: string }[] | null} */
  catalog: null,
  get products() { return this.catalog ?? []; },
};`;
    expect(pathsOf(script)).toEqual(expect.arrayContaining(['products.*', 'products.*.name']));
  });
});

describe('validateBindings — JSDoc の形で行の束縛が通ること', () => {
  const page = (annotation: string) => `
<wcs-state>
  <script type="module">
    ${annotation.startsWith('@typedef') ? `/** ${annotation} */` : ''}
    export default {
      ${annotation.startsWith('@typedef') ? '/** @type {Product[] | null} */' : `/** ${annotation} */`}
      catalog: null,
      get products() { return this.catalog ?? []; },
    };
  </script>
</wcs-state>
<template data-wcs="for: products"><p data-wcs="textContent: .name"></p><p data-wcs="textContent: .nmae"></p></template>`;

  for (const annotation of [
    '@type {{ id: number, name: string }[] | null}',
    '@typedef {{ id: number, name: string }} Product',
  ]) {
    it(`${annotation.split(' ')[0]} — 宣言したフィールドは通り、打ち間違いは報告されること`, () => {
      const missing = validateBindings(page(annotation), 'data-wcs')
        .filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing)
        .map((d) => d.message);
      expect(missing).toHaveLength(1);
      expect(missing[0]).toContain('.nmae');
    });
  }
});

// 継ぎ目アプリ community-hall の L3: getter の `@returns {Record<string, boolean>}` の下のパスを
// `wcs/binding-path-missing` にしていた（生成した stateSchema の同じ型なら下は開いていて黙る）
const validate = (html: string): WcsDiagnostic[] => validateDocument(html, { locale: 'en' });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const spans = (html: string, diags: readonly WcsDiagnostic[]): string[][] => diags.map((d) => [d.code, html.slice(d.start, d.end)]);

describe('索引シグネチャの下は開いている — getter・データの JSDoc（community-hall）', () => {
  const page = (body: string, bindings: string): string =>
    `<wcs-state><script type="module">export default { ${body} };</script></wcs-state>${bindings}`;

  it('getter の @returns {Record<string, boolean>} の下は黙る（stateSchema の {} の下と同じ）。名前の打ち間違いは言う', () => {
    const html = page(`events: [{ id: 12, open: true }],
  /** @returns {Record<string, boolean>} */
  get soldOut() { return Object.fromEntries(this.events.map((e) => ["e" + e.id, !e.open])); },`,
    `<p data-wcs="textContent: soldOut.e12"></p><p data-wcs="class.full: soldOut.e13"></p><p data-wcs="textContent: soldOt.e12"></p>`);
    const diags = validate(html);
    expect(spans(html, ofCode(diags, WcsDiagnosticCode.BindingPathMissing))).toEqual([[WcsDiagnosticCode.BindingPathMissing, 'soldOt.e12']]);
    // 作者が宣言したので「読めない」の info も出さない
    expect(ofCode(diags, WcsDiagnosticCode.PathDynamicUnknown)).toHaveLength(0);
  });

  it('getter の @type・{ [key: string]: T }・Object.<string, T>・データのキーの @type・入れ子のフィールドも同じ', () => {
    const html = page(`
  /** @type {{ [id: string]: number }} */
  get counts() { return {}; },
  /** @type {Object.<string, string>} */
  labels: {},
  /** @type {{ byId: Record<string, { name: string }> } | null} */
  cache: null,
  /** @type {Record<string, number>[]} */
  rows: [],`,
    `<p data-wcs="textContent: counts.a"></p><p data-wcs="textContent: labels.b"></p>`
    + `<p data-wcs="textContent: cache.byId.k1.name"></p><p data-wcs="textContent: cache.byid.k1"></p>`
    + `<template data-wcs="for: rows"><p data-wcs="textContent: .x"></p></template>`);
    expect(spans(html, ofCode(validate(html), WcsDiagnosticCode.BindingPathMissing))).toEqual([[WcsDiagnosticCode.BindingPathMissing, 'cache.byid.k1']]);
  });

  it('{{ }}・getter の中の読み（wcs/read-path-missing）・$watch のキーも黙る', () => {
    const html = page(`
  /** @returns {Record<string, boolean>} */
  get flags() { return {}; },
  get any() { return this["flags.x"]; },
  $watch: { "flags.y"() {} },`,
    `<template data-wcs="if: any"><p>{{ flags.z }}</p></template>`);
    const diags = validate(html);
    expect(diags.filter((d) => d.code === WcsDiagnosticCode.BindingPathMissing || d.code === WcsDiagnosticCode.ReadPathMissing
      || d.code === WcsDiagnosticCode.WatchPathMissing)).toEqual([]);
  });
});
