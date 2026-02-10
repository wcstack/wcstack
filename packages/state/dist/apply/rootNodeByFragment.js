const rootNodeByFragment = new WeakMap();
export function setRootNodeByFragment(fragment, rootNode) {
    if (rootNode === null) {
        rootNodeByFragment.delete(fragment);
    }
    else {
        rootNodeByFragment.set(fragment, rootNode);
    }
}
export function getRootNodeByFragment(fragment) {
    return rootNodeByFragment.get(fragment) || null;
}
//# sourceMappingURL=rootNodeByFragment.js.map