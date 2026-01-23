import { config } from "./config";
import { matchRoutes } from "./matchRoutes";
import { raiseError } from "./raiseError";
import { showRouteContent } from "./showRouteContent";
export async function applyRoute(routerNode, outlet, fullPath, lastPath) {
    const basename = routerNode.basename;
    let sliced = fullPath;
    if (basename !== "") {
        if (fullPath === basename) {
            sliced = "";
        }
        else if (fullPath.startsWith(basename + "/")) {
            sliced = fullPath.slice(basename.length);
        }
    }
    // when fullPath === basename (e.g. "/app"), treat it as root "/"
    const path = sliced === "" ? "/" : sliced;
    let matchResult = matchRoutes(routerNode, path);
    if (!matchResult) {
        if (routerNode.fallbackRoute) {
            matchResult = {
                routes: [routerNode.fallbackRoute],
                params: {},
                typedParams: {},
                path: path,
                lastPath: lastPath
            };
        }
        else {
            raiseError(`${config.tagNames.router} No route matched for path: ${path}`);
        }
    }
    matchResult.lastPath = lastPath;
    const lastRoutes = outlet.lastRoutes;
    await showRouteContent(routerNode, matchResult, lastRoutes);
    // if successful, update router and outlet state
    routerNode.path = path;
    outlet.lastRoutes = matchResult.routes;
}
//# sourceMappingURL=applyRoute.js.map