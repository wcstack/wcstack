/**
 * statePathResolver.ts
 *
 * HTML 内の <wcs-state> 要素から状態パスを解決する共通ロジック。
 * 複数の初期化方法（state 属性, src 属性, json 属性, インナースクリプト）に対応。
 *
 * 解決優先順位（wcs-state ランタイムと同一）:
 *   state → src (.json / .js / .ts) → json → inner <script type="module">
 */

import { parseWcsStateElements, findScriptJsonById, type WcsStateInfo } from '../language/htmlParse.js';
import { analyzeStatePaths, analyzeJsonPaths, type PathCandidate } from './stateAnalyzer.js';

/**
 * 外部ファイルの内容を読み取るコールバック。
 * src 属性の解決に使用する。undefined を返した場合、そのファイルはスキップされる。
 */
export type FileReader = (relativePath: string) => string | undefined;

/**
 * HTML 全体から <wcs-state> 要素を解析し、全ての状態パス候補を収集する。
 *
 * 各 <wcs-state> について、以下の優先順位で最初にマッチした初期化方法を使用:
 *   1. state 属性 — 同一 HTML 内の <script type="application/json" id="..."> を参照
 *   2. src 属性 — 外部ファイルを読み込み（.json / .js / .ts）
 *      - .js の場合、同名の .ts ファイルが存在すればそちらを優先
 *   3. json 属性 — インライン JSON 文字列
 *   4. inner <script type="module"> — JavaScript モジュール（既存の解析）
 *
 * @param html - HTML 全文
 * @param stateTagName - 状態タグ名（デフォルト: 'wcs-state'）
 * @param fileReader - 外部ファイル読み取り用コールバック（省略時は src 属性をスキップ）
 */
export function getStatePathsFromHtml(
  html: string,
  stateTagName: string = 'wcs-state',
  fileReader?: FileReader,
): PathCandidate[] {
  const elements = parseWcsStateElements(html, stateTagName);
  const allPaths: PathCandidate[] = [];

  for (const element of elements) {
    const paths = resolveElementPaths(element, html, fileReader);
    allPaths.push(...paths);
  }

  return allPaths;
}

/**
 * 単一の <wcs-state> 要素からパスを解決する。
 * 優先順位に従い、最初にマッチした初期化方法のパスを返す。
 */
function resolveElementPaths(
  element: WcsStateInfo,
  html: string,
  fileReader?: FileReader,
): PathCandidate[] {
  // 1. state 属性: <script type="application/json" id="..."> を参照
  if (element.stateAttr) {
    const jsonContent = findScriptJsonById(html, element.stateAttr);
    if (jsonContent) {
      const paths = analyzeJsonPaths(jsonContent, element.stateName);
      if (paths.length > 0) return paths;
    }
  }

  // 2. src 属性: 外部ファイル（.json / .js / .ts）
  if (element.srcAttr && fileReader) {
    const paths = resolveSrcAttribute(element.srcAttr, element.stateName, fileReader);
    if (paths.length > 0) return paths;
  }

  // 3. json 属性: インライン JSON
  if (element.jsonAttr) {
    const paths = analyzeJsonPaths(element.jsonAttr, element.stateName);
    if (paths.length > 0) return paths;
  }

  // 4. inner <script type="module">: 既存の解析
  if (element.scriptBlocks.length > 0) {
    return element.scriptBlocks.flatMap(block =>
      analyzeStatePaths(block.content, block.stateName)
    );
  }

  return [];
}

/**
 * src 属性の値からパスを解決する。
 *
 * - .json → JSON パース
 * - .js   → 同名の .ts があればそちらを優先、なければ .js を解析
 * - .ts   → TypeScript/JavaScript として解析（export default {} を検出）
 */
function resolveSrcAttribute(
  srcPath: string,
  stateName: string,
  fileReader: FileReader,
): PathCandidate[] {
  if (srcPath.endsWith('.json')) {
    const content = fileReader(srcPath);
    if (content) {
      return analyzeJsonPaths(content, stateName);
    }
    return [];
  }

  if (srcPath.endsWith('.js')) {
    // .ts ファイルが存在すればそちらを優先
    const tsPath = srcPath.replace(/\.js$/, '.ts');
    const tsContent = fileReader(tsPath);
    if (tsContent) {
      return analyzeStatePaths(tsContent, stateName);
    }

    const jsContent = fileReader(srcPath);
    if (jsContent) {
      return analyzeStatePaths(jsContent, stateName);
    }
    return [];
  }

  if (srcPath.endsWith('.ts')) {
    const content = fileReader(srcPath);
    if (content) {
      return analyzeStatePaths(content, stateName);
    }
    return [];
  }

  return [];
}
