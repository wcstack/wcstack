/**
 * ioNodeValidator.ts
 *
 * 組み込み wcs-* I/O ノードタグに対する data-wcs バインディングを、生成カタログ
 * （generated/builtinTags.generated.ts — 各パッケージの `static wcBindable` が単一正本）
 * と突き合わせて検査する。
 *
 * 検出するのは:
 * - TagMemberUnknown（error）: 契約に存在しないプロパティ / command / eventToken キーへのバインド。
 *   4.0 のランタイムは宣言の無いメンバーを拒む — プロパティは #38、`command.` は #1203、`eventToken.` は
 *   #1204 で、root では初期化が、行では束縛が失敗する（3.x の「黙って無視」ではない）。拒まないのは
 *   HTML の書き込み先（`HTML_SINK_PROPERTIES`）だけ
 * - TriggerSeededTruthy: `trigger` バインド先スロットの `true` シード
 *   （trigger はエッジ検出なし・`manual` バイパスのため、バインド時に即発火する）
 * - StorageSeedClobber（error）: 非 manual の `<wcs-storage>` `value` を `#init=element` なしで束ねた
 *   スロットのリテラルのシード（null を含む。初期書き戻しが保存値を毎回上書きする — load-before-bind
 *   イディオム違反）と、アクセサペア
 * - StorageInitSeed: `value#init=element` のバインド先スロットの null 以外のリテラルシード
 *   （空のキーは null を読むので、初回の引き込みでシードが null に置き換わる）
 *
 * pure(DOM / vscode 非依存)。bindingValidator と同一のバインディングパーサを共有する。
 */

import { WcsDiagnostic, WcsDiagnosticCode } from '../core/diagnostics.js';
import { getMessages, type WcsMessageCatalog } from '../core/messages.js';
import { BUILTIN_TAGS } from './generated/builtinTags.generated.js';
import { getStatePathsFromHtml, type FileReader } from './statePathResolver.js';
import type { PathCandidate } from './stateAnalyzer.js';
import { splitBindingExpressions, parseBindingExpression } from './bindingValidator.js';
import { getWcsManifest } from './wcsManifest.js';
import { suggestion } from './suggestion.js';
import { collectPageElementContracts, mayDefineElements } from './pageElements.js';
import { findStartTagRegions } from '../language/htmlParse.js';

/** What a binding is checked against: a built-in tag's catalog entry, or a page element's `static wcBindable`. */
interface MemberContract {
  readonly properties: readonly string[];
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly commands: readonly string[];
  /** `semantics: "handle"` の出力（built-in の目録にだけある）。 */
  readonly handles?: readonly string[];
}

/**
 * wc-bindable の宣言を持つ要素でも、契約メンバーでなくてよいプロパティバインド。ランタイムは HTML の
 * 書き込み先（state の `isHtmlSink`: `innerHTML` / `outerHTML` / `srcdoc`）と `html:` だけを宣言の外で
 * 直接書き、ほかのプロパティ（`textContent` / `hidden` / `title` / `id` …）は宣言に無ければ #38 で拒む
 * （state の dom/plan.ts の `specFor` と dom/wc.ts の `attachProperty`）。
 * （class./style./attr./on* プレフィックスは別途スキップされる。）
 */
const HTML_SINK_PROPERTIES = new Set(['html', 'innerHTML', 'outerHTML', 'srcdoc']);

/** 構造ディレクティブ（タグ契約の検査対象外）。 */
const STRUCTURAL_DIRECTIVES = new Set(['for', 'if', 'elseif', 'else']);

/**
 * 明示のプロパティ形（`.name:`）の先頭に置けない語 — ランタイムの
 * `EXPLICIT_PROPERTY_REJECTED_HEADS`（`bindTextParser/parseBindTextsForElement.ts`）と同じ集合。
 * 正本パーサが `[wcs/binding-syntax]`（error）で落とす形なので、ここで別理由の警告を重ねない。
 *
 * 5 語は manifest（`syntax.bindingTypes.propNamespaces`）から導出する。6 語目の `state`
 * （`VOLUME_INJECTION_PROP` — `<wcs-state mount>` 上の `state.<key>:` は注入の宣言なので
 * `.state.x:` が曖昧）は manifest に載っていないのでここだけ手書き。手書きが正本から
 * ずれないことは `__tests__/explicitPropertyHeads.drift.test.ts` が state の src を読んで固定する。
 */
export const EXPLICIT_PROPERTY_REJECTED_HEADS: ReadonlySet<string> = new Set([
  ...Object.values(getWcsManifest().syntax.bindingTypes.propNamespaces),
  'state',
]);
const EXPLICIT_PROPERTY_REJECTED_HEADS_RE = new RegExp(
  `^(?:${[...EXPLICIT_PROPERTY_REJECTED_HEADS].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(\\.|$)`,
);

/** `''` / `null` / `[]` / `{}` — storage の保存値を初期書き戻しで上書きする空値シード。 */
/** 組み込み wcs-* タグ 1 出現（core/navigation の spread ヒントが所属タグ特定に共有。走査が二重実装になると検査とヒントでタグ解釈が割れる）。 */
export interface IoTagOccurrence {
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
  fileReader?: FileReader,
): WcsDiagnostic[] {
  const diagnostics: WcsDiagnostic[] = [];
  const msgs = getMessages(locale);
  const occurrences = findBuiltinTagOccurrences(html);

  // state スロットのシード値検査（trigger / storage）にだけ状態パスが要る。遅延解決。
  let statePaths: PathCandidate[] | null = null;
  const getPaths = (): PathCandidate[] =>
    (statePaths ??= getStatePathsFromHtml(html, stateTagName, fileReader));

  for (const occ of occurrences) {
    const contract = BUILTIN_TAGS[occ.tagName];
    const bindAttr = extractAttributeValue(occ.attrsText, bindAttribute);
    if (!bindAttr) continue;
    const valueStart = occ.attrsStart + bindAttr.valueOffsetInAttrs;

    // wcBindable 無宣言タグ（wcs-fetch-header 等のヘルパー）への spread は
    // ランタイム（expandSpread）が raiseError で落とす — メンバー検査の
    // 手前で error にする。空の契約（wcs-noise = 宣言はあるがメンバー 0）は
    // 合法な 0 展開なので対象外。spread 以外のバインドは従来どおり検査しない
    // （バインド面が定義されていない）。
    if (!contract.hasWcBindable) {
      let spreadExprOffset = 0;
      for (const expr of splitBindingExpressions(bindAttr.value)) {
        const exprStart = valueStart + spreadExprOffset;
        spreadExprOffset += expr.length + 1; // ';' の分
        if (parseBindingExpression(expr).property !== '...') continue;
        // property が '...' なら expr 中に必ず '...' が現れる（スライス由来）
        const start = exprStart + expr.indexOf('...');
        diagnostics.push({
          code: WcsDiagnosticCode.SpreadNoBindable,
          start, end: start + 3,
          severity: 'error', tag: occ.tagName,
          message: msgs.spreadNoBindable(occ.tagName),
        });
      }
      continue;
    }

    // 契約メンバーが 1 つも無いタグは検査対象外 — 突き合わせる面が無い。
    if (contract.properties.length === 0 && contract.commands.length === 0
      && Object.keys(contract.inputs).length === 0) continue;

    const hasManual = hasBooleanAttribute(occ.attrsText, 'manual');

    checkBindings(occ.tagName, contract, bindAttr.value, valueStart, hasManual, getPaths, diagnostics, msgs);
  }

  // The custom elements the page defines itself: checked against their `static wcBindable` as the runtime does
  // (#38 / #1203 / #1204 — at the root the state fails to initialize). Only an element whose declaration the
  // page's scripts state literally (pageElements.ts); the scripts are read only when such an element is bound
  if (mayDefineElements(html)) {
    const own = findPageTagOccurrences(html, bindAttribute);
    const contracts = own.length > 0 ? collectPageElementContracts(html, fileReader) : null;
    for (const occ of own) {
      const contract = contracts!.get(occ.tagName);
      if (contract === undefined) continue;
      if (contract.properties.length === 0 && contract.commands.length === 0 && Object.keys(contract.inputs).length === 0) continue;
      const bindAttr = extractAttributeValue(occ.attrsText, bindAttribute)!;
      checkBindings(occ.tagName, contract, bindAttr.value, occ.attrsStart + bindAttr.valueOffsetInAttrs, false, getPaths, diagnostics, msgs);
    }
  }

  return diagnostics;
}

/** Each binding of one element's bind attribute against `contract`. */
function checkBindings(
  tagName: string,
  contract: MemberContract,
  value: string,
  valueStart: number,
  hasManual: boolean,
  getPaths: () => PathCandidate[],
  diagnostics: WcsDiagnostic[],
  msgs: WcsMessageCatalog,
): void {
  let exprOffset = 0;
  for (const expr of splitBindingExpressions(value)) {
    const exprStart = valueStart + exprOffset;
    exprOffset += expr.length + 1; // ';' の分
    const parsed = parseBindingExpression(expr);
    const property = parsed.property;
    if (!property) continue;

    const propIndex = expr.indexOf(property);
    const start = propIndex === -1 ? exprStart : exprStart + propIndex;
    const end = propIndex === -1 ? exprStart + expr.length : start + property.length;

    validateBindingAgainstContract(tagName, contract, parsed, property, start, end, hasManual, getPaths, diagnostics, msgs);
  }
}

/** 1 バインディングを契約と突き合わせる。 */
function validateBindingAgainstContract(
  tagName: string,
  contract: MemberContract,
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

  // 明示のプロパティ形（`.once:`、@wcstack/state 3.1・要件 B5）: ドットを外して同じ名前で照合する。
  // 正本パーサが [wcs/binding-syntax] で落とす形（ドットの後が名前空間の語・空・さらにドット
  // ＝ `..once:`）は、ここでは重ねない — 同じ 1 か所に「未知メンバー」という別の理由の
  // 警告を並べても、直す手がかりが増えずに紛らわしくなるだけ。
  const explicit = property.startsWith('.') && property !== '...';
  if (explicit) {
    property = property.slice(1);
    if (property.length === 0 || property.startsWith('.')) return;
    if (EXPLICIT_PROPERTY_REJECTED_HEADS_RE.test(property)) return;
  }

  // 契約検査の対象外: スプレッド・構造ディレクティブ・DOM レベルのバインド。
  if (property === '...') return;
  if (STRUCTURAL_DIRECTIVES.has(property)) return;
  if (/^(class|style|attr)\./.test(property)) return;
  if (!explicit && /^on\w/.test(property)) {
    // "on" で始まるメンバー（`once`）をドット無しで書くとイベント束縛になり、値が届かない（3.x 計画 D36）
    if (contract.properties.includes(property) || property in contract.inputs) {
      diagnostics.push({
        code: WcsDiagnosticCode.OnPrefixedMember,
        start, end, severity: 'warning', tag: tagName, member: property,
        message: msgs.onPrefixedMember(property, tagName, modifiers),
      });
    }
    return;
  }

  const inputNames = Object.keys(contract.inputs);

  if (property.startsWith('command.')) {
    const name = property.slice('command.'.length);
    if (!contract.commands.includes(name)) {
      diagnostics.push({
        code: WcsDiagnosticCode.TagMemberUnknown,
        start, end, severity: 'error', tag: tagName, member: name,
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
        start, end, severity: 'error', tag: tagName, member: name,
        message: msgs.tagEventTokenKeyUnknown(name, tagName, contract.properties.join(', '))
          + suggestion(name, contract.properties, msgs),
      });
    }
    return;
  }

  // A page element's dotted property (`state.items:` on a Light DOM component's host) is its wiring, not a member
  if (!tagName.startsWith('wcs-') && property.includes('.')) return;

  // 通常のプロパティバインド: properties ∪ inputs ∪ HTML の書き込み先。
  if (!contract.properties.includes(property) && !(property in contract.inputs)
    && !HTML_SINK_PROPERTIES.has(property)) {
    const members = [...contract.properties, ...inputNames];
    diagnostics.push({
      code: WcsDiagnosticCode.TagMemberUnknown,
      start, end, severity: 'error', tag: tagName, member: property,
      message: msgs.tagMemberUnknown(property, tagName) + suggestion(property, members, msgs),
    });
    return;
  }

  // ハンドル（生きたリソース）を値として束ねた: `streamReady: cam.stream` は MediaStream を state に入れる。
  // ランタイムは書くので動くが、スナップショット・DevTools・SSR に載らない（docs/seam-apps.md、state-field-report）。
  if (contract.handles?.includes(property)) {
    diagnostics.push({
      code: WcsDiagnosticCode.HandleBoundAsValue,
      start, end, severity: 'warning', tag: tagName, member: property,
      message: msgs.handleBoundAsValue(property, tagName),
    });
    return;
  }

  // trigger の true シード: エッジ検出なし・manual バイパスのためバインド時に即発火する。
  if (tagName.startsWith('wcs-') && property === 'trigger' && 'trigger' in contract.inputs && parsed.path) {
    const cand = findDataSlot(getPaths(), parsed.path);
    if (cand?.rawInitial === 'true') {
      diagnostics.push({
        code: WcsDiagnosticCode.TriggerSeededTruthy,
        start, end, severity: 'warning', tag: tagName, statePath: parsed.path,
        message: msgs.triggerSeededTruthy(parsed.path),
      });
    }
  }

  // storage のシード: 非 manual では state の側が先に書くので、リテラルのシード（null・'' から
  // 中身のあるオブジェクトまで）が保存値を読み込みのたびに上書きする — データが消えるので error。
  // 空の値に限っていたため、`{ token: "", user: {…} }` のシードは黙って通っていた（docs/seam-apps.md、
  // router-auth）。undefined のシード（`enableDirectionalInitialSync` を切ったページの形）と、式・
  // 識別子（判断しない）は対象外。`#init=element` / `#init=auto` は load-before-bind の宣言的な解なので対象外。
  if (tagName === 'wcs-storage' && property === 'value' && !hasManual && parsed.path
    && !/(?:^|,)init=(?:element|auto)\b/.test(modifiers)) {
    const paths = getPaths();
    const cand = findDataSlot(paths, parsed.path);
    if (cand?.rawInitial !== undefined && (cand.rawInitial.trim() === 'null' || isNonNullLiteralSeed(cand.rawInitial))) {
      diagnostics.push({
        code: WcsDiagnosticCode.StorageSeedClobber,
        start, end, severity: 'error', tag: tagName, statePath: parsed.path,
        message: msgs.storageSeedClobber(parsed.path, cand.rawInitial),
      });
    } else if (cand === undefined && paths.some(c => c.kind === 'computed' && c.settable && c.path === parsed.path)) {
      // アクセサペア（getter + setter）も同じ: 初期の書き戻しが getter の最初の値（空のカートの
      // `[]` など）を保存値の上に保存し、setter は保存値を受け取れない。setter があるのは復元する
      // つもりの印。getter だけ（保存専用の設計がありうる）は対象外。
      diagnostics.push({
        code: WcsDiagnosticCode.StorageSeedClobber,
        start, end, severity: 'error', tag: tagName, statePath: parsed.path,
        message: msgs.storagePairClobber(parsed.path),
      });
    }
  }

  // `#init=element` の引き込みは要素の値をスロットへ書く。空のキーは null を読むので、
  // null 以外のリテラルのシード（`cart: []` / `theme: "light"`）は初回に null へ置き換わる
  // （`[]` のつもりで `this.cart.findIndex(…)` を呼ぶコードが投げる）。storage の README
  // §5 の「シードは要素の本当の初期値（null）で」の静的な形。アクセサペア（getter）は
  // データスロットではないので対象外 — setter が null を捨てられる。
  if (tagName === 'wcs-storage' && property === 'value' && parsed.path
    && /(?:^|,)init=element\b/.test(modifiers)) {
    const cand = findDataSlot(getPaths(), parsed.path);
    if (cand?.rawInitial !== undefined && isNonNullLiteralSeed(cand.rawInitial)) {
      diagnostics.push({
        code: WcsDiagnosticCode.StorageInitSeed,
        start, end, severity: 'warning', tag: tagName, statePath: parsed.path,
        message: msgs.storageInitSeed(parsed.path, cand.rawInitial),
      });
    }
  }
}

/** null / undefined 以外のリテラル（文字列・数値・真偽・配列・オブジェクト）か。式や識別子は判断しない。 */
function isNonNullLiteralSeed(raw: string): boolean {
  const v = raw.trim();
  return /^(?:["'`[{]|-?\d)/.test(v) || v === 'true' || v === 'false';
}

function findDataSlot(paths: PathCandidate[], path: string): PathCandidate | undefined {
  return paths.find(c => c.kind === 'data' && c.path === path);
}

// ============================================================
// HTML スキャン（bindingValidator 同様、正規表現ベースの軽量走査）
// ============================================================

/** カタログ掲載タグの開きタグを全て検出する。 */
export function findBuiltinTagOccurrences(html: string): IoTagOccurrence[] {
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

/**
 * The start tags of custom elements that are not built-in `wcs-*` tags and carry the bind attribute — in the
 * markup only (not in a comment, a script's strings or escaped text: findStartTagRegions).
 */
function findPageTagOccurrences(html: string, bindAttribute: string): IoTagOccurrence[] {
  const out: IoTagOccurrence[] = [];
  for (const region of findStartTagRegions(html)) {
    const tagName = region.tagName;
    if (!tagName.includes('-') || tagName.startsWith('wcs-')) continue;
    const attrsText = html.slice(region.start, region.end);
    if (extractAttributeValue(attrsText, bindAttribute) === null) continue;
    out.push({ tagName, tagStart: region.start - tagName.length - 1, attrsText, attrsStart: region.start });
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
