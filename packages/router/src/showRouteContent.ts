import { IRoute, IRouteMatchResult, IRouter } from "./components/types";
import { IGuardCancel } from "./types";

export async function showRouteContent(
  routerNode: IRouter,
  matchResult: IRouteMatchResult,
  lastRoutes: IRoute[], 
): Promise<void> {
  // Hide previous routes
  const routesSet = new Set<IRoute>(matchResult.routes);
  for (const route of lastRoutes) {
    if (!routesSet.has(route)) {
      route.hide();
    }
  }
  try {
    for (const route of matchResult.routes) {
      await route.guardCheck(matchResult);
    }
  } catch (e) {
    const err = e as Error;
    if ("fallbackPath" in err) {
      const guardCancel = err as IGuardCancel;
      console.warn(`Navigation cancelled: ${err.message}. Redirecting to ${guardCancel.fallbackPath}`);
      queueMicrotask(() => {
        routerNode.navigate(guardCancel.fallbackPath);
      });
      return;
    } else {
      throw e;
    }
  }
  const lastRouteSet = new Set<IRoute>(lastRoutes);
  let force = false;
  for (const route of matchResult.routes) {
    if (!lastRouteSet.has(route) || route.shouldChange(matchResult.params) || force) {
      force = route.show(matchResult.params);
    }
  }
}
