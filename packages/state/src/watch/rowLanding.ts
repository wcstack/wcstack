/**
 * watch/rowLanding.ts
 *
 * ワイルドカードのパスの行の着地を、drain の時点のリストの位置 1 つにつき 1 つに絞る（#274）。
 * `$watch` と `$scan` の `from` が共有する（docs/state-scan-design.md D3・§5-5）。
 *
 * バッチに載る行のアドレスは、書き込みの時点の行を指す。同じ job でその後にリストを短くした・
 * 置き換えた・途中から取り除いた・`list.*` へ要素を書き込んだと、drain の時点ではアドレスの行が
 * もうその位置に居ないことがある。添字で読むと、範囲外の読みで throw するか、その位置にいま居る
 * 別の行の値で発火する。
 */

import { createStateAddress } from "../address/StateAddress";
import type { IAbsoluteStateAddress, IPathInfo } from "../address/types";
import { isSameListIndexValue } from "../list/createListIndex";
import { getListIndexesByList, isRetiredListIndex } from "../list/listIndexesByList";
import type { IListIndex } from "../list/types";
import { listIndexAtWildcard } from "../list/wildcardLevel";
import { getByAddressSymbol } from "../proxy/symbols";
import type { IStateProxy } from "../proxy/types";

export interface ILandingRow {
  readonly absAddress: IAbsoluteStateAddress;
  readonly indexes: readonly number[];
}

/** 行のアドレスと、いまのリストの位置の関係 */
type RowPlacement = "current" | "replaced" | "gone";

/**
 * 行の連鎖に、差分がリストから外した（退役した）行があるか。読むだけの前判定で、リストは読まない。
 * `$watch` はこれが真のヒット（か、同じ位置に重なるヒット）があるときだけ位置を引く。
 */
export function hasRetiredRow(listIndex: IListIndex): boolean {
  for (let row: IListIndex | null = listIndex; row !== null; row = row.parentListIndex) {
    if (isRetiredListIndex(row)) {
      return true;
    }
  }
  return false;
}

/**
 * 行のアドレスが、いまのリストのその位置とどう関係するか。外側の段から台帳を引く。
 * 読むだけ（`$scan` の計画の相・D18）なので、台帳は観測用の `getListIndexesByList` で引き、
 * 親ポインタを修理する `resolveListIndexesByList` は使わない。
 * - `gone`: その位置に行が無い（リストを短くした・空にした・配列でなくした）か、アドレスの行を
 *   差分がリストから外した（退役した — 行を取り除いた・リストを置き換えた）。
 * - `current`: その位置の行が、アドレスの行そのものか、同じリスト要素を表す行。
 * - `replaced`: その位置には別の要素の行が居るが、アドレスの行は差分に外されていない
 *   （`list.*` への要素の書き込みは、差分を通らずに台帳のその位置へ別の行を差し込む）。
 */
function placementOf(state: IStateProxy, pathInfo: IPathInfo, row: ILandingRow): RowPlacement {
  // ワイルドカードのパスの着地は、収集の段階で listIndex を持つものに限っている
  const listIndex = row.absAddress.listIndex as IListIndex;
  let placement: RowPlacement = "current";
  let parentListIndex: IListIndex | null = null;
  for (let level = 0; level < pathInfo.wildcardCount; level++) {
    const list = state[getByAddressSymbol](createStateAddress(pathInfo.wildcardParentPathInfos[level], parentListIndex));
    // 台帳を持たない値（配列でない・空の配列）は行が無い
    const current: IListIndex | undefined = getListIndexesByList(list as readonly unknown[])?.[row.indexes[level]];
    if (typeof current === "undefined") {
      return "gone";
    }
    // `$scan` も `$watch` もルートのツリーでだけ発火するので、行の連鎖にスコープの base 段は無い（段は必ずある）
    const own = listIndexAtWildcard(listIndex, level, pathInfo.wildcardCount) as IListIndex;
    if (current !== own && !isSameListIndexValue(current, own)) {
      if (isRetiredListIndex(own)) {
        return "gone";
      }
      placement = "replaced";
    }
    parentListIndex = current;
  }
  return placement;
}

/**
 * 行の着地を、いまのリストの位置 1 つにつき 1 つに絞る。戻り値の順は、位置ごとに最初に残した行の順。
 *
 * - 位置に行が無いアドレス（行を書いてからリストを短くした・空にした）は捨てる。
 *   添字で読むと範囲外の読みで throw する。
 * - 差分がリストから外した行のアドレス（行を書いてからその行を取り除いた・リストを置き換えた）は捨てる。
 *   添字で読むと、その位置にいま居る行の値を読む — 置き換えで入った行は自分のアドレスで着地するので二重になり、
 *   位置だけが移ってきた行は変わっていないのに着地する（#274・docs/state-scan-design.md §5-5）。
 * - 同じ位置に、いまそこに居る行のアドレスと、差分に外されていない別の行のアドレス（`list.*` への要素の
 *   書き込みの前にその行へ書いた形）が並んだら前者を残す。後者しか無い位置は残し、その位置のいまの値を読ませる。
 */
export function selectLandedRows<T extends ILandingRow>(state: IStateProxy, pathInfo: IPathInfo, rows: readonly T[]): T[] {
  const byPosition = new Map<string, { readonly row: T; readonly rank: number }>();
  for (const row of rows) {
    const placement = placementOf(state, pathInfo, row);
    if (placement === "gone") {
      continue;
    }
    const rank = placement === "current" ? 1 : 0;
    const key = row.indexes.join(",");
    const kept = byPosition.get(key);
    if (typeof kept === "undefined" || rank > kept.rank) {
      byPosition.set(key, { row, rank });
    }
  }
  return Array.from(byPosition.values(), (kept) => kept.row);
}
