/**
 * core/index/referenceIndex.ts — 単一 HTML の「結線の一級データ化」
 * （static-wiring-dx-design.md §2-3 の位置情報付き参照インデックス）。
 *
 * 「path → 出現 range[]（data-wcs 属性・mustache・コメントバインディング）+
 * 宣言 span」を 1 回の走査で構築する。hover / go-to-definition /
 * find-references / unused 診断 / 配線図出力の共有基盤（B3 以降の消費面は
 * このインデックスへのクエリとして実装する）。
 *
 * 設計上の割り切り（v1）:
 * - 単位は**単一 HTML ファイル閉じ**（既存アーキテクチャと同じ。外部 state の
 *   解決は CLI の fileReader と同様に呼び出し側の責務）。
 * - 宣言側はインラインスクリプトのトップレベル宣言のみ（analyzeDeclarationSpans）。
 *   JSON 定義・ネスト内側の宣言はスパンを持たない。ドット付きパスの宣言解決は
 *   「完全一致 → 第 1 セグメントへフォールバック」。
 * - 式の意味論は正本パーサ（positionalParser 経由の @wcstack/state/parser）。
 *   壊れた式は problems に落とし、残りの式のインデックス化を止めない。
 * - for 短縮パス（`.label`）は**字句どおり**載る（展開には囲みテンプレートの
 *   構造文脈が要り、それは forContext 系の知識。ここでは混ぜない）。したがって
 *   `referencesOf('default', 'items.*.label')` と `.label` の出現は統合されない。
 * - 「構造ディレクティブは単独バインディング」の属性全体検査はここでは行わない
 *   （bindingValidator の structuralMustBeSingle が担当。problems は**式単位**の
 *   正本パーサ受理の記録であり、属性全体のランタイム受理と同義ではない）。
 * - **text チャネルも正本化済み（v1.29.0 で parseBindTextForEmbeddedNode が
 *   subpath export された）**: コメント/mustache 経路はランタイムと同じく
 *   `;` を**分割しない**（`{{ a; b }}` は「a; b」という 1 本のパスとして 1 出現）。
 *   属性経路（無条件 `;` 分割）との規則差は正本パーサ由来の仕様。
 */

import { parseWcsScriptBlocks } from '../../language/htmlParse.js';
import { findAllBindAttributes } from '../../service/bindingValidator.js';
import { findAllMustacheSyntax, findAllCommentBindings } from '../../service/templateSyntax.js';
import { analyzeDeclarationSpans } from '../../service/stateAnalyzer.js';
import {
  parseBindTextWithPositions,
  parseEmbeddedTextWithPositions,
  type ITokenRange,
} from '../parser/positionalParser.js';
import { clearParserCaches } from '@wcstack/state/parser';

export type OccurrenceSource = 'attribute' | 'mustache' | 'comment';

/**
 * 出現の種別。`eventToken.<prop>: <name>` の右辺はトークン名であり state パスでは
 * ないため 'eventToken' として区別する（referencesOf / declarationOf のパス空間を
 * 汚染しない — データプロパティと同名のトークンへの誤ジャンプ防止）。
 */
export type OccurrenceKind = 'path' | 'eventToken';

/** バインディング側のパス出現 1 件（オフセットは全てドキュメント基準）。 */
export interface IPathOccurrence {
  readonly source: OccurrenceSource;
  readonly kind: OccurrenceKind;
  readonly path: string;
  /** パス文字列そのもののスパン。 */
  readonly pathRange: ITokenRange;
  /** 式全体のスパン。 */
  readonly exprRange: ITokenRange;
  /** 左辺 propName のスパン（mustache / comment は null）。 */
  readonly propName: string | null;
  readonly propRange: ITokenRange | null;
  /** 正本パーサの bindingType（mustache / comment は 'text' 扱い）。 */
  readonly bindingType: string;
}

/** 宣言サイト（インラインスクリプトのトップレベル宣言）。 */
export interface IDeclarationSite {
  readonly name: string;
  readonly kind: 'data' | 'getter' | 'method';
  readonly range: ITokenRange;
}

/** 正本パーサが受理しなかった式（tolerant パースの残骸）。 */
export interface IParseProblem {
  readonly message: string;
  readonly range: ITokenRange;
}

export interface IReferenceIndexOptions {
  readonly bindAttribute?: string;
  readonly stateTagName?: string;
}

export interface IReferenceIndex {
  readonly occurrences: readonly IPathOccurrence[];
  readonly declarations: readonly IDeclarationSite[];
  readonly problems: readonly IParseProblem[];
  /** 指定 state の指定パスの出現を全て返す。 */
  referencesOf(path: string): IPathOccurrence[];
  /** パス（または宣言名）の宣言サイト。完全一致 → 第 1 セグメントの順で解決。 */
  declarationOf(path: string): IDeclarationSite | null;
  /** ドキュメントオフセット位置にあるパス出現（パス文字列上のみヒット）。 */
  occurrenceAt(offset: number): IPathOccurrence | null;
}

export function buildReferenceIndex(html: string, options: IReferenceIndexOptions = {}): IReferenceIndex {
  // 正本パーサの intern キャッシュは無制限（evict なし）。言語サーバー常駐で
  // 編集中の中間パスが恒久 intern されないよう、ドキュメント単位の構築ごとに
  // 捨てる（構築内のキャッシュ効果は保たれる。PathInfo の同一性保証は
  // 1 回の構築内でしか使っていない）。
  clearParserCaches();
  const bindAttribute = options.bindAttribute ?? 'data-wcs';
  const stateTagName = options.stateTagName ?? 'wcs-state';

  const occurrences: IPathOccurrence[] = [];
  const problems: IParseProblem[] = [];

  // --- バインディング側: data-wcs 属性 ---
  for (const attr of findAllBindAttributes(html, bindAttribute)) {
    for (const binding of parseBindTextWithPositions(attr.value)) {
      const lift = (range: ITokenRange): ITokenRange =>
        ({ start: attr.valueStart + range.start, end: attr.valueStart + range.end });
      if (binding.parsed === null) {
        problems.push({ message: binding.error ?? 'parse error', range: lift(binding.exprRange) });
        continue;
      }
      if (binding.pathRange === null) continue; // else: 等、原文にパスを持たない式
      occurrences.push({
        source: 'attribute',
        kind: binding.parsed.propSegments[0] === 'eventToken' ? 'eventToken' : 'path',
        path: binding.parsed.statePathName,
        pathRange: lift(binding.pathRange),
        exprRange: lift(binding.exprRange),
        propName: binding.parsed.propName,
        propRange: binding.propRange === null ? null : lift(binding.propRange),
        bindingType: binding.parsed.bindingType,
      });
    }
  }

  // --- バインディング側: {{ }} / <!--@@:--> ---
  const textMatches = [
    ...findAllMustacheSyntax(html),
    ...findAllCommentBindings(html),
  ];
  for (const match of textMatches) {
    // ランタイムと同じ embedded 経路（`;` 無分割・式全体が 1 バインディング）で
    // パースする。スパンは式ローカル → exprStart への単純シフト。
    const binding = parseEmbeddedTextWithPositions(match.expression);
    const shift = (range: ITokenRange): ITokenRange => ({
      start: match.exprStart + range.start,
      end: match.exprStart + range.end,
    });
    if (binding.parsed === null) {
      problems.push({ message: binding.error ?? 'parse error', range: shift(binding.exprRange) });
      continue;
    }
    if (binding.pathRange === null) continue;
    occurrences.push({
      source: match.kind,
      kind: 'path',
      path: binding.parsed.statePathName,
      pathRange: shift(binding.pathRange),
      exprRange: { start: match.exprStart, end: match.exprEnd },
      propName: null,
      propRange: null,
      bindingType: 'text',
    });
  }

  // --- 宣言側: <wcs-state> インラインスクリプトのトップレベル宣言 ---
  const declarations: IDeclarationSite[] = [];
  for (const block of parseWcsScriptBlocks(html, stateTagName)) {
    // ボリューム（mount=）の宣言はマウントパス接頭辞でツリーに載る（v2）。
    // `$` 宣言は**パスとしては**マウント越しに表現できないため索引に載せない
    //（runtime は $watch / $listKeys / $updatedCallback を翻訳・相対配送で実行する —
    // パス索引の対象にならないだけで「実行しない」わけではない。$streams は raise・
    // トークンは warn）
    const prefix = block.mountPath === null ? '' : block.mountPath + '.';
    for (const span of analyzeDeclarationSpans(block.content)) {
      if (prefix !== '' && span.name.startsWith('$')) continue;
      declarations.push({
        name: prefix + span.name,
        kind: span.kind,
        range: { start: block.contentStart + span.start, end: block.contentStart + span.end },
      });
    }
  }

  // --- 索引化 ---
  // eventToken 出現はパス空間に入れない（トークン名とデータプロパティの同名衝突で
  // referencesOf / declarationOf が誤解決するのを防ぐ）。occurrences には残る。
  const byPath = new Map<string, IPathOccurrence[]>();
  for (const occurrence of occurrences) {
    if (occurrence.kind !== 'path') continue;
    const key = occurrence.path;
    const list = byPath.get(key);
    if (list === undefined) {
      byPath.set(key, [occurrence]);
    } else {
      list.push(occurrence);
    }
  }
  const declarationByName = new Map<string, IDeclarationSite>();
  for (const declaration of declarations) {
    const key = declaration.name;
    // 同名宣言（get/set ペア等）は最初の宣言を正とする
    if (!declarationByName.has(key)) declarationByName.set(key, declaration);
  }

  return {
    occurrences,
    declarations,
    problems,
    referencesOf(path) {
      // 内部配列を渡すと呼び出し側の変異でインデックスが壊れるため複製を返す
      return (byPath.get(path) ?? []).slice();
    },
    declarationOf(path) {
      const exact = declarationByName.get(path);
      if (exact !== undefined) return exact;
      const firstSegment = path.split('.')[0];
      if (firstSegment === path) return null;
      return declarationByName.get(firstSegment) ?? null;
    },
    occurrenceAt(offset) {
      for (const occurrence of occurrences) {
        if (offset >= occurrence.pathRange.start && offset < occurrence.pathRange.end) {
          return occurrence;
        }
      }
      return null;
    },
  };
}
