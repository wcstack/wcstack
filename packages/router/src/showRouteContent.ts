import { IRoute, IRouteMatchResult, IRouter } from "./components/types";
import { hideRoute } from "./hideRoute";
import { showRoute } from "./showRoute";
import { GuardCancel } from "./GuardCancel";
import { runTransition } from "./protocol/transitionRunner";

/**
 * ルートコンテンツを表示する。
 *
 * 二相構成（docs/view-transition-design.md §7.1）:
 *   1. ガード相 — 何も触らずに全ルートの guardCheck を待つ。
 *   2. 変更相 — 旧ルートの hide と新ルートの show を「ひとまとまりの DOM 変更」
 *      として transition arbiter に渡す。arbiter が居なければ同期実行され、
 *      従来と同じ挙動になる。
 *
 * ガードを変更相の中に入れないのは、更新コールバックの中で任意の await を
 * 走らせると遷移が開きっぱなしになるため（ブラウザの猶予は約 4 秒）。
 * 相を分けたことで「ガードが拒否したのに旧ルートだけ先に消えている」という
 * 順序の歪みも同時に解消している。
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
  // --- ガード相 ---
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

  // --- 変更相 ---
  const routesSet = new Set<IRoute>(matchResult.routes);
  const lastRouteSet = new Set<IRoute>(lastRoutes);
  const pending = runTransition("router", () => {
    // Hide previous routes
    for (const route of lastRoutes) {
      if (!routesSet.has(route)) {
        hideRoute(route);
      }
    }
    let force = false;
    for (const route of matchResult.routes) {
      if (!lastRouteSet.has(route) || route.shouldChange(matchResult.params) || force) {
        force = showRoute(route, matchResult);
      }
    }
  });
  // arbiter が居ないときは同期適用済みで undefined が返る。そこで await すると
  // 無条件に 1 tick 増えて、既存のナビゲーション完了タイミングが変わってしまう。
  if (pending !== undefined) {
    await pending;
  }
  return true;
}
