import { config } from "./config";
import { raiseError } from "./raiseError";
const stateElementByName = new Map();
export function getStateElementByName(name) {
    return stateElementByName.get(name) || null;
}
export function setStateElementByName(name, element) {
    if (element === null) {
        stateElementByName.delete(name);
        if (config.debug) {
            console.debug(`State element unregistered: name="${name}"`);
        }
    }
    else {
        if (stateElementByName.has(name)) {
            raiseError(`State element with name "${name}" is already registered.`);
        }
        stateElementByName.set(name, element);
        if (config.debug) {
            console.debug(`State element registered: name="${name}"`, element);
        }
    }
}
//# sourceMappingURL=stateElementByName.js.map