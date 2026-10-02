/**
 * volumeSrcPaths.test.ts — paths under a volume whose state is loaded with `src=` (`<wcs-state mount="cart" src="./cart.js">`).
 *
 * A volume's state is grafted under its mount path, so the root's `$watch` keys and the bindings (attributes, mustache,
 * comment bindings) read `cart.total` (the 4.0 runtime fires a root `$watch: { "cart.total"() {} }`).
 *   - When the validator can read the `src=` (fileReader; `.js` tries the same-named `.ts` first), its keys are known
 *     paths under the mount path — a typo (`cart.totl`) is still reported.
 *   - When it cannot (an unreadable path, the IDE path without a reader, contents it cannot parse), nothing under that
 *     mount path is reported missing (`wcs/watch-path-missing`'s "never fires" would be false, and a correct page would
 *     fail `--strict`).
 *   - Likewise, when the page's root state cannot be read (an unreadable root `src=`), the root's part (paths under no
 *     volume) stays silent.
 *   - With a `stateSchema`, the schema is the contract of the whole tree (volume subtrees too — `wcs-schema --mount`)
 *     and decides.
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument';
import { runValidation } from '../src/core/cli/runValidation';
import { validateWatchDeclarations } from '../src/service/watchDeclarationValidator';
import { getStatePathIndex, isUnresolvedPath } from '../src/service/statePathResolver';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics';
import type { FileReader } from '../src/service/statePathResolver';

const CART_JS = 'export default { items: [{ qty: 1 }], total: 0, get count() { return this["items"].length; } };';

/** A reader of `./cart.js` only (no `./cart.ts`); the paths it was asked for go to `requested`. */
function cartReader(files: Record<string, string> = { './cart.js': CART_JS }): FileReader & { requested: string[] } {
  const requested: string[] = [];
  const reader = ((path: string) => {
    requested.push(path);
    return files[path];
  }) as FileReader & { requested: string[] };
  reader.requested = requested;
  return reader;
}

const PATH_CODES: ReadonlySet<string> = new Set([
  WcsDiagnosticCode.BindingPathMissing, WcsDiagnosticCode.WatchPathMissing, WcsDiagnosticCode.PathNonexistent,
]);

/** The path-existence diagnostics only, as [code, text of the range]. */
function pathFindings(html: string, fileReader?: FileReader): [string, string][] {
  return validateDocument(html, { locale: 'en', ...(fileReader !== undefined ? { fileReader } : {}) })
    .filter((d: WcsDiagnostic) => PATH_CODES.has(d.code))
    .map((d) => [d.code, html.slice(d.start, d.end)]);
}

const ROOT = (watch: string): string => `<wcs-state><script type="module">
export default {
  count: 0,
  $watch: {
${watch}
  },
};
</script></wcs-state>`;

describe('src= で読むボリュームの配下のパス — 読めるとき', () => {
  const html = `<wcs-state mount="cart" src="./cart.js"></wcs-state>
${ROOT(`    "cart.total"(v) { void v; },
    "cart.items.*.qty"(v) { void v; },
    "cart.count"(v) { void v; },
    "cart.totl"(v) { void v; },`)}
<p data-wcs="textContent: cart.total"></p>
<p data-wcs="textContent: cart.totl"></p>
<template data-wcs="for: cart.items"><span data-wcs="textContent: .qty"></span>{{ .qyt }}</template>
<p>{{ cart.count }}</p>
<!--@@: cart.totl-->`;

  it('中身のキーをマウントパスの下の既知のパスに足し、打ち間違いだけを報告すること（$watch・属性・mustache・コメント束縛）', () => {
    expect(pathFindings(html, cartReader())).toEqual([
      [WcsDiagnosticCode.WatchPathMissing, 'cart.totl'],
      [WcsDiagnosticCode.BindingPathMissing, 'cart.totl'],
      [WcsDiagnosticCode.BindingPathMissing, '.qyt'],
      [WcsDiagnosticCode.BindingPathMissing, 'cart.totl'],
    ]);
  });

  it('.js は同名の .ts を先に読み、両方あれば .ts の中身が勝つこと', () => {
    const reader = cartReader({ './cart.ts': 'export default { fromTs: 1 };', './cart.js': 'export default { fromJs: 1 };' });
    const page = `<wcs-state mount="cart" src="./cart.js"></wcs-state>
${ROOT(`    "cart.fromTs"(v) { void v; },
    "cart.fromJs"(v) { void v; },`)}
<p data-wcs="textContent: cart.fromTs"></p>
<p data-wcs="textContent: cart.fromJs"></p>`;
    expect(pathFindings(page, reader)).toEqual([
      [WcsDiagnosticCode.WatchPathMissing, 'cart.fromJs'],
      [WcsDiagnosticCode.BindingPathMissing, 'cart.fromJs'],
    ]);
    const cartRequests = reader.requested.filter((p) => p.startsWith('./cart.'));
    expect(cartRequests[0]).toBe('./cart.ts');
  });

  it('インラインのスクリプトのボリュームのキーも、root の $watch の既知のパスになること', () => {
    const page = `<wcs-state mount="inl"><script type="module">export default { x: 1 };</script></wcs-state>
${ROOT(`    "inl.x"(v) { void v; },
    "inl.y"(v) { void v; },`)}`;
    expect(validateWatchDeclarations(page, 'wcs-state', 'en').map((d) => page.slice(d.start, d.end))).toEqual(['inl.y']);
  });

  it('正しいページは --strict でも exit 0（修正前は root の $watch の "cart.total" が warning で落ちた）', () => {
    const page = `<wcs-state mount="cart" src="./cart.js"></wcs-state>
${ROOT(`    "cart.total"(v) { void v; },`)}
<p data-wcs="textContent: cart.total"></p>
<p data-wcs="textContent: count"></p>`;
    const result = runValidation([{ source: 'page.html', text: page, kind: 'html', fileReader: cartReader() }], { strict: true });
    expect(result.lines).toEqual([]);
    expect(result.exitCode).toBe(0);
  });
});

describe('src= で読むボリュームの配下のパス — 読めないとき', () => {
  const html = `<wcs-state mount="ext" src="./ext.js"></wcs-state>
<wcs-state mount="shop.cart" src="https://cdn.example/cart.js"></wcs-state>
<wcs-state mount="mod" src="./mod.mjs"></wcs-state>
${ROOT(`    "ext.total"(v) { void v; },
    "ext.items.*.qty"(v) { void v; },
    "shop.cart.total"(v) { void v; },
    "cuont"(v) { void v; },`)}
<p data-wcs="textContent: ext.total"></p>
<user-card data-wcs="state: ext"></user-card>
<template data-wcs="for: ext.items"><span data-wcs="textContent: .qty"></span>{{ .qty }}</template>
<p>{{ ext.label }}</p>
<!--@@: ext.label-->
<p data-wcs="textContent: shop.cart.total; title: shop"></p>
<p data-wcs="textContent: mod.anything"></p>
<p data-wcs="textContent: cuont"></p>`;

  it('マウントパスの下は「分からない」として黙り、root の打ち間違いは従来どおり報告すること', () => {
    expect(pathFindings(html, cartReader())).toEqual([
      [WcsDiagnosticCode.WatchPathMissing, 'cuont'],
      [WcsDiagnosticCode.BindingPathMissing, 'cuont'],
    ]);
  });

  it('fileReader の無い経路（保存していない IDE の文書）でも同じく黙ること', () => {
    const page = `<wcs-state mount="cart" src="./cart.js"></wcs-state>
${ROOT(`    "cart.total"(v) { void v; },
    "cuont"(v) { void v; },`)}
<p data-wcs="textContent: cart.total"></p>
<p data-wcs="textContent: cuont"></p>`;
    expect(pathFindings(page)).toEqual([
      [WcsDiagnosticCode.WatchPathMissing, 'cuont'],
      [WcsDiagnosticCode.BindingPathMissing, 'cuont'],
    ]);
  });

  it('root の src= が読めないときは root の持ち分を黙り、読めたボリュームの配下は検査すること', () => {
    const page = `<wcs-state src="https://cdn.example/app.js"></wcs-state>
<wcs-state mount="cart" src="./cart.js"></wcs-state>
<p data-wcs="textContent: count"></p>
<p data-wcs="textContent: anything.deep"></p>
<p data-wcs="textContent: cart.total"></p>
<p data-wcs="textContent: cart.totl"></p>`;
    expect(pathFindings(page, cartReader())).toEqual([[WcsDiagnosticCode.BindingPathMissing, 'cart.totl']]);
  });

  it('stateSchema があれば、読めないボリュームの配下も schema（木全体の契約）で判定すること', () => {
    const schema = {
      type: 'object',
      properties: {
        count: { type: 'number' },
        ext: { type: 'object', properties: { total: { type: 'number' } } },
      },
    };
    const page = `<wcs-state mount="ext" src="./ext.js"></wcs-state>
<wcs-state json='{"count": 0}'></wcs-state>
<p data-wcs="textContent: ext.total"></p>
<p data-wcs="textContent: ext.totl"></p>`;
    const diags = validateDocument(page, { locale: 'en', fileReader: cartReader(), applicationSchema: schema })
      .filter((d) => PATH_CODES.has(d.code));
    expect(diags.map((d) => [d.code, page.slice(d.start, d.end)])).toEqual([[WcsDiagnosticCode.PathNonexistent, 'ext.totl']]);
  });
});

describe('getStatePathIndex / isUnresolvedPath', () => {
  it('読めないボリュームのマウントパス・その配下・マウントパスの祖先を「分からない」とし、ほかは分かるとすること', () => {
    const html = `<wcs-state json='{"a": 1}'></wcs-state>
<wcs-state mount="shop.cart" src="./missing.js"></wcs-state>
<wcs-state mount="shop.user" json='{"name": ""}'></wcs-state>`;
    const index = getStatePathIndex(html, 'wcs-state', cartReader());
    expect(index.paths.map((p) => p.path)).toEqual(['a', 'shop.user.name', 'shop', 'shop.user']);
    expect(index.volumePaths.map((p) => p.path)).toEqual(['shop.user.name', 'shop', 'shop.user']);
    const unresolved = (path: string) => isUnresolvedPath(path, index.scopes);
    expect(['shop.cart', 'shop.cart.total', 'shop.cart.items.*.v', 'shop'].map(unresolved)).toEqual([true, true, true, true]);
    // a readable volume, the root's part, and a different name that only shares a prefix are known
    expect(['shop.user.nmae', 'a', 'b', 'shop.carts', 'shopx'].map(unresolved)).toEqual([false, false, false, false, false]);
  });

  it('ページの root が読めなければ、どのボリュームの下でもないパスを「分からない」とすること', () => {
    const html = `<wcs-state src="./app.js"></wcs-state>
<wcs-state mount="cart" json='{"total": 0}'></wcs-state>`;
    const { scopes } = getStatePathIndex(html, 'wcs-state');
    expect(scopes.rootUnresolved).toBe(true);
    expect(isUnresolvedPath('count', scopes)).toBe(true);
    expect(isUnresolvedPath('cart.totl', scopes)).toBe(false);
  });
});

// A stateSchema carries data only (wcs-schema emits no methods): it cannot speak to the methods of a state that cannot be read
describe('stateSchema があるとき、読めない state のイベント束縛のハンドラ', () => {
  const schema = {
    type: 'object',
    properties: {
      count: { type: 'number' },
      cart: { type: 'object', properties: { total: { type: 'number' } } },
    },
  };
  const page = `<wcs-state src="/app.js"></wcs-state>
<wcs-state mount="cart" src="/cart.js"></wcs-state>
<button data-wcs="onclick: inc"></button>
<button data-wcs="onclick#prevent: cart.add"></button>
<p data-wcs="textContent: coutn"></p>
<p data-wcs="textContent: cart.totl"></p>`;

  it('root・ボリュームのハンドラ（メソッド）は wcs/path-nonexistent にせず、データの打ち間違いは schema で error にすること', () => {
    const diags = validateDocument(page, { locale: 'en', fileReader: cartReader(), applicationSchema: schema })
      .filter((d) => PATH_CODES.has(d.code));
    expect(diags.map((d) => [d.code, page.slice(d.start, d.end)])).toEqual([
      [WcsDiagnosticCode.PathNonexistent, 'coutn'],
      [WcsDiagnosticCode.PathNonexistent, 'cart.totl'],
    ]);
  });

  it('読めた state のハンドラは従来どおり候補で照合すること（無いメソッドは schema の判定で error）', () => {
    const readable = `<wcs-state><script type="module">export default { count: 0, inc() {} };</script></wcs-state>
<button data-wcs="onclick: inc"></button>
<button data-wcs="onclick: dec"></button>`;
    const diags = validateDocument(readable, { locale: 'en', applicationSchema: schema }).filter((d) => PATH_CODES.has(d.code));
    expect(diags.map((d) => [d.code, readable.slice(d.start, d.end)])).toEqual([[WcsDiagnosticCode.PathNonexistent, 'dec']]);
  });
});

// An empty state that was read (`json='{}'`, `export default {}`) is read — its paths are known not to exist. Only a state that
// cannot be read (an unreadable src=, contents that cannot be parsed, a top-level spread) and a <wcs-state> with no source
// (it waits for setInitialState()) are unknown
describe('読めたが空の state と、読めない state', () => {
  const VOLUME = `<wcs-state mount="cart" json='{"total": 0}'></wcs-state>`;
  const typos = (root: string) => {
    const html = `${root}\n${VOLUME}\n<p data-wcs="textContent: crat.total"></p>\n<p data-wcs="textContent: cart.total"></p>`;
    return pathFindings(html).map(([, text]) => text);
  };

  it('空の root（json=\'{}\'・export default {}）は読めたので、ボリュームの外の打ち間違い（crat.total）を報告すること', () => {
    expect(typos(`<wcs-state json='{}'></wcs-state>`)).toEqual(['crat.total']);
    expect(typos(`<wcs-state><script type="module">export default {};</script></wcs-state>`)).toEqual(['crat.total']);
    expect(typos(`<script type="application/json" id="s0">{}</script><wcs-state state="s0"></wcs-state>`)).toEqual(['crat.total']);
  });

  it('読み込み元の無い root・解析できない root・トップレベルの spread を持つ root は「分からない」として黙ること', () => {
    expect(typos(`<wcs-state></wcs-state>`)).toEqual([]);
    expect(typos(`<wcs-state><script type="module">export default makeState();</script></wcs-state>`)).toEqual([]);
    expect(typos(`<wcs-state><script type="module">export default { ...base };</script></wcs-state>`)).toEqual([]);
    expect(typos(`<wcs-state json='not json'></wcs-state>`)).toEqual([]);
  });

  it('空のボリュームは読めたので、マウントパスは存在し、その下の打ち間違いを報告すること', () => {
    const html = `<wcs-state json='{"count": 0}'></wcs-state>
<wcs-state mount="ui" json='{}'></wcs-state>
<wcs-state mount="empty" src="./empty.js"></wcs-state>
<p data-wcs="textContent: ui; title: ui.open"></p>
<p data-wcs="textContent: empty; title: empty.x"></p>
<wcs-state mount="typed" src="./typed.ts"></wcs-state>
<p data-wcs="textContent: typed.ok; title: typed.no"></p>`;
    const reader = cartReader({ './empty.js': 'export default {};', './typed.ts': 'export default { ok: 0 };' });
    expect(pathFindings(html, reader).map(([, text]) => text)).toEqual(['ui.open', 'empty.x', 'typed.no']);
  });

  it('root の $watch も同じ規則: 空のリテラルの root のキーは報告し、解析できない root は黙ること', () => {
    const empty = `<wcs-state><script type="module">export default { $watch: { "nope"() {} } };</script></wcs-state>`;
    expect(pathFindings(empty)).toEqual([[WcsDiagnosticCode.WatchPathMissing, 'nope']]);
    const spread = `<wcs-state><script type="module">export default { ...base, $watch: { "nope"() {} } };</script></wcs-state>`;
    expect(pathFindings(spread)).toEqual([]);
  });
});

// A <wcs-state> inside a <template> (a declarative shadow root, a DCC) is another tree's root, and a bind-component state is
// the host's — neither counts in the page-root decision. The page's volumes graft onto the page's root only
describe('ページの root と、別の木の <wcs-state>', () => {
  it('宣言的 shadow root の state が読めても、ページの root が読めなければページの root の持ち分は黙ること', () => {
    const html = `<wcs-state src="/app.js"></wcs-state>
<wcs-state mount="cart" json='{"total": 0}'></wcs-state>
<div><template shadowrootmode="open"><wcs-state json='{"x": 1}'></wcs-state><p data-wcs="textContent: x"></p></template></div>
<my-card><wcs-state bind-component="state" json='{"y": 1}'></wcs-state></my-card>
<p data-wcs="textContent: count"></p>
<p data-wcs="textContent: cart.totl"></p>`;
    expect(pathFindings(html).map(([, text]) => text)).toEqual(['cart.totl']);
    expect(getStatePathIndex(html, 'wcs-state').scopes.rootUnresolved).toBe(true);
  });

  it('ページの root が無い文書（コンポーネントの雛形だけ）は、従来どおり候補で照合すること', () => {
    const html = `<template shadowrootmode="open"><wcs-state json='{"x": 1}'></wcs-state>
<p data-wcs="textContent: x"></p><p data-wcs="textContent: xx"></p></template>`;
    expect(pathFindings(html).map(([, text]) => text)).toEqual(['xx']);
  });

  it('宣言的 shadow root の $watch には、ページのボリュームの候補も「分からない」も使わないこと', () => {
    const watch = `$watch: { "cart.total"() {}, "ext.y"() {} }`;
    const html = `<wcs-state mount="cart" json='{"total": 0}'></wcs-state>
<wcs-state mount="ext" src="./ext.js"></wcs-state>
<wcs-state><script type="module">export default { count: 0, ${watch} };</script></wcs-state>
<div><template shadowrootmode="open"><wcs-state><script type="module">export default { x: 1, ${watch} };</script></wcs-state></template></div>`;
    const diags = validateWatchDeclarations(html, 'wcs-state', 'en', cartReader());
    const shadowStart = html.indexOf('shadowrootmode');
    // the page root: cart.total exists, ext.y is under an unreadable volume (silent). The shadow root: neither is in its own state
    expect(diags.map((d) => [d.start > shadowStart, html.slice(d.start, d.end)])).toEqual([[true, 'cart.total'], [true, 'ext.y']]);
  });
});

// A volume grafts onto the root of its tree: the innermost enclosing <template> that holds a root <wcs-state> (a
// declarative shadow root, a DCC), or the page — a volume in a route or layout template is inserted into the page
describe('root の $watch とボリュームの木', () => {
  it('route・レイアウトの雛形の中のボリュームはページの root のもの（ページの root の $watch が照合する）', () => {
    const html = `<wcs-state><script type="module">export default { count: 0, $watch: { "page.x"() {}, "page.nope"() {}, "lay.y"() {}, "ext.z"() {} } };</script></wcs-state>
<wcs-router><template><wcs-route path="/">
<wcs-state mount="page" src="./page.js"></wcs-state>
<wcs-state mount="ext" src="./missing.js"></wcs-state>
<wcs-layout layout="main"><p>a</p></wcs-layout>
</wcs-route></template></wcs-router>
<template id="main"><wcs-state mount="lay" json='{"y": 1}'></wcs-state><slot></slot></template>`;
    const reader = cartReader({ './page.js': 'export default { x: 1 };' });
    const diags = validateWatchDeclarations(html, 'wcs-state', 'en', reader);
    expect(diags.map((d) => html.slice(d.start, d.end))).toEqual(['page.nope']);
  });

  it('宣言的 shadow root の中のボリュームはその shadow root の root のもの（ページの root の $watch は照合しない）', () => {
    const html = `<wcs-state><script type="module">export default { count: 0, $watch: { "v.b"() {} } };</script></wcs-state>
<div><template shadowrootmode="open">
<wcs-state><script type="module">export default { a: 1, $watch: { "v.b"() {}, "v.c"() {} } };</script></wcs-state>
<wcs-state mount="v" json='{"b": 1}'></wcs-state>
</template></div>`;
    const diags = validateWatchDeclarations(html, 'wcs-state', 'en');
    const shadowStart = html.indexOf('shadowrootmode');
    // the page root: v.b is not on the page's tree. The shadow root: v.b exists, v.c does not
    expect(diags.map((d) => [d.start > shadowStart, html.slice(d.start, d.end)])).toEqual([[false, 'v.b'], [true, 'v.c']]);
  });
});
