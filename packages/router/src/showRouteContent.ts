import { IRoute, IRouteMatchResult, IRouter } from "./components/types";
import { hideRoute } from "./hideRoute";
import { showRoute } from "./showRoute";
import { GuardCancel } from "./GuardCancel";
import { runTransition } from "./protocol/transitionRunner";
import { warnUnboundMarkup } from "./unboundMarkupWarning";

/**
 * ルートの内容にバインドがあれば 1 回だけ報告する。
 *
 * 直し方まで書くのは、これが仕様の穴ではなく**分担の境界**だからである。
 * データ駆動の DOM は router の外に置き、router が publish する `path` を
 * 見て `<template data-wcs="if: …">` で出し分ける（examples/router-spa と
 * examples/router-i18n が同じ分担を採っている）。
 */
function warnRouteContent(route: IRoute): void {
  for (const node of route.childNodeArray) {
    if (node.nodeType !== 1) continue;
    warnUnboundMarkup(
      node as Element,
      `<${(node as Element).tagName.toLowerCase()}> inside a route`,
      `Render data-driven markup outside <wcs-router> instead — bind the router's ` +
      `\`path\` into state and gate the markup with <template data-wcs="if: …">. ` +
      `See examples/router-i18n.`,
    );
  }
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
        // 初回描画（lastRoutes が空）で表示されるルートの内容は、state がバインドを
        // 構築する時点で document に居るので正常に効く。ここで報告するのは
        // 「あとから初めて差し込まれる内容」だけ（unboundMarkupWarning.ts）。
        if (lastRoutes.length > 0 && !lastRouteSet.has(route)) {
          warnRouteContent(route);
        }
        force = showRoute(route, matchResult);
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
