/**
 * stateBehavior.ts — ページの root の state の `$behavior`（@wcstack/state 4.0）を静的に読む。
 *
 * `$behavior: { enableMustache: false }` の木では、テキストの `{{ }}` は束縛ではない（ランタイムは
 * `engine.mustache` が false なら dom/plan.ts の walkBindings でテキストノードを分けない）。CMS や
 * サーバーのテンプレート（Handlebars・Twig・Liquid）の `{{ }}` と同じページにアイランドを置く形で、その
 * 中括弧を束縛として検査すると、存在しないパスの warning と FOUC の info が並ぶ（継ぎ目アプリ community-hall）。
 * コメント束縛（`<!--@@: x-->`）はこの設定でも束ねる（4.0 の R7）。
 *
 * 読むのは文書の root の `<wcs-state>`（`mount`・`bind-component` を持たず、`<template>` の中に無い最初の
 * もの — `$behavior` を持てるのは root だけで、ボリュームは拒まれる）。ソースはランタイムと同じ順
 * （element.ts の loadState）: `state=`（JSON の script）→ `src=`（.json / .js / .ts — reader があるとき）→
 * `json=` → 中の最初の `<script type="module">`。最初にあるソースだけを見る（ランタイムも次へ移らない）。
 * 読めない・宣言が無い・値がリテラルの `false` でない（式・識別子）なら「既定のまま」（true）と答える —
 * 断定できる形だけで検査を外す。
 *
 * `enableDirectionalInitialSync: false`（3.x の初期同期に戻す設定）も同じ読み方で答える（`isDirectionalSyncDisabled`）:
 * その木では、カスタム要素の出力だけのメンバーも束ねた時点で要素の値を state に書かない（state の dom/wc.ts の
 * attachProperty — `wcs/path-readonly` が「初期化が失敗する」と言えるのは既定のときだけ）。
 *
 * pure（ファイルは reader 経由）。
 */

import { createTemplateTester, findScriptJsonById, parseWcsStateElements } from '../language/htmlParse.js';
import { analyzeDeclarationEntries, findTopLevelDeclaration } from './stateAnalyzer.js';
import { readStateScript, type FileReader } from './statePathResolver.js';

const BEHAVIOR_KEY = '$behavior';
const MUSTACHE_KEY = 'enableMustache';
const DIRECTIONAL_KEY = 'enableDirectionalInitialSync';

/**
 * ページの root の state が `$behavior.enableMustache` を `false` と宣言しているか。読めなければ false
 * （既定の true のまま — 従来どおり `{{ }}` を束縛として検査する）。
 */
export function isMustacheDisabled(html: string, stateTagName: string = 'wcs-state', fileReader?: FileReader): boolean {
  return isBehaviorDisabled(MUSTACHE_KEY, html, stateTagName, fileReader);
}

/**
 * ページの root の state が `$behavior.enableDirectionalInitialSync` を `false` と宣言しているか。読めなければ false
 * （既定の true のまま）。
 */
export function isDirectionalSyncDisabled(html: string, stateTagName: string = 'wcs-state', fileReader?: FileReader): boolean {
  return isBehaviorDisabled(DIRECTIONAL_KEY, html, stateTagName, fileReader);
}

/** ページの root の state が `$behavior.<key>` をリテラルの `false` と宣言しているか。 */
function isBehaviorDisabled(key: string, html: string, stateTagName: string, fileReader: FileReader | undefined): boolean {
  // キー入力ごとに走るので、名前が文書に無く、外のファイルも読めないなら <wcs-state> を走査しない
  if (!html.includes(key) && (fileReader === undefined || !html.includes('src'))) return false;
  const elements = parseWcsStateElements(html, stateTagName);
  if (elements.length === 0) return false;
  const insideTemplate = createTemplateTester(html);
  const root = elements.find((e) => e.mountPath === null && !e.bindComponent && !insideTemplate(e.tagStart));
  if (root === undefined) return false;
  if (root.stateAttr !== undefined) {
    const json = findScriptJsonById(html, root.stateAttr);
    return json !== null && jsonDisables(json, key);
  }
  if (root.srcAttr !== undefined) {
    if (fileReader === undefined) return false;
    if (root.srcAttr.endsWith('.json')) {
      const json = fileReader(root.srcAttr);
      return json !== undefined && jsonDisables(json, key);
    }
    const script = readStateScript(root.srcAttr, fileReader);
    return script !== undefined && scriptDisables(script, key);
  }
  if (root.jsonAttr !== undefined) return jsonDisables(root.jsonAttr, key);
  const block = root.scriptBlocks[0];
  return block !== undefined && scriptDisables(block.content, key);
}

function jsonDisables(text: string, key: string): boolean {
  try {
    const data = JSON.parse(text) as { [BEHAVIOR_KEY]?: Record<string, unknown> } | null;
    const behavior = data?.[BEHAVIOR_KEY];
    return typeof behavior === 'object' && behavior !== null && behavior[key] === false;
  } catch {
    return false;
  }
}

/** `export default { $behavior: { enableMustache: false } }` — 値がリテラルの `false` のときだけ。 */
function scriptDisables(script: string, key: string): boolean {
  if (!script.includes(key)) return false;
  const decl = findTopLevelDeclaration(script, BEHAVIOR_KEY);
  if (decl === null || decl.kind !== 'data') return false;
  return analyzeDeclarationEntries(script, BEHAVIOR_KEY)
    .some((entry) => entry.name === key && entry.kind === 'data' && entry.value !== undefined && stripComments(entry.value) === 'false');
}

function stripComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').trim();
}
