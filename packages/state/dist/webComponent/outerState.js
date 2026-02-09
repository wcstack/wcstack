const getterFn = (innerStateElement, innerName) => () => {
    /*
      let value = undefined;
      innerStateElement.createState("readonly", (state) => {
        value = state[innerName];
      });
      return value;
    */
    return undefined; // 暫定的に常に更新を発生させる
};
const setterFn = (innerStateElement, innerName) => (v) => {
    innerStateElement.createState("readonly", (state) => {
        state.$postUpdate(innerName);
    });
};
class OuterState {
    constructor() {
    }
    $$bindName(innerStateElement, innerName) {
        Object.defineProperty(this, innerName, {
            get: getterFn(innerStateElement, innerName),
            set: setterFn(innerStateElement, innerName),
            enumerable: true,
            configurable: true,
        });
    }
}
export function createOuterState() {
    return new OuterState();
}
//# sourceMappingURL=outerState.js.map