import { describe, it, expect } from 'vitest';
import { renderToString } from '../src/render';

// 4.0 のテキストのマーク: `<!--wcs-t:EXPR-->値<!--wcs-/t-->`。EXPR はバインディングの式そのもの
// （URI エンコード。フィルタも含む — クライアントはこれをコメントバインディングに戻す）。
// 3.x は `<!--@@wcs-text-start:path-->値<!--@@wcs-text-end:path-->` だった。
describe('SSR テキストコメント', () => {
  it('data-wcs="textContent:" のテキストに前後コメントが入る', async () => {
    const result = await renderToString(`
      <wcs-state json='{"msg":"Hello"}'></wcs-state>
      <p data-wcs="textContent: msg"></p>
    `);
    // textContent は replaceNode ではなく直接プロパティ代入なのでテキストコメントは入らない
    // (textContent はテキストバインディングではなくプロパティバインディング)
    expect(result).toContain('>Hello<');
    expect(result).not.toContain('wcs-t:');
  });

  it('Mustache {{ }} のテキストに前後コメントが入る', async () => {
    const result = await renderToString(`
      <wcs-state json='{"name":"Alice"}'></wcs-state>
      <p>Hello {{ name }}!</p>
    `);
    // start → テキスト → end の順序
    const match = result.match(/<!--wcs-t:name-->([^<]*)<!--wcs-\/t-->/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('Alice');
    expect(result).toContain('<p>Hello <!--wcs-t:name-->Alice<!--wcs-/t-->!</p>');
  });

  it('複数の Mustache が正しくコメントで囲まれる', async () => {
    const result = await renderToString(`
      <wcs-state json='{"first":"John","last":"Doe"}'></wcs-state>
      <p>{{ first }} {{ last }}</p>
    `);
    expect(result).toContain('<p><!--wcs-t:first-->John<!--wcs-/t--> <!--wcs-t:last-->Doe<!--wcs-/t--></p>');
  });

  it('<!--@@: path--> 記法のテキストに前後コメントが入る', async () => {
    const result = await renderToString(`
      <wcs-state json='{"count":42}'></wcs-state>
      <span><!--@@: count--></span>
    `);
    const match = result.match(/<!--wcs-t:count-->([^<]*)<!--wcs-\/t-->/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('42');
  });

  it('フィルタ付きの式はフィルタごとマークに入る（URI エンコード）', async () => {
    const result = await renderToString(`
      <wcs-state json='{"price":1234}'></wcs-state>
      <p>{{ price|locale }}</p>
    `);
    const match = result.match(/<!--wcs-t:([^>]*)-->([^<]*)<!--wcs-\/t-->/);
    expect(match).not.toBeNull();
    expect(decodeURIComponent(match![1])).toBe('price|locale');
    expect(match![2]).toBe('1,234');
  });
});
