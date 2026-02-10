import { config } from "./config";
import { raiseError } from "./raiseError";
const stateElementByNameByNode = new WeakMap();
export function getStateElementByName(rootNode, name) {
    let stateElementByName = stateElementByNameByNode.get(rootNode);
    if (!stateElementByName) {
        return null;
    }
    return stateElementByName.get(name) || null;
}
export function setStateElementByName(rootNode, name, element) {
    let stateElementByName = stateElementByNameByNode.get(rootNode);
    if (!stateElementByName) {
        stateElementByName = new Map();
        stateElementByNameByNode.set(rootNode, stateElementByName);
    }
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