import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { getIndexBindingsByContent } from "../bindings/indexBindingsByContent";
import { WILDCARD } from "../define";
import { createListDiff } from "../list/createListDiff";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { IListIndex } from "../list/types";
import { activateContent, deactivateContent } from "../structural/activateContent";
import { createContent } from "../structural/createContent";
import { IContent } from "../structural/types";
import { IBindingInfo } from "../types";
import { applyChange } from "./applyChange";
import { IApplyContext } from "./types";

const lastValueByNode = new WeakMap<Node, any>();
const contentByListIndex = new WeakMap<IListIndex, IContent>();
const pooledContentsByNode = new WeakMap<Node, IContent[]>();

// テスト用ヘルパー（内部状態の操作）
export function __test_setContentByListIndex(index: IListIndex, content: IContent | null): void {
  if (content === null) {
    contentByListIndex.delete(index);
  } else {
    contentByListIndex.set(index, content);
  }
}

function getPooledContents(bindingInfo: IBindingInfo): IContent[] {
  return pooledContentsByNode.get(bindingInfo.node) || [];
}

function setPooledContent(bindingInfo: IBindingInfo, content: IContent): void {
  const contents = pooledContentsByNode.get(bindingInfo.node);
  if (typeof contents === 'undefined') {
    pooledContentsByNode.set(bindingInfo.node, [content]);
  } else {
    contents.push(content);
  }
}

export function applyChangeToFor(
  bindingInfo: IBindingInfo, 
  context: IApplyContext,
  newValue: unknown, 
): void {
  const listPathInfo = bindingInfo.statePathInfo;
  const listIndex = getListIndexByBindingInfo(bindingInfo);
  const lastValue = lastValueByNode.get(bindingInfo.node);
  const diff = createListDiff(listIndex, lastValue, newValue);

  for(const deleteIndex of diff.deleteIndexSet) {
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
  for(const index of diff.newIndexes) {
    let content: IContent | undefined;
    // add
    if (diff.addIndexSet.has(index)) {
      const stateAddress = createStateAddress(elementPathInfo, index);
      loopContextStack.createLoopContext(stateAddress, (loopContext) => {
        const pooledContents = getPooledContents(bindingInfo);
        content = pooledContents.pop();
        if (typeof content === 'undefined') {
          content = createContent(bindingInfo);
        }
        activateContent(content, loopContext, context);
      });
    } else {
      content = contentByListIndex.get(index)!;
      if (diff.changeIndexSet.has(index)) {
        // change
        const indexBindings = getIndexBindingsByContent(content);
        for(const indexBinding of indexBindings) {
          applyChange(indexBinding, context);
        }
      }

    }
    // Update lastNode for next iteration to ensure correct order
    // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
    if (lastNode.nextSibling !== content!.firstNode) {
      content!.mountAfter(lastNode);
    }
    lastNode = content!.lastNode || lastNode;
    contentByListIndex.set(index, content!);
  }
  lastValueByNode.set(bindingInfo.node, newValue);
}
