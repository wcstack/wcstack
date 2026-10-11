/**
 * htmlParse.ts
 *
 * HTML ファイルから <wcs-state> 内の <script type="module"> ブロックを検出し、
 * その内容とソースオフセットを返す軽量パーサ。
 *
 * 外部依存なし。正規表現ベースのステートマシンで実装。
 */

/**
 * ASCII の英大文字だけを小文字にする（HTML のタグ名・属性名の比較は ASCII case-insensitive）。
 * **文字数を変えない**ので、結果の上で探した位置をそのまま元の文字列の位置に使える。`String#toLowerCase` は
 * `'İ'`（U+0130）などを 2 文字にするので、それより後ろの位置がずれる（本文に `İSTANBUL` があるだけで、
 * スクリプトの終わりを取り違えていた）。
 */
export function asciiLowerCase(text: string): string {
  return text.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());
}

/** 開始タグ 1 個の**属性領域**（`<` の次から `>` の手前まで）。 */
export interface StartTagRegion {
  /** タグ名（小文字）。 */
  readonly tagName: string;
  /** 属性領域の開始（タグ名の直後）。 */
  readonly start: number;
  /** 属性領域の終了（`>` または `/>` の手前、exclusive）。 */
  readonly end: number;
}

/**
 * HTML の**開始タグだけ**を走査して、その属性領域を出現順に返す。
 *
 * 素の正規表現で `data-wcs="…"` を探すと、**マークアップではない場所**まで拾う:
 *   - HTML コメントの中の説明文（`<!-- <template data-wcs="for:"> は … -->`）
 *   - エスケープ済みテキスト（`<code>&lt;template data-wcs="if: ..."&gt;</code>`）— タグですらない
 *   - `<script>` / `<style>` の本体に書かれた文字列
 * リポジトリの `examples/router-i18n` と `examples/router-spa` は前 2 つを**説明として
 * 正しく**書いており、走査側が拾うと正本パーサに通されて偽の `wcs/binding-syntax` になる。
 *
 * 走査規則: `<!--…-->` / `<!…>` / 終了タグは飛ばし、`<` + 英字だけを開始タグとみなす。
 * タグの終端は**引用符を跨がずに**探す（`title="a>b"` で切れない）。`<script>` / `<style>` は
 * 本体をまとめて飛ばす（`findAllMustacheSyntax` が `isInsideTag` で同じ扱いをしているのと同じ方針）。
 */
export function findStartTagRegions(html: string): StartTagRegion[] {
  const out: StartTagRegion[] = [];
  let lower: string | null = null;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    const next = html[lt + 1];

    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    if (next === '!' || next === '?' || next === '/') {
      const close = html.indexOf('>', lt + 1);
      i = close === -1 ? html.length : close + 1;
      continue;
    }
    if (next === undefined || !/[A-Za-z]/.test(next)) {
      i = lt + 1;
      continue;
    }

    // タグ名
    let n = lt + 1;
    while (n < html.length && /[^\s/>]/.test(html[n])) n++;
    const tagName = asciiLowerCase(html.slice(lt + 1, n));

    // 属性領域の終端（引用符の中の `>` は終端ではない）
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
    const gt = j < html.length ? j : html.length;
    const selfClosing = html[gt - 1] === '/';
    out.push({ tagName, start: n, end: selfClosing ? gt - 1 : gt });
    i = gt + 1;

    // raw text 要素は本体ごと飛ばす（中の文字列を属性と読まない）
    if (tagName === 'script' || tagName === 'style') {
      const close = (lower ??= asciiLowerCase(html)).indexOf(`</${tagName}`, i);
      i = close === -1 ? html.length : close;
    }
  }
  return out;
}

/**
 * <wcs-state> 要素のメタ情報。
 * 属性（json, state, src）と内部スクリプトブロックを保持する。
 */
export interface WcsStateInfo {
  /** mount 属性の値（ボリューム）。無ければ null（＝ルートツリー） */
  mountPath: string | null;
  /** 開始タグに `bind-component` 属性があるか（マウントされたコンポーネントの state）。属性名で判定する */
  bindComponent: boolean;
  /** json 属性の値（インライン JSON） */
  jsonAttr?: string;
  /** state 属性の値（<script type="application/json"> の ID 参照） */
  stateAttr?: string;
  /** src 属性の値（外部ファイルパス） */
  srcAttr?: string;
  /** 内部の <script type="module"> ブロック */
  scriptBlocks: WcsScriptBlock[];
  /** 開始タグ `<wcs-state ...>` の開始オフセット（`<` の位置） */
  tagStart: number;
  /** 開始タグの終了オフセット（`>` の直後） */
  tagEnd: number;
}

export interface WcsScriptBlock {
  /** スクリプト内容の開始オフセット（<script ...> の直後） */
  contentStart: number;
  /** スクリプト内容の終了オフセット（</script> の直前） */
  contentEnd: number;
  /** スクリプトの中身テキスト */
  content: string;
  /** 所属する <wcs-state> の mount 属性（ボリューム）。無ければ null */
  mountPath: string | null;
  /**
   * 所属する <wcs-state> が `bind-component` を持つか。そのスクリプトはランタイムが読まない（マウントした
   * コンポーネントの state はホスト要素のプロパティだけで、中の `<script type="module">` は読み込みごと拒まれる —
   * `wcs/bind-component-source`）。
   */
  bindComponent: boolean;
}

/**
 * HTML テキストから <wcs-state> 内の <script type="module"> ブロックを全て抽出する。
 *
 * 仕様:
 * - <wcs-state> のネストは不可（仕様上）
 * - <!-- --> コメント内の <wcs-state> は無視
 * - raw text 要素（`<script>` / `<style>` / `<textarea>` / `<title>`）の中身の <wcs-state> は無視
 *   （`parseWcsStateElements` と同じ走査）
 * - <script type="module"> のみ対象
 * - 大文字小文字を区別しない（HTML仕様に準拠）
 * - 複数の <wcs-state> に対応
 */
export function parseWcsScriptBlocks(html: string, stateTagName: string = 'wcs-state'): WcsScriptBlock[] {
  return parseWcsStateElements(html, stateTagName).flatMap((element) => element.scriptBlocks);
}

/**
 * ランタイムが読み込む <wcs-state> のスクリプトだけ（`bind-component` を持つ要素の中のスクリプトを除く）。
 * 宣言とスクリプトの検査はこちらを使う: `<wcs-state bind-component>` の中のスクリプトはランタイムが読み込みごと
 * 拒む（`wcs/bind-component-source` で 1 件報告する）ので、中身の検査を重ねない。
 * 補完・型・参照などの編集の支援は `parseWcsScriptBlocks` を使う（書いている途中のスクリプトにも効かせる）。
 */
export function parseLoadedScriptBlocks(html: string, stateTagName: string = 'wcs-state'): WcsScriptBlock[] {
  return parseWcsScriptBlocks(html, stateTagName).filter((block) => !block.bindComponent);
}

/**
 * 中身が要素にならない要素（スクリプトが有効なページの HTML パーサは中の `<…>` をタグとして読まない）。
 * `<script>` / `<style>` / `<xmp>` / `<iframe>` / `<noembed>` / `<noframes>` / `<noscript>` は raw text、
 * `<textarea>` / `<title>` は RCDATA、`<plaintext>` は文書の終わりまで文字。JS で作る shadow DOM
 * （`innerHTML = \`<wcs-state …>\``）・文字列・入力欄の中の `<wcs-state>` / `<template>` / `data-wcs="…"` は
 * 文書の要素でも束縛でもない。`<wcs-state>` の走査・`createTemplateTester`・forContext の要素の文脈
 * （analyzeElementContexts）がこの 1 つの集合を使う。mustache・コメント束縛の走査（templateSyntax.ts）は
 * テキストノードを読むランタイムに合わせた別の規則。
 */
export const RAW_TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  'script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext',
]);

/**
 * `pos` から raw text 要素が始まるなら、その開始タグと中身の終わり（終了タグ `</tag` の位置。無ければ文書の終わり —
 * HTML のパーサと同じく残りがすべて中身になる）を返す。始まらなければ null。
 * 終了タグは `</tag` の直後が空白・`/`・`>`・文書の終わりのもの（`</scripts` は終了タグではない）。
 */
function matchRawTextElement(html: string, lower: string, pos: number): { tag: string; open: TagMatch; contentEnd: number; closed: boolean } | null {
  if (html[pos] !== '<') return null;
  for (const tag of RAW_TEXT_ELEMENTS) {
    const open = matchOpenTag(html, pos, tag);
    if (open === null) continue;
    // `<plaintext>` は終了タグを持たない（`</plaintext>` も文字）
    if (tag === 'plaintext') return { tag, open, contentEnd: html.length, closed: false };
    let from = open.end;
    for (;;) {
      const idx = lower.indexOf(`</${tag}`, from);
      if (idx === -1) return { tag, open, contentEnd: html.length, closed: false };
      const after = html[idx + tag.length + 2];
      if (after === undefined || after === '>' || after === '/' || /\s/.test(after)) return { tag, open, contentEnd: idx, closed: true };
      from = idx + 1;
    }
  }
  return null;
}

/** 終了タグ（`</tag …>`）の `>` の直後。`>` が無ければ文書の終わり。 */
function afterCloseTag(html: string, closeStart: number): number {
  const gt = html.indexOf('>', closeStart);
  return gt === -1 ? html.length : gt + 1;
}

/**
 * HTML テキストから <wcs-state> 要素を全て抽出し、
 * 各要素の属性（json, state, src）と内部スクリプトブロックを返す。
 *
 * 文書の要素だけを数える: コメントの中と、raw text 要素（`<script>` / `<style>` / `<textarea>` / `<title>`）の
 * 中身は飛ばす。`<wcs-state>` の中でも同じで、中のスクリプトの文字列に `</wcs-state>` があっても要素の終わりと
 * 読まない（終了タグは raw text の外で探し直す）。
 */
export function parseWcsStateElements(html: string, stateTagName: string = 'wcs-state'): WcsStateInfo[] {
  const elements: WcsStateInfo[] = [];
  const lower = asciiLowerCase(html);

  let pos = 0;
  const len = html.length;

  while (pos < len) {
    // HTML コメントをスキップ
    if (html.startsWith('<!--', pos)) {
      const commentEnd = html.indexOf('-->', pos + 4);
      if (commentEnd === -1) break;
      pos = commentEnd + 3;
      continue;
    }

    // raw text 要素は中身ごと飛ばす（中の `<wcs-state` は文字）
    const raw = matchRawTextElement(html, lower, pos);
    if (raw !== null) {
      pos = raw.closed ? afterCloseTag(html, raw.contentEnd) : len;
      continue;
    }

    // <wcs-state を検出
    const wcsMatch = matchOpenTag(html, pos, stateTagName);
    if (wcsMatch === null) {
      pos++;
      continue;
    }

    const mountPath = extractAttribute(wcsMatch.tagContent, 'mount');
    const bindComponent = parseAttributeNames(wcsMatch.tagContent).has('bind-component');
    const jsonAttr = extractAttribute(wcsMatch.tagContent, 'json') ?? undefined;
    const stateAttr = extractAttribute(wcsMatch.tagContent, 'state') ?? undefined;
    const srcAttr = extractAttribute(wcsMatch.tagContent, 'src') ?? undefined;
    const tagStart = pos;
    const tagEnd = wcsMatch.end;
    pos = wcsMatch.end;

    // 内部の <script type="module"> ブロックを収集
    const scriptBlocks: WcsScriptBlock[] = [];
    let wcsCloseIdx = findCloseTag(html, pos, stateTagName, lower);
    let wcsEnd = wcsCloseIdx === -1 ? len : wcsCloseIdx;

    while (pos < wcsEnd) {
      if (html.startsWith('<!--', pos)) {
        const commentEnd = html.indexOf('-->', pos + 4);
        if (commentEnd === -1) break;
        pos = commentEnd + 3;
        continue;
      }

      const inner = matchRawTextElement(html, lower, pos);
      if (inner === null) {
        pos++;
        continue;
      }

      if (inner.tag === 'script') {
        // type="module" であるか確認（HTML 仕様どおり ASCII case-insensitive）。閉じていないスクリプトは読まない
        const typeAttr = extractAttribute(inner.open.tagContent, 'type');
        if (typeAttr?.toLowerCase() === 'module' && inner.closed) {
          const contentStart = inner.open.end;
          scriptBlocks.push({
            contentStart,
            contentEnd: inner.contentEnd,
            content: html.slice(contentStart, inner.contentEnd),
            mountPath,
            bindComponent,
          });
        }
      }
      if (!inner.closed) {
        pos = len;
        wcsCloseIdx = -1;
        wcsEnd = len;
        break;
      }
      pos = afterCloseTag(html, inner.contentEnd);
      // 中身の中にあった `</wcs-state>`（スクリプトの文字列など）は終了タグではない — 中身の後ろで探し直す
      if (pos > wcsEnd) {
        wcsCloseIdx = findCloseTag(html, pos, stateTagName, lower);
        wcsEnd = wcsCloseIdx === -1 ? len : wcsCloseIdx;
      }
    }

    elements.push({ mountPath, bindComponent, jsonAttr, stateAttr, srcAttr, scriptBlocks, tagStart, tagEnd });

    pos = wcsEnd;
    if (wcsCloseIdx !== -1) pos = afterCloseTag(html, wcsCloseIdx);
  }

  return elements;
}

/**
 * 位置が文書の `<template>` の中か（`<template>` の中身は文書に無い — querySelector は見ない）を答える関数を返す。
 * root の `<wcs-state>` の判定に使う。`<template>` の開始・終了タグを文書の頭から 1 回だけ集め、深さで判定する。
 * コメントの中と raw text 要素（`parseWcsStateElements` と同じ — JS の文字列の `<template>` など）は数えない。
 */
export function createTemplateTester(html: string): (offset: number) => boolean {
  const tags = collectTemplateTags(html);
  return (offset) => {
    let depth = 0;
    for (const tag of tags) {
      if (tag.at >= offset) break;
      depth = tag.close ? Math.max(0, depth - 1) : depth + 1;
    }
    return depth > 0;
  };
}

/**
 * Returns a function giving the `<template>` elements that enclose an offset, as the offsets of their start tags from
 * the outermost to the innermost (empty: in the document). The tags are collected once, as by createTemplateTester.
 */
export function createTemplateChain(html: string): (offset: number) => readonly number[] {
  const tags = collectTemplateTags(html);
  return (offset) => {
    const open: number[] = [];
    for (const tag of tags) {
      if (tag.at >= offset) break;
      if (!tag.close) open.push(tag.at);
      else if (open.length > 0) open.pop();
    }
    return open;
  };
}

/** The `<template>` start and end tags of the document, in order (not in comments or raw text elements). */
function collectTemplateTags(html: string): { at: number; close: boolean }[] {
  const lower = asciiLowerCase(html);
  const tags: { at: number; close: boolean }[] = [];
  let pos = 0;
  while (pos < html.length) {
    const lt = html.indexOf('<', pos);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const commentEnd = html.indexOf('-->', lt + 4);
      if (commentEnd === -1) break;
      pos = commentEnd + 3;
      continue;
    }
    const raw = matchRawTextElement(html, lower, lt);
    if (raw !== null) {
      pos = raw.closed ? afterCloseTag(html, raw.contentEnd) : html.length;
      continue;
    }
    const tag = /^<(\/?)template(?=[\s/>])/i.exec(html.slice(lt, lt + 11));
    if (tag !== null) tags.push({ at: lt, close: tag[1] === '/' });
    pos = lt + 1;
  }
  return tags;
}

/**
 * HTML テキストから指定 ID の <script type="application/json"> の内容を取得する。
 * <wcs-state> の state 属性が参照する JSON データの解決に使用。
 */
export function findScriptJsonById(html: string, id: string): string | null {
  let pos = 0;
  const len = html.length;

  while (pos < len) {
    // HTML コメントをスキップ
    if (html.startsWith('<!--', pos)) {
      const commentEnd = html.indexOf('-->', pos + 4);
      if (commentEnd === -1) break;
      pos = commentEnd + 3;
      continue;
    }

    const scriptMatch = matchOpenTag(html, pos, 'script');
    if (scriptMatch === null) {
      pos++;
      continue;
    }

    const typeAttr = extractAttribute(scriptMatch.tagContent, 'type');
    const idAttr = extractAttribute(scriptMatch.tagContent, 'id');

    if (typeAttr?.toLowerCase() === 'application/json' && idAttr === id) {
      const contentStart = scriptMatch.end;
      const scriptCloseIdx = findCloseTag(html, contentStart, 'script');
      if (scriptCloseIdx === -1) return null;
      return html.slice(contentStart, scriptCloseIdx);
    }

    pos = scriptMatch.end;
  }

  return null;
}

// ============================================================
// Internal helpers
// ============================================================

interface TagMatch {
  /** 開始タグ全体の開始位置 */
  start: number;
  /** 開始タグの '>' の直後の位置 */
  end: number;
  /** タグ名と '>' の間のテキスト（属性部分） */
  tagContent: string;
}

/**
 * 指定位置が <tagName で始まる場合、開始タグ全体をパースして返す。
 * 大文字小文字を区別しない。
 */
function matchOpenTag(html: string, pos: number, tagName: string): TagMatch | null {
  if (html[pos] !== '<') return null;

  const nameStart = pos + 1;
  const nameEnd = nameStart + tagName.length;

  if (nameEnd > html.length) return null;

  const slice = html.slice(nameStart, nameEnd);
  if (asciiLowerCase(slice) !== asciiLowerCase(tagName)) return null;

  // タグ名の直後がスペースまたは '>' であることを確認
  const charAfter = html[nameEnd];
  if (charAfter !== '>' && charAfter !== ' ' && charAfter !== '\t' &&
      charAfter !== '\n' && charAfter !== '\r' && charAfter !== '/') {
    return null;
  }

  // '>' を探す（属性値内の '>' は考慮：引用符内をスキップ）
  let i = nameEnd;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  while (i < html.length) {
    const ch = html[i];
    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
    } else if (inDoubleQuote) {
      if (ch === '"') inDoubleQuote = false;
    } else if (ch === "'") {
      inSingleQuote = true;
    } else if (ch === '"') {
      inDoubleQuote = true;
    } else if (ch === '>') {
      return {
        start: pos,
        end: i + 1,
        tagContent: html.slice(nameEnd, i),
      };
    }
    i++;
  }
  return null;
}

/**
 * 指定位置以降で </tagName> の開始位置（'<' の位置）を返す。
 * `lower` は `asciiLowerCase(html)`（文字数が同じなので位置をそのまま使える）。呼び出し側が持っていれば渡す。
 */
function findCloseTag(html: string, startPos: number, tagName: string, lower: string = asciiLowerCase(html)): number {
  const pattern = '</' + tagName;
  const patternLower = asciiLowerCase(pattern);
  const htmlLower = lower;
  let pos = startPos;

  while (pos < html.length) {
    const idx = htmlLower.indexOf(patternLower, pos);
    if (idx === -1) return -1;

    // タグ名直後が '>' またはスペースであることを確認
    const afterIdx = idx + pattern.length;
    if (afterIdx < html.length) {
      const ch = html[afterIdx];
      if (ch === '>' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        return idx;
      }
    }
    pos = idx + 1;
  }
  return -1;
}

/**
 * 開始タグの属性名を、値を読み飛ばしながら先頭から列挙する（小文字）。
 * タグ全体への正規表現だと、属性値の中の文字列（`data-note="no bind-component here"`）まで
 * 属性名と取り違えるので、名前と値を順に消費して読む。
 */
export function parseAttributeNames(tagContent: string): Set<string> {
  const names = new Set<string>();
  const attribute = /([^\s"'<>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`=]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(tagContent)) !== null) {
    names.add(match[1].toLowerCase());
  }
  return names;
}

/**
 * タグ属性テキストから指定属性の値を抽出する。
 * 引用符なし・シングル・ダブルいずれにも対応。
 */
export function extractAttribute(tagContent: string, attrName: string): string | null {
  // name="value" or name='value' or name=value
  const regex = new RegExp(
    `(?:^|\\s)${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`,
    'i'
  );
  const match = tagContent.match(regex);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}
