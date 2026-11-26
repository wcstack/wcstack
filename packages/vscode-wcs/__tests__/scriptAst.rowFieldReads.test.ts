/**
 * findRowFieldReads — getter の本体で、一覧の行のオブジェクトから読む項目（`wcs/getter-untracked-read` の一覧の形の材料。
 * Advent Calendar の制作の記録、docs/v4-direction-2026-10.md §5.27）。
 */
import { describe, it, expect } from 'vitest';
import { findRowFieldReads } from '../src/service/scriptAst.js';

const reads = (body: string): [string, string, string][] | null => {
  const found = findRowFieldReads(body);
  return found === null ? null : found.map((r) => [r.list, r.fields.join('.'), body.slice(r.start, r.end)]);
};

describe('findRowFieldReads', () => {
  it('配列のメソッドの callback の行の引数（reduce は 2 番目、sort は両方）', () => {
    expect(reads('return this.incomes.reduce((t, row) => t + row.amount, 0);')).toEqual([['incomes', 'amount', 'row.amount']]);
    expect(reads('return this.items.toSorted((a, b) => a.rank - b.rank);')).toEqual([
      ['items', 'rank', 'a.rank'], ['items', 'rank', 'b.rank'],
    ]);
    expect(reads('return this.items.map(function (row) { return row.label; });')).toEqual([['items', 'label', 'row.label']]);
  });

  it('連鎖・スプレッド・this["…"]・optional chain の受け手。$ 始まりと this でない受け手は見ない', () => {
    // (the outer call first)
    expect(reads('return this.todos.filter((t) => t.on).slice(0, 3).map((t) => t.title);')).toEqual([
      ['todos', 'title', 't.title'], ['todos', 'on', 't.on'],
    ]);
    expect(reads('return [...this.items].map((r) => r.x);')).toEqual([['items', 'x', 'r.x']]);
    expect(reads('return this["groups.0.items"]?.map((r) => r?.x);')).toEqual([['groups.0.items', 'x', 'r?.x']]);
    expect(reads('return this.$getAll("items.*", []).map((r) => r.x);')).toEqual([]);
    expect(reads('return other.items.map((r) => r.x);')).toEqual([]);
    expect(reads('return this.items.length;')).toEqual([]);
  });

  it('項目の連なり: 静的な段まで、最後に呼ぶメソッドは落とす。引数の中も読む', () => {
    expect(reads('return this.items.map((r) => r.meta.price);')).toEqual([['items', 'meta.price', 'r.meta.price']]);
    expect(reads('return this.items.map((r) => r.name.trim());')).toEqual([['items', 'name', 'r.name.trim()']]);
    expect(reads('return this.items.map((r) => r[key].x);')).toEqual([]);
    expect(reads('return this.items.map((r) => r.tags.join(r.sep));')).toEqual([['items', 'tags', 'r.tags.join(r.sep)'], ['items', 'sep', 'r.sep']]);
    expect(reads('return this.items.map((r) => r.toString());')).toEqual([]);
  });

  it('分割代入の引数は書いたキーの所（rest・計算したキーは見ない）。配列の形の引数・引数の無い callback は見ない', () => {
    expect(reads('return this.items.reduce((s, { cost, ["qty"]: q, ...rest }) => s + cost * q, 0);')).toEqual([
      ['items', 'cost', 'cost'], ['items', 'qty', '"qty"'],
    ]);
    expect(reads('return this.items.map(([a]) => a);')).toEqual([]);
    expect(reads('return this.items.filter(() => true).length;')).toEqual([]);
    expect(reads('return this.items.map((r = {}) => r.x);')).toEqual([['items', 'x', 'r.x']]);
  });

  it('for…of（宣言でも既存の変数でも）', () => {
    expect(reads('let s = 0; for (const t of this.list) s += t.cost; return s;')).toEqual([['list', 'cost', 't.cost']]);
    expect(reads('let t; for (t of this.list) {} return t && t.cost;')).toEqual([]);
    expect(reads('let s = ""; let t; for (t of this.list) s += t.name; return s;')).toEqual([['list', 'name', 't.name']]);
  });

  it('行への代入は読みではない（右辺は読む）。行の名前を引数で束縛し直す入れ子の関数の中は追わない', () => {
    expect(reads('this.items.forEach((r) => { r.total = r.price * 2; r.count++; }); return 0;')).toEqual([['items', 'price', 'r.price']]);
    expect(reads('return this.items.map((r) => [1].map((r) => r.x));')).toEqual([]);
    expect(reads('return this.items.map((r) => [1].map((q) => r.x + q.y));')).toEqual([['items', 'x', 'r.x']]);
  });

  it('function の中の this は state ではない。class の中は見ない。パースできなければ null', () => {
    expect(reads('const f = function () { return this.items.map((r) => r.x); }; return f;')).toEqual([]);
    expect(reads('class A { m() { return this.items.map((r) => r.x); } } return 0;')).toEqual([]);
    expect(reads('return this.items.map((r) => r.x')).toBeNull();
  });
});
