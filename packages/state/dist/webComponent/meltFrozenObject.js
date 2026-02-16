function cloneWithDescriptors(obj) {
    const proto = Object.getPrototypeOf(obj);
    const clone = Object.create(proto);
    Object.defineProperties(clone, Object.getOwnPropertyDescriptors(obj));
    return clone;
}
export function meltFrozenObject(frozenObj) {
    return cloneWithDescriptors(frozenObj);
}
//# sourceMappingURL=meltFrozenObject.js.map