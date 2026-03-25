import { describe, it, expect } from 'vitest';
import { parseWcsScriptBlocks, WcsScriptBlock } from '../src/language/htmlParse';

describe('parseWcsScriptBlocks', () => {
  it('基本: <wcs-state> 内の <script type="module"> を抽出する', () => {
    const html = `<wcs-state>
  <script type="module">
export default { count: 0 };
  </script>
</wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toContain('export default { count: 0 }');
    expect(blocks[0].stateName).toBe('default');
  });

  it('name 属性を持つ <wcs-state> から stateName を取得する', () => {
    const html = `<wcs-state name="cart">
  <script type="module">
export default { items: [] };
  </script>
</wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].stateName).toBe('cart');
  });

  it('シングルクォートの name 属性', () => {
    const html = `<wcs-state name='user'>
  <script type="module">export default {};</script>
</wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks[0].stateName).toBe('user');
  });

  it('複数の <wcs-state> を抽出する', () => {
    const html = `
<wcs-state name="a">
  <script type="module">const a = 1;</script>
</wcs-state>
<wcs-state name="b">
  <script type="module">const b = 2;</script>
</wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].stateName).toBe('a');
    expect(blocks[0].content).toContain('const a = 1');
    expect(blocks[1].stateName).toBe('b');
    expect(blocks[1].content).toContain('const b = 2');
  });

  it('contentStart / contentEnd のオフセットが正確', () => {
    const html = `<wcs-state><script type="module">CONTENT</script></wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe('CONTENT');
    expect(html.slice(blocks[0].contentStart, blocks[0].contentEnd)).toBe('CONTENT');
  });

  it('<script> に type 属性がない場合は無視する', () => {
    const html = `<wcs-state>
  <script>alert("ignored")</script>
  <script type="module">export default {};</script>
</wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toContain('export default');
  });

  it('<script type="text/javascript"> は無視する', () => {
    const html = `<wcs-state>
  <script type="text/javascript">var x = 1;</script>
  <script type="module">export default {};</script>
</wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(1);
  });

  it('<wcs-state> 外の <script type="module"> は無視する', () => {
    const html = `
<script type="module">import './app.js';</script>
<wcs-state>
  <script type="module">export default { count: 0 };</script>
</wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toContain('count: 0');
  });

  it('HTML コメント内の <wcs-state> は無視する', () => {
    const html = `
<!-- <wcs-state><script type="module">ignored</script></wcs-state> -->
<wcs-state>
  <script type="module">export default {};</script>
</wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(1);
  });

  it('<wcs-state> が閉じタグなしの場合でもクラッシュしない', () => {
    const html = `<wcs-state><script type="module">export default {};</script>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(1);
  });

  it('空の <wcs-state> は何も返さない', () => {
    const html = `<wcs-state></wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(0);
  });

  it('<wcs-state> がない HTML は空配列を返す', () => {
    const html = `<html><body><h1>Hello</h1></body></html>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(0);
  });

  it('大文字小文字を区別しない', () => {
    const html = `<WCS-STATE><SCRIPT TYPE="module">export default {};</SCRIPT></WCS-STATE>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(1);
  });

  it('属性値に > を含むタグを正しくパースする', () => {
    const html = `<wcs-state json='{"a":">"}'>
  <script type="module">export default {};</script>
</wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(1);
  });

  it('複数行のスクリプト内容を正しく抽出する', () => {
    const html = `<wcs-state>
  <script type="module">
import { defineState } from '@wcstack/state';

export default defineState({
  count: 0,
  users: [],
  increment() {
    this.count++;
  }
});
  </script>
</wcs-state>`;
    const blocks = parseWcsScriptBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toContain('defineState');
    expect(blocks[0].content).toContain('increment()');

    // オフセットの整合性確認
    const extracted = html.slice(blocks[0].contentStart, blocks[0].contentEnd);
    expect(extracted).toBe(blocks[0].content);
  });
});
