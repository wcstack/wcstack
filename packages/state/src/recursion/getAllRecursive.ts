/**
 * recursion/getAllRecursive.ts
 *
 * `$getAll("<anchor>.**.<suffix>", [])` — **全深さの合併**（設計書 D7 / §6-2）。
 *
 * 省略形（文脈束縛）とは別経路にする。省略形は「いま評価している深さの 1 本」を
 * 具体パスに直して既存の固定 arity 走査へ渡すだけだが、合併形は深さそのものを
 * 走査対象にするので、返る添字タプルの長さが結果ごとに変わる。だから合併形は
 * **値の配列しか返さない**（`$resolve` への往復は保証しない。設計書 §7-2）。
 */

import { getByAddress } from "../proxy/methods/getByAddress";
import { IStateHandler } from "../proxy/types";
import { splitRecursivePath } from "./expand";
import { collectRecursiveAddresses } from "./walk";
import { raiseError } from "../raiseError";

export function getAllRecursive(
  target: object,
  receiver: any,
  handler: IStateHandler,
  path: string,
  indexes: unknown,
): any[] {
  // 呼び出し元（getAll.ts）は `hasRecursion === true` をゲートにしている。
  const registry = handler.stateElement.recursionRegistry!;
  // 判定順はアンカー照合 → 添字の形。静的側（vscode-wcs recursionValidator）と同じ順に
  // しておかないと、綴り違いのアンカーに `[0]` を渡した呼び出しが片側では
  // `recursion-anchor`、もう片側では `recursion-getall-form` になる。
  const parts = splitRecursivePath(registry.spec, path);
  if (parts === null) {
    raiseError(
      `[wcs/recursion-anchor] "${path}" does not match the declared recursion anchor ` +
      `"${registry.spec.recursiveAnchor}". This version supports exactly one anchor per state.`
    );
  }
  // 合併形の添字は `[]` だけ。`null` 等の非配列は素の TypeError にせず、形の診断にする。
  if (!Array.isArray(indexes)) {
    raiseError(
      `[wcs/recursion-getall-form] $getAll("${path}", indexes) with "**" takes either no indexes ` +
      `(to read the depth of the recursive getter being evaluated) or [] (to walk every depth) — ` +
      `got ${indexes === null ? "null" : typeof indexes}.`
    );
  }
  if (indexes.length > 0) {
    raiseError(
      `[wcs/recursion-getall-form] $getAll("${path}", indexes) with "**" takes no partial ` +
      `prefix: a prefix cannot say which depth it applies to. Omit the indexes to read the ` +
      `depth of the recursive getter being evaluated, or pass [] to walk every depth.`
    );
  }
  // 読みなので観測したリスト値を差分基準へ確定する（再帰の `$setAll` も同じ。
  // 固定 arity の `$setAll` だけが確定しない — setAllRecursive.ts 第 1 相の注記）。
  const addresses = collectRecursiveAddresses(
    target, receiver, handler, registry.spec, parts.suffix, { commitDiffBaseline: true });
  const values: any[] = [];
  for (let i = 0; i < addresses.length; i++) {
    // `**` は依存グラフに載らない（D2）。呼び出し元の getter は「触れた深さの
    // 具体パス」に依存する — その登録は getByAddress の checkDependency が行う
    // （他行読み取りの検出も含む）。ここで書き写すと untrack を見ない劣化版になる。
    values.push(getByAddress(target, addresses[i], receiver, handler));
  }
  return values;
}
