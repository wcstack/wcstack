import { getPathInfo } from "../address/PathInfo";
import { getBindingsByContent } from "../bindings/bindingsByContent";
import { WILDCARD } from "../define";
import { createListDiff } from "../list/createListDiff";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { getListIndexesByList } from "../list/listIndexesByList";
import { setLoopContextByNode } from "../list/loopContextByNode";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { createContent } from "../structural/createContent";
import { applyChange } from "./applyChange";
const lastValueByNode = new WeakMap();
const contentByListIndex = new WeakMap();
const pooledContentsByNode = new WeakMap();
// テスト用ヘルパー（内部状態の操作）
export function __test_setContentByListIndex(index, content) {
    if (content === null) {
        contentByListIndex.delete(index);
    }
    else {
        contentByListIndex.set(index, content);
    }
}
function getPooledContents(bindingInfo) {
    return pooledContentsByNode.get(bindingInfo.node) || [];
}
function setPooledContent(bindingInfo, content) {
    const contents = pooledContentsByNode.get(bindingInfo.node);
    if (typeof contents === 'undefined') {
        pooledContentsByNode.set(bindingInfo.node, [content]);
    }
    else {
        contents.push(content);
    }
}
export function applyChangeToFor(bindingInfo, _newValue, state, stateName) {
    const listPathInfo = bindingInfo.statePathInfo;
    if (!listPathInfo) {
        raiseError(`List path info not found in fragment bind text result.`);
    }
    const listIndex = getListIndexByBindingInfo(bindingInfo);
    const lastValue = lastValueByNode.get(bindingInfo.node);
    const lastIndexes = getListIndexesByList(lastValue) || [];
    const diff = createListDiff(listIndex, lastValue, _newValue, lastIndexes);
    for (const deleteIndex of diff.deleteIndexSet) {
        const content = contentByListIndex.get(deleteIndex);
        if (typeof content !== 'undefined') {
            content.unmount();
            setPooledContent(bindingInfo, content);
        }
    }
    let lastNode = bindingInfo.node;
    const elementPathInfo = getPathInfo(listPathInfo.path + '.' + WILDCARD);
    const stateElement = getStateElementByName(stateName);
    if (!stateElement) {
        raiseError(`State element with name "${stateName}" not found.`);
    }
    const loopContextStack = stateElement.loopContextStack;
    for (const index of diff.newIndexes) {
        let content;
        // add
        if (diff.addIndexSet.has(index)) {
            loopContextStack.createLoopContext(elementPathInfo, index, (loopContext) => {
                const pooledContents = getPooledContents(bindingInfo);
                content = pooledContents.pop();
                if (typeof content === 'undefined') {
                    content = createContent(bindingInfo, loopContext);
                }
                else {
                    const bindings = getBindingsByContent(content);
                    const nodeSet = new Set();
                    for (const bindingInfo of bindings) {
                        if (!nodeSet.has(bindingInfo.node)) {
                            nodeSet.add(bindingInfo.node);
                            setLoopContextByNode(bindingInfo.node, loopContext);
                            applyChange(bindingInfo, state, stateName);
                        }
                    }
                }
            });
        }
        else {
            content = contentByListIndex.get(index);
            if (diff.changeIndexSet.has(index)) {
                // change
                const bindings = getBindingsByContent(content);
                for (const bindingInfo of bindings) {
                    applyChange(bindingInfo, state, stateName);
                }
            }
        }
        // Update lastNode for next iteration to ensure correct order
        // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
        if (lastNode.nextSibling !== content.firstNode) {
            content.mountAfter(lastNode);
        }
        lastNode = content.lastNode || lastNode;
        contentByListIndex.set(index, content);
    }
    lastValueByNode.set(bindingInfo.node, _newValue);
}
//# sourceMappingURL=applyChangeToFor.js.map