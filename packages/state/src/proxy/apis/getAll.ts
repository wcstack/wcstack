/**
 * getAllReadonly
 *
 * ワイルドカードを含む State パスから、対象となる全要素を配列で取得する。
 * 走査そのものは `$setAll` と共有する（wildcardIndexes.ts）。
 * Throws: LIST-201（インデックス未解決）、BIND-201（ワイルドカード情報不整合）
 */

import { getPathInfo } from "../../address/PathInfo";
import { indexArityMessage } from "../../pathDiagnostics";
import { raiseError } from "../../raiseError";
import { getScopedIndexes } from "../../list/wildcardLevel";
import { getBaseDepth } from "../../webComponent/baseListIndex";
import { getContextListIndex } from "../methods/getContextListIndex";
import { IStateHandler } from "../types";
import { collectWildcardIndexes } from "./wildcardIndexes";
import { resolve } from "./resolve";

type GetAllFunction = (path: string, indexes?: number[]) => any[];

export function getAll(
  target: object,
  prop: PropertyKey,
  receiver: any,
  handler: IStateHandler
): GetAllFunction {
    const resolveFn = resolve(target, prop, receiver, handler);
    return (path: string, indexes?: number[]): any[] => {
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
      // 読みなので差分基準を更新する（`$setAll` は更新しない。設計 §6-2）
      const resultIndexes = collectWildcardIndexes(
        target, receiver, handler, pathInfo, indexes, { commitDiffBaseline: true });
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
