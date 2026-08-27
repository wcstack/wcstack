import { IRouteMatchResult, IRouter } from "./components/types";

/**
 * route commit 後のオプトイン a11y ポリシー適用（docs/a11y-design.md §3-4 / D1〜D3）。
 *
 * 呼び出しは applyRoute の committed 判定後・mutate() の外・初回描画
 * （lastRoutes が空）を除く。guard 拒否はここに到達しない（D4）。
 *
 * - `announce="title"`: commit 時点の document.title のスナップショットを
 *   live region へ書き込む（D2）。<wcs-head> の静的 title は mutate() 内で同期に
 *   差し替わるため、ここでは必ず新ルートの値が読める。バインド title の遅延窓・
 *   ナビゲーション外の title 変化には追従しない（README の明記された制限）。
 * - `focus="heading"`: リーフ route が挿入した内容の最初の h1〜h6 に
 *   tabindex="-1" を付けて focus() する。見出し不在時は何もしない — 旧フォーカス
 *   要素が遷移で消えていればブラウザが body へ落とすため、結果は仕様既定の
 *   focusReset と同等に収束する（§3-4 の規定）。
 */
export function applyA11yPolicies(routerNode: IRouter, matchResult: IRouteMatchResult): void {
  if (routerNode.announcePolicy === "title") {
    const region = routerNode.a11yRegion;
    if (region !== null) {
      region.textContent = document.title;
    }
  }
  if (routerNode.focusPolicy === "heading") {
    // matchRoutes / fallbackRoute の構成上 routes は常に 1 件以上
    const leaf = matchResult.routes[matchResult.routes.length - 1];
    const heading = findFirstHeading(leaf.childNodeArray);
    if (heading !== null) {
      if (!heading.hasAttribute("tabindex")) {
        heading.setAttribute("tabindex", "-1");
      }
      heading.focus();
    }
  }
}

/**
 * リーフ route のトップレベルノード列を document order で走査し、最初の見出しを
 * 返す。祖先 route の内容へは遡らない — 読者が「新しい画面」と認識する単位は
 * リーフである（docs/a11y-design.md §3-4）。ルート内容は Comment placeholder の
 * 兄弟として挿入されるため安定した「箱」が無く、内容から探すのが唯一の現実解。
 */
function findFirstHeading(nodes: Node[]): HTMLElement | null {
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    if (/^H[1-6]$/.test(element.tagName)) {
      return element as HTMLElement;
    }
    const descendant = element.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6");
    if (descendant !== null) {
      return descendant;
    }
  }
  return null;
}
