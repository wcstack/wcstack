/**
 * indexPath.ts — 数値の添字を持つパス（`items.0.v`・`groups.0.items.1.v`・`groups.*.sel.0.id`）を
 * 4.0 のランタイムがどう読むか（#355・#383）。
 *
 * 正本は `@wcstack/state` 4.0 の `pattern.ts` の `parsePath`: 先頭が数字のセグメントは位置によらず
 * 添字で、`*` に読み替えた**パターン**と添字の組になる。マークアップに書いた数値添字のパスは、
 * 添字の数によらず「いまその位置にある行」を読み、添字のパスへの書き込み・要素の差し替え・
 * 並べ替えに追従する（F17。行 getter `items.*.double` も `items.0.double` で読める）。`*` と数値の
 * 添字が混ざるパス（行 getter の中の `this["groups.*.sel.0.id"]`・`$eq`）も、`*` は文脈の行、数字は
 * 添字として段ごとに解く（#383）。`for: groups.0.items` の行も追従する（F25）。
 *
 * したがって静的側は「数値の添字のパスは警告しない」。存在は、書いたままのパスが候補に無ければ
 * 添字を `*` に読み替えた形で照合する。数値のキーを持つオブジェクト（`sales.2024.total`）は
 * 書いたままの形が候補に当たるので、読み替えより先に完全一致を見る。
 */

import { getWcsManifest } from './wcsManifest.js';

/** 先頭が数字のセグメント（ランタイムの parsePath と同じ判定: `0`・`12`・`01`）。 */
const INDEX_SEGMENT = /^\d/;

/**
 * Whether a segment is a numeric index (starts with a digit). The runtime reads it as the row at that position when
 * the parent is a list, and as a plain key otherwise (an object keyed by number — `sales.2024`; engine.ts's
 * markupAccessor).
 */
export function isIndexSegment(segment: string): boolean {
  return INDEX_SEGMENT.test(segment);
}

/** 数値の添字（先頭が数字のセグメント）を 1 つでも持つか。 */
export function hasIndexSegment(path: string): boolean {
  return path.split('.').some((segment) => INDEX_SEGMENT.test(segment));
}

/**
 * 添字を `*` に読み替えたパターンの形（`groups.0.items.1.v` → `groups.*.items.*.v`）。
 * 数値の添字を持たないパスはそのまま返す。
 */
export function toWildcardForm(path: string): string {
  if (!hasIndexSegment(path)) return path;
  return path.split('.').map((segment) => (INDEX_SEGMENT.test(segment) ? '*' : segment)).join('.');
}

/**
 * 候補集合で引くキー: 書いたままのパスが候補にあればそれ、無ければ添字を `*` に読み替えた形
 * （型ヒント・存在の照合に使う）。
 */
export function candidateKeyOf(path: string, has: (candidate: string) => boolean): string {
  return has(path) ? path : toWildcardForm(path);
}

/** 正本パーサが #120（`[wcs/binding-syntax]`）で拒む段（4.0 の `public/parser.ts` の `withInfo`）。 */
const UNSAFE_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'prototype']);

/**
 * パスが `__proto__` / `prototype` の段を通るか。正本パーサはパスを指す右辺でこれを #120 として拒む
 * （bindingSyntaxValidator が `wcs/binding-syntax` で報告する）ので、存在の検査はそのパスに重ねない。
 * パスを指さない右辺（`$command.<名前>`・イベントトークン・単独のメソッド名）の判定は呼び手が行う。
 */
export function hasUnsafeSegment(path: string): boolean {
  return path.split('.').some((segment) => UNSAFE_SEGMENTS.has(segment));
}

// ------------------------------------------------------------------ loop index parameters ($1 … $128)

const { maxDepth } = getWcsManifest().syntax.indexParam;

/** ループの添字の上限（manifest の `syntax.indexParam.maxDepth` — ランタイムの `MAX_INDEX_PARAM`）。 */
export const MAX_INDEX_PARAM: number = maxDepth;

/**
 * ランタイムがループの添字と読む名前（4.0 の `parser/define.ts` の `INDEX_PARAM`: `$` の後に先頭が 0 でない
 * 数字を上限の桁数まで）。上限の桁数は manifest の上限から作る（`__tests__/indexParam.test.ts` が正本の正規表現と
 * 突き合わせる）。この形でも上限を超える添字（`$129`）は、読んだ時点で `[wcs/index-param-range]` になる。
 */
const INDEX_PARAM = new RegExp(`^\\$[1-9]\\d{0,${String(maxDepth).length - 1}}$`);

/** マークアップの右辺 `$` ＋数字だけのパス（`$1`・`$0`・`$129`・`$1000`）がランタイムで何になるか。 */
export type IndexParamKind =
  /** `$1`〜`$128`: ループの添字 */
  | { kind: 'index'; n: number }
  /** `$129`〜`$999`: 添字の形だが上限を超える（for の中ではバインディングが `[wcs/index-param-range]` で失敗する） */
  | { kind: 'range'; n: number }
  /** `$0`・`$01`・`$1000`: 添字ではなく、`$` の名前空間に状態のパスも無い（`[wcs/binding-path-missing]` で失敗する） */
  | { kind: 'notIndex' };

/** `$` ＋数字だけのパスを分類する。それ以外の形は null。 */
export function classifyIndexParam(path: string): IndexParamKind | null {
  if (!/^\$\d+$/.test(path)) return null;
  if (!INDEX_PARAM.test(path)) return { kind: 'notIndex' };
  const n = Number(path.slice(1));
  return n <= MAX_INDEX_PARAM ? { kind: 'index', n } : { kind: 'range', n };
}

/**
 * スクリプトの `this.<name>` が `[wcs/index-param-range]` で throw する名前か（4.0 の `engine.ts` の `dollar`:
 * `$` の次が数字なら、`$1`〜`$128` のほかはすべて投げる — `$0`・`$01`・`$129`・`$1000`・`$1x`）。
 */
export function isOutOfRangeIndexRead(name: string): boolean {
  if (name.length < 2 || name.charCodeAt(0) !== 36) return false;
  const c = name.charCodeAt(1);
  if (c < 48 || c > 57) return false;
  return !INDEX_PARAM.test(name) || Number(name.slice(1)) > MAX_INDEX_PARAM;
}
