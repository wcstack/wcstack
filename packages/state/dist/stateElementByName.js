import { buildBindings } from "./buildBindings";
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
    if (element === null) {
        // 削除の場合、Mapが存在しない場合は何もしない
        if (!stateElementByName) {
            return;
        }
        stateElementByName.delete(name);
        if (stateElementByName.size === 0) {
            stateElementByNameByNode.delete(rootNode);
        }
        if (config.debug) {
            console.debug(`State element unregistered: name="${name}"`);
        }
    }
    else {
        // 登録の場合
        if (!stateElementByName) {
            stateElementByName = new Map();
            stateElementByNameByNode.set(rootNode, stateElementByName);
            // 初めてルートノードに登録する場合
            if (rootNode.constructor.name === 'HTMLDocument' || rootNode.constructor.name === 'Document') {
                queueMicrotask(() => {
                    buildBindings(rootNode);
                });
            }
            else if (rootNode.constructor.name === 'ShadowRoot') {
                queueMicrotask(() => {
                    buildBindings(rootNode);
                });
            }
        }
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