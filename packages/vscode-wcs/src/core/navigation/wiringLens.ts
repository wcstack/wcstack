/**
 * core/navigation/wiringLens.ts — hover / go-to-definition / find-references /
 * inlay hint の純ロジック層（static-wiring-dx-design.md §5-2 / §5-3 = Phase B3）。
 *
 * 全機能を referenceIndex（§2-3）へのクエリとして実装する。LSP 型には依存せず、
 * 位置は全てドキュメント絶対オフセット（ITokenRange）— Volar への変換は
 * wcsNavigationPlugin（薄いアダプタ）の責務。
 *
 * 精度原則（§5-2「誤 hint ゼロ」）:
 * - 静的に解決できないものには何も出さない。ただし沈黙もしない —
 *   computed は「型は静的解析対象外」、src 外部 state は「外部定義（解析対象外）」
 *   と明示する（存在は分かるが中身が見えない、を区別して伝える）。
 * - for 短縮パスの展開表示はランタイム（collectStructuralFragments +
 *   expandShorthandPaths）と同一規則: `.` → `<forPath>.*` / `.child` →
 *   `<forPath>.*.child`。for パスは正本パーサの statePathName（`@state`・
 *   フィルタ除去後）で読み、ネストした相対 for は囲みチェーンを外側から
 *   再帰合成する。ランタイムが実際に属性文字列をこの形へ書き換えるため
 *   「コンパイル結果の開示」として正確。
 * - フィルタ型ヒントは manifest（builtinFilterMeta）の resultType を畳み込む。
 *   未知フィルタは打ち切り。passthrough は「素通し or 置換」で置換時に別の型を
 *   注入する（defaults は文字列・null は null）ため**型不明**として扱い、
 *   以降に具体型のフィルタが無ければヒントを出さない。
 *
 * v1 の割り切り:
 * - 単一 HTML ファイル閉じ（referenceIndex と同じ）。外部 state の宣言へは
 *   ジャンプせず `<wcs-state src=…>` タグへのフォールバックジャンプ（§5-3）。
 * - spread の `→ N props` ヒントは組み込み wcs-* タグ限定（D8: ブラウザ外の
 *   expandSpread は builtinTags カタログでしか数えられない。ユーザー定義タグ・
 *   DCC は unexpanded = 出さない）。所属タグ特定は ioNodeValidator の走査を共有。
 * - 参照収集は出現起点 = 展開後パスの完全一致、宣言起点 = 宣言名 + その配下
 *   （`user` からは `user.name` も参照に含む）。
 */

import {
  buildReferenceIndex,
  type IDeclarationSite,
  type IPathOccurrence,
  type IReferenceIndex,
} from '../index/referenceIndex.js';
import {
  parseBindTextWithPositions,
  parseEmbeddedTextWithPositions,
  type IPositionalBinding,
  type ITokenRange,
} from '../parser/positionalParser.js';
import { clearParserCaches } from '@wcstack/state/parser';
import { getStatePathsFromHtml } from '../../service/statePathResolver.js';
import type { PathCandidate } from '../../service/stateAnalyzer.js';
import { getEnclosingForPaths, getEnclosingFors } from '../../service/forContext.js';
import { findBuiltinTagOccurrences, type IoTagOccurrence } from '../../service/ioNodeValidator.js';
import { BUILTIN_TAGS } from '../../service/generated/builtinTags.generated.js';
import { findAllBindAttributes } from '../../service/bindingValidator.js';
import {
  findAllCommentBindings,
  findAllMustacheSyntax,
} from '../../service/templateSyntax.js';
import { parseWcsStateElements } from '../../language/htmlParse.js';
import { builtinFilterMeta, getWcsManifest, type IFilterMeta } from '../../service/wcsManifest.js';
import { resolveLocale, type WcsLocale } from '../messages.js';

export interface IWiringLensOptions {
  readonly bindAttribute?: string;
  readonly stateTagName?: string;
  readonly locale?: string;
}

export interface IHoverResult {
  /** Markdown 本文。 */
  readonly markdown: string;
  /** hover のハイライト範囲（ドキュメント絶対オフセット）。 */
  readonly range: ITokenRange;
}

export interface IDefinitionResult {
  /** ジャンプ元（パス文字列のスパン）。 */
  readonly originRange: ITokenRange;
  /** ジャンプ先（宣言名スパン、または外部 state の開始タグ）。 */
  readonly targetRange: ITokenRange;
}

export interface IReferenceResult {
  readonly range: ITokenRange;
  readonly isDeclaration: boolean;
}

export type InlayHintKind = 'shorthand' | 'filterType' | 'spread';

export interface IInlayHint {
  /** 挿入位置（ドキュメント絶対オフセット）。 */
  readonly offset: number;
  readonly label: string;
  readonly kind: InlayHintKind;
}

// ============================================================
// ラベル辞書（hover 本文の言語は wcstack.messageLanguage に従う）
// ============================================================

interface ILensLabels {
  readonly data: string;
  readonly computed: string;
  readonly computedNoType: string;
  readonly list: string;
  readonly method: string;
  readonly commandToken: string;
  readonly eventToken: string;
  readonly filter: string;
  readonly modifier: string;
  readonly state: string;
  readonly anyType: string;
  declaredAtLine(line: number): string;
  externalState(src: string): string;
  onPrefixModifier(eventName: string): string;
  readonly flagModifiers: Record<string, string>;
  readonly keyValueModifiers: Record<string, string>;
}

const LABELS: Record<WcsLocale, ILensLabels> = {
  en: {
    data: 'data',
    computed: 'computed',
    computedNoType: 'computed (type not statically analyzable)',
    list: 'list',
    method: 'method',
    commandToken: 'command token',
    eventToken: 'event token',
    filter: 'filter',
    modifier: 'modifier',
    state: 'state',
    anyType: 'any',
    declaredAtLine: (line) => `declared at L${line}`,
    externalState: (src) => `external definition (\`${src}\`) — not statically analyzed`,
    onPrefixModifier: (eventName) => `overrides the two-way trigger event to \`${eventName}\``,
    flagModifiers: {
      prevent: 'calls event.preventDefault()',
      stop: 'calls event.stopPropagation()',
      ro: 'suppresses two-way write-back (read-only)',
    },
    keyValueModifiers: {
      init: 'binding authority for the initial sync — which side seeds the other when the binding attaches (`state` / `element` / `auto` / `none`)',
      sync: 'when the element snapshot is read for element-authority bindings (`call` = on attach / `connect` = when connected)',
    },
  },
  ja: {
    data: 'データ',
    computed: 'computed',
    computedNoType: 'computed（型は静的解析対象外）',
    list: 'リスト',
    method: 'メソッド',
    commandToken: 'command トークン',
    eventToken: 'event トークン',
    filter: 'フィルタ',
    modifier: '修飾子',
    state: 'state',
    anyType: '任意',
    declaredAtLine: (line) => `宣言: L${line}`,
    externalState: (src) => `外部定義（\`${src}\`）— 静的解析の対象外`,
    onPrefixModifier: (eventName) => `双方向バインディングのトリガーイベントを \`${eventName}\` に上書き`,
    flagModifiers: {
      prevent: 'event.preventDefault() を呼ぶ',
      stop: 'event.stopPropagation() を呼ぶ',
      ro: '双方向バインディングの書き戻しを抑止（読み取り専用）',
    },
    keyValueModifiers: {
      init: '初期同期の権限指定 — バインド接続時にどちら側の値で初期化するか（`state` / `element` / `auto` / `none`）',
      sync: 'element 権限時に要素スナップショットを読むタイミング（`call` = 接続即時 / `connect` = DOM 接続後）',
    },
  },
};

// ============================================================
// 共有ヘルパー
// ============================================================

const { delimiters } = getWcsManifest().syntax;

/**
 * for 短縮パスをランタイムと同一規則で展開する。短縮でなければそのまま返す。
 *
 * ランタイム（collectStructuralFragments）はネストした for を外側から再帰合成する
 * — 各 for 属性を正本パーサで解釈した statePathName（`@state`・フィルタ除去後）を
 * 使い、相対 for（`for: .products`）は外側の展開結果に合成する — ため、ここでも
 * 囲み for チェーン全体を外側から畳み込む。静的に解決不能（for 外・最外殻が
 * 相対 for・for 式が不正）なら null。
 */
function expandOccurrencePath(
  html: string,
  path: string,
  pathOffset: number,
  bindAttribute: string,
): string | null {
  if (!path.startsWith('.')) return path;
  const chain = getEnclosingForPaths(html, pathOffset, bindAttribute);
  if (chain.length === 0) return null;
  let resolvedFor: string | null = null;
  for (const raw of chain) {
    // 生テキストには `@state` / `|filter` が付き得る。ランタイムは
    // parseBindTextResult.statePathName を使うので、ここも正本を通す。
    const parsed = parseBindTextWithPositions(`for: ${raw}`)[0]?.parsed ?? null;
    if (parsed === null) return null;
    const forPath = parsed.statePathName;
    if (forPath.startsWith('.')) {
      if (resolvedFor === null) return null; // 最外殻が相対 for = 静的に解決不能
      resolvedFor = forPath === '.' ? `${resolvedFor}.*` : `${resolvedFor}.*${forPath}`;
    } else {
      resolvedFor = forPath;
    }
  }
  if (resolvedFor === null) return null;
  return path === '.' ? `${resolvedFor}.*` : `${resolvedFor}.*${path}`;
}

/**
 * 宣言サイトの解決。referenceIndex の「完全一致 → 第 1 セグメント」に加えて、
 * 派生パスをその宣言元へ写像する（`$command.<n>` は `$commandTokens` 宣言が、
 * `$streamStatus.<n>` / `$streamError.<n>` は `$streams` 宣言が生んでいる）。
 */
function declarationFor(index: IReferenceIndex, stateName: string, path: string): IDeclarationSite | null {
  const direct = index.declarationOf(stateName, path);
  if (direct !== null) return direct;
  if (path.startsWith('$command.')) return index.declarationOf(stateName, '$commandTokens');
  if (path.startsWith('$streamStatus.') || path.startsWith('$streamError.')) {
    return index.declarationOf(stateName, '$streams');
  }
  return null;
}

/** ドキュメントオフセット → 1 始まり行番号。 */
function lineOf(html: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < html.length; i++) {
    if (html[i] === '\n') line++;
  }
  return line;
}

/** パス候補の kind / typeHint から hover の種別ラベルを組む。 */
function kindLabelOf(candidate: PathCandidate, labels: ILensLabels): string {
  switch (candidate.kind) {
    case 'computed':
      return candidate.typeHint === undefined
        ? labels.computedNoType
        : `${labels.computed} (${candidate.typeHint})`;
    case 'list':
      return candidate.typeHint === undefined ? labels.list : `${labels.list} (${candidate.typeHint})`;
    case 'method':
      return labels.method;
    case 'command':
      return labels.commandToken;
    case 'eventToken':
      return labels.eventToken;
    default:
      return candidate.typeHint === undefined ? labels.data : `${labels.data} (${candidate.typeHint})`;
  }
}

/** フィルタのシグネチャ表記（`fix(number?)` 形式）。 */
function filterSignatureOf(name: string, meta: IFilterMeta): string {
  if (!meta.hasArgs) return name;
  if (meta.argTypes === undefined) {
    return `${name}(${meta.minArgs}..${meta.maxArgs})`;
  }
  const args = meta.argTypes.map((argType, i) => (i >= meta.minArgs ? `${argType}?` : argType));
  return `${name}(${args.join(', ')})`;
}

/**
 * フィルタの型行（`number → string`）。resultType 'passthrough' のフィルタは
 * 「素通し or 置換」で、置換時に別の型を注入する（defaults は文字列・null は
 * null）ため型は断定できない — 行自体を出さない（誤 hint ゼロ。挙動は
 * description が説明する）。
 */
function filterTypeLineOf(meta: IFilterMeta, labels: ILensLabels): string | null {
  if (meta.resultType === 'passthrough') return null;
  const accepts = meta.acceptTypes === 'any' ? labels.anyType : meta.acceptTypes.join(' | ');
  return `${accepts} → ${meta.resultType}`;
}

/**
 * バインド式の列挙 1 件。lift は式ローカル ITokenRange → ドキュメント絶対への持ち上げ
 * （attribute は valueStart、text は exprStart への単純シフト）。
 */
interface IExpressionSite {
  readonly binding: IPositionalBinding;
  readonly channel: 'attribute' | 'text';
  lift(range: ITokenRange): ITokenRange;
}

/**
 * HTML 中の全バインド式（属性 + mustache + コメント）を positional パース済みで
 * 列挙する。text チャネルはランタイムと同じ embedded 経路（`;` 無分割・
 * 式全体が 1 バインディング）— referenceIndex と同一規則。
 */
function enumerateExpressionSites(html: string, bindAttribute: string): IExpressionSite[] {
  const sites: IExpressionSite[] = [];
  for (const attr of findAllBindAttributes(html, bindAttribute)) {
    for (const binding of parseBindTextWithPositions(attr.value)) {
      sites.push({
        binding,
        channel: 'attribute',
        lift: (range) => ({ start: attr.valueStart + range.start, end: attr.valueStart + range.end }),
      });
    }
  }
  const textMatches = [...findAllMustacheSyntax(html), ...findAllCommentBindings(html)];
  for (const match of textMatches) {
    sites.push({
      binding: parseEmbeddedTextWithPositions(match.expression),
      channel: 'text',
      lift: (range) => ({ start: match.exprStart + range.start, end: match.exprStart + range.end }),
    });
  }
  return sites;
}

// ============================================================
// hover（§5-2）
// ============================================================

export function getHoverAt(html: string, offset: number, options: IWiringLensOptions = {}): IHoverResult | null {
  const bindAttribute = options.bindAttribute ?? 'data-wcs';
  const stateTagName = options.stateTagName ?? 'wcs-state';
  const labels = LABELS[resolveLocale(options.locale)];
  const index = buildReferenceIndex(html, { bindAttribute, stateTagName });

  const occurrence = index.occurrenceAt(offset);
  if (occurrence !== null) {
    return hoverForOccurrence(html, index, occurrence, stateTagName, bindAttribute, labels);
  }
  // パス上でなければフィルタ名 / 修飾子上かを調べる
  return hoverForToken(html, offset, bindAttribute, labels);
}

function hoverForOccurrence(
  html: string,
  index: IReferenceIndex,
  occurrence: IPathOccurrence,
  stateTagName: string,
  bindAttribute: string,
  labels: ILensLabels,
): IHoverResult | null {
  if (occurrence.kind === 'eventToken') {
    // 右辺はトークン名（state パスではない）。$eventTokens 宣言があれば行を添える
    const declaration = index.declarationOf(occurrence.stateName, '$eventTokens');
    const lines = [`\`${occurrence.path}\` — ${labels.eventToken}`];
    let detail = `${labels.state}: \`${occurrence.stateName}\``;
    if (declaration !== null) {
      detail += ` · ${labels.declaredAtLine(lineOf(html, declaration.range.start))}`;
    }
    lines.push(detail);
    return { markdown: lines.join('\n\n'), range: occurrence.pathRange };
  }

  const resolved = expandOccurrencePath(html, occurrence.path, occurrence.pathRange.start, bindAttribute);
  if (resolved === null) return null; // 静的に解決不能な短縮パス（最外殻が相対 for 等）— 出さない

  const candidates = getStatePathsFromHtml(html, stateTagName);
  const candidate =
    candidates.find((c) => c.stateName === occurrence.stateName && c.path === resolved) ?? null;

  if (candidate === null) {
    // src 外部 state で候補ゼロなら「外部定義」を明示（誤 hint ゼロだが沈黙もしない）。
    // それ以外（未知パス）は lint の領分 — hover は出さない。
    const stateHasCandidates = candidates.some((c) => c.stateName === occurrence.stateName);
    const element = parseWcsStateElements(html, stateTagName).find(
      (e) => e.stateName === occurrence.stateName && e.srcAttr !== undefined,
    );
    if (element !== undefined && element.srcAttr !== undefined && !stateHasCandidates) {
      const lines = [
        `\`${resolved}\``,
        `${labels.externalState(element.srcAttr)} · ${labels.state}: \`${occurrence.stateName}\``,
      ];
      return { markdown: lines.join('\n\n'), range: occurrence.pathRange };
    }
    return null;
  }

  const header =
    occurrence.path === resolved ? `\`${resolved}\`` : `\`${occurrence.path}\` → \`${resolved}\``;
  let detail = `${kindLabelOf(candidate, labels)} · ${labels.state}: \`${occurrence.stateName}\``;
  const declaration = declarationFor(index, occurrence.stateName, resolved);
  if (declaration !== null) {
    detail += ` · ${labels.declaredAtLine(lineOf(html, declaration.range.start))}`;
  }
  return { markdown: `${header}\n\n${detail}`, range: occurrence.pathRange };
}

/** offset がフィルタ名 / 修飾子トークン上にあれば、そのメタ情報 hover を返す。 */
function hoverForToken(
  html: string,
  offset: number,
  bindAttribute: string,
  labels: ILensLabels,
): IHoverResult | null {
  for (const site of enumerateExpressionSites(html, bindAttribute)) {
    const { binding } = site;
    if (binding.parsed === null) continue;
    const exprDocRange = site.lift(binding.exprRange);
    if (offset < exprDocRange.start || offset >= exprDocRange.end) continue;

    const filterHit = locateFilterAt(binding, offset, site);
    if (filterHit !== null) {
      const meta = builtinFilterMeta[filterHit.name];
      if (meta === undefined) return null; // 未知フィルタ（誤 hint ゼロ）
      const typeLine = filterTypeLineOf(meta, labels);
      const markdown = [
        `\`${filterSignatureOf(filterHit.name, meta)}\` — ${labels.filter}`,
        meta.description,
        ...(typeLine === null ? [] : [typeLine]),
      ].join('\n\n');
      return { markdown, range: filterHit.range };
    }

    if (site.channel === 'attribute') {
      const modifierHit = locateModifierAt(binding, offset, site);
      if (modifierHit !== null) {
        const description = describeModifier(modifierHit.name, labels);
        if (description === null) return null; // 未知修飾子（誤 hint ゼロ）
        const markdown = [`\`#${modifierHit.name}\` — ${labels.modifier}`, description].join('\n\n');
        return { markdown, range: modifierHit.range };
      }
    }
    return null; // 式は特定できたがトークン上ではない
  }
  return null;
}

interface ITokenHit {
  readonly name: string;
  readonly range: ITokenRange;
}

/**
 * 式内のフィルタ名トークンを逆照合し、offset を含むものを返す。
 * out-filter は右辺の最初の `|` 以降、in-filter は左辺（`:` より前）の `|` 以降を
 * 順に前進しながら探す（positionalParser の locate と同じ前進式 — 引数文字列に
 * フィルタ名が含まれる誤照合を、直前トークンの末尾から探すことで避ける）。
 */
function locateFilterAt(binding: IPositionalBinding, offset: number, site: IExpressionSite): ITokenHit | null {
  const parsed = binding.parsed;
  if (parsed === null) return null;
  // exprRange はドキュメント側で式の位置が分かっているので、原文復元には
  // lift 前のローカル走査で十分 — 式テキストを組み立て直すのではなく、
  // フィルタ名を順に locate してヒットだけ lift する。
  const exprText = binding.exprText;
  // text チャネル（embedded）は右辺のみの式で原文に `:` を持たない — 右辺は
  // 先頭から。属性は `:` で左辺 / 右辺が分かれる（フィルタ引数内の `:`
  // （`date('HH:mm')` 等）を右辺開始と誤認しないよう、チャネルで分岐する）。
  const colon = site.channel === 'attribute' ? exprText.indexOf(delimiters.propValue) : -1;
  const rhsStart = site.channel === 'attribute' ? (colon === -1 ? exprText.length : colon + 1) : 0;

  // out-filter 帯: 右辺の最初の `|` 以降
  if (parsed.outFilters.length > 0) {
    const firstPipe = exprText.indexOf(delimiters.filter, rhsStart);
    if (firstPipe !== -1) {
      const hit = walkFilterNames(exprText, parsed.outFilters.map((f) => f.filterName), firstPipe + 1, exprText.length, offset, binding, site);
      if (hit !== null) return hit;
    }
  }
  // in-filter 帯: 属性の左辺（`:` より前）の `|` 以降（embedded に左辺は無い）
  if (site.channel === 'attribute' && parsed.inFilters.length > 0 && colon !== -1) {
    const lhsPipe = exprText.indexOf(delimiters.filter);
    if (lhsPipe !== -1 && lhsPipe < colon) {
      const hit = walkFilterNames(exprText, parsed.inFilters.map((f) => f.filterName), lhsPipe + 1, colon, offset, binding, site);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/** index の直前（空白を除く）がフィルタ区切り `|` か。 */
function isPrecededByFilterDelimiter(text: string, index: number): boolean {
  let i = index - 1;
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i--;
  return i >= 0 && text[i] === delimiters.filter;
}

/**
 * 名前列を from から順に探し、ドキュメント offset を含む名前を返す。
 * フィルタ名トークンは必ず `|`（+空白）の直後に現れる — この前置条件を
 * 満たさないヒット（引用符付き引数文字列内の部分一致等）は読み飛ばす。
 * 引数内リテラルへの偽ヒットと、それに伴う後続実トークンの取りこぼしの両方を
 * これで防ぐ。
 */
function walkFilterNames(
  exprText: string,
  names: readonly string[],
  from: number,
  to: number,
  offset: number,
  binding: IPositionalBinding,
  site: IExpressionSite,
): ITokenHit | null {
  let cursor = from;
  for (const name of names) {
    let found = exprText.indexOf(name, cursor);
    while (found !== -1 && found + name.length <= to && !isPrecededByFilterDelimiter(exprText, found)) {
      found = exprText.indexOf(name, found + 1);
    }
    if (found === -1 || found + name.length > to) return null;
    const local: ITokenRange = {
      start: binding.exprRange.start + found,
      end: binding.exprRange.start + found + name.length,
    };
    const doc = site.lift(local);
    if (offset >= doc.start && offset < doc.end) return { name, range: doc };
    cursor = found + name.length;
  }
  return null;
}

/** 式内の修飾子トークン（`#` の後、カンマ区切り）を逆照合する。 */
function locateModifierAt(binding: IPositionalBinding, offset: number, site: IExpressionSite): ITokenHit | null {
  const parsed = binding.parsed;
  if (parsed === null || parsed.propModifiers.length === 0) return null;
  const exprText = binding.exprText;
  const colon = exprText.indexOf(delimiters.propValue);
  const lhsEnd = colon === -1 ? exprText.length : colon;
  const hash = exprText.indexOf('#');
  if (hash === -1 || hash >= lhsEnd) return null;

  let cursor = hash + 1;
  for (const modifier of parsed.propModifiers) {
    const found = exprText.indexOf(modifier, cursor);
    if (found === -1 || found + modifier.length > lhsEnd) return null;
    const local: ITokenRange = {
      start: binding.exprRange.start + found,
      end: binding.exprRange.start + found + modifier.length,
    };
    const doc = site.lift(local);
    if (offset >= doc.start && offset < doc.end) return { name: modifier, range: doc };
    cursor = found + modifier.length;
  }
  return null;
}

/**
 * 修飾子の説明（フラグ / key=value / on<event> 接頭辞）。未知は null。
 * ランタイム（initialSync）は `init = element` のような空白入りを trim で
 * 受理するため、分類は trim 後の表記で行う。
 */
function describeModifier(rawModifier: string, labels: ILensLabels): string | null {
  const { modifiers } = getWcsManifest().syntax;
  const modifier = rawModifier.trim();
  if ((modifiers.flags as readonly string[]).includes(modifier)) {
    return labels.flagModifiers[modifier] ?? null;
  }
  const eq = modifier.indexOf('=');
  if (eq !== -1) {
    const key = modifier.slice(0, eq).trim();
    if ((modifiers.keyValue as readonly string[]).includes(key)) {
      return labels.keyValueModifiers[key] ?? null;
    }
    return null;
  }
  if (modifier.startsWith(modifiers.eventNamePrefix) && modifier.length > modifiers.eventNamePrefix.length) {
    return labels.onPrefixModifier(modifier.slice(modifiers.eventNamePrefix.length));
  }
  return null;
}


// ============================================================
// go-to-definition（§5-3）
// ============================================================

export function getDefinitionAt(
  html: string,
  offset: number,
  options: IWiringLensOptions = {},
): IDefinitionResult | null {
  const bindAttribute = options.bindAttribute ?? 'data-wcs';
  const stateTagName = options.stateTagName ?? 'wcs-state';
  const index = buildReferenceIndex(html, { bindAttribute, stateTagName });

  const occurrence = index.occurrenceAt(offset);
  if (occurrence === null) return null;

  let declaration: IDeclarationSite | null = null;
  if (occurrence.kind === 'eventToken') {
    declaration = index.declarationOf(occurrence.stateName, '$eventTokens');
  } else {
    const resolved = expandOccurrencePath(html, occurrence.path, occurrence.pathRange.start, bindAttribute);
    if (resolved !== null) {
      declaration = declarationFor(index, occurrence.stateName, resolved);
    }
  }
  if (declaration !== null) {
    return { originRange: occurrence.pathRange, targetRange: declaration.range };
  }

  // フォールバック（§5-3）: インライン宣言を 1 つも持たない src 外部 state は
  // `<wcs-state src=…>` の開始タグへジャンプする（定義はこの src の先に居る）。
  const hasInlineDeclarations = index.declarations.some((d) => d.stateName === occurrence.stateName);
  if (!hasInlineDeclarations) {
    const element = parseWcsStateElements(html, stateTagName).find(
      (e) => e.stateName === occurrence.stateName && e.srcAttr !== undefined,
    );
    if (element !== undefined) {
      return {
        originRange: occurrence.pathRange,
        targetRange: { start: element.tagStart, end: element.tagEnd },
      };
    }
  }
  return null;
}

// ============================================================
// find-references（§5-3）
// ============================================================

export function getReferencesAt(
  html: string,
  offset: number,
  includeDeclaration: boolean,
  options: IWiringLensOptions = {},
): IReferenceResult[] | null {
  const bindAttribute = options.bindAttribute ?? 'data-wcs';
  const stateTagName = options.stateTagName ?? 'wcs-state';
  const index = buildReferenceIndex(html, { bindAttribute, stateTagName });

  const resolvedOf = (o: IPathOccurrence): string | null =>
    expandOccurrencePath(html, o.path, o.pathRange.start, bindAttribute);

  const occurrence = index.occurrenceAt(offset);
  if (occurrence !== null) {
    if (occurrence.kind === 'eventToken') {
      // トークン名は state パスと別空間 — 同名トークンの出現だけを集める
      const results: IReferenceResult[] = index.occurrences
        .filter((o) => o.kind === 'eventToken' && o.stateName === occurrence.stateName && o.path === occurrence.path)
        .map((o) => ({ range: o.pathRange, isDeclaration: false }));
      if (includeDeclaration) {
        const declaration = index.declarationOf(occurrence.stateName, '$eventTokens');
        if (declaration !== null) results.unshift({ range: declaration.range, isDeclaration: true });
      }
      return results;
    }
    const resolved = resolvedOf(occurrence);
    if (resolved === null) return null;
    // `$1`〜`$9`（ループ添字）はパス文字列が同じでも囲み for ごとに別の参照先。
    // `$N` の参照先はチェーン N 枚目（外側から。README: 「$1 が外・$2 が内」）の
    // for テンプレート実体なので、同じテンプレートをアンカーに持つ出現だけを集める。
    const loopIndexMatch = /^\$([1-9])$/.exec(resolved);
    if (loopIndexMatch !== null) {
      const n = Number(loopIndexMatch[1]);
      // getEnclosingFors は全文書走査 — 出現ごとの再計算を避けて位置でメモ化
      const anchorCache = new Map<number, number | null>();
      const anchorOf = (o: IPathOccurrence): number | null => {
        const cached = anchorCache.get(o.pathRange.start);
        if (cached !== undefined) return cached;
        const chain = getEnclosingFors(html, o.pathRange.start, bindAttribute);
        const anchor = chain.length >= n ? chain[n - 1].anchor : null;
        anchorCache.set(o.pathRange.start, anchor);
        return anchor;
      };
      const originAnchor = anchorOf(occurrence);
      if (originAnchor === null) return null; // ループ外（または深さ不足）の $N — lint の領分
      return index.occurrences
        .filter((o) =>
          o.kind === 'path' && o.stateName === occurrence.stateName
          && o.path === resolved && anchorOf(o) === originAnchor)
        .map((o) => ({ range: o.pathRange, isDeclaration: false }));
    }
    const results: IReferenceResult[] = index.occurrences
      .filter((o) => o.kind === 'path' && o.stateName === occurrence.stateName && resolvedOf(o) === resolved)
      .map((o) => ({ range: o.pathRange, isDeclaration: false }));
    if (includeDeclaration) {
      const declaration = declarationFor(index, occurrence.stateName, resolved);
      if (declaration !== null) results.unshift({ range: declaration.range, isDeclaration: true });
    }
    return results;
  }

  // 宣言スパン上（インラインスクリプト内の宣言名）からの逆引き
  const declaration = index.declarations.find((d) => offset >= d.range.start && offset < d.range.end);
  if (declaration === undefined) return null;

  // トークン系宣言の逆引きは「宣言されている名前」だけを対象にする — 宣言配列に
  // 無い名前の出現（タイポ）まで含めると宣言への参照でないものを提示してしまう
  let declaredTokens: Set<string> | null = null;
  const getDeclaredTokens = (kind: 'command' | 'eventToken'): Set<string> => {
    if (declaredTokens === null) {
      declaredTokens = new Set(
        getStatePathsFromHtml(html, stateTagName)
          .filter((c) => c.stateName === declaration.stateName && c.kind === kind)
          .map((c) => c.path),
      );
    }
    return declaredTokens;
  };

  const matches = (o: IPathOccurrence): boolean => {
    if (o.stateName !== declaration.stateName) return false;
    if (declaration.name === '$eventTokens') {
      return o.kind === 'eventToken' && getDeclaredTokens('eventToken').has(o.path);
    }
    if (o.kind !== 'path') return false;
    const resolved = resolvedOf(o);
    if (resolved === null) return false;
    if (declaration.name === '$commandTokens') {
      return resolved.startsWith('$command.') && getDeclaredTokens('command').has(resolved);
    }
    // `$streams` は $streamStatus.<n> / $streamError.<n> の派生パスを生む
    // （declarationFor の写像と対）。値プロパティ側は候補に導出元が残らないため
    // v1 では対象外（follow-up）。
    if (declaration.name === '$streams') {
      return resolved.startsWith('$streamStatus.') || resolved.startsWith('$streamError.');
    }
    return resolved === declaration.name || resolved.startsWith(`${declaration.name}.`);
  };
  const results: IReferenceResult[] = index.occurrences
    .filter(matches)
    .map((o) => ({ range: o.pathRange, isDeclaration: false }));
  if (includeDeclaration) {
    results.unshift({ range: declaration.range, isDeclaration: true });
  }
  return results;
}

// ============================================================
// inlay hint（§5-2）
// ============================================================

export function getInlayHints(
  html: string,
  rangeStart: number,
  rangeEnd: number,
  options: IWiringLensOptions = {},
): IInlayHint[] {
  // buildReferenceIndex を経ない唯一のエントリ — intern キャッシュの単調増加を
  // ここでも抑える（理由は referenceIndex 側のコメント参照）
  clearParserCaches();
  const bindAttribute = options.bindAttribute ?? 'data-wcs';
  const stateTagName = options.stateTagName ?? 'wcs-state';
  const hints: IInlayHint[] = [];

  // 候補は必要になった時だけ解決する（filterType ヒントの入力型にだけ要る）
  let candidates: PathCandidate[] | null = null;
  const getCandidates = (): PathCandidate[] =>
    (candidates ??= getStatePathsFromHtml(html, stateTagName));

  // spread ヒント用: 属性の所属タグ（組み込み wcs-* のみ）を範囲包含で引く
  let builtinOccurrences: IoTagOccurrence[] | null = null;
  const findOwnerBuiltinTag = (docOffset: number): IoTagOccurrence | null => {
    builtinOccurrences ??= findBuiltinTagOccurrences(html);
    return (
      builtinOccurrences.find(
        (o) => docOffset >= o.attrsStart && docOffset < o.attrsStart + o.attrsText.length,
      ) ?? null
    );
  };

  for (const site of enumerateExpressionSites(html, bindAttribute)) {
    const { binding } = site;
    if (binding.parsed === null || binding.pathRange === null) continue;
    if (binding.parsed.propSegments[0] === 'eventToken') continue; // トークン名はパスではない
    const pathDocRange = site.lift(binding.pathRange);

    // --- spread の展開規模（式末尾に `→ N props`）。ブラウザ外の expandSpread は
    // builtinTags カタログ限定（D8）— ユーザー定義タグ・DCC は unexpanded = 出さない。
    // 展開対象は wcBindable の properties + inputs（dedupe。command / eventToken は
    // spread 対象外の契約）。 ---
    if (binding.parsed.bindingType === 'spread') {
      if (site.channel !== 'attribute') continue;
      const exprDocRange = site.lift(binding.exprRange);
      if (exprDocRange.end < rangeStart || exprDocRange.end > rangeEnd) continue;
      const owner = findOwnerBuiltinTag(pathDocRange.start);
      if (owner !== null) {
        const contract = BUILTIN_TAGS[owner.tagName];
        const propCount = new Set([...Object.keys(contract.inputs), ...contract.properties]).size;
        // カタログは「wcBindable 無し」のタグ（wcs-fetch-header 等）も空契約に
        // 平坦化している。無宣言タグへの spread はランタイムが raiseError する
        // 構成なので、0 件を「合法な 0 展開」として提示すると誤 hint になる —
        // union が空なら出さない（真に空の wcBindable (wcs-noise) の「→ 0 props」
        // も失うが情報価値ゼロ。カタログへの wcBindable 有無の記録は follow-up）。
        if (propCount > 0) {
          hints.push({ offset: exprDocRange.end, label: `→ ${propCount} props`, kind: 'spread' });
        }
      }
      continue;
    }

    // --- for 短縮パスの展開表示（`.name` の後ろに `= users.*.name`） ---
    const path = binding.parsed.statePathName;
    if (path.startsWith('.')) {
      const expanded = expandOccurrencePath(html, path, pathDocRange.start, bindAttribute);
      if (expanded !== null && pathDocRange.end >= rangeStart && pathDocRange.end <= rangeEnd) {
        hints.push({ offset: pathDocRange.end, label: `= ${expanded}`, kind: 'shorthand' });
      }
    }

    // --- フィルタ鎖の結果型（式末尾に `→ string`） ---
    if (binding.parsed.outFilters.length === 0) continue;
    if (binding.parsed.bindingType === 'event') continue; // イベントにフィルタは無効（lint の領分）
    const exprDocRange = site.lift(binding.exprRange);
    if (exprDocRange.end < rangeStart || exprDocRange.end > rangeEnd) continue;

    const resolved = expandOccurrencePath(html, path, pathDocRange.start, bindAttribute);
    const inputType =
      resolved === null
        ? undefined
        : getCandidates().find(
            (c) => c.stateName === binding.parsed!.stateName && c.path === resolved,
          )?.typeHint;

    let current: string | null = inputType ?? null;
    let known = true;
    for (const filter of binding.parsed.outFilters) {
      const meta = builtinFilterMeta[filter.filterName];
      if (meta === undefined) {
        known = false;
        break;
      }
      // passthrough は「素通し or 置換」— 置換時に別の型を注入する（defaults は
      // 文字列・null は null）ため、通過後の型は静的に断定できない。
      current = meta.resultType === 'passthrough' ? null : meta.resultType;
    }
    if (known && current !== null) {
      hints.push({ offset: exprDocRange.end, label: `→ ${current}`, kind: 'filterType' });
    }
  }
  return hints;
}
