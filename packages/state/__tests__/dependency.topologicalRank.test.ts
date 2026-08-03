/**
 * dependency.topologicalRank.test.ts — 依存グラフのトポロジカル順位。
 *
 * rank の契約: 辺 (u → v) が存在すれば rank(u) < rank(v)。依存ウォークはこの順で
 * 訪問することで「リスト実体を読む時点で入力が全て dirty 化済み」を保証する。
 */
import { describe, it, expect } from "vitest";
import { getTopologicalRanks } from "../src/dependency/topologicalRank";

const MAX = 1000;
const staticOf = (entries: [string, string[]][]) => new Map<string, string[]>(entries);
const EMPTY = new Map<string, string[]>();

describe("getTopologicalRanks", () => {
  it("直列チェーンは 1 段ずつ rank が上がること", () => {
    const ranks = getTopologicalRanks("a", staticOf([["a", ["b"]], ["b", ["c"]]]), EMPTY, MAX);
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(2);
  });

  it("ダイヤモンドの合流点は長い方の腕より後になること", () => {
    // n → short → merge / n → h1 → h2 → h3 → merge
    const ranks = getTopologicalRanks("n", staticOf([
      ["n", ["short", "h1"]],
      ["short", ["merge"]],
      ["h1", ["h2"]],
      ["h2", ["h3"]],
      ["h3", ["merge"]],
    ]), EMPTY, MAX);
    expect(ranks.get("short")).toBe(1);
    expect(ranks.get("h3")).toBe(3);
    // 最長経路長なので合流点は 4（短腕経由の 2 ではない）
    expect(ranks.get("merge")).toBe(4);
    expect(ranks.get("merge")!).toBeGreaterThan(ranks.get("short")!);
    expect(ranks.get("merge")!).toBeGreaterThan(ranks.get("h3")!);
  });

  it("static と dynamic の両方の辺をたどること", () => {
    const ranks = getTopologicalRanks(
      "a",
      staticOf([["a", ["s"]]]),
      staticOf([["a", ["d"]], ["s", ["merge"]], ["d", ["merge"]]]),
      MAX,
    );
    expect(ranks.get("s")).toBe(1);
    expect(ranks.get("d")).toBe(1);
    expect(ranks.get("merge")).toBe(2);
  });

  it("同じ辺が static と dynamic に重複していても順位が壊れないこと", () => {
    const ranks = getTopologicalRanks(
      "a",
      staticOf([["a", ["b"]]]),
      staticOf([["a", ["b"]], ["b", ["c"]]]),
      MAX,
    );
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(2);
  });

  it("到達しないパスは結果に含まれないこと", () => {
    const ranks = getTopologicalRanks("a", staticOf([["a", ["b"]], ["x", ["y"]]]), EMPTY, MAX);
    expect(ranks.has("b")).toBe(true);
    expect(ranks.has("x")).toBe(false);
    expect(ranks.has("y")).toBe(false);
  });

  it("依存を持たない開始パスは rank 0 のみになること", () => {
    const ranks = getTopologicalRanks("solo", EMPTY, EMPTY, MAX);
    expect([...ranks]).toEqual([["solo", 0]]);
  });

  it("自己ループでも全パスに rank が付くこと", () => {
    // 入次数が 0 に落ちないので Kahn では順位が決まらない = 循環扱い
    const ranks = getTopologicalRanks("a", staticOf([["a", ["a"]]]), EMPTY, MAX);
    expect(ranks.get("a")).toBe(0);
  });

  it("循環に含まれるパスは確定済みの最大 rank の次にまとめられること", () => {
    // a → b → c → b（b,c が循環）。a だけが Kahn で確定する
    const ranks = getTopologicalRanks("a", staticOf([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", ["b"]],
    ]), EMPTY, MAX);
    expect(ranks.get("a")).toBe(0);
    expect(ranks.get("b")).toBe(1);
    expect(ranks.get("c")).toBe(1);
  });

  it("循環の外側に確定した rank があればその次に置かれること", () => {
    // a → x → y（確定） / a → b → c → b（循環）
    const ranks = getTopologicalRanks("a", staticOf([
      ["a", ["x", "b"]],
      ["x", ["y"]],
      ["b", ["c"]],
      ["c", ["b"]],
    ]), EMPTY, MAX);
    expect(ranks.get("y")).toBe(2);
    expect(ranks.get("b")).toBe(3);
    expect(ranks.get("c")).toBe(3);
  });

  it("最大深さを超えるチェーンは throw すること", () => {
    const entries: [string, string[]][] = [];
    for (let i = 0; i < 1002; i++) {
      entries.push([`p${i}`, [`p${i + 1}`]]);
    }
    expect(() => getTopologicalRanks("p0", staticOf(entries), EMPTY, MAX))
      .toThrow(/Maximum dependency depth/);
  });
});
