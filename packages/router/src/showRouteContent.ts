import { IRoute, IRouteMatchResult, IRouter } from "./components/types";
import { hideRoute } from "./hideRoute";
import { showRoute } from "./showRoute";
import { GuardCancel } from "./GuardCancel";

/**
 * ルートコンテンツを表示する。
 *
 * @returns ガードチェックを通過してコンテンツ表示が成立した場合 true、
 *          GuardCancel により中断（フォールバックへ再ナビゲート）した場合 false。
 *          呼び出し側（applyRoute）は false の場合、router.path / outlet.lastRoutes を
 *          更新しないことで「拒否されたパスでの path-changed 発火」を防ぐ。
 */
export async function showRouteContent(
  routerNode: IRouter,
  matchResult: IRouteMatchResult,
  lastRoutes: IRoute[],
): Promise<boolean> {
  // Hide previous routes
  const routesSet = new Set<IRoute>(matchResult.routes);
  for (const route of lastRoutes) {
    if (!routesSet.has(route)) {
      hideRoute(route);
    }
  }
  try {
    for (const route of matchResult.routes) {
      await route.guardCheck(matchResult);
    }
  } catch (e) {
    if (e instanceof GuardCancel) {
      console.warn(`Navigation cancelled: ${e.message}. Redirecting to ${e.fallbackPath}`);
      queueMicrotask(() => {
        routerNode.navigate(e.fallbackPath).catch((err) => {
          console.error('Fallback navigation failed:', err);
        });
      });
      return false;
    } else {
      throw e;
    }
  }
  const lastRouteSet = new Set<IRoute>(lastRoutes);
  let force = false;
  for (const route of matchResult.routes) {
    if (!lastRouteSet.has(route) || route.shouldChange(matchResult.params) || force) {
      force = showRoute(route, matchResult);
    }
  }
  return true;
}
