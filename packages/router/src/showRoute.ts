import { assignParams } from "./assignParams";
import { LayoutOutlet } from "./components/LayoutOutlet";
import { IRoute, IRouteMatchResult } from "./components/types";
import { config } from "./config";

/**
 * ルートへのパラメータ割り当て（setParams + 内容ノードへの data-bind /
 * LayoutOutlet 配送）。挿入とは独立に呼べるよう showRoute から抽出 —
 * SSR ハイドレーション（採用時は内容が既に DOM に居るため挿入しない）が
 * 同じ配送規則を共有する（docs/ssr-router-design.md §4）。
 *
 * connectedCallback が呼ばれる前に、プロパティにパラメータを割り当てる必要が
 * あるため（挿入時にパラメータはすでに設定されている必要がある）、showRoute は
 * これを挿入より先に呼ぶ。
 */
export function assignRouteParams(route: IRoute, matchResult: IRouteMatchResult): void {
  const params: Record<string, string> = {};
  const typedParams: Record<string, any> = {};
  for(const key of route.paramNames) {
    params[key] = matchResult.params[key];
    typedParams[key] = matchResult.typedParams[key];
  }
  route.setParams(params, typedParams);
  for (const node of route.childNodeArray) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      element.querySelectorAll('[data-bind]').forEach((e) => {
        assignParams(e, route.typedParams);
      });
      if (element.hasAttribute('data-bind')) {
        assignParams(element, route.typedParams);
      }
      element.querySelectorAll<LayoutOutlet>(config.tagNames.layoutOutlet).forEach((layoutOutlet) => {
        layoutOutlet.assignParams(route.typedParams);
      });
      if (element.tagName.toLowerCase() === config.tagNames.layoutOutlet) {
        (element as LayoutOutlet).assignParams(route.typedParams);
      }
    }
  }
}

export function showRoute(route: IRoute, matchResult: IRouteMatchResult): boolean {
  assignRouteParams(route, matchResult);
  const parentNode = route.placeHolder.parentNode;
  const nextSibling = route.placeHolder.nextSibling;
  for (const node of route.childNodeArray) {
    if (nextSibling) {
      parentNode?.insertBefore(node, nextSibling);
    } else {
      parentNode?.appendChild(node);
    }
  }
  return true;
}
