/**
 * ioNodeValidator.ts
 *
 * 組み込み wcs-* I/O ノードタグに対する data-wcs バインディングを、生成カタログ
 * （generated/builtinTags.generated.ts — 各パッケージの `static wcBindable` が単一正本）
 * と突き合わせて検査する。
 *
 * 検出するのはすべて「例外なく静かに壊れる」誤り:
 * - TagMemberUnknown: 契約に存在しないプロパティ / command / eventToken キーへのバインド
 *   （wc-bindable は未知メンバーを黙って無視する）
 * - TriggerSeededTruthy: `trigger` バインド先スロットの `true` シード
 *   （trigger はエッジ検出なし・`manual` バイパスのため、バインド時に即発火する）
 * - StorageSeedClobber: 非 manual の `<wcs-storage>` `value` バインド先スロットの
 *   空値シード（初期書き戻しが保存値を上書きする — load-before-bind イディオム違反）
 *
 * pure(DOM / vscode 非依存)。bindingValidator と同一のバインディングパーサを共有する。
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { BUILTIN_TAGS } from './generated/builtinTags.generated.js';
import { getStatePathsFromHtml } from './statePathResolver.js';
import type { PathCandidate } from './stateAnalyzer.js';
import { splitBindingExpressions, parseBindingExpression } from './bindingValidator.js';

/**
 * 任意の要素で正当な DOM プロパティバインド。契約メンバーでなくても警告しない。
 * （class./style./attr./on* プレフィックスは別途スキップされる。）
 */
const DOM_COMMON_PROPERTIES = new Set([
  'textContent', 'innerHTML', 'innerText', 'hidden', 'title', 'id',
  'slot', 'dir', 'lang', 'role', 'tabIndex', 'className',
]);

/** 構造ディレクティブ（タグ契約の検査対象外）。 */
const STRUCTURAL_DIRECTIVES = new Set(['for', 'if', 'elseif', 'else']);

/** `''` / `null` / `[]` / `{}` — storage の保存値を初期書き戻しで上書きする空値シード。 */
const EMPTYISH_SEEDS = new Set(["''", '""', '``', 'null', '[]', '{}']);

interface IoTagOccurrence {
  tagName: string;
  /** タグ全体の開始オフセット。 */
  tagStart: number;
  /** 属性部の文字列。 */
  attrsText: string;
  /** 属性部の開始オフセット。 */
  attrsStart: number;
}

/**
 * HTML 中の組み込み wcs-* タグの data-wcs バインディングを検査する。
 */
export function validateIoNodes(
  html: string,
  bindAttribute: string = 'data-wcs',
  stateTagName: string = 'wcs-state',
  locale?: string,
): WcsDiagnostic[] {
  const diagnostics: WcsDiagnostic[] = [];
  const msgs = getMessages(locale);
  const occurrences = findBuiltinTagOccurrences(html);
  if (occurrences.length === 0) return diagnostics;

  // state スロットのシード値検査（trigger / storage）にだけ状態パスが要る。遅延解決。
  let statePaths: PathCandidate[] | null = null;
  const getPaths = (): PathCandidate[] =>
    (statePaths ??= getStatePathsFromHtml(html, stateTagName));

  for (const occ of occurrences) {
    const contract = BUILTIN_TAGS[occ.tagName];
    // ヘルパータグ（契約メンバーなし）は検査対象外 — バインド面が定義されていない。
    if (contract.properties.length === 0 && contract.commands.length === 0
      && Object.keys(contract.inputs).length === 0) continue;

    const bindAttr = extractAttributeValue(occ.attrsText, bindAttribute);
    if (!bindAttr) continue;
    const valueStart = occ.attrsStart + bindAttr.valueOffsetInAttrs;
    const hasManual = hasBooleanAttribute(occ.attrsText, 'manual');

    let exprOffset = 0;
    for (const expr of splitBindingExpressions(bindAttr.value)) {
      const exprStart = valueStart + exprOffset;
      exprOffset += expr.length + 1; // ';' の分
      const parsed = parseBindingExpression(expr);
      const property = parsed.property;
      if (!property) continue;

      const propIndex = expr.indexOf(property);
      const start = propIndex === -1 ? exprStart : exprStart + propIndex;
      const end = propIndex === -1 ? exprStart + expr.length : start + property.length;

      validateBindingAgainstContract(
        occ.tagName, contract, parsed, property, start, end, hasManual, getPaths, diagnostics, msgs,
      );
    }
  }

  return diagnostics;
}

/** 1 バインディングを契約と突き合わせる。 */
function validateBindingAgainstContract(
  tagName: string,
  contract: (typeof BUILTIN_TAGS)[string],
  parsed: ReturnType<typeof parseBindingExpression>,
  property: string,
  start: number,
  end: number,
  hasManual: boolean,
  getPaths: () => PathCandidate[],
  diagnostics: WcsDiagnostic[],
  msgs: WcsMessageCatalog,
): void {
  // `#修飾子`（`value#init=element` / `onclick#prevent` 等）を分離してから照合する。
  const hashIndex = property.indexOf('#');
  const modifiers = hashIndex === -1 ? '' : property.slice(hashIndex + 1);
  property = hashIndex === -1 ? property : property.slice(0, hashIndex);

  // 契約検査の対象外: スプレッド・構造ディレクティブ・DOM レベルのバインド。
  if (property === '...') return;
  if (STRUCTURAL_DIRECTIVES.has(property)) return;
  if (/^(class|style|attr)\./.test(property)) return;
  if (/^on\w/.test(property)) return;

  const inputNames = Object.keys(contract.inputs);

  if (property.startsWith('command.')) {
    const name = property.slice('command.'.length);
    if (!contract.commands.includes(name)) {
      diagnostics.push({
        code: WcsDiagnosticCode.TagMemberUnknown,
        start, end, severity: 'warning', tag: tagName, member: name,
        message: msgs.tagCommandUnknown(name, tagName, contract.commands.join(', ') || msgs.none())
          + suggestion(name, contract.commands, msgs),
      });
    }
    return;
  }

  if (property.startsWith('eventToken.')) {
    const name = property.slice('eventToken.'.length);
    if (!contract.properties.includes(name)) {
      diagnostics.push({
        code: WcsDiagnosticCode.TagMemberUnknown,
        start, end, severity: 'warning', tag: tagName, member: name,
        message: msgs.tagEventTokenKeyUnknown(name, tagName, contract.properties.join(', '))
          + suggestion(name, contract.properties, msgs),
      });
    }
    return;
  }

  // 通常のプロパティバインド: properties ∪ inputs ∪ 汎用 DOM プロパティ。
  if (!contract.properties.includes(property) && !(property in contract.inputs)
    && !DOM_COMMON_PROPERTIES.has(property)) {
    const members = [...contract.properties, ...inputNames];
    diagnostics.push({
      code: WcsDiagnosticCode.TagMemberUnknown,
      start, end, severity: 'warning', tag: tagName, member: property,
      message: msgs.tagMemberUnknown(property, tagName) + suggestion(property, members, msgs),
    });
    return;
  }

  // trigger の true シード: エッジ検出なし・manual バイパスのためバインド時に即発火する。
  if (property === 'trigger' && 'trigger' in contract.inputs && parsed.path) {
    const cand = findDataSlot(getPaths(), parsed.path, parsed.targetState);
    if (cand?.rawInitial === 'true') {
      diagnostics.push({
        code: WcsDiagnosticCode.TriggerSeededTruthy,
        start, end, severity: 'warning', tag: tagName, statePath: parsed.path,
        message: msgs.triggerSeededTruthy(parsed.path),
      });
    }
  }

  // storage の空値シード: 非 manual では value= が書き戻し保存されるため、
  // '' / null 等のシードが localStorage の保存値を初期化時に上書きする。
  // `#init=element` / `#init=auto` は load-before-bind の宣言的な解なので対象外。
  if (tagName === 'wcs-storage' && property === 'value' && !hasManual && parsed.path
    && !/(?:^|,)init=(?:element|auto)\b/.test(modifiers)) {
    const cand = findDataSlot(getPaths(), parsed.path, parsed.targetState);
    if (cand?.rawInitial !== undefined && EMPTYISH_SEEDS.has(normalizeSeed(cand.rawInitial))) {
      diagnostics.push({
        code: WcsDiagnosticCode.StorageSeedClobber,
        start, end, severity: 'warning', tag: tagName, statePath: parsed.path,
        message: msgs.storageSeedClobber(parsed.path, cand.rawInitial),
      });
    }
  }
}

function findDataSlot(paths: PathCandidate[], path: string, stateName: string): PathCandidate | undefined {
  return paths.find(c => c.kind === 'data' && c.path === path && c.stateName === stateName);
}

/** `[ ]` / `{ }` の内部空白を潰して EMPTYISH_SEEDS と比較できる形にする。 */
function normalizeSeed(raw: string): string {
  const compact = raw.replace(/\s+/g, '');
  return compact === '' ? raw : compact;
}

/** 編集距離 2 以内の最近傍メンバーを「もしかして」として提示する。 */
function suggestion(input: string, candidates: readonly string[], msgs: WcsMessageCatalog): string {
  let best: string | null = null;
  let bestDistance = 3;
  for (const c of candidates) {
    const d = editDistance(input.toLowerCase(), c.toLowerCase(), bestDistance);
    if (d < bestDistance) { best = c; bestDistance = d; }
  }
  return best !== null ? msgs.didYouMean(best) : '';
}

/** バウンド付き Levenshtein（bound 以上は bound を返す）。 */
function editDistance(a: string, b: string, bound: number): number {
  if (Math.abs(a.length - b.length) >= bound) return bound;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin >= bound) return bound;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return Math.min(prev[b.length], bound);
}

// ============================================================
// HTML スキャン（bindingValidator 同様、正規表現ベースの軽量走査）
// ============================================================

/** カタログ掲載タグの開きタグを全て検出する。 */
function findBuiltinTagOccurrences(html: string): IoTagOccurrence[] {
  const out: IoTagOccurrence[] = [];
  // 属性値中の ">" を誤検出しないため、引用符内はまとめて読み飛ばす。
  const regex = /<(wcs-[a-z0-9-]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    if (!(tagName in BUILTIN_TAGS)) continue;
    out.push({
      tagName,
      tagStart: match.index,
      attrsText: match[2],
      attrsStart: match.index + 1 + match[1].length,
    });
  }
  return out;
}

/** 属性部から指定属性の値と（属性部内の）値開始オフセットを取り出す。 */
function extractAttributeValue(
  attrsText: string,
  attrName: string,
): { value: string; valueOffsetInAttrs: number } | null {
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])`, 'i');
  const match = regex.exec(attrsText);
  if (!match) return null;
  const quote = match[1];
  const valueStart = match.index + match[0].length;
  const valueEnd = attrsText.indexOf(quote, valueStart);
  if (valueEnd === -1) return null;
  return { value: attrsText.slice(valueStart, valueEnd), valueOffsetInAttrs: valueStart };
}

/** boolean 属性（manual 等）の存在を判定する。 */
function hasBooleanAttribute(attrsText: string, attrName: string): boolean {
  return new RegExp(`(?:^|\\s)${attrName}(?:\\s|=|$)`, 'i').test(attrsText);
}
