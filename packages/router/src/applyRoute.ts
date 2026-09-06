import { applyA11yPolicies } from "./a11yPolicies";
import { IOutlet, IRouter } from "./components/types";
import { config } from "./config";
import { matchRoutes } from "./matchRoutes";
import { sliceBasename } from "./normalizePathname";
import { raiseError } from "./raiseError";
import { showRouteContent } from "./showRouteContent";

/**
 * ルートを適用する。返り値は committed — guard 拒否（GuardCancel）で中断された
 * 場合のみ false。呼び出し側はこれで commit 後の処理（フォールバック経路の
 * スクロール等）をゲートできる（docs/a11y-design.md §3-2 / D4）。
 *
 * `search` は現在 URL のクエリ（"?k=v" 形式または ""）。隠れた `window.location`
 * 読みにせず呼び出し元が明示供給する（docs/router-state-contract-design.md §3.6 —
 * テスト容易性と権威の明示のため）。
 */
export async function applyRoute(
  routerNode: IRouter,
  outlet: IOutlet,
  fullPath: string,
  lastPath: string,
  search: string = ""
): Promise<boolean> {
  const path = sliceBasename(fullPath, routerNode.basename);

  // same-match 高速パス（docs/router-state-contract-design.md §4.4）。
  // guard はルートへの進入を守るものであり、クエリ変化は進入ではない —
  // matchRoutes / guard 相 / showRouteContent をスキップし、transition-runner にも
  // 渡さず（DOM mutation が無いのに arbiter へ空遷移を依頼しない）、a11y の
  // 再アナウンスもしない。search を commit し、§3.4 の規範で発火する
  // （この場合 search-changed のみが発火し得る）。
  if (routerNode.isSameMatch(path)) {
    routerNode.commitNavigation({
      params: routerNode.params,
      typedParams: routerNode.typedParams,
      routeName: routerNode.routeName,
      search,
      path,
    });
    return true;
  }

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
  // routeName は最深マッチの name。fallback 時は fallback ルートの name（D8）。
  routerNode.commitNavigation({
    params: matchResult.params,
    typedParams: matchResult.typedParams,
    routeName: matchResult.routes[matchResult.routes.length - 1]?.name ?? "",
    search,
    path,
  });
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
