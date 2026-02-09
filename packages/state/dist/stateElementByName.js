const stateElementByName = new Map();
export function getStateElementByName(name) {
    return stateElementByName.get(name) || null;
}
export function setStateElementByName(name, element) {
    if (element === null) {
        stateElementByName.delete(name);
    }
    else {
        stateElementByName.set(name, element);
    }
}
//# sourceMappingURL=stateElementByName.js.map