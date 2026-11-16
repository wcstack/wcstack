import { IRoute, IRouteMatchResult, IRouter } from "./components/types.js";
import { decodeSegment } from "./normalizePathname.js";
import { testPath } from "./testPath.js";

function _matchRoutes(
  routeNode: IRoute,
  normalizedPath: string,
  segments: string[],
  results: IRouteMatchResult[]
): void {
  const matchResult = testPath(routeNode, normalizedPath, segments);
  if (matchResult) {
    results.push(matchResult);
  }
  for(const childRoute of routeNode.routeChildNodes) {
    _matchRoutes(childRoute, normalizedPath, segments, results);
  }
}

export function matchRoutes(routerNode: IRouter, normalizedPath: string): IRouteMatchResult | null {
  const topLevelRoutes = routerNode.routeChildNodes;
  const results: IRouteMatchResult[] = [];
  // セグメント配列を作成（先頭の/は除去せずにそのまま分割）
  // '/' => ['', ''] → filter → ['']
  // '/home' => ['', 'home']  → filter → ['home']
  // '/home/about' => ['', 'home', 'about'] → filter → ['home', 'about']
  // '' => ['']
  const rawSegments = normalizedPath.split('/');
  // 先頭の空セグメント（絶対パスの/）と末尾の空セグメント（/で終わるパス）を除去
  // 残ったセグメントは、分けた後でパーセントデコードする: ルートの静的セグメントとも、パラメータの値とも、
  // セグメントが表す文字列で比べる（`/caf%C3%A9` は path="/café" に一致し、`/users/%E2%82%AC` の id は "€"）。
  // エンコードされたスラッシュ（`%2F`）はセグメントを分けず、値の中の "/" になる（#694）
  const segments = rawSegments.filter((s, i) => {
    if (i === 0 && s === '') return false; // 先頭の空セグメントをスキップ
    if (i === rawSegments.length - 1 && s === '' && rawSegments.length > 1) return false; // 末尾の空セグメントをスキップ
    return true;
  }).map(decodeSegment);
  for (const route of topLevelRoutes) {
    _matchRoutes(route, normalizedPath, segments, results);
  }
  results.sort((a, b) => {
    const lastRouteA = a.routes.at(-1)!;
    const lastRouteB = b.routes.at(-1)!;
    const diffSegmentCount = lastRouteA.absoluteSegmentCount - lastRouteB.absoluteSegmentCount;
    if (diffSegmentCount !== 0) {
      return -diffSegmentCount;
    }
    const diffWeight = lastRouteA.absoluteWeight - lastRouteB.absoluteWeight;
    if (diffWeight !== 0) {
      return -diffWeight;
    }
    const diffIndex = lastRouteA.childIndex - lastRouteB.childIndex;
    return diffIndex;
  });
  if (results.length > 0) {
    return results[0];
  }
  return null;
}