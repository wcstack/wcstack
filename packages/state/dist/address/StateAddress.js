class StateAddress {
    pathInfo;
    listIndex;
    constructor(pathInfo, listIndex) {
        this.pathInfo = pathInfo;
        this.listIndex = listIndex;
    }
}
export function createStateAddress(pathInfo, listIndex) {
    return new StateAddress(pathInfo, listIndex);
}
//# sourceMappingURL=StateAddress.js.map