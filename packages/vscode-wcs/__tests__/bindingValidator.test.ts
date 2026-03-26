import { describe, it, expect } from 'vitest';
import { validateBindings } from '../src/service/bindingValidator';

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

  it('if: に非ブーリアンパスを指定すると warning を出す', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>
<template data-wcs="if: count"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const ifDiag = diags.find(d => d.message.includes('"if"'));
    expect(ifDiag).toBeDefined();
    expect(ifDiag!.severity).toBe('warning');
    expect(ifDiag!.message).toContain('ブーリアン型');
  });

  it('if: users.length は number なので warning', () => {
    const html = `
<wcs-state>
  <script type="module">
export default { users: [{ name: "A" }] };
  </script>
</wcs-state>
<template data-wcs="if: users.length"></template>`;
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

  it('JSDoc @type {boolean|null} は if: で warning（null を含むため）', () => {
    const html = `
<wcs-state>
  <script type="module">
export default {
  /** @type {boolean|null} */
  ok: null,
};
  </script>
</wcs-state>
<template data-wcs="if: ok"></template>`;
    const diags = validateBindings(html, 'data-wcs');
    const ifDiag = diags.find(d => d.message.includes('"if"'));
    expect(ifDiag).toBeDefined();
    expect(ifDiag!.message).toContain('boolean|null');
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
