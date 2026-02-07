import { getPathInfo } from "../address/PathInfo";
import { getIndexBindingsByContent } from "../bindings/indexBindingsByContent";
import { WILDCARD } from "../define";
import { createListDiff } from "../list/createListDiff";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { activateContent, deactivateContent } from "../structural/activateContent";
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
export function applyChangeToFor(bindingInfo, context, newValue) {
    const listPathInfo = bindingInfo.statePathInfo;
    const listIndex = getListIndexByBindingInfo(bindingInfo);
    const lastValue = lastValueByNode.get(bindingInfo.node);
    const diff = createListDiff(listIndex, lastValue, newValue);
    for (const deleteIndex of diff.deleteIndexSet) {
        const content = contentByListIndex.get(deleteIndex);
        if (typeof content !== 'undefined') {
            content.unmount();
            deactivateContent(content);
            setPooledContent(bindingInfo, content);
        }
    }
    let lastNode = bindingInfo.node;
    const elementPathInfo = getPathInfo(listPathInfo.path + '.' + WILDCARD);
    const loopContextStack = context.stateElement.loopContextStack;
    for (const index of diff.newIndexes) {
        let content;
        // add
        if (diff.addIndexSet.has(index)) {
            loopContextStack.createLoopContext(elementPathInfo, index, (loopContext) => {
                const pooledContents = getPooledContents(bindingInfo);
                content = pooledContents.pop();
                if (typeof content === 'undefined') {
                    content = createContent(bindingInfo);
                }
                activateContent(content, loopContext, context);
            });
        }
        else {
            content = contentByListIndex.get(index);
            if (diff.changeIndexSet.has(index)) {
                // change
                const indexBindings = getIndexBindingsByContent(content);
                for (const indexBinding of indexBindings) {
                    applyChange(indexBinding, context);
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
    lastValueByNode.set(bindingInfo.node, newValue);
}
//# sourceMappingURL=applyChangeToFor.js.map