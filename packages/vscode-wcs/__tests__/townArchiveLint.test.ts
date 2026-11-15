/**
 * townArchiveLint.test.ts — 継ぎ目アプリ town-archive（写真 12,000 枚のアーカイブ: 長いリストと無限スクロール）で
 * 見つかった lint の穴（4.24）のうち、既存の規則が見ていなかった 2 つ。
 *
 *   - L2: `wcs/delegated-current-target` — ハンドラの本体に入れ子にした関数の中の `event.currentTarget`
 *   - L3: `wcs/getter-untracked-read` — getter の中のウィンドウと文書の読み（`innerWidth`・`scrollY`・`matchMedia(…)`・
 *     `navigator.onLine`・`document.hidden` など）
 *
 * 1 つのコメントの複数の `@typedef`（L1）は jsdocType.test.ts、新しい規則は bindingHostValidator.test.ts
 * （`wcs/body-binding`・`wcs/link-handler`）と ioAttributeValidator.test.ts（`wcs/root-margin-unit`）。
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import { findAmbientRead, moduleBindingNames, readsEventCurrentTarget } from '../src/service/scriptAst.js';

const validate = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
  validateDocument(html, { locale, fileReader: (p: string) => files[p] });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);
const page = (script: string, body: string): string => `<wcs-state><script type="module">
${script}
</script></wcs-state>
${body}`;

describe('L2 wcs/delegated-current-target — 入れ子の関数の中の event.currentTarget', () => {
  const STATE = `export default {
  items: [{ id: 1 }],
  picked: null,
  direct(event) { return event.currentTarget.dataset.id; },
  nested(event) { return this.items.find((x) => String(x.id) === event.currentTarget.closest(".card").dataset.id); },
  expression(event) { return this.items.map(function (x) { return event.currentTarget.id + x.id; }); },
  declared(event) { function card() { return event.currentTarget.closest(".card"); } this.picked = card(); },
  shadowed(event) { this.items.forEach((event) => event.currentTarget); },
  later(event) { setTimeout(() => { this.picked = event.currentTarget; }, 0); },
  framed(event) { requestAnimationFrame(() => event.currentTarget.focus()); },
  chained(event) { load().then(() => { this.picked = event.currentTarget; }); },
  awaited(event) { this.items.map(async (x) => { await save(x); this.picked = event.currentTarget; }); },
  inClass(event) { return class { read() { return event.currentTarget; } }; },
  target(event) { return this.items.find((x) => String(x.id) === event.target.closest(".card").dataset.id); },
};`;
  const BODY = ['direct', 'nested', 'expression', 'declared', 'shadowed', 'later', 'framed', 'chained', 'awaited', 'inClass', 'target']
    .map((name) => `<button data-wcs="onclick: ${name}"></button>`).join('\n');
  const reported = (diags: readonly WcsDiagnostic[]): string[] =>
    ofCode(diags, WcsDiagnosticCode.DelegatedCurrentTarget).map((d) => /in "([^"]+)"/.exec(d.message)![1]);

  it('アロー関数・function 式・関数宣言の中の読みを報告し、引数を影にする関数・後で呼ばれる関数・class の中は黙ること', () => {
    const html = page(STATE, BODY);
    const found = ofCode(validate(html), WcsDiagnosticCode.DelegatedCurrentTarget);
    expect(reported(found)).toEqual(['direct', 'nested', 'expression', 'declared']);
    expect(found.every((d) => d.severity === 'warning' && textOf(html, d) === 'onclick')).toBe(true);
    expect(found[1].message).toContain('"onclick#direct:"');
  });

  it('<wcs-state src="./x.js"> の state のメソッドでも同じに報告すること', () => {
    const html = `<wcs-state src="./state.js"></wcs-state>\n${BODY}`;
    expect(reported(validate(html, 'en', { './state.js': STATE }))).toEqual(['direct', 'nested', 'expression', 'declared']);
  });

  it('#direct を付ければ黙ること', () => {
    const html = page(STATE, `<button data-wcs="onclick#direct: nested"></button>`);
    expect(ofCode(validate(html), WcsDiagnosticCode.DelegatedCurrentTarget)).toEqual([]);
  });

  it('readsEventCurrentTarget: 入れ子の関数は自分の最初の await までを読み、後で呼ぶ呼び出しに渡した関数は読まないこと', () => {
    expect(readsEventCurrentTarget('e', 'return list.find((x) => x.el === e.currentTarget);')).toBe(true);
    expect(readsEventCurrentTarget('e', 'return list.find(function (x) { return x.el === e["currentTarget"]; });')).toBe(true);
    expect(readsEventCurrentTarget('e', 'return list.map((x) => { const { currentTarget } = e; return currentTarget; });')).toBe(true);
    expect(readsEventCurrentTarget('e', 'list.forEach((x) => x.items.forEach((y) => y.mark(e.currentTarget)));')).toBe(true);
    // 被演算子は中断の前に評価される（入れ子の関数でも）
    expect(readsEventCurrentTarget('e', 'list.map(async (x) => { await send(x, e.currentTarget); });')).toBe(true);
    expect(readsEventCurrentTarget('e', 'list.map(async (x) => { await send(x); return e.currentTarget; });')).toBe(false);
    // 外側の await より後ろに書いた関数は、dispatch の後
    expect(readsEventCurrentTarget('e', 'await x; return list.find((y) => y.el === e.currentTarget);')).toBe(false);
    // 影（引数・宣言）
    expect(readsEventCurrentTarget('e', 'return list.find((e) => e.currentTarget);')).toBe(false);
    expect(readsEventCurrentTarget('e', 'return list.find((x) => { const e = x; return e.currentTarget; });')).toBe(false);
    // 後で呼ばれる関数。その呼び出しの、関数でない引数は読む
    for (const call of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask', 'window.setTimeout']) {
      expect(readsEventCurrentTarget('e', `${call}(() => e.currentTarget);`)).toBe(false);
    }
    expect(readsEventCurrentTarget('e', 'p.then(() => e.currentTarget).catch(() => e.currentTarget).finally(() => e.currentTarget);')).toBe(false);
    expect(readsEventCurrentTarget('e', 'el.addEventListener("load", function () { e.currentTarget; });')).toBe(false);
    expect(readsEventCurrentTarget('e', 'setTimeout(run, delayOf(e.currentTarget));')).toBe(true);
    // オブジェクトのメンバーに代入した関数は、そのオブジェクトが後で呼ぶ。変数に置いた関数は本体の中で呼ばれうる
    expect(readsEventCurrentTarget('e', 'reader.onload = () => { e.currentTarget.value = ""; };')).toBe(false);
    expect(readsEventCurrentTarget('e', 'const card = () => e.currentTarget.closest(".card"); use(card());')).toBe(true);
    expect(readsEventCurrentTarget('e', 'return class { read() { return e.currentTarget; } };')).toBe(false);
  });
});

describe('L3 wcs/getter-untracked-read — getter の中のウィンドウと文書の読み', () => {
  const untracked = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
    ofCode(validate(html, locale, files), WcsDiagnosticCode.GetterUntrackedRead);
  const getters = (lines: string[]): string => page(`export default {\n  cols: 2,\n${lines.join('\n')}\n};`, '');

  it('window. / globalThis. の有無によらず、大きさ・画素比・スクロール位置・matchMedia・onLine・可視性の読みを warning で報告すること', () => {
    const html = getters([
      '  get a() { return innerWidth > 900 ? 4 : 2; },',
      '  get b() { return window.innerHeight - 10; },',
      '  get c() { return globalThis.outerWidth + self.outerHeight; },',
      '  get d() { return devicePixelRatio > 1; },',
      '  get e() { return window.scrollX + scrollY; },',
      '  get f() { return pageXOffset || window.pageYOffset; },',
      '  get g() { return matchMedia("(max-width: 600px)").matches; },',
      '  get h() { return window.matchMedia("(prefers-color-scheme: dark)").matches; },',
      '  get i() { return !navigator.onLine; },',
      '  get j() { return document.documentElement.clientWidth; },',
      '  get k() { return window.document.documentElement.clientHeight; },',
      '  get l() { return document.documentElement.scrollTop + document.documentElement.scrollLeft; },',
      '  get m() { return document.body.clientWidth * document.body.clientHeight; },',
      '  get n() { return document.body.scrollTop; },',
      '  get o() { return document.visibilityState === "visible"; },',
      '  get p() { return document.hidden; },',
    ]);
    const found = untracked(html);
    // getter ごとに最初の 1 か所
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([
      ['warning', 'innerWidth'], ['warning', 'window.innerHeight'], ['warning', 'globalThis.outerWidth'],
      ['warning', 'devicePixelRatio'], ['warning', 'window.scrollX'], ['warning', 'pageXOffset'],
      ['warning', 'matchMedia'], ['warning', 'window.matchMedia'], ['warning', 'navigator.onLine'],
      ['warning', 'document.documentElement.clientWidth'], ['warning', 'window.document.documentElement.clientHeight'],
      ['warning', 'document.documentElement.scrollTop'], ['warning', 'document.body.clientWidth'],
      ['warning', 'document.body.scrollTop'], ['warning', 'document.visibilityState'], ['warning', 'document.hidden'],
    ]);
  });

  it('文面は最初の値のままになることと、束ねる要素（無いものは state に置いてイベントハンドラから書くこと）を言うこと', () => {
    const html = getters([
      '  get size() { return innerWidth; },',
      '  get ratio() { return devicePixelRatio; },',
      '  get media() { return matchMedia("(max-width: 600px)").matches; },',
      '  get online() { return navigator.onLine; },',
      '  get scroll() { return scrollY; },',
      '  get visible() { return !document.hidden; },',
    ]);
    const [size, ratio, media, online, scroll, visible] = untracked(html).map((d) => d.message);
    expect(size).toBe('This getter reads innerWidth, which is not state, so it is not a dependency: the getter is cached and keeps returning its first value (a resize does not re-evaluate it). Keep the size in state — bind the width / height <wcs-resize> writes (for a breakpoint, <wcs-media-query>\'s matched)');
    expect(ratio).toContain('reads devicePixelRatio');
    expect(ratio).toContain('<wcs-media-query>\'s matched for the resolution thresholds');
    expect(media).toContain('reads matchMedia(…)');
    expect(media).toContain('Bind <wcs-media-query>\'s matched instead');
    expect(online).toContain('Bind <wcs-network>\'s offline instead');
    expect(scroll).toContain('No wcstack element gives the scroll position: keep the value in state and write it from an event handler');
    expect(visible).toContain('No wcstack element gives the page\'s visibility: keep the value in state and write it from an event handler');
    const ja = untracked(html, 'ja').map((d) => d.message);
    expect(ja[0]).toContain('この getter は innerWidth を読んでいますが、state ではないので依存として登録されず');
    expect(ja[0]).toContain('<wcs-resize> が書く width / height を束ねる');
    expect(ja[2]).toContain('<wcs-media-query> の matched を束ねてください');
    expect(ja[3]).toContain('<wcs-network> の offline を束ねてください');
    expect(ja[4]).toContain('スクロール位置を出す wcstack の要素は無いので、値を state に置き、イベントハンドラ');
    expect(ja[5]).toContain('ページの可視性を出す wcstack の要素は無いので');
  });

  it('入れ子の関数の中の読みと、分割代入で取り出す読みも報告すること', () => {
    const html = getters([
      '  get visibleRows() { return [1, 2].filter((top) => top < pageYOffset + innerHeight); },',
      '  get wide() { const { innerWidth: w } = window; return w > 900; },',
      '  get shown() { const { visibilityState } = document; return visibilityState; },',
    ]);
    expect(untracked(html).map((d) => textOf(html, d))).toEqual(['pageYOffset', 'innerWidth', 'visibilityState']);
    expect(untracked(html)[1].message).toContain('reads window.innerWidth,');
  });

  it('state の同名のキー・影にする変数や引数・メンバーやキーの名前・変わらない値・getter 以外には出さないこと', () => {
    const html = page(`import { scrollY } from "./scroll.js";
const devicePixelRatio = 2;
export default {
  innerWidth: 0,
  hidden: false,
  get mine() { return this.innerWidth + (this.hidden ? 1 : 0); },
  get local() { const innerWidth = 5; return innerWidth; },
  get param() { return [1].map((innerHeight) => innerHeight); },
  get caught() { try { return 1; } catch (matchMedia) { return matchMedia("x"); } },
  get imported() { return scrollY > 0; },
  get constant() { return devicePixelRatio; },
  get member() { return this.box.scrollTop + this.el.clientWidth; },
  get key() { return { scrollY: 0, innerWidth: 1 }; },
  get stable() { return navigator.userAgent + document.title + document.body.className + location.protocol; },
  get uncalled() { return typeof matchMedia === "function"; },
  get ownDocument() { const document = this.doc; return document.hidden; },
  measure() { this.innerWidth = window.innerWidth; this.hidden = document.hidden; },
  $connectedCallback() { addEventListener("scroll", () => { this.y = window.scrollY; }); },
};`, '');
    expect(untracked(html, 'en', { './scroll.js': 'export const scrollY = 0;' })).toEqual([]);
  });

  it('<wcs-state src> の state の getter も、ファイルの中の位置つきで報告すること', () => {
    const html = `<wcs-state src="./state.js"></wcs-state>`;
    const file = `export default {\n  get cols() { return window.innerWidth > 900 ? 4 : 2; },\n};`;
    const [found] = untracked(html, 'en', { './state.js': file });
    expect(found.severity).toBe('warning');
    expect(found.origin?.path).toBe('./state.js');
    expect(file.slice(found.origin!.start, found.origin!.end)).toBe('window.innerWidth');
  });

  it('findAmbientRead / moduleBindingNames: 種類と原文を返し、モジュールの束縛を影として受け取ること', () => {
    expect(findAmbientRead('return window["innerWidth"];')).toMatchObject({ kind: 'size', text: 'window["innerWidth"]' });
    expect(findAmbientRead('return globalThis.window.devicePixelRatio;')).toMatchObject({ kind: 'pixelRatio' });
    expect(findAmbientRead('return window?.matchMedia?.("(x)");')).toMatchObject({ kind: 'media', text: 'window?.matchMedia(…)' });
    expect(findAmbientRead('return window.navigator.onLine;')).toMatchObject({ kind: 'online' });
    expect(findAmbientRead('return document.scrollingElement.scrollTop;')).toMatchObject({ kind: 'scroll' });
    expect(findAmbientRead('return document.body.scrollLeft;')).toMatchObject({ kind: 'scroll' });
    expect(findAmbientRead('return document.hidden;')).toMatchObject({ kind: 'visibility', start: 7, end: 22 });
    expect(findAmbientRead('return innerWidth;', new Set(['innerWidth']))).toBeNull();
    expect(findAmbientRead('return window.innerWidth;', new Set(['window']))).toBeNull();
    expect(findAmbientRead('return document.documentElement.offsetWidth;')).toBeNull();
    expect(findAmbientRead('return (')).toBeNull();
    expect([...moduleBindingNames(`import a, { b as c } from "./m.js"; import * as ns from "./n.js";
const { d, e: [f] } = x; export let g; export function h() {} class I {} function j() { const inner = 1; }`)])
      .toEqual(['a', 'c', 'ns', 'd', 'f', 'g', 'h', 'I', 'j']);
    expect([...moduleBindingNames('const x: number = 1;')]).toEqual([]);
  });
});
