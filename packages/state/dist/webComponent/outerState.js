import { bindSymbol } from "./symbols";
const getterFn = (_innerStateElement, _innerName) => () => {
    /*
      let value = undefined;
      innerStateElement.createState("readonly", (state) => {
        value = state[innerName];
      });
      return value;
    */
    return undefined; // 暫定的に常に更新を発生させる
};
const setterFn = (innerStateElement, innerName) => (_v) => {
    innerStateElement.createState("readonly", (state) => {
        state.$postUpdate(innerName);
    });
};
class OuterState {
    constructor() {
    }
    [bindSymbol](innerStateElement, binding) {
        const innerName = binding.propSegments.slice(1).join('.');
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