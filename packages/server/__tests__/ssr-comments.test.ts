import { describe, it, expect } from 'vitest';
import { renderToString } from '../src/render';

// 4.0 のブロックのマーク: ページ直下の構造テンプレートはアンカー `<!--wcs-p:ID-->` になり
// （テンプレートは <wcs-ssr> に `<template id=ID>` で残る）、その直後に描画内容の領域が続く。
// for の領域は `<!--wcs-[-->` 〜 `<!--wcs-]-->` で、各行の前に `<!--wcs-|-->`。if / elseif / else の
// 領域は描いた枝の番号を持つ `<!--wcs-[:i-->` 〜 `<!--wcs-]-->`。
// 3.x は行・枝ごとに `<!--@@wcs-for-start:ID:items:0-->` 〜 `-end` を書いていた。
describe('SSR ブロックコメント', () => {
  it('for ブロックに開始・終了コメントが入る', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"items":[{"name":"Alice"},{"name":"Bob"}]}'></wcs-state>
      <template data-wcs="for: items">
        <li data-wcs="textContent: .name"></li>
      </template>
    `);

    // アンカーの直後に領域、各アイテムの前に行のマーク
    const match = result.match(/<!--wcs-p:([\w-]+)--><!--wcs-\[-->([\s\S]*?)<!--wcs-\]-->/);
    expect(match).not.toBeNull();
    expect(match![2]).toBe('<!--wcs-|--><li>Alice</li><!--wcs-|--><li>Bob</li>');

    // アンカーの id が <wcs-ssr> のテンプレートの id と一致
    const tpl = result.match(/<wcs-ssr[^>]*>[\s\S]*<template id="([\w-]+)" data-wcs="for: items">[\s\S]*<\/wcs-ssr>/);
    expect(tpl).not.toBeNull();
    expect(tpl![1]).toBe(match![1]);
  });

  it('if ブロック（true）に開始・終了コメントが入る', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"show":true}'></wcs-state>
      <template data-wcs="if: show">
        <p>visible</p>
      </template>
    `);

    // 描いた枝（0 番目）の領域
    expect(result).toMatch(/<!--wcs-p:[\w-]+--><!--wcs-\[:0--><p>visible<\/p><!--wcs-\]-->/);
  });

  it('if ブロック（false）にはコメントが入らない', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"show":false}'></wcs-state>
      <template data-wcs="if: show">
        <p>hidden</p>
      </template>
    `);

    // アンカーだけで、領域は無い
    expect(result).toMatch(/<!--wcs-p:[\w-]+-->/);
    expect(result).not.toMatch(/<!--wcs-\[/);
    // （テンプレートの中身は <wcs-ssr> にだけある）
    expect(result.slice(result.indexOf('</wcs-ssr>'))).not.toContain('<p>hidden</p>');
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

    // if 側（0 番目）は false なので領域なし
    expect(result).not.toMatch(/<!--wcs-\[:0-->/);
    // else 側（1 番目）の領域が、連なりの最後のアンカーの後にある
    expect(result).toMatch(/<!--wcs-p:[\w-]+-->\s*<!--wcs-p:[\w-]+--><!--wcs-\[:1--><p>please login<\/p><!--wcs-\]-->/);
  });

  it('for コメントの中にレンダリング内容が挟まれている', async () => {
    const result = await renderToString(`
      <wcs-state enable-ssr json='{"items":[{"name":"X"}]}'></wcs-state>
      <template data-wcs="for: items">
        <span data-wcs="textContent: .name"></span>
      </template>
    `);

    // start → 内容 → end の順序
    const match = result.match(/<!--wcs-\[-->([\s\S]*?)<!--wcs-\]-->/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain('>X<');
  });
});
