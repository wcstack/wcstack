/**
 * getAllReadonly
 *
 * ワイルドカードを含む State パスから、対象となる全要素を配列で取得する。
 * 走査そのものは `$setAll` と共有する（wildcardIndexes.ts）。
 *
 * `indexes` 省略時の既定はループ文脈の添字 `[$1..$n]`。正確には「path と文脈が
 * 共有するワイルドカード連鎖の分だけ文脈の添字を接頭辞として敷く」（整合最長接頭辞）。
 * 共有が無いのに文脈が添字を持つ場合は throw する — 異なる文脈の添字は流用しない。
 *
 * Throws: LIST-201（インデックス未解決）、BIND-201（ワイルドカード情報不整合）、
 * 添字本数超過（wcs/index-arity）、省略時の文脈不整合（getAllContextMismatchMessage）
 */

import { getPathInfo } from "../../address/PathInfo";
import { getAllContextMismatchMessage, indexArityMessage } from "../../pathDiagnostics";
import { raiseError } from "../../raiseError";
import { getScopedIndexes } from "../../list/wildcardLevel";
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
        // 省略時の既定はループ文脈の添字 `[$1..$n]`。ただし敷けるのは path と文脈が
        // **共有するワイルドカード連鎖**の分だけなので、path のワイルドカードを
        // 内側（最深）から探し、最初に文脈にヒットした階層の scoped indexes を接頭辞にする。
        // ワイルドカードパスの序数はパス文字列自身の `*` の本数で決まるため、深い側が
        // ヒットすれば浅い側は必ず含まれ、これが整合する最長の接頭辞になる。文脈が
        // path より深い分は自然に切り詰められ、導出した接頭辞は path のワイルドカード
        // 本数を超えないので、上の本数検査には掛けない。
        for (let i = pathInfo.wildcardPaths.length - 1; i >= 0; i--) {
          const listIndex = getContextListIndex(handler, pathInfo.wildcardPaths[i]);
          if (listIndex) {
            indexes = getScopedIndexes(listIndex, listIndex.length);
            break;
          }
        }
        if (typeof indexes === "undefined") {
          // 共有ゼロ。文脈が自スコープの添字を実際に持っているなら、既定の `[...$n]` は
          // **異なる文脈の添字の流用（混入）**になるため、黙って全展開へ倒さず throw する。
          // 文脈そのものが無い（トップレベル getter / メソッド直下）なら全展開が既定。
          const lastAddress = handler.addressStackLength > 0 ? handler.lastAddressStack : null;
          const contextListIndex = lastAddress?.listIndex ?? null;
          if (pathInfo.wildcardCount > 0 && lastAddress !== null && contextListIndex !== null &&
              contextListIndex.length > 0) {
            raiseError(getAllContextMismatchMessage(path, lastAddress.pathInfo.path));
          }
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
