import { describe, it, expect, afterAll } from "vitest";
import { join } from "node:path";
import { effectiveContentMappers, parseJsonc, resolveExtends } from "../src/cli/tsconfigChain";
import { makeTempDir } from "./helpers";

const tmp = makeTempDir("wcs-tsconfig-");
afterAll(() => tmp.cleanup());

const ours = { package: "@wcstack/typescript", extensions: [".html"] };

describe("parseJsonc", () => {
  it("コメント・末尾のカンマ・BOM を読み、文字列の中は触らない", () => {
    const text = String.fromCharCode(0xfeff) + `{
      // line comment
      "a": "// not a comment, }", /* block */
      "b": [1, 2,],
      "c": { "d": "x\\"/*y*/", },
    }`;
    expect(parseJsonc(text)).toEqual({ a: "// not a comment, }", b: [1, 2], c: { d: 'x"/*y*/' } });
    expect(parseJsonc(`{"open": 1 /* never closed`.replace("1 ", "1 }"))).toEqual({ open: 1 });
  });

  it("壊れた JSON は投げる", () => {
    expect(() => parseJsonc("{ a: 1 }")).toThrow();
  });
});

describe("resolveExtends", () => {
  it("相対パス（.json の省略可）とパッケージ", () => {
    const base = tmp.write("ext/base.json", "{}");
    tmp.write("ext/node_modules/@tsconfig/strict/tsconfig.json", "{}");
    tmp.write("ext/node_modules/@tsconfig/strict/package.json", JSON.stringify({ name: "@tsconfig/strict", version: "1.0.0" }));
    tmp.write("ext/node_modules/shared-config/package.json", JSON.stringify({ name: "shared-config", version: "1.0.0" }));
    tmp.write("ext/node_modules/shared-config/web.json", "{}");
    const from = join(tmp.dir, "ext", "tsconfig.json");
    expect(resolveExtends("./base.json", from)).toBe(base);
    expect(resolveExtends("./base", from)).toBe(base);
    expect(resolveExtends(base, from)).toBe(base);
    expect(resolveExtends("./missing", from)).toBeUndefined();
    expect(resolveExtends("@tsconfig/strict", from)).toBe(join(tmp.dir, "ext", "node_modules", "@tsconfig", "strict", "tsconfig.json"));
    expect(resolveExtends("shared-config/web", from)).toBe(join(tmp.dir, "ext", "node_modules", "shared-config", "web.json"));
    expect(resolveExtends("no-such-package", from)).toBeUndefined();
  });
});

describe("effectiveContentMappers", () => {
  it("自分の contentMappers が最優先（空の配列も「無し」として効く）", () => {
    tmp.write("own/base.json", JSON.stringify({ contentMappers: [ours] }));
    const own = tmp.write("own/tsconfig.json", `{ "extends": "./base.json", // c\n "contentMappers": [{ "package": "vue-mapper", "extensions": [".vue"] }, 1] }`);
    expect(effectiveContentMappers(own)).toEqual({ entries: [{ package: "vue-mapper", extensions: [".vue"] }], from: own });
    const empty = tmp.write("own/empty.json", JSON.stringify({ extends: "./base.json", contentMappers: [] }));
    expect(effectiveContentMappers(empty)).toEqual({ entries: [], from: empty });
  });

  it("extends を辿る（配列は後ろの基底から、基底もそれぞれ自分の連鎖を持つ）", () => {
    const a = tmp.write("chain/a.json", JSON.stringify({ contentMappers: [{ package: "a" }] }));
    const b = tmp.write("chain/b.json", JSON.stringify({ extends: "./c.json" }));
    const c = tmp.write("chain/c.json", JSON.stringify({ contentMappers: [ours] }));
    const top = tmp.write("chain/tsconfig.json", JSON.stringify({ extends: ["./a.json", "./b.json"] }));
    expect(effectiveContentMappers(top)).toEqual({ entries: [ours], from: c });
    const onlyA = tmp.write("chain/only-a.json", JSON.stringify({ extends: ["./a.json", "./missing.json", 3] }));
    expect(effectiveContentMappers(onlyA)).toEqual({ entries: [{ package: "a" }], from: a });
    expect(effectiveContentMappers(b)?.from).toBe(c);
  });

  it("無い・読めない・循環は undefined", () => {
    tmp.write("none/tsconfig.json", JSON.stringify({ compilerOptions: {} }));
    expect(effectiveContentMappers(join(tmp.dir, "none", "tsconfig.json"))).toBeUndefined();
    expect(effectiveContentMappers(join(tmp.dir, "none", "missing.json"))).toBeUndefined();
    tmp.write("none/broken.json", "{ nope");
    expect(effectiveContentMappers(join(tmp.dir, "none", "broken.json"))).toBeUndefined();
    tmp.write("cycle/x.json", JSON.stringify({ extends: "./y.json" }));
    tmp.write("cycle/y.json", JSON.stringify({ extends: "./x.json" }));
    expect(effectiveContentMappers(join(tmp.dir, "cycle", "x.json"))).toBeUndefined();
  });
});
