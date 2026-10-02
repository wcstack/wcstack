import { assignParams } from "./assignParams";
import { LayoutOutlet } from "./components/LayoutOutlet";
import { IRoute, IRouteMatchResult } from "./components/types";
import { config } from "./config";
import { holdRoute } from "./hideRoute";

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

/** Routes placed at least once: their written nodes are never placed again */
const placed = new WeakSet<IRoute>();

/**
 * ルートの内容を placeholder の後ろへ置く: `route.held` があればそれを、初めてなら元のノードと
 * `route.endMarker` を。表示中のルート（パラメータの変化）は、隠すときと同じく持ち出してすぐ戻す。
 * パラメータは先に割り当てておく（assignRouteParams）。
 */
export function placeRoute(route: IRoute): void {
  const placeHolder = route.placeHolder;
  if (placeHolder.parentNode === null) return;
  if (placed.has(route) || route.endMarker.parentNode !== null) {
    // Shown before (again on a parameter change, or back from held): take it out as hiding does —
    // nothing to do when it is held — and put it back, so its custom elements reconnect and read the
    // new params. Never its written nodes again, even when other code removed the end mark: a
    // template the state replaced with its anchor would come back.
    holdRoute(route);
    placeHolder.after(route.held!);
    route.held = null;
  } else {
    placeHolder.after(...route.childNodeArray, route.endMarker);
  }
  placed.add(route);
}

/** パラメータを割り当ててから置く（ルート 1 つ分。複数を出すときは showRouteContent の二相） */
export function showRoute(route: IRoute, matchResult: IRouteMatchResult): boolean {
  assignRouteParams(route, matchResult);
  placeRoute(route);
  return true;
}
