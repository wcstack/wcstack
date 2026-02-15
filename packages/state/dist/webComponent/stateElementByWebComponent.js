const stateElementByWebComponent = new WeakMap();
export function setStateElementByWebComponent(webComponent, stateName, stateElement) {
    let stateMap = stateElementByWebComponent.get(webComponent);
    if (!stateMap) {
        stateMap = new Map();
        stateElementByWebComponent.set(webComponent, stateMap);
    }
    stateMap.set(stateName, stateElement);
}
export function getStateElementByWebComponent(webComponent, stateName) {
    const stateMap = stateElementByWebComponent.get(webComponent);
    if (!stateMap) {
        return null;
    }
    return stateMap.get(stateName) ?? null;
}
//# sourceMappingURL=stateElementByWebComponent.js.map