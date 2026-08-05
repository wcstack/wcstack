/**
 * listKeys.test.ts — `$listKeys` 宣言のバリデーションと、キー突合／値展開の
 * 純粋関数部分の単体テスト（docs/state-list-key-design.md §3.1 / §5 / §6）。
 */
import { describe, it, expect } from "vitest";
import { processListKeysDeclaration } from "../src/list/listKeys";
import { collectFieldWrites, mergeKeyedList } from "../src/list/mergeKeyedList";
import type { IState } from "../src/types";

const decl = (value: unknown): IState => ({ $listKeys: value } as unknown as IState);

describe("processListKeysDeclaration: 宣言のバリデーション", () => {
  it("宣言が無ければ null（ゼロコスト経路）", () => {
    expect(processListKeysDeclaration({} as IState)).toBe(null);
  });

  it("空の宣言も null に畳むこと", () => {
    expect(processListKeysDeclaration(decl({}))).toBe(null);
  });

  it("フィールド名・関数の両方を受理すること", () => {
    const keyFn = (row: any) => row.uid;
    const map = processListKeysDeclaration(decl({ items: "id", "items.*.children": keyFn }))!;
    expect(map.get("items")).toBe("id");
    expect(map.get("items.*.children")).toBe(keyFn);
  });

  it("オブジェクト以外の宣言を拒否すること", () => {
    expect(() => processListKeysDeclaration(decl("id"))).toThrow(/must be an object/);
    expect(() => processListKeysDeclaration(decl(null))).toThrow(/must be an object/);
  });

  it("空パス・空セグメントを拒否すること", () => {
    expect(() => processListKeysDeclaration(decl({ "": "id" }))).toThrow(/non-empty string/);
    expect(() => processListKeysDeclaration(decl({ "a..b": "id" }))).toThrow(/empty path segments/);
  });

  it("要素パス（末尾が *）を拒否すること", () => {
    expect(() => processListKeysDeclaration(decl({ "items.*": "id" }))).toThrow(/list path itself/);
  });

  it("キー指定の型・形を検査すること", () => {
    expect(() => processListKeysDeclaration(decl({ items: 1 }))).toThrow(/must be a field name/);
    expect(() => processListKeysDeclaration(decl({ items: "" }))).toThrow(/non-empty string/);
    expect(() => processListKeysDeclaration(decl({ items: "a.b" }))).toThrow(/flat property name/);
    expect(() => processListKeysDeclaration(decl({ items: "a*" }))).toThrow(/flat property name/);
  });

  it("Object.prototype 継承名をキーに使えないこと", () => {
    expect(() => processListKeysDeclaration(decl({ items: "constructor" })))
      .toThrow(/inherited from Object\.prototype/);
  });
});

describe("mergeKeyedList: キー突合とハイブリッド配列", () => {
  const rows = (...ids: number[]) => ids.map((id) => ({ id, v: `v${id}` }));

  it("旧配列が無い／空なら null（初回代入は素通し）", () => {
    expect(mergeKeyedList("items", "id", undefined, rows(1))).toBe(null);
    expect(mergeKeyedList("items", "id", [], rows(1))).toBe(null);
  });

  it("新配列が空なら null（全削除は通常経路）", () => {
    expect(mergeKeyedList("items", "id", rows(1), [])).toBe(null);
  });

  it("一致行が旧オブジェクトに差し替わること", () => {
    const old = rows(1, 2);
    const fresh = [{ id: 1, v: "V1" }, { id: 2, v: "v2" }];
    const merge = mergeKeyedList("items", "id", old, fresh)!;
    expect(merge.list[0]).toBe(old[0]);
    expect(merge.list[1]).toBe(old[1]);
    expect(merge.matched.map((m) => m.position)).toEqual([0, 1]);
  });

  it("未一致行は新オブジェクトのまま残ること", () => {
    const old = rows(1);
    const added = { id: 9, v: "v9" };
    const merge = mergeKeyedList("items", "id", old, [old[0] && { id: 1, v: "v1" }, added])!;
    expect(merge.list[0]).toBe(old[0]);
    expect(merge.list[1]).toBe(added);
  });

  it("全行が既に同一オブジェクトなら null（in-place 変異リフレッシュを従来経路に委ねる）", () => {
    const old = rows(1, 2);
    expect(mergeKeyedList("items", "id", old, [...old])).toBe(null);
  });

  it("並べ替えでも旧オブジェクトが正しい位置に入ること", () => {
    const old = rows(1, 2, 3);
    const merge = mergeKeyedList("items", "id", old, [
      { id: 3, v: "v3" },
      { id: 1, v: "v1" },
    ])!;
    expect(merge.list).toEqual([old[2], old[0]]);
  });

  it("キー関数を使えること", () => {
    const old = [{ ns: "x", id: 1 }, { ns: "y", id: 1 }];
    const spec = (row: any) => `${row.ns}/${row.id}`;
    const merge = mergeKeyedList("items", spec, old, [{ ns: "y", id: 1 }])!;
    expect(merge.list[0]).toBe(old[1]);
  });

  it("キー重複・欠落・非 plain を即エラーにすること（§5）", () => {
    const old = rows(1);
    expect(() => mergeKeyedList("items", "id", old, [{ id: 1 }, { id: 1 }]))
      .toThrow(/duplicate key 1 in new list/);
    expect(() => mergeKeyedList("items", "id", old, [{ v: "x" }]))
      .toThrow(/has no key \(field "id" returned undefined\)/);
    expect(() => mergeKeyedList("items", "id", old, [{ id: null }]))
      .toThrow(/has no key \(field "id" returned null\)/);
    expect(() => mergeKeyedList("items", () => undefined, old, [{ id: 1 }]))
      .toThrow(/has no key \(key function returned undefined\)/);
    expect(() => mergeKeyedList("items", "id", old, [null]))
      .toThrow(/must be a plain object \(got null\)/);
    expect(() => mergeKeyedList("items", "id", old, [[1, 2]]))
      .toThrow(/class instances and exotic objects/);
    expect(() => mergeKeyedList("items", "id", [{ id: 1 }, { id: 1 }], [{ id: 1 }]))
      .toThrow(/duplicate key 1 in current list/);
  });

  it("null プロトタイプの行は受理すること（own データプロパティのみで値展開できる）", () => {
    const bare = Object.create(null);
    bare.id = 1;
    bare.v = "v1";
    expect(() => mergeKeyedList("items", "id", [bare], [{ id: 1, v: "V1" }])).not.toThrow();
  });
});

describe("collectFieldWrites: 値展開するフィールドの列挙", () => {
  it("変化したフィールドだけを返すこと（無変化はゼロ件）", () => {
    expect(collectFieldWrites({ id: 1, a: "x" }, { id: 1, a: "x" })).toEqual([]);
    expect(collectFieldWrites({ id: 1, a: "x" }, { id: 1, a: "y" }))
      .toEqual([{ field: "a", value: "y" }]);
  });

  it("新しく増えたフィールドを返すこと", () => {
    expect(collectFieldWrites({ id: 1 }, { id: 1, a: "x" }))
      .toEqual([{ field: "a", value: "x" }]);
  });

  it("消えたフィールドは null でクリアすること（undefined は書き込みがスキップされる）", () => {
    expect(collectFieldWrites({ id: 1, a: "x" }, { id: 1 }))
      .toEqual([{ field: "a", value: null }]);
  });

  it("既に null / undefined のフィールドにはクリアを発行しないこと", () => {
    expect(collectFieldWrites({ id: 1, a: null, b: undefined }, { id: 1 })).toEqual([]);
  });

  it("Object.is 基準で判定すること（NaN の再書き込みを作らない）", () => {
    expect(collectFieldWrites({ id: 1, a: NaN }, { id: 1, a: NaN })).toEqual([]);
  });

  it("継承プロパティを own 扱いしないこと", () => {
    const oldRow = { id: 1, toString: "own" } as any;
    expect(collectFieldWrites(oldRow, { id: 1 } as any))
      .toEqual([{ field: "toString", value: null }]);
  });
});
