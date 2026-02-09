const bindingPromiseByNode = new WeakMap();
export function getInitializeBindingPromiseByNode(node) {
    let bindingPromise = bindingPromiseByNode.get(node) || null;
    if (bindingPromise !== null) {
        return bindingPromise;
    }
    let resolveFn = undefined;
    const promise = new Promise((resolve) => {
        resolveFn = resolve;
    });
    bindingPromise = {
        promise,
        resolve: resolveFn
    };
    bindingPromiseByNode.set(node, bindingPromise);
    return bindingPromise;
}
export async function waitInitializeBinding(node) {
    const bindingPromise = getInitializeBindingPromiseByNode(node);
    await bindingPromise.promise;
}
export function resolveInitializedBinding(node) {
    const bindingPromise = getInitializeBindingPromiseByNode(node);
    bindingPromise.resolve();
}
//# sourceMappingURL=initializeBindingPromiseByNode.js.map