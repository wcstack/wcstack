/**
 * `<wcs-router>` の直後に無い `<wcs-outlet>` を loud に報告する
 * （docs/router-outlet-placement.md）。
 *
 * router が使う outlet は、自分の直後の兄弟要素だけである（マルチ Router で router と
 * outlet を 1 対 1 に結ぶための規則。SSR の採用経路もこの位置を前提にする）。直後に
 * 無ければ、router は outlet を作って自分の直後に置く。そのとき別の場所に置かれた
 * `<wcs-outlet>` は使われず、ページは router の直後に描かれ、置いた outlet は空のまま
 * になる — これまでは何も報告されなかった。
 *
 * **挙動は変えない。** 変えるのは「黙って別の場所に描く」を「原因を指す警告」にする
 * ことだけ。outlet を探す範囲を広げる案・属性で明示的に結ぶ案は、実需が出てから決める。
 *
 * router が outlet を自分のものにするのは「直後にある」か「直後に作った」かのどちら
 * かなので、直前の要素が router でない outlet は、どの router にも使われない。その判定
 * だけで足り、ほかの router の初期化の順番を待つ必要は無い。
 */
import { config } from "./config.js";

const warned = new WeakSet<Element>();

/**
 * 直後に outlet を持たない router が outlet を作る直前に呼ぶ。同じ root（document か
 * shadow root）に、どの router にも使われない `<wcs-outlet>` があれば 1 回だけ警告する。
 */
export function warnMisplacedOutlet(router: Element): void {
  const root = router.getRootNode();
  // 文書に入っていない router（root は自分自身）には、比べる相手のページが無い
  if (root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return;
  }
  const routerTag = config.tagNames.router;
  const outletTag = config.tagNames.outlet;
  for (const outlet of (root as Document | ShadowRoot).querySelectorAll(outletTag)) {
    if (warned.has(outlet) || outlet.previousElementSibling?.matches(routerTag)) {
      continue;
    }
    warned.add(outlet);
    console.warn(
      `[@wcstack/router] [wcs/router-outlet-misplaced] A <${routerTag}> uses only the element right after it ` +
      `as its outlet, and this page has a <${outletTag}> that no router uses. The router makes an outlet of ` +
      `its own right after itself, so the routes render there and the <${outletTag}> you placed stays empty. ` +
      `Move the <${outletTag}> right after the <${routerTag}>.`,
      outlet,
    );
  }
}
