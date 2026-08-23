/**
 * wildcardIndexes.ts
 *
 * ワイルドカードを含むパスから「解決済み添字タプルの集合」を列挙する共有走査。
 * `$getAll`（読み）と `$setAll`（書き）が**同じ展開規則・同じ順序**で動くための単一の正本
 * （docs/state-set-all-design.md §6-1）。
 *
 * 添字は**前方一致の接頭辞**で、足りない分は「その階層を全部展開する」という意味を持つ
 * （README の `$getAll("scores.*", [])` がこれ）。返るタプルは常にワイルドカードの本数と
 * 同じ長さになるので、そのまま `$resolve` の厳密一致な添字として使える。
 *
 * 順序は**深さ優先・添字昇順**（ネストは添字タプルの辞書順）で決定的。
 * `$getAll(p, i)` の戻り順と `$setAll(p, i, …)` の適用順が一致する根拠がこれであり、
 * `$setAll` の `{ spread: true }` 形はこの順序に乗っている。
 *
 * Throws: LIST-201（インデックス未解決）、BIND-201（ワイルドカード情報不整合）
 */

import { createStateAddress } from "../../address/StateAddress";
import { IPathInfo, IStateAddress } from "../../address/types";
import { createListDiff } from "../../list/createListDiff";
import { IListIndex } from "../../list/types";
import { raiseError } from "../../raiseError";
import { getListParentListIndex } from "../../webComponent/baseListIndex";
import { getByAddress } from "../methods/getByAddress";
import { IStateHandler } from "../types";

/**
 * 各ワイルドカード階層で最後に観測したリスト値。**次の読みの差分基準**であり、
 * ListIndex の同一性を跨いで保つために使う。
 *
 * 所有権は読み（`$getAll`）側にある。書き（`$setAll`）はこの走査を借りるだけで
 * 記録を更新しない（`commitDiffBaseline: false`。設計 §6-2）。
 */
// ToDo: IAbsoluteStateAddressに変更する
const lastValueByListAddress = new WeakMap<IStateAddress, unknown[]>();

export interface ICollectWildcardIndexesOptions {
  /**
   * 走査で観測したリスト値を差分基準として記録するか。
   * 読み（`$getAll`）だけが `true`。書き（`$setAll`）は読みの基準を動かさない。
   */
  readonly commitDiffBaseline: boolean;
}

/**
 * `pathInfo` のワイルドカードを `indexes`（前方一致の接頭辞）で絞り込みつつ展開し、
 * マッチする添字タプルを列挙する。
 *
 * 添字の本数検査（上限）は呼び出し側の責務 — API 名を診断メッセージに出すため。
 */
export function collectWildcardIndexes(
  target  : object,
  receiver: any,
  handler : IStateHandler,
  pathInfo: IPathInfo,
  indexes : number[],
  options : ICollectWildcardIndexesOptions,
): number[][] {
  const newValueByAddress: Map<IStateAddress, any> = new Map();

  const walkWildcardPattern = (
    wildcardParentPathInfos: IPathInfo[],
    wildcardIndexPos: number,
    listIndex: IListIndex | null,
    indexes: number[],
    indexPos: number,
    parentIndexes: number[],
    results: number[][]
  ) => {
    const wildcardParentPathInfo = wildcardParentPathInfos[wildcardIndexPos] ?? null;
    if (wildcardParentPathInfo === null) {
      results.push(parentIndexes);
      return;
    }
    const wildcardAddress = createStateAddress(wildcardParentPathInfo, listIndex);
    const oldValue = lastValueByListAddress.get(wildcardAddress);
    const newValue = getByAddress(target, wildcardAddress, receiver, handler);
    const listDiff = createListDiff(
      getListParentListIndex(handler.stateElement, listIndex), oldValue, newValue);
    const listIndexes = listDiff.newIndexes;
    const index = indexes[indexPos] ?? null;
    newValueByAddress.set(wildcardAddress, newValue);
    if (index === null) {
      for(let i = 0; i < listIndexes.length; i++) {
        const listIndex = listIndexes[i];
        walkWildcardPattern(
          wildcardParentPathInfos,
          wildcardIndexPos + 1,
          listIndex,
          indexes,
          indexPos + 1,
          parentIndexes.concat(listIndex.index),
          results);
      }
    } else {
      // 範囲外 index はリスト自体の不在と別原因なので index を含める
      // （docs/state-bind-component-nested-for-design.md §8.4）
      const listIndex = listIndexes[index] ??
        raiseError(`ListIndex not found at index ${index} of ${wildcardParentPathInfo.path}`);
      if ((wildcardIndexPos + 1) < wildcardParentPathInfos.length) {
        walkWildcardPattern(
          wildcardParentPathInfos,
          wildcardIndexPos + 1,
          listIndex,
          indexes,
          indexPos + 1,
          parentIndexes.concat(listIndex.index),
          results
        );
      } else {
        // 最終ワイルドカード層まで到達しているので、結果を確定
        results.push(parentIndexes.concat(listIndex.index));
      }
    }
  }

  const resultIndexes: number[][] = [];
  walkWildcardPattern(
    pathInfo.wildcardParentPathInfos,
    0,
    null,
    indexes,
    0,
    [],
    resultIndexes
  );
  if (options.commitDiffBaseline) {
    for(const [address, newValue] of newValueByAddress.entries()) {
      lastValueByListAddress.set(address, newValue);
    }
  }
  return resultIndexes;
}
