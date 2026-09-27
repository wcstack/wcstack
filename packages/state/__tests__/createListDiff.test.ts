import { describe, it, expect } from 'vitest';
import { createListDiff } from '../src/list/createListDiff';
import { getListIndexesByList, retireListIndexes, setListIndexesByList } from '../src/list/listIndexesByList';
import { createListIndex, getHomeParentListIndex, setListIndexValue } from '../src/list/createListIndex';
import { advanceUpdateBatch } from '../src/updater/updateBatch';

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

    it('差分を取った後で新しい配列の台帳が差し替わったら、キャッシュを使わず台帳どうしで取り直すこと（#335）', () => {
      // 要素書き込みの入れ替えが揃うと、いまの配列の台帳は新しい配列に差し替わる。同じバッチで先に取った
      // 置き換えの差分（`for` がまだ適用していない）は、差し替え前の行を newIndexes に持ったまま
      const listA = [{ v: 1 }, { v: 2 }];
      const [rowA0, rowA1] = createListDiff(null, [], listA).newIndexes;
      const listB = [listA[0], listA[1], { v: 3 }];
      const d1 = createListDiff(null, listA, listB);
      const [, , rowB2] = d1.newIndexes;
      const replaced = createListIndex(null, 0);
      listB[0] = { v: 9 }; // 要素書き込みが行 0 を差し替えた
      setListIndexesByList(listB, [replaced, rowA1, rowB2]);

      const d2 = createListDiff(null, listA, listB);

      expect(d2).not.toBe(d1);
      expect(d2.newIndexes).toEqual([replaced, rowA1, rowB2]);
      expect([...d2.addIndexSet]).toEqual([replaced, rowB2]);
      expect([...d2.deleteIndexSet]).toEqual([rowA0]);
      // 台帳が差分の newIndexes のままなら、キャッシュを返す
      expect(createListDiff(null, listA, listB)).not.toBe(d1);
      setListIndexesByList(listB, d1.newIndexes);
      expect(createListDiff(null, listA, listB)).toBe(d1);

      setListIndexesByList(listA, null);
      setListIndexesByList(listB, null);
    });

    it('同じ中身の写しで置き換えた差分（台帳を前の配列と共有）も、写しの台帳が差し替われば取り直すこと（#335）', () => {
      const listA = [{ v: 1 }, { v: 2 }];
      const rows = createListDiff(null, [], listA).newIndexes;
      const listB = [...listA];
      const d1 = createListDiff(null, listA, listB);
      expect(d1.newIndexes).toBe(rows);
      const replaced = createListIndex(null, 1);
      listB[1] = { v: 9 };
      setListIndexesByList(listB, [rows[0], replaced]);

      const d2 = createListDiff(null, listA, listB);

      expect([...d2.addIndexSet]).toEqual([replaced]);
      expect([...d2.deleteIndexSet]).toEqual([rows[1]]);
      expect(getListIndexesByList(listA)).toBe(rows);

      setListIndexesByList(listA, null);
      setListIndexesByList(listB, null);
    });
  });

  describe('退役した親の付け替え（#256）', () => {
    it('生きた親どうしは 1 組の行集合を共有すること（親ごとに割れない）', () => {
      const list = [{ v: 1 }, { v: 2 }];
      const p0 = createListIndex(null, 0);
      const p1 = createListIndex(null, 1);

      const d0 = createListDiff(p0, [], list);
      const d1 = createListDiff(p1, [], list);

      // 1 本の配列につき行集合は 1 組。2 人目の親は先着の行を受け取る（＝ main の挙動）。
      // 親ごとに私有の行集合を持たせると、同じスロットに 2 本の絶対アドレスができ、
      // 片方へ書いた値がもう片方から永久に見えなくなる。
      expect(d1.newIndexes).toBe(d0.newIndexes);
      expect(getListIndexesByList(list)).toBe(d0.newIndexes);
      // 先着の親は生きているので親ポインタは動かない
      expect(d0.newIndexes.map((r) => r.parentListIndex)).toEqual([p0, p0]);
      expect(d1.deleteIndexSet.size).toBe(0);

      setListIndexesByList(list, null);
    });

    it('親が退役していたら、同じ行オブジェクトのまま新しい親のもとで使われること', () => {
      const list = [{ v: 1 }, { v: 2 }];
      const oldParent = createListIndex(null, 0);
      const rows = createListDiff(oldParent, [], list).newIndexes;

      // 行オブジェクトだけを作り直す置換（map-spread）で旧行が退役する形。
      // 実際の経路では nodes の diff が deleteIndexSet に載せる（統合テストが固定）。
      const newParent = createListIndex(null, 0);
      retireListIndexes([oldParent]);
      const again = createListDiff(newParent, list, list);

      // 行は作り直されない（消費者が握っている content が生き残る）
      expect(again.newIndexes).toBe(rows);
      expect(again.newIndexes[0]).toBe(rows[0]);
      expect(again.addIndexSet.size).toBe(0);
      expect(again.deleteIndexSet.size).toBe(0);
      // 親ポインタだけが生きた行へ張り替わる（#256 の核心）
      expect(rows.map((r) => r.parentListIndex)).toEqual([newParent, newParent]);

      setListIndexesByList(list, null);
    });

    /**
     * #256: 差分が作る行集合の home は 1 つ。前の行集合を引き継ぐ差分（値照合の経路）で
     * 新しく鋳造される行は、鋳造時の親ではなくその行集合の home を継ぐ。
     * 行ごとに home が違う集合ができると、「持ち主が戻ってきたか」の判定が
     * `listIndexes[0]` に当たった行で変わってしまう。
     */
    it('引き継いだ行集合に足した行も、行集合の home を継ぐこと', () => {
      const listA = [{ v: 1 }, { v: 2 }];
      const home = createListIndex(null, 0);
      const rows = createListDiff(home, [], listA).newIndexes;
      for (const row of rows) {
        expect(getHomeParentListIndex(row)).toBe(home);
      }

      // 別の生きた親がその行集合を引き継ぎ、先頭に 1 行足す（値照合の経路）
      const other = createListIndex(null, 1);
      const listB = [{ v: 0 }, ...listA];
      const grown = createListDiff(other, listA, listB).newIndexes;

      expect(grown).toHaveLength(3);
      expect(grown[1], '引き継いだ行は作り直さない').toBe(rows[0]);
      expect(grown[2]).toBe(rows[1]);
      for (const row of grown) {
        expect(getHomeParentListIndex(row), '足した行の home も元の行集合のもの').toBe(home);
      }

      setListIndexesByList(listA, null);
      setListIndexesByList(listB, null);
    });

    it('前世代を持たない親の diff は、消費者が握っている前世代の行を退役させること', () => {
      const oldList = [{ v: 1 }];
      const newList = [{ v: 2 }];
      const oldParent = createListIndex(null, 0);
      const before = createListDiff(oldParent, [], oldList).newIndexes;

      const diff = createListDiff(oldParent, oldList, newList);

      expect([...diff.deleteIndexSet]).toEqual(before);
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

describe('行はそのままで要素が替わった行（#359）', () => {
  /** saved の台帳の行を next の台帳が共有し、next の行 0 が要素の書き込みでその場で o3 を映す形 */
  function setup() {
    const o1 = { id: 1 };
    const o2 = { id: 2 };
    const o3 = { id: 3 };
    const saved = [o1, o2, o3];
    createListDiff(null, [], saved);
    const next = [o1, o2, o3, { id: 4 }];
    createListDiff(null, saved, next);
    const row = getListIndexesByList(next)![0];
    next[0] = o3;
    setListIndexValue(row, o3);
    return { saved, next, row };
  }

  it('両方の配列に台帳がある差分は呼ぶたびに取り直すが、同じバッチの間は後の呼び出しにも拾った行を渡すこと', () => {
    const { saved, next, row } = setup();
    const first = createListDiff(null, next, saved);
    const second = createListDiff(null, next, saved);
    expect(first.valueChangeIndexes).toEqual([row]);
    expect(second).not.toBe(first);
    // 同じ配列を別のパスが描く（配列をそのまま返す getter の for）と、そのパスの展開が取り直す差分
    expect(second.valueChangeIndexes).toEqual([row]);
    setListIndexesByList(saved, null);
    setListIndexesByList(next, null);
  });

  it('バッチが替われば渡さないこと', () => {
    const { saved, next, row } = setup();
    expect(createListDiff(null, next, saved).valueChangeIndexes).toEqual([row]);
    advanceUpdateBatch();
    expect(createListDiff(null, next, saved).valueChangeIndexes).toBeUndefined();
    setListIndexesByList(saved, null);
    setListIndexesByList(next, null);
  });
});

describe('行はそのままで要素が替わった行（#359）: 同じ配列への別の差分', () => {
  it('同じバッチで別の配列から同じ配列への差分が別の行を拾ったら、両方を渡すこと', () => {
    const o1 = { id: 1 };
    const o2 = { id: 2 };
    const saved = [o1, o2];
    createListDiff(null, [], saved);
    const x = [o1, o2, { id: 3 }];
    createListDiff(null, saved, x);
    const y = [o1, o2, { id: 4 }];
    createListDiff(null, saved, y);
    const [row0, row1] = getListIndexesByList(saved)!;
    x[0] = o2;
    setListIndexValue(row0, o2);
    expect(createListDiff(null, x, saved).valueChangeIndexes).toEqual([row0]);
    y[1] = o1;
    setListIndexValue(row1, o1);
    expect(createListDiff(null, y, saved).valueChangeIndexes).toEqual([row0, row1]);
    for (const list of [saved, x, y]) {
      setListIndexesByList(list, null);
    }
  });
});
