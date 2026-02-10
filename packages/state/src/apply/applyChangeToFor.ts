import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { getIndexBindingsByContent } from "../bindings/indexBindingsByContent";
import { WILDCARD } from "../define";
import { createListDiff } from "../list/createListDiff";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { IListIndex } from "../list/types";
import { raiseError } from "../raiseError";
import { activateContent, deactivateContent } from "../structural/activateContent";
import { createContent } from "../structural/createContent";
import { IContent } from "../structural/types";
import { IBindingInfo } from "../types";
import { applyChange } from "./applyChange";
import { setRootNodeByFragment } from "./rootNodeByFragment";
import { IApplyContext } from "./types";

const lastValueByNode = new WeakMap<Node, any>();
const lastNodeByNode = new WeakMap<Node, Node>();
const contentByListIndex = new WeakMap<IListIndex, IContent>();
const pooledContentsByNode = new WeakMap<Node, IContent[]>();
const isOnlyNodeInParentContentByNode = new WeakMap<Node, boolean>();

// テスト用ヘルパー（内部状態の操作）
export function __test_setContentByListIndex(index: IListIndex, content: IContent | null): void {
  if (content === null) {
    contentByListIndex.delete(index);
  } else {
    contentByListIndex.set(index, content);
  }
}

export function __test_deleteLastNodeByNode(node: Node): void {
  lastNodeByNode.delete(node);
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

function isOnlyNodeInParentContent(firstNode: Node, lastNode: Node): boolean {
  let prevCheckNode = firstNode.previousSibling;
  let nextCheckNode = lastNode.nextSibling;
  let onlyNode = true;
  while(prevCheckNode !== null) {
    if (prevCheckNode.nodeType === Node.ELEMENT_NODE 
      || (prevCheckNode.nodeType === Node.TEXT_NODE && (prevCheckNode.textContent?.trim() ?? '') !== '')) {
      onlyNode = false;
      break;
    }
    prevCheckNode = prevCheckNode.previousSibling;
  }
  while(nextCheckNode !== null) {
    if (nextCheckNode.nodeType === Node.ELEMENT_NODE 
      || (nextCheckNode.nodeType === Node.TEXT_NODE && (nextCheckNode.textContent?.trim() ?? '') !== '')) {
      onlyNode = false;
      break;
    }
    nextCheckNode = nextCheckNode.nextSibling;
  }
  return onlyNode;
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

  if (Array.isArray(lastValue) 
    && lastValue.length === diff.deleteIndexSet.size 
    && diff.deleteIndexSet.size > 0
    && bindingInfo.node.parentNode !== null
  ) {
    let isOnlyNode = isOnlyNodeInParentContentByNode.get(bindingInfo.node);
    if (typeof isOnlyNode === 'undefined') {
      const lastNode = lastNodeByNode.get(bindingInfo.node) || bindingInfo.node;
      isOnlyNode = isOnlyNodeInParentContent(bindingInfo.node, lastNode);
      isOnlyNodeInParentContentByNode.set(bindingInfo.node, isOnlyNode);
    }
    if (isOnlyNode) {
      const parentNode = bindingInfo.node.parentNode;
      parentNode.textContent = '';
      parentNode.appendChild(bindingInfo.node);
    }
  }
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
  let fragment: DocumentFragment | null = null;
  if (diff.newIndexes.length == diff.addIndexSet.size 
    && diff.newIndexes.length > 0
    && lastNode.isConnected
  ) {
    // 全部追加の場合はまとめて処理
    fragment = document.createDocumentFragment();
    setRootNodeByFragment(fragment, context.rootNode);
  }
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
        // コンテント活性化の前にDOMツリーに追加しておく必要がある
        if (fragment !== null) {
          content.appendTo(fragment);
        } else {
          // Update lastNode for next iteration to ensure correct order
          // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
          if (lastNode.nextSibling !== content.firstNode) {
            content.mountAfter(lastNode);
          }
        }
        // コンテントを活性化
        activateContent(content, loopContext, context);
      });
      if (typeof content === 'undefined') {
        raiseError(`Content not found for ListIndex: ${index.index} at path "${listPathInfo.path}"`);
      }
    } else {
      content = contentByListIndex.get(index)!;
      if (diff.changeIndexSet.has(index)) {
        // change
        const indexBindings = getIndexBindingsByContent(content);
        for(const indexBinding of indexBindings) {
          applyChange(indexBinding, context);
        }
      }
      // Update lastNode for next iteration to ensure correct order
      // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
      if (typeof content === 'undefined') {
        raiseError(`Content not found for ListIndex: ${index.index} at path "${listPathInfo.path}"`);
      }
      if (lastNode.nextSibling !== content.firstNode) {
        content.mountAfter(lastNode);
      }
    }
    lastNode = content.lastNode || lastNode;
    contentByListIndex.set(index, content);
  }
  lastNodeByNode.set(bindingInfo.node, lastNode);
  if (fragment !== null) {
    // Mount all at once
    bindingInfo.node.parentNode!.insertBefore(fragment, bindingInfo.node.nextSibling);
    setRootNodeByFragment(fragment, null);
  }
  lastValueByNode.set(bindingInfo.node, newValue);
}
