/**
 * scan.initialValue.test.ts
 *
 * 出力に置く `initial` の複製と、値での比較（docs/state-scan-design.md D6 / D7・§5-9）。
 */
import { describe, it, expect } from "vitest";
import { cloneInitial, isSameAsInitial, recordOutputValue, wasPlacedOnOutput } from "../src/scan/initialValue";

describe("出力に置いた関数値の記録", () => {
  it("関数だけを出力名ごとに記録し、同じ関数を別の出力に置いても両方を覚えること", () => {
    const fn = (): number => 1;
    expect(wasPlacedOnOutput("a", fn)).toBe(false);
    recordOutputValue("a", fn);
    recordOutputValue("b", fn);
    recordOutputValue("a", { not: "function" });
    expect(wasPlacedOnOutput("a", fn)).toBe(true);
    expect(wasPlacedOnOutput("b", fn)).toBe(true);
    expect(wasPlacedOnOutput("c", fn)).toBe(false);
    expect(wasPlacedOnOutput("a", 0)).toBe(false);
  });
});

describe("cloneInitial", () => {
  it("plain なデータ（配列・オブジェクト・null プロトタイプ）は再帰で複製し、配列の穴も保つこと", () => {
    const meta = Object.assign(Object.create(null) as Record<string, unknown>, { tag: "a" });
    // eslint-disable-next-line no-sparse-arrays
    const holes = [1, , 3];
    const initial = { items: [{ id: 1 }], meta, holes };
    const copy = cloneInitial(initial);
    expect(copy).toEqual(initial);
    expect(copy).not.toBe(initial);
    expect(copy.items).not.toBe(initial.items);
    expect(copy.items[0]).not.toBe(initial.items[0]);
    expect(copy.meta).not.toBe(meta);
    expect(Object.getPrototypeOf(copy.meta)).toBeNull();
    expect(copy.holes).not.toBe(holes);
    expect(copy.holes).toHaveLength(3);
    expect(1 in copy.holes).toBe(false);
  });

  it("プリミティブ・関数・クラスのインスタンス・Map・Date は参照のまま返し、plain なデータの中にあっても参照のまま写すこと", () => {
    class Box { value = 0; }
    const fn = (): number => 1;
    const box = new Box();
    const map = new Map([["a", 1]]);
    const date = new Date(0);
    expect(cloneInitial(0)).toBe(0);
    expect(cloneInitial(null)).toBeNull();
    expect(cloneInitial(fn)).toBe(fn);
    expect(cloneInitial(box)).toBe(box);
    const copy = cloneInitial({ box, map, date });
    expect(copy.box).toBe(box);
    expect(copy.map).toBe(map);
    expect(copy.date).toBe(date);
  });

  it("plain でないオブジェクト（getter / setter・throw する getter・Symbol キー・列挙できないプロパティ・凍結）は参照のまま返し、getter を実行しないこと", () => {
    let calls = 0;
    const withGetter = { get count(): number { calls++; return 0; } };
    const withSetter = { set sink(_value: unknown) { /* sink */ } };
    const throwing = { get boom(): never { throw new Error("getter boom"); } };
    const withSymbol = { a: 1, [Symbol("tag")]: 2 };
    const nonEnumerable = Object.defineProperty({ a: 1 }, "hidden", { value: 2, enumerable: false });
    const frozen = Object.freeze({ a: 1 });
    for (const value of [withGetter, withSetter, throwing, withSymbol, nonEnumerable, frozen]) {
      expect(cloneInitial(value)).toBe(value);
    }
    expect(calls).toBe(0);
  });

  it("plain でない配列（サブクラス・追加プロパティ・添字の accessor・凍結）は参照のまま返すこと", () => {
    class Rows<T> extends Array<T> {}
    const subclass = new Rows<number>();
    subclass.push(1);
    const extra = Object.assign([1, 2], { note: "x" });
    const accessorIndex = Object.defineProperty([0], "0", { get: () => 1, enumerable: true });
    const frozen = Object.freeze([1, 2]);
    for (const value of [subclass, extra, accessorIndex, frozen]) {
      expect(cloneInitial(value)).toBe(value);
    }
  });

  it("循環と共有参照は、複製の中でも同じ形に保つこと", () => {
    const shared = { v: 1 };
    const initial: any = { a: shared, b: shared, list: [] as unknown[] };
    initial.self = initial;
    initial.list.push(initial.list);
    const copy = cloneInitial(initial);
    expect(copy.self).toBe(copy);
    expect(copy.a).toBe(copy.b);
    expect(copy.a).not.toBe(shared);
    expect(copy.list[0]).toBe(copy.list);
  });
});

describe("isSameAsInitial", () => {
  it("plain なデータは中身で比べること", () => {
    const initial = { items: [1, 2], note: "", nested: { x: 1 } };
    expect(isSameAsInitial(cloneInitial(initial), initial)).toBe(true);
    expect(isSameAsInitial({ items: [1, 2], note: "typed", nested: { x: 1 } }, initial), "値が違う").toBe(false);
    expect(isSameAsInitial({ items: [1], note: "", nested: { x: 1 } }, initial), "長さが違う").toBe(false);
    expect(isSameAsInitial({ items: [1, 3], note: "", nested: { x: 1 } }, initial), "要素が違う").toBe(false);
    expect(isSameAsInitial({ items: [1, 2], note: "" }, initial), "キーの数が違う").toBe(false);
    expect(isSameAsInitial({ items: [1, 2], note: "", other: { x: 1 } }, initial), "キーが違う").toBe(false);
    expect(isSameAsInitial([], {}), "配列とオブジェクト").toBe(false);
    expect(isSameAsInitial(Object.create(null), {}), "null プロトタイプ").toBe(true);
  });

  it("プリミティブは Object.is で、plain でない値は同一性で比べ、getter を実行しないこと", () => {
    class Box { value = 0; }
    const box = new Box();
    let calls = 0;
    const withGetter = { get count(): number { calls++; return 0; } };
    expect(isSameAsInitial(Number.NaN, Number.NaN)).toBe(true);
    expect(isSameAsInitial(0, -0)).toBe(false);
    expect(isSameAsInitial(new Box(), new Box())).toBe(false);
    expect(isSameAsInitial({ box }, { box })).toBe(true);
    expect(isSameAsInitial("a", { a: 1 })).toBe(false);
    expect(isSameAsInitial({ count: 0 }, withGetter), "plain とそうでない値").toBe(false);
    expect(isSameAsInitial(Object.freeze({ a: 1 }), { a: 1 }), "凍結された値は同一性").toBe(false);
    expect(isSameAsInitial(Object.freeze([1, 2]), [1, 2]), "凍結された配列も同一性").toBe(false);
    expect(isSameAsInitial(null, {}), "null と plain なオブジェクト").toBe(false);
    expect(isSameAsInitial({}, []), "オブジェクトと配列").toBe(false);
    expect(calls).toBe(0);
  });

  it("配列の長さが違えば、出力側の要素と descriptor を見ずに false を返すこと（大きな出力を空の initial と比べる）", () => {
    let touched = 0;
    const current = [0, 1, 2];
    Object.defineProperty(current, "1", {
      get(): number { touched++; return 1; },
      enumerable: true,
      configurable: true,
    });
    expect(isSameAsInitial(current, [])).toBe(false);
    expect(isSameAsInitial({ items: current }, { items: [] })).toBe(false);
    expect(touched).toBe(0);
  });

  it("形の違う循環（自己循環と 2 段の循環）も、配列とオブジェクトの両方向で止まって比べられること", () => {
    const selfArray: unknown[] = [];
    selfArray.push(selfArray);
    const ringA: unknown[] = [];
    const ringB: unknown[] = [ringA];
    ringA.push(ringB);
    expect(isSameAsInitial(selfArray, ringA)).toBe(true);
    expect(isSameAsInitial(ringA, selfArray)).toBe(true);

    const selfObject: any = {};
    selfObject.self = selfObject;
    const pairA: any = {};
    const pairB: any = { self: pairA };
    pairA.self = pairB;
    expect(isSameAsInitial(selfObject, pairA)).toBe(true);
    expect(isSameAsInitial(pairA, selfObject)).toBe(true);
  });

  it("共有参照を持つ値も、別々の値と比べられること", () => {
    const shared = { v: 1 };
    expect(isSameAsInitial({ x: shared, y: shared }, { x: { v: 1 }, y: { v: 1 } })).toBe(true);
    expect(isSameAsInitial({ x: shared, y: shared }, { x: { v: 1 }, y: { v: 2 } })).toBe(false);
  });
});
