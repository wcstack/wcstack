/**
 * v4Migration.ts — `@wcstack/state` 4.0 で変わる書き方を 3.x の lint が見分けるための部品。
 *
 * 3.x の利用者に向けた予告（`wcs/v4-migration`、info）と、3.x でも既に壊れていて 4.0 が初期化で
 * 拒む形（それぞれの code の warning）の判定をここに集める。どちらも 3.x の CI を error で落とさない。
 *
 *   - `$scan`・`substr` フィルタ: 3.x では動き、4.0 で削除される → `wcs/v4-migration`（info）
 *   - 4.0 が root へ委譲するイベント（`V4_DELEGATED_EVENTS`）のハンドラが `event.currentTarget` を読む:
 *     3.x は要素にリスナーを付けるので要素、4.0 は root になる → `wcs/v4-migration`（info）
 *   - `#direct` 修飾子: 4.0 で足される。3.x のランタイムは知らない修飾子を無視し（event/handler.ts は
 *     prevent / stop だけを見る）、もともと要素にリスナーを付けるので、今から書いても同じに動く
 *   - ループの添字 `$1`〜`$128`: 3.x のランタイムの表（define.ts の INDEX_BY_INDEX_NAME）の外の
 *     `$` ＋数字は、マークアップでは状態のパスとして読まれて `[wcs/binding-path-missing]`、
 *     スクリプトの `this.$0` は読んだ時点で `[wcs/index-param-range]`（proxy/traps/get.ts）
 *
 * 4.0 側の正本は `research/state-engine` ブランチの `packages/state-next`（`dom/view.ts` の `BUBBLING`・
 * `dom/plan.ts` の `#direct`）。3.x の dist には無いので、ここに写して持つ。
 *
 * pure（DOM / vscode 非依存）。
 */

import { getWcsManifest } from './wcsManifest.js';
import { createTemplateTester, findScriptJsonById, parseWcsStateElements } from '../language/htmlParse.js';
import { analyzeDeclarationSpans, maskCommentsAndStrings } from './stateAnalyzer.js';

/** 4.0 の修飾子（`onclick#direct:`）。3.x の manifest の `syntax.modifiers.flags` には無い。 */
export const DIRECT_MODIFIER = 'direct';

/**
 * 4.0 が `on*:` を root へ委譲するイベント（state-next の `dom/view.ts` の `BUBBLING` の写し）。
 * これ以外のイベントは 4.0 でも要素にリスナーを付けるので、`currentTarget` は要素のまま。
 */
export const V4_DELEGATED_EVENTS: ReadonlySet<string> = new Set([
  'click', 'dblclick', 'input', 'change', 'submit', 'keydown', 'keyup', 'mousedown', 'mouseup', 'pointerdown', 'pointerup',
]);

/** 4.0 で削除されるフィルタ（`slice(start, end)` に一本化）。 */
export const SUBSTR_FILTER = 'substr';

/**
 * `substr(start, length)` の書き換え先の具体形。引数が 2 つとも 0 以上の整数リテラルなら
 * `slice(start, start + length)` を計算して返す（`substr(2, 3)` → `slice(2, 5)`）。それ以外は null
 * （負の数は文字列の長さで `slice` の結果が変わるので、一般形だけを案内する）。
 */
export function substrRewrite(args: readonly string[]): string | null {
  if (args.length !== 2) return null;
  const [start, length] = args.map((arg) => arg.trim());
  if (!/^\d+$/.test(start) || !/^\d+$/.test(length)) return null;
  const s = Number(start);
  return `slice(${s}, ${s + Number(length)})`;
}

const { prefix: INDEX_PREFIX, maxDepth: MAX_INDEX_PARAM_DEPTH } = getWcsManifest().syntax.indexParam;

/** ループの添字の上限（manifest の `syntax.indexParam.maxDepth` — 3.x の `MAX_WILDCARD_DEPTH`）。 */
export const MAX_INDEX_PARAM: number = MAX_INDEX_PARAM_DEPTH;

/** `$` ＋数字だけの名前（3.x の get トラップの `INDEX_PARAM_RE` と同じ形）。 */
const DOLLAR_DIGITS = new RegExp(`^\\${INDEX_PREFIX}\\d+$`);
/** ランタイムの表にある添字（`$1`〜`$128`。先頭に 0 を付けない）。 */
const INDEX_PARAM = new RegExp(`^\\${INDEX_PREFIX}[1-9]\\d*$`);

/**
 * `$` ＋数字だけのパス（`$1`・`$0`・`$01`・`$129`）が 3.x のランタイムで何になるか。
 * `index` はループの添字（`$1`〜`$128`）、`notIndex` は表の外（状態のパスとして読まれる）。
 * それ以外の形は null。
 */
export function classifyIndexParam(path: string): 'index' | 'notIndex' | null {
  if (!DOLLAR_DIGITS.test(path)) return null;
  return INDEX_PARAM.test(path) && Number(path.slice(INDEX_PREFIX.length)) <= MAX_INDEX_PARAM ? 'index' : 'notIndex';
}

/** スクリプトの `this.<name>` が 3.x で `[wcs/index-param-range]` を投げる名前か。 */
export function isOutOfRangeIndexName(name: string): boolean {
  return classifyIndexParam(name) === 'notIndex';
}

/** 束縛の左辺（`onclick#prevent,direct`）の修飾子（`#` の後ろのカンマ区切り、trim 済み）。 */
export function modifiersOf(property: string): string[] {
  const hash = property.indexOf('#');
  if (hash === -1) return [];
  return property.slice(hash + 1).split(',').map((m) => m.trim()).filter((m) => m.length > 0);
}

/**
 * 文書の root の state（`mount` も `bind-component` も持たず、`<template>` の外の `<wcs-state>`）が、
 * トップレベルのキー `key` を宣言して**いると確かめられる**かを答える関数を返す。マークアップの `$0` の
 * ような名前は、状態にそのキーがあれば 3.x でも読める（ループの添字の表を引くのはスクリプトの `this.$0`
 * だけ）ので、宣言が見えるときだけ「表の外の添字」と報告しない。宣言が読めないとき（読めない `src=`・
 * 宣言の無い class 構文）は黙らない — 黙るのは宣言を確かめられたときだけ。
 * 候補集合（`analyzeStatePaths` など）は `$` で始まるキーを API の名前空間として落とすので、ここで別に読む。
 * 宣言は `state=` / `json=`（JSON のキー）・`src=`（`fileReader` で読めたとき。`.json` は JSON のキー、
 * `.js` / `.ts` はスクリプト — `.js` は同名の `.ts` を先に読む。statePathResolver と同じ）・中のスクリプトの
 * トップレベルの宣言（読めない形 — class 構文など — は `$` ＋数字のキー・フィールドの綴り）から集める。
 * `<template>` の中の `<wcs-state>`（宣言的 shadow root・DCC）は別の root の state なので数えない。
 */
export function createDeclaredKeyTester(
  html: string,
  stateTagName: string,
  fileReader?: (relativePath: string) => string | undefined,
): (key: string) => boolean {
  const keys = new Set<string>();
  const addScriptKeys = (script: string): void => {
    const spans = analyzeDeclarationSpans(script);
    if (spans.length > 0) {
      for (const span of spans) keys.add(span.name);
      return;
    }
    for (const match of maskCommentsAndStrings(script).matchAll(DOLLAR_DIGIT_DECLARATION)) keys.add(match[1]);
  };
  const addJsonKeys = (json: string | null | undefined): void => {
    if (json === null || json === undefined) return;
    try {
      const value: unknown = JSON.parse(json);
      if (typeof value === 'object' && value !== null) for (const key of Object.keys(value)) keys.add(key);
    } catch {
      // 壊れた JSON は宣言を持たない（ランタイムも読めない）
    }
  };
  let insideTemplate: ((offset: number) => boolean) | null = null;
  for (const element of parseWcsStateElements(html, stateTagName)) {
    if (element.mountPath !== null || element.bindComponent) continue;
    if ((insideTemplate ??= createTemplateTester(html))(element.tagStart)) continue;
    if (element.stateAttr !== undefined) addJsonKeys(findScriptJsonById(html, element.stateAttr));
    if (element.srcAttr !== undefined && fileReader !== undefined) {
      const src = element.srcAttr;
      if (src.endsWith('.json')) {
        addJsonKeys(fileReader(src));
      } else if (src.endsWith('.js') || src.endsWith('.ts')) {
        const script = (src.endsWith('.js') ? fileReader(src.replace(/\.js$/, '.ts')) : undefined) ?? fileReader(src);
        if (script !== undefined) addScriptKeys(script);
      }
    }
    addJsonKeys(element.jsonAttr);
    for (const block of element.scriptBlocks) addScriptKeys(block.content);
  }
  return (key) => keys.has(key);
}

/** 宣言が静的に読めない state で、`$` ＋数字のキー・フィールドらしい綴り（`$0:` / `$0 =` / `$0(`）。 */
const DOLLAR_DIGIT_DECLARATION = /(?:^|[^\w$.])(\$\d+)\s*(?::|=(?!=)|\()/g;
