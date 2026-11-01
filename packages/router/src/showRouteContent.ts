import { GuardData, IRoute, IRouteMatchResult, IRouter } from "./components/types";
import { hideRoute } from "./hideRoute";
import { assignRouteParams, placeRoute } from "./showRoute";
import { GuardCancel } from "./GuardCancel";
import { runTransition } from "./protocol/transitionRunner";
import { warnUnboundMarkup } from "./unboundMarkupWarning";
import { bindSubtree, getBinder } from "./protocol/binder";
import { ROUTE_RANGE } from "./routeRange";
import { config } from "./config";
import { isAbortError } from "./isAbortError";

/** 続けて起きた guard のリダイレクトの数（guard 相を通った遷移で数え直す） */
const redirectCounts = new WeakMap<IRouter, number>();
/** これを超えて続くリダイレクトはループとして止める（docs/seam-apps.md、router-auth） */
export const MAX_GUARD_REDIRECTS = 10;

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
    if (node.isConnected) {
      if (bindSubtree(node, ROUTE_RANGE)) continue;
    } else if (getBinder() !== null) {
      // Not in the document: the content of a route inside a <wcs-layout> whose template is still
      // loading. A binder must not take a detached subtree (3.x binds it detached, and its event
      // bindings fail as disconnected); the layout outlet hands it over once it has placed it.
      continue;
    }
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
 * フォールバックへの再ナビゲートを予約して false を返す。
 *
 * リダイレクトは設計どおりの使い方なので、コンソールには何も出さない。履歴は**置き換える** —
 * 守られた URL は表示されていないので「戻る」の行き先にしない（push だと、戻るたびに同じ
 * リダイレクトへ戻される）。初期化（connectedCallbackPromise）の後で行う — 初期化中の遷移は
 * navigate リスナに捕まらず、文書ごと読み直される。guard 同士が送り合うループは
 * MAX_GUARD_REDIRECTS 回で止めてエラーにする。
 *
 * showRouteContent の相 1 であると同時に、SSR ハイドレーション
 * （docs/ssr-router-design.md §4 — 採用はレンダリング最適化であって認可の
 * スキップではない）からも同じ規則で呼ばれるため抽出した。
 *
 * `superseded` が真なら（ガードを待つ間に次のナビゲーションが始まった）、結果が通過でも
 * 拒否でも false を返し、リダイレクトもしない — 利用者はもう別の場所へ向かっている。
 */
export async function runGuardPhase(
  routerNode: IRouter,
  matchResult: IRouteMatchResult,
  superseded: () => boolean = () => false,
): Promise<boolean> {
  try {
    // guard がオブジェクトを返したルートのデータを親→子の順で浅くマージし、
    // matchResult.data に載せる（applyRoute / SSR 採用が commit へ運ぶ）。
    // 何も返らなければ null — 「このナビゲーションにデータ無し」を明示する
    let data: GuardData | null = null;
    for (const route of matchResult.routes) {
      const routeData = await route.guardCheck(matchResult);
      if (routeData) {
        data = data === null ? routeData : Object.assign({}, data, routeData);
      }
    }
    if (superseded()) return false;
    matchResult.data = data;
    redirectCounts.delete(routerNode);
  } catch (e) {
    if (e instanceof GuardCancel) {
      if (superseded()) return false;
      const count = (redirectCounts.get(routerNode) ?? 0) + 1;
      if (count > MAX_GUARD_REDIRECTS) {
        redirectCounts.delete(routerNode);
        console.error(
          `${config.tagNames.router}: guard redirect loop — stopped after ${MAX_GUARD_REDIRECTS} redirects in a row ` +
          `(the last: ${matchResult.path} → ${e.fallbackPath}). The guards of these routes send each other back and forth.`,
        );
        return false;
      }
      redirectCounts.set(routerNode, count);
      routerNode.connectedCallbackPromise
        .catch(() => {})
        .then(() => routerNode.replace(e.fallbackPath))
        .catch((err) => {
          if (!isAbortError(err)) console.error('Fallback navigation failed:', err);
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
 * `beforeChange` はガード相を通った後、変更相の前に呼ぶ（applyRoute はここで commit する）。
 *
 * `displayed` は画面に出ているルートの持ち主（applyRoute は outlet を渡す）。変更相はこれと
 * **当てる時点で**比べ、当てたらこれを書き換える。遷移に渡した変更は後で当たるので、
 * `lastRoutes`（呼んだ時点のルート）と比べると、前の遷移が当たる前に始まった次の
 * ナビゲーションは前の遷移の前のルートと比べてしまう — 戻るの 1 フレーム以内の進むは
 * 自分のルートを「もう出ている」と読んで何も置かず、URL と画面が食い違った
 * （docs/seam-apps.md、homeroom の取り込み）。裁定者は変更を渡された順に当てる。
 *
 * `superseded` はこのナビゲーションが後のナビゲーションに追い越されたか（runGuardPhase）。
 *
 * @returns ガードチェックを通過してコンテンツ表示が成立した場合 true、
 *          GuardCancel により中断（フォールバックへ再ナビゲート）した場合と、ガードを待つ間に
 *          追い越された場合は false。
 *          呼び出し側（applyRoute）は false の場合、router.path / outlet.lastRoutes を
 *          更新しないことで「拒否されたパスでの path-changed 発火」を防ぐ。
 */
export async function showRouteContent(
  routerNode: IRouter,
  matchResult: IRouteMatchResult,
  lastRoutes: IRoute[],
  beforeChange?: () => void,
  displayed: { lastRoutes: IRoute[] } = { lastRoutes },
  superseded?: () => boolean,
): Promise<boolean> {
  // --- ガード相 ---
  if (!(await runGuardPhase(routerNode, matchResult, superseded))) {
    return false;
  }
  // 中身を描く前（applyRoute の commit — 中身のバインディングがこの遷移の出力を読めるように）
  beforeChange?.();

  // --- 変更相 ---
  const routesSet = new Set<IRoute>(matchResult.routes);
  const mutate = (): void => {
    // 当てる時点で出ているルートと比べる（上の `displayed`）
    const previous = displayed.lastRoutes;
    const lastRouteSet = new Set<IRoute>(previous);
    // Hide previous routes
    for (const route of previous) {
      if (!routesSet.has(route)) {
        hideRoute(route);
      }
    }
    // The routes to show (new ones, ones whose params changed, and every one under the first of
    // them) get their params first, all of them: putting a parent back moves its children's content
    // too, and their connectedCallback must already see the new params.
    const shown: IRoute[] = [];
    for (const route of matchResult.routes) {
      if (shown.length > 0 || !lastRouteSet.has(route) || route.shouldChange(matchResult.params)) {
        shown.push(route);
        assignRouteParams(route, matchResult);
      }
    }
    let moved = false;
    for (const route of shown) {
      const again = lastRouteSet.has(route);
      // A route shown again under one shown again was moved along with it: not twice.
      if (!(again && moved)) {
        placeRoute(route);
      }
      moved ||= again;
      // 挿入の後。初回描画（lastRoutes が空）の内容は state のバインド構築時に
      // document に居るので、そこは binder に渡す必要も報告する必要も無い。
      // `bind()` 自体は冪等なので渡しても壊れないが、渡さないほうが安い。
      if (previous.length > 0 && !again) {
        bindRouteContent(route);
      }
    }
    displayed.lastRoutes = matchResult.routes;
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
