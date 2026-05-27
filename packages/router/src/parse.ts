import { IRoute, IRouter } from "./components/types.js";
import { Layout } from "./components/Layout.js";
import { createLayoutOutlet } from "./components/LayoutOutlet.js";
import { Route } from "./components/Route.js";
import { config } from "./config.js";
import { loadGuardHandler } from "./loadGuardHandler.js";


/**
 * 同一の絶対パスを持つ Route が複数定義された場合に警告を出力する。
 *
 * 仕様: 同一 absolutePath ごとに 1 回だけ警告する（複数重複でも警告は 1 件）。
 * これは過剰なログを避けるための意図的な設計。
 * テストでは Vitest の console.warn spy で 1 回出力を確認する。
 */
function _duplicateCheck(routesByPath: Map<string, IRoute[]>, route: IRoute): void {
  let routes = routesByPath.get(route.absolutePath);
  if (!routes) {
    routes = [];
  }
  for(const existingRoute of routes) {
    if (!route.testAncestorNode(existingRoute)) {
      console.warn(`Duplicate route path detected: '${route.absolutePath}' (defined as '${route.path}')`);
      break;
    }
  }
  routes.push(route);
  if (routes.length === 1) {
    routesByPath.set(route.absolutePath, routes);
  }
}

async function _parseNode(
  routerNode: IRouter,
  node: Node,
  routes: IRoute[],
  routesByPath: Map<string, IRoute[]>
): Promise<DocumentFragment> {
  const routeParentNode: IRoute | null = routes.length > 0 ? routes[routes.length - 1] : null;
  const fragment = document.createDocumentFragment();
  const childNodes = Array.from(node.childNodes);
  for(const childNode of childNodes) {
    if (childNode.nodeType === Node.ELEMENT_NODE) {
      let appendNode = childNode
      let element = childNode as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      if (tagName === config.tagNames.route) {
        const childFragment = document.createDocumentFragment();
        // Move child nodes to fragment to avoid duplication of
        for(const childNode of Array.from(element.childNodes)) {
          childFragment.appendChild(childNode);
        }
        const cloneElement = document.importNode<Route>(element as Route, true);
        customElements.upgrade(cloneElement);
        cloneElement.appendChild(childFragment);
        const route = cloneElement;
        route.initialize(routerNode, routeParentNode);
        _duplicateCheck(routesByPath, route);
        routes.push(route);
        appendNode = route.placeHolder;
        element = route;
      } else if (tagName === config.tagNames.guardHandler) {
        if (routes.length > 0) {
          const route = routes[routes.length - 1];
          const script = element.querySelector('script[type="module"]');
          if (script) {
            loadGuardHandler(script as HTMLScriptElement, route);
          }
        }
        continue;
      } else if (tagName === config.tagNames.layout) {
        // <wcs-layout> は他の case と異なり element と appendNode が別物になる。
        // - element: cloneElement (Layout 本体)。後続の `element.innerHTML = ""; element.appendChild(children)`
        //   で再帰結果が Layout 内に流し込まれる。Layout はそれを slot 投影に使う。
        // - appendNode: layoutOutlet。最終的に fragment へ挿入されるのは layoutOutlet で、
        //   layoutOutlet が element (Layout) を参照して投影を行う。
        const childFragment = document.createDocumentFragment();
        // Move child nodes to fragment to avoid duplication of
        for(const childNode of Array.from(element.childNodes)) {
          childFragment.appendChild(childNode);
        }
        const cloneElement = document.importNode(element, true);
        customElements.upgrade(cloneElement);
        cloneElement.appendChild(childFragment);
        const layout = cloneElement;
        const layoutOutlet = createLayoutOutlet();
        layoutOutlet.layout = layout as Layout;
        appendNode = layoutOutlet;
        element = cloneElement;
      }
      const children = await _parseNode(routerNode, element, routes, routesByPath);
      element.innerHTML = "";
      element.appendChild(children);
      fragment.appendChild(appendNode);
    } else {
      fragment.appendChild(childNode);
    }
  }
  return fragment;
}

export async function parse(routerNode: IRouter): Promise<DocumentFragment> {
  const routesByPath: Map<string, IRoute[]> = new Map();
  const fr = await _parseNode(routerNode, routerNode.template.content, [], routesByPath);
  return fr;
}