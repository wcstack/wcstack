/**
 * list/wildcardLevel.ts
 *
 * 「パス上のワイルドカード位置」→「listIndex チェーン上の段」の変換を 1 箇所に集める。
 *
 * チェーンの長さは常に `Δ + W`（W = そのパスの wildcardCount、Δ = そのスコープの
 * base 深さ）である。通常の state スコープは Δ=0 なので「位置 i ＝ 段 i」で済んでいたが、
 * `bind-component` の子スコープがホストの `for` の内側にいる場合は Δ>0 になる
 * （docs/state-bind-component-nested-for-design.md）。
 *
 * そこで**先頭ではなく末尾を基準に数える**。`IListIndex.at()` は負値を受けるので:
 *
 *     at(i)  →  at(i - W)      // listIndexes[(Δ+W) + (i-W)] = listIndexes[Δ+i]
 *
 * Δ=0 のときは両者が同じ要素を指すため、この書き換えは既存スコープに対して
 * 意味論を変えない。Δ の値を呼び出し側へ配管する必要も無い。
 */

import { IListIndex } from "./types";

/**
 * ワイルドカード位置 `wildcardPos`（先頭から 0 始まり）に対応する listIndex を返す。
 * `wildcardCount` は `wildcardPos` が属するパスのワイルドカード総数。
 *
 * 範囲外（`wildcardPos >= wildcardCount`）は null。Δ=0 では `at(pos)` が
 * チェーン長を超えて null を返していたのと同じ結果になる。**このガードは必須**で、
 * 落とすと「1 段ループの中で `$2` を読む」が黙って `$1` を返す
 * （末尾起点では `at(1-1)=at(0)` に化けるため）。
 */
export function listIndexAtWildcard(
  listIndex: IListIndex,
  wildcardPos: number,
  wildcardCount: number,
): IListIndex | null {
  if (wildcardPos < 0 || wildcardPos >= wildcardCount) {
    return null;
  }
  return listIndex.at(wildcardPos - wildcardCount);
}

/**
 * このスコープの base 深さ Δ。ループ文脈から局所的に求まる
 * （チェーン長 Δ+W と パスの W の差）。
 */
export function getBaseDepthOf(listIndex: IListIndex, wildcardCount: number): number {
  return listIndex.length - wildcardCount;
}
