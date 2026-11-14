/**
 * formInputValidator.test.ts — フォームの入力の 3 つの規則（継ぎ目アプリ ekiden-entry、4.23）。どれも実行時は何も言わない。
 *
 *   - L2 `wcs/radio-name-shared`: `for:` の行の中の、`name` をリテラルで書いたラジオ（全部の行が 1 つのグループになる）
 *   - L3 `wcs/number-written-as-string`: 変換の無い双方向の `value:` が、数値のパスに文字列を書く
 *   - L4 `wcs/two-way-output-filter`: 双方向の `value:` に付けた出力フィルタ（入力中の欄を書き換える）
 */
import { describe, it, expect } from 'vitest';
import { validateDocument } from '../src/core/validateDocument.js';
import { WcsDiagnosticCode, type WcsDiagnostic } from '../src/core/diagnostics.js';

const FORM_CODES: readonly string[] = [
  WcsDiagnosticCode.RadioNameShared, WcsDiagnosticCode.NumberWrittenAsString, WcsDiagnosticCode.TwoWayOutputFilter,
];
const STATE = `export default {
  count: 0, price: 1200, ratio: 0.5, name: "", code: "", note: null, lang: "ja", selectedId: 1, sex: "m",
  /** @type {number | null} */
  age: null,
  /** @type {number | string} */
  loose: 0,
  rows: [{ id: 1, sex: "m", qty: 2, memo: "", picked: false }],
  teams: [{ kind: "a", members: [{ sex: "m" }] }],
  options: ["a", "b"],
  get total() { return this.count + 1; },
  get doubled() { return this._d; },
  set doubled(v) { this._d = Number(v); },
  _d: 0,
};`;
const page = (body: string, state = STATE): string => `<wcs-state><script type="module">
${state}
</script></wcs-state>
${body}`;
const find = (html: string, locale = 'en'): WcsDiagnostic[] =>
  validateDocument(html, { locale }).filter((d) => FORM_CODES.includes(d.code));
/** 規則の code と、診断の範囲の文字。 */
const said = (body: string): [string, string][] => {
  const html = page(body);
  return find(html).map((d) => [d.code, html.slice(d.start, d.end)]);
};

describe('L2 wcs/radio-name-shared — 行ごとのラジオが同じ name を持つ', () => {
  const ROWS = `<template data-wcs="for: rows">
  <label><input type="radio" name="sex" value="m" data-wcs="radio: .sex">男</label>
  <label><input type="radio" name="sex" value="f" data-wcs="radio: .sex">女</label>
</template>`;

  it('行の中の name をリテラルで書いたラジオを、リストと name ごとに 1 回、name 属性の上で報告する（warning）', () => {
    const html = page(ROWS);
    const found = find(html);
    expect(found.map((d) => [d.code, d.severity, html.slice(d.start, d.end)])).toEqual([[WcsDiagnosticCode.RadioNameShared, 'warning', 'name="sex"']]);
    expect(found[0].message).toBe('Every row\'s radios get name="sex", so the browser makes one group of all the rows: only one radio on the whole page stays checked, and the page disagrees with the rows\' values from the first render — nothing says so. Bind a name that differs per row (attr.name: .<a row field>), or drop the name: radio: keeps the radios bound to one path in step without it');
    const [ja] = find(html, 'ja');
    expect(ja.message).toBe('行ごとのラジオがすべて name="sex" になるので、ブラウザは全部の行のラジオを 1 つのグループにします。ページ全体で 1 つしか選ばれた状態にならず、表示は最初の描画から行ごとの値と食い違います（何も知らせません）。行ごとに違う name を束ねる（attr.name: .<行ごとに違うフィールド>）か、name を外してください（radio: は name が無くても、同じパスに束ねたラジオを選択に合わせます）');
  });

  it('checked: の束縛でも報告し、name を外す直し方は言わない（グループが無くなる）。行をまたぐ 1 つの選択の書き方を言う', () => {
    const html = page(`<template data-wcs="for: rows"><input type="radio" name="pick" data-wcs="checked: .picked"></template>`);
    const [d] = find(html);
    expect(html.slice(d.start, d.end)).toBe('name="pick"');
    expect(d.message).toContain('Bind a name that differs per row (attr.name: .<a row field>) — or, for one choice over all the rows, bind them all to one path: value: .<the row\'s id>; radio: <path>');
    expect(d.message).not.toContain('drop the name');
    const [ja] = find(html, 'ja');
    expect(ja.message).toContain('行ごとに違う name を束ねてください（attr.name: .<行ごとに違うフィールド>）。行をまたいで 1 つを選ばせるなら、全部を 1 つのパスに束ねます（value: .<行の id>; radio: <パス>）');
  });

  it('`*` を持つパス（radio: rows.*.sex）・#ro・引用符の違う name でも報告する', () => {
    expect(said(`<template data-wcs="for: rows">
  <input type="radio" name='sex' value="m" data-wcs="radio#ro: rows.*.sex">
  <input type=radio name=kind value="a" data-wcs="radio: .sex">
</template>`)).toEqual([
      [WcsDiagnosticCode.RadioNameShared, "name='sex'"],
      [WcsDiagnosticCode.RadioNameShared, 'name=kind'],
    ]);
  });

  it('同じ name でも別のリストなら、リストごとに 1 回ずつ言う', () => {
    expect(said(`${ROWS}
<template data-wcs="for: teams"><template data-wcs="for: .members">
  <input type="radio" name="sex" value="m" data-wcs="radio: .sex">
</template></template>`)).toEqual([
      [WcsDiagnosticCode.RadioNameShared, 'name="sex"'],
      [WcsDiagnosticCode.RadioNameShared, 'name="sex"'],
    ]);
  });

  it('name を束ねてある（attr.name: / name:）・name が無い・空の name は黙る', () => {
    expect(said(`<template data-wcs="for: rows">
  <input type="radio" name="sex" value="m" data-wcs="attr.name: .id; radio: .sex">
  <input type="radio" name="sex" value="f" data-wcs="name: .id; radio: .sex">
  <input type="radio" value="x" data-wcs="radio: .sex">
  <input type="radio" name="" value="y" data-wcs="radio: .sex">
</template>`)).toEqual([]);
  });

  it('行のものでないパス（radio: selectedId — 行をまたぐ 1 つのグループが意図）は黙る', () => {
    expect(said(`<template data-wcs="for: rows">
  <input type="radio" name="pick" data-wcs="value: .id; radio: selectedId">
</template>
<template data-wcs="for: options">
  <input type="radio" name="sex" data-wcs="value: .; radio: sex">
</template>`)).toEqual([]);
  });

  it('for の外のラジオ・ラジオでない入力・束縛の無いラジオは黙る', () => {
    expect(said(`<input type="radio" name="sex" value="m" data-wcs="radio: sex">
<input type="radio" name="sex" value="f" data-wcs="radio: sex">
<template data-wcs="for: rows">
  <input type="checkbox" name="tags" value="a" data-wcs="checked: .picked">
  <input type="text" name="memo" data-wcs="value: .memo">
  <input type="radio" name="plain" value="a">
</template>`)).toEqual([]);
  });

  it('行ごとに <form> があれば黙る（ラジオのグループはフォームで切れる）。for を囲む 1 つの <form> は切らない', () => {
    expect(said(`<template data-wcs="for: rows">
  <form><input type="radio" name="sex" value="m" data-wcs="radio: .sex"></form>
</template>`)).toEqual([]);
    expect(said(`<form><template data-wcs="for: rows">
  <input type="radio" name="sex" value="m" data-wcs="radio: .sex">
</template></form>`)).toEqual([[WcsDiagnosticCode.RadioNameShared, 'name="sex"']]);
    // 行の中で閉じた <form> の後ろのラジオは、そのフォームのものではない
    expect(said(`<template data-wcs="for: rows">
  <form></form><input type="radio" name="sex" value="m" data-wcs="radio: .sex">
</template>`)).toEqual([[WcsDiagnosticCode.RadioNameShared, 'name="sex"']]);
  });

  it('外側の行の値を、内側の for が並べる選択肢から選ぶ形: 外側の行ごとに <form> が無ければ報告する', () => {
    const inner = `<template data-wcs="for: options"><input type="radio" name="kind" data-wcs="value: .; radio: teams.*.kind"></template>`;
    expect(said(`<template data-wcs="for: teams">${inner}</template>`)).toEqual([[WcsDiagnosticCode.RadioNameShared, 'name="kind"']]);
    expect(said(`<template data-wcs="for: teams"><form>${inner}</form></template>`)).toEqual([]);
  });
});

describe('L3 wcs/number-written-as-string — 数値のパスに、変換の無い value: が文字列を書く', () => {
  it('type="number" の value: を数値の種に束ねると、パスの上で報告する（warning。valueAsNumber と入力フィルタを言う）', () => {
    const html = page('<input type="number" data-wcs="value: count">');
    const found = find(html);
    expect(found.map((d) => [d.code, d.severity, html.slice(d.start, d.end), d.statePath])).toEqual([
      [WcsDiagnosticCode.NumberWrittenAsString, 'warning', 'count', 'count'],
    ]);
    expect(found[0].message).toBe('"count" is a number in the state, but value: writes back what the element holds, a string: after the user enters 5 the state has "5", and "5" + 1 is "51" — nothing says so. Convert it on the way in: valueAsNumber: count, or an input filter on the left side, value|number: count (also |int, |float)');
    const [ja] = find(html, 'ja');
    expect(ja.message).toBe('"count" は state では数値ですが、value: が書き戻すのは要素の持つ文字列です。5 と入力した後の state は "5" で、"5" + 1 は "51" になります（何も知らせません）。書き戻すときに数値にしてください: valueAsNumber: count、または左辺の入力フィルタ value|number: count（|int・|float も）');
  });

  it('valueAsNumber を持たない入力（text・textarea・select）では入力フィルタだけを言う', () => {
    const html = page(`<input data-wcs="value: count">
<textarea data-wcs="value: price"></textarea>
<select data-wcs="value: selectedId"></select>
<input type="range" data-wcs="value: ratio">`);
    const found = find(html);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['count', 'price', 'selectedId', 'ratio']);
    expect(found.map((d) => d.message.includes('valueAsNumber:'))).toEqual([false, false, false, true]);
    expect(found[2].message).toContain('an input filter on the left side, value|number: selectedId');
  });

  it('行のフィールド（value: .qty）も、展開したパスの型で報告する', () => {
    const html = page('<template data-wcs="for: rows"><input type="number" data-wcs="value: .qty"><input data-wcs="value: .memo"></template>');
    const found = find(html);
    expect(found.map((d) => [html.slice(d.start, d.end), d.statePath])).toEqual([['.qty', 'rows.*.qty']]);
    expect(found[0].message).toContain('value|number: .qty (also |int, |float) (expanded: rows.*.qty)');
  });

  it('書かれた修飾子と入力フィルタは残して、変換を足す形を言う', () => {
    const html = page('<input data-wcs="value#onchange: count">\n<input data-wcs=".value|trim: price">');
    expect(find(html).map((d) => /left side, (.*?) \(also/.exec(d.message)?.[1])).toEqual([
      'value#onchange|number: count', '.value|trim|number: price',
    ]);
  });

  it('JSDoc の @type（number・number | null）と stateSchema の number でも報告する', () => {
    expect(said('<input type="number" data-wcs="value: age">')).toEqual([[WcsDiagnosticCode.NumberWrittenAsString, 'age']]);
    const html = '<wcs-state json=\'{"qty":"x"}\'></wcs-state>\n<input type="number" data-wcs="value: qty">';
    const schema = { type: 'object', properties: { qty: { type: 'number' } } } as const;
    const found = validateDocument(html, { locale: 'en', applicationSchema: schema }).filter((d) => FORM_CODES.includes(d.code));
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['qty']);
  });

  it('数値にして書き戻す束縛（valueAsNumber:・value|number:・|int・|float・数値で終わる入力フィルタの並び）は黙る', () => {
    expect(said(`<input type="number" data-wcs="valueAsNumber: count">
<input data-wcs="value|number: count">
<input data-wcs="value|int: count">
<input data-wcs="value|float: price">
<input data-wcs="value|trim|number: price">
<input data-wcs="value|number|round(2): price">
<select data-wcs="value|number: selectedId"></select>`)).toEqual([]);
  });

  it('一方向（#ro）・文字列のパス・型の分からないパス・文字列も取ると宣言したパス・アクセサペアは黙る', () => {
    expect(said(`<input data-wcs="value#ro: count">
<input data-wcs="value#ro,init=none: count">
<input data-wcs="value: name">
<input data-wcs="value: note">
<input data-wcs="value: loose">
<input data-wcs="value: doubled">
<input data-wcs="value: missing">`)).toEqual([]);
  });

  it('利用者が値を入力しない入力（checkbox・radio・hidden・ボタン）とカスタム要素は読まない', () => {
    expect(said(`<input type="checkbox" data-wcs="value: count">
<input type="radio" data-wcs="value: selectedId; radio: selectedId">
<input type="hidden" data-wcs="value: count">
<input type="button" data-wcs="value: count">
<input type="submit" data-wcs="value: count">
<my-stepper data-wcs="value: count"></my-stepper>
<output data-wcs="value: count"></output>
<p data-wcs="textContent: count"></p>`)).toEqual([]);
  });

  it('組み込みに無い入力フィルタは wcs/filter-unknown に任せ、重ねない', () => {
    const html = page('<input data-wcs="value|tonumber: count">');
    const found = validateDocument(html, { locale: 'en' });
    expect(found.map((d) => d.code)).toEqual([WcsDiagnosticCode.FilterUnknown]);
  });
});

describe('L4 wcs/two-way-output-filter — 双方向の value: に付けた出力フィルタ', () => {
  it('1 打鍵ごとに書き戻す欄の出力フィルタを、フィルタの上で報告する（warning。キャレットと IME・直し方 3 つ）', () => {
    const html = page('<input data-wcs="value: code|upper">');
    const found = find(html);
    expect(found.map((d) => [d.code, d.severity, html.slice(d.start, d.end)])).toEqual([[WcsDiagnosticCode.TwoWayOutputFilter, 'warning', 'upper']]);
    expect(found[0].message).toBe('value: is two-way and writes back on every keystroke, and the output filter "|upper" formats what the state holds each time: the field is rewritten while the user types — the caret jumps to the end, an IME composition is cut — and what the state receives is the field\'s formatted text (an output filter is not undone on the way back). Show the formatted text in another element, write back when the field is committed and format in a setter (value#onchange:), or make the binding one-way: value#ro: code|upper');
    const [ja] = find(html, 'ja');
    expect(ja.message).toBe('value: は双方向で 1 打鍵ごとに書き戻し、出力フィルタ "|upper" はそのたびに state の値を整形して欄へ書き直します。入力中の欄が書き換わり（キャレットは末尾へ飛び、IME の変換は途切れます）、state が受け取るのも欄の整形済みの文字です（出力フィルタは書き戻しで元に戻りません）。整形した文字は別の要素に表示する、欄の確定で書き戻して setter で整形する（value#onchange:）、または一方向にしてください（value#ro: code|upper）');
  });

  it('数値のパスでも出力フィルタの報告だけにする（number-written-as-string を重ねない — ekiden-entry の value: …|mul(800)|locale）', () => {
    const html = page('<input inputmode="numeric" data-wcs="value: price|mul(800)|locale; attr.aria-invalid: name|truthy">');
    const found = find(html);
    expect(found.map((d) => [d.code, html.slice(d.start, d.end)])).toEqual([[WcsDiagnosticCode.TwoWayOutputFilter, 'mul']]);
    expect(found[0].message).toContain('the output filter "|mul(800)|locale" formats');
    expect(found[0].message).toContain('value#ro: price|mul(800)|locale');
  });

  it('textarea・type="number" の valueAsNumber:・行の中・入力フィルタがあっても、1 打鍵ごとなら報告する', () => {
    expect(said(`<textarea data-wcs="value: name|trim"></textarea>
<input type="number" data-wcs="valueAsNumber: price|round(2)">
<template data-wcs="for: rows"><input data-wcs="value: .memo|capitalize"></template>
<input data-wcs="value|number: price|toFixed(2)">`)).toEqual([
      [WcsDiagnosticCode.TwoWayOutputFilter, 'trim'],
      [WcsDiagnosticCode.TwoWayOutputFilter, 'round'],
      [WcsDiagnosticCode.TwoWayOutputFilter, 'capitalize'],
      [WcsDiagnosticCode.TwoWayOutputFilter, 'toFixed'],
    ]);
  });

  it('確定した値を書き戻す束縛（#onchange・select・スライダー）は、入力フィルタが無いときだけ、別の文面で報告する', () => {
    const html = page(`<input data-wcs="value#onchange: code|upper">
<select data-wcs="value: lang|lower"></select>
<input type="range" data-wcs="value: ratio|mul(100)">`);
    const found = find(html);
    expect(found.map((d) => html.slice(d.start, d.end))).toEqual(['upper', 'lower', 'mul']);
    expect(found[0].message).toBe('value: is two-way, and nothing undoes the output filter "|upper" on the way back: the element writes back the formatted value it shows, and the filter is then applied to that. Undo it with an input filter on the left side (value#onchange|<filter>: …), show the formatted value in another element, or make the binding one-way: value#ro: code|upper');
    const [ja] = find(html, 'ja');
    expect(ja.message).toBe('value: は双方向ですが、出力フィルタ "|upper" は書き戻しで元に戻りません。要素が書き戻すのは表示している整形済みの値で、次はその値にフィルタが掛かります。左辺の入力フィルタで元に戻す（value#onchange|<フィルタ>: …）、整形した値は別の要素に表示する、または一方向にしてください（value#ro: code|upper）');
  });

  it('確定で書き戻し、入力フィルタで元に戻す形（value#onchange|number: price|toFixed(2)）は黙る', () => {
    expect(said(`<input data-wcs="value#onchange|number: price|toFixed(2)">
<input data-wcs="value#onblur|upper: code|upper">
<select data-wcs="value|number: selectedId|string"></select>
<input type="range" data-wcs="value|number|div(100): ratio|mul(100)">`)).toEqual([]);
  });

  it('要素の書いた文字をそのまま返すフィルタ（string・nullIfEmpty・coalesce・空の defaults）は黙る', () => {
    expect(said(`<input data-wcs="value: name|string">
<input data-wcs="value: name|nullIfEmpty">
<input data-wcs="value: note|coalesce('')">
<input data-wcs="value: note|coalesce(-)">
<input data-wcs="value|nullIfEmpty: note|coalesce('')">
<input data-wcs="value: name|defaults('')">
<input data-wcs='value: name|defaults("")'>`)).toEqual([]);
  });

  it('空にした欄へ文字を戻すフィルタ（defaults(x)・入力の nullIfEmpty と組んだ coalesce(x)）は報告する', () => {
    expect(said(`<input data-wcs="value: name|defaults(Anonymous)">
<input data-wcs="value|nullIfEmpty: note|coalesce(-)">
<input data-wcs="value: name|coalesce('')|trim">`)).toEqual([
      [WcsDiagnosticCode.TwoWayOutputFilter, 'defaults'],
      [WcsDiagnosticCode.TwoWayOutputFilter, 'coalesce'],
      [WcsDiagnosticCode.TwoWayOutputFilter, 'trim'],
    ]);
  });

  it('一方向（#ro）・書き戻さない束縛・カスタム要素・値を入力しない入力は黙る', () => {
    expect(said(`<input data-wcs="value#ro: code|upper">
<p data-wcs="textContent: code|upper"></p>
<input data-wcs="attr.placeholder: code|upper; class.big: count|gt(3)">
<my-input data-wcs="value: code|upper"></my-input>
<input type="checkbox" data-wcs="value: code|upper">
<input type="hidden" data-wcs="value: price|locale">
<input type="button" data-wcs="value: code|upper">`)).toEqual([]);
  });

  it('組み込みに無い出力フィルタは wcs/filter-unknown に任せ、重ねない', () => {
    const html = page('<input data-wcs="value: code|shout">');
    expect(validateDocument(html, { locale: 'en' }).map((d) => d.code)).toEqual([WcsDiagnosticCode.FilterUnknown]);
  });

  it('引用符の中の `:` で左辺を切らない（value|defaults(\':\'): name|upper）', () => {
    const html = page(`<input data-wcs="value#onchange: name|upper|padEnd(3, ':')">`);
    const [d] = find(html);
    expect(d.message).toContain(`value#ro: name|upper|padEnd(3, ':')`);
    expect(d.message).toContain('(value#onchange|<filter>: …)');
  });
});

describe('ekiden-entry の誤りの写し（mistakes/）で規則が言うこと', () => {
  it('10-same-radio-name: 行ごとの性別のラジオに name="sex"', () => {
    expect(said(`<template data-wcs="for: rows">
  <fieldset><legend>性別</legend>
    <label><input type="radio" name="sex" value="male" data-wcs="radio: .sex"> 男</label>
    <label><input type="radio" name="sex" value="female" data-wcs="radio: .sex"> 女</label>
    <label><input type="radio" name="sex" value="none" data-wcs="radio: .sex"> 回答しない</label>
  </fieldset>
</template>`)).toEqual([[WcsDiagnosticCode.RadioNameShared, 'name="sex"']]);
  });

  it('11-count-not-a-number: 個数の欄を変換せずに数値のパスへ（2 つの欄それぞれに）', () => {
    const state = 'export default { options: { lunchJa: 0, lunchWestern: 0 }, errs: { options: { lunchJa: "", lunchWestern: "" } } };';
    const html = page(`<input type="number" id="opt-lunch-ja" min="0" max="20" data-wcs="value: options.lunchJa; attr.aria-invalid: errs.options.lunchJa|truthy|string">
<input type="number" id="opt-lunch-w" min="0" max="20" data-wcs="value: options.lunchWestern; attr.aria-invalid: errs.options.lunchWestern|truthy|string">`, state);
    expect(validateDocument(html, { locale: 'en' }).map((d) => [d.code, html.slice(d.start, d.end)])).toEqual([
      [WcsDiagnosticCode.NumberWrittenAsString, 'options.lunchJa'],
      [WcsDiagnosticCode.NumberWrittenAsString, 'options.lunchWestern'],
    ]);
  });

  it('03-formatted-number-in-field: 打つ欄に金額の書式', () => {
    const state = 'export default { options: { lunchJa: 0 }, errs: { options: { lunchJa: "" } } };';
    const html = page('<input id="opt-lunch-ja" inputmode="numeric" data-wcs="value: options.lunchJa|mul(800)|locale; attr.aria-invalid: errs.options.lunchJa|truthy|string">', state);
    expect(validateDocument(html, { locale: 'en' }).map((d) => [d.code, html.slice(d.start, d.end)])).toEqual([
      [WcsDiagnosticCode.TwoWayOutputFilter, 'mul'],
    ]);
  });

  it('02-trim-name: 入力フィルタ（value|trim: .name）は欄を書き換えないので黙る', () => {
    expect(said('<template data-wcs="for: rows"><input data-wcs="value|trim: .memo"></template>')).toEqual([]);
  });
});
