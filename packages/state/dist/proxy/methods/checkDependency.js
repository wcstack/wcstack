export function checkDependency(handler, address) {
    // 動的依存関係の登録
    if (handler.addressStackIndex >= 0) {
        const lastInfo = handler.lastAddressStack?.pathInfo ?? null;
        const stateElement = handler.stateElement;
        if (lastInfo !== null) {
            if (stateElement.getterPaths.has(lastInfo.path) &&
                lastInfo.path !== address.pathInfo.path) {
                stateElement.addDynamicDependency(lastInfo.path, address.pathInfo.path);
            }
        }
    }
}
//# sourceMappingURL=checkDependency.js.map