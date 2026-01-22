import { createLayoutOutlet } from "./components/LayoutOutlet.js";
import { config } from "./config.js";
function _duplicateCheck(routesByPath, route) {
    let routes = routesByPath.get(route.absolutePath);
    if (!routes) {
        routes = [];
    }
    for (const existingRoute of routes) {
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
async function _parseNode(routerNode, node, routes, map, routesByPath) {
    const routeParentNode = routes.length > 0 ? routes[routes.length - 1] : null;
    const fragment = document.createDocumentFragment();
    const childNodes = Array.from(node.childNodes);
    for (const childNode of childNodes) {
        if (childNode.nodeType === Node.ELEMENT_NODE) {
            let appendNode = childNode;
            let element = childNode;
            const tagName = element.tagName.toLowerCase();
            if (tagName === config.tagNames.route) {
                const childFragment = document.createDocumentFragment();
                // Move child nodes to fragment to avoid duplication of
                for (const childNode of Array.from(element.childNodes)) {
                    childFragment.appendChild(childNode);
                }
                const cloneElement = document.importNode(element, true);
                customElements.upgrade(cloneElement);
                cloneElement.appendChild(childFragment);
                const route = cloneElement;
                route.initialize(routerNode, routeParentNode);
                _duplicateCheck(routesByPath, route);
                routes.push(route);
                map.set(route.uuid, route);
                appendNode = route.placeHolder;
                element = route;
            }
            else if (tagName === config.tagNames.layout) {
                const childFragment = document.createDocumentFragment();
                // Move child nodes to fragment to avoid duplication of
                for (const childNode of Array.from(element.childNodes)) {
                    childFragment.appendChild(childNode);
                }
                const cloneElement = document.importNode(element, true);
                customElements.upgrade(cloneElement);
                cloneElement.appendChild(childFragment);
                const layout = cloneElement;
                const layoutOutlet = createLayoutOutlet();
                layoutOutlet.layout = layout;
                appendNode = layoutOutlet;
                element = cloneElement;
            }
            const children = await _parseNode(routerNode, element, routes, map, routesByPath);
            element.innerHTML = "";
            element.appendChild(children);
            fragment.appendChild(appendNode);
        }
        else {
            fragment.appendChild(childNode);
        }
    }
    return fragment;
}
export async function parse(routerNode) {
    const map = new Map();
    const routesByPath = new Map();
    const fr = await _parseNode(routerNode, routerNode.template.content, [], map, routesByPath);
    return fr;
}
//# sourceMappingURL=parse.js.map