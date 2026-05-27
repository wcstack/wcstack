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
  let sliced = fullPath;
  if (basename !== "") {
    if (fullPath === basename) {
      sliced = "";
    } else if (fullPath.startsWith(basename + "/")) {
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
    } else {
      raiseError(`${config.tagNames.router} No route matched for path: ${path}`);
    }
  }
  matchResult.lastPath = lastPath;
  const lastRoutes = outlet.lastRoutes;
  const committed = await showRouteContent(routerNode, matchResult, lastRoutes);
  // GuardCancel により中断された場合は state を更新しない
  // （拒否されたパスでの wcs-router:path-changed 発火を防ぐため）
  if (!committed) return;
  // if successful, update router and outlet state
  routerNode.path = path;
  outlet.lastRoutes = matchResult.routes;
}
