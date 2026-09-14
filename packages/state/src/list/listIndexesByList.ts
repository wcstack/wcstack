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
 *   見えなくなる。共有そのものの帰結（親を読む getter が持ち主の行の文脈で評価される・
 *   1 スロットへ到達経路の数だけ書かれる）は残るが、それはデータが実際に共有されている
 *   ことの帰結であって、**もう存在しない古い値**ではない。
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
 * 集合）で、**復活の signal は同じ差分の `newIndexes`**。印は差分ごとに付け直され、
 * 消えない印は残らない（`retireListIndexes` / `reviveListIndexes` を `createListDiff` が
 * 対で呼ぶ）。
 *
 * 付け替えは**一方通行ではない**。行は自分の行集合を最初に展開した親（`home`）を憶えていて、
 * その home が**リストに戻ってきたら**持ち主を返す。これが無いと「行を削除して戻す」ページで
 * 持ち主が隣の行に移ったまま固定され、削除の履歴によって集計が凍る行が変わってしまう。
 *
 * 戻ってきたかどうかは **行オブジェクト（ListIndex）の identity ではなく、行が表している
 * リスト要素の identity** で判定する。同じ配列インスタンスを戻す綴りなら home そのものが
 * 生き返るが、行を戻す普通のやり方（新しい配列に同じ要素を並べ直す）では差分が ListIndex を
 * 作り直すので、ListIndex の identity で見ると home は永久に退役したままになる。
 * 要素そのものを作り直した行は**別の行**なので home には一致しない。生き残った行が
 * 1 つでもあればそちらへ戻るが、**全ての行を作り直す**綴り（`map(n => ({...n}))`）では
 * どの要素も一致せず、退役した親からの付け替えが位置に対して働く。
 */
import { getHomeParentListIndex, isSameListIndexValue, reparentListIndex } from "./createListIndex";
import { IListIndex } from "./types";

const listIndexesByList = new WeakMap<readonly unknown[], IListIndex[]>();

/**
 * 差分で `newIndexes` から外れた行 ＝ 消費者が画面から外した行。
 * 「生きた親集合に属さない」の判定材料。復活した行はこの集合から外れる。
 */
const retiredListIndexes = new WeakSet<IListIndex>();

/** 差分が捨てた行を退役として記録する（`createListDiff` が呼ぶ）。 */
export function retireListIndexes(listIndexes: Iterable<IListIndex>): void {
  for (const listIndex of listIndexes) {
    retiredListIndexes.add(listIndex);
  }
}

/**
 * 差分が「いま生きている」と返した行の退役印を落とす（`createListDiff` が呼ぶ）。
 * 同じ配列インスタンスを戻す・タブを切り替えて戻る等で、退役した行は実際に生き返る。
 */
export function reviveListIndexes(listIndexes: Iterable<IListIndex>): void {
  for (const listIndex of listIndexes) {
    retiredListIndexes.delete(listIndex);
  }
}

/**
 * 差分がリストから外し、まだ戻っていない行か。読むだけの判定で、`$scan` の drain が
 * 行のアドレスの指す行がもうリストに居ないかを見る（scan/scanRuntime.ts の placementOf）。
 */
export function isRetiredListIndex(listIndex: IListIndex): boolean {
  return retiredListIndexes.has(listIndex);
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
  if (oldParent === newParent) {
    // 自分が展開した行集合（ここが圧倒的多数）。ルート直下どうし（両方 null）もここ。
    return false;
  }
  if (oldParent === null || newParent === null) {
    return false;
  }
  if (oldParent.position !== newParent.position) {
    return false;
  }
  return retiredListIndexes.has(oldParent) && !retiredListIndexes.has(newParent);
}

/**
 * 要求している親（`newParent`）が、退役した `home` の**行そのもの**か。
 * 行を戻す普通のやり方（新しい配列に同じ要素を並べ直す）では差分が ListIndex を作り直すので、
 * home の ListIndex は二度と生き返らない。同じリスト要素を同じ深さで表している生きた行が
 * 現れたら、それが戻ってきた home である。
 */
function isRestoredHome(
  home: IListIndex | null,
  oldParent: IListIndex | null,
  newParent: IListIndex | null,
): boolean {
  if (home === null || newParent === null) {
    return false;
  }
  if (newParent === oldParent) {
    // すでにそこにある（＝毎回 reparent して version を進めない）。
    return false;
  }
  if (!retiredListIndexes.has(home)) {
    // home が生きているなら「生き返った home」の分岐が扱う。
    return false;
  }
  if (retiredListIndexes.has(newParent) || newParent.position !== home.position) {
    return false;
  }
  return isSameListIndexValue(newParent, home);
}

/**
 * 行集合の親をどこへ向けるか。`null` なら何もしない。
 * 優先順位は **「生き返った home」＞「戻ってきた home の行」＞「陳腐化した親の付け替え」**。
 */
function getRepairTarget(first: IListIndex, parentListIndex: IListIndex | null): IListIndex | null {
  const home = getHomeParentListIndex(first);
  const oldParent = first.parentListIndex;
  if (home !== null && home !== oldParent && !retiredListIndexes.has(home)) {
    return home;
  }
  if (isRestoredHome(home, oldParent, parentListIndex)) {
    return parentListIndex;
  }
  return canReparent(oldParent, parentListIndex) ? parentListIndex : null;
}

/**
 * 台帳を**引き当てるだけ**。行の親ポインタには触らない。
 * 観測（テスト・世代の後始末・`$scan` の drain が行の置き換わりを見る判定）と存在判定はこちらを使う。
 */
export function getListIndexesByList(list: readonly unknown[]): IListIndex[] | null {
  const listIndexes = listIndexesByList.get(list);
  if (typeof listIndexes === "undefined") {
    return null;
  }
  return listIndexes;
}

/**
 * 台帳を引き当て、**必要なら親ポインタを修理して**返す（#256）。
 * 引き当てのついでに行を書き換えるので、観測目的では使わないこと ──
 * 修理が要るのは「その親の文脈で値を解決する」経路（差分・アドレス解決）だけ。
 */
export function resolveListIndexesByList(
  list: readonly unknown[],
  parentListIndex: IListIndex | null,
): IListIndex[] | null {
  const listIndexes = listIndexesByList.get(list);
  if (typeof listIndexes === "undefined") {
    return null;
  }
  const first = listIndexes[0];
  if (typeof first !== "undefined") {
    const target = getRepairTarget(first, parentListIndex);
    if (target !== null) {
      // 1 組の行集合は 1 つの親のもとにある、を保つ（差分が別の親の行を混ぜて
      // 作った集合も、ここで揃える）。
      for (const listIndex of listIndexes) {
        reparentListIndex(listIndex, target);
      }
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
