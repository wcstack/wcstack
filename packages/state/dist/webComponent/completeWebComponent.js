const completeByStateElementByWebComponent = new WeakMap();
export function markWebComponentAsComplete(webComponent, stateElement) {
    let completeByStateElement = completeByStateElementByWebComponent.get(webComponent);
    if (!completeByStateElement) {
        completeByStateElement = new WeakMap();
        completeByStateElementByWebComponent.set(webComponent, completeByStateElement);
    }
    completeByStateElement.set(stateElement, true);
}
export function isWebComponentComplete(webComponent, stateElement) {
    const completeByStateElement = completeByStateElementByWebComponent.get(webComponent);
    if (!completeByStateElement) {
        return false;
    }
    return completeByStateElement.get(stateElement) === true;
}
//# sourceMappingURL=completeWebComponent.js.map