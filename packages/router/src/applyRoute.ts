import { applyA11yPolicies } from "./a11yPolicies";
import { IOutlet, IRouter } from "./components/types";
import { config } from "./config";
import { matchRoutes } from "./matchRoutes";
import { raiseError } from "./raiseError";
import { showRouteContent } from "./showRouteContent";

/**
 * ルートを適用する。返り値は committed — guard 拒否（GuardCancel）で中断された
 * 場合のみ false。呼び出し側はこれで commit 後の処理（フォールバック経路の
 * スクロール等）をゲートできる（docs/a11y-design.md §3-2 / D4）。
 */
export async function applyRoute(
  routerNode: IRouter,
  outlet: IOutlet,
  fullPath: string,
  lastPath: string
): Promise<boolean> {
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
  if (!committed) return false;
  // if successful, update router and outlet state
  routerNode.path = path;
  outlet.lastRoutes = matchResult.routes;
  // オプトインの focus/announce は commit 直後・mutate() の外で適用する（D3）。
  // 初回描画（lastRoutes が空）では動かない — ページロードはブラウザの担当で、
  // view-transition の「初回は包まない」と同じ判定・同じ理由（§3-5）。
  // guard 拒否は上の return false で既に抜けている（D4）。
  if (lastRoutes.length > 0) {
    applyA11yPolicies(routerNode, matchResult);
  }
  return true;
}
