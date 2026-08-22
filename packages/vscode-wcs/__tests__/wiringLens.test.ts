import { describe, it, expect } from 'vitest';
import {
  getDefinitionAt,
  getHoverAt,
  getInlayHints,
  getReferencesAt,
} from '../src/core/navigation/wiringLens';
import { parseWcsStateElements } from '../src/language/htmlParse';

/**
 * B3（hover / go-to-definition / find-references / inlay hint）の純ロジック層。
 * 位置は全て indexOf で求める — フィクスチャ編集でオフセットが黙ってずれるのを防ぐ。
 */
const SAMPLE = `<!doctype html>
<wcs-state>
  <script type="module">
    export default {
      count: 0,
      user: { name: 'Alice' },
      items: [{ label: 'first' }],
      get total() { return this.count * 2; },
      get "items.*.upper"() { return this["items.*.label"].toUpperCase(); },
      $commandTokens: ['play'],
      $eventTokens: ['changed'],
      increment() { this.count += 1; },
    };
  </script>
</wcs-state>
<wcs-state name="cart">
  <script type="module">
    export default { total: 100 };
  </script>
</wcs-state>
<wcs-state name="ext" src="./ext-state.js"></wcs-state>
<div data-wcs="textContent: count | fix(0)"></div>
<input data-wcs="value#ro: user.name">
<input data-wcs="value#init=element,sync=connect: user.name">
<input data-wcs="value#onblur: user.name">
<button data-wcs="onclick#prevent: increment"></button>
<button data-wcs="onclick: $command.play"></button>
<wcs-fetch data-wcs="eventToken.value: changed"></wcs-fetch>
<template data-wcs="for: items">
  <span data-wcs="textContent: .label"></span>
</template>
<p>{{ total }}</p>
<p>{{ count | fix(0) }}</p>
<!--@@: user.name -->
<span data-wcs="textContent: total@cart"></span>
<span data-wcs="textContent: missing.path"></span>
<span data-wcs="textContent: something@ext"></span>
`;

/** needle の path 部分の中央オフセット（occurrence / トークンヒット用） */
function offsetIn(needle: string, token: string): number {
  const base = SAMPLE.indexOf(needle);
  expect(base, `fixture must contain: ${needle}`).toBeGreaterThanOrEqual(0);
  const local = needle.indexOf(token);
  expect(local, `needle must contain token: ${token}`).toBeGreaterThanOrEqual(0);
  return base + local + Math.floor(token.length / 2);
}

describe('wiringLens: hover（§5-2）', () => {
  it('データパスの hover に種別・型・state・宣言行が出ること', () => {
    const hover = getHoverAt(SAMPLE, offsetIn('"textContent: count | fix(0)"', 'count'), { locale: 'en' })!;
    expect(hover).not.toBeNull();
    expect(hover.markdown).toContain('`count`');
    expect(hover.markdown).toContain('data (number)');
    expect(hover.markdown).toContain('`default`');
    expect(hover.markdown).toMatch(/L\d+/);
  });

  it('locale 未指定の既定は ja であること（パッケージ既定と同じ）', () => {
    const hover = getHoverAt(SAMPLE, offsetIn('"textContent: count | fix(0)"', 'count'))!;
    expect(hover.markdown).toContain('データ (number)');
  });

  it('for 短縮パスの hover が展開後パスを示すこと', () => {
    const hover = getHoverAt(SAMPLE, offsetIn('"textContent: .label"', '.label'))!;
    expect(hover.markdown).toContain('`.label` → `items.*.label`');
  });

  it('computed（型ヒント無し）は「型は静的解析対象外」を明示すること（ja）', () => {
    const hover = getHoverAt(SAMPLE, offsetIn('{{ total }}', 'total'), { locale: 'ja' })!;
    expect(hover.markdown).toContain('computed');
    expect(hover.markdown).toContain('型は静的解析対象外');
  });

  it('src 外部 state のパスは「外部定義」を明示すること', () => {
    const hover = getHoverAt(SAMPLE, offsetIn('something@ext', 'something'), { locale: 'en' })!;
    expect(hover.markdown).toContain('./ext-state.js');
    expect(hover.markdown).toContain('not statically analyzed');
  });

  it('未知パスには hover を出さないこと（誤 hint ゼロ — lint の領分）', () => {
    expect(getHoverAt(SAMPLE, offsetIn('missing.path', 'missing.path'))).toBeNull();
  });

  it('@state 越境パスの hover が対象 state 側で解決されること', () => {
    const hover = getHoverAt(SAMPLE, offsetIn('total@cart', 'total'), { locale: 'en' })!;
    expect(hover.markdown).toContain('`cart`');
    expect(hover.markdown).toContain('data (number)');
  });

  it('フィルタ名の hover にシグネチャ・説明・型行が出ること', () => {
    const hover = getHoverAt(SAMPLE, offsetIn('count | fix(0)"', 'fix'))!;
    expect(hover.markdown).toContain('fix(');
    expect(hover.markdown).toContain('number → string');
  });

  it('mustache 内のフィルタ名でも hover が出ること', () => {
    const hover = getHoverAt(SAMPLE, offsetIn('{{ count | fix(0) }}', 'fix'))!;
    expect(hover.markdown).toContain('fix(');
  });

  it('フラグ修飾子 #ro の hover が意味を説明すること', () => {
    const hover = getHoverAt(SAMPLE, offsetIn('"value#ro: user.name"', 'ro'), { locale: 'en' })!;
    expect(hover.markdown).toContain('#ro');
    expect(hover.markdown).toContain('read-only');
  });

  it('key=value 修飾子 init= / sync= の hover が権限とタイミングを説明すること', () => {
    const initHover = getHoverAt(SAMPLE, offsetIn('value#init=element,sync=connect', 'init'), { locale: 'en' })!;
    expect(initHover.markdown).toContain('initial sync');
    const syncHover = getHoverAt(SAMPLE, offsetIn('value#init=element,sync=connect', 'sync=connect'), { locale: 'en' })!;
    expect(syncHover.markdown).toContain('snapshot');
  });

  it('on<event> 修飾子の hover がトリガーイベント上書きを説明すること', () => {
    const hover = getHoverAt(SAMPLE, offsetIn('"value#onblur: user.name"', 'onblur'), { locale: 'en' })!;
    expect(hover.markdown).toContain('`blur`');
  });

  it('eventToken の右辺（トークン名）の hover が event トークンと明示すること', () => {
    const hover = getHoverAt(SAMPLE, offsetIn('"eventToken.value: changed"', 'changed'), { locale: 'en' })!;
    expect(hover.markdown).toContain('event token');
    expect(hover.markdown).toMatch(/L\d+/); // $eventTokens 宣言行
  });

  it('パス・トークン外のオフセットでは hover を出さないこと', () => {
    expect(getHoverAt(SAMPLE, SAMPLE.indexOf('<!doctype'))).toBeNull();
  });
});

describe('wiringLens: go-to-definition（§5-3）', () => {
  it('ドットパスから第 1 セグメントの宣言へジャンプすること', () => {
    const definition = getDefinitionAt(SAMPLE, offsetIn('"value#ro: user.name"', 'user.name'))!;
    const target = SAMPLE.slice(definition.targetRange.start, definition.targetRange.end);
    expect(target).toBe('user');
  });

  it('for 短縮パスは展開後の宣言（第 1 セグメント items）へジャンプすること', () => {
    const definition = getDefinitionAt(SAMPLE, offsetIn('"textContent: .label"', '.label'))!;
    const target = SAMPLE.slice(definition.targetRange.start, definition.targetRange.end);
    expect(target).toBe('items');
  });

  it('ワイルドカード getter は展開後の完全一致宣言へジャンプすること', () => {
    // for 内の短縮 `.upper` → items.*.upper → 引用符付き宣言名と完全一致
    const html = SAMPLE.replace('textContent: .label', 'textContent: .upper');
    const needle = '"textContent: .upper"';
    const offset = html.indexOf(needle) + needle.indexOf('.upper') + 3;
    const definition = getDefinitionAt(html, offset)!;
    expect(definition).not.toBeNull();
    const target = html.slice(definition.targetRange.start, definition.targetRange.end);
    expect(target).toBe('items.*.upper');
  });

  it('$command.<n> は $commandTokens 宣言へジャンプすること', () => {
    const definition = getDefinitionAt(SAMPLE, offsetIn('"onclick: $command.play"', '$command.play'))!;
    const target = SAMPLE.slice(definition.targetRange.start, definition.targetRange.end);
    expect(target).toBe('$commandTokens');
  });

  it('eventToken の右辺は $eventTokens 宣言へジャンプすること', () => {
    const definition = getDefinitionAt(SAMPLE, offsetIn('"eventToken.value: changed"', 'changed'))!;
    const target = SAMPLE.slice(definition.targetRange.start, definition.targetRange.end);
    expect(target).toBe('$eventTokens');
  });

  it('src 外部 state のパスは <wcs-state src=…> 開始タグへフォールバックすること', () => {
    const definition = getDefinitionAt(SAMPLE, offsetIn('something@ext', 'something'))!;
    const target = SAMPLE.slice(definition.targetRange.start, definition.targetRange.end);
    expect(target).toContain('<wcs-state name="ext"');
    expect(target).toContain('./ext-state.js');
  });

  it('宣言が無くフォールバックも無いパスでは null を返すこと', () => {
    expect(getDefinitionAt(SAMPLE, offsetIn('missing.path', 'missing.path'))).toBeNull();
  });
});

describe('wiringLens: find-references（§5-3）', () => {
  it('出現起点: 展開後パスの完全一致で全チャネルの出現を集めること', () => {
    const references = getReferencesAt(SAMPLE, offsetIn('"value#ro: user.name"', 'user.name'), false)!;
    // 属性 3 箇所 + コメントバインディング 1 箇所（missing.path 等は含まない）
    expect(references).toHaveLength(4);
    for (const reference of references) {
      expect(SAMPLE.slice(reference.range.start, reference.range.end)).toBe('user.name');
    }
  });

  it('includeDeclaration で宣言サイトが先頭に付くこと', () => {
    const references = getReferencesAt(SAMPLE, offsetIn('"value#ro: user.name"', 'user.name'), true)!;
    expect(references).toHaveLength(5);
    expect(references[0].isDeclaration).toBe(true);
    expect(SAMPLE.slice(references[0].range.start, references[0].range.end)).toBe('user');
  });

  it('宣言起点: 宣言名とその配下パスの出現を集めること（短縮形も統合）', () => {
    const declOffset = SAMPLE.indexOf("items: [{ label: 'first' }]");
    const references = getReferencesAt(SAMPLE, declOffset + 2, false)!;
    // for: items（属性）+ .label（短縮 → items.*.label）
    expect(references).toHaveLength(2);
    const texts = references.map((r) => SAMPLE.slice(r.range.start, r.range.end)).sort();
    expect(texts).toEqual(['.label', 'items']);
  });

  it('宣言起点: $commandTokens から $command.* の出現を集めること', () => {
    const declOffset = SAMPLE.indexOf('$commandTokens');
    const references = getReferencesAt(SAMPLE, declOffset + 2, false)!;
    expect(references).toHaveLength(1);
    expect(SAMPLE.slice(references[0].range.start, references[0].range.end)).toBe('$command.play');
  });

  it('宣言起点: $eventTokens から eventToken 出現を集めること', () => {
    const declOffset = SAMPLE.indexOf('$eventTokens');
    const references = getReferencesAt(SAMPLE, declOffset + 2, false)!;
    expect(references).toHaveLength(1);
    expect(SAMPLE.slice(references[0].range.start, references[0].range.end)).toBe('changed');
  });

  it('@state 越境の参照が対象 state 側でだけ集まること', () => {
    const references = getReferencesAt(SAMPLE, offsetIn('total@cart', 'total'), false)!;
    // {{ total }}（default state）は含まれない
    expect(references).toHaveLength(1);
  });

  it('パス・宣言のどちらでもないオフセットでは null を返すこと', () => {
    expect(getReferencesAt(SAMPLE, SAMPLE.indexOf('<!doctype'), false)).toBeNull();
  });
});

describe('wiringLens: inlay hint（§5-2）', () => {
  it('for 短縮パスに展開後パスのヒントが付くこと', () => {
    const hints = getInlayHints(SAMPLE, 0, SAMPLE.length);
    const shorthand = hints.filter((h) => h.kind === 'shorthand');
    expect(shorthand).toHaveLength(1);
    expect(shorthand[0].label).toBe('= items.*.label');
    // 挿入位置は `.label` の直後
    const needle = '"textContent: .label"';
    const pathEnd = SAMPLE.indexOf(needle) + needle.indexOf('.label') + '.label'.length;
    expect(shorthand[0].offset).toBe(pathEnd);
  });

  it('フィルタ鎖の結果型ヒントが式末尾に付くこと（属性 + mustache）', () => {
    const hints = getInlayHints(SAMPLE, 0, SAMPLE.length);
    const filterType = hints.filter((h) => h.kind === 'filterType');
    // `count | fix(0)` の属性と mustache の 2 箇所（fix → string）
    expect(filterType).toHaveLength(2);
    for (const hint of filterType) {
      expect(hint.label).toBe('→ string');
    }
  });

  it('範囲外のヒントは返さないこと', () => {
    const hints = getInlayHints(SAMPLE, 0, 10);
    expect(hints).toHaveLength(0);
  });

  it('未知の入力型を passthrough フィルタが通す場合はヒントを出さないこと', () => {
    // total は computed（型不明）— upper は passthrough なので最終型も不明
    const html = SAMPLE.replace('{{ total }}', '{{ total | upper }}');
    const hints = getInlayHints(html, 0, html.length).filter((h) => h.kind === 'filterType');
    // count | fix(0) の 2 箇所のまま増えない
    expect(hints).toHaveLength(2);
  });
});

describe('wiringLens: レビュー指摘の回帰（誤 hint ゼロ）', () => {
  it('引用符付き引数内のフィルタ名部分一致には hover を出さず、実フィルタでは出すこと', () => {
    const html = `<wcs-state><script type="module">export default { tags: ['a'] };</script></wcs-state>
<span data-wcs="textContent: tags | join('uc') | uc"></span>`;
    const attr = "textContent: tags | join('uc') | uc";
    const base = html.indexOf(attr);
    // 引数文字列 'uc' の内側 → フィルタ hover は出ない
    expect(getHoverAt(html, base + attr.indexOf("'uc'") + 1)).toBeNull();
    // 末尾の実フィルタ uc → 正しく hover が出る
    const hover = getHoverAt(html, base + attr.lastIndexOf('uc'), { locale: 'en' })!;
    expect(hover.markdown).toContain('`uc`');
    const text = html.slice(hover.range.start, hover.range.end);
    expect(text).toBe('uc');
    expect(hover.range.start).toBe(base + attr.lastIndexOf('uc'));
  });

  it('for パスの @state / フィルタは正本パーサで除去してから展開すること（ランタイムの書き換えと同一）', () => {
    const html = `<wcs-state name="cart"><script type="module">export default { rows: [{ label: 1 }] };</script></wcs-state>
<template data-wcs="for: rows@cart"><span data-wcs="textContent: .label"></span></template>
<template data-wcs="for: rows|slice(0,2)"><span data-wcs="textContent: .label"></span></template>`;
    const labels = getInlayHints(html, 0, html.length)
      .filter((h) => h.kind === 'shorthand')
      .map((h) => h.label);
    expect(labels).toEqual(['= rows.*.label', '= rows.*.label']);
  });

  it('passthrough フィルタ（defaults / null）は型を断定せずヒントを抑止すること', () => {
    const html = `<wcs-state><script type="module">export default { count: 0 };</script></wcs-state>
<span data-wcs="textContent: count | defaults('N/A')"></span>
<span data-wcs="textContent: count | defaults('N/A') | number"></span>`;
    const labels = getInlayHints(html, 0, html.length)
      .filter((h) => h.kind === 'filterType')
      .map((h) => h.label);
    // defaults 終端は型不明で抑止・後続に具体型（number）があればそちらで確定
    expect(labels).toEqual(['→ number']);
    // フィルタ hover も型行（入力型を維持）を出さない — description のみ
    const attr = "textContent: count | defaults('N/A')";
    const hover = getHoverAt(html, html.indexOf(attr) + attr.indexOf('defaults') + 3, { locale: 'en' })!;
    expect(hover.markdown).toContain('defaults');
    expect(hover.markdown).not.toContain('keeps input type');
  });

  it('$1（ループ添字）の references は for 横断で統合されないこと（同一ループ実体のみ）', () => {
    const html = `<wcs-state><script type="module">export default { users: ['u'], admins: ['a'] };</script></wcs-state>
<template data-wcs="for: users"><i data-wcs="textContent: $1"></i></template>
<template data-wcs="for: admins"><i data-wcs="textContent: $1"></i></template>`;
    // users ループの $1 から: admins 側は別の参照先なので含まれない
    const refs = getReferencesAt(html, html.indexOf('$1') + 1, false)!;
    expect(refs).toHaveLength(1);
  });

  it('ネストした相対 for（for: .products）を外側チェーンから再帰合成すること', () => {
    const html = `<wcs-state><script type="module">
    export default { categories: [{ products: [{ name: 'p' }] }] };
    </script></wcs-state>
<template data-wcs="for: categories">
  <template data-wcs="for: .products">
    <span data-wcs="textContent: .name"></span>
  </template>
</template>`;
    // definition: 完全展開 → 第 1 セグメント categories の宣言へ解決する
    // （hover は stateAnalyzer が入れ子配列の候補を categories.*.products で
    //   打ち切る既存制限により未知パス扱い = 沈黙。候補導出の深掘りは別件）
    const needle = '"textContent: .name"';
    const offset = html.indexOf(needle) + needle.indexOf('.name') + 2;
    const definition = getDefinitionAt(html, offset)!;
    expect(definition).not.toBeNull();
    expect(html.slice(definition.targetRange.start, definition.targetRange.end)).toBe('categories');
    // inlay: 内側 for の相対パスにも展開ヒントが付く
    const labels = getInlayHints(html, 0, html.length)
      .filter((h) => h.kind === 'shorthand')
      .map((h) => h.label)
      .sort();
    expect(labels).toEqual(['= categories.*.products', '= categories.*.products.*.name']);
    // references: 宣言 categories 起点で .products / .name の短縮出現も拾う
    const declOffset = html.indexOf('categories: [');
    const references = getReferencesAt(html, declOffset + 2, false)!;
    const texts = references.map((r) => html.slice(r.range.start, r.range.end)).sort();
    expect(texts).toEqual(['.name', '.products', 'categories']);
  });

  it('$streams 宣言起点の references が $streamStatus/$streamError の出現を拾うこと', () => {
    const html = `<wcs-state><script type="module">
    export default { $streams: { ticks: { source: 'sse' } } };
    </script></wcs-state>
<span data-wcs="textContent: $streamStatus.ticks"></span>`;
    const declOffset = html.indexOf('$streams');
    const references = getReferencesAt(html, declOffset + 2, false)!;
    expect(references).toHaveLength(1);
    expect(html.slice(references[0].range.start, references[0].range.end)).toBe('$streamStatus.ticks');
  });

  it('空白入り key=value 修飾子（#init = element）でも hover が出ること', () => {
    const html = `<wcs-state><script type="module">export default { name: '' };</script></wcs-state>
<input data-wcs="value#init = element: name">`;
    const attr = 'value#init = element: name';
    const hover = getHoverAt(html, html.indexOf(attr) + attr.indexOf('init') + 2, { locale: 'en' })!;
    expect(hover.markdown).toContain('initial sync');
  });

  it('$eventTokens 宣言起点の references は宣言済みトークン名の出現だけを拾うこと', () => {
    const html = `<wcs-state><script type="module">
    export default { $eventTokens: ['changed'] };
    </script></wcs-state>
<wcs-fetch data-wcs="eventToken.value: changed"></wcs-fetch>
<wcs-fetch data-wcs="eventToken.value: notDeclared"></wcs-fetch>`;
    const declOffset = html.indexOf('$eventTokens');
    const references = getReferencesAt(html, declOffset + 2, false)!;
    expect(references).toHaveLength(1);
    expect(html.slice(references[0].range.start, references[0].range.end)).toBe('changed');
  });
});

describe('wiringLens: lens follow-ups（spread ヒント・$N スコープ・入れ子配列候補）', () => {
  it('spread に組み込みタグの展開規模ヒント（→ N props）が付くこと', () => {
    const html = `<wcs-state><script type="module">export default { fetchX: {} };</script></wcs-state>
<wcs-fetch data-wcs="...: fetchX"></wcs-fetch>
<my-widget data-wcs="...: fetchX"></my-widget>`;
    const hints = getInlayHints(html, 0, html.length).filter((h) => h.kind === 'spread');
    // wcs-fetch = inputs 7 + properties 7 で trigger が重複 → 13。
    // ユーザー定義タグ（my-widget）は unexpanded（D8）— ヒント無し
    expect(hints).toHaveLength(1);
    expect(hints[0].label).toBe('→ 13 props');
    const attr = '"...: fetchX"';
    const exprEnd = html.indexOf(attr) + attr.length - 1;
    expect(hints[0].offset).toBe(exprEnd);
  });

  it('wcBindable を持たないカタログタグへの spread にはヒントを出さないこと', () => {
    // カタログは無宣言タグ（wcs-voice / wcs-fetch-header 等）も空契約に平坦化して
    // いるが、無宣言タグへの spread はランタイムが raiseError する構成 —
    // 「→ 0 props」を合法な展開として提示してはならない（誤 hint ゼロ）
    const html = `<wcs-state><script type="module">export default { fetchX: {} };</script></wcs-state>
<wcs-voice data-wcs="...: fetchX"></wcs-voice>
<wcs-fetch-header data-wcs="...: fetchX"></wcs-fetch-header>`;
    expect(getInlayHints(html, 0, html.length).filter((h) => h.kind === 'spread')).toHaveLength(0);
  });

  it('$1 の references が同一ループ実体だけに絞られ、ネスト内の同一参照は統合されること', () => {
    const html = `<wcs-state><script type="module">export default { users: ['u'], admins: ['a'] };</script></wcs-state>
<template data-wcs="for: users">
  <i data-wcs="textContent: $1"></i>
  <template data-wcs="for: .tags"><b data-wcs="textContent: $1"></b><s data-wcs="textContent: $2"></s></template>
</template>
<template data-wcs="for: admins"><i data-wcs="textContent: $1"></i></template>`;
    // users ループ直下の $1 から: 同一 users ループを 1 枚目に持つ出現
    //（直下 + 入れ子内の $1）が対象。admins 側の $1 は含まれない
    const first = html.indexOf('textContent: $1') + 'textContent: '.length + 1;
    const refs = getReferencesAt(html, first, false)!;
    expect(refs).toHaveLength(2);
    for (const ref of refs) {
      expect(html.slice(ref.range.start, ref.range.end)).toBe('$1');
    }
    // $2（内側ループの添字）からは自分だけ
    const second = html.indexOf('textContent: $2') + 'textContent: '.length + 1;
    const refs2 = getReferencesAt(html, second, false)!;
    expect(refs2).toHaveLength(1);
    // ループ外の $N は null のまま
    const outside = `${html}<i data-wcs="textContent: $1"></i>`;
    const lastDollar = outside.lastIndexOf('$1') + 1;
    expect(getReferencesAt(outside, lastDollar, false)).toBeNull();
  });

  it('入れ子配列の候補が導出され、深い短縮パスの hover が解決すること', () => {
    const html = `<wcs-state><script type="module">
    export default { categories: [{ products: [{ name: 'p' }], meta: { title: 't' } }] };
    </script></wcs-state>
<template data-wcs="for: categories">
  <template data-wcs="for: .products">
    <span data-wcs="textContent: .name"></span>
  </template>
</template>`;
    const needle = '"textContent: .name"';
    const offset = html.indexOf(needle) + needle.indexOf('.name') + 2;
    const hover = getHoverAt(html, offset, { locale: 'en' })!;
    expect(hover).not.toBeNull();
    expect(hover.markdown).toContain('`.name` → `categories.*.products.*.name`');
    expect(hover.markdown).toContain('data (string)');
  });
});

describe('htmlParse: WcsStateInfo のタグスパン', () => {
  it('開始タグの tagStart / tagEnd が実タグを指すこと', () => {
    const elements = parseWcsStateElements(SAMPLE);
    expect(elements).toHaveLength(3);
    const ext = elements.find((e) => e.stateName === 'ext')!;
    const tag = SAMPLE.slice(ext.tagStart, ext.tagEnd);
    expect(tag.startsWith('<wcs-state')).toBe(true);
    expect(tag.endsWith('>')).toBe(true);
    expect(tag).toContain('src="./ext-state.js"');
  });
});
