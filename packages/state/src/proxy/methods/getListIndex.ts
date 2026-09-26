/**
 * getListIndex.ts
 *
 * StateClassの内部APIとして、パス情報（IResolvedAddress）から
 * 対応するリストインデックス（IListIndex）を取得する関数です。
 *
 * 主な役割:
 * - パスのワイルドカード種別（context/all/partial/none）に応じてリストインデックスを解決
 * - context型は現在のループコンテキストからリストインデックスを取得
 * - all型は各階層のリストインデックス集合からインデックスを辿って取得
 * - partial型やnone型は未実装またはnullを返す
 *
 * 設計ポイント:
 * - ワイルドカードや多重ループ、ネストした配列バインディングに柔軟に対応
 * - getListIndexesByAddressで各階層のリストインデックス集合を取得（台帳が無いリストは
 *   その場で台帳を生やす — for で描いていないリストの直接添字、#324）
 * - エラー時はraiseErrorで例外を投げる
 */

import { createStateAddress } from "../../address/StateAddress";
import { IResolvedAddress } from "../../address/types";
import { IListIndex } from "../../list/types";
import { raiseError } from "../../raiseError";
import { IStateHandler } from "../types";
import { getByAddress } from "./getByAddress";
import { getContextListIndex } from "./getContextListIndex";
import { getListIndexesByAddress } from "./getListIndexesByAddress";

export function getListIndex(
  target   : object, 
  resolvedAddress: IResolvedAddress, 
  receiver: any,
  handler: IStateHandler
): IListIndex | null {
  const pathInfo = resolvedAddress.pathInfo;
  switch (resolvedAddress.wildcardType) {
    case "none":
      return null;
    case "context": {
      const lastWildcardPath = pathInfo.wildcardPaths.at(-1) ?? 
        raiseError(`lastWildcardPath is null: ${resolvedAddress.pathInfo.path}`);
      return getContextListIndex(handler, lastWildcardPath) ?? 
        raiseError(`ListIndex not found: ${resolvedAddress.pathInfo.path}`);
    }
    case "all": {
      let parentListIndex: IListIndex | null = null;
      for(let i = 0; i < resolvedAddress.pathInfo.wildcardCount; i++) {
        const wildcardParentPathInfo = resolvedAddress.pathInfo.wildcardParentPathInfos[i] ?? 
          raiseError(`wildcardParentPathInfo is null: ${resolvedAddress.pathInfo.path}`);
        const wildcardParentAddress = createStateAddress(wildcardParentPathInfo, parentListIndex);
        const wildcardParentValue = getByAddress(target, wildcardParentAddress, receiver, handler);
        const wildcardParentListIndexes = getListIndexesByAddress(handler, wildcardParentAddress, wildcardParentValue);
        const wildcardIndex = resolvedAddress.wildcardIndexes[i] ?? 
          raiseError(`wildcardIndex is null: ${resolvedAddress.pathInfo.path}`);
        // 範囲外 index は、メッセージに index を含める。親パスだけを名指しすると
        // 「リスト自体が見つからない」と誤読させる（docs/state-bind-component-nested-for-design.md §8.4）。
        // 値が配列でないリストも、行 0 件としてここで投げる。
        parentListIndex = wildcardParentListIndexes[wildcardIndex] ??
          raiseError(`ListIndex not found at index ${wildcardIndex} of ${wildcardParentPathInfo.path}`);
      }
      return parentListIndex;
    }
    case "partial": {
      raiseError(`Partial wildcard type is not supported yet: ${resolvedAddress.pathInfo.path}`);
    }
  }
}
