/**
 * getListIndexesByAddress.ts
 *
 * ワイルドカードの親アドレス（`items` / `groups.*.items`）にあるリスト値の行集合を、
 * 正本台帳（listIndexesByList）から引く。直接添字（`this["items.0.v"]`）・`$postUpdate`
 * （getListIndex）と `$resolve` / `$setAll`（getListIndexByIndexes）が、添字から行を
 * 引くときの共有部分。
 *
 * 台帳を作るのは差分（createListDiff）だけで、差分を取るのは for の描画・依存ウォーク・
 * `$getAll` / `$setAll` の走査・再帰の走査。どれも経ていないリスト（for で描いておらず、
 * 走査もしていない）には台帳が無く、以前はここで `ListIndex not found` を投げていた —
 * README の「Direct index access」が一度も成立していなかった（#324）。台帳が無ければ、
 * その場で差分を取って生やす。
 *
 * 旧リストには `$getAll` の第 1 相（wildcardIndexes.ts）と同じ state 側の基準を渡し、
 * 行の再利用を `$getAll` と同じ規則に揃える。空を基準に行を鋳造すると、後でその基準から
 * 差分を取る側（`$getAll` / 依存ウォーク）が 2 つの台帳を同一性で突き合わせる経路
 * （calcDiffIndexes）に入り、変わっていない要素まで追加＋削除として扱う。中身が同じ写しの
 * 配列なら台帳ごと基準側の行へ差し替わり、直接添字が書いた行のキャッシュが置き去りになる。
 * 生やしたら基準もこの値で確定する（`$getAll` の第 1 相・再帰の走査と同じ）。確定しないと、
 * 描いていないリストは依存ウォークも差分を取らないので、次にリストを写し替えても生やした行が
 * 退役せず、子リストの台帳が古い行にぶら下がったまま残る — 行の集計 getter が恒久的に古くなる
 * （読むだけの直接添字・DevTools の覗き見でも起きた）。確定はバッチの末尾まで保留される
 * （list/stateListBaseline.ts）。
 */

import { liftAddress } from "../../address/liftAddress";
import { IStateAddress } from "../../address/types";
import { createListDiff } from "../../list/createListDiff";
import { resolveListIndexesByList } from "../../list/listIndexesByList";
import { getStateListBaseline, setStateListBaseline } from "../../list/stateListBaseline";
import { IListIndex } from "../../list/types";
import { IStateHandler } from "../types";

export function getListIndexesByAddress(
  handler: IStateHandler,
  address: IStateAddress,
  value  : any,
): IListIndex[] {
  const listIndexes = resolveListIndexesByList(value, address.listIndex);
  if (listIndexes !== null) {
    return listIndexes;
  }
  const absAddress = liftAddress(handler.stateElement, address);
  const diff = createListDiff(address.listIndex, getStateListBaseline(absAddress), value);
  setStateListBaseline(absAddress, Array.isArray(value) ? value : []);
  return diff.newIndexes;
}
