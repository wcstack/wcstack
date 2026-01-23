import { assignParams } from "./assignParams";
import { LayoutOutlet } from "./components/LayoutOutlet";
import { IRoute, IRouteMatchResult } from "./components/types";
import { config } from "./config";

export function showRoute(route: IRoute, matchResult: IRouteMatchResult): boolean {
  route.clearParams();
  for(const key of route.paramNames) {
    route.params[key] = matchResult.params[key];
    route.typedParams[key] = matchResult.typedParams[key];
  }
  const parentNode = route.placeHolder.parentNode;
  const nextSibling = route.placeHolder.nextSibling;
  for (const node of route.childNodeArray) {
    if (nextSibling) {
      parentNode?.insertBefore(node, nextSibling);
    } else {
      parentNode?.appendChild(node);
    }
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
  return true;
}
