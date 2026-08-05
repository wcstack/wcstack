/**
 * list/listKeys.ts
 *
 * `$listKeys: { <listPath>: <fieldName | (row) => key> }` 宣言マップを解析し、
 * 「リストパス → キー指定」表を構築する（docs/state-list-key-design.md §3）。
 *
 * この表が存在するリストパスへの配列代入は、setByAddress でキー突合され、
 * 一致行は旧オブジェクトを据え置いたまま変化フィールドだけが per-path 書き込みで
 * 流し込まれる（§2）。未宣言なら書き込み経路は従来と完全に同一。
 *
 * 「そのパスが実際にリストか」は宣言時には判定できない（listPaths は
 * バインディング収集時に確定する）。実行時に配列でなければ経路に入らないだけで、
 * 宣言自体はエラーにしない。
 */

import { DELIMITER, STATE_LIST_KEYS_NAME, WILDCARD } from "../define";
import { raiseError } from "../raiseError";
import type { IState } from "../types";

/** キー指定: フラットなフィールド名、または行から複合キーを作る関数 */
export type ListKeySpec = string | ((row: any) => unknown);

export type ListKeyMap = ReadonlyMap<string, ListKeySpec>;

/**
 * `$listKeys` 宣言を検証して Map 化する。宣言が無ければ null（＝ゼロコスト経路）。
 *
 * 検証内容（§3.1）:
 * - `$listKeys` はオブジェクト
 * - パスは非空文字列 / 空セグメント・先頭末尾の `.` を禁止
 * - パス末尾が `*` であることを禁止（リストパスであって要素パスではない）
 * - キー指定は非空文字列か関数
 * - 文字列キーは `.` / `*` を含まないフラットなフィールド名
 * - `Object.prototype` 継承名を禁止（`__proto__` / `constructor` 等）
 */
export function processListKeysDeclaration(state: IState): ListKeyMap | null {
  const declared = (state as Record<string, unknown>)[STATE_LIST_KEYS_NAME];
  if (typeof declared === "undefined") {
    return null;
  }
  if (typeof declared !== "object" || declared === null) {
    raiseError(`${STATE_LIST_KEYS_NAME} must be an object mapping list paths to key specs.`);
  }
  const entries = new Map<string, ListKeySpec>();
  for (const [path, spec] of Object.entries(declared as Record<string, unknown>)) {
    if (path.length === 0) {
      raiseError(`${STATE_LIST_KEYS_NAME} entry path must be a non-empty string.`);
    }
    const segments = path.split(DELIMITER);
    if (segments.some((segment) => segment.length === 0)) {
      raiseError(`${STATE_LIST_KEYS_NAME} entry "${path}" must not contain empty path segments.`);
    }
    if (segments[segments.length - 1] === WILDCARD) {
      raiseError(
        `${STATE_LIST_KEYS_NAME} entry "${path}" must be the list path itself, not the element path ` +
        `(drop the trailing "${DELIMITER}${WILDCARD}").`
      );
    }
    if (typeof spec === "function") {
      entries.set(path, spec as (row: any) => unknown);
      continue;
    }
    if (typeof spec !== "string") {
      raiseError(
        `${STATE_LIST_KEYS_NAME} entry "${path}" key spec must be a field name (string) or a function.`
      );
    }
    if (spec.length === 0) {
      raiseError(`${STATE_LIST_KEYS_NAME} entry "${path}" key field name must be a non-empty string.`);
    }
    if (spec.includes(DELIMITER) || spec.includes(WILDCARD)) {
      raiseError(
        `${STATE_LIST_KEYS_NAME} entry "${path}" key field name "${spec}" must be a flat property name ` +
        `("${DELIMITER}" / "${WILDCARD}" are not allowed).`
      );
    }
    // own key でなくても `in` 判定が真になる継承名は、キー抽出が prototype 由来の
    // 値（constructor など）を拾って全行同一キー扱いになるため名前の防衛線で落とす。
    if (spec in Object.prototype) {
      raiseError(
        `${STATE_LIST_KEYS_NAME} entry "${path}" key field name "${spec}" must not be a property name ` +
        `inherited from Object.prototype (e.g. "__proto__", "constructor").`
      );
    }
    entries.set(path, spec);
  }
  return entries.size > 0 ? entries : null;
}
