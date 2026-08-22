import { describe, it, expect } from 'vitest';
import { validateBindings } from '../src/service/bindingValidator';
import { WcsDiagnosticCode } from '../src/core/diagnostics';

const SAMPLE_HTML = `
<wcs-state>
  <script type="module">
export default {
  count: 0,
  users: [{ name: "Alice", age: 30 }],
  get "users.*.ageCategory"() { return "Adult"; },
  increment() { this.count++; }
};
  </script>
</wcs-state>

<div data-wcs="textContent: count"></div>
<div data-wcs="textContent: nonExistent"></div>
<div data-wcs="textContent: count|unknownFilter"></div>
<div data-wcs="textContent: count|gt(10)"></div>
<template data-wcs="for: users">
  <span data-wcs="textContent: .name"></span>
</template>
`;

describe('validateBindings', () => {
  it('存在するパスにはエラーを出さない', () => {
    const diags = validateBindings(SAMPLE_HTML, 'data-wcs');
    const countDiags = diags.filter(d => d.message.includes('"count"'));
    expect(countDiags).toHaveLength(0);
  });

  it('存在しないパスに warning を出す', () => {
    const diags = validateBindings(SAMPLE_HTML, 'data-wcs');
    const nonExistent = diags.filter(d => d.message.includes('"nonExistent"'));
    expect(nonExistent).toHaveLength(1);
    expect(nonExistent[0].severity).toBe('warning');
  });

  it('存在しないフィルタに warning を出す', () => {
    const diags = validateBindings(SAMPLE_HTML, 'data-wcs');
    const unknownFilter = diags.filter(d => d.message.includes('"unknownFilter"'));
    expect(unknownFilter).toHaveLength(1);
    expect(unknownFilter[0].severity).toBe('warning');
  });

  it('既知のフィルタにはエラーを出さない', () => {
    const diags = validateBindings(SAMPLE_HTML, 'data-wcs');
    const gtDiags = diags.filter(d => d.message.includes('"gt"'));
    expect(gtDiags).toHaveLength(0);
  });

  it('ショートハンドパス (.name) はスキップする', () => {
    const diags = validateBindings(SAMPLE_HTML, 'data-wcs');
    const dotName = diags.filter(d => d.message.includes('".name"'));
    expect(dotName).toHaveLength(0);
  });

  it('wcs-state がない HTML では診断を出さない', () => {
    const html = `<div data-wcs="textContent: foo"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });

  it('イベントハンドラにフィルタがあると warning を出す', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0, increment() {} };
  </script>
</wcs-state>
<button data-wcs="onclick: increment|gt(10)"></button>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.message.includes('イベントハンドラ'))).toBe(true);
  });

  it('for: に非配列パスを指定すると error を出す', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0, users: [{ name: "A" }] };
  </script>
</wcs-state>
<template data-wcs="for: count"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const forDiag = diags.find(d => d.message.includes('"for"'));
    expect(forDiag).toBeDefined();
    expect(forDiag!.severity).toBe('error');
    expect(forDiag!.message).toContain('配列型');
  });

  it('for: に配列パスを指定するとエラーなし', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { users: [{ name: "A" }] };
  </script>
</wcs-state>
<template data-wcs="for: users"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const forDiag = diags.find(d => d.message.includes('"for"'));
    expect(forDiag).toBeUndefined();
  });

  it('else: が続く if: に非ブーリアンパスを指定すると warning を出す', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<template data-wcs="if: count"></template>
<template data-wcs="else:"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const ifDiag = diags.find(d => d.message.includes('"if"'));
    expect(ifDiag).toBeDefined();
    expect(ifDiag!.severity).toBe('warning');
    expect(ifDiag!.message).toContain('ブーリアン型');
  });

  it('else: が続く if: users.length は number なので warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { users: [{ name: "A" }] };
  </script>
</wcs-state>
<template data-wcs="if: users.length"></template>
<template data-wcs="else:"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const ifDiag = diags.find(d => d.message.includes('"if"'));
    expect(ifDiag).toBeDefined();
    expect(ifDiag!.message).toContain('number');
  });

  it('if: users.length|gt(0) はフィルタ後 boolean なので OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { users: [{ name: "A" }] };
  </script>
</wcs-state>
<template data-wcs="if: users.length|gt(0)"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const ifDiag = diags.find(d => d.message.includes('"if"'));
    expect(ifDiag).toBeUndefined();
  });

  it('if: にフィルタで boolean 変換後はエラーなし', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<template data-wcs="if: count|gt(0)"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const ifDiag = diags.find(d => d.message.includes('"if"'));
    expect(ifDiag).toBeUndefined();
  });

  it('JSDoc @type {boolean|null} は else: が続く if: で warning（null を含むため）', () => {
    const html = `
<wcs-state>
  <script type="module">
export default {
  /** @type {boolean|null} */
  ok: null,
};
  </script>
</wcs-state>
<template data-wcs="if: ok"></template>
<template data-wcs="else:"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const ifDiag = diags.find(d => d.message.includes('"if"'));
    expect(ifDiag).toBeDefined();
    expect(ifDiag!.message).toContain('boolean|null');
  });

  it('単独の if: は Boolean() 強制変換なので非ブーリアンでも warning を出さない', () => {
    // ランタイム（apply/applyChangeToIf.ts）は `Boolean(rawNewValue)` で受けるため、
    // else チェーンの無い if は任意の型を取れる。
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0, items: null };
  </script>
</wcs-state>
<template data-wcs="if: count"></template>
<template data-wcs="if: items"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('"if"'))).toBeUndefined();
  });

  it('elseif: が続く if: は warning（否定フラグメントに not が付くため）', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<template data-wcs="if: count"></template>
<template data-wcs="elseif: count|gt(1)"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const ifDiag = diags.find(d => d.message.includes('"if"'));
    expect(ifDiag).toBeDefined();
    expect(ifDiag!.message).toContain('ブーリアン型');
  });

  it('入れ子の else: は外側の if: をチェーンしない（別スコープ）', () => {
    // ランタイムは template.content ごとに再帰してチェーンを組み直す
    // （structural/collectStructuralFragments.ts）。
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0, ok: true };
  </script>
</wcs-state>
<template data-wcs="if: count">
  <template data-wcs="if: ok"></template>
  <template data-wcs="else:"></template>
</template>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('"if"'))).toBeUndefined();
  });

  it('JSDoc @type {boolean} は if: で OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default {
  /** @type {boolean} */
  ok: null,
};
  </script>
</wcs-state>
<template data-wcs="if: ok"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('"if"'))).toBeUndefined();
  });

  it('JSDoc @type {array|null} は for: で warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default {
  /** @type {Array|null} */
  items: null,
};
  </script>
</wcs-state>
<template data-wcs="for: items"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const forDiag = diags.find(d => d.message.includes('"for"'));
    expect(forDiag).toBeDefined();
    expect(forDiag!.message).toContain('array|null');
  });

  it('if: にブーリアンパスを指定するとエラーなし', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { active: true };
  </script>
</wcs-state>
<template data-wcs="if: active"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const ifDiag = diags.find(d => d.message.includes('"if"'));
    expect(ifDiag).toBeUndefined();
  });

  it('class. に非ブーリアンパスを指定すると warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="class.active: count"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    const classDiag = diags.find(d => d.message.includes('class.active'));
    expect(classDiag).toBeDefined();
    expect(classDiag!.message).toContain('ブーリアン型');
  });

  it('class. にブーリアンパスはエラーなし', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { active: true };
  </script>
</wcs-state>
<div data-wcs="class.active: active"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('class.active'))).toBeUndefined();
  });

  it('class. にフィルタでブーリアン変換後は OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="class.over: count|gt(10)"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('class.over'))).toBeUndefined();
  });

  it('attr. に非文字列パスを指定すると warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="attr.data-id: count"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    const attrDiag = diags.find(d => d.message.includes('attr.data-id'));
    expect(attrDiag).toBeDefined();
    expect(attrDiag!.message).toContain('文字列型');
  });

  it('attr. に文字列パスはエラーなし', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { title: "hello" };
  </script>
</wcs-state>
<div data-wcs="attr.title: title"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('attr.title'))).toBeUndefined();
  });

  it('style. に非文字列パスを指定すると warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { active: true };
  </script>
</wcs-state>
<div data-wcs="style.color: active"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    const styleDiag = diags.find(d => d.message.includes('style.color'));
    expect(styleDiag).toBeDefined();
    expect(styleDiag!.message).toContain('文字列型');
  });

  it('style. に文字列フィルタ変換後は OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="style.width: count|string"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('style.width'))).toBeUndefined();
  });

  // フィルタチェーン型チェック
  it('number に string フィルタ (uc) を適用すると warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="textContent: count|uc"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    const ucDiag = diags.find(d => d.message.includes('"uc"'));
    expect(ucDiag).toBeDefined();
    expect(ucDiag!.message).toContain('string');
    expect(ucDiag!.message).toContain('number');
  });

  it('number → string → uc は OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="textContent: count|string|uc"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('"uc"'))).toBeUndefined();
  });

  it('string に number フィルタ (inc) を適用すると warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { name: "hello" };
  </script>
</wcs-state>
<div data-wcs="textContent: name|inc(1)"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    const incDiag = diags.find(d => d.message.includes('"inc"'));
    expect(incDiag).toBeDefined();
    expect(incDiag!.message).toContain('number');
  });

  it('string → int → inc は OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { price: "100" };
  </script>
</wcs-state>
<div data-wcs="textContent: price|int|inc(1)"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('"inc"'))).toBeUndefined();
  });

  it('any 型を受け入れるフィルタ (eq) はどの型でも OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="class.active: count|eq(0)"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('"eq"'))).toBeUndefined();
  });

  // フィルタ引数チェック
  it('必須引数が不足すると error', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="textContent: count|mul"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    const mulDiag = diags.find(d => d.message.includes('"mul"') && d.message.includes('最低'));
    expect(mulDiag).toBeDefined();
    expect(mulDiag!.severity).toBe('error');
  });

  it('引数が多すぎると error', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="textContent: count|gt(10,20)"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    const gtDiag = diags.find(d => d.message.includes('"gt"') && d.message.includes('最大'));
    expect(gtDiag).toBeDefined();
    expect(gtDiag!.severity).toBe('error');
  });

  it('省略可能な引数は 0 個でも OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="textContent: count|inc"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('"inc"') && d.message.includes('引数'))).toBeUndefined();
  });

  it('引数に非数値文字列を number 型引数に渡すと warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { name: "hello" };
  </script>
</wcs-state>
<div data-wcs="textContent: name|slice(abc)"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    const sliceDiag = diags.find(d => d.message.includes('"slice"') && d.message.includes('number 型'));
    expect(sliceDiag).toBeDefined();
  });

  it('引数に文字列リテラルを number 型引数に渡すと warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="textContent: count|gt('abc')"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    const gtDiag = diags.find(d => d.message.includes('"gt"') && d.message.includes('number 型'));
    expect(gtDiag).toBeDefined();
  });

  it('正しい引数の型は OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-wcs="textContent: count|gt(10)"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('引数'))).toBeUndefined();
  });

  it('slice の 2 引数は OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { name: "hello" };
  </script>
</wcs-state>
<div data-wcs="textContent: name|slice(0,3)"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.find(d => d.message.includes('"slice"'))).toBeUndefined();
  });

  // 省略パスの存在チェック
  it('存在しない省略パス .ages に warning を出す', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { users: [{ name: "A", age: 30 }] };
  </script>
</wcs-state>
<template data-wcs="for: users">
  <span data-wcs="textContent: .ages"></span>
</template>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.message.includes('".ages"') && d.message.includes('存在しません'))).toBe(true);
  });

  it('存在する省略パス .age は OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { users: [{ name: "A", age: 30 }] };
  </script>
</wcs-state>
<template data-wcs="for: users">
  <span data-wcs="textContent: .age"></span>
</template>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.message.includes('".age"'))).toBe(false);
  });

  // UI パス制約チェック
  it('for 外でパターンパスを使用すると warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { users: [{ name: "A" }] };
  </script>
</wcs-state>
<div data-wcs="textContent: users.*.name"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.message.includes('パターンパス') && d.message.includes('<template for>'))).toBe(true);
  });

  it('for 内でパターンパスは OK', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { users: [{ name: "A" }] };
  </script>
</wcs-state>
<template data-wcs="for: users">
  <span data-wcs="textContent: users.*.name"></span>
</template>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.message.includes('パターンパス'))).toBe(false);
  });

  it('for 外で省略パスを使用すると warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { users: [{ name: "A" }] };
  </script>
</wcs-state>
<div data-wcs="textContent: .name"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.message.includes('省略パス'))).toBe(true);
  });

  it('UI で解決済みパスを使用すると warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { users: [{ name: "A" }] };
  </script>
</wcs-state>
<div data-wcs="textContent: users.0.name"></div>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.message.includes('解決済みパス'))).toBe(true);
  });

  it('カスタム属性名で動作する', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<div data-bind="textContent: missing"></div>`;
    const diags = validateBindings(html, 'data-bind');
    expect(diags.some(d => d.message.includes('"missing"'))).toBe(true);
  });
});

describe('validateBindings — command-token / event-token / $streams / spread', () => {
  const TOKEN_STATE = `
<wcs-state>
  <script type="module">
export default {
  count: 0,
  items: [],
  $commandTokens: ["play", "pause"],
  $eventTokens: ["userChanged"],
  $streams: {
    metrics: { source(a, s) { return x; }, initial: [] },
  },
};
  </script>
</wcs-state>`;

  it('onclick: $command.<宣言済み> に警告を出さない', () => {
    const html = `${TOKEN_STATE}\n<button data-wcs="onclick: $command.play"></button>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });

  it('onclick: $command.<未宣言> に warning を出す', () => {
    const html = `${TOKEN_STATE}\n<button data-wcs="onclick: $command.typo"></button>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('$commandTokens に宣言されていません');
  });

  it('command.<method>: $command.<宣言済み> に警告を出さない', () => {
    const html = `${TOKEN_STATE}\n<audio data-wcs="command.play: $command.play"></audio>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });

  it('command.<method> の右辺が $command.* でないと warning を出す', () => {
    const html = `${TOKEN_STATE}\n<audio data-wcs="command.play: count"></audio>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('$command.<name>');
  });

  it('eventToken.<prop>: <宣言済みトークン> に警告を出さない', () => {
    const html = `${TOKEN_STATE}\n<my-input data-wcs="eventToken.value: userChanged"></my-input>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });

  it('eventToken.<prop>: <未宣言トークン> に warning を出す', () => {
    const html = `${TOKEN_STATE}\n<my-input data-wcs="eventToken.value: typo"></my-input>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('$eventTokens に宣言されていません');
  });

  it('$eventTokens 宣言がない場合は eventToken の右辺を検証しない（誤警告回避）', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<my-input data-wcs="eventToken.value: anything"></my-input>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });

  it('$streamStatus.<宣言済み> のバインディングに警告を出さない', () => {
    const html = `${TOKEN_STATE}\n<span data-wcs="textContent: $streamStatus.metrics"></span>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });

  it('$streamStatus.<未宣言> に warning を出す', () => {
    const html = `${TOKEN_STATE}\n<span data-wcs="textContent: $streamStatus.typo"></span>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('$streams 宣言に存在しません');
  });

  it('$streams 宣言がない場合は $streamStatus.* を検証しない（誤警告回避）', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<span data-wcs="textContent: $streamStatus.metrics"></span>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });

  it('$streams の値プロパティを for: にバインドしても警告を出さない', () => {
    const html = `${TOKEN_STATE}\n<template data-wcs="for: metrics"><span data-wcs="textContent: .*"></span></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const forDiags = diags.filter(d => d.message.includes('"metrics"'));
    expect(forDiags).toHaveLength(0);
  });

  it('スプレッドのターゲットにフィルタがあると error を出す', () => {
    const html = `${TOKEN_STATE}\n<wcs-fetch data-wcs="...: count|uc"></wcs-fetch>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.severity === 'error' && d.message.includes('スプレッド'))).toBe(true);
  });

  it('スプレッドのターゲットパスがないと error を出す', () => {
    const html = `${TOKEN_STATE}\n<wcs-fetch data-wcs="...:"></wcs-fetch>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.severity === 'error' && d.message.includes('ターゲットパスが必要'))).toBe(true);
  });

  it('正常なスプレッドには警告を出さない', () => {
    const html = `${TOKEN_STATE}\n<wcs-fetch data-wcs="...: count"></wcs-fetch>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });
});

describe('validateBindings — prop 側 input フィルタ / ループインデックス', () => {
  const STATE = `
<wcs-state>
  <script type="module">
export default { count: 0, name: "a", items: [{ label: "x" }] };
  </script>
</wcs-state>`;

  it('prop 側の既知 input フィルタには警告を出さない', () => {
    const html = `${STATE}\n<input data-wcs="value|int: count">`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });

  it('prop 側の未知 input フィルタに warning を出す', () => {
    const html = `${STATE}\n<input data-wcs="value|nosuch: name">`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.message.includes('"nosuch"'))).toBe(true);
  });

  it('prop 側フィルタがあってもプロパティ名・パスは正しく検証される', () => {
    const html = `${STATE}\n<input data-wcs="value|int: missing">`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.message.includes('"missing"'))).toBe(true);
  });

  it('for 内の $1 には警告を出さない', () => {
    const html = `${STATE}\n<template data-wcs="for: items"><span data-wcs="textContent: $1"></span></template>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });

  it('for 外の $1 に warning を出す', () => {
    const html = `${STATE}\n<span data-wcs="textContent: $1"></span>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('ループインデックス');
  });
});

describe('validateBindings — 省略パス `.` の展開', () => {
  const STATE = `
<wcs-state>
  <script type="module">
export default { tags: ["a", "b"], rows: [{ name: "x" }] };
  </script>
</wcs-state>`;

  it('単独の `.` は `<forPath>.*` に展開して警告を出さない', () => {
    // ランタイム: state/src/structural/expandShorthandPaths.ts は `.` を
    // 末尾区切りなしの `tags.*` に展開する。
    const html = `${STATE}\n<template data-wcs="for: tags"><li data-wcs="textContent: ."></li></template>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });

  it('`.name` は従来どおり `<forPath>.*.name` に展開する', () => {
    const html = `${STATE}\n<template data-wcs="for: rows"><li data-wcs="textContent: .name"></li></template>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags).toHaveLength(0);
  });

  it('展開先が存在しない `.` の warning には末尾区切りなしの展開先を出す', () => {
    const html = `${STATE}\n<template data-wcs="for: missingList"><li data-wcs="textContent: ."></li></template>`;
    const diags = validateBindings(html, 'data-wcs');
    expect(diags.some(d => d.message.includes('（展開: missingList.*）'))).toBe(true);
  });
});

describe('構造ディレクティブの単独バインディング検査（error・ランタイムは raiseError で落ちる形）', () => {
  const structuralErrors = (html: string) =>
    validateBindings(html, 'data-wcs').filter(
      d => d.code === WcsDiagnosticCode.TemplateSyntax && d.message.includes('単独'),
    );

  const page = (attr: string) => `
<wcs-state json='{"items": [1], "cond": true, "label": "a"}'></wcs-state>
<template data-wcs="${attr}"><span></span></template>
`;

  it('for と他バインディングの併記を検出する（error・範囲は構造式）', () => {
    const html = page('for: items; textContent: label');
    const diags = structuralErrors(html);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(html.slice(diags[0].start, diags[0].end)).toBe('for: items');
  });

  it('if / elseif / else の併記も検出する', () => {
    expect(structuralErrors(page('textContent: label; if: cond'))).toHaveLength(1);
    expect(structuralErrors(page('elseif: cond; textContent: label'))).toHaveLength(1);
    expect(structuralErrors(page('else:; textContent: label'))).toHaveLength(1);
  });

  it('構造ディレクティブが複数併記されたら各式に 1 診断ずつ出る', () => {
    expect(structuralErrors(page('if: cond; for: items'))).toHaveLength(2);
  });

  it('単独の構造ディレクティブ・非構造の複数併記・radio/checkbox は検出しない', () => {
    expect(structuralErrors(page('for: items'))).toHaveLength(0);
    expect(structuralErrors(page('textContent: label; class.active: cond'))).toHaveLength(0);
    // radio / checkbox は STRUCTURAL_BINDING_TYPE_SET 外（ランタイムも併記を許す）
    expect(structuralErrors(page('checkbox: items; onchange: label'))).toHaveLength(0);
  });

  it('修飾子付きの構造名（for#x）は検出しない — ランタイムは修飾子分離前の完全一致で構造判定するため通常 prop になる', () => {
    // parseBindTextsForElement("for#x: items; textContent: label") は throw しない
    // （bindingType: prop, prop）。lint が error にすると偽陽性で CI を落とす。
    expect(structuralErrors(page('for#x: items; textContent: label'))).toHaveLength(0);
    expect(structuralErrors(page('if#init: cond; textContent: label'))).toHaveLength(0);
  });

  it('末尾セミコロン（空要素）は複数扱いにしない（ランタイムの trim-filter と同じ数え方）', () => {
    expect(structuralErrors(page('for: items;'))).toHaveLength(0);
  });
});
