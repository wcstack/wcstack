/**
 * stampRallyLint.test.ts — 継ぎ目アプリ stamp-rally（画面とセンサーの API のスタンプラリー）で見つかった lint の穴（4.25）。
 * 作者がわざとした 20 の間違いに、lint は 1 つも報告しなかった。著者が lint の検査にすると決めた 7 つのうち、束縛と
 * スクリプトのもの（リテラルの属性の 2 つ — `wcs/frequency-invalid`・`wcs/target-selector` — は ioAttributeValidator.test.ts）:
 *
 *   1. `wcs/path-readonly` — カスタム要素の出力を、setter の無い getter に束ねた（ランタイムはページごと初期化を拒む）
 *   2. `wcs/token-undeclared` — `$commandTokens` / `$eventTokens` そのものが無い state のトークン、`$on` のエントリ、
 *      `on*: $command.x` の code
 *   3. `wcs/command-event-argument` — データを取るコマンドに `on*: $command.x` を直結した
 *   5. `wcs/output-path-written` — 出力に束ねたパス（ほかには表示するだけ）へ、スクリプトが `true` を代入した
 *   7. 出力が書くスロットの下のパスを「無い」と言わない（`wcs/path-dynamic-unknown` を 1 回）
 *
 * ランタイムの条件（どの修飾子で要素が state に書くか・トークンの未宣言で何が起きるか）は、@wcstack/state の src を
 * happy-dom で動かして確かめた表をそのまま期待値にしている（state の dom/wc.ts の attachProperty / attachCommand）。
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { runValidation } from '../src/core/cli/runValidation.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';
import { BUILTIN_TAGS } from '../src/service/generated/builtinTags.generated.js';
import { collectMemberBindings, collectOutputSlots, createContractLookup, elementWrites, initModifier, memberRole } from '../src/service/elementMembers.js';
import { documentDeclaresNoTokens, scriptTokenNames } from '../src/service/tokenDeclarations.js';
import { parseWcsStateElements } from '../src/language/htmlParse.js';
import { collectGetterReads } from '../src/service/scriptAst.js';

const validate = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
  validateDocument(html, { locale, fileReader: (p: string) => files[p] });
const ofCode = (diags: readonly WcsDiagnostic[], code: string): WcsDiagnostic[] => diags.filter((d) => d.code === code);
const textOf = (html: string, d: WcsDiagnostic): string => html.slice(d.start, d.end);
const page = (state: string, body: string): string => `<wcs-state><script type="module">
export default {
${state}
};
</script></wcs-state>
${body}`;

// ---------------------------------------------------------------------------------------------------------------------
describe('1. wcs/path-readonly — カスタム要素の出力を setter の無い getter に束ねた', () => {
  const GETTER = `  open: false,\n  get keepAwake() { return this.open; },\n  toggle() { this.open = !this.open; },`;
  const readonly = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.PathReadonly);

  it('出力だけのメンバー（<wcs-wakelock> の held）を getter に束ねると error — 束ねた時点の書き込みで初期化が失敗する（p10）', () => {
    const html = page(GETTER, `<wcs-wakelock data-wcs="held: keepAwake"></wcs-wakelock>
<button data-wcs="onclick: toggle">toggle</button><p data-wcs="textContent: open"></p>`);
    const found = readonly(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['error', 'keepAwake']]);
    expect(found[0].message).toBe('"keepAwake" is a getter without a setter, but "held" is an output of <wcs-wakelock>: the element writes its value to "keepAwake", and the write made when it is bound fails, so the state fails to initialize ("keepAwake" is a getter without a setter). Bind a data path and read it in the getter (held: <a data key>), or add a setter (set "keepAwake"(v) { … })');
    expect(readonly(html, 'ja')[0].message).toBe('"keepAwake" は setter の無い getter ですが、"held" は <wcs-wakelock> が書くメンバー（出力）です。要素はその値を "keepAwake" に書くので、束ねた時点の書き込みが失敗し、state の初期化が失敗します（"keepAwake" is a getter without a setter）。データのパスを束ねてそれを getter から読む（held: <データのキー>）か、setter を足してください（set "keepAwake"(v) { … }）');
    // error なので --errors-only でも落ちる
    expect(runValidation([{ source: 'p10.html', text: html, kind: 'html' }], { locale: 'en', errorsOnly: true }).exitCode).toBe(1);
  });

  // state の src（dom/wc.ts の attachProperty）を happy-dom で動かした結果:
  //   出力だけ:  既定・#ro・#init=element・#sync=connect → 初期化が失敗 / #init=none → イベントのたびに失敗 / #ro,init=none → 書かない
  //   双方向:    既定・#init=none・#init=state・#init=auto → イベントのたびに失敗 / #init=element（#ro でも）→ 初期化が失敗 /
  //              #ro・#ro,init=auto → 書かない（auto は state の値が undefined のときだけ書く — ここでは分からない）
  it('修飾子ごとの判定がランタイムと同じであること（出力だけのメンバー）', () => {
    const verdict = (mods: string): string => {
      const found = readonly(page(GETTER, `<wcs-wakelock data-wcs="held${mods}: keepAwake"></wcs-wakelock>`));
      return found.length === 0 ? 'silent' : found[0].message.includes('fails to initialize') ? 'init' : 'event';
    };
    expect(['', '#ro', '#init=element', '#ro,init=element', '#sync=connect', '#ro,sync=connect'].map(verdict)).toEqual(['init', 'init', 'init', 'init', 'init', 'init']);
    expect(verdict('#init=none')).toBe('event');
    expect(verdict('#ro,init=none')).toBe('silent');
    expect(verdict('#init=none,ro')).toBe('silent');
    // 修飾子の空白はランタイムと同じに読む（キーと値を trim する）
    expect([verdict('#ro, init = none'), verdict('#init = none')]).toEqual(['silent', 'event']);
    // 出力だけのメンバーの #init=state / #init=auto はランタイムが別の理由（初期値の向き）で拒む: このコードでは言わない
    expect([verdict('#init=state'), verdict('#init=auto')]).toEqual(['silent', 'silent']);
  });

  it('修飾子ごとの判定がランタイムと同じであること（双方向のメンバー — <wcs-storage> の value）', () => {
    const state = `  name: "x",\n  get snapshot() { return { name: this.name }; },`;
    const found = (mods: string): WcsDiagnostic[] => readonly(page(state, `<wcs-storage key="k" data-wcs="value${mods}: snapshot"></wcs-storage>`));
    const verdict = (mods: string): string => (found(mods).length === 0 ? 'silent' : found(mods)[0].message.includes('fails to initialize') ? 'init' : 'event');
    expect(['', '#init=none', '#init=state', '#init=auto'].map(verdict)).toEqual(['event', 'event', 'event', 'event']);
    expect(['#init=element', '#ro,init=element'].map(verdict)).toEqual(['init', 'init']);
    expect(['#ro', '#ro,init=auto', '#ro,init=none'].map(verdict)).toEqual(['silent', 'silent', 'silent']);
    // 保存だけの getter は #ro で一方向にする — 文面がそう言う
    expect(found('')[0].message).toBe('"snapshot" is a getter without a setter, but "value" is a member <wcs-storage> writes too (an output as well as an input): the element writes its value to "snapshot", and that write fails each time the element reports a value ("snapshot" is a getter without a setter). Add a setter (set "snapshot"(v) { … }), or bind it one way with #ro (value#ro: snapshot — the state still writes the element)');
    expect(found('#init=element')[0].message).toContain('or take the first value from the state (remove #init=element)');
  });

  it('enableDirectionalInitialSync: false の木では、出力も束ねた時点では書かれない（イベントのたびに失敗・#ro なら書かない）', () => {
    const state = `  $behavior: { enableDirectionalInitialSync: false },\n${GETTER}`;
    const found = readonly(page(state, `<wcs-wakelock data-wcs="held: keepAwake"></wcs-wakelock>`));
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('that write fails each time the element reports a value');
    expect(readonly(page(state, `<wcs-wakelock data-wcs="held#ro: keepAwake"></wcs-wakelock>`))).toEqual([]);
  });

  it('spread が束ねる出力（<パス>.<メンバー> の getter）も同じ — 後ろで明示に束ねたメンバーは spread が束ねない', () => {
    const state = `  lock: {},\n  held: false,\n  get "lock.held"() { return true; },`;
    const html = page(state, `<wcs-wakelock data-wcs="...: lock"></wcs-wakelock>`);
    const found = readonly(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['error', 'lock']]);
    expect(found[0].message).toBe('"lock.held" is a getter without a setter, but "held", which "...: lock" binds, is an output of <wcs-wakelock>: the element writes its value to "lock.held", and the write made when it is bound fails, so the state fails to initialize ("lock.held" is a getter without a setter). Add a setter (set "lock.held"(v) { … }), or bind "held" to a data path after the spread (...: lock; held: <a data key>)');
    expect(readonly(page(state, `<wcs-wakelock data-wcs="...: lock; held: held"></wcs-wakelock>`))).toEqual([]);
  });

  it('for: の行の中の相対パス（行の getter）と、明示のプロパティ形（.held:）でも報告すること', () => {
    const html = page(`  items: [{ a: 1 }],\n  get "items.*.on"() { return true; },`,
      `<template data-wcs="for: items"><wcs-wakelock data-wcs="held: .on"></wcs-wakelock></template>`);
    expect(readonly(html).map((d) => textOf(html, d))).toEqual(['.on']);
    const dotted = page(GETTER, `<wcs-wakelock data-wcs=".held: keepAwake"></wcs-wakelock>`);
    expect(readonly(dotted).map((d) => textOf(dotted, d))).toEqual(['keepAwake']);
  });

  it('ページが定義する要素（static wcBindable をリテラルで読めるもの）の出力も同じに報告すること', () => {
    const element = `<script type="module">
class MyMeter extends HTMLElement {
  static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "level", event: "my-meter:level" }, { name: "gain", event: "my-meter:gain" }], inputs: [{ name: "gain" }, { name: "unit" }] };
}
customElements.define("my-meter", MyMeter);
</script>`;
    const state = `  n: 0,\n  get level() { return this.n; },`;
    const html = page(state, `${element}<my-meter data-wcs="level: level"></my-meter>`);
    expect(readonly(html).map((d) => [textOf(html, d), d.message.includes('an output of <my-meter>')])).toEqual([['level', true]]);
    // 双方向のメンバーはイベントのたび、入力だけのメンバーは要素が書かない
    expect(readonly(page(state, `${element}<my-meter data-wcs="gain: level"></my-meter>`))[0].message).toContain('each time the element reports a value');
    expect(readonly(page(state, `${element}<my-meter data-wcs="unit: level"></my-meter>`))).toEqual([]);
  });

  it('ランタイムが拒まない形には出さないこと: アクセサペア・データのパス・入力だけのメンバー・宣言を読めない要素・イベント束縛・名前空間', () => {
    const state = `  open: false,
  awake: false,
  get keepAwake() { return this.open; },
  get pair() { return this.open; },
  set pair(v) { this.open = v; },
  go() {},`;
    const html = page(state, `<wcs-wakelock data-wcs="held: pair"></wcs-wakelock>
<wcs-wakelock data-wcs="held: awake"></wcs-wakelock>
<wcs-wakelock data-wcs="active: keepAwake"></wcs-wakelock>
<wcs-wakelock data-wcs="active: keepAwake; held: awake; attr.title: keepAwake; class.on: keepAwake; onclick: go"></wcs-wakelock>
<their-lock data-wcs="held: keepAwake"></their-lock>
<wcs-fetch-header data-wcs="held: keepAwake"></wcs-fetch-header>
<div data-wcs="hidden: keepAwake; textContent: keepAwake"></div>
<template data-wcs="if: keepAwake"><p>on</p></template>
<wcs-timer data-wcs="once: keepAwake"></wcs-timer>`);
    expect(readonly(html)).toEqual([]);
  });

  it('ネイティブ要素の双方向の束縛は今までどおり（文面も変えない）', () => {
    const html = page(`  n: 1,\n  get total() { return this.n * 2; },`, `<input data-wcs="value: total">`);
    const found = readonly(html);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('writes back what the reader enters');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('2. wcs/token-undeclared — $commandTokens / $eventTokens の無い state・$on のエントリ・on*: $command.x', () => {
  const tokens = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
    ofCode(validate(html, locale, files), WcsDiagnosticCode.TokenUndeclared);

  it('$commandTokens の無い state の command.<method>: $command.x は error、スクリプトの this.$command.x も error（p11 — contacts の README の Quick Start）', () => {
    const html = page(`  picked: null,
  pickContact() {
    this.$command.select.emit(["name", "tel"], { multiple: false });
  },`, `<wcs-contacts data-wcs="command.select: $command.select; value: picked"></wcs-contacts>
<button data-wcs="onclick: pickContact">Pick a contact</button>`);
    const found = tokens(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['error', 'select'], ['error', '$command.select']]);
    expect(found[1].message).toBe('Command token "$command.select" is not declared: this state has no $commandTokens. Add $commandTokens: ["select"] to the state');
    expect(found[0].message).toBe(found[1].message);
    expect(tokens(html, 'ja')[1].message).toBe('コマンドトークン "$command.select" は宣言されていません。この state には $commandTokens がありません。state に $commandTokens: ["select"] を足してください');
  });

  it('空のリスト（$commandTokens: []）も「1 つも無い」と読むこと', () => {
    const html = page(`  $commandTokens: [],\n  go() { this.$command.a.emit(); },`, `<wcs-timer data-wcs="command.start: $command.a"></wcs-timer>`);
    expect(tokens(html).map((d) => [d.severity, textOf(html, d)])).toEqual([['error', 'a'], ['error', '$command.a']]);
  });

  it('on*: $command.x の未宣言は wcs/token-undeclared の warning（ランタイムはイベントのたびに #1302 を報告し、初期化は通る）— wcs/binding-path-missing ではない（l1）', () => {
    const html = page(`  $commandTokens: ["other"],\n  other() { this.$command.other.emit(); },`,
      `<wcs-timer data-wcs="command.start: $command.other"></wcs-timer><button data-wcs="onclick: $command.nope">nope</button>`);
    const all = validate(html);
    expect(ofCode(all, WcsDiagnosticCode.TokenUndeclared).map((d) => [d.severity, textOf(html, d), d.message])).toEqual([
      ['warning', '$command.nope', 'Command token "$command.nope" is not declared in $commandTokens'],
    ]);
    expect(ofCode(all, WcsDiagnosticCode.BindingPathMissing)).toEqual([]);
    // $commandTokens そのものが無い state でも同じ（warning のまま）
    const absent = page(`  n: 0,`, `<button data-wcs="onclick: $command.nope">nope</button>`);
    expect(tokens(absent).map((d) => [d.severity, textOf(absent, d)])).toEqual([['warning', '$command.nope']]);
    expect(tokens(absent)[0].message).toContain('this state has no $commandTokens');
  });

  it('$eventTokens の無い state の eventToken.<member>: name は warning（ランタイムはイベントのたびに #1301）', () => {
    const html = page(`  n: 0,`, `<wcs-timer data-wcs="eventToken.tick: ticked"></wcs-timer>`);
    const found = tokens(html);
    expect(found.map((d) => [d.severity, textOf(html, d)])).toEqual([['warning', 'ticked']]);
    expect(found[0].message).toBe('Event token "ticked" is not declared: this state has no $eventTokens. Add $eventTokens: ["ticked"] to the state');
    expect(tokens(html, 'ja')[0].message).toBe('イベントトークン "ticked" は宣言されていません。この state には $eventTokens がありません。state に $eventTokens: ["ticked"] を足してください');
  });

  it('$on のエントリが $eventTokens に無ければ error — ランタイムは state の読み込みを拒む（#23）。$eventTokens が無い state でも', () => {
    const missing = page(`  $eventTokens: ["ticked"],\n  $on: { ticked(state) {}, tikced(state) {}, "saved"(state) {} },`, `<wcs-timer data-wcs="eventToken.tick: ticked"></wcs-timer>`);
    const found = tokens(missing);
    expect(found.map((d) => [d.severity, textOf(missing, d)])).toEqual([['error', 'tikced'], ['error', 'saved']]);
    expect(found[0].message).toBe('The $on entry "tikced" is not declared in $eventTokens, so the state fails to load and the page is not initialized ($on entry "tikced" is not declared in $eventTokens). Add "tikced" to $eventTokens. Did you mean "ticked"?');
    const absent = page(`  n: 0,\n  $on: { ticked(state) { state.n = 1; } },`, ``);
    expect(tokens(absent).map((d) => [d.severity, textOf(absent, d)])).toEqual([['error', 'ticked']]);
    expect(tokens(absent)[0].message).toBe('The $on entry "ticked" is not declared in $eventTokens (this state has none), so the state fails to load and the page is not initialized ($on entry "ticked" is not declared in $eventTokens). Add $eventTokens: ["ticked"]');
    expect(tokens(absent, 'ja')[0].message).toBe('$on のエントリ "ticked" は $eventTokens に宣言されていません（この state には $eventTokens がありません）。state は読み込みで失敗し、ページは初期化されません（$on entry "ticked" is not declared in $eventTokens）。$eventTokens: ["ticked"] を足してください');
  });

  it('外のファイルの state（src=）でも、ページの束縛とファイルの中の両方に出ること', () => {
    const state = `export default {\n  picked: null,\n  pick() { this.$command.select.emit(["name"]); },\n};\n`;
    const html = `<wcs-state src="./state.js"></wcs-state>\n<wcs-contacts data-wcs="command.select: $command.select"></wcs-contacts><button data-wcs="onclick: pick">x</button>`;
    const found = tokens(html, 'en', { './state.js': state });
    expect(found.map((d) => [d.severity, d.origin === undefined ? textOf(html, d) : `${d.origin.path}:${state.slice(d.origin.start, d.origin.end)}`])).toEqual([
      ['error', './state.js:select'], ['error', '$command.select'],
    ]);
  });

  it('宣言を全部は読めない state では黙ること（リストがリテラルでない・spread・src を読めない・setInitialState・bind-component・JSON の宣言）', () => {
    const use = `<wcs-timer data-wcs="command.start: $command.a; eventToken.tick: ticked"></wcs-timer><button data-wcs="onclick: $command.b">b</button>`;
    for (const script of [
      `const NAMES = ["a", "b"];\nexport default { $commandTokens: NAMES, $eventTokens: EVENTS, $on: { ticked(state) {} }, go() { this.$command.a.emit(); } };`,
      `export default { ...shared, $on: { ticked(state) {} }, go() { this.$command.a.emit(); } };`,
      `export default { $commandTokens: [...MORE], $eventTokens: [...EVENTS], $on: { ticked(state) {} }, go() { this.$command.b.emit(); } };`,
      `const $commandTokens = ["a", "b"], $eventTokens = ["ticked"];\nexport default { $commandTokens, $eventTokens, $on: { ticked(state) {} }, go() { this.$command.a.emit(); } };`,
      `export default make();`,
      `export default class { go() { this.$command.a.emit(); } }`,
    ]) {
      expect(tokens(`<wcs-state><script type="module">${script}</script></wcs-state>\n${use}`), script).toEqual([]);
    }
    expect(tokens(`<wcs-state src="./missing.js"></wcs-state>\n${use}`)).toEqual([]);
    expect(tokens(`<wcs-state src="https://example.com/state.js"></wcs-state>\n${use}`)).toEqual([]);
    expect(tokens(`<wcs-state></wcs-state>\n${use}`)).toEqual([]);
    expect(tokens(`<wcs-state bind-component></wcs-state>\n${use}`)).toEqual([]);
    expect(tokens(`<wcs-state json='{"n":0,"$commandTokens":["a","b"],"$eventTokens":["ticked"]}'></wcs-state>\n${use}`)).toEqual([]);
    // state の無い断片は、束縛を検査しない（wcs/state-absent が 1 回言う）
    expect(tokens(use)).toEqual([]);
  });

  it('JSON の state（宣言を持てる）にトークンが無ければ報告し、アプリのコードだけが複製する template の中の束縛は見ないこと', () => {
    const json = `<wcs-state json='{"n":0}'></wcs-state>\n<wcs-timer data-wcs="command.start: $command.a"></wcs-timer>`;
    expect(tokens(json).map((d) => [d.severity, textOf(json, d)])).toEqual([['error', '$command.a']]);
    const cloned = page(`  n: 0,`, `<template id="dialog"><wcs-timer data-wcs="command.start: $command.a; eventToken.tick: t"></wcs-timer></template>`);
    expect(tokens(cloned)).toEqual([]);
  });

  it('ボリュームの $commandTokens はランタイムが無視する: root に無ければ報告し、ボリュームのスクリプトの中は見ないこと', () => {
    const html = `<wcs-state><script type="module">export default { n: 0 };</script></wcs-state>
<wcs-state mount="cart"><script type="module">export default { $commandTokens: ["a"], $on: { x(state) {} }, go() { this.$command.a.emit(); } };</script></wcs-state>
<wcs-timer data-wcs="command.start: $command.a"></wcs-timer>`;
    expect(tokens(html).map((d) => [d.severity, textOf(html, d)])).toEqual([['error', '$command.a']]);
  });

  it('scriptTokenNames / documentDeclaresNoTokens: 名前・「無い」・「分からない」を区別すること', () => {
    expect(scriptTokenNames(`export default { $commandTokens: ["a", 'b', \`c\`] };`, '$commandTokens')).toEqual(['a', 'b', 'c']);
    expect(scriptTokenNames(`export default { n: 0 };`, '$commandTokens')).toEqual([]);
    expect(scriptTokenNames(`export default { $commandTokens: [ /* none yet */ ] };`, '$commandTokens')).toEqual([]);
    // コメントと文字列の中の名前は宣言ではない
    expect(scriptTokenNames(`// $commandTokens: later\nexport default { note: "$commandTokens" };`, '$commandTokens')).toEqual([]);
    expect(scriptTokenNames(`export default { $commandTokens: NAMES };`, '$commandTokens')).toBeNull();
    expect(scriptTokenNames(`export default { $commandTokens: ["a", NAME] };`, '$commandTokens')).toBeNull();
    expect(scriptTokenNames(`export default { $commandTokens };`, '$commandTokens')).toBeNull();
    expect(scriptTokenNames(`export default { ...rest };`, '$commandTokens')).toBeNull();
    expect(scriptTokenNames(`const s = { n: 0 }; s.$commandTokens = ["a"]; export default s;`, '$commandTokens')).toBeNull();
    expect(scriptTokenNames(`export default { $eventTokens: ["e"] };`, '$commandTokens')).toEqual([]);
    const none = (html: string): boolean => documentDeclaresNoTokens(html, parseWcsStateElements(html), '$commandTokens');
    expect(none(`<wcs-state><script type="module">export default { n: 0 };</script></wcs-state>`)).toBe(true);
    expect(none(`<wcs-state><script type="module">export default { $commandTokens: ["a"] };</script></wcs-state>`)).toBe(false);
    expect(none(`<wcs-state json='{"n":0}'></wcs-state>`)).toBe(true);
    expect(none(`<wcs-state json='{"$commandTokens":["a"]}'></wcs-state>`)).toBe(false);
    expect(none(`<wcs-state json='not json'></wcs-state>`)).toBe(false);
    expect(none(`<script type="application/json" id="s">{"n":0}</script><wcs-state state="s"></wcs-state>`)).toBe(true);
    expect(none(`<wcs-state state="nowhere"></wcs-state>`)).toBe(false);
    expect(none(`<wcs-state src="./s.js"></wcs-state>`)).toBe(false);
    expect(none(`<wcs-state></wcs-state>`)).toBe(false);
    expect(none(`<p>no state</p>`)).toBe(false);
    // 宣言的 shadow root の中の state も、束縛が属しうる木
    expect(none(`<wcs-state><script type="module">export default { n: 0 };</script></wcs-state><template shadowrootmode="open"><wcs-state><script type="module">export default { $commandTokens: ["a"] };</script></wcs-state></template>`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('3. wcs/command-event-argument — データを取るコマンドに on*: $command.x を直結した', () => {
  const direct = (html: string, locale = 'en'): WcsDiagnostic[] => ofCode(validate(html, locale), WcsDiagnosticCode.CommandEventArgument);
  const STATE = `  $commandTokens: ["share", "lock", "pick", "get", "fs", "start", "load", "open", "focus"],`;

  it('引数を宣言する組み込みタグのコマンドが受けるトークンを on*: で直に emit すると、on* の束縛に warning（l2）', () => {
    const html = page(STATE, `<wcs-share data-wcs="command.share: $command.share"></wcs-share>
<wcs-screen-orientation data-wcs="command.lock: $command.lock"></wcs-screen-orientation>
<wcs-contacts data-wcs="command.select: $command.pick"></wcs-contacts>
<wcs-credential data-wcs="command.get: $command.get"></wcs-credential>
<button data-wcs="onclick: $command.share">share</button>
<button data-wcs="onclick#prevent: $command.lock">lock</button>
<a data-wcs="onpointerdown: $command.pick">pick</a>
<form data-wcs="onsubmit#prevent: $command.get"></form>`);
    const found = direct(html);
    expect(found.map((d) => [d.severity, d.tag, d.member, textOf(html, d)])).toEqual([
      ['warning', 'wcs-share', 'share', 'onclick'], ['warning', 'wcs-screen-orientation', 'lock', 'onclick'],
      ['warning', 'wcs-contacts', 'select', 'onpointerdown'], ['warning', 'wcs-credential', 'get', 'onsubmit'],
    ]);
    expect(found[0].message).toBe('"onclick: $command.share" emits the token straight from the event, so the commands that receive it are called with the event as their first argument. share() of <wcs-share> takes an argument there, and gets the event: share(event). Emit from a state method instead — write onclick: <method>, with <method>() { this.$command.share.emit(…) } passing what share() takes (emit with no argument when there is nothing to pass)');
    expect(direct(html, 'ja')[1].message).toBe('"onclick: $command.lock" はトークンをイベントから直接 emit するので、受け側のコマンドはイベントを第 1 引数として呼ばれます。<wcs-screen-orientation> の lock() は引数を取るコマンドで、lock(event) になります。state のメソッドから emit してください — onclick: <メソッド> と書き、<メソッド>() { this.$command.lock.emit(…) } で lock() が受け取る値を渡します（渡す値が無ければ引数なしで emit します）');
  });

  it('同じトークンを受ける、引数を取るコマンドが複数あれば、最初の 1 つを名指して残りを数えること', () => {
    const html = page(STATE, `<wcs-share data-wcs="command.share: $command.share"></wcs-share>
<wcs-ws url="/ws" data-wcs="command.sendMessage: $command.share"></wcs-ws>
<wcs-share data-wcs="command.share: $command.share"></wcs-share>
<button data-wcs="onclick: $command.share">go</button>`);
    const found = direct(html);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('share() of <wcs-share> takes an argument there, and gets the event: share(event) (and 1 more such receiver).');
  });

  it('受け取る種類でない第 1 引数を無視するコマンド（fetch / ws の close / idle の start / notify の close）への直結は報告しないこと — 同じ要素のほかのコマンドは報告する', () => {
    const tolerant = page(`  $commandTokens: ["load", "bye", "watch", "dismiss"],`, `<wcs-fetch url="/api" manual data-wcs="command.fetch: $command.load"></wcs-fetch>
<wcs-ws url="/ws" data-wcs="command.close: $command.bye"></wcs-ws>
<wcs-idle data-wcs="command.start: $command.watch"></wcs-idle>
<wcs-notify data-wcs="command.close: $command.dismiss"></wcs-notify>
<button data-wcs="onclick: $command.load">load</button>
<button data-wcs="onclick: $command.bye">disconnect</button>
<button data-wcs="onclick: $command.watch">watch</button>
<button data-wcs="onclick: $command.dismiss">dismiss</button>`);
    expect(direct(tolerant)).toEqual([]);
    const others = page(`  $commandTokens: ["say", "show"],`, `<wcs-ws url="/ws" data-wcs="command.sendMessage: $command.say"></wcs-ws>
<wcs-notify data-wcs="command.notify: $command.show"></wcs-notify>
<button data-wcs="onclick: $command.say">say</button>
<button data-wcs="onclick: $command.show">show</button>`);
    expect(direct(others).map((d) => [d.tag, d.member])).toEqual([['wcs-ws', 'sendMessage'], ['wcs-notify', 'notify']]);
    // 無視するコマンドと、引数を取るコマンドが同じトークンを受けていれば、取る方を名指す
    const mixed = page(`  $commandTokens: ["bye"],`, `<wcs-ws url="/ws" data-wcs="command.close: $command.bye"></wcs-ws>
<wcs-speak data-wcs="command.speak: $command.bye"></wcs-speak><button data-wcs="onclick: $command.bye">bye</button>`);
    expect(direct(mixed).map((d) => [d.tag, d.member, d.message.includes('more such')])).toEqual([['wcs-speak', 'speak', false]]);
  });

  it('引数を取らないコマンド・<wcs-fetch> の fetch・ネイティブ要素のコマンド・ページの要素のコマンドに直結するのは報告しないこと', () => {
    const html = page(STATE, `<script type="module">
customElements.define("my-player", class extends HTMLElement {
  static wcBindable = { protocol: "wc-bindable", version: 1, properties: [], commands: [{ name: "seek" }] };
  seek(seconds) {}
});
</script>
<wcs-fullscreen target="#viewer" data-wcs="command.requestFullscreen: $command.fs"><div id="viewer"></div></wcs-fullscreen>
<wcs-accelerometer data-wcs="command.start: $command.start"></wcs-accelerometer>
<wcs-fetch url="/api" manual data-wcs="command.fetch: $command.load"></wcs-fetch>
<dialog data-wcs="command.showModal: $command.open"></dialog>
<input data-wcs="command.focus: $command.focus">
<my-player data-wcs="command.seek: $command.pick"></my-player>
<button data-wcs="onclick: $command.fs">fs</button>
<button data-wcs="onclick: $command.start">start</button>
<button data-wcs="onclick: $command.load">load</button>
<button data-wcs="onclick: $command.open">open</button>
<button data-wcs="onclick: $command.focus">focus</button>
<button data-wcs="onclick: $command.pick">seek</button>`);
    expect(direct(html)).toEqual([]);
  });

  it('state のメソッドから emit する形（直し方）・受け側の無いトークン・eventToken・.onclick（プロパティ）・コメントの中は報告しないこと', () => {
    const html = page(`${STATE}\n  $eventTokens: ["share"],\n  doShare() { this.$command.share.emit({ title: "x" }); },\n  $on: { share(state) {} },`,
      `<wcs-share data-wcs="command.share: $command.share; eventToken.value: share"></wcs-share>
<button data-wcs="onclick: doShare">share</button>
<button data-wcs="onclick: $command.lock">nobody receives it</button>
<button data-wcs=".onclick: $command.share">a property</button>
<!-- <button data-wcs="onclick: $command.share">share</button> -->
<div data-wcs-ignore><button data-wcs="onclick: $command.share">share</button></div>`);
    expect(direct(html)).toEqual([]);
  });

  it('data-wcs-ignore の中の受け側は受け側に数えないこと', () => {
    const html = page(STATE, `<div data-wcs-ignore><wcs-share data-wcs="command.share: $command.share"></wcs-share></div>
<button data-wcs="onclick: $command.share">share</button>`);
    expect(direct(html)).toEqual([]);
  });

  it('for: の行の中の on*: でも同じ（イベントの後ろに添字が続く）', () => {
    const html = page(`${STATE}\n  items: [{ t: "a" }],`, `<wcs-share data-wcs="command.share: $command.share"></wcs-share>
<template data-wcs="for: items"><button data-wcs="onclick: $command.share">share</button></template>`);
    expect(direct(html).map((d) => textOf(html, d))).toEqual(['onclick']);
  });

  it('目録は各コマンドのメソッドが宣言する引数の数を持つこと（生成: scripts/emit-builtin-tags.mjs — Class.prototype[name].length）', () => {
    const arity = (tag: string): Readonly<Record<string, number>> | undefined => BUILTIN_TAGS[tag].commandArity;
    // この規則のもとになった 4 つ（stamp-rally）: データを取るコマンドは引数を宣言している
    expect(arity('wcs-screen-orientation')).toMatchObject({ lock: 1, unlock: 0 });
    expect(arity('wcs-share')?.share).toBeGreaterThan(0);
    expect(arity('wcs-contacts')?.select).toBeGreaterThan(0);
    expect(arity('wcs-credential')?.get).toBeGreaterThan(0);
    // 引数の無いコマンドは 0（ボタンへの直結が短い書き方）
    expect(arity('wcs-fullscreen')).toMatchObject({ requestFullscreen: 0, exitFullscreen: 0 });
    expect(arity('wcs-accelerometer')).toMatchObject({ start: 0, stop: 0 });
    // 対象外にした 4 つは引数を宣言している（数だけでは外れない — 規則の側の、理由を添えた一覧で外す）
    expect(arity('wcs-fetch')?.fetch).toBeGreaterThan(0);
    expect(arity('wcs-ws')?.close).toBeGreaterThan(0);
    expect(arity('wcs-idle')?.start).toBeGreaterThan(0);
    expect(arity('wcs-notify')?.close).toBeGreaterThan(0);
    // 形: 数は 0 以上の整数で、キーはそのタグの command。command の無いタグにはキーが無い
    for (const [tag, contract] of Object.entries(BUILTIN_TAGS)) {
      if (contract.commands.length === 0) {
        expect(contract.commandArity, tag).toBeUndefined();
        continue;
      }
      for (const [method, count] of Object.entries(contract.commandArity ?? {})) {
        expect(contract.commands, `${tag}.${method}`).toContain(method);
        expect(Number.isInteger(count) && count >= 0, `${tag}.${method}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('5. wcs/output-path-written — 出力に束ねたパスへ、スクリプトが true を代入した', () => {
  const written = (html: string, locale = 'en', files: Record<string, string> = {}): WcsDiagnostic[] =>
    ofCode(validate(html, locale, files), WcsDiagnosticCode.OutputPathWritten);
  const FS = `<wcs-fullscreen target="#viewer" data-wcs="active: viewerFs; command.requestFullscreen: $command.fsGo; command.exitFullscreen: $command.fsExit"><div id="viewer"></div></wcs-fullscreen>`;
  const TOKENS = `  $commandTokens: ["fsGo", "fsExit"],`;

  it('出力に束ねたパスへメソッドが true を代入すると warning — 要素とメンバー、要素のコマンドを言う（l2）', () => {
    const html = page(`${TOKENS}\n  viewerFs: false,\n  open() { this.viewerFs = true; },`, `${FS}<button data-wcs="onclick: open">open</button>`);
    const found = written(html);
    expect(found.map((d) => [d.severity, d.tag, d.member, d.statePath, textOf(html, d)])).toEqual([['warning', 'wcs-fullscreen', 'active', 'viewerFs', 'this.viewerFs']]);
    expect(found[0].message).toBe('"viewerFs" is bound to "active" of <wcs-fullscreen>, an output: the element writes it, and a write from a script does not reach the element. Assigning true makes the element do nothing — only the page now says so. Ask the element with a command (requestFullscreen, exitFullscreen — bind command.<method>: $command.<name> and call this.$command.<name>.emit() here), and let the element write "viewerFs"');
    expect(written(html, 'ja')[0].message).toBe('"viewerFs" は <wcs-fullscreen> の出力 "active" に束ねてあります。出力は要素が書くもので、スクリプトの書き込みは要素に届きません。true を代入しても要素は何もせず、ページだけがそうなったことにします。要素にはコマンドで頼んでください（requestFullscreen・exitFullscreen — command.<メソッド>: $command.<名前> を束ね、ここで this.$command.<名前>.emit() を呼ぶ）。"viewerFs" は要素が書きます');
  });

  it('コマンドの無い要素の出力では、代入を外すように言うこと', () => {
    const html = page(`  dark: false,\n  force() { this.dark = true; },`, `<wcs-media-query query="(prefers-color-scheme: dark)" data-wcs="matched: dark"></wcs-media-query>`);
    expect(written(html)[0].message).toContain('<wcs-media-query> has no command: the value is the element\'s to report. Remove the assignment');
  });

  it('setter・$watch のハンドラ・$on のハンドラ（state 引数）・別名・入れ子の関数・["パス"] の形の書き込みも見ること', () => {
    const html = page(`${TOKENS}
  $eventTokens: ["tick"],
  viewerFs: false,
  n: 0,
  get wanted() { return this.n > 0; },
  set wanted(v) { this.viewerFs = true; this.n = v ? 1 : 0; },
  viaAlias() { const self = this; self.viewerFs = true; },
  viaBracket() { this["viewerFs"] = true; },
  later() { setTimeout(() => { this.viewerFs = true; }, 0); },
  $watch: { n(value) { this.viewerFs = true; }, "wanted": function () { this.viewerFs = true; } },
  $on: { tick(state, event) { state.viewerFs = true; } },`,
      `${FS}<wcs-timer data-wcs="eventToken.tick: tick"></wcs-timer>`);
    const found = written(html);
    expect(found.map((d) => textOf(html, d))).toEqual([
      'this.viewerFs', 'self.viewerFs', 'this["viewerFs"]', 'this.viewerFs', 'this.viewerFs', 'this.viewerFs', 'state.viewerFs',
    ]);
  });

  it('$on のハンドラが値に書いた関数（function 式・アロー関数）でも、state 引数を通した書き込みを見ること', () => {
    const html = page(`  $eventTokens: ["a", "b"],\n  viewerFs: false,\n  $on: { a: function (s, e) { s.viewerFs = true; }, b: (st) => { st.viewerFs = true; } },`,
      `${FS.replace(/; command[^"]*/, '')}<wcs-timer data-wcs="eventToken.tick: a"></wcs-timer><wcs-timer data-wcs="eventToken.tick: b"></wcs-timer>`);
    expect(written(html).map((d) => textOf(html, d))).toEqual(['s.viewerFs', 'st.viewerFs']);
  });

  it('true でない値の代入は報告しないこと — 使い終えた出力を戻すのは普通の書き方', () => {
    const html = page(`${TOKENS}
  viewerFs: false,
  v: true,
  a() { this.viewerFs = false; },
  b() { this.viewerFs = null; },
  c() { this.viewerFs = this.v; },
  d() { this.viewerFs = !this.viewerFs; },
  e() { this.viewerFs = true && this.v; },
  f() { this.viewerFs = this.v ? true : false; },
  g() { this.viewerFs ||= true; },
  h() { this.viewerFs = 1; },
  i() { this.viewerFs = "true"; },
  j() { if (this.viewerFs === true) this.v = true; },`, FS);
    expect(written(html)).toEqual([]);
  });

  it('ほかに表示するだけの束縛があっても報告すること — 実際のページの形（m18a: class.fullscreen: viewerFs と、値を読む getter・$watch）', () => {
    const html = page(`${TOKENS}
  viewerFs: false,
  get viewerButtonLabel() { return this.viewerFs ? "閉じる" : "全画面で見る"; },
  toggleViewer() {
    if (this.viewerFs) { this.$command.fsExit.emit(); return; }
    this.viewerFs = true;   // "active" is bound to viewerFs: surely writing it fills the screen
  },
  $watch: { viewerFs(cur) { if (cur) this.locked = true; } },
  locked: false,`, `<wcs-fullscreen target="#viewer" data-wcs="active: viewerFs; command.requestFullscreen: $command.fsGo; command.exitFullscreen: $command.fsExit"></wcs-fullscreen>
<div id="viewer" class="viewer" data-wcs="class.fullscreen: viewerFs"><button data-wcs="onclick: toggleViewer; textContent: viewerButtonLabel"></button></div>`);
    expect(written(html).map((d) => [d.severity, d.statePath, textOf(html, d)])).toEqual([['warning', 'viewerFs', 'this.viewerFs']]);
  });

  it('表示するだけの束縛は、どれがあっても報告すること — class. / attr. / style. / textContent / hidden / {{ }} / コメントの束縛 / if: / 一方向（#ro）のネイティブの束縛', () => {
    const script = `${TOKENS}\n  viewerFs: false,\n  open() { this.viewerFs = true; },`;
    for (const also of [
      `<div data-wcs="class.fullscreen: viewerFs"></div>`,
      `<div data-wcs="attr.data-fs: viewerFs|string; style.outline: viewerFs|iif('2px solid','none')"></div>`,
      `<p data-wcs="textContent: viewerFs"></p>`,
      `<p data-wcs="hidden: viewerFs"></p>`,
      `<details data-wcs="open: viewerFs"></details>`,
      `<button data-wcs="disabled: viewerFs">go</button>`,
      `<p>{{ viewerFs }}</p>`,
      `<p><!--@@: viewerFs--></p>`,
      `<template data-wcs="if: viewerFs"><p>on</p></template>`,
      `<input type="checkbox" data-wcs="checked#ro: viewerFs">`,
      `<wcs-pip target="#v" data-wcs="active: viewerFs"><video id="v"></video></wcs-pip>`,
      `<div data-wcs-ignore><input type="checkbox" data-wcs="checked: viewerFs"></div>`,
    ]) {
      expect(written(page(script, `${FS}${also}`)), also).toHaveLength(1);
    }
  });

  it('state の値を自分のものとして受け取る束縛にも束ねたパスは報告しないこと — 入力・双方向のメンバー、ネイティブの双方向の束縛、宣言を読めない要素のメンバー', () => {
    const script = `${TOKENS}\n  viewerFs: false,\n  open() { this.viewerFs = true; },`;
    for (const also of [
      // ネイティブ要素の双方向の束縛: スクリプトは、利用者が入れる値を入れている
      `<input type="checkbox" data-wcs="checked: viewerFs">`,
      `<input type="radio" value="true" data-wcs="radio: viewerFs">`,
      `<input data-wcs="value: viewerFs">`,
      `<select data-wcs="value: viewerFs"><option>true</option></select>`,
      // カスタム要素の入力・双方向のメンバー: 書き込みはその要素を動かす
      `<wcs-wakelock data-wcs="active: viewerFs"></wcs-wakelock>`,
      `<wcs-fetch url="/x" manual data-wcs="trigger: viewerFs"></wcs-fetch>`,
      `<wcs-fetch url="/x" manual data-wcs="trigger#ro: viewerFs"></wcs-fetch>`,
      // 宣言を読めないカスタム要素（入力かもしれない）と、目録に無い wcs-* のタグ（router）
      `<their-thing data-wcs="active: viewerFs"></their-thing>`,
      `<wcs-router data-wcs="navigateUrl: viewerFs"></wcs-router>`,
    ]) {
      expect(written(page(script, `${FS}${also}`)), also).toEqual([]);
    }
    // 宣言を読めない要素の spread は、そのパスの 1 段下を受け取りうる
    const spread = page(`${TOKENS}\n  fs: { active: false },\n  open() { this["fs.active"] = true; },`,
      `<wcs-fullscreen target="self" data-wcs="active: fs.active"></wcs-fullscreen><their-thing data-wcs="...: fs"></their-thing>`);
    expect(written(spread)).toEqual([]);
  });

  it('アクセサのあるパス（setter が要素に頼める）・出力に束ねていないパス・a.b への素の代入・getter の中は報告しないこと', () => {
    const html = page(`${TOKENS}
  other: false,
  box: { on: false },
  get viewerFs() { return this.other; },
  set viewerFs(v) { v ? this.$command.fsGo.emit() : this.$command.fsExit.emit(); },
  open() { this.viewerFs = true; this.other = true; this.box.on = true; },`, FS);
    expect(written(html)).toEqual([]);
  });

  it('spread が束ねる出力（<パス>.active）への true も同じ — spread の入力のメンバー（<パス>.target）は対象外', () => {
    const html = page(`${TOKENS}\n  fs: { active: false, target: "#viewer" },\n  open() { this["fs.active"] = true; this["fs.target"] = true; },`,
      `<wcs-fullscreen data-wcs="...: fs; command.requestFullscreen: $command.fsGo"><div id="viewer"></div></wcs-fullscreen>`);
    expect(written(html).map((d) => [d.statePath, textOf(html, d)])).toEqual([['fs.active', 'this["fs.active"]']]);
  });

  it('ボリュームのメソッドの書き込みはマウントパスの下のパスとして見ること・外のファイルの state（src=）でも報告すること', () => {
    const volume = `<wcs-state><script type="module">export default { n: 0 };</script></wcs-state>
<wcs-state mount="viewer"><script type="module">export default { fs: false, open() { this.fs = true; } };</script></wcs-state>
<wcs-fullscreen target="self" data-wcs="active: viewer.fs"></wcs-fullscreen>`;
    expect(written(volume).map((d) => [d.statePath, textOf(volume, d)])).toEqual([['viewer.fs', 'this.fs']]);
    const state = `export default {\n  viewerFs: false,\n  open() { this.viewerFs = true; },\n};\n`;
    const html = `<wcs-state src="./state.js"></wcs-state>\n<wcs-fullscreen target="self" data-wcs="active: viewerFs"></wcs-fullscreen>`;
    const found = written(html, 'en', { './state.js': state });
    expect(found.map((d) => [d.origin?.path, state.slice(d.origin!.start, d.origin!.end)])).toEqual([['./state.js', 'this.viewerFs']]);
  });

  it('ページが定義する要素（宣言をリテラルで読めるもの）の出力でも報告すること', () => {
    const html = page(`  playing: false,\n  play() { this.playing = true; },`, `<script type="module">
customElements.define("my-player", class extends HTMLElement {
  static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "playing", event: "my-player:playing" }], commands: [{ name: "play" }] };
});
</script><my-player data-wcs="playing: playing"></my-player>`);
    expect(written(html).map((d) => [d.tag, d.member, d.message.includes('(play — bind command.<method>')])).toEqual([['my-player', 'playing', true]]);
  });

  it('collectGetterReads: 単純代入の右辺がリテラルの true のときだけ assignsTrue が付くこと（stateParam は $on の state 引数）', () => {
    const writes = (body: string, stateParam?: string) => (collectGetterReads(body, { writes: true, ...(stateParam === undefined ? {} : { stateParam }) }) ?? [])
      .filter((r) => r.form === 'write').map((r) => [r.path, r.assignsTrue === true]);
    expect(writes('this.a = true; this.b = false; this.c = (true); this["d.e"] = true; this.f = this.g = true;')).toEqual([
      ['a', true], ['b', false], ['c', true], ['d.e', true], ['f', false], ['g', true],
    ]);
    expect(writes('state.a = true; this.b = true;', 'state')).toEqual([['a', true]]);
    // 引数の名前を本体で束縛し直していれば、どの値か分からないので読まない
    expect(writes('let state = other(); state.a = true;', 'state')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('7. 出力が書くスロットの下のパス — wcs/binding-path-missing ではなく wcs/path-dynamic-unknown を 1 回', () => {
  const missing = (diags: readonly WcsDiagnostic[]): WcsDiagnostic[] => ofCode(diags, WcsDiagnosticCode.BindingPathMissing);
  const unknown = (diags: readonly WcsDiagnostic[]): WcsDiagnostic[] => ofCode(diags, WcsDiagnosticCode.PathDynamicUnknown);

  it('<wcs-contacts> の value が書くスロットの下（picked.0.name.0）は「無い」と言わず、キーの上に info を 1 回（p11 — contacts の README）', () => {
    const html = page(`  $commandTokens: ["select"],\n  picked: null,\n  pickContact() { this.$command.select.emit(["name", "tel"], { multiple: false }); },`,
      `<wcs-contacts data-wcs="command.select: $command.select; value: picked"></wcs-contacts>
<button data-wcs="onclick: pickContact">Pick a contact</button>
<p data-wcs="textContent: picked.0.name.0"></p><p>{{ picked.0.tel.0 }}</p>`);
    const all = validate(html);
    expect(missing(all)).toEqual([]);
    expect(unknown(all).map((d) => [d.severity, d.tag, d.member, d.statePath, textOf(html, d)])).toEqual([['info', 'wcs-contacts', 'value', 'picked', 'picked']]);
    expect(unknown(all)[0].message).toBe('"picked" is written by "value" of <wcs-contacts>, an output, so it holds whatever the element gives: its shape cannot be read statically, and the 2 paths bound under it are not checked. Give the key a JSDoc @type with its shape, or declare it in the stateSchema of wcstack.manifest.json to have them checked');
    expect(unknown(validate(html, 'ja'))[0].message).toBe('"picked" は <wcs-contacts> の出力 "value" が書くので、中身は要素が渡すものです。その形は静的に読めないので、その下に束ねたパス（2 件）は検査していません。キーに形を表す JSDoc の @type を付けるか、wcstack.manifest.json の stateSchema に宣言すると検査されます');
    // info と warning だけ: 既定でも --strict でも exit 0 のまま（info は数えない）
    expect(all.every((d) => d.severity === 'info')).toBe(true);
  });

  it('種がどの形でも同じ（null・[]・{}・形のあるリテラル）— 最初の同期で要素の値に置き換わる。行のパス（for: の中の .name）も数えること', () => {
    const html = page(`  users: [],\n  one: {},\n  shaped: { name: "" },\n  text: "",`, `<wcs-fetch url="/a" data-wcs="value: users"></wcs-fetch>
<wcs-fetch url="/b" data-wcs="value: one"></wcs-fetch>
<wcs-fetch url="/c" data-wcs="value: shaped"></wcs-fetch>
<wcs-fetch url="/d" data-wcs="value: text"></wcs-fetch>
<ul><template data-wcs="for: users"><li data-wcs="textContent: .name"></li><li>{{ .email }}</li></template></ul>
<p data-wcs="textContent: users.0.name"></p><p data-wcs="textContent: one.title"></p>
<p data-wcs="textContent: shaped.name"></p><p data-wcs="textContent: shaped.nmae"></p>`);
    const all = validate(html);
    expect(missing(all)).toEqual([]);
    // users: .name と users.0.name は同じパス（users.*.name）として 2 件に数える。shaped.name は種が宣言しているので数えない
    expect(unknown(all).map((d) => [textOf(html, d), /the (\d+ paths|path) bound/.exec(d.message)![1]])).toEqual([
      ['users', '3 paths'], ['one', 'path'], ['shaped', 'path'],
    ]);
  });

  it('spread が書く <パス>.value の下も同じ — info は spread のパスのキーの上（router-spa の形）', () => {
    const html = page(`  productFetch: { value: null, loading: false, error: null, status: 0 },`, `<wcs-fetch data-wcs="...: productFetch"></wcs-fetch>
<h2 data-wcs="textContent: productFetch.value.name"></h2><p data-wcs="textContent: productFetch.value.price"></p>
<p data-wcs="hidden: productFetch.loading"></p>`);
    const all = validate(html);
    expect(missing(all)).toEqual([]);
    expect(unknown(all).map((d) => [d.statePath, textOf(html, d)])).toEqual([['productFetch.value', 'productFetch']]);
    expect(unknown(all)[0].message).toContain('"productFetch.value" is written by "value" of <wcs-fetch>, an output');
  });

  it('スクリプトの読み・$watch のキーも、スロットの下は「無い」と言わないこと', () => {
    const html = page(`  picked: null,
  get firstName() { return this["picked.0.name.0"] ?? ""; },
  $watch: { "picked.0.name": function () {} },`, `<wcs-contacts data-wcs="value: picked"></wcs-contacts><p data-wcs="textContent: firstName"></p>`);
    const all = validate(html);
    expect(ofCode(all, WcsDiagnosticCode.ReadPathMissing)).toEqual([]);
    expect(ofCode(all, WcsDiagnosticCode.WatchPathMissing)).toEqual([]);
    // 下に束ねたパスが無ければ、何も言わない
    expect(unknown(all)).toEqual([]);
  });

  it('キーに JSDoc の @type があれば、その形で検査して info は出さないこと（ほかの読めない値と同じ）', () => {
    const html = page(`  /** @type {{ name: string[], tel: string[] }[] | null} */\n  picked: null,`, `<wcs-contacts data-wcs="value: picked"></wcs-contacts>
<p data-wcs="textContent: picked.0.name.0"></p><p data-wcs="textContent: picked.0.nmae.0"></p>`);
    const all = validate(html);
    expect(unknown(all)).toEqual([]);
    expect(missing(all).map((d) => textOf(html, d))).toEqual(['picked.0.nmae.0']);
  });

  it('上のキーの JSDoc の @type が形を宣言するスロット（spread の <パス>.value）も、その形で検査すること', () => {
    const html = page(`  /** @type {{ value: { name: string } | null, loading: boolean }} */\n  productFetch: { value: null, loading: false },`,
      `<wcs-fetch data-wcs="...: productFetch"></wcs-fetch>
<p data-wcs="textContent: productFetch.value.name"></p><p data-wcs="textContent: productFetch.value.nmae"></p>`);
    const all = validate(html);
    expect(unknown(all)).toEqual([]);
    expect(missing(all).map((d) => textOf(html, d))).toEqual(['productFetch.value.nmae']);
  });

  it('スロットでないパスは今までどおり検査すること — 双方向のメンバー（<wcs-storage> の value）・入力・要素が書かない束縛（#ro,init=none）・宣言を読めない要素・ネイティブ要素', () => {
    const html = page(`  saved: null,\n  body: null,\n  quiet: null,\n  theirs: null,\n  text: null,`, `<wcs-storage key="k" data-wcs="value#init=element: saved"></wcs-storage>
<wcs-fetch url="/x" data-wcs="body: body"></wcs-fetch>
<wcs-contacts data-wcs="value#ro,init=none: quiet"></wcs-contacts>
<their-picker data-wcs="value: theirs"></their-picker>
<input data-wcs="value: text">
<p data-wcs="textContent: saved.name"></p><p data-wcs="textContent: body.name"></p><p data-wcs="textContent: quiet.name"></p>
<p data-wcs="textContent: theirs.name"></p><p data-wcs="textContent: text.name"></p>`);
    const all = validate(html);
    expect(unknown(all)).toEqual([]);
    expect(missing(all).map((d) => textOf(html, d))).toEqual(['saved.name', 'body.name', 'quiet.name', 'theirs.name', 'text.name']);
  });

  it('スロットそのもの・スロットの外の打ち間違いは今までどおり報告すること', () => {
    const html = page(`  picked: null,\n  count: 0,`, `<wcs-contacts data-wcs="value: picked"></wcs-contacts>
<p data-wcs="textContent: pickd"></p><p data-wcs="textContent: cuont"></p><p data-wcs="textContent: picked.0.name.0"></p>`);
    const all = validate(html);
    expect(missing(all).map((d) => textOf(html, d))).toEqual(['pickd', 'cuont']);
    expect(unknown(all)).toHaveLength(1);
  });

  it('アクセサ（getter）に束ねた出力はスロットにしないこと — getter の返す形が束縛の読む形', () => {
    const html = page(`  raw: null,\n  get picked() { return this.raw; },\n  set picked(v) { this.raw = v; },`,
      `<wcs-contacts data-wcs="value: picked"></wcs-contacts><p data-wcs="textContent: picked.0.name.0"></p>`);
    expect(unknown(validate(html))).toEqual([]);
  });

  it('外のファイルの state（src=）ではファイルの中のキーの上に、JSON の state では束縛の上に出ること', () => {
    const state = `export default {\n  picked: null,\n};\n`;
    const html = `<wcs-state src="./state.js"></wcs-state>\n<wcs-contacts data-wcs="value: picked"></wcs-contacts><p data-wcs="textContent: picked.0.name.0"></p>`;
    const found = unknown(validate(html, 'en', { './state.js': state }));
    expect(found.map((d) => [d.origin?.path, state.slice(d.origin!.start, d.origin!.end)])).toEqual([['./state.js', 'picked']]);
    const json = `<wcs-state json='{"picked":null}'></wcs-state>\n<wcs-contacts data-wcs="value: picked"></wcs-contacts><p data-wcs="textContent: picked.0.name.0"></p>`;
    const all = validate(json);
    expect(missing(all)).toEqual([]);
    expect(unknown(all).map((d) => textOf(json, d))).toEqual(['picked']);
    expect(json.slice(unknown(all)[0].start - 7, unknown(all)[0].start)).toBe('value: ');
  });

  it('stateSchema があれば schema が決める（info は出さない）', () => {
    const html = page(`  picked: null,`, `<wcs-contacts data-wcs="value: picked"></wcs-contacts><p data-wcs="textContent: picked.0.name.0"></p><p data-wcs="textContent: picked.0.nmae"></p>`);
    const schema = { type: 'object', properties: { picked: { type: ['array', 'null'], items: { type: 'object', properties: { name: { type: 'array', items: { type: 'string' } } } } } } } as const;
    const all = validateDocument(html, { locale: 'en', applicationSchema: schema as never });
    expect(unknown(all)).toEqual([]);
    expect(ofCode(all, WcsDiagnosticCode.PathNonexistent).map((d) => textOf(html, d))).toEqual(['picked.0.nmae']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('elementMembers — 束縛が要素の出力か入力か（組み込みタグの目録とページの要素の宣言）', () => {
  it('memberRole: properties だけ → output、inputs だけ → input、両方 → two-way、宣言に無ければ null（プロトタイプの名前も）', () => {
    const fetch = BUILTIN_TAGS['wcs-fetch'];
    expect(memberRole(fetch, 'value')).toBe('output');
    expect(memberRole(fetch, 'url')).toBe('input');
    expect(memberRole(fetch, 'trigger')).toBe('two-way');
    expect(memberRole(fetch, 'nope')).toBeNull();
    expect(memberRole(fetch, 'constructor')).toBeNull();
    expect(memberRole(fetch, 'toString')).toBeNull();
  });

  it('elementWrites: 修飾子ごとに、要素がパスに書くか', () => {
    const w = (role: 'output' | 'two-way' | 'input', ...modifiers: string[]): boolean => elementWrites({ role, modifiers });
    expect([w('output'), w('output', 'ro'), w('output', 'init=none'), w('output', 'ro', 'init=none')]).toEqual([true, true, true, false]);
    expect([w('two-way'), w('two-way', 'ro'), w('two-way', 'ro', 'init=element'), w('two-way', 'ro', 'init=auto')]).toEqual([true, false, true, false]);
    expect([w('input'), w('input', 'init=element')]).toEqual([false, false]);
    expect([w('output', 'ro', 'init = none'), w('two-way', 'ro', 'init = element')]).toEqual([false, true]);
    expect([initModifier([]), initModifier(['ro']), initModifier(['ro', 'init=auto']), initModifier(['init = none'])]).toEqual([null, null, 'auto', 'none']);
  });

  it('createContractLookup: ネイティブ要素・wcBindable の無いヘルパータグ・宣言を読めない要素は null', () => {
    const html = `<script type="module">
customElements.define("my-a", class extends HTMLElement { static wcBindable = { protocol: "wc-bindable", version: 1, properties: [{ name: "v", event: "e" }] }; });
customElements.define("my-b", class extends HTMLElement { static wcBindable = makeContract(); });
</script>`;
    const lookup = createContractLookup(html);
    expect(lookup('div')).toBeNull();
    expect(lookup(undefined)).toBeNull();
    expect(lookup('wcs-fetch')?.properties).toContain('value');
    expect(lookup('wcs-fetch-header')).toBeNull();
    expect(lookup('wcs-unknown')).toBeNull();
    expect(lookup('my-a')?.properties).toEqual(['v']);
    expect(lookup('my-b')).toBeNull();
    expect(lookup('my-c')).toBeNull();
  });

  it('collectMemberBindings / collectOutputSlots: 書いた束縛・spread・行の相対パス・後ろの明示の束縛・data-wcs-ignore', () => {
    const html = `<wcs-fetch data-wcs="...: f; status: code"></wcs-fetch>
<template data-wcs="for: rows"><wcs-contacts data-wcs="value: .picked; onclick: go; class.on: .on; nope: x"></wcs-contacts></template>
<wcs-contacts data-wcs="value: .outside"></wcs-contacts>
<div data-wcs-ignore><wcs-contacts data-wcs="value: ignored"></wcs-contacts></div>
<wcs-storage data-wcs="value#ro: saved"></wcs-storage><wcs-contacts data-wcs="value#ro,init=none: quiet"></wcs-contacts>
<div data-wcs="textContent: x"></div><their-el data-wcs="value: y"></their-el>`;
    const bindings = collectMemberBindings(html, 'data-wcs', createContractLookup(html));
    const spread = bindings.filter((b) => b.spread);
    expect(spread.every((b) => b.tag === 'wcs-fetch' && b.modifiers.length === 0)).toBe(true);
    expect(spread.map((b) => b.path)).toContain('f.value');
    expect(spread.map((b) => b.path)).toContain('f.url');
    // `status` は spread の後ろで明示に束ねた: spread は束ねない
    expect(spread.map((b) => b.path)).not.toContain('f.status');
    expect(bindings.filter((b) => !b.spread).map((b) => [b.tag, b.member, b.role, b.path, b.modifiers.join(',')])).toEqual([
      ['wcs-fetch', 'status', 'output', 'code', ''],
      ['wcs-contacts', 'value', 'output', 'rows.*.picked', ''],
      ['wcs-storage', 'value', 'two-way', 'saved', 'ro'],
      ['wcs-contacts', 'value', 'output', 'quiet', 'ro,init=none'],
    ]);
    expect(collectOutputSlots(bindings).map((s) => s.path).filter((p) => !p.startsWith('f.'))).toEqual(['code', 'rows.*.picked']);
    expect(collectOutputSlots(bindings).map((s) => s.path)).toContain('f.value');
    expect(collectOutputSlots(bindings).map((s) => s.path)).not.toContain('f.url');
  });
});
