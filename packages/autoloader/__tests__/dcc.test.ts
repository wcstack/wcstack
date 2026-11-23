/**
 * dcc.test.ts — 定義をファイルに置いた Declarative Custom Component（@wcstack/state の
 * data-wc-definition）を読む loader と、loader を名指ししない eager のキーの loader の選び方
 * （docs/seam-apps.md、garden-plots）。
 * happy-dom には setHTMLUnsafe() が無く、宣言的 Shadow DOM も作らないので、ここでは innerHTML で代える
 * （定義の要素がページに入ること・タグの定義を待つことを見る。実ブラウザは e2e）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDccLoader, loadDcc, DCC_DEFINE_TIMEOUT } from '../src/dcc.js';
import { eagerLoad } from '../src/eagerload.js';
import { buildMap } from '../src/importmap.js';
import { resolveLoader } from '../src/resolveLoader.js';
import { resetState } from '../src/tags.js';
import { config, DCC_KEY, DCC_LOADER, DEFAULT_KEY, VANILLA_LOADER } from '../src/config.js';
import { ILoader } from '../src/types.js';

let seq = 0;
const POLICY = Symbol.for('wcstack.trustedTypes.policy');

/** The file a part is kept in: its definition (and, for one test, text around it). */
const file = (tag: string, extra = '') =>
  `<!-- a part -->${extra}<${tag} data-wc-definition><template shadowrootmode="open"><p>part</p><wcs-state></wcs-state></template></${tag}>`;

function respond(body: string, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status }) as never);
}

/** What @wcstack/state does when it sees a definition in the page: defines its tag. */
function defineSoon(tag: string) {
  const cls = class extends HTMLElement {};
  setTimeout(() => customElements.define(tag, cls), 0);
  return cls;
}

describe('DCC の loader', () => {
  const proto = Element.prototype as unknown as { setHTMLUnsafe?: (html: string) => void };

  beforeEach(() => {
    resetState();
    proto.setHTMLUnsafe = function (this: Element, html: string) { this.innerHTML = String(html); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete proto.setHTMLUnsafe;
    delete (globalThis as Record<symbol, unknown>)[POLICY];
    document.getElementById('wcs-autoloader-definitions')?.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('ファイルを取って定義をページに入れ、タグが定義されたらそのクラスを返す', async () => {
    const tag = `dcc-part-${seq++}`;
    const fetchSpy = respond(file(tag));
    const cls = defineSoon(tag);
    const resolve = vi.fn((specifier: string) => `https://example.test/parts/${specifier.split('/').pop()}.html`);

    const loaded = await createDccLoader(resolve)(`@components/${tag}|dcc`);

    // loader に渡るのは import map の指定子: URL にするのは loader
    expect(resolve).toHaveBeenCalledWith(`@components/${tag}|dcc`);
    expect(fetchSpy).toHaveBeenCalledWith(`https://example.test/parts/${tag}|dcc.html`);
    expect(loaded).toBe(cls);
    // 定義は、ページの終わりの隠した要素に入る
    const host = document.getElementById('wcs-autoloader-definitions')!;
    expect(host.hidden).toBe(true);
    expect(host.parentNode).toBe(document.body);
    expect(host.querySelector(`${tag}[data-wc-definition]`)).not.toBeNull();
  });

  it('2 つ目の部品も同じ要素に入る', async () => {
    const a = `dcc-part-${seq++}`;
    const b = `dcc-part-${seq++}`;
    const load = createDccLoader((s) => `https://example.test/${s}`);
    respond(file(a));
    defineSoon(a);
    await load(a);
    vi.restoreAllMocks();
    respond(file(b));
    defineSoon(b);
    await load(b);
    expect(document.querySelectorAll('#wcs-autoloader-definitions').length).toBe(1);
    expect(document.querySelectorAll('#wcs-autoloader-definitions > [data-wc-definition]').length).toBe(2);
  });

  it('1 つのファイルに定義が 2 つあれば、どちらも入れて待ち、最初のクラスを返す', async () => {
    const a = `dcc-part-${seq++}`;
    const b = `dcc-part-${seq++}`;
    respond(file(a) + file(b));
    const clsA = defineSoon(a);
    defineSoon(b);
    const loaded = await createDccLoader((s) => `https://example.test/${s}`)('two');
    expect(loaded).toBe(clsA);
    expect(customElements.get(b)).toBeDefined();
  });

  it('すでに定義されているタグの定義は入れない（同じファイルを 2 つのキーで読んだ、ページに写しがある）', async () => {
    const tag = `dcc-part-${seq++}`;
    const cls = class extends HTMLElement {};
    customElements.define(tag, cls);
    respond(file(tag));
    const loaded = await createDccLoader((s) => `https://example.test/${s}`)(tag);
    expect(loaded).toBe(cls);
    expect(document.querySelector(`${tag}[data-wc-definition]`)).toBeNull();
  });

  it('wcstack の Trusted Types のポリシーがあれば、HTML はそれを通す', async () => {
    const tag = `dcc-part-${seq++}`;
    const createHTML = vi.fn((html: string) => html);
    (globalThis as Record<symbol, unknown>)[POLICY] = { createHTML };
    respond(file(tag));
    defineSoon(tag);
    await createDccLoader((s) => `https://example.test/${s}`)(tag);
    expect(createHTML).toHaveBeenCalledWith(file(tag));
  });

  it('ファイルが取れないときは、URL と HTTP の状態を言って失敗する', async () => {
    respond('not found', 404);
    await expect(createDccLoader(() => 'https://example.test/parts/missing.html')('x'))
      .rejects.toThrow('[@wcstack/autoloader] https://example.test/parts/missing.html: HTTP 404');
  });

  it('定義の無いファイルは、そう言って失敗する', async () => {
    respond('<p>only text</p>');
    await expect(createDccLoader(() => 'https://example.test/parts/plain.html')('x'))
      .rejects.toThrow('[@wcstack/autoloader] https://example.test/parts/plain.html has no element with data-wc-definition.');
  });

  it('setHTMLUnsafe() の無いブラウザでは、そう言って失敗する', async () => {
    delete proto.setHTMLUnsafe;
    respond(file(`dcc-part-${seq++}`));
    await expect(createDccLoader(() => 'https://example.test/parts/p.html')('x'))
      .rejects.toThrow('this browser has no setHTMLUnsafe()');
  });

  it('タグがいつまでも定義されないとき（ページに @wcstack/state が無い）は、待つのをやめて失敗する', async () => {
    const tag = `dcc-part-${seq++}`;
    respond(file(tag));
    await expect(createDccLoader(() => 'https://example.test/parts/p.html', 20)('x'))
      .rejects.toThrow(`[@wcstack/autoloader] https://example.test/parts/p.html: <${tag}> was not defined within 20 ms. A Declarative Custom Component is defined by @wcstack/state: load it on the page.`);
  });

  it('定義が 2 つとも定義されないときは、両方の名前を言う', async () => {
    const a = `dcc-part-${seq++}`;
    const b = `dcc-part-${seq++}`;
    respond(file(a) + file(b));
    await expect(createDccLoader(() => 'https://example.test/parts/p.html', 20)('x'))
      .rejects.toThrow(`<${a}>, <${b}> were not defined within 20 ms.`);
  });

  it('既定の loader は指定子を import.meta.resolve で URL にする（既定の待ち時間は 10 秒）', async () => {
    const tag = `dcc-part-${seq++}`;
    const fetchSpy = respond(file(tag));
    defineSoon(tag);
    // (a URL is its own resolution: the test has no import map)
    await loadDcc('https://example.test/parts/default.html');
    expect(fetchSpy).toHaveBeenCalledWith('https://example.test/parts/default.html');
    expect(DCC_DEFINE_TIMEOUT).toBe(10000);
  });
});

describe('loader を名指ししない eager のキー', () => {
  beforeEach(() => {
    resetState();
    vi.spyOn(customElements, 'define');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const loaderFor = (postfix: string): ILoader => ({ postfix, loader: vi.fn().mockResolvedValue(class extends HTMLElement {}) });

  it('キーが指すファイルの拡張子で loader が決まる（README の例: .lit.js は lit の loader）', async () => {
    const vanilla = loaderFor('.js');
    const lit = loaderFor('.lit.js');
    const html = loaderFor('.html');
    const loaders = { vanilla, lit, dcc: html, [DEFAULT_KEY]: 'vanilla' };
    const { loadMap } = buildMap({
      imports: {
        '@components/el-plain': './plain.js',
        '@components/el-lit': './my-button.lit.js',
        '@components/el-part': './parts/el-part.html?v=2',
      },
    });

    await eagerLoad(loadMap, loaders);

    // loader には、今までどおりキー（import map の指定子）が渡る
    expect(vanilla.loader).toHaveBeenCalledTimes(1);
    expect(vanilla.loader).toHaveBeenCalledWith('@components/el-plain');
    expect(lit.loader).toHaveBeenCalledWith('@components/el-lit');
    expect(html.loader).toHaveBeenCalledWith('@components/el-part');
  });

  it('どの拡張子にも当たらないファイルは既定の loader、名指ししたキーは名指しした loader', async () => {
    const vanilla = loaderFor('.js');
    const html = loaderFor('.html');
    const loaders = { vanilla, dcc: html, [DEFAULT_KEY]: 'vanilla' };
    const { loadMap } = buildMap({
      imports: {
        '@components/el-other': './other.mjs',
        '@components/el-named|dcc': './named.txt',
      },
    });

    await eagerLoad(loadMap, loaders);

    expect(vanilla.loader).toHaveBeenCalledWith('@components/el-other');
    expect(html.loader).toHaveBeenCalledWith('@components/el-named|dcc');
  });

  it('path の無い項目（手で作った loadMap）は、今までどおりキーで決まる', async () => {
    const vanilla = loaderFor('.js');
    await eagerLoad({ 'el-old': { key: '@components/el-old', tagName: 'el-old', loaderKey: null, extends: null } }, { vanilla, [DEFAULT_KEY]: 'vanilla' });
    expect(vanilla.loader).toHaveBeenCalledWith('@components/el-old');
  });

  it('拡張子の後ろのクエリやフラグメントは、拡張子に数えない', () => {
    const html = loaderFor('.html');
    const vanilla = loaderFor('.js');
    const loaders = { vanilla, dcc: html, [DEFAULT_KEY]: 'vanilla' };
    expect(resolveLoader('./part.html?v=2', null, loaders)).toBe(html);
    expect(resolveLoader('./part.html#top', null, loaders)).toBe(html);
    expect(resolveLoader('./part.js?file=x.html', null, loaders)).toBe(vanilla);
  });

  it('既定の設定に DCC の loader（.html、キーの |dcc）がある', () => {
    expect(DCC_KEY).toBe('dcc');
    expect(config.loaders[DCC_KEY]).toBe(DCC_LOADER);
    expect(DCC_LOADER.postfix).toBe('.html');
    expect(DCC_LOADER.loader).toBe(loadDcc);
    expect(resolveLoader('./parts/midori-pager.html', null, config.loaders)).toBe(DCC_LOADER);
    expect(resolveLoader('./parts/plot-tile.js', null, config.loaders)).toBe(VANILLA_LOADER);
  });
});
