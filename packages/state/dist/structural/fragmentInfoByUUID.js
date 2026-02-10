import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
const fragmentInfoByUUID = new Map();
export function setFragmentInfoByUUID(uuid, rootNode, fragmentInfo) {
    if (fragmentInfo === null) {
        fragmentInfoByUUID.delete(uuid);
    }
    else {
        fragmentInfoByUUID.set(uuid, fragmentInfo);
        const bindingPartial = fragmentInfo.parseBindTextResult;
        const stateElement = getStateElementByName(rootNode, bindingPartial.stateName);
        if (stateElement === null) {
            raiseError(`State element with name "${bindingPartial.stateName}" not found for fragment info.`);
        }
        stateElement.setPathInfo(bindingPartial.statePathName, bindingPartial.bindingType);
        for (const nodeInfo of fragmentInfo.nodeInfos) {
            for (const nodeBindingPartial of nodeInfo.parseBindTextResults) {
                const nodeStateElement = getStateElementByName(rootNode, nodeBindingPartial.stateName);
                if (nodeStateElement === null) {
                    raiseError(`State element with name "${nodeBindingPartial.stateName}" not found for fragment info node.`);
                }
                nodeStateElement.setPathInfo(nodeBindingPartial.statePathName, nodeBindingPartial.bindingType);
            }
        }
    }
}
export function getFragmentInfoByUUID(uuid) {
    return fragmentInfoByUUID.get(uuid) || null;
}
//# sourceMappingURL=fragmentInfoByUUID.js.map