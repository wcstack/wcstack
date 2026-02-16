const bindingPromiseByNode = new WeakMap();
let id = 0;
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
        id: ++id,
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