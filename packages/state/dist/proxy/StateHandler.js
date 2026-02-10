import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { get as trapGet } from "./traps/get";
import { set as trapSet } from "./traps/set";
import { MAX_LOOP_DEPTH } from "../define";
class StateHandler {
    _stateElement;
    _stateName;
    _addressStack = Array(MAX_LOOP_DEPTH).fill(undefined);
    _addressStackIndex = -1;
    _loopContext;
    _mutability;
    constructor(rootNode, stateName, mutability) {
        this._stateName = stateName;
        const stateElement = getStateElementByName(rootNode, this._stateName);
        if (stateElement === null) {
            raiseError(`StateHandler: State element with name "${this._stateName}" not found.`);
        }
        this._stateElement = stateElement;
        this._mutability = mutability;
    }
    get stateName() {
        return this._stateName;
    }
    get stateElement() {
        return this._stateElement;
    }
    get lastAddressStack() {
        let address = undefined;
        if (this._addressStackIndex >= 0) {
            address = this._addressStack[this._addressStackIndex];
        }
        if (typeof address === "undefined") {
            raiseError(`Last address stack is undefined.`);
        }
        return address;
    }
    get addressStackLength() {
        return this._addressStackIndex + 1;
    }
    get loopContext() {
        return this._loopContext;
    }
    pushAddress(address) {
        this._addressStackIndex++;
        if (this._addressStackIndex >= MAX_LOOP_DEPTH) {
            raiseError(`Exceeded maximum address stack depth of ${MAX_LOOP_DEPTH}. Possible infinite loop.`);
        }
        this._addressStack[this._addressStackIndex] = address;
    }
    popAddress() {
        if (this._addressStackIndex < 0) {
            return null;
        }
        const address = this._addressStack[this._addressStackIndex];
        if (typeof address === "undefined") {
            raiseError(`Address stack at index ${this._addressStackIndex} is undefined.`);
        }
        this._addressStack[this._addressStackIndex] = undefined;
        this._addressStackIndex--;
        return address;
    }
    setLoopContext(loopContext) {
        this._loopContext = loopContext;
    }
    clearLoopContext() {
        this._loopContext = undefined;
    }
    get(target, prop, receiver) {
        return trapGet(target, prop, receiver, this);
    }
    set(target, prop, value, receiver) {
        if (this._mutability === "readonly") {
            raiseError(`State "${this._stateName}" is readonly.`);
        }
        return trapSet(target, prop, value, receiver, this);
    }
    has(target, prop) {
        return Reflect.has(target, prop);
        //    return Reflect.has(target, prop) || this.symbols.has(prop) || this.apis.has(prop);
    }
}
export function createStateProxy(rootNode, state, stateName, mutability) {
    const handler = new StateHandler(rootNode, stateName, mutability);
    const stateProxy = new Proxy(state, handler);
    return stateProxy;
}
export const __private__ = {
    StateHandler,
};
//# sourceMappingURL=StateHandler.js.map