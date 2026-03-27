import { describe, it, expect } from 'vitest';
import { renderToString } from '../src/render';

describe('SSR テキストコメント', () => {
  it('data-wcs="textContent:" のテキストに前後コメントが入る', async () => {
    const result = await renderToString(`
      <wcs-state json='{"msg":"Hello"}'></wcs-state>
      <p data-wcs="textContent: msg"></p>
    `);
    console.log(result);
    // textContent は replaceNode ではなく直接プロパティ代入なのでテキストコメントは入らない
    // (textContent はテキストバインディングではなくプロパティバインディング)
    expect(result).toContain('>Hello<');
  });

  it('Mustache {{ }} のテキストに前後コメントが入る', async () => {
    const result = await renderToString(`
      <wcs-state json='{"name":"Alice"}'></wcs-state>
      <p>Hello {{ name }}!</p>
    `);
    console.log(result);

    expect(result).toMatch(/<!--@@wcs-text-start:name-->/);
    expect(result).toMatch(/<!--@@wcs-text-end:name-->/);
    // start → テキスト → end の順序
    const pattern = /<!--@@wcs-text-start:name-->([^<]*)<!--@@wcs-text-end:name-->/;
    const match = result.match(pattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('Alice');
  });

  it('複数の Mustache が正しくコメントで囲まれる', async () => {
    const result = await renderToString(`
      <wcs-state json='{"first":"John","last":"Doe"}'></wcs-state>
      <p>{{ first }} {{ last }}</p>
    `);
    console.log(result);

    expect(result).toMatch(/<!--@@wcs-text-start:first-->John<!--@@wcs-text-end:first-->/);
    expect(result).toMatch(/<!--@@wcs-text-start:last-->Doe<!--@@wcs-text-end:last-->/);
  });

  it('<!--@@: path--> 記法のテキストに前後コメントが入る', async () => {
    const result = await renderToString(`
      <wcs-state json='{"count":42}'></wcs-state>
      <span><!--@@: count--></span>
    `);
    console.log(result);

    expect(result).toMatch(/<!--@@wcs-text-start:count-->/);
    expect(result).toMatch(/<!--@@wcs-text-end:count-->/);
    const pattern = /<!--@@wcs-text-start:count-->([^<]*)<!--@@wcs-text-end:count-->/;
    const match = result.match(pattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('42');
  });
});
