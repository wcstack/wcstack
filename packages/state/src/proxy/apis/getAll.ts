/**
 * getAllReadonly
 *
 * ワイルドカードを含む State パスから、対象となる全要素を配列で取得する。
 * Throws: LIST-201（インデックス未解決）、BIND-201（ワイルドカード情報不整合）
 */
import { getStructuredPathInfo } from "../../StateProperty/getStructuredPathInfo.js";
import { IStructuredPathInfo } from "../../StateProperty/types";
import { raiseError } from "../../utils.js";
import { IStateProxy, IStateHandler } from "../_types.js";
import { getContextListIndex } from "../methods/getContextListIndex";
import { IListIndex } from "../../ListIndex/types.js";
import { getStatePropertyRef } from "../../StatePropertyRef/StatepropertyRef.js";
import { resolve } from "./resolve.js";
import { getByRef } from "../methods/getByAddress.js";
import { GetListIndexesByRefSymbol } from "../_symbols.js";

export function getAll(
  target: Object, 
  prop: PropertyKey, 
  receiver: IStateProxy,
  handler: IStateHandler
):Function {
    const resolveFn = resolve(target, prop, receiver, handler);
    return (path: string, indexes?: number[]): any[] => {
      const info = getStructuredPathInfo(path);
      const lastInfo = handler.lastRefStack?.info ?? null;
      if (lastInfo !== null && lastInfo.pattern !== info.pattern) {
        // gettersに含まれる場合は依存関係を登録
        if (handler.engine.pathManager.onlyGetters.has(lastInfo.pattern)) {
          handler.engine.pathManager.addDynamicDependency(lastInfo.pattern, info.pattern);
        }
      }
  
      if (typeof indexes === "undefined") {
        for(let i = 0; i < info.wildcardInfos.length; i++) {
          const wildcardPattern = info.wildcardInfos[i] ?? raiseError({
            code: 'BIND-201',
            message: 'wildcardPattern is null',
            context: { index: i, infoPattern: info.pattern },
            docsUrl: '/docs/error-codes.md#bind',
            severity: 'error',
          });
          const listIndex = getContextListIndex(handler, wildcardPattern.pattern);
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
        wildcardParentInfos: IStructuredPathInfo[],
        wildardIndexPos: number,
        listIndex: IListIndex | null,
        indexes: number[],
        indexPos: number,
        parentIndexes: number[],
        results: number[][]
      ) => {
        const wildcardParentPattern = wildcardParentInfos[wildardIndexPos] ?? null;
        if (wildcardParentPattern === null) {
          results.push(parentIndexes);
          return;
        }
        const wildcardRef = getStatePropertyRef(wildcardParentPattern, listIndex);
        const tmpValue = getByRef(target, wildcardRef, receiver, handler);
        const listIndexes = receiver[GetListIndexesByRefSymbol](wildcardRef);
        if (listIndexes === null) {
          raiseError({
            code: 'LIST-201',
            message: `ListIndex not found: ${wildcardParentPattern.pattern}`,
            context: { pattern: wildcardParentPattern.pattern },
            docsUrl: '/docs/error-codes.md#list',
            severity: 'error',
          });
        }
        const index = indexes[indexPos] ?? null;
        if (index === null) {
          for(let i = 0; i < listIndexes.length; i++) {
            const listIndex = listIndexes[i];
            walkWildcardPattern(
              wildcardParentInfos, 
              wildardIndexPos + 1, 
              listIndex, 
              indexes, 
              indexPos + 1, 
              parentIndexes.concat(listIndex.index),
              results);
          }
        } else {
          const listIndex = listIndexes[index] ?? raiseError({
            code: 'LIST-201',
            message: `ListIndex not found: ${wildcardParentPattern.pattern}`,
            context: { pattern: wildcardParentPattern.pattern, index },
            docsUrl: '/docs/error-codes.md#list',
            severity: 'error',
          });
          if ((wildardIndexPos + 1) < wildcardParentInfos.length) {
            walkWildcardPattern(
              wildcardParentInfos, 
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
        info.wildcardParentInfos, 
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
          info.pattern,
          resultIndexes[i]
        ));
      }
      return resultValues;
    }
  }