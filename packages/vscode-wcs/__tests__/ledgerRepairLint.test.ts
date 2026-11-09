/**
 * ledgerRepairLint.test.ts — 継ぎ目アプリ ledger-repair（examples/family-ledger に目録の誤り 10 件を入れた家計簿を、外の
 * 保守担当がコンソール・lint・DevTools・文書で直した）で見つかった lint の穴（4.21）。
 *
 *   - L1: ガードのモジュールのトップレベルでのセッションの読み（`wcs/session-read-at-module-top`。ガードは error、
 *     state のモジュールは warning）
 *   - G1: `wcs/submit-without-prevent` と `wcs/tag-package-missing` は error（`--errors-only` に隠れない）
 *   - L3: 行のフィールドの打ち間違いに「もしかして」
 *   - L2: どの `eventToken.` 束縛も出さない `$eventTokens` の名前（`wcs/event-token-unbound`）
 *   - L4: オブジェクトのキーへの添字の形の代入を「配列の添字」と呼ばない
 *   - L5: その場で変えた（行の形が読めない）リストの行のフィールドを「存在しない」と言わない
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import { findTopLevelReads } from '../src/service/moduleTopReadValidator.js';

const validate = (html: string, locale = 'en', files?: Record<string, string>): WcsDiagnostic[] =>
  validateDocument(html, { locale, ...(files !== undefined ? { fileReader: (p: string) => files[p] } : {}) });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);
const state = (body: string): string => `<wcs-state><script type="module">
export default { ${body} };
</script></wcs-state>
`;
const guard = (script: string): string => `<wcs-router><template>
  <wcs-route path="/" guard="/login">
    <wcs-guard-handler>
      <script type="module">${script}</script>
    </wcs-guard-handler>
  </wcs-route>
</template></wcs-router>
`;

describe('L1 wcs/session-read-at-module-top — 1 回しか評価されないモジュールのトップレベルでの読み', () => {
  it('ガードのモジュールのトップレベルで localStorage を読むと error（ledger-repair の形）', () => {
    const html = guard(`
      let s = null;
      try { s = JSON.parse(localStorage.getItem("ledger.session")); } catch { s = null; }
      export default function (toPath) { return Boolean(s && s.token); }`);
    const found = ofCode(validate(html), WcsDiagnosticCode.SessionReadAtModuleTop);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['error', 'localStorage.getItem']]);
    expect(found[0].message).toBe('The guard\'s module reads localStorage.getItem at its top level, outside the function it exports. The module is evaluated once, when the page loads, so the guard keeps the value it read then and decides every navigation with it (after a login, the session is still not there). Read it inside the exported function, which runs on every navigation');
    const [ja] = ofCode(validate(html, 'ja'), WcsDiagnosticCode.SessionReadAtModuleTop);
    expect(ja.message).toContain('ガードのモジュールが、export する関数の外（トップレベル）で localStorage.getItem を読んでいます');
  });

  it('sessionStorage・document.cookie・window. / globalThis. 越しの読みも数え、それぞれに出す', () => {
    const html = guard(`
      const a = sessionStorage.token;
      const b = document.cookie.includes("session=");
      const c = window.localStorage["s"];
      const d = globalThis.document.cookie;
      export default () => a && b && c && d;`);
    expect(ofCode(validate(html), WcsDiagnosticCode.SessionReadAtModuleTop).map((d) => textOf(html, d)))
      .toEqual(['sessionStorage.token', 'document.cookie', 'window.localStorage["s"]', 'globalThis.document.cookie']);
  });

  it('export した関数・そこから呼ぶ補助関数・アロー・クラスの中の読みと、トップレベルの書き込みは黙る', () => {
    const html = guard(`
      function readSession() { try { return JSON.parse(localStorage.getItem("s")); } catch { return null; } }
      const cookie = () => document.cookie;
      class Store { get token() { return sessionStorage.getItem("t"); } }
      localStorage.setItem("seen", "1");
      localStorage.removeItem("old");
      document.cookie = "visited=1";
      export default function (toPath, fromPath, { searchParams } = { searchParams: localStorage.getItem("q") }) {
        const s = readSession();
        return Boolean(s && s.token && cookie() && new Store().token);
      }`);
    expect(ofCode(validate(html), WcsDiagnosticCode.SessionReadAtModuleTop)).toEqual([]);
  });

  it('state のモジュールのトップレベル（オブジェクトリテラルの値も）での読みは warning、getter・メソッドの中は黙る', () => {
    const html = `<wcs-state><script type="module">
const token = localStorage.getItem("token");
export default {
  theme: localStorage.getItem("theme") ?? "light",
  get authHeader() { return "Bearer " + token; },
  get cookie() { return document.cookie; },
  load() { this.theme = localStorage.getItem("theme"); },
};
</script></wcs-state><p data-wcs="textContent: theme"></p>`;
    const found = ofCode(validate(html), WcsDiagnosticCode.SessionReadAtModuleTop);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['warning', 'localStorage.getItem'], ['warning', 'localStorage.getItem']]);
    expect(found[0].message).toContain('The state\'s module reads localStorage.getItem at its top level. The module is evaluated once per <wcs-state>');
    const [ja] = ofCode(validate(html, 'ja'), WcsDiagnosticCode.SessionReadAtModuleTop);
    expect(ja.message).toContain('state のモジュールがトップレベルで localStorage.getItem を読んでいます');
  });

  it('src= の state のファイルでも warning で、ファイルの位置で報告する', () => {
    const html = `<wcs-state src="./state.js"></wcs-state>`;
    const file = `const s = sessionStorage.getItem("s");\nexport default { s };\n`;
    const [found] = ofCode(validate(html, 'en', { './state.js': file }), WcsDiagnosticCode.SessionReadAtModuleTop);
    expect(found.severity).toBe('warning');
    expect(found.origin?.path).toBe('./state.js');
    expect(file.slice(found.origin!.start, found.origin!.end)).toBe('sessionStorage.getItem');
  });

  it('その場で呼ぶ関数（IIFE）の中はトップレベルとして数える', () => {
    const source = 'const s = (() => { try { return JSON.parse(localStorage.getItem("s")); } catch { return null; } })();\nexport default () => !!s;';
    expect(findTopLevelReads(source).map((r) => r.text)).toEqual(['localStorage.getItem']);
  });

  it('パースできないスクリプト（TypeScript）・読みの無いスクリプトは黙る', () => {
    expect(findTopLevelReads('const s: string = localStorage.getItem("a");')).toEqual([]);
    expect(findTopLevelReads('export default function () { return true; }')).toEqual([]);
  });
});

describe('G1 — 必ず不具合の 2 つの warning は error（--errors-only に隠れない）', () => {
  const PAGE = `<script type="module" src="https://esm.run/@wcstack/state/auto"></script>
<script type="module" src="https://esm.run/@wcstack/router/auto"></script>
${state('loginForm: { email: "" }, login(e) { this.loginForm = { email: "" }; },')}
<wcs-clipboard></wcs-clipboard>
<form data-wcs="onsubmit: login"><input type="password"></form>`;

  it('wcs/submit-without-prevent と wcs/tag-package-missing は error、wcs/binding-path-missing は warning のまま', () => {
    const found = validate(`${PAGE}<p data-wcs="textContent: loginFrom.email"></p>`);
    expect(ofCode(found, WcsDiagnosticCode.SubmitWithoutPrevent).map((d) => d.severity)).toEqual(['error']);
    expect(ofCode(found, WcsDiagnosticCode.TagPackageMissing).map((d) => d.severity)).toEqual(['error']);
    expect(ofCode(found, WcsDiagnosticCode.BindingPathMissing).map((d) => d.severity)).toEqual(['warning']);
  });

  it('CLI の --errors-only が両方を出し、exit 1 で終わる', () => {
    const result = runValidation([{ source: 'login.html', text: PAGE, kind: 'html' }], { errorsOnly: true, locale: 'en' });
    expect(result.exitCode).toBe(1);
    expect(result.lines.filter((l) => / error wcs\//.test(l)).map((l) => l.split(' ')[2])).toEqual(['wcs/tag-package-missing', 'wcs/submit-without-prevent']);
  });
});

describe('L3 — 行のフィールドの打ち間違いに「もしかして」', () => {
  it('getter が map で返す行（ledger-repair の rows）の .amountLabl に amountLabel を示す（展開の後に）', () => {
    const html = state(`entries: [],
  get rows() { return this.entries.map((e) => ({ id: e.id, amountLabel: String(e.amount) })); },`)
      + `<ul><template data-wcs="for: rows"><li data-wcs="textContent: .amountLabl"></li></template></ul>`;
    const [found] = ofCode(validate(html), WcsDiagnosticCode.BindingPathMissing);
    expect(textOf(html, found)).toBe('.amountLabl');
    expect(found.message).toBe('Path ".amountLabl" does not exist in the state definition (expanded: rows.*.amountLabl). Did you mean "amountLabel"?');
    const [ja] = ofCode(validate(html, 'ja'), WcsDiagnosticCode.BindingPathMissing);
    expect(ja.message).toBe('パス ".amountLabl" は状態定義に存在しません（展開: rows.*.amountLabl）。もしかして: "amountLabel"');
  });

  it('データのリストの行・JSDoc の行の型・フルパス・{{ }}・コメント束縛でも示す', () => {
    const html = state(`items: [{ name: "a", price: 1 }],
  /** @type {{ title: string }[] | null} */ catalog: null,`)
      + `<template data-wcs="for: items"><p data-wcs="textContent: .nmae"></p><p>{{ .prcie }}</p><p><!--@@: .nmae --></p></template>`
      + `<template data-wcs="for: catalog"><p data-wcs="textContent: catalog.*.titel"></p></template>`;
    const found = ofCode(validate(html), WcsDiagnosticCode.BindingPathMissing);
    expect(found.map((d) => [textOf(html, d).trim(), d.message.replace(/^.*Did you mean /, '')])).toEqual([
      ['.nmae', '"name"?'],
      ['.prcie', '"price"?'],
      ['.nmae', '"name"?'],
      ['catalog.*.titel', '"title"?'],
    ]);
  });

  it('近い名前の無いフィールド・行の外のパス（トップレベル・オブジェクトのキー）は従来どおり（もしかして無し）', () => {
    const html = state(`items: [{ name: "a" }], user: { name: "" }, total: 0,`)
      + `<template data-wcs="for: items"><p data-wcs="textContent: .zzzzzz"></p></template>`
      + `<p data-wcs="textContent: totl"></p><p data-wcs="textContent: user.nmae"></p>`;
    const found = ofCode(validate(html), WcsDiagnosticCode.BindingPathMissing);
    expect(found).toHaveLength(3);
    expect(found.every((d) => !d.message.includes('Did you mean'))).toBe(true);
  });
});

describe('L2 wcs/event-token-unbound — どの eventToken. 束縛も出さない $eventTokens の名前', () => {
  const FETCH = `<script type="module" src="https://esm.run/@wcstack/fetch/auto"></script>`;

  it('束縛の無い名前に warning（$eventTokens の中の名前の上）。$on のハンドラがあればそう言う', () => {
    const html = state(`deleteFetch: { status: 0 },
  $eventTokens: ["deleteDone", "saved", "loaded"],
  $on: { saved(state) {}, deleteDone(state) {} },`)
      + `${FETCH}<wcs-fetch data-wcs="...: deleteFetch; eventToken.value: loaded"></wcs-fetch>`;
    const found = ofCode(validate(html), WcsDiagnosticCode.EventTokenUnbound);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['warning', 'deleteDone'], ['warning', 'saved']]);
    expect(found[0].message).toBe('The event token "deleteDone" is declared in $eventTokens, but no eventToken.<member>: deleteDone binding in this document emits it: no element fires it, so its $on handler never runs. Bind it on the element whose event should fire it (eventToken.<member>: deleteDone, with <member> a wcBindable property of that element), or remove it from $eventTokens');
    const [ja] = ofCode(validate(html, 'ja'), WcsDiagnosticCode.EventTokenUnbound);
    expect(ja.message).toContain('イベントトークン "deleteDone" を $eventTokens に宣言していますが');
    expect(ja.message).toContain('$on のハンドラは一度も走りません');
  });

  it('ハンドラの無い名前は「一度も発火しない」と言う', () => {
    const html = state(`$eventTokens: ["orphan"],`);
    const [found] = ofCode(validate(html), WcsDiagnosticCode.EventTokenUnbound);
    expect(found.message).toContain('so it never fires');
  });

  it('テンプレートの中（for・route）の束縛・ほかの名前の束縛でも、出す束縛があれば黙る', () => {
    const html = state(`rows: [], $eventTokens: ["rowFailed", "done"], $on: { rowFailed(state) {}, done(state) {} },`)
      + `<template data-wcs="for: rows"><my-row data-wcs="eventToken.failed: rowFailed"></my-row></template>`
      + `<wcs-router><template><wcs-route path="/"><my-form data-wcs="eventToken.value: done"></my-form></wcs-route></template></wcs-router>`;
    expect(ofCode(validate(html), WcsDiagnosticCode.EventTokenUnbound)).toEqual([]);
  });

  it('lint が見ない束縛がありうるページ（ファイルから読むレイアウト・eventToken. を書くスクリプト）では黙る', () => {
    const decl = state(`$eventTokens: ["done"], $on: { done(state) {} },`);
    expect(ofCode(validate(`${decl}<wcs-layout src="./layout.html"></wcs-layout>`), WcsDiagnosticCode.EventTokenUnbound)).toEqual([]);
    expect(ofCode(validate(`${decl}<script type="module">document.body.insertAdjacentHTML("beforeend", '<my-form data-wcs="eventToken.value: done"></my-form>');</script>`), WcsDiagnosticCode.EventTokenUnbound)).toEqual([]);
    // a comment is not markup: a layout named in one does not count
    expect(ofCode(validate(`${decl}<!-- <wcs-layout src="./layout.html"></wcs-layout> -->`), WcsDiagnosticCode.EventTokenUnbound)).toHaveLength(1);
  });

  it('ボリュームの $eventTokens（ランタイムは無視する）・読めない $eventTokens は見ない', () => {
    const volume = `<wcs-state><script type="module">export default { t: 1 };</script></wcs-state>`
      + `<wcs-state mount="v"><script type="module">export default { $eventTokens: ["a"] };</script></wcs-state>`;
    expect(ofCode(validate(volume), WcsDiagnosticCode.EventTokenUnbound)).toEqual([]);
    expect(ofCode(validate(state(`$eventTokens: TOKENS,`)), WcsDiagnosticCode.EventTokenUnbound)).toEqual([]);
  });

  it('src= の state のファイルでも、ファイルの名前の上で報告する', () => {
    const html = `<wcs-state src="./state.js"></wcs-state>`;
    const file = `export default {\n  $eventTokens: ["deleteDone"],\n};\n`;
    const [found] = ofCode(validate(html, 'en', { './state.js': file }), WcsDiagnosticCode.EventTokenUnbound);
    expect(file.slice(found.origin!.start, found.origin!.end)).toBe('deleteDone');
  });
});

describe('L4 wcs/array-index-assign — オブジェクトのキーへの代入を配列の添字と呼ばない', () => {
  const messageOf = (body: string): string => ofCode(validate(state(body)), WcsDiagnosticCode.ArrayIndexAssign)[0].message;

  it('{} を種にしたキーへの添字の形の代入はオブジェクトのキーとして言う（同じ code・error）', () => {
    const html = state(`budgetErrors: {},
  fail(errors) { for (const id of Object.keys(errors)) this.budgetErrors[id] = errors[id]; },`);
    const [found] = ofCode(validate(html), WcsDiagnosticCode.ArrayIndexAssign);
    expect(found.severity).toBe('error');
    expect(found.message).toBe('This assigns a key of "budgetErrors" in place. The state does not see the write, so no binding, getter or $watch that reads it changes, and nothing is rendered again. Assign a new object (this.budgetErrors = { ...this.budgetErrors, [key]: value }), or write the dot path this["budgetErrors.<id>"] = …');
    const [ja] = ofCode(validate(html, 'ja'), WcsDiagnosticCode.ArrayIndexAssign);
    expect(ja.message).toContain('"budgetErrors" のキーにその場で代入しています');
  });

  it('配列と分かる値・分からない値への数値の添字は従来どおり配列の添字として言う', () => {
    expect(messageOf(`items: [], set(i, x) { this.items[i] = x; },`)).toMatch(/^Assigning directly to an array index/);
    expect(messageOf(`/** @type {string[] | null} */ tags: null, set(i, x) { this.tags[i] = x; },`)).toMatch(/^Assigning directly to an array index/);
    expect(messageOf(`rows: null, set(x) { this.rows[0] = x; },`)).toMatch(/^Assigning directly to an array index/);
  });

  it('形の分からない値への名前の添字・キーを読んだオブジェクトへの代入はキーとして言う', () => {
    expect(messageOf(`cache: null, put(k, v) { this.cache[k] = v; },`)).toMatch(/^This assigns a key of "cache"/);
    expect(messageOf(`form: { name: "" }, put(k, v) { this.form[k] = v; },`)).toMatch(/^This assigns a key of "form"/);
  });
});

describe('L5 — その場で変えたリストの行のフィールドを「存在しない」と言わない', () => {
  const MARKUP = `<template data-wcs="for: budgetRows"><label data-wcs="textContent: .name"></label><input data-wcs="value: .value"></template>`;

  it('[] を種にし splice で行を入れるリスト（ledger-repair）: 行のフィールドは黙り、array-mutation の error だけ', () => {
    const html = state(`categories: [],
  budgetRows: [],
  sync() {
    const rows = this.categories.map((c) => ({ id: c.id, name: c.name, value: "" }));
    this.budgetRows.splice(0, this.budgetRows.length, ...rows);
  },`) + MARKUP;
    const found = validate(html);
    expect(ofCode(found, WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
    expect(ofCode(found, WcsDiagnosticCode.ArrayMutation)).toHaveLength(1);
  });

  it('push・unshift・this.x[i] = … でも同じ（行の getter だけがあるリストも）', () => {
    for (const change of ['this.budgetRows.push(row);', 'this.budgetRows.unshift(row);', 'this.budgetRows[i] = row;', 'this["budgetRows"].push(row);']) {
      const html = state(`budgetRows: [],
  get "budgetRows.*.error"() { return ""; },
  add(row, i) { ${change} },`) + MARKUP;
      expect(ofCode(validate(html), WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
    }
  });

  it('行の形が読めるリスト（種の行・代入の行リテラル・JSDoc）は、その場で変えても打ち間違いを報告する', () => {
    const seeded = state(`budgetRows: [{ name: "", value: "" }], add(row) { this.budgetRows.push(row); },`)
      + `<template data-wcs="for: budgetRows"><p data-wcs="textContent: .nmae"></p></template>`;
    expect(ofCode(validate(seeded), WcsDiagnosticCode.BindingPathMissing).map((d) => textOf(seeded, d))).toEqual(['.nmae']);
    const typed = state(`/** @type {{ name: string }[]} */ budgetRows: [], add(row) { this.budgetRows.push(row); },`)
      + `<template data-wcs="for: budgetRows"><p data-wcs="textContent: .nmae"></p></template>`;
    expect(ofCode(validate(typed), WcsDiagnosticCode.BindingPathMissing).map((d) => textOf(typed, d))).toEqual(['.nmae']);
  });

  it('その場で変えないリストは従来どおり（行の形が読めなければ報告する — JSDoc で形を宣言する）', () => {
    const html = state(`budgetRows: [], load(rows) { this.budgetRows = rows; },`) + MARKUP;
    expect(ofCode(validate(html), WcsDiagnosticCode.BindingPathMissing).map((d) => textOf(html, d))).toEqual(['.name', '.value']);
  });
});
