import { IRoute, IRouteMatchResult, IRouter } from "./components/types";
import { hideRoute } from "./hideRoute";
import { showRoute } from "./showRoute";
import { GuardCancel } from "./GuardCancel";
import { runTransition } from "./protocol/transitionRunner";
import { warnUnboundMarkup } from "./unboundMarkupWarning";
import { bindSubtree } from "./protocol/binder";

/**
 * 差し込んだルート内容を binder へ渡す。binder が居なければ、バインドが効かない
 * ことを 1 回だけ報告する。
 *
 * 挿入の**後**に呼ぶ。`bind()` は初期値の適用まで同期で行うので、挿入前に呼ぶと
 * まだ document に居ないノードを走査することになる。
 *
 * binder が居ないのは state を読み込んでいないページで、そこでは `data-wcs` が
 * そもそも動かない。報告に直し方まで書くのは、これが仕様の穴ではなく**分担の
 * 境界**だからである（examples/router-spa と examples/router-i18n が同じ分担）。
 */
function bindRouteContent(route: IRoute): void {
  for (const node of route.childNodeArray) {
    if (node.nodeType !== 1) continue;
    if (bindSubtree(node)) continue;
    warnUnboundMarkup(
      node as Element,
      `<${(node as Element).tagName.toLowerCase()}> inside a route`,
      `Load @wcstack/state on this page, or render data-driven markup outside ` +
      `<wcs-router> — bind the router's \`path\` into state and gate the markup ` +
      `with <template data-wcs="if: …">. See examples/router-i18n.`,
    );
  }
}

/**
 * ガード相の単独実装。何も触らずに全ルートの guardCheck を待ち、GuardCancel なら
 * フォールバックへの再ナビゲートを microtask で予約して false を返す。
 *
 * showRouteContent の相 1 であると同時に、SSR ハイドレーション
 * （docs/ssr-router-design.md §4 — 採用はレンダリング最適化であって認可の
 * スキップではない）からも同じ規則で呼ばれるため抽出した。
 */
export async function runGuardPhase(
  routerNode: IRouter,
  matchResult: IRouteMatchResult,
): Promise<boolean> {
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
  return true;
}

/**
 * ルートコンテンツを表示する。
 *
 * 二相構成（docs/view-transition-design.md §7.1）:
 *   1. ガード相 — 何も触らずに全ルートの guardCheck を待つ。
 *   2. 変更相 — 旧ルートの hide と新ルートの show を「ひとまとまりの DOM 変更」
 *      として transition arbiter に渡す。arbiter が居なければ同期実行され、
 *      従来と同じ挙動になる。ただし初回描画は渡さない（下記）。
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
  if (!(await runGuardPhase(routerNode, matchResult))) {
    return false;
  }

  // --- 変更相 ---
  const routesSet = new Set<IRoute>(matchResult.routes);
  const lastRouteSet = new Set<IRoute>(lastRoutes);
  const mutate = (): void => {
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
        // 挿入の後。初回描画（lastRoutes が空）の内容は state のバインド構築時に
        // document に居るので、そこは binder に渡す必要も報告する必要も無い。
        // `bind()` 自体は冪等なので渡しても壊れないが、渡さないほうが安い。
        if (lastRoutes.length > 0 && !lastRouteSet.has(route)) {
          bindRouteContent(route);
        }
      }
    }
  };
  // 初回描画（＝置き換える旧ルートが無い）は遷移に渡さない。state 側の
  // 「初期レンダリングは決して包まない、包むのは drain だけ」と同じ規則で、
  // 理由も同じ: 差し替えではなく入場であり、対比すべき旧状態が無い。入場は
  // @starting-style の担当（docs/view-transition-design.md §1）。
  //
  // これは好みの問題ではない。router の初期化は最初のルート適用を await するが、
  // その時点のドキュメントはまだ最初の描画を終えていない。そこで開始した遷移は
  // Chromium で更新コールバックが呼ばれないまま留まることがあり、_initialize が
  // 永久に解決しなくなる（ページが白いまま・path が空のまま）。実ブラウザでのみ
  // 再現するので e2e/tests/view-transition.spec.ts が唯一の回帰テストになる。
  let pending: Promise<void> | undefined;
  if (lastRoutes.length === 0) {
    mutate();
  } else {
    pending = runTransition("router", mutate);
  }
  // arbiter が居ないときは同期適用済みで undefined が返る。そこで await すると
  // 無条件に 1 tick 増えて、既存のナビゲーション完了タイミングが変わってしまう。
  if (pending !== undefined) {
    await pending;
  }
  return true;
}
