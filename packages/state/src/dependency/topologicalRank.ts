/**
 * topologicalRank.ts — 依存グラフ（パス単位）のトポロジカル順位。
 *
 * 依存ウォークは list → list.* を展開するために途中でリスト実体を読む。この読み取りが
 * 正しい値を返すには「そのパスの入力（先行パス）がすべて dirty 化済み」である必要がある。
 * DFS ではダイヤモンド依存で片腕しか dirty 化していない段階で合流点を評価してしまうため、
 * パス単位の rank（= 最長経路長）を先に求め、rank の昇順で訪問する。
 *
 * rank の定義から、辺 (u → v) が存在すれば必ず rank(u) < rank(v) となる。したがって
 * rank r のバケットを処理する時点で rank < r のパスはすべて訪問（dirty 化）済みであり、
 * 同じバケット内のパス同士は互いに先行関係を持たない。
 *
 * 値を読まないグラフ走査なので、ウォーク 1 回あたりの追加コストは実測で誤差に
 * 収まる（メモ化しても差が出なかったため、キャッシュは持たない）。
 */
import { raiseError } from "../raiseError";

export function getTopologicalRanks(
  startPath: string,
  staticMap: Map<string, string[]>,
  dynamicMap: Map<string, string[]>,
  maxDepth: number,
): ReadonlyMap<string, number> {
  // 1) startPath から到達可能なパス部分グラフと入次数を求める（値は一切読まない）
  const adjacency: Map<string, string[]> = new Map();
  const inDegree: Map<string, number> = new Map();
  const pending: string[] = [startPath];
  inDegree.set(startPath, 0);
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (adjacency.has(path)) {
      continue;
    }
    const staticDeps = staticMap.get(path);
    const dynamicDeps = dynamicMap.get(path);
    let deps: string[];
    if (staticDeps === undefined) {
      deps = dynamicDeps ?? [];
    } else if (dynamicDeps === undefined) {
      deps = staticDeps;
    } else {
      deps = staticDeps.concat(dynamicDeps);
    }
    adjacency.set(path, deps);
    for (let i = 0; i < deps.length; i++) {
      const dep = deps[i];
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
      if (!adjacency.has(dep)) {
        pending.push(dep);
      }
    }
  }

  // 2) Kahn 法。rank は最長経路長（rank[v] = max(rank[u]) + 1）。
  //    入次数が 0 に落ちて queue に入ったパスだけが「確定」で、緩和の途中で
  //    暫定値が入っただけのパス（= 循環の一部）は確定扱いにしない。
  const ranks: Map<string, number> = new Map();
  const settled: Set<string> = new Set();
  const queue: string[] = [];
  for (const [path, degree] of inDegree) {
    if (degree === 0) {
      ranks.set(path, 0);
      settled.add(path);
      queue.push(path);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    const nextRank = ranks.get(path)! + 1;
    if (nextRank > maxDepth) {
      raiseError(`Maximum dependency depth of ${maxDepth} exceeded. Possible circular dependency detected at path: ${path}`);
    }
    const deps = adjacency.get(path)!;
    for (let j = 0; j < deps.length; j++) {
      const dep = deps[j];
      if (nextRank > (ranks.get(dep) ?? -1)) {
        ranks.set(dep, nextRank);
      }
      const remaining = inDegree.get(dep)! - 1;
      inDegree.set(dep, remaining);
      if (remaining === 0) {
        settled.add(dep);
        queue.push(dep);
      }
    }
  }

  // 3) 循環に含まれるパスは rank が決まらない（入次数が 0 に落ちない）。
  //    そもそも正しい評価順が存在しないので、順序保証を諦めて確定済みの
  //    最大 rank の次にまとめる。打ち切りは従来どおり visited が担う。
  //    暫定値が残っていると確定パスとの前後関係を誤って表すため、必ず上書きする。
  if (settled.size !== adjacency.size) {
    let maxRank = -1;
    for (const path of settled) {
      const rank = ranks.get(path)!;
      if (rank > maxRank) {
        maxRank = rank;
      }
    }
    const cycleRank = maxRank + 1;
    for (const path of adjacency.keys()) {
      if (!settled.has(path)) {
        ranks.set(path, cycleRank);
      }
    }
  }
  return ranks;
}

