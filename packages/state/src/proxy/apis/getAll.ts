/**
 * getAllReadonly
 *
 * ワイルドカードを含む State パスから、対象となる全要素を配列で取得する。
 * Throws: LIST-201（インデックス未解決）、BIND-201（ワイルドカード情報不整合）
 */

import { getPathInfo } from "../../address/PathInfo";
import { createStateAddress } from "../../address/StateAddress";
import { IPathInfo, IStateAddress } from "../../address/types";
import { createListDiff } from "../../list/createListDiff";
import { IListIndex } from "../../list/types";
import { indexArityMessage } from "../../pathDiagnostics";
import { raiseError } from "../../raiseError";
import { getScopedIndexes } from "../../list/wildcardLevel";
import { getBaseDepth, getListParentListIndex } from "../../webComponent/baseListIndex";
import { getByAddress } from "../methods/getByAddress";
import { getContextListIndex } from "../methods/getContextListIndex";
import { IStateHandler } from "../types";
import { resolve } from "./resolve";

// ToDo: IAbsoluteStateAddressに変更する
const lastValueByListAddress = new WeakMap<IStateAddress, unknown[]>();

type GetAllFunction = (path: string, indexes?: number[]) => any[];

export function getAll(
  target: object, 
  prop: PropertyKey, 
  receiver: any,
  handler: IStateHandler
): GetAllFunction {
    const resolveFn = resolve(target, prop, receiver, handler);
    return (path: string, indexes?: number[]): any[] => {
      const newValueByAddress: Map<IStateAddress, any> = new Map();
      const pathInfo = getPathInfo(path);
      if (handler.addressStackLength > 0) {
        const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
        const stateElement = handler.stateElement;
        if (lastInfo !== null && lastInfo.path !== pathInfo.path) {
          // gettersに含まれる場合は依存関係を登録
          if (stateElement.getterPaths.has(lastInfo.path)) {
            stateElement.addDynamicDependency(pathInfo.path, lastInfo.path);
          }
        }
      }
  
      // 明示的に渡された添字だけを検査する。`$getAll` の添字は**前方一致の接頭辞**で、
      // 足りない分は「その階層を全部展開する」という正しい意味を持つ（README の
      // `$getAll("scores.*", [])` がこれ）。一方**超過は意味を持たず黙って捨てられ**、
      // ワイルドカードの本数を取り違えたまま部分集合が返っていた。
      // 省略時に下で導出する添字は文脈由来なので、この検査には掛けない。
      if (typeof indexes !== "undefined" && indexes.length > pathInfo.wildcardParentPathInfos.length) {
        raiseError(indexArityMessage("$getAll", path, pathInfo.wildcardParentPathInfos.length, indexes.length));
      }
      if (typeof indexes === "undefined") {
        for(let i = 0; i < pathInfo.wildcardParentPathInfos.length; i++) {
          const wildcardPattern = pathInfo.wildcardParentPathInfos[i];
          const listIndex = getContextListIndex(handler, wildcardPattern.path);
          if (listIndex) {
            indexes = getScopedIndexes(listIndex, listIndex.length - getBaseDepth(handler.stateElement));
            break;
          }
        }
        if (typeof indexes === "undefined") {
          indexes = [];
        }
      }
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
      const resultValues: any[] = [];
      for(let i = 0; i < resultIndexes.length; i++) {
        resultValues.push(resolveFn(
          pathInfo.path,
          resultIndexes[i]
        ));
      }
      for(const [address, newValue] of newValueByAddress.entries()) {
        lastValueByListAddress.set(address, newValue);
      }
      return resultValues;
    }
  }
