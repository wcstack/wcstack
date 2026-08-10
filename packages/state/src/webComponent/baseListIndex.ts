/**
 * webComponent/baseListIndex.ts
 *
 * mapped な `bind-component` の子スコープが「親スコープのどの行の内側にいるか」。
 *
 * ホストのコンポーネント要素が親スコープの `for` の中に置かれている場合、
 * 子スコープは実際には**ネストしたループの内側**にいる。その深さ Δ を表すのが
 * base listIndex で、子が作る listIndex はすべてこれを親に持つ。
 * 結果として `groups[i].children` の listIndex 台帳は arity Δ+1 になり、
 * これは親が `groups.*.children.*` に対して要求するものと同一になる
 * （台帳 `listIndexesByList` は配列オブジェクト同一性の WeakMap なので、
 * 1 つの配列につき 1 組しか持てない。親子で同じ組を使うのが唯一の整合手段）。
 *
 * 詳細は docs/state-bind-component-nested-for-design.md。
 *
 * **キャッシュしてはいけない。** 行 content はプールで再利用されるため、同じ
 * コンポーネント要素が別の行に付け替わる。要素をキーにした memo は §1.9 で
 * 踏んだ罠そのもので、再接続後に古い行を指し続ける。
 * 通常の state（`hasMappedComponentState` が偽）は最初の 1 行で抜けるので、
 * ホットパスに walk は載らない。
 */

import { IStateElement } from "../components/types";
import { getLoopContextByNode } from "../list/loopContextByNode";
import { IListIndex } from "../list/types";

export function getBaseListIndex(stateElement: IStateElement | null | undefined): IListIndex | null {
  if (stateElement == null || stateElement.hasMappedComponentState !== true) {
    return null;
  }
  const component = stateElement.boundComponent;
  if (component == null) {
    return null;
  }
  return getLoopContextByNode(component)?.listIndex ?? null;
}

/** base の段数 Δ。base が無ければ 0。 */
export function getBaseDepth(stateElement: IStateElement | null | undefined): number {
  return getBaseListIndex(stateElement)?.length ?? 0;
}

/**
 * リストの行を生成するときの親 listIndex。
 *
 * コンテナのアドレスがワイルドカードを持つ（＝囲むループがある）ならその listIndex、
 * 持たない（＝そのスコープのトップレベルのリスト）なら base。後者を null のままに
 * すると、子スコープのリストだけ arity 1 で作られて親の台帳と食い違う。
 *
 * **リストの行を作りうる全経路で使うこと。** 既存台帳があれば `createListDiff` は
 * 再利用するので初期描画では食い違いが見えず、**行を追加したときだけ**
 * `createListIndex(parentListIndex, i)` が新しい arity で作られて混在する。
 */
export function getListParentListIndex(
  stateElement: IStateElement | null | undefined,
  containerListIndex: IListIndex | null,
): IListIndex | null {
  return containerListIndex ?? getBaseListIndex(stateElement);
}
