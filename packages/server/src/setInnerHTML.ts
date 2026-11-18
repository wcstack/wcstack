/**
 * 表の中の `<template>` を、ブラウザと同じ所に置く innerHTML。
 *
 * happy-dom（21.0.4 で確認）のパーサは、`<table>` / `<thead>` / `<tbody>` / `<tfoot>` / `<tr>` /
 * `<colgroup>` の直下の `<template>` を「表に置けない要素」として表の前へ追い出し、空のまま残す。その中身
 * （`<tr>` / `<td>` / `<col>`）は表の中に残る。ブラウザは HTML の仕様どおり、そこに `<template>` を置き、
 * 中身をその content に入れる — `<tbody>` の中の `<template data-wcs="for: rows">` は表の行の一覧の典型の
 * 形なのに、happy-dom の上では行の束縛（`.name`）が囲む for を失い、`renderToString` は投げ、
 * `@wcstack/testing` の `mount()` は `[wcs/wildcard-rank]` で失敗していた（seam app lending-desk）。
 * 表の外でも、通常のパースでは `<template>` の中の `<tr>` / `<td>` が落ちる（template.innerHTML なら残る）。
 *
 * 回避: 危ない `<template>` — 表の要素の中にあるもの、または中身に表の要素を持つもの — を、パーサに
 * 渡す前に文字列から抜き、表の中でも動かされないコメントを代わりに置く。パースの後、そのコメントを
 * 本物の `<template>` に置き換える。開始タグは happy-dom 自身に読ませ（属性の読みが変わらない）、中身は
 * `template.innerHTML`（template の中身として読む。`<tr>` / `<td>` / `<col>` を最上位に置ける）で、
 * 入れ子の `<template>` にも同じことをする。置き換えはパースと同じ同期の区間で終わる（要素の
 * connectedCallback の続き — マイクロタスク — より前）。
 *
 * 表の要素を 1 つも含まない HTML と、危ない `<template>` の無い HTML は、そのまま innerHTML に渡す —
 * 結果はこれまでと 1 バイトも変わらない。
 */

/** 表の要素の開始・終了タグ。これが 1 つも無ければ、危ない `<template>` は無い */
const TABLE_MARKUP = /<\/?(?:table|caption|colgroup|col|thead|tbody|tfoot|tr|td|th)[\s/>]/i;

/** 直下の `<template>` を happy-dom が表の前へ追い出す要素 */
const TABLE_CONTEXT = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup']);

/**
 * 中身をタグとして読まない（読まないことのある）要素。その中の `<template>` は文字なので、抜かずに
 * そのまま渡す（happy-dom が中身をタグとして読む要素 — `<textarea>` など — でも、抜かなければ
 * これまでどおり）
 */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);

const TAG_NAME = /[A-Za-z][^\s/>]*/y;
const END_TAG = /<\/([A-Za-z][^\s/>]*)\s*>/y;
const COMMENT_END = /--!?>/g;

/** 抜いた `<template>`: 開始タグと中身（どちらも書かれたとおりの文字列） */
interface Cut {
  readonly start: string;
  readonly inner: string;
}

/** `html[at]` の `<` から始まる 1 つのマークアップ。`name` はタグのとき（小文字） */
interface Markup {
  readonly end: number;
  readonly name?: string;
  readonly close?: boolean;
}

/** 開始タグの `>` の次の位置（属性値の引用符の中の `>` は飛ばす） */
function startTagEnd(html: string, from: number): number {
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (c === '>') return i + 1;
    if (c === '=') {
      let j = i + 1;
      while (j < html.length && /\s/.test(html[j])) j++;
      const quote = html[j];
      if (quote === '"' || quote === "'") {
        const k = html.indexOf(quote, j + 1);
        if (k === -1) return html.length;
        i = k;
      }
    }
  }
  return html.length;
}

/**
 * `html[at]`（`<`）から 1 つのマークアップを読む。タグでもコメントでもない `<` は 1 文字の文字。
 *
 * 読み方は happy-dom（21）に合わせる: コメントは次の `-->` か `--!>` まで（happy-dom は `<!-->` で
 * 終わらせない）、生のテキストは `</script>` の形（`</script` と `>` の間は空白だけ）の終了タグまで、
 * 終了タグも同じ形のものだけを数える。コメントと生のテキストは HTML の仕様より長いか同じなので、仕様に
 * 近づいた happy-dom とずれても、ずれるのは「抜かずに渡す」側 — これまでどおりに読まれる側になる。
 */
function readMarkup(html: string, at: number): Markup {
  if (html.startsWith('<!--', at)) {
    COMMENT_END.lastIndex = at + 4;
    return { end: COMMENT_END.exec(html) === null ? html.length : COMMENT_END.lastIndex };
  }
  if (html[at + 1] === '/') {
    END_TAG.lastIndex = at;
    const match = END_TAG.exec(html);
    return match === null ? { end: at + 1 } : { end: END_TAG.lastIndex, name: match[1].toLowerCase(), close: true };
  }
  TAG_NAME.lastIndex = at + 1;
  const match = TAG_NAME.exec(html);
  if (match === null) {
    if (html[at + 1] === '!' || html[at + 1] === '?') {
      // doctype・処理命令 — 次の `>` まで
      const k = html.indexOf('>', at);
      return { end: k === -1 ? html.length : k + 1 };
    }
    return { end: at + 1 };
  }
  const name = match[0].toLowerCase();
  const end = startTagEnd(html, TAG_NAME.lastIndex);
  if (!RAW_TEXT.has(name)) return { end, name };
  // 生のテキストの要素: 中身は飛ばし、その終了タグから読み続ける
  const closing = new RegExp(`</${name}\\s*>`, 'ig');
  closing.lastIndex = end;
  const found = closing.exec(html);
  return { end: found === null ? html.length : found.index, name };
}

/**
 * `html` の最上位の危ない `<template>` を抜き、`<!--${mark}${番号}-->` に置き換える。
 * 抜いたものが無ければ null。終了タグの無い `<template>` は抜かない（これまでどおりに読まれる）。
 */
function cutTemplates(html: string, mark: string): { html: string; cuts: Cut[] } | null {
  const cuts: Cut[] = [];
  let out = '';
  // out へ写し終えた位置
  let copied = 0;
  // 開いている表の要素（終了タグはそれより内側のものも閉じる — happy-dom と同じ）。終了タグを省いた
  // 表では多めに数えるが、抜きすぎても害は無い（中身を template の中身として読むだけ）
  const open: string[] = [];
  // 開いている `<template>` の数と、最上位の `<template>` の開始タグの位置
  let level = 0;
  let start = 0;
  let startEnd = 0;
  let at = html.indexOf('<');
  while (at !== -1) {
    const markup = readMarkup(html, at);
    if (markup.name === 'template') {
      if (!markup.close) {
        if (level++ === 0) {
          start = at;
          startEnd = markup.end;
        }
      } else if (level > 0 && --level === 0) {
        const inner = html.slice(startEnd, at);
        if (open.length > 0 || TABLE_MARKUP.test(inner)) {
          out += `${html.slice(copied, start)}<!--${mark}${cuts.length}-->`;
          cuts.push({ start: html.slice(start, startEnd), inner });
          copied = markup.end;
        }
      }
    } else if (level === 0 && markup.name !== undefined && TABLE_CONTEXT.has(markup.name)) {
      if (!markup.close) {
        open.push(markup.name);
      } else if (open.lastIndexOf(markup.name) !== -1) {
        open.length = open.lastIndexOf(markup.name);
      }
    }
    at = html.indexOf('<', markup.end);
  }
  return cuts.length === 0 ? null : { html: out + html.slice(copied), cuts };
}

/** `root` の下（`<template>` の中身は除く）の、印で始まるコメント */
function findPlaceholders(root: Node, mark: string): Comment[] {
  const found: Comment[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeType === 8 && (node as Comment).data.startsWith(mark)) {
      found.push(node as Comment);
    }
    for (let child = node.lastChild; child !== null; child = child.previousSibling) {
      stack.push(child);
    }
  }
  return found;
}

let marks = 0;

/**
 * `target.innerHTML = html` と同じ（`target` の子を `html` をパースしたものに置き換える）。ただし、表の
 * 中の `<template>` は happy-dom が動かさずに、ブラウザと同じ所に置く（このファイルの冒頭を参照）。
 * `target` が `<template>` なら、その中身を置き換える。`renderToString` が body に、`@wcstack/testing` の
 * `mount()` がページに使う。
 */
export function setInnerHTML(target: Element | ShadowRoot, html: string): void {
  const mark = `wcs-template-${(++marks).toString(36)}-${Math.random().toString(36).slice(2)}:`;
  const cut = TABLE_MARKUP.test(html) ? cutTemplates(html, mark) : null;
  if (cut === null) {
    target.innerHTML = html;
    return;
  }
  target.innerHTML = cut.html;
  const document = target.ownerDocument;
  const root = (target as Element).localName === 'template' ? (target as HTMLTemplateElement).content : target;
  for (const placeholder of findPlaceholders(root, mark)) {
    const { start, inner } = cut.cuts[Number(placeholder.data.slice(mark.length))];
    // 開始タグは happy-dom 自身に読ませる（属性の読みがこれまでと同じ）
    const holder = document.createElement('template');
    holder.innerHTML = `${start}</template>`;
    const template = holder.content.firstChild as HTMLTemplateElement;
    setInnerHTML(template, inner);
    placeholder.parentNode!.replaceChild(template, placeholder);
  }
}
