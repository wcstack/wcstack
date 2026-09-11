/**
 * recursion.expand.test.ts — `**`（オーサリング層）と具体パス（エンジン）の
 * 相互変換の単体テスト（`src/recursion/expand.ts` / 実装計画 §4）。
 *
 * ここは **純関数だけ** の層で、state も proxy も触らない。固定するのは
 *  1. 深さ k の具体パスの綴り（接尾辞あり・なし、ネストしたアンカー）
 *  2. 具体パス → 深さの復元が、接尾辞に反復語と同じ綴りが含まれても
 *     取り違えないこと（文字列中の出現数で数えていないことの証拠）
 *  3. `**` パスの (アンカー, 接尾辞) 分解 — 宣言外・2 つ目の `**` は null
 *  4. 依存ウォークへ載せるリストパスの列挙
 *  5. 深さ上限 `MAX_WILDCARD_DEPTH` の**境界の内と外**
 *
 * 仕様は宣言の検証器から作る（テスト内で手で組むと、宣言側の変更に
 * 気づかないまま別物を測ることになる）。
 */
import { describe, it, expect } from "vitest";
import { processRecursionDeclaration } from "../src/recursion/declaration";
import {
  concretePathAt,
  depthOfConcretePath,
  hasRecursionWildcard,
  listPathsUpTo,
  nodePathAt,
  splitRecursivePath,
} from "../src/recursion/expand";
import { MAX_WILDCARD_DEPTH } from "../src/define";
import type { IState } from "../src/types";

const specOf = (anchor: string, repeat: string) =>
  processRecursionDeclaration({ $recursion: { [anchor]: repeat } } as unknown as IState)!;

/** `{ "nodes.*": "children.*" }` — 設計書の標準例 */
const spec = specOf("nodes.*", "children.*");
/** アンカーも反復サブパスもネストした形 */
const nested = specOf("data.tree.*", "branch.children.*");

describe("hasRecursionWildcard: `**` を含むかの判別", () => {
  it("`**` を含むパスに true を返すこと", () => {
    expect(hasRecursionWildcard("nodes.**")).toBe(true);
    expect(hasRecursionWildcard("nodes.**.total")).toBe(true);
    expect(hasRecursionWildcard("nodes.**.children.*.total")).toBe(true);
  });

  it("通常のワイルドカードパス・スカラーパスに false を返すこと", () => {
    expect(hasRecursionWildcard("nodes.*.total")).toBe(false);
    expect(hasRecursionWildcard("nodes.*.children.*.total")).toBe(false);
    expect(hasRecursionWildcard("title")).toBe(false);
    expect(hasRecursionWildcard("")).toBe(false);
  });

  it("セグメント単位ではなく部分文字列で判定していること（粗いふるいであることの記録）", () => {
    // `nodes.**x` はパス境界で終わらないので再帰パスではないが、この関数は true を
    // 返す。ここは「`**` の経路に入れるか」を 1 回の indexOf で決める粗いふるいで、
    // 宣言との突き合わせは splitRecursivePath が行う（下の describe が対の証拠）。
    expect(hasRecursionWildcard("**")).toBe(true);
    expect(hasRecursionWildcard("nodes.**x")).toBe(true);
    expect(splitRecursivePath(spec, "nodes.**x")).toBe(null);
  });

  it("区切りを挟んで並んだ `*.*` を `**` と取り違えないこと", () => {
    // 深いワイルドカードパスは日常的に現れる。ここが true になると
    // 通常パスがすべて再帰の経路へ迷い込む。
    expect(hasRecursionWildcard("nodes.*.*.total")).toBe(false);
    expect(hasRecursionWildcard("a.*.b.*.c.*")).toBe(false);
  });
});

describe("concretePathAt / nodePathAt: 深さ k の具体パスを作る", () => {
  it("接尾辞ありの具体パスが深さごとに 1 段ずつ伸びること", () => {
    expect(concretePathAt(spec, ".total", 0)).toBe("nodes.*.total");
    expect(concretePathAt(spec, ".total", 1)).toBe("nodes.*.children.*.total");
    expect(concretePathAt(spec, ".total", 2)).toBe("nodes.*.children.*.children.*.total");
  });

  it("接尾辞なし（ノードパス）でも同じ段数で伸びること", () => {
    expect(concretePathAt(spec, "", 0)).toBe("nodes.*");
    expect(concretePathAt(spec, "", 1)).toBe("nodes.*.children.*");
    expect(concretePathAt(spec, "", 2)).toBe("nodes.*.children.*.children.*");
  });

  it("nodePathAt が接尾辞なしの concretePathAt と一致すること", () => {
    for (const depth of [0, 1, 2, 7]) {
      expect(nodePathAt(spec, depth)).toBe(concretePathAt(spec, "", depth));
    }
  });

  it("接尾辞がワイルドカードを含んでいても、反復部分だけが伸びること", () => {
    expect(concretePathAt(spec, ".children.*.total", 0)).toBe("nodes.*.children.*.total");
    expect(concretePathAt(spec, ".children.*.total", 1)).toBe("nodes.*.children.*.children.*.total");
  });

  it("ネストしたアンカー・反復サブパスでも綴りが正しいこと", () => {
    expect(concretePathAt(nested, ".total", 0)).toBe("data.tree.*.total");
    expect(concretePathAt(nested, ".total", 1)).toBe("data.tree.*.branch.children.*.total");
    expect(concretePathAt(nested, ".total", 2))
      .toBe("data.tree.*.branch.children.*.branch.children.*.total");
  });

  it("負の深さを拒否すること", () => {
    expect(() => concretePathAt(spec, ".total", -1))
      .toThrow(/Recursion depth must not be negative \(got -1\)/);
  });
});

describe("concretePathAt: 深さ上限（MAX_WILDCARD_DEPTH）の境界", () => {
  it("上限は 128 段であること（境界の値そのものを固定する）", () => {
    expect(MAX_WILDCARD_DEPTH).toBe(128);
  });

  it("ワイルドカード段数がちょうど上限に届く深さは通ること", () => {
    // `nodes.*` の 1 段 + 反復 127 段 = 128 段。
    expect(concretePathAt(spec, ".total", 127).endsWith(".children.*.total")).toBe(true);
    expect(concretePathAt(spec, "", 127).split("*").length - 1).toBe(128);
  });

  it("上限を 1 段超える深さで [wcs/recursion-depth-exceeded] を throw すること", () => {
    expect(() => concretePathAt(spec, ".total", 128))
      .toThrow(/\[wcs\/recursion-depth-exceeded\]/);
    expect(() => concretePathAt(spec, ".total", 128))
      .toThrow(/Recursion on "nodes\.\*" reached depth 128/);
    expect(() => concretePathAt(spec, ".total", 128))
      .toThrow(/which needs 129 wildcard levels/);
    expect(() => concretePathAt(spec, ".total", 128))
      .toThrow(/the limit is 128/);
  });

  it("接尾辞のワイルドカードも段数に数えるので、境界が 1 段手前に動くこと", () => {
    // 接尾辞 `.children.*.total` はそれ自体が 1 段を消費する。
    expect(concretePathAt(spec, ".children.*.total", 126).split("*").length - 1).toBe(128);
    expect(() => concretePathAt(spec, ".children.*.total", 127))
      .toThrow(/\[wcs\/recursion-depth-exceeded\]/);
    expect(() => concretePathAt(spec, ".children.*.total", 127))
      .toThrow(/which needs 129 wildcard levels/);
  });

  it("超過の診断がアンカー・深さ・展開後のパスを名指しすること", () => {
    let message = "";
    try { concretePathAt(spec, "", 128); } catch (e: any) { message = e.message; }
    expect(message).toContain("[wcs/recursion-depth-exceeded]");
    expect(message).toContain('Recursion on "nodes.*"');
    expect(message).toContain("reached depth 128");
    expect(message).toContain("nodes.*.children.*.children.*");
    expect(message).toContain("or the tree contains a cycle");
  });
});

describe("splitRecursivePath: `**` パスを (アンカー, 接尾辞) に割る", () => {
  it("アンカーそのものは空の接尾辞になること", () => {
    expect(splitRecursivePath(spec, "nodes.**")).toBe("");
  });

  it("アンカーに続く部分を接尾辞として返すこと", () => {
    expect(splitRecursivePath(spec, "nodes.**.total")).toBe(".total");
    expect(splitRecursivePath(spec, "nodes.**.children.*.total")).toBe(".children.*.total");
  });

  it("返すのは接尾辞の文字列だけであること（静的側の splitRecursivePath と同じ形）", () => {
    expect(typeof splitRecursivePath(spec, "nodes.**.total")).toBe("string");
  });

  it("宣言と別のアンカーは null（呼び出し側が診断する）", () => {
    expect(splitRecursivePath(spec, "tree.**.total")).toBe(null);
    expect(splitRecursivePath(spec, "nodes2.**.total")).toBe(null);
  });

  it("2 つ目の `**` を含むパスは null（初版は再帰点 1 つ）", () => {
    expect(splitRecursivePath(spec, "nodes.**.children.**.total")).toBe(null);
    expect(splitRecursivePath(spec, "nodes.**.**")).toBe(null);
  });

  it("`**` を含まない具体パスは null", () => {
    expect(splitRecursivePath(spec, "nodes.*.total")).toBe(null);
    expect(splitRecursivePath(spec, "nodes")).toBe(null);
  });

  it("アンカーがパス境界で終わらない綴りは null", () => {
    // `nodes.**x` は「アンカー + 接尾辞」ではない。接頭辞一致だけで通すと
    // 別プロパティを再帰パスと誤認する。
    expect(splitRecursivePath(spec, "nodes.**x")).toBe(null);
  });

  it("ネストしたアンカーでも同じ規則で割れること", () => {
    expect(splitRecursivePath(nested, "data.tree.**")).toBe("");
    expect(splitRecursivePath(nested, "data.tree.**.total")).toBe(".total");
    expect(splitRecursivePath(nested, "data.**.total")).toBe(null);
  });
});

describe("depthOfConcretePath: 具体パスから深さを復元する", () => {
  it("接尾辞ありの展開形から深さを返すこと", () => {
    expect(depthOfConcretePath(spec, ".total", "nodes.*.total")).toBe(0);
    expect(depthOfConcretePath(spec, ".total", "nodes.*.children.*.total")).toBe(1);
    expect(depthOfConcretePath(spec, ".total", "nodes.*.children.*.children.*.total")).toBe(2);
  });

  it("接尾辞なし（ノードパス）でも深さを返すこと", () => {
    expect(depthOfConcretePath(spec, "", "nodes.*")).toBe(0);
    expect(depthOfConcretePath(spec, "", "nodes.*.children.*")).toBe(1);
    expect(depthOfConcretePath(spec, "", "nodes.*.children.*.children.*")).toBe(2);
  });

  it("接尾辞が反復語と同じ綴り（`.children`）でも深さを取り違えないこと", () => {
    // 文字列中の "children" の出現数で数えていたら、ここは 1 / 2 / 3 になる。
    expect(depthOfConcretePath(spec, ".children", "nodes.*.children")).toBe(0);
    expect(depthOfConcretePath(spec, ".children", "nodes.*.children.*.children")).toBe(1);
    expect(depthOfConcretePath(spec, ".children", "nodes.*.children.*.children.*.children")).toBe(2);
  });

  it("接尾辞が反復サブパスそのもの（`.children.*.label`）でも取り違えないこと", () => {
    expect(depthOfConcretePath(spec, ".children.*.label", "nodes.*.children.*.label")).toBe(0);
    expect(depthOfConcretePath(spec, ".children.*.label", "nodes.*.children.*.children.*.label")).toBe(1);
  });

  it("生成したパスと深さが往復すること（0..8）", () => {
    for (const suffix of ["", ".total", ".children", ".children.*.label"]) {
      for (let depth = 0; depth <= 8; depth++) {
        expect(depthOfConcretePath(spec, suffix, concretePathAt(spec, suffix, depth))).toBe(depth);
      }
    }
  });

  it("アンカーが違うパスは null", () => {
    expect(depthOfConcretePath(spec, ".total", "other.*.total")).toBe(null);
    expect(depthOfConcretePath(spec, ".total", "total")).toBe(null);
  });

  it("接尾辞が違うパスは null", () => {
    expect(depthOfConcretePath(spec, ".total", "nodes.*.children.*.value")).toBe(null);
    expect(depthOfConcretePath(spec, ".total", "nodes.*.total.extra")).toBe(null);
  });

  it("反復サブパスと違う中間セグメントを持つパスは null", () => {
    expect(depthOfConcretePath(spec, ".total", "nodes.*.kids.*.total")).toBe(null);
    expect(depthOfConcretePath(spec, ".total", "nodes.*.children.total")).toBe(null);
  });

  it("アンカーの綴りが接頭辞として一致するだけのパスは null", () => {
    // `nodes.*x...` は `startsWith("nodes.*")` を通ってしまうので、
    // 中間が反復の整数倍であることの検査が最後の砦になる。
    expect(depthOfConcretePath(spec, ".total", "nodes.*x.total")).toBe(null);
  });

  it("接尾辞がアンカーの末尾と重なる形（`.*`）では深さと判定しないこと", () => {
    // Fixed by Phase B review — was: depthOfConcretePath(spec, ".*", "nodes.*") === 0
    // `nodes.**.*` という getter を書くと接尾辞は `.*` になる。ガードが無いと
    // `path.endsWith(suffix)` を通ったうえで middle の slice が空文字に畳まれ、
    // **アンカーそのもの**（実データの行）を深さ 0 と誤判定して生成 getter が
    // 行を隠していた。接頭辞と接尾辞が重なる形は一致とみなさない。
    expect(depthOfConcretePath(spec, ".*", "nodes.*")).toBeNull();
    // 重ならない位置（深さ 1 以上）なら従来どおり往復する
    expect(concretePathAt(spec, ".*", 0)).toBe("nodes.*.*");
    expect(depthOfConcretePath(spec, ".*", "nodes.*.*")).toBe(0);
    expect(depthOfConcretePath(spec, ".*", "nodes.*.children.*.*")).toBe(1);
    // 対の関係が成立する普通の接尾辞では、往復が壊れていないこと
    expect(concretePathAt(spec, ".total", depthOfConcretePath(spec, ".total", "nodes.*.total")!))
      .toBe("nodes.*.total");
  });

  it("ネストした反復サブパスでも深さを復元すること", () => {
    expect(depthOfConcretePath(nested, ".total", "data.tree.*.total")).toBe(0);
    expect(depthOfConcretePath(nested, ".total", "data.tree.*.branch.children.*.total")).toBe(1);
    expect(depthOfConcretePath(nested, ".total", "data.tree.*.branch.*.total")).toBe(null);
  });
});

describe("listPathsUpTo: 依存ウォークに載せるリストパスの列挙", () => {
  it("深さ 0 ではアンカー自身のリストだけを返すこと", () => {
    expect(listPathsUpTo(spec, 0)).toEqual(["nodes"]);
  });

  it("深さのぶんだけ子リストのパスが増えること", () => {
    expect(listPathsUpTo(spec, 1)).toEqual(["nodes", "nodes.*.children"]);
    expect(listPathsUpTo(spec, 2))
      .toEqual(["nodes", "nodes.*.children", "nodes.*.children.*.children"]);
    expect(listPathsUpTo(spec, 3)).toEqual([
      "nodes",
      "nodes.*.children",
      "nodes.*.children.*.children",
      "nodes.*.children.*.children.*.children",
    ]);
  });

  it("返すリストパスはいずれも末尾が `*` でないこと（要素ではなくリスト自身）", () => {
    for (const path of listPathsUpTo(spec, 4)) {
      expect(path.endsWith(".*")).toBe(false);
    }
  });

  it("listPathsUpTo: ネストしたアンカー・反復サブパスでも綴りが正しいこと", () => {
    expect(listPathsUpTo(nested, 2)).toEqual([
      "data.tree",
      "data.tree.*.branch.children",
      "data.tree.*.branch.children.*.branch.children",
    ]);
  });
});
