/**
 * getListIndexByIndexes.ts
 *
 * 解決済みの添字タプル（ワイルドカード 1 段につき 1 個）から、対応する ListIndex を
 * **正本レジストリ**（listIndexesByList）経由で引き当てる。台帳が無いリスト（描画も走査も
 * 経ていない）はその場で台帳を生やす（getListIndexesByAddress、#324）。
 *
 * `$resolve` と `$setAll` の共有部分。列挙側（wildcardIndexes.ts）が走査中に生成した
 * ListIndex をそのまま書き込み先にせず、ここで引き直すことで、binding が使っている
 * ListIndex と同一の同一性に載る（docs/state-set-all-design.md §6-2）。
 *
 * 添字の本数がワイルドカードの本数と一致していることは呼び出し側の責務。
 */

import { createStateAddress } from "../../address/StateAddress";
import { IPathInfo } from "../../address/types";
import { IListIndex } from "../../list/types";
import { raiseError } from "../../raiseError";
import { IStateHandler } from "../types";
import { getByAddress } from "./getByAddress";
import { getListIndexesByAddress } from "./getListIndexesByAddress";

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
    const listIndexes = getListIndexesByAddress(handler, wildcardAddress, tmpValue);
    const index = indexes[i];
    // 範囲外 index は index を含めて投げる（docs/state-bind-component-nested-for-design.md §8.4）。
    // 値が配列でないリストも、行 0 件としてここで投げる
    listIndex = listIndexes[index] ??
      raiseError(`ListIndex not found at index ${index} of ${wildcardParentPathInfo.path}`);
  }
  return listIndex;
}
