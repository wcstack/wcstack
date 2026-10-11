/**
 * coverage-engine-units.test.ts — the engine's building blocks used directly: the add-on hook
 * chain, the pattern table and a row's list.
 */
import { describe, it, expect } from "vitest";
import { Engine, DirtyStrategy } from "../src/index";
import { first, hooks, known } from "../src/hooks";
import { PatternTable } from "../src/pattern";

describe("first（dollar の連鎖）", () => {
  it("先に入れたフックの答え（undefined 以外）が勝ち、答えなければ次のフックに回る", () => {
    const asked: string[] = [];
    hooks.dollar = first(known, hooks.dollar, (_engine, key) => {
      asked.push(`first ${key}`);
      return key === "$alpha" ? "from first" : undefined;
    });
    hooks.dollar = first(known, hooks.dollar, (_engine, key) => {
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
  it("peek は作られたパスとその祖先だけを知っている", () => {
    const t = new PatternTable();
    expect(t.peek("a.*.b")).toBeUndefined();
    const p = t.get("a.*.b");
    expect(t.peek("a.*.b")).toBe(p);
    expect(t.peek("a.*")).toBe(p.parent);
    expect(t.peek("a")).toBe(p.parent!.parent);
    expect(t.peek("a.b")).toBeUndefined();
  });
});

describe("StateRow の list.parentRow / list.depth", () => {
  it("入れ子の行の list.parentRow は外側の行、list.depth はリストの深さ", () => {
    const e = new Engine({ groups: [{ items: [{ v: 1 }] }] }, new DirtyStrategy());
    const outer = e.childList(null, e.pattern("groups")).rows[0];
    const inner = e.childList(outer, e.pattern("groups.*.items")).rows[0];
    expect(outer.list.parentRow).toBeNull();
    expect(outer.list.depth).toBe(1);
    expect(inner.list.parentRow).toBe(outer);
    expect(inner.list.depth).toBe(2);
    expect(inner.item).toEqual({ v: 1 });
  });
});
