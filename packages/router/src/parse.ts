import { ILayout, IRoute, IRouter } from "./components/types.js";
import { Layout } from "./components/Layout.js";
import { createLayoutOutlet } from "./components/LayoutOutlet.js";
import { Route } from "./components/Route.js";
import { config } from "./config.js";

async function _parseNode(
  routesNode: IRouter, 
  node: Node, 
  routes: IRoute[], 
  map: Map<string, IRoute | ILayout>
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
        route.initialize();
        route.routerNode = routesNode;
        route.routeParentNode = routeParentNode;
        route.placeHolder = document.createComment(`@@route:${route.uuid}`);
        routes.push(route);
        map.set(route.uuid, route);
        appendNode = route.placeHolder;
        element = route;
      } else if (tagName === config.tagNames.layout) {
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
      const children = await _parseNode(routesNode, element, routes, map);
      element.innerHTML = "";
      element.appendChild(children);
      fragment.appendChild(appendNode);
    } else {
      fragment.appendChild(childNode);
    }
  }
  return fragment;
}

export async function parse(routesNode: IRouter): Promise<DocumentFragment> {
  const map: Map<string, IRoute | ILayout> = new Map();
  const fr = await _parseNode(routesNode, routesNode.template.content, [], map);
  return fr;
}