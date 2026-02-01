import { getPathInfo } from "../address/PathInfo";
import { getBindingsByContent } from "../bindings/bindingsByContent";
import { WILDCARD } from "../define";
import { getListDiff } from "../list/createListIndexes";
import { getListIndexesByList } from "../list/listIndexesByList";
import { setLoopContextByNode } from "../list/loopContextByNode";
import { IListIndex } from "../list/types";
import { raiseError } from "../raiseError";
import { getStateElementByName } from "../stateElementByName";
import { createContent } from "../structural/createContent";
import { IContent } from "../structural/types";
import { IBindingInfo } from "../types";
import { applyChangeFromBindings } from "./applyChangeFromBindings";

const lastValueByNode = new WeakMap<Node, any>();
//const lastContentsByNode = new WeakMap<Node, IContent[]>();
const contentByListIndex = new WeakMap<IListIndex, IContent>();
const pooledContentsByNode = new WeakMap<Node, IContent[]>();

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

export function applyChangeToFor(bindingInfo: IBindingInfo, _newValue: any): void {
  const lastValue = lastValueByNode.get(bindingInfo.node);
  const diff = getListDiff(lastValue, _newValue);
  if (diff === null) {
    raiseError(`Failed to get list diff for binding.`);
  }
//  const newValue = Array.isArray(_newValue) ? _newValue : [];
//  const listIndexes = getListIndexesByList(newValue) || [];

//  const lastContents = lastContentsByNode.get(bindingInfo.node) || [];
  for(const deleteIndex of diff.deleteIndexSet) {
    const content = contentByListIndex.get(deleteIndex);
    if (typeof content === 'undefined') {
      raiseError(`Content not found for deleted list index.`);
    }
    content.unmount();
    setPooledContent(bindingInfo, content);
  }

  const newContents: IContent[] = [];
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
  for(const index of diff.newIndexes) {
    let content: IContent | undefined;
    // add
    if (diff.addIndexSet.has(index)) {
      loopContextStack.createLoopContext(elementPathInfo, index, (loopContext) => {
        const pooledContents = getPooledContents(bindingInfo);
        content = pooledContents.pop();
        if (typeof content === 'undefined') {
          content = createContent(bindingInfo, loopContext);
        } else {
          const bindings = getBindingsByContent(content);
          const nodeSet = new Set<Node>();
          for(const bindingInfo of bindings) {
            if (!nodeSet.has(bindingInfo.node)) {
              nodeSet.add(bindingInfo.node);
              setLoopContextByNode(bindingInfo.node, loopContext);
            }
          }
          applyChangeFromBindings(bindings);
        }
        content.mountAfter(lastNode);
      });
    } else {
      content = contentByListIndex.get(index);
      if (typeof content === 'undefined') {
        raiseError(`Content not found for changed list index.`);
      }
      if (diff.changeIndexSet.has(index)) {
        // change
        applyChangeFromBindings(getBindingsByContent(content));
        content.mountAfter(lastNode);
      }

    }
    // Update lastNode for next iteration to ensure correct order
    if (content) {
      // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
      if (lastNode.nextSibling !== content.firstNode) {
        content.mountAfter(lastNode);
      }
      lastNode = content.lastNode || lastNode;
    }
    contentByListIndex.set(index, content!);
//    newContents.push(content!);
  }
//  lastContentsByNode.set(bindingInfo.node, newContents);
  lastValueByNode.set(bindingInfo.node, _newValue);
}
