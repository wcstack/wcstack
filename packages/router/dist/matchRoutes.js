function _matchRoutes(routerNode, routeNode, routes, path, results) {
    const nextRoutes = routes.concat(routeNode);
    const matchResult = routeNode.testPath(path);
    if (matchResult) {
        results.push(matchResult);
        return; // Stop searching deeper routes once a match is found
    }
    for (const childRoute of routeNode.routeChildNodes) {
        _matchRoutes(routerNode, childRoute, nextRoutes, path, results);
    }
}
export function matchRoutes(routerNode, path) {
    const routes = [];
    const topLevelRoutes = routerNode.routeChildNodes;
    const results = [];
    for (const route of topLevelRoutes) {
        _matchRoutes(routerNode, route, routes, path, results);
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