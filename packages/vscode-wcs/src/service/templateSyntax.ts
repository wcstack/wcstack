/**
 * templateSyntax.ts
 *
 * Mustache 構文 `{{ path }}` とコメントバインディング `<!--@@:path-->` を
 * 検出し、補完・診断に必要な情報を返す。
 *
 * コメント構文の仕様（@wcstack/state parseCommentNode.ts より）:
 *   <!--@@:path-->           ← wcs-text の省略形
 *   <!--@@wcs-text:path-->   ← 正式形（commentTextPrefix で変更可能）
 *
 * for/if/elseif/else のコメントは <template data-wcs="..."> から
 * ランタイムが自動生成するため、ユーザーが直接書くものではない。
 */

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

/**
 * HTML からすべての Mustache 構文を検出する。
 * `<script>` / `<style>` 内はスキップ。
 */
export function findAllMustacheSyntax(html: string): TemplateSyntaxMatch[] {
  const results: TemplateSyntaxMatch[] = [];
  const regex = /\{\{\s*(.+?)\s*\}\}/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    if (isInsideTag(html, match.index, 'script') || isInsideTag(html, match.index, 'style')) {
      continue;
    }
    const expr = match[1];
    const exprStart = match.index + match[0].indexOf(expr);
    results.push({
      kind: 'mustache',
      expression: expr,
      exprStart,
      exprEnd: exprStart + expr.length,
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
      insideTemplate: isInsideTag(html, match.index, 'template'),
    });
  }

  return results;
}

/**
 * HTML からすべてのコメントテキストバインディングを検出する。
 *
 * 対応形式:
 *   <!--@@:path-->              （省略形）
 *   <!--@@commentTextPrefix:path-->  （正式形）
 *
 * @param commentTextPrefix - テキストバインディングのプレフィックス（デフォルト: 'wcs-text'）
 */
export function findAllCommentBindings(html: string, commentTextPrefix: string = 'wcs-text'): TemplateSyntaxMatch[] {
  const results: TemplateSyntaxMatch[] = [];
  const escaped = commentTextPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // <!--@@:path--> または <!--@@prefix:path-->
  const regex = new RegExp(`<!--\\s*@@\\s*(?:${escaped})?\\s*:\\s*(.+?)\\s*-->`, 'g');

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const expr = match[1];
    if (!expr) continue;
    const exprStart = match.index + match[0].indexOf(expr);
    results.push({
      kind: 'comment',
      expression: expr,
      exprStart,
      exprEnd: exprStart + expr.length,
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
      insideTemplate: isInsideTag(html, match.index, 'template'),
    });
  }

  return results;
}

/**
 * カーソル位置が Mustache 構文内にあるかを判定する。
 */
export function findMustacheAtOffset(html: string, offset: number): { expression: string; exprStart: number } | null {
  const regex = /\{\{\s*(.+?)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    if (offset >= match.index && offset <= match.index + match[0].length) {
      if (isInsideTag(html, match.index, 'script') || isInsideTag(html, match.index, 'style')) {
        continue;
      }
      const exprStart = match.index + match[0].indexOf(match[1]);
      return { expression: match[1], exprStart };
    }
  }
  return null;
}

/**
 * カーソル位置がコメントテキストバインディング内にあるかを判定する。
 */
export function findCommentBindingAtOffset(
  html: string,
  offset: number,
  commentTextPrefix: string = 'wcs-text',
): { expression: string; exprStart: number } | null {
  const escaped = commentTextPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`<!--\\s*@@\\s*(?:${escaped})?\\s*:\\s*(.+?)\\s*-->`, 'g');

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    if (offset >= match.index && offset <= match.index + match[0].length) {
      const expr = match[1];
      const exprStart = match.index + match[0].indexOf(expr);
      return { expression: expr, exprStart };
    }
  }
  return null;
}

/**
 * 指定位置が特定のタグ内にあるかを簡易判定する。
 */
function isInsideTag(html: string, offset: number, tagName: string): boolean {
  const openRegex = new RegExp(`<${tagName}[\\s>]`, 'gi');
  const closeRegex = new RegExp(`</${tagName}>`, 'gi');

  let lastOpenEnd = -1;
  let lastCloseEnd = -1;

  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index > offset) break;
    lastOpenEnd = match.index;
  }
  while ((match = closeRegex.exec(html)) !== null) {
    if (match.index > offset) break;
    lastCloseEnd = match.index;
  }

  return lastOpenEnd > lastCloseEnd;
}
