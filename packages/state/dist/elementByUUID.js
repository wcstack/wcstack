const elementByUUID = new Map();
export function getElementByUUID(uuid) {
    return elementByUUID.get(uuid) || null;
}
export function setElementByUUID(uuid, element) {
    if (element === null) {
        elementByUUID.delete(uuid);
    }
    else {
        elementByUUID.set(uuid, element);
    }
}
//# sourceMappingURL=elementByUUID.js.map