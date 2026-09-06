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
  const chain = getEnclosingForPaths(html, offset, bindAttrName);
  return chain.length === 0 ? null : chain[chain.length - 1];
}

/** offset を囲む for テンプレート 1 枚（生 for パス + テンプレート同一性のアンカー）。 */
export interface IEnclosingFor {
  /** for 属性値の生テキスト（`@state` / フィルタが付き得る）。 */
  readonly path: string;
  /** 開始タグ `<template` の開始オフセット。テンプレート実体の同一性キー
   *  （`$1`〜`$9` のようにループ実体で参照先が決まる要素のスコープ判定に使う）。 */
  readonly anchor: number;
}

/**
 * 指定オフセットを囲む**全ての** for テンプレートの生 for パス文字列を、
 * 外側 → 内側の順で返す。囲まれていなければ空配列。
 *
 * ランタイム（collectStructuralFragments）はネストした for を再帰的に合成する
 * （内側テンプレート自身の for 属性を外側の for パスで先に展開してから降りる）
 * ため、相対 for（`for: .products`）の静的解決には外側チェーン全体が要る。
 * 値は属性値の生テキスト — `@state` やフィルタが付き得るので、パス部分が
 * 必要な消費側は正本パーサ（statePathName）を通すこと。
 */
export function getEnclosingForPaths(html: string, offset: number, bindAttrName: string = 'data-wcs'): string[] {
  return getEnclosingFors(html, offset, bindAttrName).map((entry) => entry.path);
}

/**
 * getEnclosingForPaths のアンカー付き版。外側 → 内側の順。
 * `$N` の参照先はチェーン N 枚目（外側から）のテンプレート**実体**で決まるため、
 * パス文字列でなくアンカーで同一性を判定する消費者向け。
 */
export function getEnclosingFors(html: string, offset: number, bindAttrName: string = 'data-wcs'): IEnclosingFor[] {
  const escaped = bindAttrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openRegex = new RegExp(
    `<template[^>]*${escaped}\\s*=\\s*["']\\s*for\\s*:\\s*([^"']+?)\\s*["']`,
    'gi',
  );

  // 開始位置の昇順で走査するので、囲んでいるものはそのまま外側 → 内側の順に並ぶ
  const enclosing: IEnclosingFor[] = [];
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(html)) !== null) {
    if (match.index >= offset) break;

    // このテンプレートが offset を囲んでいるか確認
    const tagEnd = html.indexOf('>', match.index);
    if (tagEnd === -1 || tagEnd >= offset) continue;

    const depth = getForTemplateDepthAt(html, match.index, offset, bindAttrName);
    if (depth > 0) {
      enclosing.push({ path: match[1].trim(), anchor: match.index });
    }
  }

  return enclosing;
}

/** パスに含まれるワイルドカードセグメント（`*`）の本数。 */
export function countWildcardSegments(path: string): number {
  let count = 0;
  for (const segment of path.split('.')) {
    if (segment === '*') count++;
  }
  return count;
}

/** for 属性の生テキストから state パス部分だけを取り出す（`@state` / フィルタを落とす）。 */
function forPathOf(raw: string): string {
  let path = raw.trim();
  const pipe = path.indexOf('|');
  if (pipe !== -1) path = path.slice(0, pipe).trim();
  const at = path.indexOf('@');
  if (at !== -1) path = path.slice(0, at).trim();
  return path;
}

/**
 * 指定オフセットで**ワイルドカードを解決できる段数**（＝そのスコープの階数）。
 * 囲む for が無ければ 0。
 *
 * 段数は「囲む for の枚数」ではない。for のパス自身が階数を持つ入れ子
 * （`for: matrix` の中の `for: matrix.*`）があるため、ランタイム
 * （structural/expandShorthandPaths.ts）と同じ合成を行ってから数える:
 * 相対 for（`.products`）は外側の行パス `<prev>.*` に連結し、絶対 for はそのまま
 * 置き換える。最後にそのパスの `*` の本数 + 1（ループ自身が 1 段増やす）が答え。
 */
export function getAvailableWildcardRank(html: string, offset: number, bindAttrName: string = 'data-wcs'): number {
  const chain = getEnclosingForPaths(html, offset, bindAttrName);
  if (chain.length === 0) return 0;
  let resolved = '';
  for (const raw of chain) {
    const path = forPathOf(raw);
    if (path === '.') {
      resolved = `${resolved}.*`;
    } else if (path.startsWith('.')) {
      resolved = `${resolved}.*.${path.slice(1)}`;
    } else {
      resolved = path;
    }
  }
  return countWildcardSegments(resolved) + 1;
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
