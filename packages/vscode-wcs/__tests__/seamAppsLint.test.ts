/**
 * seamAppsLint.test.ts — 継ぎ目アプリ（docs/seam-apps.md）で lint が黙っていた形。
 *
 *   - `<form>` の `onsubmit:` の `#prevent` 忘れ（`wcs/submit-without-prevent`、router-auth）
 *   - 別名・`Object.assign`・`$on` の state 引数を通したその場の変更（`wcs/nested-assign` / `wcs/array-*`、state-collab-board）
 *   - `$on` の state 引数を通した書き込みも `wcs/getter-untracked-read` の証拠（state-collab-board）
 *   - getter の中の `location`（`wcs/getter-untracked-read`、router-admin）
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics';
import { findInPlaceChanges, findLocationRead } from '../src/service/scriptAst';

const validate = (html: string, locale = 'en'): WcsDiagnostic[] => validateDocument(html, { locale });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);
const state = (body: string): string => `<wcs-state><script type="module">
export default { ${body} };
</script></wcs-state>
`;

describe('wcs/submit-without-prevent — onsubmit の #prevent 忘れ', () => {
  const page = (form: string, extra = '') => state(`
  username: "",
  login(e) { this.username = "x"; },
  stop(e) { e.preventDefault(); this.username = "x"; },
  ${extra}`) + form;

  it('#prevent も preventDefault も無いハンドラを <form> の onsubmit に束ねると warning', () => {
    const html = page(`<form data-wcs="onsubmit: login"><input name="password"></form>`);
    const found = ofCode(validate(html), WcsDiagnosticCode.SubmitWithoutPrevent);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('warning');
    expect(textOf(html, found[0])).toBe('onsubmit');
    expect(found[0].message).toContain('onsubmit#prevent: login');
  });

  it('#prevent 付き・preventDefault を呼ぶハンドラ・action 付きのフォーム・form でない要素・読めないハンドラでは黙る', () => {
    const forms = [
      `<form data-wcs="onsubmit#prevent: login"></form>`,
      `<form data-wcs="onsubmit#prevent,stop: login"></form>`,
      `<form data-wcs="onsubmit: stop"></form>`,
      `<form action="/login" method="post" data-wcs="onsubmit: login"></form>`,
      `<div data-wcs="onsubmit: login"></div>`,
      `<form data-wcs="onsubmit: unknownHandler"></form>`,
    ];
    for (const form of forms) expect(ofCode(validate(page(form)), WcsDiagnosticCode.SubmitWithoutPrevent)).toEqual([]);
  });
});

describe('その場の変更 — 別名・Object.assign・$on の state 引数（state-collab-board）', () => {
  it('別名を通した添字・プロパティ・破壊的メソッド・Object.assign を、形ごとの族の code（error）で報告する', () => {
    const html = state(`
  cards: [],
  a(card) { const cards = this.cards; const i = 0; cards[i] = card; this.cards = cards; },
  b(card) { const cards = this.cards; cards[0].title = card.title; },
  c(card) { const { cards } = this; cards.push(card); this.cards = cards; },
  d(card) { const cards = this.cards; Object.assign(cards[0], card); },`);
    const diags = validate(html);
    const index = ofCode(diags, WcsDiagnosticCode.ArrayIndexAssign);
    const nested = ofCode(diags, WcsDiagnosticCode.NestedAssign);
    const mutation = ofCode(diags, WcsDiagnosticCode.ArrayMutation);
    expect(index.map((d) => textOf(html, d))).toEqual(['cards[i]']);
    expect(nested.map((d) => textOf(html, d))).toEqual(['cards[0].title', 'Object.assign(cards[0], card)']);
    expect(mutation.map((d) => textOf(html, d))).toEqual(['cards.push(card)']);
    for (const d of [...index, ...nested, ...mutation]) expect(d.severity).toBe('error');
    expect(index[0].message).toContain('"cards" is this.cards');
    expect(index[0].message).toContain('writing the same value back does not add, remove or replace');
    expect(index[0].message).toContain('assign it to this.cards');
  });

  it('Object.assign(this.x…, …) を報告し、代入する先を書く（Object.assign(this, …) は 1 キーずつの書き込みなので黙る）', () => {
    const html = state(`
  form: { name: "" }, cards: [],
  a(v) { Object.assign(this.form, v); },
  b(card, i) { Object.assign(this.cards[i], card); },
  c(v) { Object.assign(this, v); },`);
    const nested = ofCode(validate(html), WcsDiagnosticCode.NestedAssign);
    expect(nested.map((d) => textOf(html, d))).toEqual(['Object.assign(this.form, v)', 'Object.assign(this.cards[i], card)']);
    expect(nested[0].message).toContain('assign it to this.form');
    expect(nested[1].message).toContain('assign it to this[`cards.${i}`]');
  });

  it('$on のハンドラの state 引数を通した変更も報告する（メソッド記法・アロー関数・function 式）', () => {
    const html = state(`
  board: { cards: [] },
  $eventTokens: ["cardEvent", "b", "c"],
  $on: {
    cardEvent(state, event) { state.board.cards.push(event.detail); },
    b: (s, event) => { s.board.cards = []; },
    c: function (st, event) { const cards = st["board.cards"]; cards[0] = event.detail; },
  },`);
    const diags = validate(html);
    expect(ofCode(diags, WcsDiagnosticCode.ArrayMutation).map((d) => textOf(html, d))).toEqual(['state.board.cards.push(event.detail)']);
    expect(ofCode(diags, WcsDiagnosticCode.NestedAssign).map((d) => textOf(html, d))).toEqual(['s.board.cards']);
    const index = ofCode(diags, WcsDiagnosticCode.ArrayIndexAssign);
    expect(index.map((d) => textOf(html, d))).toEqual(['cards[0]']);
    expect(index[0].message).toContain('assign it to st["board.cards"]');
  });

  it('複製の別名・再代入した別名・別名を読むだけ・新しい値の代入・state の 1 段目の書き込み・$ の API では黙る', () => {
    const html = state(`
  cards: [], n: 0,
  a(card) { const cards = [...this.cards]; cards.push(card); this.cards = cards; },
  b(card) { const cards = this.cards.slice(); cards[0] = card; this.cards = cards; },
  c(card) { let cards = this.cards; cards = cards.concat(card); cards.push(card); this.cards = cards; },
  d() { const cards = this.cards; return cards.filter((c) => c.done).length; },
  e(card) { this.cards = this.cards.with(0, card); },
  f(x) { const env = this.$env; env.x = x; },
  $eventTokens: ["t"],
  $on: { t(state, event) { state.n = event.detail; state["cards.0"] = event.detail; } },`);
    const diags = validate(html);
    for (const code of [WcsDiagnosticCode.NestedAssign, WcsDiagnosticCode.ArrayIndexAssign, WcsDiagnosticCode.ArrayMutation]) {
      expect(ofCode(diags, code)).toEqual([]);
    }
  });

  it('this を直に通した代入・破壊的メソッドは正規表現の規則の担当で、二重に報告しない', () => {
    const html = state(`items: [], add(x) { this.items.push(x); }, set0(x) { this.items[0] = x; },`);
    const diags = validate(html);
    expect(ofCode(diags, WcsDiagnosticCode.ArrayMutation)).toHaveLength(1);
    expect(ofCode(diags, WcsDiagnosticCode.ArrayIndexAssign)).toHaveLength(1);
  });

  it('findInPlaceChanges はパースできない本体・関数でない値では空', () => {
    expect(findInPlaceChanges('const = ;', 'body', 'this')).toEqual([]);
    expect(findInPlaceChanges('42', 'value', null)).toEqual([]);
    expect(findInPlaceChanges('() => 1', 'value', null)).toEqual([]);
  });
});

describe('wcs/getter-untracked-read — $on の state 引数を通した書き込みも証拠（state-collab-board）', () => {
  it('$on で state["board.cards"] を書くページの this.board.cards を報告する', () => {
    const html = state(`
  board: { cards: [] },
  get cards() { return this.board?.cards ?? []; },
  $eventTokens: ["cardEvent"],
  $on: { cardEvent(state, event) { state["board.cards"] = event.detail; } },`);
    const found = ofCode(validate(html), WcsDiagnosticCode.GetterUntrackedRead);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('this["board.cards"]');
  });

  it('アロー関数のハンドラ・テンプレートリテラルのキーも数え、書き込みが無ければ黙る', () => {
    const arrow = state(`
  board: { cards: [] },
  get cards() { return this.board.cards; },
  $eventTokens: ["e"],
  $on: { e: (s, event) => { s[\`board.cards\`] = event.detail; } },`);
    expect(ofCode(validate(arrow), WcsDiagnosticCode.GetterUntrackedRead)).toHaveLength(1);
    const none = state(`
  board: { cards: [] },
  get cards() { return this.board.cards; },
  $eventTokens: ["e"],
  $on: { e(state, event) { state.board = { cards: event.detail }; } },`);
    expect(ofCode(validate(none), WcsDiagnosticCode.GetterUntrackedRead)).toEqual([]);
  });
});

describe('wcs/getter-untracked-read — getter の中の location（router-admin）', () => {
  it('location.pathname / window.location を読む getter を warning で報告し、router の出力を勧める', () => {
    const html = state(`
  lang: "en",
  get switchHref() { return location.pathname.replace("/en", "/ja"); },
  get here() { return window.location.href; },`);
    const found = ofCode(validate(html), WcsDiagnosticCode.GetterUntrackedRead);
    expect(found.map((d) => textOf(html, d))).toEqual(['location.pathname', 'window.location.href']);
    expect(found[0].severity).toBe('warning');
    expect(found[0].message).toContain("bind <wcs-router>'s path / searchParams");
  });

  it('遷移で変わらない部分（protocol / host）・メソッドの中・this.location・location を束縛した getter・プロパティ名の location では黙る', () => {
    const html = state(`
  location: "Tokyo",
  get wsUrl() { return (location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + "/chat"; },
  go() { location.assign("/x"); },
  get place() { return this.location; },
  get shadow() { const location = { pathname: "/" }; return location.pathname; },
  get obj() { return { location: 1 }; },`);
    expect(ofCode(validate(html), WcsDiagnosticCode.GetterUntrackedRead)).toEqual([]);
    expect(findLocationRead('return (')).toBeNull();
    expect(findLocationRead('return new URL(location);')?.text).toBe('location');
  });
});
