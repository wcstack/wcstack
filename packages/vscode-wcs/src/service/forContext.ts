/**
 * forContext.ts
 *
 * HTML 内の指定位置が <template data-wcs="for:"> の内側にあるかを判定する。
 */

/**
 * 指定オフセットが <template data-wcs="for: ..."> の内側にあるかを判定する。
 *
 * @param html - HTML 全文
 * @param offset - チェックする位置（0始まり）
 * @param bindAttrName - バインド属性名（デフォルト: "data-wcs"）
 * @returns for テンプレート内であれば true
 */
export function isInsideForTemplate(html: string, offset: number, bindAttrName: string = 'data-wcs'): boolean {
  // <template data-wcs="for: ..."> の開始タグと </template> を追跡
  // ネストに対応するためスタックを使用
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRegex = new RegExp(
    `<template[^>]*${escaped}\\s*=\\s*["']\\s*for\\s*:`,
    'gi',
  );
  const closeRegex = /<\/template\s*>/gi;

  // 全ての for テンプレート開始位置を収集
  const opens: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index >= offset) break;
    opens.push(match.index);
  }

  if (opens.length === 0) return false;

  // 各 for テンプレート開始に対して、対応する </template> を探す
  // スタックベースでネスト対応
  for (const openPos of opens) {
    const depth = getForTemplateDepthAt(html, openPos, offset, bindAttrName);
    if (depth > 0) return true;
  }

  return false;
}

/**
 * 指定オフセットを囲む最も内側の `for` テンプレートのパスを返す。
 * for テンプレート外の場合は null。
 *
 * @example
 * `<template data-wcs="for: users">` 内なら `"users"` を返す。
 * `<template data-wcs="for: .products">` 内（親 for: categories）なら `".products"` を返す。
 */
export function getInnermostForPath(html: string, offset: number, bindAttrName: string = 'data-wcs'): string | null {
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRegex = new RegExp(
    `<template[^>]*${escaped}\\s*=\\s*["']\\s*for\\s*:\\s*([^"']+?)\\s*["']`,
    'gi',
  );

  let bestMatch: string | null = null;
  let bestPos = -1;

  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index >= offset) break;

    // このテンプレートが offset を囲んでいるか確認
    const tagEnd = html.indexOf('>', match.index);
    if (tagEnd === -1 || tagEnd >= offset) continue;

    const depth = getForTemplateDepthAt(html, match.index, offset, bindAttrName);
    if (depth > 0 && match.index > bestPos) {
      bestMatch = match[1].trim();
      bestPos = match.index;
    }
  }

  return bestMatch;
}

/**
 * 指定位置での for テンプレートのネスト深度を計算する。
 * openPos から offset の間で template タグのネストを追跡。
 */
function getForTemplateDepthAt(
  html: string,
  openPos: number,
  offset: number,
  bindAttrName: string,
): number {
  // openPos の <template> タグの終了位置 ('>') を探す
  const tagEnd = html.indexOf('>', openPos);
  if (tagEnd === -1 || tagEnd >= offset) return 0;

  let depth = 1;
  let pos = tagEnd + 1;

  const templateOpenRegex = /<template[\s>]/gi;
  const templateCloseRegex = /<\/template\s*>/gi;

  while (pos < offset && depth > 0) {
    templateOpenRegex.lastIndex = pos;
    templateCloseRegex.lastIndex = pos;

    const nextOpen = templateOpenRegex.exec(html);
    const nextClose = templateCloseRegex.exec(html);

    const openIdx = nextOpen && nextOpen.index < offset ? nextOpen.index : Infinity;
    const closeIdx = nextClose && nextClose.index < offset ? nextClose.index : Infinity;

    if (openIdx === Infinity && closeIdx === Infinity) break;

    if (openIdx < closeIdx) {
      depth++;
      pos = openIdx + 1;
    } else {
      depth--;
      if (depth === 0 && closeIdx < offset) {
        // この for テンプレートは offset の前に閉じた
        return 0;
      }
      pos = closeIdx + (nextClose ? nextClose[0].length : 1);
    }
  }

  return depth;
}
