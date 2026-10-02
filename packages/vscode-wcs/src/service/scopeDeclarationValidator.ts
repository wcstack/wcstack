/**
 * scopeDeclarationValidator.ts — ボリューム（`<wcs-state mount>`）とマウントしたコンポーネント
 * （`<wcs-state bind-component>`）の state が受け付けない書き方（@wcstack/state 4.0 の scopes/）。
 *
 *   - **ボリュームの宣言**（scopes/volume.ts の `REJECTED` / `NOT_RUN`）→ `wcs/volume-declaration`。
 *     REJECTED は接ぎ木を拒んで console.error で報告する（その state は木に載らない）＝ error。
 *     NOT_RUN は console.warn で知らせてその宣言を無視する（ボリューム自体は動く）＝ warning。
 *     REJECTED のうち、ほかの検査が自分の code で報告するもの（`VOLUME_REJECTED_ELSEWHERE`）はここでは出さない。
 *     ランタイムの判定は `state[key] !== undefined` なので、値が `undefined` のリテラルは宣言なし扱い。
 *   - **bind-component の state の出どころ**（scopes/component.ts の `load`）→ `wcs/bind-component-source`。
 *     マウントしたコンポーネントの state はホスト要素のプロパティ（`<host>.<prop>`）だけで、`state` / `src` /
 *     `json` 属性や中の `<script type="module">` と併記すると、ランタイムは読み込みを拒んで console.error で
 *     報告する（コンポーネントはマウントされない）＝ error。3.x も同じ条件で拒んでいた。
 *   - **同じ root の 2 つ目の `<wcs-state>`**（4.0 の element.ts の #47 `SecondRoot`）→ `wcs/second-root`。
 *     文書（`<template>` の外）で `mount` も `bind-component` も持たない `<wcs-state>` は root で、state の木は
 *     root ごとに 1 つ。ランタイムは後から読み込んだ方を拒んで console.error で報告する ＝ error（v2 から）。
 *     `<template>` の中（宣言的 Shadow DOM・DCC の定義・構造テンプレート）は別の root か文書に無いので数えない。
 *
 * マウントしたコンポーネントが実行しない宣言（scopes/component.ts の `INERT`: `$watch`・`$stream`・
 * `$renderedCallback` — ランタイムは `[wcs/mount-dollar-declaration]` で警告する）は、ここでは検査しない。
 * その state はホスト要素のプロパティ（コンポーネントの JS）にあり、HTML の `<wcs-state bind-component>` の中に
 * 書いたスクリプトはランタイムが読まない（上の `wcs/bind-component-source` で報告する）ので、HTML から見える
 * 形が無い。ランタイムが同じ code で投げる `$recursion` も同じ（コンポーネントの JS にしか書けない）。
 * `<wcs-state bind-component>` の中のスクリプトは、ほかの宣言・スクリプトの検査も読まない
 * （`parseLoadedScriptBlocks` — `wcs/bind-component-source` の 1 件に重ねない）。
 *
 * `<wcs-state>` は文書の要素だけを数える（`parseWcsStateElements` はコメントと raw text 要素 — `<script>` /
 * `<style>` / `<textarea>` / `<title>` — の中身を飛ばす。JS で作る shadow DOM の `innerHTML` の文字列は
 * 別の root で、文書の 2 つ目の root ではない）。
 *
 * 宣言が静的に読めない形（class 構文の state）は、鏡像（コメント・文字列の中身を空白化）への正規表現で拾い、
 * severity を 1 段下げる（error → warning、warning → info。構造が見えず、state 以外のオブジェクトのキーにも
 * 当たりうる）。
 *
 * 表は 4.0 の src と `__tests__/scopeDeclarationValidator.test.ts` が突き合わせる。
 * pure（DOM / vscode 非依存）。
 */

import { createTemplateTester, parseAttributeNames, parseWcsStateElements, type WcsScriptBlock } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode, type WcsSeverity } from '../core/diagnostics.js';
import { analyzeDeclarationSpans, findTopLevelDeclaration, maskCommentsAndStrings } from './stateAnalyzer.js';
import { blankComments } from './scriptCallArgs.js';

/** ボリュームが拒む宣言（4.0 の scopes/volume.ts の `REJECTED`。順序もランタイムのまま）。 */
export const VOLUME_REJECTED: readonly string[] = Object.freeze([
  '$stream', '$streams', '$scan', '$recursion', '$watch', '$listKeys', '$renderedCallback', '$updatedCallback', '$behavior', '$features',
]);

/** ボリュームで実行されない宣言（4.0 の scopes/volume.ts の `NOT_RUN`）。 */
export const VOLUME_NOT_RUN: readonly string[] = Object.freeze(['$commandTokens', '$eventTokens', '$on', '$errorCallback']);

/**
 * `VOLUME_REJECTED` のうち、ほかの検査が自分の code でボリュームの文面を出すもの（二重に報告しない）。
 * 値はその code（テストが「本当に報告される」ことを確かめる）。
 */
export const VOLUME_REJECTED_ELSEWHERE: Readonly<Record<string, string>> = Object.freeze({
  $streams: WcsDiagnosticCode.DeclarationAlias,
  $scan: WcsDiagnosticCode.ScanDeclarationInvalid,
  $recursion: WcsDiagnosticCode.RecursionDeclarationInvalid,
  $updatedCallback: WcsDiagnosticCode.DeclarationAlias,
  $behavior: WcsDiagnosticCode.BehaviorInvalid,
  $features: WcsDiagnosticCode.FeaturesInvalid,
});

/** bind-component と併記できない読み込みの属性（4.0 の scopes/component.ts の `load`）。 */
export const BIND_COMPONENT_SOURCE_ATTRIBUTES: readonly string[] = Object.freeze(['state', 'src', 'json']);

/** ここで報告するボリュームの宣言 → 重大度（宣言が静的に読めたとき）。 */
const VOLUME_CHECKED: ReadonlyMap<string, 'error' | 'warning'> = new Map([
  ...VOLUME_REJECTED.filter((key) => !(key in VOLUME_REJECTED_ELSEWHERE)).map((key) => [key, 'error'] as const),
  ...VOLUME_NOT_RUN.map((key) => [key, 'warning'] as const),
]);

/** 宣言が読めないときのフォールバック（キー・メソッド・class フィールド。`==` / `===` は除く）。 */
const VOLUME_DECLARATION = new RegExp(
  `(^|[{,;\\s])(${[...VOLUME_CHECKED.keys()].map((key) => key.replace('$', '\\$')).join('|')})(?=\\s*(?:[:(]|=(?!=)))`,
  'g',
);
/** フォールバックで拾った宣言の値が `undefined` のリテラルか（`$watch: undefined` / `$watch = undefined`）。 */
const UNDEFINED_VALUE = /^\s*[:=]\s*undefined\s*(?:[,;}]|$)/;

/** 文書にボリュームか bind-component がありうるか。 */
const SCOPE_GATE = /\s(?:mount|bind-component)(?=[\s=>/])/i;

/** 開始タグが 2 つ以上あるか（2 つ目の root がありうるか）。 */
function hasSeveralStateTags(html: string, stateTagName: string): boolean {
  const open = new RegExp(`<${stateTagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s>/])`, 'gi');
  return open.test(html) && open.test(html);
}

/**
 * HTML 内の全 `<wcs-state>` について、ボリュームの宣言・bind-component の state の出どころ・2 つ目の root を検査する。
 * どれもありえない文書（ボリュームも bind-component も無く、`<wcs-state>` が 1 つ以下）は `<wcs-state>` を読み直さない。
 */
export function validateScopeDeclarations(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  if (!SCOPE_GATE.test(html) && !hasSeveralStateTags(html, stateTagName)) return [];
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  let rootSeen = false;
  let insideTemplate: ((offset: number) => boolean) | null = null;
  for (const element of parseWcsStateElements(html, stateTagName)) {
    if (element.bindComponent) {
      validateBindComponentSource(html, element.tagStart, element.tagEnd, element.scriptBlocks.length > 0, msgs, out);
      continue;
    }
    if (element.mountPath !== null) {
      for (const block of element.scriptBlocks) validateVolumeBlock(block, element.mountPath, msgs, out);
      continue;
    }
    // `<template>` のタグは root の候補が出たときだけ集める（ボリュームと bind-component だけの文書では集めない）
    if ((insideTemplate ??= createTemplateTester(html))(element.tagStart)) continue;
    if (rootSeen) {
      out.push({
        code: WcsDiagnosticCode.SecondRoot,
        start: element.tagStart,
        end: element.tagEnd,
        message: msgs.secondRoot(),
        severity: 'error',
      });
    }
    rootSeen = true;
  }
  return out;
}

// ------------------------------------------------------------------ volume

function validateVolumeBlock(block: WcsScriptBlock, mountPath: string, msgs: WcsMessageCatalog, out: WcsDiagnostic[]): void {
  // 対象のキーが 1 つも無いスクリプトは解析しない
  if (![...VOLUME_CHECKED.keys()].some((key) => block.content.includes(key))) return;
  const push = (key: string, start: number, severity: WcsSeverity): void => {
    out.push({
      code: WcsDiagnosticCode.VolumeDeclaration,
      start: block.contentStart + start,
      end: block.contentStart + start + key.length,
      message: VOLUME_CHECKED.get(key) === 'error'
        ? msgs.volumeDeclarationRejected(key, mountPath)
        : msgs.volumeDeclarationNotRun(key, mountPath),
      severity,
    });
  };
  const spans = analyzeDeclarationSpans(block.content);
  if (spans.length > 0) {
    for (const span of spans) {
      const severity = VOLUME_CHECKED.get(span.name);
      if (severity === undefined) continue;
      if (span.kind === 'data') {
        const declaration = findTopLevelDeclaration(block.content, span.name);
        if (declaration?.value !== undefined && blankComments(declaration.value).trim() === 'undefined') continue;
      }
      push(span.name, span.start, severity);
    }
    return;
  }
  const scan = maskCommentsAndStrings(block.content);
  VOLUME_DECLARATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VOLUME_DECLARATION.exec(scan)) !== null) {
    const key = match[2];
    const keyStart = match.index + match[1].length;
    if (UNDEFINED_VALUE.test(scan.slice(keyStart + key.length))) continue;
    push(key, keyStart, VOLUME_CHECKED.get(key) === 'error' ? 'warning' : 'info');
  }
}

// ------------------------------------------------------------------ bind-component

function validateBindComponentSource(
  html: string,
  tagStart: number,
  tagEnd: number,
  hasInlineScript: boolean,
  msgs: WcsMessageCatalog,
  out: WcsDiagnostic[],
): void {
  const tag = html.slice(tagStart, tagEnd);
  const names = parseAttributeNames(tag);
  const sources = BIND_COMPONENT_SOURCE_ATTRIBUTES.filter((name) => names.has(name));
  if (hasInlineScript) sources.push('<script type="module">');
  if (sources.length === 0) return;
  const prop = /\sbind-component\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+))/i.exec(tag);
  out.push({
    code: WcsDiagnosticCode.BindComponentSource,
    start: tagStart,
    end: tagEnd,
    message: msgs.bindComponentSource(prop?.[1] ?? prop?.[2] ?? prop?.[3] ?? '', sources),
    severity: 'error',
  });
}
