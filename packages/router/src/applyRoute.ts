import { IOutlet, IRouter } from "./components/types";
import { config } from "./config";
import { matchRoutes } from "./matchRoutes";
import { raiseError } from "./raiseError";
import { showRouteContent } from "./showRouteContent";

export async function applyRoute(
  routerNode: IRouter, 
  outlet: IOutlet, 
  fullPath: string,
  lastPath: string
): Promise<void> {
  const basename = routerNode.basename;
  const path = fullPath.startsWith(basename)
    ? fullPath.slice(basename.length)
    : fullPath;
  let matchResult = matchRoutes(routerNode, path);
  if (!matchResult) {
    if (routerNode.fallbackRoute) {
      matchResult = {
        routes: [routerNode.fallbackRoute],
        params: {},
        path: path,
        lastPath: lastPath
      };
    } else {
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
