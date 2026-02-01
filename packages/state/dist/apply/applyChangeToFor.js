import { getPathInfo } from "../address/PathInfo";
import { WILDCARD } from "../define";
import { getListIndexesByList } from "../list/listIndexesByList";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { createContent } from "../structural/createContent";
const lastValueByNode = new WeakMap();
const lastContentsByNode = new WeakMap();
export function applyChangeToFor(bindingInfo, _newValue) {
    const _lastValue = lastValueByNode.get(bindingInfo.node) ?? [];
    const newValue = Array.isArray(_newValue) ? _newValue : [];
    const listIndexes = getListIndexesByList(newValue) || [];
    const lastContents = lastContentsByNode.get(bindingInfo.node) || [];
    for (const content of lastContents) {
        content.unmount();
    }
    const newContents = [];
    let lastNode = bindingInfo.node;
    const listPathInfo = bindingInfo.statePathInfo;
    if (!listPathInfo) {
        raiseError(`List path info not found in fragment bind text result.`);
    }
    const elementPathInfo = getPathInfo(listPathInfo.path + '.' + WILDCARD);
    const stateName = bindingInfo.stateName;
    const stateElement = getStateElementByName(stateName);
    if (!stateElement) {
        raiseError(`State element with name "${stateName}" not found.`);
    }
    const loopContextStack = stateElement.loopContextStack;
    for (const index of listIndexes) {
        loopContextStack.createLoopContext(elementPathInfo, index, (loopContext) => {
            const content = createContent(bindingInfo, loopContext);
            content.mountAfter(lastNode);
            lastNode = content.lastNode || lastNode;
            newContents.push(content);
        });
    }
    lastContentsByNode.set(bindingInfo.node, newContents);
    lastValueByNode.set(bindingInfo.node, newValue);
}
//# sourceMappingURL=applyChangeToFor.js.map