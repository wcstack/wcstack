/**
 * configDeclarationValidator.ts — `@wcstack/state` 4.0 の設定の宣言
 * （docs/state-engine-rewrite/config-impl-plan.ja.md §2.2〜§2.4・§4 段 4）。
 *
 *   - `$behavior`（状態の宣言キー）: オブジェクトで、キーと値の型は manifest の `behaviorOptions`
 *     （今は enableMustache・sameValueGuard・enableDirectionalInitialSync の 3 つ、どれも boolean）。ランタイムは読み込み時に #44 で throw する
 *     （`null` と配列は通る — `$behavior ?? {}` と `typeof … === "object"`）。ボリューム（`mount=`）では
 *     宣言できない（ランタイムは接ぎ木を拒み、console.error で報告する）。マウントしたコンポーネント（`bind-component`）は自分の
 *     エンジンを作るので、自分の `$behavior` を持てる。
 *   - `$features`（状態の宣言キー）: 後付けの名前の配列。配列でなければ #46 で throw、知らない名前は
 *     分割 auto なら `[wcs/feature-unknown]`、全部入り・バンドラなら `[wcs/feature-not-installed]` で
 *     throw する。ボリュームでは宣言できない。
 *   - `features=`（`<wcs-state>` の属性）: 後付けの名前の空白区切り。読むのは文書の root の
 *     `<wcs-state>`（`mount`・`bind-component` を持たない最初のもの — `<template>` の中は文書に無い）
 *     だけで、ほかは黙って無視される（設計 A3: 実行時は読まず、lint だけが知らせる）。
 *
 * 名前の表は 4.0 の manifest（`behaviorOptions` / `features`）から読む。manifest はランタイムが読む表
 * （engine.ts の `BEHAVIOR_KEYS`・load.ts の `FEATURE_NAMES`）と一致し、それは @wcstack/state の
 * `__tests__/public-surface.test.ts` が固定する。
 *
 * 精度方針は既存の宣言の検査と同じ: 値が識別子参照・式なら黙る（断定できる形だけを報告する）。
 * pure（DOM / vscode 非依存）。
 */

import { createTemplateTester, parseLoadedScriptBlocks, parseWcsStateElements, type WcsScriptBlock } from '../language/htmlParse.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { WcsDiagnostic, WcsDiagnosticCode, type WcsDiagnosticCodeValue } from '../core/diagnostics.js';
import { analyzeDeclarationEntries, findTopLevelDeclaration, maskCommentsAndStrings } from './stateAnalyzer.js';
import { suggestion } from './ioNodeValidator.js';
import { blankComments } from './scriptCallArgs.js';
import { getWcsManifest } from './wcsManifest.js';

const manifest = getWcsManifest();
/** `$behavior` のキーと値の型（manifest の `behaviorOptions`）。 */
const BEHAVIOR_OPTIONS = manifest.behaviorOptions;
/** `$behavior` のキー（manifest の `behaviorOptions` のキー）。 */
export const BEHAVIOR_KEYS: readonly string[] = Object.freeze(Object.keys(BEHAVIOR_OPTIONS));
/** 後付けの名前（manifest の `features`）。 */
export const FEATURE_NAMES: readonly string[] = Object.freeze([...manifest.features]);

const BEHAVIOR_KEY = '$behavior';
const FEATURES_KEY = '$features';

export function validateConfigDeclarations(
  html: string,
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  const msgs = getMessages(locale);
  const out: WcsDiagnostic[] = [];
  for (const block of parseLoadedScriptBlocks(html, stateTagName)) {
    // 宣言のどちらも無いスクリプトは解析しない（キー入力ごとに走るので、文字列の検索だけで抜ける）
    if (!block.content.includes(BEHAVIOR_KEY) && !block.content.includes(FEATURES_KEY)) continue;
    validateBehavior(block, msgs, out);
    validateFeatures(block, msgs, out);
  }
  validateFeaturesAttributes(html, stateTagName, msgs, out);
  return out;
}

function push(
  out: WcsDiagnostic[],
  code: WcsDiagnosticCodeValue,
  start: number,
  end: number,
  message: string,
  severity: 'error' | 'warning' = 'error',
): void {
  out.push({ code, start, end, message, severity });
}

// ------------------------------------------------------------------ $behavior

function validateBehavior(block: WcsScriptBlock, msgs: WcsMessageCatalog, out: WcsDiagnostic[]): void {
  const decl = findTopLevelDeclaration(block.content, BEHAVIOR_KEY);
  if (decl === null) return;
  const base = block.contentStart;
  if (block.mountPath !== null) {
    // 値が `undefined` のリテラルは宣言なし扱い（ランタイムは `state[key] !== undefined` で拒む — scopes/volume.ts）
    if (decl.value !== undefined && literalKind(decl.value) === 'undefined') return;
    push(out, WcsDiagnosticCode.BehaviorInvalid, base + decl.start, base + decl.end, msgs.configInVolume(BEHAVIOR_KEY, block.mountPath));
    return;
  }
  // メソッド短縮記法（`$behavior() {}`）は関数 ＝ オブジェクトでない。getter は評価結果が分からない
  if (decl.kind === 'method') {
    push(out, WcsDiagnosticCode.BehaviorInvalid, base + decl.start, base + decl.end, msgs.behaviorNotObject(BEHAVIOR_KEYS));
    return;
  }
  if (decl.value === undefined) return;
  const kind = literalKind(decl.value);
  // `null` / 配列はランタイムが通す（`?? {}` / `typeof [] === "object"`）
  if (kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'function') {
    push(out, WcsDiagnosticCode.BehaviorInvalid, base + decl.start, base + decl.end, msgs.behaviorNotObject(BEHAVIOR_KEYS));
    return;
  }
  if (kind !== 'object') return;
  for (const entry of analyzeDeclarationEntries(block.content, BEHAVIOR_KEY)) {
    if (!BEHAVIOR_KEYS.includes(entry.name)) {
      push(out, WcsDiagnosticCode.BehaviorInvalid, base + entry.start, base + entry.end,
        msgs.behaviorKeyUnknown(entry.name, BEHAVIOR_KEYS, suggestion(entry.name, BEHAVIOR_KEYS, msgs)));
      continue;
    }
    const type = BEHAVIOR_OPTIONS[entry.name].type;
    // メソッドは関数（manifest の型でない）。getter は評価結果が分からないので黙る
    if (entry.kind === 'method') {
      push(out, WcsDiagnosticCode.BehaviorInvalid, base + entry.start, base + entry.end, msgs.behaviorValueType(entry.name, type));
      continue;
    }
    if (entry.value === undefined || entry.valueStart === undefined) continue;
    const valueKind = literalKind(entry.value);
    if (valueKind !== type && valueKind !== 'unknown') {
      // 範囲はリテラルそのもの（隣のコメントは含めない）
      const blanked = blankComments(entry.value);
      const lead = blanked.length - blanked.trimStart().length;
      const start = base + entry.valueStart + lead;
      push(out, WcsDiagnosticCode.BehaviorInvalid, start, start + blanked.trim().length, msgs.behaviorValueType(entry.name, type));
    }
  }
}

// ------------------------------------------------------------------ $features

function validateFeatures(block: WcsScriptBlock, msgs: WcsMessageCatalog, out: WcsDiagnostic[]): void {
  const decl = findTopLevelDeclaration(block.content, FEATURES_KEY);
  if (decl === null) return;
  const base = block.contentStart;
  if (block.mountPath !== null) {
    // 値が `undefined` のリテラルは宣言なし扱い（ランタイムは `state[key] !== undefined` で拒む — scopes/volume.ts）
    if (decl.value !== undefined && literalKind(decl.value) === 'undefined') return;
    push(out, WcsDiagnosticCode.FeaturesInvalid, base + decl.start, base + decl.end, msgs.configInVolume(FEATURES_KEY, block.mountPath));
    return;
  }
  if (decl.kind === 'method') {
    push(out, WcsDiagnosticCode.FeaturesInvalid, base + decl.start, base + decl.end, msgs.featuresNotArray());
    return;
  }
  if (decl.value === undefined || decl.valueStart === undefined) return;
  const kind = literalKind(decl.value);
  // `undefined` は宣言なし扱い（ランタイムは `!== undefined` で読む）。`null` は配列でないので throw
  if (kind !== 'array') {
    if (kind !== 'unknown' && kind !== 'undefined') {
      push(out, WcsDiagnosticCode.FeaturesInvalid, base + decl.start, base + decl.end, msgs.featuresNotArray());
    }
    return;
  }
  // 要素の隣のコメント（`"temporl" /* x */`）を空白にしてから切る（長さは変えないので位置はそのまま）
  for (const element of arrayElements(blankComments(decl.value))) {
    const elementKind = literalKind(element.text);
    const start = base + decl.valueStart + element.start;
    if (elementKind === 'string') {
      const name = element.text.slice(1, -1);
      if (!FEATURE_NAMES.includes(name)) {
        // 範囲は引用符の内側（名前そのもの）
        push(out, WcsDiagnosticCode.FeatureUnknown, start + 1, start + 1 + name.length,
          msgs.featureUnknown(name, FEATURE_NAMES, suggestion(name, FEATURE_NAMES, msgs)));
      }
    } else if (elementKind !== 'unknown') {
      // 文字列でないリテラル（`1` / `null` / `{}`）は名前になり得ない。識別子・spread は黙る
      push(out, WcsDiagnosticCode.FeatureUnknown, start, start + element.text.length, msgs.featureUnknown(element.text, FEATURE_NAMES, ''));
    }
  }
}

// ------------------------------------------------------------------ features=

/**
 * `<wcs-state features="…">`。root（`mount`・`bind-component` を持たず、`<template>` の中に無い最初の
 * `<wcs-state>`）の名前を検査し、root 以外の `features=` は読まれないことを知らせる。
 */
function validateFeaturesAttributes(html: string, stateTagName: string, msgs: WcsMessageCatalog, out: WcsDiagnostic[]): void {
  // キー入力ごとに走るので、属性の名前が文書のどこにも無ければ <wcs-state> の走査をしない
  if (!html.includes('features')) return;
  let rootSeen = false;
  const insideTemplate = createTemplateTester(html);
  for (const element of parseWcsStateElements(html, stateTagName)) {
    const candidate = element.mountPath === null && !element.bindComponent && !insideTemplate(element.tagStart);
    const isRoot = candidate && !rootSeen;
    if (candidate) rootSeen = true;
    const tagText = html.slice(element.tagStart, element.tagEnd);
    const match = /(?:^|\s)(features)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?(?=[\s/>]|$)/id.exec(tagText);
    if (match === null) continue;
    const nameSpan = match.indices![1];
    if (!isRoot) {
      push(out, WcsDiagnosticCode.FeaturesInvalid, element.tagStart + nameSpan[0], element.tagStart + nameSpan[1],
        msgs.featuresAttrNotRoot(), 'warning');
      continue;
    }
    const group = match[2] !== undefined ? 2 : match[3] !== undefined ? 3 : match[4] !== undefined ? 4 : 0;
    if (group === 0) continue;
    const valueStart = element.tagStart + match.indices![group][0];
    const value = match[group];
    const token = /\S+/g;
    let t: RegExpExecArray | null;
    while ((t = token.exec(value)) !== null) {
      if (FEATURE_NAMES.includes(t[0])) continue;
      push(out, WcsDiagnosticCode.FeatureUnknown, valueStart + t.index, valueStart + t.index + t[0].length,
        msgs.featureUnknown(t[0], FEATURE_NAMES, suggestion(t[0], FEATURE_NAMES, msgs)));
    }
  }
}

// ------------------------------------------------------------------ literals

type LiteralKind = 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'object' | 'array' | 'function' | 'unknown';

/**
 * 値テキストが**全体として**どのリテラルか。式・識別子参照・呼び出しは 'unknown'（断定しない）。
 * 文字列の中身はマスク済みの鏡像で見る（中の `,` や括弧で誤らない）。テンプレートリテラルは
 * 埋め込み（`${`）が無いときだけ文字列とみなす。コメントは先に空白へ潰す（文字列の隣にブロックコメントがあっても文字列）。
 */
function literalKind(value: string): LiteralKind {
  const text = blankComments(value).trim();
  const scan = maskCommentsAndStrings(text).trim();
  if (/^(["'])[^"']*\1$/.test(scan)) return 'string';
  if (/^`[^`]*`$/.test(scan)) return text.includes('${') ? 'unknown' : 'string';
  if (/^-?(?:\d[\w.]*|\.\d[\w]*)$/.test(scan)) return 'number';
  if (/^(?:true|false)$/.test(scan)) return 'boolean';
  if (scan === 'null') return 'null';
  if (scan === 'undefined') return 'undefined';
  if (/^(?:async\s+)?function\b[\s\S]*\}$/.test(scan) || /^(?:async\s+)?(?:\([^()]*\)|[$\w]+)\s*=>/.test(scan)) return 'function';
  if (isWholeBracket(scan, '[', ']')) return 'array';
  if (isWholeBracket(scan, '{', '}')) return 'object';
  return 'unknown';
}

/** 鏡像の先頭の括弧が末尾で閉じるか（`[a, b]` は true・`[a].concat(b)` は false）。 */
function isWholeBracket(scan: string, open: string, close: string): boolean {
  if (scan[0] !== open || scan[scan.length - 1] !== close) return false;
  let depth = 0;
  for (let i = 0; i < scan.length; i++) {
    const ch = scan[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i === scan.length - 1;
    }
  }
  return false;
}

/** 配列リテラル（`[ … ]`）のトップレベルの要素と、値テキストの中での開始位置（前後の空白を除いた形）。 */
function arrayElements(value: string): { text: string; start: number }[] {
  const scan = maskCommentsAndStrings(value);
  const open = scan.indexOf('[');
  const close = scan.lastIndexOf(']');
  const out: { text: string; start: number }[] = [];
  let depth = 0;
  let from = open + 1;
  const take = (end: number): void => {
    const raw = value.slice(from, end);
    const text = raw.trim();
    if (text.length > 0) out.push({ text, start: from + (raw.length - raw.trimStart().length) });
  };
  for (let i = open + 1; i < close; i++) {
    const ch = scan[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      take(i);
      from = i + 1;
    }
  }
  take(close);
  return out;
}
