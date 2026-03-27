import { describe, it, expect } from 'vitest';
import { renderToString } from '../src/render';

describe('SSR ブロックコメント', () => {
  it('for ブロックに開始・終了コメントが入る', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"items":[{"name":"Alice"},{"name":"Bob"}]}'></wcs-state>
      <template data-wcs="for: items">
        <li data-wcs="textContent: .name"></li>
      </template>
    `);
    console.log(result);

    // 各アイテムに開始・終了コメントがある
    expect(result).toMatch(/<!--@@wcs-for-start:\w+:items:0-->/);
    expect(result).toMatch(/<!--@@wcs-for-end:\w+:items:0-->/);
    expect(result).toMatch(/<!--@@wcs-for-start:\w+:items:1-->/);
    expect(result).toMatch(/<!--@@wcs-for-end:\w+:items:1-->/);

    // コメントの id がテンプレート UUID と一致
    const startMatch = result.match(/<!--@@wcs-for-start:(\w+):items:0-->/);
    const endMatch = result.match(/<!--@@wcs-for-end:(\w+):items:0-->/);
    expect(startMatch![1]).toBe(endMatch![1]);
  });

  it('if ブロック（true）に開始・終了コメントが入る', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"show":true}'></wcs-state>
      <template data-wcs="if: show">
        <p>visible</p>
      </template>
    `);
    console.log(result);

    expect(result).toMatch(/<!--@@wcs-if-start:\w+:show-->/);
    expect(result).toMatch(/<!--@@wcs-if-end:\w+:show-->/);
  });

  it('if ブロック（false）にはコメントが入らない', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"show":false}'></wcs-state>
      <template data-wcs="if: show">
        <p>hidden</p>
      </template>
    `);

    expect(result).not.toMatch(/@@wcs-if-start/);
    expect(result).not.toMatch(/@@wcs-if-end/);
  });

  it('if/else ブロックの else 側に開始・終了コメントが入る', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"loggedIn":false}'></wcs-state>
      <template data-wcs="if: loggedIn">
        <p>welcome</p>
      </template>
      <template data-wcs="else:">
        <p>please login</p>
      </template>
    `);
    console.log(result);

    // if 側は false なのでコメントなし
    expect(result).not.toMatch(/@@wcs-if-start/);
    // else 側にコメントがある
    expect(result).toMatch(/<!--@@wcs-else-start:\w+:/);
    expect(result).toMatch(/<!--@@wcs-else-end:\w+:/);
  });

  it('for コメントの中にレンダリング内容が挟まれている', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"items":[{"name":"X"}]}'></wcs-state>
      <template data-wcs="for: items">
        <span data-wcs="textContent: .name"></span>
      </template>
    `);

    // start → 内容 → end の順序
    const pattern = /<!--@@wcs-for-start:\w+:items:0-->([\s\S]*?)<!--@@wcs-for-end:\w+:items:0-->/;
    const match = result.match(pattern);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('>X<');
  });
});
