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
 *   ナビゲーション外の title 変化・同一 title 連続遷移の再読み上げには追従しない
 *   （README の明記された制限）。
 * - `focus="heading"`: リーフ route が挿入した内容の最初の可視 h1〜h6 に
 *   tabindex="-1" を付けて focus() する。可視見出しが無ければ、仕様既定の
 *   focusReset（after-transition）を自前で再現する — [autofocus] があればそこへ、
 *   無ければ blur で body へ落とす（§3-4 の規定）。focus= オプトインは Navigation
 *   API 経路で focusReset: "manual" を渡してブラウザ既定を止めているため、旧
 *   フォーカス要素（永続ナビのリンク等）が遷移後も生き残るケースでは、ここで
 *   落とさない限りフォーカスが前画面に取り残される。
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
    } else {
      // 仕様既定の focusReset の再現（優先順も仕様と同じ: [autofocus] → body）。
      // フォールバック経路（pushState）にはブラウザのリセットが元々無いため、
      // ここで両経路の挙動が揃う（§3-2 の scroll と同じ構図）。
      const autofocus = document.querySelector<HTMLElement>("[autofocus]");
      if (autofocus !== null) {
        autofocus.focus();
      } else if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
  }
}

/**
 * リーフ route のトップレベルノード列を document order で走査し、最初の可視の
 * 見出しを返す。祖先 route の内容へは遡らない — 読者が「新しい画面」と認識する
 * 単位はリーフである（docs/a11y-design.md §3-4）。ルート内容は Comment placeholder
 * の兄弟として挿入されるため安定した「箱」が無く、内容から探すのが唯一の現実解。
 *
 * 非表示（hidden / display:none 等）の見出しへの focus() は no-op になるため、
 * checkVisibility でスキップする。未実装環境（happy-dom）では可視扱い。
 */
function findFirstHeading(nodes: Node[]): HTMLElement | null {
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    if (/^H[1-6]$/.test(element.tagName)) {
      if (isVisible(element)) {
        return element as HTMLElement;
      }
      continue;
    }
    for (const descendant of element.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")) {
      if (isVisible(descendant)) {
        return descendant;
      }
    }
  }
  return null;
}

function isVisible(element: Element): boolean {
  return (element as HTMLElement).checkVisibility?.() !== false;
}
