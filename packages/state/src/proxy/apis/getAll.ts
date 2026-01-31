/**
 * getAllReadonly
 *
 * ワイルドカードを含む State パスから、対象となる全要素を配列で取得する。
 * Throws: LIST-201（インデックス未解決）、BIND-201（ワイルドカード情報不整合）
 */

import { getPathInfo } from "../../address/PathInfo";
import { createStateAddress } from "../../address/StateAddress";
import { IPathInfo, IStateAddress } from "../../address/types";
import { getListIndexesByList } from "../../list/listIndexesByList";
import { IListIndex } from "../../list/types";
import { raiseError } from "../../raiseError";
import { getByAddress } from "../methods/getByAddress";
import { getContextListIndex } from "../methods/getContextListIndex";
import { IStateHandler } from "../types";
import { resolve } from "./resolve";

export function getAll(
  target: Object, 
  prop: PropertyKey, 
  receiver: any,
  handler: IStateHandler
):Function {
    const resolveFn = resolve(target, prop, receiver, handler);
    return (path: string, indexes?: number[]): any[] => {
      const pathInfo = getPathInfo(path);
      const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
      const stateElement = handler.stateElement;
      if (lastInfo !== null && lastInfo.path !== pathInfo.path) {
        // gettersに含まれる場合は依存関係を登録
        if (stateElement.getterPaths.has(lastInfo.path)) {
          stateElement.addDynamicDependency(pathInfo.path, lastInfo.path);
        }
      }
  
      if (typeof indexes === "undefined") {
        for(let i = 0; i < pathInfo.wildcardParentPathInfos.length; i++) {
          const wildcardPattern = pathInfo.wildcardParentPathInfos[i] ?? 
            raiseError('wildcardPattern is null');
          const listIndex = getContextListIndex(handler, wildcardPattern.path);
          if (listIndex) {
            indexes = listIndex.indexes;
            break;
          }
        }
        if (typeof indexes === "undefined") {
          indexes = [];
        }
      }
      const walkWildcardPattern = (
        wildcardParentPathInfos: IPathInfo[],
        wildardIndexPos: number,
        listIndex: IListIndex | null,
        indexes: number[],
        indexPos: number,
        parentIndexes: number[],
        results: number[][]
      ) => {
        const wildcardParentPathInfo = wildcardParentPathInfos[wildardIndexPos] ?? null;
        if (wildcardParentPathInfo === null) {
          results.push(parentIndexes);
          return;
        }
        const wildcardAddress = createStateAddress(wildcardParentPathInfo, listIndex);
        const tmpValue = getByAddress(target, wildcardAddress, receiver, handler);
        const listIndexes = getListIndexesByList(tmpValue);
        if (listIndexes === null) {
          raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
        }
        const index = indexes[indexPos] ?? null;
        if (index === null) {
          for(let i = 0; i < listIndexes.length; i++) {
            const listIndex = listIndexes[i];
            walkWildcardPattern(
              wildcardParentPathInfos, 
              wildardIndexPos + 1, 
              listIndex, 
              indexes, 
              indexPos + 1, 
              parentIndexes.concat(listIndex.index),
              results);
          }
        } else {
          const listIndex = listIndexes[index] ?? 
            raiseError(`ListIndex not found: ${wildcardParentPathInfo.path}`);
          if ((wildardIndexPos + 1) < wildcardParentPathInfos.length) {
            walkWildcardPattern(
              wildcardParentPathInfos, 
              wildardIndexPos + 1, 
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
      const resultValues: any[] = [];
      for(let i = 0; i < resultIndexes.length; i++) {
        resultValues.push(resolveFn(
          pathInfo.path,
          resultIndexes[i]
        ));
      }
      return resultValues;
    }
  }

