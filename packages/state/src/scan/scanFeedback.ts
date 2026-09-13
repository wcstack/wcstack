/**
 * scan/scanFeedback.ts
 *
 * 自己ループの柵（docs/state-scan-design.md D9 / §2-3）。
 *
 * `from` の根が `$streams` 名である scan について、その stream の `args` 依存に
 * scan 出力から依存グラフで到達できるパスが含まれていたら raise する。
 *
 *     $scan.feed { from: "pageResult" }
 *     get page() { return Math.floor(this.feed.items.length / this.pageSize) + 1; }
 *     $streams.pageResult { args: (s) => ({ page: s.page }) }
 *
 * は、ページが着地するたびに `feed` → `page` → restart と進み、sentinel を経由せずに
 * 全ページを読み続ける（冪等キーが無ければ同じページを無限に取り直す）。
 *
 * 辿るグラフは書き込みの伝播（`walkDependency`）と同じ `staticDependency`（親 → 子）と
 * `dynamicDependency`（読まれたパス → それを読む getter）なので、「出力への書き込みが
 * args の読みに届くか」をそのまま判定できる。
 */

import type { IStateElement } from "../components/types";
import { STATE_SCAN_NAME, STATE_STREAMS_NAME } from "../define";
import { raiseError } from "../raiseError";
import type { IStreamEntry } from "../stream/types";
import { getScanRegistry } from "./scanRegistry";

const NO_EDGES: readonly string[] = Object.freeze([]);

function collectReachablePaths(stateElement: IStateElement, start: string): ReadonlySet<string> {
  const reachable = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const path = queue.pop() as string;
    const children = stateElement.staticDependency.get(path) ?? NO_EDGES;
    const dependents = stateElement.dynamicDependency.get(path) ?? NO_EDGES;
    for (const next of [...children, ...dependents]) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
}

/** stream の起動・restart（`traceArgs` の直後）で呼ぶ。 */
export function assertNoScanFeedback(stateElement: IStateElement, streamEntry: IStreamEntry): void {
  const registry = getScanRegistry(stateElement);
  if (typeof registry === "undefined" || streamEntry.depAddresses.size === 0) {
    return;
  }
  for (const scan of registry.entries) {
    if (scan.source.kind !== "path" || scan.source.pathInfo.segments[0] !== streamEntry.name) {
      continue;
    }
    const reachable = collectReachablePaths(stateElement, scan.name);
    for (const dep of streamEntry.depAddresses) {
      const depPath = dep.absolutePathInfo.pathInfo.path;
      if (reachable.has(depPath)) {
        raiseError(
          `[wcs/scan-feedback-loop] ${STATE_STREAMS_NAME} entry "${streamEntry.name}" args read "${depPath}", ` +
          `which is derived from the ${STATE_SCAN_NAME} output "${scan.name}" that this stream feeds. ` +
          `Every landing would restart the stream on its own result. Advance the cursor from an event ($on) ` +
          `and keep it a plain property instead of deriving it from the accumulator.`,
        );
      }
    }
  }
}
