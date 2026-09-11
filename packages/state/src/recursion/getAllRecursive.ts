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

import { IStateAddress } from "../address/types";
import { getByAddress } from "../proxy/methods/getByAddress";
import { IStateHandler } from "../proxy/types";
import { splitRecursivePath } from "./expand";
import { collectRecursiveAddresses } from "./walk";
import { raiseError } from "../raiseError";

/** 合併形が触るアドレス列。`$setAll` のブロードキャストと共有する。 */
export function resolveRecursiveAddresses(
  target: object,
  receiver: any,
  handler: IStateHandler,
  path: string,
  commitDiffBaseline: boolean,
): IStateAddress[] {
  // 呼び出し元（getAll.ts / setAllRecursive.ts）は `hasRecursion === true` をゲートにしている。
  const registry = handler.stateElement.recursionRegistry
    ?? raiseError(`Recursion registry is missing while walking "${path}"; hasRecursion must gate this call.`);
  const parts = splitRecursivePath(registry.spec, path);
  if (parts === null) {
    raiseError(
      `[wcs/recursion-anchor] "${path}" does not match the declared recursion anchor ` +
      `"${registry.spec.recursiveAnchor}". This version supports exactly one anchor per state.`
    );
  }
  return collectRecursiveAddresses(
    target, receiver, handler, registry.spec, parts.suffix, { commitDiffBaseline });
}

export function getAllRecursive(
  target: object,
  receiver: any,
  handler: IStateHandler,
  path: string,
): any[] {
  // 読みなので差分基準を更新する（`$setAll` は更新しない。設計 §6-2）
  const addresses = resolveRecursiveAddresses(target, receiver, handler, path, true);
  const values: any[] = [];
  for (let i = 0; i < addresses.length; i++) {
    // `**` は依存グラフに載らない（D2）。呼び出し元の getter は「触れた深さの
    // 具体パス」に依存する — その登録は getByAddress の checkDependency が行う
    // （他行読み取りの検出も含む）。ここで書き写すと untrack を見ない劣化版になる。
    values.push(getByAddress(target, addresses[i], receiver, handler));
  }
  return values;
}
