import { describe, it, expect, afterAll } from "vitest";
import { generateStateSchema, loadStateFile, resolveCompilerOptions, DEFAULT_MAX_DEPTH } from "../src/exports";
import { makeTempDir } from "./helpers";

const tmp = makeTempDir();
afterAll(() => tmp.cleanup());

let n = 0;
function schemaOf(source: string, ext: "ts" | "js" = "ts", options: Parameters<typeof generateStateSchema>[1] = {}) {
  const file = tmp.write(`case-${++n}/state.${ext}`, source);
  return generateStateSchema(file, options);
}

describe("型 → stateSchema 変換（規範 §4 のサブセットのみ）", () => {
  it("プリミティブ / 配列 / 入れ子オブジェクト / required", () => {
    const { schema, warnings } = schemaOf(`
export default {
  count: 0,
  name: "x",
  active: true,
  tags: [] as string[],
  users: [] as { name: string; age: number }[],
  cart: { total: 0, items: [] as { price: number }[] },
};`);
    expect(warnings).toEqual([]);
    expect(schema).toEqual({
      type: "object",
      properties: {
        count: { type: "number" },
        name: { type: "string" },
        active: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
        users: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string" }, age: { type: "number" } }, required: ["name", "age"] },
        },
        cart: {
          type: "object",
          properties: {
            total: { type: "number" },
            items: { type: "array", items: { type: "object", properties: { price: { type: "number" } }, required: ["price"] } },
          },
          required: ["total", "items"],
        },
      },
      required: ["count", "name", "active", "tags", "users", "cart"],
    });
  });

  it("$ キーとメソッド・関数値プロパティは捨て、getter は戻り型で載る", () => {
    const { schema } = schemaOf(`
export default {
  count: 0,
  $commandTokens: ["go"],
  $watch: { count() {} },
  increment() { this.count++; },
  handler: (e: Event) => {},
  get double() { return this.count * 2; },
  get label(): string { return "x"; },
};`);
    expect(Object.keys(schema.properties!)).toEqual(["count", "double", "label"]);
    expect(schema.properties!.double).toEqual({ type: "number" });
    expect(schema.properties!.label).toEqual({ type: "string" });
  });

  it("パス getter（users.*.ageCategory / cart.total）は計算先の位置に注入される", () => {
    const { schema } = schemaOf(`
export default {
  users: [] as { name: string; age: number }[],
  cart: { items: [] as { price: number; qty: number }[] },
  meta: {} as Record<string, unknown>,
  get "users.*.ageCategory"(): string { return "Adult"; },
  get "cart.items.*.subtotal"(): number { return 1; },
  get "cart.total"(): number { return 0; },
  get "meta.deep.x"(): number { return 0; },
  get "missing.path"(): number { return 0; },
};`);
    expect(schema.properties!.users.items!.properties!.ageCategory).toEqual({ type: "string" });
    expect(schema.properties!.cart.properties!.items.items!.properties!.subtotal).toEqual({ type: "number" });
    expect(schema.properties!.cart.properties!.total).toEqual({ type: "number" });
    // Record<string, unknown> は lib 由来の alias = 素の {}（unknown）→ 注入先が無いので何もしない
    expect(schema.properties!.meta).toEqual({});
    // 存在しない親には注入しない（トップレベルにも生えない）
    expect(schema.properties!.missing).toBeUndefined();
    expect(Object.keys(schema.properties!)).not.toContain("users.*.ageCategory");
  });

  it("union: null は anyOf に分離、undefined は optional、リテラル union は enum、混在は anyOf", () => {
    const { schema } = schemaOf(`
type Mode = "list" | "grid";
export default {
  selected: null as string | null,
  maybe: undefined as string | undefined,
  mode: "list" as Mode,
  level: 1 as 1 | 2 | 3,
  flag: false as boolean | null,
  mixed: "a" as string | number,
  both: null as { a: number } | null,
  nothing: null,
};`);
    expect(schema.properties!.selected).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
    expect(schema.properties!.maybe).toEqual({ type: "string" });
    expect(schema.required).not.toContain("maybe");
    expect(schema.required).toContain("selected");
    expect(schema.properties!.mode).toEqual({ type: "string", enum: ["list", "grid"] });
    expect(schema.properties!.level).toEqual({ type: "number", enum: [1, 2, 3] });
    expect(schema.properties!.flag).toEqual({ anyOf: [{ type: "boolean" }, { type: "null" }] });
    expect(schema.properties!.mixed).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
    expect(schema.properties!.both).toEqual({
      anyOf: [{ type: "object", properties: { a: { type: "number" } }, required: ["a"] }, { type: "null" }],
    });
    expect(schema.properties!.nothing).toEqual({ type: "null" });
  });

  it("Date / Map / DOM 型・ライブラリ型・any / unknown は素の {}（type を付けない）", () => {
    const { schema } = schemaOf(`
export default {
  when: new Date(),
  index: new Map<string, number>(),
  stream: null as MediaStream | null,
  anything: null as any,
  whatever: null as unknown,
  tuple: [1, "a"] as [number, string],
  sym: Symbol("x"),
  big: 1n,
};`);
    expect(schema.properties!.when).toEqual({});
    expect(schema.properties!.index).toEqual({});
    expect(schema.properties!.stream).toEqual({ anyOf: [{}, { type: "null" }] });
    expect(schema.properties!.anything).toEqual({});
    expect(schema.properties!.whatever).toEqual({});
    expect(schema.properties!.tuple).toEqual({ type: "array", items: { anyOf: [{ type: "number" }, { type: "string" }] } });
    expect(schema.properties!.sym).toEqual({});
    expect(schema.properties!.big).toEqual({});
  });

  it("深さ上限（既定 5 = 検証側 MAX_OBJECT_NEST_DEPTH）で素の {} に打ち切る。--max-depth で変えられる", () => {
    const src = `export default { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };`;
    const { schema } = schemaOf(src);
    expect(DEFAULT_MAX_DEPTH).toBe(5);
    const e = schema.properties!.a.properties!.b.properties!.c.properties!.d.properties!.e;
    expect(e).toEqual({});
    const shallow = schemaOf(src, "ts", { maxDepth: 2 }).schema;
    expect(shallow.properties!.a.properties!.b).toEqual({});
  });

  it("再帰型は無限に展開しない", () => {
    const { schema } = schemaOf(`
interface Node { value: number; children: Node[] }
export default { tree: null as Node | null };`);
    const tree = schema.properties!.tree.anyOf![0];
    expect(tree.properties!.value).toEqual({ type: "number" });
    expect(tree.properties!.children.type).toBe("array");
    expect(JSON.stringify(schema).length).toBeLessThan(2000);
  });

  it("defineState(...) は引数の型を読む（@wcstack/state が解決できなくても成立）", () => {
    const { schema, warnings } = schemaOf(`
import { defineState } from "@wcstack/state";
export default defineState({
  count: 0,
  users: [] as { name: string }[],
  increment() { this.count++; },
});`);
    expect(warnings).toEqual([]);
    expect(Object.keys(schema.properties!)).toEqual(["count", "users"]);
    expect(schema.properties!.users.items!.properties!.name).toEqual({ type: "string" });
  });

  it("class / interface 由来のオブジェクト型と readonly 配列", () => {
    const { schema } = schemaOf(`
interface User { name: string; email?: string }
export default {
  user: { name: "a" } as User,
  list: [] as readonly User[],
};`);
    expect(schema.properties!.user).toEqual({
      type: "object",
      properties: { name: { type: "string" }, email: { type: "string" } },
      required: ["name"],
    });
    expect(schema.properties!.list.items!.properties!.name).toEqual({ type: "string" });
  });

  it(".js は JSDoc の型が効く（allowJs / checkJs）", () => {
    const { schema } = schemaOf(`
export default {
  /** @type {string[]} */
  names: [],
  /** @type {{ id: number, label: string }[]} */
  rows: [],
  count: 0,
};`, "js");
    expect(schema.properties!.names).toEqual({ type: "array", items: { type: "string" } });
    expect(schema.properties!.rows.items!.properties!.id).toEqual({ type: "number" });
    expect(schema.properties!.count).toEqual({ type: "number" });
  });

  it("null | undefined は null。パス getter は `.*` 終端を捨て、nullable なオブジェクトの中にも注入できる", () => {
    const { schema } = schemaOf(`
export default {
  nothing2: undefined as null | undefined,
  profile: null as { name: string } | null,
  rows: [] as { id: number }[],
  either: null as { a: number } | { b: number } | null,
  get "rows.*"(): number { return 0; },
  get "profile.display"(): string { return "x"; },
  get "either.c"(): string { return "x"; },
};`);
    expect(schema.properties!.nothing2).toEqual({ type: "null" });
    expect(schema.properties!.profile.anyOf![0].properties!.display).toEqual({ type: "string" });
    expect(schema.properties!.rows.items!.properties).toEqual({ id: { type: "number" } });
    // 2 つのオブジェクト枝を持つ union には注入先を決められないので何もしない
    const either = schema.properties!.either.anyOf!;
    expect(either.every((n) => n.properties === undefined || n.properties.c === undefined)).toBe(true);
  });

  it("`wcs.defineState({...})` のようなプロパティアクセス経由の呼び出しも剥がす", () => {
    const { schema } = schemaOf(`
const wcs = { defineState: <T>(x: T) => x };
export default wcs.defineState({ count: 0 });`);
    expect(schema.properties!.count).toEqual({ type: "number" });
  });

  it("default export の型が any なら警告付きで開いた {} を返す", () => {
    const { schema, warnings } = schemaOf(`
const s: any = {};
export default s;`);
    expect(schema).toEqual({});
    expect(warnings[0]).toContain("any");
  });
});

describe("loadStateFile — 入力の失敗モード", () => {
  it("存在しないファイル", () => {
    expect(() => loadStateFile(`${tmp.dir}/nope/state.ts`)).toThrow(/cannot read/);
  });

  it("export default が無い", () => {
    const file = tmp.write("no-default/state.ts", `export const x = 1;`);
    expect(() => loadStateFile(file)).toThrow(/no `export default`/);
  });

  it("構文エラーは位置付きで失敗する（型は読めない）", () => {
    const file = tmp.write("syntax/state.ts", `export default { count: 0,\n  broken( { };`);
    expect(() => loadStateFile(file)).toThrow(/syntax error/);
  });

  it("--tsconfig: 明示指定を読む / 壊れていれば失敗する / 無ければ既定", () => {
    const cfg = tmp.write("cfg/tsconfig.json", JSON.stringify({ compilerOptions: { strict: false, target: "ES2020" } }));
    const file = tmp.write("cfg/state.ts", `export default { count: 0 };`);
    const options = resolveCompilerOptions(file, { tsconfig: cfg });
    expect(options.strict).toBe(false);
    expect(options.noEmit).toBe(true);
    expect(options.allowJs).toBe(true);
    // 最近傍の tsconfig.json は自動で拾う
    expect(resolveCompilerOptions(file).strict).toBe(false);
    // 無ければ既定
    const lone = tmp.write("lone/state.ts", `export default { count: 0 };`);
    expect(resolveCompilerOptions(lone).strict).toBe(true);
    const broken = tmp.write("broken-cfg/tsconfig.json", "{ oops");
    expect(() => resolveCompilerOptions(file, { tsconfig: broken })).toThrow(/cannot read/);
  });
});
