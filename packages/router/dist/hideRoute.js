export function hideRoute(route) {
    route.clearParams();
    for (const node of route.childNodeArray) {
        node.parentNode?.removeChild(node);
    }
}
//# sourceMappingURL=hideRoute.js.map