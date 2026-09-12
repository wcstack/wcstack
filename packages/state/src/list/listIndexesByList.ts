/**
 * list/listIndexesByList.ts
 *
 * 行（`IListIndex`）の正本台帳。キーは **(親, 配列)** の組。
 *
 * 行は「どの親の下の何番目か」でしか意味を持たない（`IListIndex.parentListIndex`）。
 * 台帳が配列インスタンスだけをキーにしていた頃は、1 本の配列につき行集合が 1 組しか
 * 持てず、`p.*` を親 P のもとで展開したのに別の親（しばしば置換で退役した行）の下で
 * 鋳造された行が返ってきた。読み手はそれを受け取って降り、書き手は行の親ポインタを
 * 遡って縮約するので、葉への書き込みが **旧行の絶対アドレス** を dirty にし、読み手は
 * **新行の絶対アドレス** のキャッシュを見る、という食い違いが起きる（#256）。
 * 組ごとに私有の行集合を持たせると、各消費者が自分の前世代と自分の新世代を突き合わせる
 * ことになり、`deleteIndexSet` が意味を保つ。
 *
 * **取り出しは親を明示する。** 見つからないのは「この親はこのリストを一度も展開して
 * いない」という意味で、呼び出し側は既存の鋳造経路（`createListDiff` の全行 add 分岐）へ
 * 落ちる。新しい例外面は増えない。
 *
 * **格納は親を渡さない。** 行集合が属する親は行自身が知っている（`listIndexes[0]` の
 * 親）ので、そこから引く。空の行集合はルート番兵の側に置く（空リストの台帳は
 * `createListDiff` の空リスト分岐でしか作られず、誰も行として読まない）。
 */
import { IListIndex } from "./types";

/** 親が null（ルート直下のリスト）の行集合を入れるための番兵。 */
const ROOT_PARENT: object = Object.freeze({});

const listIndexesByParentByList =
  new WeakMap<readonly unknown[], WeakMap<object, IListIndex[]>>();

/**
 * 直近に登録された行集合（親を問わない）＝ 単一スロットだった頃の台帳が返していたもの。
 * **退役専用**。ここから行を取り出して `newIndexes` に載せてはならない — それが #256 の
 * 別名化そのものである。
 *
 * 要る理由は消費者の側にある。`applyChangeToFor` は描画済み content を**行 ListIndex の
 * identity** で持っているので、親が付け替わっても（再接続で `for` のアドレスだけが
 * 張り替わる形。BindingSession.rebindAddresses が差分基準だけを旧→新へ引き継ぐ）
 * 前世代の行を `deleteIndexSet` で名指さないと、その content が画面に残ったまま
 * 新しい行が足される。削除の帳簿を修正前と一致させるための参照。
 */
const lastListIndexesByList = new WeakMap<readonly unknown[], IListIndex[]>();

/** 退役専用（上の WeakMap のコメント）。行の再利用に使ってはならない。 */
export function getLastRegisteredListIndexes(list: readonly unknown[]): IListIndex[] | null {
  return lastListIndexesByList.get(list) ?? null;
}

export function getListIndexesByList(
  list: readonly unknown[],
  parentListIndex: IListIndex | null,
): IListIndex[] | null {
  const byParent = listIndexesByParentByList.get(list);
  if (typeof byParent === "undefined") {
    return null;
  }
  return byParent.get(parentListIndex ?? ROOT_PARENT) ?? null;
}

/**
 * `listIndexes` を、その行が鋳造された親のもとへ登録する。
 * `null` は「この配列の台帳をすべての親ぶん忘れる」（テストの後始末が使う）。
 */
export function setListIndexesByList(
  list: readonly unknown[],
  listIndexes: IListIndex[] | null,
): void {
  if (listIndexes === null) {
    listIndexesByParentByList.delete(list);
    lastListIndexesByList.delete(list);
    return;
  }
  lastListIndexesByList.set(list, listIndexes);
  let byParent = listIndexesByParentByList.get(list);
  if (typeof byParent === "undefined") {
    byParent = new WeakMap<object, IListIndex[]>();
    listIndexesByParentByList.set(list, byParent);
  }
  byParent.set(listIndexes[0]?.parentListIndex ?? ROOT_PARENT, listIndexes);
}
