function cloneWithDescriptors(obj) {
    const proto = Object.getPrototypeOf(obj);
    const clone = Object.create(proto);
    const descriptors = Object.getOwnPropertyDescriptors(obj);
    for (const key in descriptors) {
        const descriptor = descriptors[key];
        if (descriptor.writable === false) {
            descriptor.writable = true;
        }
    }
    Object.defineProperties(clone, descriptors);
    return clone;
}
export function meltFrozenObject(frozenObj) {
    return cloneWithDescriptors(frozenObj);
}
//# sourceMappingURL=meltFrozenObject.js.map