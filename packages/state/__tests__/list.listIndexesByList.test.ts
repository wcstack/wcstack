import { describe, it, expect } from 'vitest';
import {
  getListIndexesByList,
  resolveListIndexesByList,
  retireListIndexes,
  reviveListIndexes,
  setListIndexesByList,
} from '../src/list/listIndexesByList';
import { createListIndex } from '../src/list/createListIndex';
import { createListDiff } from '../src/list/createListDiff';

const createListIndexes = (
  parentListIndex,
  oldList,
  newList,
  oldIndexes
) => createListDiff(parentListIndex, oldList, newList, oldIndexes).newIndexes;

describe('listIndexesByList', () => {
  it('set/get できること', () => {
    const list = [1, 2, 3];
    const listIndexes = createListIndexes(null, [], list, []);

    setListIndexesByList(list, listIndexes);
    expect(getListIndexesByList(list)).toBe(listIndexes);
  });

  it('nullで削除できること', () => {
    const list = [1];
    const listIndexes = createListIndexes(null, [], list, []);

    setListIndexesByList(list, listIndexes);
    setListIndexesByList(list, null);

    expect(getListIndexesByList(list)).toBeNull();
  });

  /**
   * #256: 「生きた共有」と「陳腐化」を分ける。行集合は 1 本の配列につき 1 組のままで、
   * 陳腐化したときだけ**行の identity を保ったまま**新しい親へ付け替える。
   * 付け替えは一方通行ではない ── 鋳造時の親（home）が生き返ったら home へ戻す。
   */
  describe('退役した親の付け替え（#256）', () => {
    it('親が生きているなら付け替えない ── 2 つの親が 1 組の行集合を共有すること', () => {
      const list = [1, 2];
      const p0 = createListIndex(null, 0);
      const p1 = createListIndex(null, 1);
      const rows = [createListIndex(p0, 0), createListIndex(p0, 1)];
      setListIndexesByList(list, rows);

      // 別の生きた親から引いても同じ行集合が返り、親ポインタは動かない
      expect(resolveListIndexesByList(list, p1)).toBe(rows);
      expect(rows.map((r) => r.parentListIndex)).toEqual([p0, p0]);

      setListIndexesByList(list, null);
    });

    it('親が退役していたら、同じ行オブジェクトのまま新しい親へ付け替えること', () => {
      const list = [1, 2];
      const oldParent = createListIndex(null, 0);
      const newParent = createListIndex(null, 0); // 同じ深さ・同じ位置・別オブジェクト
      const rows = [createListIndex(oldParent, 0), createListIndex(oldParent, 1)];
      setListIndexesByList(list, rows);
      retireListIndexes([oldParent]);

      const got = resolveListIndexesByList(list, newParent)!;

      // 行集合も行オブジェクトも作り直さない（消費者が握っている content が生き残る）
      expect(got).toBe(rows);
      expect(got[0]).toBe(rows[0]);
      expect(got.map((r) => r.parentListIndex)).toEqual([newParent, newParent]);
      // WeakRef 連鎖も張り替わる（at() が死んだ親を返さない）
      expect(got[0].at(0)).toBe(newParent);

      setListIndexesByList(list, null);
    });

    /**
     * 退役の印は差分ごとに付け直される（`createListDiff` が `deleteIndexSet` を退役、
     * `newIndexes` を復活として渡す）。消えない印は「削除の履歴によって持ち主が変わったまま
     * 固定される」原因になるので、復活したら印を落とし、行集合を home へ戻す。
     */
    it('退役した親が生き返ったら、印が消えて行集合が鋳造時の親（home）へ戻ること', () => {
      const list = [1, 2];
      const home = createListIndex(null, 0);
      const other = createListIndex(null, 1);
      const rows = [createListIndex(home, 0), createListIndex(home, 1)];
      setListIndexesByList(list, rows);

      // home が退役 → 生きている other へ付け替わる
      retireListIndexes([home]);
      expect(resolveListIndexesByList(list, other)).toBe(rows);
      expect(rows.map((r) => r.parentListIndex)).toEqual([other, other]);

      // home が生き返る → 印が消え、次の引き当てで home へ戻る
      reviveListIndexes([home]);
      const got = resolveListIndexesByList(list, other)!;
      expect(got).toBe(rows);
      expect(got[0], '行オブジェクトは作り直さない').toBe(rows[0]);
      expect(got.map((r) => r.parentListIndex)).toEqual([home, home]);
      expect(got[0].at(0), 'WeakRef 連鎖も home へ戻る').toBe(home);

      setListIndexesByList(list, null);
    });

    it('home が退役したままなら、付け替え先に留まること', () => {
      const list = [1];
      const home = createListIndex(null, 0);
      const first = createListIndex(null, 1);
      const second = createListIndex(null, 2);
      const rows = [createListIndex(home, 0)];
      setListIndexesByList(list, rows);
      retireListIndexes([home]);

      expect(resolveListIndexesByList(list, first)).toBe(rows);
      expect(rows[0].parentListIndex).toBe(first);
      // home は退役したまま。生きた first からは動かさない（＝生きた共有の合流）
      expect(resolveListIndexesByList(list, second)).toBe(rows);
      expect(rows[0].parentListIndex).toBe(first);

      setListIndexesByList(list, null);
    });

    it('差し替え先も退役していたら付け替えないこと', () => {
      const list = [1];
      const oldParent = createListIndex(null, 0);
      const newParent = createListIndex(null, 0);
      const rows = [createListIndex(oldParent, 0)];
      setListIndexesByList(list, rows);
      retireListIndexes([oldParent, newParent]);

      expect(resolveListIndexesByList(list, newParent)).toBe(rows);
      expect(rows[0].parentListIndex).toBe(oldParent);

      setListIndexesByList(list, null);
    });

    it('深さ（position）が違う親へは付け替えないこと', () => {
      const list = [1];
      const grandParent = createListIndex(null, 0);
      const oldParent = createListIndex(grandParent, 0); // position 1
      const shallowParent = createListIndex(null, 0);    // position 0
      const rows = [createListIndex(oldParent, 0)];
      setListIndexesByList(list, rows);
      retireListIndexes([oldParent]);

      expect(resolveListIndexesByList(list, shallowParent)).toBe(rows);
      expect(rows[0].parentListIndex).toBe(oldParent);

      setListIndexesByList(list, null);
    });

    it('ルート直下の行（親 null）と、親 null の要求は付け替えの対象外であること', () => {
      const rootList = [1];
      const rootRows = [createListIndex(null, 0)];
      setListIndexesByList(rootList, rootRows);
      const someParent = createListIndex(null, 0);
      // 行の親が null（＝ルート直下）: 深さの比較まで行かず、**null であること**で弾く
      expect(resolveListIndexesByList(rootList, someParent)).toBe(rootRows);
      expect(rootRows[0].parentListIndex).toBeNull();

      // 要求側が null: 同じく null であることで弾く
      const childList = [2];
      const oldParent = createListIndex(null, 0);
      const childRows = [createListIndex(oldParent, 0)];
      setListIndexesByList(childList, childRows);
      retireListIndexes([oldParent]);
      expect(resolveListIndexesByList(childList, null)).toBe(childRows);
      expect(childRows[0].parentListIndex).toBe(oldParent);

      setListIndexesByList(rootList, null);
      setListIndexesByList(childList, null);
    });

    it('空の行集合（空リスト）でも落ちないこと', () => {
      const list: unknown[] = [];
      const parent = createListIndex(null, 0);
      setListIndexesByList(list, []);

      expect(resolveListIndexesByList(list, parent)).toEqual([]);

      setListIndexesByList(list, null);
    });

    /**
     * 引き当てと修理を分けてある理由の固定。観測（テスト・世代の後始末）が
     * `getListIndexesByList` を呼んだだけで行の親が動くと、観測が自分の期待を
     * 作ってしまう。修理は `resolveListIndexesByList` だけがする。
     */
    it('引き当てだけの getListIndexesByList は、付け替えの条件が揃っていても親を動かさないこと', () => {
      const list = [1];
      const oldParent = createListIndex(null, 0);
      const newParent = createListIndex(null, 0);
      const rows = [createListIndex(oldParent, 0)];
      setListIndexesByList(list, rows);
      retireListIndexes([oldParent]);

      expect(getListIndexesByList(list)).toBe(rows);
      expect(rows[0].parentListIndex, '引き当てでは動かない').toBe(oldParent);

      expect(resolveListIndexesByList(list, newParent)).toBe(rows);
      expect(rows[0].parentListIndex, '修理する API でだけ動く').toBe(newParent);

      setListIndexesByList(list, null);
    });

    it('台帳に無い配列は、どちらの API でも null であること', () => {
      const list = [1];
      const parent = createListIndex(null, 0);
      expect(getListIndexesByList(list)).toBeNull();
      expect(resolveListIndexesByList(list, parent)).toBeNull();
    });
  });
});
