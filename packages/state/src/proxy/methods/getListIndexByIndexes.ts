/**
 * getListIndexByIndexes.ts
 *
 * 解決済みの添字タプル（ワイルドカード 1 段につき 1 個）から、対応する ListIndex を
 * **正本レジストリ**（listIndexesByList）経由で引き当てる。
 *
 * `$resolve` と `$setAll` の共有部分。列挙側（wildcardIndexes.ts）が走査中に生成した
 * ListIndex をそのまま書き込み先にせず、ここで引き直すことで、binding が使っている
 * ListIndex と同一の同一性に載る（docs/state-set-all-design.md §6-2）。
 *
 * 添字の本数がワイルドカードの本数と一致していることは呼び出し側の責務。
 */

import { createStateAddress } from "../../address/StateAddress";
import { IPathInfo } from "../../address/types";
import { getListIndexesByList } from "../../list/listIndexesByList";
import { IListIndex } from "../../list/types";
import { raiseError } from "../../raiseError";
import { IStateHandler } from "../types";
import { getByAddress } from "./getByAddress";

export function getListIndexByIndexes(
  target  : object,
  receiver: any,
  handler : IStateHandler,
  pathInfo: IPathInfo,
  indexes : number[],
): IListIndex | null {
  // ワイルドカード階層ごとにListIndexを解決していく
  let listIndex: IListIndex | null = null;
  for(let i = 0; i < pathInfo.wildcardParentPathInfos.length; i++) {
    const wildcardParentPathInfo = pathInfo.wildcardParentPathInfos[i];
    const wildcardAddress = createStateAddress(wildcardParentPathInfo, listIndex);
    const tmpValue = getByAddress(target, wildcardAddress, receiver, handler);
    const listIndexes = getListIndexesByList(tmpValue);
    if (listIndexes == null) {
      raiseError(`ListIndexes not found: ${wildcardParentPathInfo.path}`);
    }
    const index = indexes[i];
    // 範囲外 index はリスト自体の不在と別原因なので index を含める
    // （docs/state-bind-component-nested-for-design.md §8.4）
    listIndex = listIndexes[index] ??
      raiseError(`ListIndex not found at index ${index} of ${wildcardParentPathInfo.path}`);
  }
  return listIndex;
}
