/**
 * templateSyntax.ts
 *
 * Mustache 構文 `{{ path }}` とコメントバインディング `<!--@@:path-->` を
 * 検出し、補完・診断に必要な情報を返す。
 *
 * 正本は `@wcstack/state` 4.0 の `dom/plan.ts`:
 *   - mustache: テキストノードの `{{([\s\S]+?)}}`（式は複数行にまたがってよい）
 *   - コメント: コメントのデータが `^\s*@@\s*(?:wcs-text)?\s*:\s*([\s\S]+?)\s*$`（同じく複数行）
 *     <!--@@:path-->           ← wcs-text の省略形
 *     <!--@@wcs-text:path-->   ← 正式形（4.0 は接頭辞を変える設定 commentTextPrefix を持たない）
 *     親が `<textarea>` / `<title>` のコメントは束ねない（ブラウザのパーサはそこでコメントを文字にする）。
 *     コメント束縛は `$behavior.enableMustache: false` でも束ねる（4.0 の R7）。
 *
 * 生の HTML を走査するので、テキストノードの境界の代わりに「タグの始まり（`<` の後に英字・`/`・`!`・`?`）を
 * またがない」で mustache の式を区切る。`<script>` / `<style>` の本体は文字なので、どちらも探さない。
 *
 * for/if/elseif/else のコメントは <template data-wcs="..."> から
 * ランタイムが自動生成するため、ユーザーが直接書くものではない。
 */

import { asciiLowerCase } from '../language/htmlParse.js';

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
 * `<script>` / `<style>` 内はスキップ。
 */
export function findAllMustacheSyntax(html: string): TemplateSyntaxMatch[] {
  return collect(html, MUSTACHE, 'mustache', RAW_TEXT_TAGS);
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
  return collect(html, COMMENT_BINDING, 'comment', [...RAW_TEXT_TAGS, ...TEXT_ONLY_COMMENT_PARENTS]);
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

function collect(
  html: string,
  regex: RegExp,
  kind: TemplateSyntaxMatch['kind'],
  skipInside: readonly string[],
): TemplateSyntaxMatch[] {
  const results: TemplateSyntaxMatch[] = [];
  const skip = rangeTester(html, skipInside);
  const inTemplate = templateTester(html);
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    if (skip(match.index)) continue;
    const expr = match[1];
    // 式の位置は捕捉の位置（`d` フラグ）。`indexOf(expr)` だと、式と同じ文字列が区切りの中にあるとき
    // （`<!--@@wcs-text: wcs-text-->`）区切りの方を指す
    const exprStart = match.indices![1][0];
    results.push({
      kind,
      expression: expr,
      exprStart,
      exprEnd: exprStart + expr.length,
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
      insideTemplate: inTemplate(match.index),
    });
  }
  return results;
}

/**
 * 指定した要素の**中身**の範囲を文書の頭から 1 回だけ集め、位置がそのどれかに入るかを答える関数を返す。
 * 呼び出しは位置の昇順（正規表現の走査順）なので、範囲は先頭から進めるだけでよい。
 *
 * 中身の終わりは HTML のパーサと同じく「最初の `</tag`」（`<script>` の本体の `<script` という文字列で
 * 入れ子を数え違えない）。`<title>` / `<textarea>` も同じ（RCDATA）。
 */
function rangeTester(html: string, tags: readonly string[]): (offset: number) => boolean {
  const ranges: { start: number; end: number }[] = [];
  const lower = asciiLowerCase(html);
  const open = new RegExp(`<(${tags.join('|')})(?=[\\s/>])[^>]*>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = open.exec(html)) !== null) {
    const start = match.index + match[0].length;
    const close = lower.indexOf(`</${match[1].toLowerCase()}`, start);
    const end = close === -1 ? html.length : close;
    ranges.push({ start, end });
    open.lastIndex = end;
  }
  let i = 0;
  return (offset) => {
    while (i < ranges.length && ranges[i].end <= offset) i++;
    return i < ranges.length && ranges[i].start <= offset;
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
