const stateElementByWebComponent = new WeakMap();
export function setStateElementByWebComponent(webComponent, stateElement) {
    stateElementByWebComponent.set(webComponent, stateElement);
}
export function getStateElementByWebComponent(webComponent) {
    return stateElementByWebComponent.get(webComponent) ?? null;
}
//# sourceMappingURL=stateElementByWebComponent.js.map