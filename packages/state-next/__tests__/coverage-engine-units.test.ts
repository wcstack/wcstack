/**
 * coverage-engine-units.test.ts — the engine's building blocks used directly: the add-on hook
 * chain, the pattern table and the row accessors.
 */
import { describe, it, expect } from "vitest";
import { Engine, DirtyStrategy } from "../src/index";
import { addHook } from "../src/hooks";
import { PatternTable } from "../src/pattern";

describe("addHook（dollar の連鎖）", () => {
  it("先に入れたフックの答え（undefined 以外）が勝ち、答えなければ次のフックに回る", () => {
    const asked: string[] = [];
    addHook("dollar", (_engine, key) => {
      asked.push(`first ${key}`);
      return key === "$alpha" ? "from first" : undefined;
    });
    addHook("dollar", (_engine, key) => {
      asked.push(`second ${key}`);
      return key === "$alpha" || key === "$beta" ? "from second" : undefined;
    });
    const e = new Engine({}, new DirtyStrategy());
    expect(e.proxy.$alpha).toBe("from first");
    expect(e.proxy.$beta).toBe("from second");
    expect(e.proxy.$gamma).toBeUndefined();
    expect(asked).toEqual(["first $alpha", "first $beta", "second $beta", "first $gamma", "second $gamma"]);
  });
});

describe("PatternTable", () => {
  it("has は作られたパスとその祖先だけを知っている", () => {
    const t = new PatternTable();
    expect(t.has("a.*.b")).toBe(false);
    const p = t.get("a.*.b");
    expect(t.has("a.*.b")).toBe(true);
    expect(t.has("a.*")).toBe(true);
    expect(t.has("a")).toBe(true);
    expect(t.has("a.b")).toBe(false);
    expect(t.peek("a.*.b")).toBe(p);
  });
});

describe("StateRow の parent / depth", () => {
  it("入れ子の行の parent は外側の行、depth はリストの深さ", () => {
    const e = new Engine({ groups: [{ items: [{ v: 1 }] }] }, new DirtyStrategy());
    const outer = e.rootList(e.pattern("groups")).rows[0];
    const inner = e.childList(outer, e.pattern("groups.*.items")).rows[0];
    expect(outer.parent).toBeNull();
    expect(outer.depth).toBe(1);
    expect(inner.parent).toBe(outer);
    expect(inner.depth).toBe(2);
    expect(inner.item).toEqual({ v: 1 });
  });
});
