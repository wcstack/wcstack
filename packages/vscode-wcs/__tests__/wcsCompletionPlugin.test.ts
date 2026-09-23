/**
 * wcsCompletionPlugin.test.ts — 補完の `provideCompletionItems` の契約検証。
 *
 * ここは**拡張がテキストを書き換える唯一の経路**（修飾子補完の `textEdit`）なのに、
 * サイクル 5 の変異テストまで 1 件もテストが無かった: `#` / `|` の引用符対応を素の
 * `lastIndexOf` に戻しても全テストが green のままだった。
 *
 * Volar の `LanguageServicePlugin` を最小のスタブ（document / context）で起こして直接呼ぶ。
 */
import { describe, it, expect } from 'vitest';
import { createWcsCompletionPlugin } from '../src/service/wcsCompletionPlugin';

/** `provideCompletionItems` が使う最小の TextDocument。 */
function makeDocument(text: string, uri = 'file:///page.html') {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const positionAt = (offset: number) => {
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
    return { line, character: offset - lineStarts[line] };
  };
  return {
    uri,
    languageId: 'html',
    version: 1,
    getText: () => text,
    positionAt,
    offsetAt: (position: { line: number; character: number }) => lineStarts[position.line] + position.character,
  };
}

/** 最小の LanguageServicePluginContext（設定は既定のまま）。 */
const context = { env: { locale: 'en' } } as never;

function completeAt(text: string, offset: number) {
  const instance = createWcsCompletionPlugin().create(context);
  const document = makeDocument(text);
  return instance.provideCompletionItems!(
    document as never,
    document.positionAt(offset),
    { triggerKind: 1 } as never,
    undefined as never,
  ) as { items: { label: string; textEdit?: { range: { start: unknown; end: unknown }; newText: string } }[] } | undefined;
}

/** `textEdit.range` が指す原文の範囲を復元する。 */
function replacedText(text: string, item: { textEdit?: { range: { start: { line: number; character: number }; end: { line: number; character: number } } } }): string {
  const document = makeDocument(text);
  const start = document.offsetAt(item.textEdit!.range.start);
  const end = document.offsetAt(item.textEdit!.range.end);
  return text.slice(start, end);
}

const STATE = `<wcs-state><script type="module">export default { name: '', items: [], label: '' };</script></wcs-state>\n`;

describe('provideCompletionItems: プロパティ / パス / フィルタの文脈', () => {
  it('属性値の先頭ではプロパティ候補を返すこと', () => {
    const html = `${STATE}<input data-wcs="">`;
    const result = completeAt(html, html.indexOf('data-wcs="') + 'data-wcs="'.length);
    expect(result!.items.map(i => i.label)).toContain('textContent');
  });

  it('`:` の後ろでは state パス候補を返すこと', () => {
    const html = `${STATE}<input data-wcs="value: ">`;
    const result = completeAt(html, html.indexOf('value: ') + 'value: '.length);
    expect(result!.items.map(i => i.label)).toContain('name');
  });

  it('`|` の後ろではフィルタ候補を返すこと', () => {
    const html = `${STATE}<p data-wcs="textContent: label|"></p>`;
    const result = completeAt(html, html.indexOf('label|') + 'label|'.length);
    expect(result!.items.map(i => i.label)).toContain('upper');
  });
});

describe('provideCompletionItems: 修飾子の textEdit（拡張が書き換える唯一の経路）', () => {
  it('`#` の直後では修飾子だけを置換範囲にすること', () => {
    const html = `${STATE}<input data-wcs="value#: name">`;
    const offset = html.indexOf('value#') + 'value#'.length;
    const result = completeAt(html, offset)!;
    const ro = result.items.find(i => i.label === 'ro')!;
    expect(ro.textEdit).toBeDefined();
    expect(replacedText(html, ro)).toBe('');
  });

  it('入力途中（`#r`）ではその 1 語だけを置換範囲にすること', () => {
    const html = `${STATE}<input data-wcs="value#r: name">`;
    const offset = html.indexOf('value#r') + 'value#r'.length;
    const ro = completeAt(html, offset)!.items.find(i => i.label === 'ro')!;
    expect(replacedText(html, ro)).toBe('r');
  });

  // Fixed by review（サイクル 5）— 「カーソル前の最後の `#`」から置換していたので、
  // 修飾子リストの 2 個目を補完すると `#ro,w` ごと置換されて先に書いた `ro` が消えていた。
  it('修飾子リストの 2 個目は直前の `,` から置換し、既に書いた修飾子を消さないこと', () => {
    const html = `${STATE}<input data-wcs="value#ro,w: name">`;
    const offset = html.indexOf('value#ro,w') + 'value#ro,w'.length;
    const wo = completeAt(html, offset)!.items.find(i => i.label === 'ro')!;
    // 置換されるのは入力中の `w` だけ（`ro,` は残る）
    expect(replacedText(html, wo)).toBe('w');
  });

  // Fixed by review（サイクル 4→5）— 引用符の中の `#` から置換範囲を取ると、
  // 補完を選んだ瞬間にフィルタ引数を壊すテキスト編集になる。
  it('置換範囲を引用符の中の `#` から取らないこと（引数を壊す編集にしない）', () => {
    const html = `${STATE}<input data-wcs="value#ro|defaults('#')">`;
    const offset = html.indexOf("defaults('#')") + "defaults('#')".length;
    const ro = completeAt(html, offset)!.items.find(i => i.label === 'ro')!;
    // 本物の `#`（`value#` の直後）から置換する ＝ 引数の `'#'` は範囲に含まれるが、
    // 引用符の中の `#` を開始にすると `')` だけが置換範囲になって引数が壊れる
    expect(replacedText(html, ro)).toBe("ro|defaults('#')");
  });

  it('入力フィルタ引数の中の `#` は修飾子の開始として扱わないこと', () => {
    const html = `${STATE}<input data-wcs="value|defaults('#'): name">`;
    const offset = html.indexOf("defaults('#')") + "defaults('#')".length;
    // そもそも修飾子文脈ではない（プロパティ文脈）ので修飾子候補は返らない
    const result = completeAt(html, offset);
    expect(result!.items.map(i => i.label)).toContain('textContent');
    expect(result!.items.map(i => i.label)).not.toContain('prevent');
  });
});

describe('provideCompletionItems: mustache のフィルタ補完', () => {
  it('`{{ x| }}` でフィルタ候補を返すこと', () => {
    const html = `${STATE}<template data-wcs="if: name"><p>{{ label| }}</p></template>`;
    const result = completeAt(html, html.indexOf('label|') + 'label|'.length);
    expect(result!.items.map(i => i.label)).toContain('upper');
  });

  it('引用符の中の `|` をフィルタの区切りと数えないこと（引数の中では補完しない）', () => {
    const html = `${STATE}<template data-wcs="if: name"><p>{{ items|join('| }}</p></template>`;
    const offset = html.indexOf("join('|") + "join('|".length;
    // `join('…` は閉じ括弧が無い ＝ フィルタ引数の中なので補完しない
    expect(completeAt(html, offset)).toBeUndefined();
  });
});
