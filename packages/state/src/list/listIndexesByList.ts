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
 *   dirty にするので、葉への書き込みが集計へ届かない（#256）。外側の行が内側のパスに別の値を書いて、前の配列を
 *   **手放した**形も同じ（#394 — releaseListAtParent）。
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
import { createListIndex, getHomeParentListIndex, getListIndexValue, getRowsOfSameElement, isSameListIndexValue, isUnderRetiredRow, reparentListIndex, retiredListIndexes, setListIndexValue } from "./createListIndex";
import { IListIndex } from "./types";
import { updateBatch } from "../updater/updateBatch";
import { isSwapBaselineList, markSwapBaselineList } from "./swapBaselineList";

const listIndexesByList = new WeakMap<readonly unknown[], IListIndex[]>();

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
 * 外側の行 → その行が内側のパスから手放した配列（#394）。外側の行の内側のパスへ別の配列を書くと（setByAddress）、
 * 前の配列の行がその外側の行を親に持っていても、その行はもうその配列を持たない。退役した親と同じく付け替えの元に
 * なり、戻り先（home）にもならない。同じ配列を書き戻したら外す（holdListAtParent）。
 */
const releasedListsByParent = new WeakMap<IListIndex, WeakSet<readonly unknown[]>>();

/**
 * 外側の行 `parentListIndex` の内側のパス（`holder` の `key`）が、配列 `list` から別の値に替わった（setByAddress）。
 * 同じ要素の別のパスがまだその配列を持つ（`{ items: A, alt: A }` の `alt` だけを替えた）なら手放さず、真を返す —
 * 呼び手は、新しい配列に前の配列の行を貸させない（前の配列はまだ描かれている — createListDiff の keepPreviousList）
 */
export function releaseListAtParent(list: unknown, parentListIndex: IListIndex, holder: Record<string, unknown>, key: string): boolean {
  if (!listIndexesByList.has(list as readonly unknown[])) {
    return false;
  }
  let kept = false;
  for (const other in holder) {
    kept ||= other !== key && holder[other] === list;
  }
  if (!kept) {
    let released = releasedListsByParent.get(parentListIndex);
    if (typeof released === "undefined") {
      released = new WeakSet();
      releasedListsByParent.set(parentListIndex, released);
    }
    released.add(list as readonly unknown[]);
  }
  // 行集合の親がこの外側の行なら、配列をまだ持つ別の外側の行へいま付け替える。その外側の行が引くまで待つと、間に描き直した
  // 行の下のアドレスが手放した外側の行を経由し、その外側の行の新しい値（写し）を読み書きした（隠れた外側の行に知らせた
  // 更新で、別の外側の行が写しに替えた — f5/if/1242）。付け替え先は、手放したキーで配列を持つ外側の行。別のキーがまだ
  // 持つときも、このキーの分は手放すので付け替える — 残ったキーのアドレスは、憶えた親（この外側の行）を使い続ける
  // （address/StateAddress.ts・f6/dual/43）
  const rows = listIndexesByList.get(list as readonly unknown[])!;
  const moved = movedByList.get(list as readonly unknown[]);
  if (rows[0]?.parentListIndex === parentListIndex && !(kept && moved?.[0] === parentListIndex && moved[1] === updateBatch)) {
    for (const other of holdersByList.get(list as readonly unknown[]) ?? []) {
      if (other !== parentListIndex && other.position === parentListIndex.position && isHoldingParent(list as readonly unknown[], other) &&
        Object(getListIndexValue(other))[key] === list) {
        rows.forEach((row) => reparentListIndex(row, other));
        handedOverByList.set(list as readonly unknown[], [parentListIndex, updateBatch]);
        break;
      }
    }
  }
  return kept;
}

/**
 * 配列 → 手放したときに行集合を付け替えた元の外側の行と、そのバッチ。同じバッチでその外側の行が別のキーに同じ配列を書いたら
 * （`items` から `alt` へ移した）、行集合を戻す — 付け替えた先の外側の行は書いたキーで配列を持たないので、移した先のキーの
 * アドレスが付け替えた先の外側の行の別の配列を読んだ（6 つ目の修理の検証の y7）
 */
const handedOverByList = new WeakMap<readonly unknown[], [IListIndex, number]>();

/**
 * 配列 → その配列を内側のパスに書いた外側の行と、そのバッチ。同じバッチで先に別のキーへ書いてから元のキーを替えた（`alt` へ
 * 移してから `items` を替えた）外側の行は、まだその配列を持つので付け替えない — 移した先のキーのアドレスはこれから作られ、
 * 付け替えた先の外側の行の別の配列を読んだ（6 つ目の修理の検証の y7）
 */
const movedByList = new WeakMap<readonly unknown[], [IListIndex, number]>();

/** 外側の行 `parentListIndex` の内側のパスに、配列 `list` を書いた（手放した印を外す） */
export function holdListAtParent(list: unknown, parentListIndex: IListIndex): void {
  releasedListsByParent.get(parentListIndex)?.delete(list as readonly unknown[]);
  const rows = listIndexesByList.get(list as readonly unknown[]);
  if (typeof rows !== "undefined") {
    movedByList.set(list as readonly unknown[], [parentListIndex, updateBatch]);
    const handedOver = handedOverByList.get(list as readonly unknown[]);
    if (handedOver?.[0] === parentListIndex && handedOver[1] === updateBatch) {
      rows.forEach((row) => reparentListIndex(row, parentListIndex));
    }
  }
}

/** 外側の行 `parentListIndex` が配列 `list` を手放したか（applyChangeToFor・#393） */
export function hasReleasedList(list: readonly unknown[], parentListIndex: IListIndex): boolean {
  return releasedListsByParent.get(parentListIndex)?.has(list) === true;
}

/**
 * 外側の行が、もうその配列を持たないか（退役した・内側のパスから手放した）。祖先の行が退役した行も同じ — 3 段のリストの
 * 外側の行を作り直すと、真ん中の行は差分を通らないので退役の印が付かない（見なければ、真ん中の行を作り直した後の
 * 内側の配列の行が、退役した外側の行の下の真ん中の行に残り、2 つの行から引かれた配列と取り違える）
 */
function isGoneParent(list: readonly unknown[], parentListIndex: IListIndex): boolean {
  return hasReleasedList(list, parentListIndex) || isUnderRetiredRow(parentListIndex);
}

/**
 * 要素書き込みの入れ替えの途中で、書いた要素を映している行 → 書いたバッチ（setByAddress の _setByAddressWithSwap）。
 * 揃うと行は値に付いて元の要素へ戻るので、その間にこの行の下で引いた配列の行を、この行へ付け替えない — 付け替えると、
 * 揃った後にその配列を持たない行が親として残り、書き込みが別の配列に着地した（#394 と同じ系統）
 */
const swapPendingBatchByRow = new WeakMap<IListIndex, number>();

export function markRowSwapPending(row: IListIndex): void {
  swapPendingBatchByRow.set(row, updateBatch);
}

export function clearRowSwapPending(row: IListIndex): void {
  swapPendingBatchByRow.delete(row);
}

/**
 * 外側の行 `row` の要素が、`other` の要素が配列を持つどのキーでも同じ配列を持つか（直下のキーだけ）。行のアドレスは
 * 行の親から引き直すので、同じ配列を `items` と `alt` の 2 つのキーに持つ外側の行がいると、片方のキーにしか持たない外側の行を
 * 親にした行の、もう片方のキーのアドレスが別の配列に着地した（R1 — 例: `{ items: 写し, alt: A }` を親にした `groups.0.items.0`）
 */
function covers(list: readonly unknown[], row: IListIndex, other: IListIndex): boolean {
  const element = Object(getListIndexValue(row)) as Record<string, unknown>;
  const held = getListIndexValue(other) as Record<string, unknown>;
  for (const key in held) {
    if (held[key] === list && element[key] !== list) {
      return false;
    }
  }
  return true;
}

/** 付け替え先にしてよい親か（配列を持っていて、入れ替えの途中で別の要素を映していない） */
function isHoldingParent(list: readonly unknown[], parentListIndex: IListIndex): boolean {
  return !isGoneParent(list, parentListIndex) && swapPendingBatchByRow.get(parentListIndex) !== updateBatch;
}

/**
 * 2 つ以上の外側の行から引かれた配列 → 引いた外側の行（#393）。行の親は 1 つなので、もう片方の外側の行から引いた行も同じ
 * 親を持つ。その行を別の配列（写し）に貸すと、写しの要素の書き込みが行の親を経由して元の配列に着地し、元の配列を描く
 * 外側の行の添字も写しの位置へ振り直される。差分は、ほかにまだ持っている外側の行がある配列の行を貸さない（createListDiff）。
 * 持っているかはその都度見る（手放した・退役した外側の行は数えない）ので、共有をやめた配列の写しは行を借りて DOM を保つ。
 * もう持っていない外側の行は、見たときと、集合が前に見直した大きさの倍に育ったときに外す — 外した外側の行を持ち続けず、
 * 見直しの手間は足した数に比例する（9,000 行が同じ配列を持つページで、足すたびに全部を見直すと作り直しが 4 倍遅れた）
 */
const holdersByList = new WeakMap<readonly unknown[], Set<IListIndex>>();
const pruneSizeByList = new WeakMap<readonly unknown[], number>();

function addHolders(list: readonly unknown[], holders: (IListIndex | null)[]): void {
  let held = holdersByList.get(list);
  if (typeof held === "undefined") {
    held = new Set();
    holdersByList.set(list, held);
  } else if (held.size >= (pruneSizeByList.get(list) ?? 8)) {
    held.forEach((holder) => {
      if (isGoneParent(list, holder)) {
        held!.delete(holder);
      }
    });
    pruneSizeByList.set(list, held.size * 2 + 8);
  }
  for (const holder of holders) {
    held.add(holder!);
  }
}

/** `requester` のほかに、配列をまだ持っている外側の行があるか（見た、もう持っていない外側の行は外す） */
export function isHeldElsewhere(list: readonly unknown[], requester: IListIndex): boolean {
  const held = holdersByList.get(list);
  for (const holder of held ?? []) {
    if (isGoneParent(list, holder)) {
      held!.delete(holder);
    } else if (holder !== requester) {
      return true;
    }
  }
  return false;
}

/**
 * 行を写しに貸した配列（#393）。差分は、外側の行の内側のパスに書いた写しへ前の配列の行を貸す（DOM を保つため）。
 * 前の配列を別の外側の行がまだ持っていて（書いた外側の行はまだ引いていなかった — if で隠れていた等）後から引くと、
 * 台帳は行をその外側の行へ付け替えようとする — 付け替えると写しの行も動き、写しの要素の書き込みが前の配列に着地する。
 * 貸した配列には、付け替える代わりに新しい行集合を作る（resolveListIndexesByList）。
 */
const lentLists = new WeakSet<readonly unknown[]>();

export function markListLent(list: readonly unknown[]): void {
  lentLists.add(list);
}

/**
 * 同じ要素オブジェクトを表している、書いた配列の外の生きた行（createListIndex.ts の getRowsOfSameElement・#393）。退役した行・
 * 退役した外側の行の下の行（外側の行ごと外した行 — 差分を通らない）は数えない
 */
export function getElementAliases(row: IListIndex, readList: () => readonly unknown[]): readonly IListIndex[] {
  const others = getRowsOfSameElement(row);
  if (others.length === 0) {
    return others;
  }
  // 入れ子のリストの、書いた配列（`readList` — 別の行が居るときだけ読む）の外の行だけ — 深さの違う行は書いたパスの
  // アドレスにならず、同じ配列の 2 つの位置・ルート直下の写しは、同じオブジェクトを 2 つの行に置いた形の制約のまま（#365 / #362）
  const rows = new Set(listIndexesByList.get(readList()));
  return others.filter((other) => other.position === row.position && !rows.has(other) && !isUnderRetiredRow(other));
}

/**
 * 台帳の行がぶら下がる親（`oldParent`）を、いま要求している親（`newParent`）へ
 * 付け替えてよいか。**親がもうその配列を持たないとき（退役した・手放した）だけ**真 ──
 * 持っているなら共有であって陳腐化ではないので、main と同じく 1 組の行集合に合流させる。
 * 深さ（`position`）が変わる付け替えはしない。行の `position` / `length` は鋳造時に
 * 確定していて、そこがずれると絶対アドレスの段数が壊れる（bind-component が 1 本の
 * 配列を 2 つの深さから展開する形が実際にある）。
 */
function canReparent(list: readonly unknown[], oldParent: IListIndex | null, newParent: IListIndex | null): boolean {
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
  return isGoneParent(list, oldParent) && isHoldingParent(list, newParent);
}

/**
 * 要求している親（`newParent`）が、退役した `home` の**行そのもの**か。
 * 行を戻す普通のやり方（新しい配列に同じ要素を並べ直す）では差分が ListIndex を作り直すので、
 * home の ListIndex は二度と生き返らない。同じリスト要素を同じ深さで表している生きた行が
 * 現れたら、それが戻ってきた home である。
 */
function isRestoredHome(
  list: readonly unknown[],
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
  if (!isHoldingParent(list, newParent) || newParent.position !== home.position) {
    return false;
  }
  // 手放した home の要素は、もうこの配列を持たない（#394）
  return !hasReleasedList(list, home) && isSameListIndexValue(newParent, home);
}

/**
 * 行集合の親をどこへ向けるか。`null` なら何もしない。
 * 優先順位は **「生き返った home」＞「戻ってきた home の行」＞「陳腐化した親の付け替え」**。
 */
function getRepairTarget(list: readonly unknown[], first: IListIndex, parentListIndex: IListIndex | null): IListIndex | null {
  const home = getHomeParentListIndex(first);
  const oldParent = first.parentListIndex;
  if (home !== null && home !== oldParent && !isGoneParent(list, home) && covers(list, home, oldParent!)) {
    return home;
  }
  if (isRestoredHome(list, home, oldParent, parentListIndex)) {
    return parentListIndex;
  }
  return canReparent(list, oldParent, parentListIndex) ? parentListIndex : null;
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
  // 描いた並びの写し（要素書き込みの入れ替えの前の並び — swapBaselineList.ts・下の貸した行の写し）は state に居ないので、
  // その台帳を引いても行を付け替えない — 写しを持つ外側の行の印（手放した・退役した）が無いので、行集合を手放した外側の行
  // （home）へ戻してしまう（#394）
  if (typeof first !== "undefined" && !isSwapBaselineList(list)) {
    // 行の親とは別の、配列を持っている外側の行から引いた。入れ替えの途中で別の要素を映している行が引いたのは共有ではない
    // （揃うと行は元の要素へ戻る）
    const other = parentListIndex !== null && first.parentListIndex !== parentListIndex &&
      swapPendingBatchByRow.get(parentListIndex) !== updateBatch;
    const target = getRepairTarget(list, first, parentListIndex);
    if (target !== null && lentLists.has(list)) {
      lentLists.delete(list);
      // この配列を描いた `for` が描いたのは貸した行。描いた並びを、貸した行の台帳を持つ写しへ移す（#320 の記録）
      const image = [...list];
      markSwapBaselineList(image);
      listIndexesByList.set(image, listIndexes);
      rebaseRenderedList(list, image);
      const rows = listIndexes.map((_row, i) => {
        const row = createListIndex(target, i);
        setListIndexValue(row, list[i]);
        return row;
      });
      listIndexesByList.set(list, rows);
      return rows;
    }
    if (target !== null) {
      // 1 組の行集合は 1 つの親のもとにある、を保つ（差分が別の親の行を混ぜて
      // 作った集合も、ここで揃える）。
      for (const listIndex of listIndexes) {
        reparentListIndex(listIndex, target);
      }
    } else if (other) {
      // 2 つの外側の行が持つ配列（holdersByList）。要求した外側の行が、いまの親より多くのキーで配列を持つなら、そちらを親に
      // する（上の covers — 片方のキーにしか持たない外側の行が先に引いた）
      addHolders(list, [first.parentListIndex, parentListIndex]);
      const parent = first.parentListIndex;
      if (parent !== null && parent.position === parentListIndex!.position && !covers(list, parent, parentListIndex!) &&
        covers(list, parentListIndex!, parent)) {
        for (const listIndex of listIndexes) {
          reparentListIndex(listIndex, parentListIndex);
        }
      }
    }
  }
  return listIndexes;
}

/**
 * 要素の書き込み（setByAddress の renewReplacedRow・#333）が写した台帳のうち、その配列の台帳としてしか
 * 参照されていないもの。次の要素の書き込みは写さずにその場で書き換えてよい（写すと、1 バッチで全要素を
 * 書く `$setAll("items.*", …)` が O(n²) になる）。台帳の配列を別の持ち手が捕まえたら外す — 別の配列の
 * 台帳にする（下の setListIndexesByList）、差分が持つ（createListDiff）、入れ替えが持つ（swapInfo.ts）、
 * `$eqIndex` の監視が付く（dependency/keyedDependency.ts の registerIndexWatcher / moveIndexWatchers）。
 */
const ownedListIndexes = new WeakSet<IListIndex[]>();

export function isOwnedListIndexes(listIndexes: IListIndex[]): boolean {
  return ownedListIndexes.has(listIndexes);
}

export function disownListIndexes(listIndexes: IListIndex[]): void {
  ownedListIndexes.delete(listIndexes);
}

export function setListIndexesByList(list: readonly unknown[], listIndexes: IListIndex[] | null, owned = false): void {
  if (listIndexes === null) {
    listIndexesByList.delete(list);
    return;
  }
  if (owned) {
    ownedListIndexes.add(listIndexes);
  } else {
    disownListIndexes(listIndexes);
  }
  listIndexesByList.set(list, listIndexes);
}

/**
 * `for` が描いた並び（#320）。1 本の配列につき 1 つで、その配列を描いたどの `for` もこれを指す。
 *
 * 描画の基準（lastListValueByAbsoluteStateAddress.ts）はアドレスごとに 1 本なので、同じリストを描く `for` が複数あると、画面から外れていて
 * 描かなかった `for`（`if` で消された・DOM から外された）を待たずに進む。そうした `for` は自分が
 * 描いた並びとの差分を取る（applyChangeToFor）。その並びを配列そのもので覚えると、要素書き込みが
 * 配列をその場で書き換えて台帳を差し替えたときに「描いた並び」が失われるので、ここを 1 段挟む。
 * 要素書き込みの入れ替えが揃ったら、ここを書き込む前の並びの写しに差し替える（rebaseRenderedList）。
 */
export interface IRenderedList {
  value: readonly unknown[];
}

const renderedListByList: WeakMap<readonly unknown[], IRenderedList> = new WeakMap();

export function getRenderedList(list: readonly unknown[]): IRenderedList {
  let rendered = renderedListByList.get(list);
  if (typeof rendered === "undefined") {
    rendered = { value: list };
    renderedListByList.set(list, rendered);
  }
  return rendered;
}

/** この配列を描いた `for` がいて、描いた後にまだ描画の基準を移していないか（setByAddress の renewReplacedRow） */
export function hasRenderedList(list: readonly unknown[]): boolean {
  return renderedListByList.has(list);
}

/**
 * 要素書き込みの入れ替えが揃った（setByAddress の notifySwappedList）。この配列をこれまでに描いた `for` が
 * 描いたのは、書き込む前の並び（`image` — 写しと台帳の写し）。以後この配列を描く `for` は新しい並びを指す。
 */
export function rebaseRenderedList(list: readonly unknown[], image: readonly unknown[]): void {
  const rendered = renderedListByList.get(list);
  if (typeof rendered !== "undefined") {
    rendered.value = image;
    renderedListByList.delete(list);
  }
}
