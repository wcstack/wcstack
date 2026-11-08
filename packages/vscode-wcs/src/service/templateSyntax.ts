/**
 * templateSyntax.ts
 *
 * Mustache 構文 `{{ path }}` とコメントバインディング `<!--@@:path-->` を
 * 検出し、補完・診断に必要な情報を返す。
 *
 * 正本は `@wcstack/state` 4.0 の `dom/plan.ts`:
 *   - mustache: テキストノードの `{{([\s\S]+?)}}`（式は複数行にまたがってよい）。テキストノードだけなので、
 *     属性の値（`aria-current="{{ x }}"`）と HTML コメントの中の `{{ }}` は束ねない — ここでも拾わない。
 *     `$behavior.enableMustache: false` の木では束ねない（その判定は stateBehavior.ts、診断からの除外は
 *     core/validateDocument.ts）。
 *   - コメント: コメントのデータが `^\s*@@\s*(?:wcs-text)?\s*:\s*([\s\S]+?)\s*$`（同じく複数行）
 *     <!--@@:path-->           ← wcs-text の省略形
 *     <!--@@wcs-text:path-->   ← 正式形（4.0 は接頭辞を変える設定 commentTextPrefix を持たない）
 *     親が `<textarea>` / `<title>` のコメントは束ねない（ブラウザのパーサはそこでコメントを文字にする）。
 *     コメント束縛は `$behavior.enableMustache: false` でも束ねる（4.0 の R7）。
 *   - 文書の `<wcs-state>` が歩くのは `document.body` だけ（dom/mount.ts の `mount`）。文書の `<head>` の中
 *     （`<title>{{ x }}</title>`）は、どちらの形も束ねない（`inDocumentHead`）。router の `<wcs-head>` の中身は
 *     binder の手渡しで束ねる — その `<title>` の `{{ }}` は束ね、コメントは文字のまま。
 *
 * 生の HTML を走査するので、テキストノードの境界の代わりに「タグの始まり（`<` の後に英字・`/`・`!`・`?`）を
 * またがない」で mustache の式を区切る。`<script>` / `<style>` の本体は文字なので、どちらも探さない。
 *
 * for/if/elseif/else のコメントは <template data-wcs="..."> から
 * ランタイムが自動生成するため、ユーザーが直接書くものではない。
 */

import { asciiLowerCase, findStartTagRegions } from '../language/htmlParse.js';

/** テンプレート構文の検出結果 */
export interface TemplateSyntaxMatch {
  /** 構文の種類 */
  kind: 'mustache' | 'comment';
  /** バインディング式のテキスト（パス + フィルタ） */
  expression: string;
  /** バインディング式の HTML 内オフセット（開始） */
  exprStart: number;
  /** バインディング式の HTML 内オフセット（終了） */
  exprEnd: number;
  /** 構文全体の開始オフセット（{{ の位置） */
  matchStart: number;
  /** 構文全体の終了オフセット（}} の直後） */
  matchEnd: number;
  /** <template> 要素の内部にあるか */
  insideTemplate: boolean;
  /**
   * 文書の `<head>` の中か（明示の `<head>` 開始タグの後、`</head>` か `<body>` の前）。ランタイムは文書の
   * `body` だけを歩くので、そこの mustache もコメント束縛も束ねない。
   */
  inDocumentHead: boolean;
  /**
   * 中身が文字になる親（`<title>` / `<textarea>`）の中なら、その名前。そこではコメントの形は束縛にならない
   * （mustache はテキストノードなので束ねる）。
   */
  textParent?: 'title' | 'textarea';
}

/** `{{ expr }}`。式は複数行にまたがってよいが、タグの始まりはまたがない（テキストノードの外へ出ない）。 */
const MUSTACHE = /\{\{\s*((?:(?!<[A-Za-z/!?])[\s\S])+?)\s*\}\}/dg;

/** `<!--@@: expr-->` / `<!--@@wcs-text: expr-->`。式は複数行にまたがってよいが、コメントの終わりはまたがない。 */
const COMMENT_BINDING = /<!--\s*@@\s*(?:wcs-text)?\s*:\s*((?:(?!-->)[\s\S])+?)\s*-->/dg;

/** 中身が文字になる要素（mustache・コメント束縛のどちらも探さない）。 */
const RAW_TEXT_TAGS: readonly string[] = ['script', 'style'];
/** コメント束縛を束ねない親（ブラウザのパーサは中のコメントを文字にする）。 */
const TEXT_ONLY_COMMENT_PARENTS: readonly string[] = ['textarea', 'title'];

/**
 * HTML からすべての Mustache 構文を検出する。
 * テキストだけを見る: `<script>` / `<style>` の本体、タグの中（属性の値）、HTML コメントの中はスキップ。
 */
export function findAllMustacheSyntax(html: string): TemplateSyntaxMatch[] {
  return collect(html, maskMarkup(html), MUSTACHE, 'mustache', RAW_TEXT_TAGS);
}

/**
 * HTML からすべてのコメントテキストバインディングを検出する。
 *
 * 対応形式:
 *   <!--@@:path-->           （省略形）
 *   <!--@@wcs-text:path-->   （正式形）
 *
 * `<script>` / `<style>` の本体と、`<textarea>` / `<title>` の中（ランタイムが束ねない）はスキップ。
 */
export function findAllCommentBindings(html: string): TemplateSyntaxMatch[] {
  return collect(html, html, COMMENT_BINDING, 'comment', [...RAW_TEXT_TAGS, ...TEXT_ONLY_COMMENT_PARENTS]);
}

/**
 * カーソル位置が Mustache 構文内にあるかを判定する。
 */
export function findMustacheAtOffset(html: string, offset: number): { expression: string; exprStart: number } | null {
  return at(findAllMustacheSyntax(html), offset);
}

/**
 * カーソル位置がコメントテキストバインディング内にあるかを判定する。
 */
export function findCommentBindingAtOffset(html: string, offset: number): { expression: string; exprStart: number } | null {
  return at(findAllCommentBindings(html), offset);
}

function at(matches: readonly TemplateSyntaxMatch[], offset: number): { expression: string; exprStart: number } | null {
  const hit = matches.find((m) => offset >= m.matchStart && offset <= m.matchEnd);
  return hit === undefined ? null : { expression: hit.expression, exprStart: hit.exprStart };
}

/**
 * `scan` は `html` と同じ長さの、正規表現を当てる文字列（mustache では markup を潰した鏡像 — maskMarkup）。
 * 式と位置は捕捉から取る（鏡像は markup の外を変えず、式は markup をまたがないので原文と同じ）。
 */
function collect(
  html: string,
  scan: string,
  regex: RegExp,
  kind: TemplateSyntaxMatch['kind'],
  skipInside: readonly string[],
): TemplateSyntaxMatch[] {
  const results: TemplateSyntaxMatch[] = [];
  const skip = rangeTester(html, skipInside);
  const inTemplate = templateTester(html);
  const inHead = documentHeadTester(html);
  // コメント束縛は <title> / <textarea> の中を飛ばすので、中身が文字になる親を問うのは mustache だけ
  const textParent = kind === 'mustache' ? rangeTester(html, TEXT_ONLY_COMMENT_PARENTS) : null;
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(scan)) !== null) {
    if (skip(match.index) !== null) continue;
    const expr = match[1];
    // 式の位置は捕捉の位置（`d` フラグ）。`indexOf(expr)` だと、式と同じ文字列が区切りの中にあるとき
    // （`<!--@@wcs-text: wcs-text-->`）区切りの方を指す
    const exprStart = match.indices![1][0];
    const parent = textParent?.(match.index) ?? null;
    results.push({
      kind,
      expression: expr,
      exprStart,
      exprEnd: exprStart + expr.length,
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
      insideTemplate: inTemplate(match.index),
      inDocumentHead: inHead(match.index),
      ...(parent !== null ? { textParent: parent as 'title' | 'textarea' } : {}),
    });
  }
  return results;
}

/**
 * markup（開始・終了タグ — 属性の値も —、HTML コメント、`<!doctype>` / `<?…>`、`<script>` / `<style>` の本体）を
 * `<x…x` に潰した、同じ長さの鏡像。mustache はテキストノードにしか無いので、鏡像に当てれば属性の値やコメントの
 * 中の `{{ }}` を拾わず、`<x` で始まる潰した範囲を式がまたぐこともない（MUSTACHE の否定先読み）。
 * `<title>` / `<textarea>` の中身は文字（RCDATA）なので潰さず、中の `<b>` もタグとみなさない。
 * 開始タグの終端は引用符を跨がずに探す（findStartTagRegions と同じ）。
 */
function maskMarkup(html: string): string {
  if (!html.includes('{{')) return html;
  const lower = asciiLowerCase(html);
  const chunks: string[] = [];
  let last = 0;
  const mask = (from: number, to: number): void => {
    if (to <= from) return;
    chunks.push(html.slice(last, from), '<', 'x'.repeat(to - from - 1));
    last = to;
  };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close === -1 ? html.length : close + 3;
      mask(lt, i);
      continue;
    }
    const next = html[lt + 1];
    if (next === '!' || next === '?' || next === '/') {
      const close = html.indexOf('>', lt + 1);
      i = close === -1 ? html.length : close + 1;
      mask(lt, i);
      continue;
    }
    if (next === undefined || !/[A-Za-z]/.test(next)) {
      i = lt + 1;
      continue;
    }
    let n = lt + 1;
    while (n < html.length && /[^\s/>]/.test(html[n])) n++;
    const tagName = lower.slice(lt + 1, n);
    let j = n;
    let quote: string | null = null;
    while (j < html.length) {
      const c = html[j];
      if (quote !== null) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    i = j < html.length ? j + 1 : html.length;
    mask(lt, i);
    const raw = RAW_TEXT_TAGS.includes(tagName);
    if (raw || TEXT_ONLY_COMMENT_PARENTS.includes(tagName)) {
      const close = lower.indexOf(`</${tagName}`, i);
      const contentEnd = close === -1 ? html.length : close;
      if (raw) mask(i, contentEnd);
      i = contentEnd;
    }
  }
  chunks.push(html.slice(last));
  return chunks.join('');
}

/**
 * 位置が文書の `<head>` の中かを答える関数を返す: 明示の `<head>` 開始タグ（コメント・`<script>` / `<style>` の
 * 外のもの）の後で、その後の最初の `</head` か `<body>` 開始タグの前。`<head>` の無いファイル（断片・ルートの
 * 中身）では常に false — `<wcs-head>` の `<title>` はルートの中に書くもので、文書の head ではない。
 */
function documentHeadTester(html: string): (offset: number) => boolean {
  if (!/<head[\s>]/i.test(html)) return () => false;
  const regions = findStartTagRegions(html);
  const head = regions.find((r) => r.tagName === 'head');
  if (head === undefined) return () => false;
  const close = asciiLowerCase(html).indexOf('</head', head.end);
  const body = regions.find((r) => r.tagName === 'body' && r.start > head.end);
  const ends = [close, body === undefined ? -1 : body.start].filter((at) => at !== -1);
  const end = ends.length === 0 ? html.length : Math.min(...ends);
  return (offset) => offset > head.end && offset < end;
}

/**
 * 指定した要素の**中身**の範囲を文書の頭から 1 回だけ集め、位置が入る範囲の要素名（無ければ null）を答える関数を
 * 返す。呼び出しは位置の昇順（正規表現の走査順）なので、範囲は先頭から進めるだけでよい。
 *
 * 中身の終わりは HTML のパーサと同じく「最初の `</tag`」（`<script>` の本体の `<script` という文字列で
 * 入れ子を数え違えない）。`<title>` / `<textarea>` も同じ（RCDATA）。
 */
function rangeTester(html: string, tags: readonly string[]): (offset: number) => string | null {
  const ranges: { start: number; end: number; tag: string }[] = [];
  const lower = asciiLowerCase(html);
  const open = new RegExp(`<(${tags.join('|')})(?=[\\s/>])[^>]*>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = open.exec(html)) !== null) {
    const start = match.index + match[0].length;
    const tag = match[1].toLowerCase();
    const close = lower.indexOf(`</${tag}`, start);
    const end = close === -1 ? html.length : close;
    ranges.push({ start, end, tag });
    open.lastIndex = end;
  }
  let i = 0;
  return (offset) => {
    while (i < ranges.length && ranges[i].end <= offset) i++;
    return i < ranges.length && ranges[i].start <= offset ? ranges[i].tag : null;
  };
}

/**
 * 位置が `<template>` の内部にあるかを答える関数を返す（位置の昇順に呼ぶこと）。
 *
 * 開始・終了タグを出現順に数えて深度で判定する（forContext.ts の
 * getForTemplateDepthAt と同じ方針）。`<template>` は入れ子になるので、
 * 直近の開始／終了位置の比較では内側の `</template>` を外側の閉じと
 * 取り違えて「テンプレート外」と誤判定する。タグは文書の頭から 1 回だけ集め、
 * 呼び出しのたびに先頭から数え直さない（キー入力ごとに走る検証の、式 1 つあたりの全文走査を避ける）。
 */
function templateTester(html: string): (offset: number) => boolean {
  const tagRegex = /<(\/?)template[\s>]/gi;
  const tags: { at: number; close: boolean }[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) tags.push({ at: match.index, close: match[1] !== '' });
  let i = 0;
  let depth = 0;
  return (offset) => {
    while (i < tags.length && tags[i].at <= offset) {
      depth = tags[i].close ? Math.max(0, depth - 1) : depth + 1;
      i++;
    }
    return depth > 0;
  };
}
