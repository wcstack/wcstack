import { hideRoute } from "./hideRoute";
import { showRoute } from "./showRoute";
export async function showRouteContent(routerNode, matchResult, lastRoutes) {
    // Hide previous routes
    const routesSet = new Set(matchResult.routes);
    for (const route of lastRoutes) {
        if (!routesSet.has(route)) {
            hideRoute(route);
        }
    }
    try {
        for (const route of matchResult.routes) {
            await route.guardCheck(matchResult);
        }
    }
    catch (e) {
        const err = e;
        if ("fallbackPath" in err) {
            const guardCancel = err;
            console.warn(`Navigation cancelled: ${err.message}. Redirecting to ${guardCancel.fallbackPath}`);
            queueMicrotask(() => {
                routerNode.navigate(guardCancel.fallbackPath);
            });
            return;
        }
        else {
            throw e;
        }
    }
    const lastRouteSet = new Set(lastRoutes);
    let force = false;
    for (const route of matchResult.routes) {
        if (!lastRouteSet.has(route) || route.shouldChange(matchResult.params) || force) {
            force = showRoute(route, matchResult);
        }
    }
}
//# sourceMappingURL=showRouteContent.js.map