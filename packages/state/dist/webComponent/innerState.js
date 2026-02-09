const getterFn = (outerStateElement, outerName) => () => {
    let value = undefined;
    outerStateElement.createState("readonly", (state) => {
        value = state[outerName];
    });
    return value;
};
const setterFn = (outerStateElement, outerName) => (v) => {
    outerStateElement.createState("writable", (state) => {
        state[outerName] = v;
    });
};
class InnerState {
    constructor() {
    }
    $$bindName(outerStateElement, innerName, outerName) {
        Object.defineProperty(this, innerName, {
            get: getterFn(outerStateElement, outerName),
            set: setterFn(outerStateElement, outerName),
            enumerable: true,
            configurable: true,
        });
    }
}
export function createInnerState() {
    return new InnerState();
}
//# sourceMappingURL=innerState.js.map