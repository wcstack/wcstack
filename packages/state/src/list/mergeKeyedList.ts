/**
 * list/mergeKeyedList.ts
 *
 * `$listKeys` 宣言済みリストパスへの配列代入で、キーが一致する行の
 * 「オブジェクト強制・値展開」を行う（docs/state-list-key-design.md §2）。
 *
 * - キー突合し、一致行は**旧オブジェクトを据え置いた**ハイブリッド配列を作る
 *   → 配列要素の参照が変わらないので for は行を再利用する（DOM・フォーカス・
 *     非バインド DOM 状態が保存される）
 * - 一致行の「変化したフィールド」だけを列挙して返す
 *   → 呼び出し側が per-path 書き込みとして発行する（§7.0 の穴を塞ぐ正典イディオム）
 *
 * このモジュールは純粋な計算のみで、state への書き込みは行わない。
 */

import { STATE_LIST_KEYS_NAME } from "../define";
import { raiseError } from "../raiseError";
import type { ListKeySpec } from "./listKeys";

type Row = Record<string, unknown>;

/** キーが一致し、旧オブジェクトへ値展開すべき行 */
export interface IKeyedRowMatch {
  /** ハイブリッド配列上の位置（= 新配列上の位置） */
  readonly position: number;
  /** 据え置かれる旧行オブジェクト（書き込み先） */
  readonly oldRow: Row;
  /** 値の供給元となる新行オブジェクト（格納はされない） */
  readonly newRow: Row;
}

export interface IKeyedListMerge {
  /** 実際に格納すべきハイブリッド配列（一致行は旧オブジェクト） */
  readonly list: unknown[];
  /** 値展開が必要な一致行。空にはならない（空なら mergeKeyedList が null を返す） */
  readonly matched: readonly IKeyedRowMatch[];
}

export interface IFieldWrite {
  readonly field: string;
  readonly value: unknown;
}

/**
 * 値展開は own enumerable データプロパティのコピーなので、プロトタイプや
 * アクセサを持つオブジェクトでは意味論が保てない。plain object 以外は即エラー（§5）。
 */
function assertPlainRow(row: unknown, path: string, side: string, position: number): asserts row is Row {
  if (typeof row !== "object" || row === null) {
    raiseError(
      `${STATE_LIST_KEYS_NAME} list "${path}": ${side} row at index ${position} must be a plain object ` +
      `(got ${row === null ? "null" : typeof row}).`
    );
  }
  const proto = Object.getPrototypeOf(row);
  if (proto !== Object.prototype && proto !== null) {
    raiseError(
      `${STATE_LIST_KEYS_NAME} list "${path}": ${side} row at index ${position} must be a plain object ` +
      `(class instances and exotic objects cannot be value-expanded).`
    );
  }
}

function keyOf(row: Row, spec: ListKeySpec, path: string, side: string, position: number): unknown {
  const key = typeof spec === "function" ? spec(row) : row[spec];
  if (key === undefined || key === null) {
    raiseError(
      `${STATE_LIST_KEYS_NAME} list "${path}": ${side} row at index ${position} has no key ` +
      `(${typeof spec === "function" ? "key function" : `field "${spec}"`} returned ${String(key)}).`
    );
  }
  return key;
}

/** 行を検証しつつキーを抽出する。キー重複は即エラー（§5）。 */
function extractKeys(list: readonly unknown[], spec: ListKeySpec, path: string, side: string): unknown[] {
  const keys: unknown[] = new Array(list.length);
  const seen = new Set<unknown>();
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    assertPlainRow(row, path, side, i);
    const key = keyOf(row, spec, path, side, i);
    if (seen.has(key)) {
      raiseError(`${STATE_LIST_KEYS_NAME} list "${path}": duplicate key ${JSON.stringify(key)} in ${side} list.`);
    }
    seen.add(key);
    keys[i] = key;
  }
  return keys;
}

/**
 * キー突合してハイブリッド配列を組む。値展開すべき一致行が 1 つも無ければ null
 * （呼び出し側は従来どおりの書き込みへ倒す）。
 *
 * 突合対象の旧配列は「最後に適用された配列」ではなく**現在格納されている配列**。
 * ハイブリッド構築が格納配列の参照を保存するため、同一マイクロタスク内の連続
 * 書き込みでも適用時の diff と transitive に整合する（§6）。
 */
export function mergeKeyedList(
  path: string,
  spec: ListKeySpec,
  oldValue: unknown,
  newList: readonly unknown[],
): IKeyedListMerge | null {
  // 宣言済みパスなら初回代入（旧配列なし）でも新配列を検証する。
  // 「2 回目の代入で初めて重複キーが露見する」という不連続を避けるため。
  const newKeys = extractKeys(newList, spec, path, "new");
  if (!Array.isArray(oldValue) || oldValue.length === 0 || newList.length === 0) {
    return null;
  }
  const oldList: readonly unknown[] = oldValue;
  const oldKeys = extractKeys(oldList, spec, path, "current");
  const oldRowByKey = new Map<unknown, Row>();
  for (let i = 0; i < oldList.length; i++) {
    oldRowByKey.set(oldKeys[i], oldList[i] as Row);
  }

  const list: unknown[] = new Array(newList.length);
  const matched: IKeyedRowMatch[] = [];
  for (let i = 0; i < newList.length; i++) {
    const newRow = newList[i] as Row;
    const oldRow = oldRowByKey.get(newKeys[i]);
    if (typeof oldRow === "undefined" || oldRow === newRow) {
      // 追加行、または既に同一オブジェクト（生配列 in-place 変異 + コピー再代入の
      // イディオム）。後者は従来どおり walkDependency の全行フォールバックが担う。
      list[i] = newRow;
      continue;
    }
    list[i] = oldRow;
    matched.push({ position: i, oldRow, newRow });
  }
  return matched.length > 0 ? { list, matched } : null;
}

/**
 * 一致行について per-path 書き込みすべきフィールドを列挙する。
 *
 * - 変化したフィールドのみ（同値は書かない。無変化リフレッシュを完全なゼロコストに
 *   するため — 全フィールド無条件書き込みだと §2.2 の利得が消える）
 * - 新行から消えた旧フィールドは **null** を書く（undefined ではない）
 *
 * 同値判定は Object.is。setByAddress の same-value guard と同じ基準にすることで、
 * 「発行したが guard に落とされる」無駄な書き込みを作らない。
 *
 * 消えたフィールドに null を使うのは、この処理系では undefined が
 * 「状態が値を持たない＝無意見」であり applyChangeToProperty が書き込みごと
 * スキップするため（明示的なクリアの語彙は null）。undefined を書くと state 側は
 * 更新されるのに DOM だけ旧値のまま残り、まさに本機能が塞ごうとしている
 * stale を再導入してしまう。既に null / undefined のフィールドは DOM 上も
 * 空なので、クリア書き込み自体を発行しない。
 */
export function collectFieldWrites(oldRow: Row, newRow: Row): IFieldWrite[] {
  const writes: IFieldWrite[] = [];
  for (const field of Object.keys(newRow)) {
    if (!Object.is(oldRow[field], newRow[field])) {
      writes.push({ field, value: newRow[field] });
    }
  }
  for (const field of Object.keys(oldRow)) {
    if (!Object.hasOwn(newRow, field) && oldRow[field] != null) {
      writes.push({ field, value: null });
    }
  }
  return writes;
}
