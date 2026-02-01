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
 * - getListIndexesByListで各階層のリストインデックス集合を取得
 * - エラー時はraiseErrorで例外を投げる
 */

import { createStateAddress } from "../../address/StateAddress";
import { IResolvedAddress } from "../../address/types";
import { getListIndexesByList } from "../../list/listIndexesByList";
import { IListIndex } from "../../list/types";
import { raiseError } from "../../raiseError";
import { IStateHandler } from "../types";
import { getByAddress } from "./getByAddress";
import { getContextListIndex } from "./getContextListIndex";

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
        const wildcardParentListIndexes: IListIndex[] = getListIndexesByList(wildcardParentValue) ?? 
          raiseError( `ListIndex not found: ${wildcardParentPathInfo.path}`);
        const wildcardIndex = resolvedAddress.wildcardIndexes[i] ?? 
          raiseError(`wildcardIndex is null: ${resolvedAddress.pathInfo.path}`);
        parentListIndex = wildcardParentListIndexes[wildcardIndex] ?? 
          raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
      }
      return parentListIndex;
    }
    case "partial": {
      raiseError(`Partial wildcard type is not supported yet: ${resolvedAddress.pathInfo.path}`);
    }
  }
}
