import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { get as trapGet } from "./traps/get";
import { set as trapSet } from "./traps/set";
import { createUpdater } from "../updater/updater";
class StateHandler {
    _stateElement;
    _stateName;
    _addressStack = [];
    _addressStackIndex = -1;
    _updater;
    _loopContext;
    constructor(stateName) {
        this._stateName = stateName;
        const stateElement = getStateElementByName(this._stateName);
        if (stateElement === null) {
            raiseError(`StateHandler: State element with name "${this._stateName}" not found.`);
        }
        this._stateElement = stateElement;
    }
    get stateName() {
        return this._stateName;
    }
    get stateElement() {
        return this._stateElement;
    }
    get lastAddressStack() {
        if (this._addressStackIndex >= 0) {
            return this._addressStack[this._addressStackIndex];
        }
        else {
            return null;
        }
    }
    get addressStack() {
        return this._addressStack;
    }
    get addressStackIndex() {
        return this._addressStackIndex;
    }
    get updater() {
        if (typeof this._updater === "undefined") {
            raiseError(`StateHandler: updater is not set yet.`);
        }
        return this._updater;
    }
    set updater(value) {
        this._updater = value;
    }
    get loopContext() {
        return this._loopContext;
    }
    pushAddress(address) {
        this._addressStackIndex++;
        if (this._addressStackIndex >= this._addressStack.length) {
            this._addressStack.push(address);
        }
        else {
            this._addressStack[this._addressStackIndex] = address;
        }
    }
    popAddress() {
        if (this._addressStackIndex < 0) {
            return null;
        }
        const address = this._addressStack[this._addressStackIndex];
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
        return trapSet(target, prop, value, receiver, this);
    }
    has(target, prop) {
        return Reflect.has(target, prop);
        //    return Reflect.has(target, prop) || this.symbols.has(prop) || this.apis.has(prop);
    }
}
export function createStateProxy(state, stateName) {
    const handler = new StateHandler(stateName);
    const stateProxy = new Proxy(state, handler);
    handler.updater = createUpdater(stateName, stateProxy, handler.stateElement.nextVersion());
    return stateProxy;
}
//# sourceMappingURL=StateHandler.js.map