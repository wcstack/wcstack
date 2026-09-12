import { describe, it, expect } from 'vitest';
import { createListDiff } from '../src/list/createListDiff';
import { getListIndexesByList, setListIndexesByList } from '../src/list/listIndexesByList';
import { createListIndex } from '../src/list/createListIndex';

describe('createListDiff', () => {
  it('calcDiffIndexesで位置が変わった既存要素がchangeIndexSetに含まれること', () => {
    // oldList と newList の両方にlistIndexesが登録済みの場合、calcDiffIndexesが呼ばれる。
    // 台帳はチェーンした diff で共有させる（往復パターン）
    const listA = [1, 2, 3];
    const dA = createListDiff(null, [], listA);
    const [i1, , i3] = dA.newIndexes;
    const listB = [3, 1];
    createListDiff(null, listA, listB); // build 経路: ledger(B) を A と共有して登録

    // (B,A) は未キャッシュ・ledger(A) 登録済み → calcDiffIndexes に入る
    // B=[3,1] → A=[1,2,3]: 1 は 1→0、3 は 0→2 で位置変更
    const diff = createListDiff(null, listB, listA);

    expect(diff.changeIndexSet.has(i1)).toBe(true);
    expect(diff.changeIndexSet.has(i3)).toBe(true);
    // マーカーは必ず newIndexes のメンバーであること
    const newIndexSet = new Set(diff.newIndexes);
    for (const marker of diff.changeIndexSet) {
      expect(newIndexSet.has(marker)).toBe(true);
    }

    // クリーンアップ
    setListIndexesByList(listA, null);
    setListIndexesByList(listB, null);
  });

  it('calcDiffIndexes: 台帳が分岐している場合に oldIndexes 側の孤児マーカーが混入しないこと', () => {
    // 同じ行オブジェクトを含む2つの配列を、それぞれ独立に（接続されない diff で）
    // 台帳化したケース。identity が無い行は add+delete で表現されるのが正であり、
    // changeIndexSet に oldIndexes 側のオブジェクトが混入してはならない
    // （消費側 applyChangeToFor / walkDependency は newIndexes 側の identity 前提）。
    const r1 = { id: 1 };
    const r2 = { id: 2 };
    const oldList = [r1, r2];
    const newList = [r2, r1];
    createListDiff(null, [], oldList);
    createListDiff(null, [], newList); // oldList と未接続の台帳

    const diff = createListDiff(null, oldList, newList); // calcDiffIndexes 経路

    expect(diff.addIndexSet.size).toBe(2);
    expect(diff.deleteIndexSet.size).toBe(2);
    expect(diff.changeIndexSet.size).toBe(0);

    // クリーンアップ
    setListIndexesByList(oldList, null);
    setListIndexesByList(newList, null);
  });

  it('calcDiffIndexes: 共有行と分岐行が混在しても、共有行の移動だけが記録されること', () => {
    // ledger(N) は X から作られ、oldList A とは一部（iq）だけ台帳を共有する
    const listA = ['p', 'q'];
    const dA = createListDiff(null, [], listA);
    const [ip, iq] = dA.newIndexes;
    const listX = ['q'];
    createListDiff(null, listA, listX); // ledger(X) = [iq]（共有）
    const listN = ['n', 'q'];
    const dN = createListDiff(null, listX, listN); // ledger(N) = [in(新規), iq]
    const inNew = dN.newIndexes[0];

    const diff = createListDiff(null, listA, listN); // (A,N) 未キャッシュ → calcDiffIndexes

    // iq: A では位置 1、N でも位置 1 → 移動なし
    expect(diff.changeIndexSet.has(iq)).toBe(false);
    // in: A の台帳に無い → add
    expect(diff.addIndexSet.has(inNew)).toBe(true);
    // ip: N の台帳に無い → delete
    expect(diff.deleteIndexSet.has(ip)).toBe(true);
    // 'n' は A に値として存在しないが、値マッチングによる孤児マーカーが出ないこと
    expect(diff.changeIndexSet.size).toBe(0);

    // クリーンアップ
    setListIndexesByList(listA, null);
    setListIndexesByList(listX, null);
    setListIndexesByList(listN, null);
  });

  describe('同一バッチ内の連続 diff（未適用 diff による .index 先行変異の影響）', () => {
    it('未適用の中間 diff があっても、2回目の diff の changeIndexSet は古いリスト基準で計算されること', () => {
      const listA = ['x', 'y'];
      const first = createListDiff(null, [], listA);
      const [idxX, idxY] = first.newIndexes;

      const listB = ['y', 'x'];
      createListDiff(null, listA, listB); // 中間 diff（適用されない）が .index を変異させる

      const listC = ['y', 'x']; // 別配列・中間リストと同順
      const diff = createListDiff(null, listA, listC);
      // 両行とも描画済みリスト A からは位置が変わっている
      expect(diff.changeIndexSet.has(idxX)).toBe(true);
      expect(diff.changeIndexSet.has(idxY)).toBe(true);
      // .index は新リストの位置に同期されている
      expect(diff.newIndexes.map((li) => li.index)).toEqual([0, 1]);

      setListIndexesByList(listA, null);
      setListIndexesByList(listB, null);
      setListIndexesByList(listC, null);
    });

    it('同一参照リストへの diff で、未適用の中間 diff による .index の変異が復元されること', () => {
      const listA = ['x', 'y'];
      const first = createListDiff(null, [], listA);
      const [idxX, idxY] = first.newIndexes;

      const listB = ['y', 'x'];
      createListDiff(null, listA, listB);
      expect(idxX.index).toBe(1); // 中間 diff による変異

      const diff = createListDiff(null, listA, listA);
      expect(diff.changeIndexSet.size).toBe(0);
      expect(idxX.index).toBe(0); // 復元
      expect(idxY.index).toBe(1);

      setListIndexesByList(listA, null);
      setListIndexesByList(listB, null);
    });

    it('キャッシュヒットでも newIndexes の .index が新リストの位置に同期されること', () => {
      const listA = ['x', 'y'];
      createListDiff(null, [], listA);
      const listB = ['y', 'x'];
      const d1 = createListDiff(null, listA, listB);
      const [idxY, idxX] = d1.newIndexes;

      createListDiff(null, listA, listA); // .index を A の位置へ復元
      expect(idxX.index).toBe(0);

      const d2 = createListDiff(null, listA, listB); // キャッシュヒット
      expect(d2).toBe(d1);
      expect(idxY.index).toBe(0); // B の位置へ再同期
      expect(idxX.index).toBe(1);

      setListIndexesByList(listA, null);
      setListIndexesByList(listB, null);
    });
  });

  describe('台帳のキーが (親, 配列) の組であること（#256）', () => {
    it('別の親が登録した行を再利用せず、自分の行を鋳造すること', () => {
      const list = [{ v: 1 }, { v: 2 }];
      const p0 = createListIndex(null, 0);
      const p1 = createListIndex(null, 1);

      const d0 = createListDiff(p0, [], list);
      const d1 = createListDiff(p1, [], list);

      expect(d1.newIndexes).not.toBe(d0.newIndexes);
      expect(d0.newIndexes.map((r) => r.parentListIndex)).toEqual([p0, p0]);
      expect(d1.newIndexes.map((r) => r.parentListIndex)).toEqual([p1, p1]);
      // 2 人目の親は「全行 add」。先着の親が描画している行を delete 扱いにしてはならない
      expect(d1.deleteIndexSet.size).toBe(0);
      expect(d1.addIndexSet.size).toBe(2);
      // 先着の親の台帳はそのまま残っている
      expect(getListIndexesByList(list, p0)).toBe(d0.newIndexes);

      setListIndexesByList(list, null);
    });

    it('同じ (旧, 新) の組でも、親が違えば diff のメモが混ざらないこと', () => {
      const oldList = [{ v: 1 }];
      const newList = [{ v: 2 }];
      const p0 = createListIndex(null, 0);
      const p1 = createListIndex(null, 1);
      createListDiff(p0, [], oldList);
      createListDiff(p1, [], oldList);

      const a = createListDiff(p0, oldList, newList);
      const b = createListDiff(p1, oldList, newList);

      expect(b).not.toBe(a);
      expect(a.newIndexes[0].parentListIndex).toBe(p0);
      expect(b.newIndexes[0].parentListIndex).toBe(p1);

      setListIndexesByList(oldList, null);
      setListIndexesByList(newList, null);
    });

    it('前世代を持たない親の diff は、消費者が握っている前世代の行を退役させること', () => {
      // 再接続で `for` のアドレスだけが張り替わる形（BindingSession.rebindAddresses は
      // 差分基準だけを旧アドレスから引き継ぐ）。旧リストの行は別の親のもとにあるが、
      // 消費者（applyChangeToFor）は行 identity で content を握ったままなので、
      // delete で名指さないと画面に残る。
      const oldList = [{ v: 1 }];
      const newList = [{ v: 2 }];
      const oldParent = createListIndex(null, 0);
      const newParent = createListIndex(null, 0); // 同じ位置・別オブジェクト
      const before = createListDiff(oldParent, [], oldList).newIndexes;

      const diff = createListDiff(newParent, oldList, newList);

      expect([...diff.deleteIndexSet]).toEqual(before);
      expect(diff.newIndexes.map((r) => r.parentListIndex)).toEqual([newParent]);
      expect(diff.addIndexSet.size).toBe(1);
      expect(diff.changeIndexSet.size).toBe(0);

      setListIndexesByList(oldList, null);
      setListIndexesByList(newList, null);
    });

    it('同じ親・同じ配列なら台帳をそのまま返し、行を作り直さないこと', () => {
      const list = [{ v: 1 }, { v: 2 }];
      const p0 = createListIndex(null, 0);
      const rows = createListDiff(p0, [], list).newIndexes;

      const again = createListDiff(p0, list, list);

      expect(again.newIndexes).toBe(rows);
      expect(again.addIndexSet.size).toBe(0);
      expect(again.deleteIndexSet.size).toBe(0);

      setListIndexesByList(list, null);
    });
  });
});
