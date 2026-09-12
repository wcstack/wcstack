/**
 * list/listIndexesByList.ts
 *
 * 行（`IListIndex`）の正本台帳。1 本の配列につき行集合は **1 組**。
 *
 * #256 が扱うのは「共有」ではなく「陳腐化」である。台帳はこの 2 つを分ける:
 *
 * - **生きた共有** ── 1 本の配列が 2 つの生きた親から到達できる形。行集合は 1 組のまま
 *   全員で共有する（どの親から読んでも同じ値が見える）。親ごとに私有の行集合を持たせると
 *   同じスロットに 2 本の絶対アドレスができ、片方へ書いた値がもう片方から**永久に**
 *   見えなくなる。共有そのものの帰結（親を読む getter が最後に展開した親の文脈で
 *   評価される・1 スロットへ到達経路の数だけ書かれる）は残るが、それはデータが実際に
 *   共有されていることの帰結であって、**もう存在しない古い値**ではない。
 * - **陳腐化** ── 行オブジェクトだけを作り直す置換（`nodes.map(n => ({...n}))` は
 *   `children` を参照ごと引き継ぐ）で、台帳の行がぶら下がる親が**退役した**形。読み手は
 *   新しい行の絶対アドレスを見るのに、書き手は行の親ポインタを遡って旧行の絶対アドレスを
 *   dirty にするので、葉への書き込みが集計へ届かない（#256）。
 *
 * 判別は「台帳の行が持つ親が、生きた親集合に属するか」。属さないときだけ、**行の identity を
 * 保ったまま**新しい親へ付け替える（`reparentListIndex`）。作り直さないのは、消費者が
 * 描画済み content を行 ListIndex の identity で持っているため ── 作り直すと、著者が何も
 * 間違えていないページで行の DOM が丸ごと失われる（`<details>` の開閉のような、バインド
 * していない状態ごと）。
 *
 * 退役の signal は差分の `deleteIndexSet`（＝エンジン自身が「この行はもう無い」と決めた
 * 集合）。この印は**安全な向きにしか誤らない**: 生き返った行に印が残っていても、起きるのは
 * 「1 組しかない行集合が生きた親のどちらにぶら下がるか」が変わることだけで、それは main が
 * ずっとしてきた別名化と同じ。行集合が 2 組に割れることは無いので、親ごとに違う値が見える
 * 形にはならない。
 */
import { reparentListIndex } from "./createListIndex";
import { IListIndex } from "./types";

const listIndexesByList = new WeakMap<readonly unknown[], IListIndex[]>();

/**
 * 差分で `newIndexes` から外れた行 ＝ 消費者が画面から外した行。
 * 「生きた親集合に属さない」の判定材料。
 */
const retiredListIndexes = new WeakSet<IListIndex>();

/** 差分が捨てた行を退役として記録する（`createListDiff` が呼ぶ）。 */
export function retireListIndexes(listIndexes: Iterable<IListIndex>): void {
  for (const listIndex of listIndexes) {
    retiredListIndexes.add(listIndex);
  }
}

/**
 * 台帳の行がぶら下がる親（`oldParent`）を、いま要求している親（`newParent`）へ
 * 付け替えてよいか。**退役した親のときだけ**真 ── 生きているなら共有であって
 * 陳腐化ではないので、main と同じく 1 組の行集合に合流させる。
 * 深さ（`position`）が変わる付け替えはしない。行の `position` / `length` は鋳造時に
 * 確定していて、そこがずれると絶対アドレスの段数が壊れる（bind-component が 1 本の
 * 配列を 2 つの深さから展開する形が実際にある）。
 */
function canReparent(oldParent: IListIndex | null, newParent: IListIndex | null): boolean {
  if (oldParent === null || newParent === null) {
    return false;
  }
  if (oldParent.position !== newParent.position) {
    return false;
  }
  return retiredListIndexes.has(oldParent) && !retiredListIndexes.has(newParent);
}

export function getListIndexesByList(
  list: readonly unknown[],
  parentListIndex: IListIndex | null,
): IListIndex[] | null {
  const listIndexes = listIndexesByList.get(list);
  if (typeof listIndexes === "undefined") {
    return null;
  }
  // 速い道: 自分が展開した行集合ならそのまま（ここが圧倒的多数）。
  const first = listIndexes[0];
  if (typeof first !== "undefined"
    && first.parentListIndex !== parentListIndex
    && canReparent(first.parentListIndex, parentListIndex)) {
    // 1 組の行集合は 1 つの親のもとにある、を保つ（差分が別の親の行を混ぜて
    // 作った集合も、ここで要求元の親へ揃える）。
    for (const listIndex of listIndexes) {
      reparentListIndex(listIndex, parentListIndex);
    }
  }
  return listIndexes;
}

export function setListIndexesByList(list: readonly unknown[], listIndexes: IListIndex[] | null): void {
  if (listIndexes === null) {
    listIndexesByList.delete(list);
    return;
  }
  listIndexesByList.set(list, listIndexes);
}
