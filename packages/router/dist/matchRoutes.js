function _matchRoutes(routerNode, routeNode, routes, normalizedPath, segments, results) {
    const nextRoutes = routes.concat(routeNode);
    const matchResult = routeNode.testPath(normalizedPath, segments);
    if (matchResult) {
        results.push(matchResult);
    }
    for (const childRoute of routeNode.routeChildNodes) {
        _matchRoutes(routerNode, childRoute, nextRoutes, normalizedPath, segments, results);
    }
}
export function matchRoutes(routerNode, normalizedPath) {
    const routes = [];
    const topLevelRoutes = routerNode.routeChildNodes;
    const results = [];
    // セグメント配列を作成（先頭の/は除去せずにそのまま分割）
    // '/' => ['', ''] → filter → ['']
    // '/home' => ['', 'home']  → filter → ['home']
    // '/home/about' => ['', 'home', 'about'] → filter → ['home', 'about']
    // '' => ['']
    const rawSegments = normalizedPath.split('/');
    // 先頭の空セグメント（絶対パスの/）と末尾の空セグメント（/で終わるパス）を除去
    const segments = rawSegments.filter((s, i) => {
        if (i === 0 && s === '')
            return false; // 先頭の空セグメントをスキップ
        if (i === rawSegments.length - 1 && s === '' && rawSegments.length > 1)
            return false; // 末尾の空セグメントをスキップ
        return true;
    });
    for (const route of topLevelRoutes) {
        _matchRoutes(routerNode, route, routes, normalizedPath, segments, results);
    }
    results.sort((a, b) => {
        const lastRouteA = a.routes.at(-1);
        const lastRouteB = b.routes.at(-1);
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
//# sourceMappingURL=matchRoutes.js.map