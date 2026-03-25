/**
 * htmlParse.ts
 *
 * HTML ファイルから <wcs-state> 内の <script type="module"> ブロックを検出し、
 * その内容とソースオフセットを返す軽量パーサ。
 *
 * 外部依存なし。正規表現ベースのステートマシンで実装。
 */

export interface WcsScriptBlock {
  /** スクリプト内容の開始オフセット（<script ...> の直後） */
  contentStart: number;
  /** スクリプト内容の終了オフセット（</script> の直前） */
  contentEnd: number;
  /** スクリプトの中身テキスト */
  content: string;
  /** 所属する <wcs-state> の name 属性（デフォルト: 'default'） */
  stateName: string;
}

/**
 * HTML テキストから <wcs-state> 内の <script type="module"> ブロックを全て抽出する。
 *
 * 仕様:
 * - <wcs-state> のネストは不可（仕様上）
 * - <!-- --> コメント内の <wcs-state> は無視
 * - <script type="module"> のみ対象
 * - 大文字小文字を区別しない（HTML仕様に準拠）
 * - 複数の <wcs-state> に対応
 */
export function parseWcsScriptBlocks(html: string): WcsScriptBlock[] {
  const blocks: WcsScriptBlock[] = [];

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

    // <wcs-state を検出
    const wcsMatch = matchOpenTag(html, pos, 'wcs-state');
    if (wcsMatch === null) {
      pos++;
      continue;
    }

    const stateName = extractAttribute(wcsMatch.tagContent, 'name') ?? 'default';
    pos = wcsMatch.end;

    // </wcs-state> の閉じタグまでの範囲内で <script type="module"> を探す
    const wcsCloseIdx = findCloseTag(html, pos, 'wcs-state');
    const wcsEnd = wcsCloseIdx === -1 ? len : wcsCloseIdx;

    while (pos < wcsEnd) {
      // コメントスキップ
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

      // type="module" であるか確認
      const typeAttr = extractAttribute(scriptMatch.tagContent, 'type');
      if (typeAttr !== 'module') {
        pos = scriptMatch.end;
        continue;
      }

      const contentStart = scriptMatch.end;
      const scriptCloseIdx = findCloseTag(html, contentStart, 'script');
      if (scriptCloseIdx === -1) {
        pos = contentStart;
        break;
      }

      const contentEnd = scriptCloseIdx;
      blocks.push({
        contentStart,
        contentEnd,
        content: html.slice(contentStart, contentEnd),
        stateName,
      });

      // </script> タグの末尾まで進める
      pos = html.indexOf('>', scriptCloseIdx) + 1;
      if (pos === 0) break; // '>' が見つからない場合
    }

    pos = wcsEnd;
    // </wcs-state> タグの末尾まで進める
    if (wcsCloseIdx !== -1) {
      const closeEnd = html.indexOf('>', wcsCloseIdx);
      if (closeEnd !== -1) pos = closeEnd + 1;
    }
  }

  return blocks;
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
  if (slice.toLowerCase() !== tagName.toLowerCase()) return null;

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
 */
function findCloseTag(html: string, startPos: number, tagName: string): number {
  const pattern = '</' + tagName;
  const patternLower = pattern.toLowerCase();
  const htmlLower = html.toLowerCase();
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
 * タグ属性テキストから指定属性の値を抽出する。
 * 引用符なし・シングル・ダブルいずれにも対応。
 */
function extractAttribute(tagContent: string, attrName: string): string | null {
  // name="value" or name='value' or name=value
  const regex = new RegExp(
    `(?:^|\\s)${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`,
    'i'
  );
  const match = tagContent.match(regex);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}
