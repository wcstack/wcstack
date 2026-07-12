import { getPathInfo } from "../address/PathInfo";
import { createStateAddress } from "../address/StateAddress";
import { getAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding";
import { getIndexBindingsByContent } from "../bindings/indexBindingsByContent";
import { inSsr } from "../config";
import { WILDCARD } from "../define";
import { createListDiff } from "../list/createListDiff";
import { getListIndexByBindingInfo } from "../list/getListIndexByBindingInfo";
import { getLastListValueByAbsoluteStateAddress } from "../list/lastListValueByAbsoluteStateAddress";
import { computeStableIndexSet } from "../list/stableListOrder";
import { IListIndex } from "../list/types";
import { raiseError } from "../raiseError";
import { activateContent, deactivateContent } from "../structural/activateContent";
import { deleteContentByNode } from "../structural/contentsByNode";
import { createContent } from "../structural/createContent";
import { IContent } from "../structural/types";
import { IBindingInfo } from "../types";
import { applyChange } from "./applyChange";
import { setRootNodeByFragment } from "./rootNodeByFragment";
import { IApplyContext } from "./types";

const lastNodeByNode: WeakMap<Node, Node> = new WeakMap();
const contentByListIndexByNode: WeakMap<Node, WeakMap<IListIndex, IContent>> = new WeakMap();
const pooledContentsByNode: WeakMap<Node, IContent[]> = new WeakMap();
const isOnlyNodeInParentContentByNode: WeakMap<Node, boolean> = new WeakMap();

// テスト用ヘルパー（内部状態の操作）
export function __test_setContentByListIndex(node: Node, index: IListIndex, content: IContent | null): void {
  setContent(node, index, content);
}

export function __test_deleteLastNodeByNode(node: Node): void {
  lastNodeByNode.delete(node);
}

// SSR ハイドレーション用: Content を ListIndex に登録する
export function hydrateSetContent(node: Node, index: IListIndex, content: IContent): void {
  setContent(node, index, content);
}

export function hydrateSetLastNode(node: Node, lastNode: Node): void {
  lastNodeByNode.set(node, lastNode);
}

export function __test_deleteContentByNode(node: Node): void {
  contentByListIndexByNode.delete(node);
}

function getPooledContents(bindingInfo: IBindingInfo): IContent[] {
  return pooledContentsByNode.get(bindingInfo.node) || [];
}

// プールの上限（アンカーごと）。プールはアンカー（文書に永続するコメントノード）
// から content とその DOM サブツリー・バインディング群を強参照するため、無制限だと
// 大きなリストのクリア後もメモリが解放されない（10k 行で 10MB 級）。上限超過分は
// contentSetByNode の台帳からも外して GC 可能にする。再追加時は createContent で
// 作り直すコストと引き換えになる。
const MAX_POOLED_CONTENTS = 1000;
let maxPooledContents = MAX_POOLED_CONTENTS;

// テスト用: プール上限の変更と現在のプールサイズ取得
export function __test_setMaxPooledContents(limit: number): number {
  const prev = maxPooledContents;
  maxPooledContents = limit;
  return prev;
}

export function __test_getPooledContentsCount(node: Node): number {
  return (pooledContentsByNode.get(node) || []).length;
}

function setPooledContent(bindingInfo: IBindingInfo, content: IContent): void {
  let contents = pooledContentsByNode.get(bindingInfo.node);
  if (typeof contents === 'undefined') {
    contents = [];
    pooledContentsByNode.set(bindingInfo.node, contents);
  }
  if (contents.length < maxPooledContents) {
    contents.push(content);
  } else {
    // 上限超過: content を完全に手放す。contentSetByNode は createContent 時に
    // 追加されたきり解放経路が無いため、ここで外さないと GC できない。
    deleteContentByNode(bindingInfo.node, content);
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

// A stable content may be left in place only when its first node verifiably
// follows the settled walk position in the same tree: the listIndexes ledger
// can lag the physical DOM (element-write swaps reorder listIndexes without
// moving nodes; hidden regions unmount contents that stay registered). Empty
// contents (null firstNode) always take the settle walk so their mount
// bookkeeping matches the pre-LIS behavior.
function isPhysicallyAfter(lastNode: Node, firstNode: Node | null): boolean {
  if (firstNode === null) {
    return false;
  }
  if (lastNode.nextSibling === firstNode) {
    return true;
  }
  const position = lastNode.compareDocumentPosition(firstNode);
  return (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    && (position & Node.DOCUMENT_POSITION_DISCONNECTED) === 0;
}

function getContent(node: Node, listIndex: IListIndex): IContent | null {
  let contentByListIndex = contentByListIndexByNode.get(node);
  if (typeof contentByListIndex === 'undefined') {
    return null;
  }
  const content = contentByListIndex.get(listIndex);
  return typeof content === 'undefined' ? null : content;
}

function setContent(node: Node, listIndex: IListIndex, content: IContent | null): void {
  let contentByListIndex = contentByListIndexByNode.get(node);
  if (typeof contentByListIndex === 'undefined') {
    if (content === null) {
      return;
    }
    contentByListIndex = new WeakMap<IListIndex, IContent>();
    contentByListIndexByNode.set(node, contentByListIndex);
  }
  if (content === null) {
    contentByListIndex.delete(listIndex);
  } else {
    contentByListIndex.set(listIndex, content);
  }
}

export function applyChangeToFor(
  bindingInfo: IBindingInfo, 
  context: IApplyContext,
  newValue: unknown, 
): void {
  const listPathInfo = bindingInfo.statePathInfo;
  const listIndex = getListIndexByBindingInfo(bindingInfo);
  const absAddress = getAbsoluteStateAddressByBinding(bindingInfo);
  const lastValue  = getLastListValueByAbsoluteStateAddress(absAddress);
  const diff = createListDiff(listIndex, lastValue, newValue);
  context.newListValueByAbsAddress.set(absAddress, Array.isArray(newValue) ? newValue : []);

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
    const content = getContent(bindingInfo.node, deleteIndex);
    if (content !== null) {
      deactivateContent(content);
      content.unmount();
      setPooledContent(bindingInfo, content);
      setContent(bindingInfo.node, deleteIndex, null);
    }
  }

  let lastNode = bindingInfo.node;
  const elementPathInfo = getPathInfo(listPathInfo.path + '.' + WILDCARD);
  const loopContextStack = context.stateElement.loopContextStack;
  // When the new order contains inversions, contents in the stable set (an LIS
  // of old positions) keep their relative order and must not be moved; moving
  // only the rest avoids the cascade where one swap relocates every row in
  // between. null = no inversions; the position guard below then does no moves.
  const stableIndexSet = computeStableIndexSet(diff);
  let fragment: DocumentFragment | null = null;
  if (diff.newIndexes.length == diff.addIndexSet.size 
    && diff.newIndexes.length > 0
    && lastNode.isConnected
  ) {
    // 全部追加の場合はまとめて処理
    fragment = document.createDocumentFragment();
    setRootNodeByFragment(fragment, context.rootNode);
  }
  const ssrMode = inSsr();
  const uuid = bindingInfo.uuid ?? '';
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
          if (ssrMode) {
            fragment.appendChild(document.createComment(`@@wcs-for-start:${uuid}:${listPathInfo.path}:${index.index}`));
          }
          content.appendTo(fragment);
          if (ssrMode) {
            fragment.appendChild(document.createComment(`@@wcs-for-end:${uuid}:${listPathInfo.path}:${index.index}`));
          }
        } else {
          // Update lastNode for next iteration to ensure correct order
          // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
          if (lastNode.nextSibling !== content.firstNode) {
            if (ssrMode) {
              const startComment = document.createComment(`@@wcs-for-start:${uuid}:${listPathInfo.path}:${index.index}`);
              lastNode.parentNode!.insertBefore(startComment, lastNode.nextSibling);
              lastNode = startComment;
            }
            content.mountAfter(lastNode);
          }
          if (ssrMode) {
            const endComment = document.createComment(`@@wcs-for-end:${uuid}:${listPathInfo.path}:${index.index}`);
            const afterNode = content.lastNode ?? lastNode;
            afterNode.parentNode!.insertBefore(endComment, afterNode.nextSibling);
          }
        }
        // コンテントを活性化
        activateContent(content, loopContext, context);
      });
      if (typeof content === 'undefined') {
        raiseError(`Content not found for ListIndex: ${index.index} at path "${listPathInfo.path}"`);
      }
    } else {
      content = getContent(bindingInfo.node, index)!;
      if (diff.changeIndexSet.has(index)) {
        // change
        const indexBindings = getIndexBindingsByContent(content);
        for(const indexBinding of indexBindings) {
          applyChange(indexBinding, context);
        }
      }
      // Update lastNode for next iteration to ensure correct order
      // Ensure content is in correct position (e.g. if previous siblings were deleted/moved)
      if (content === null) {
        raiseError(`Content not found for ListIndex: ${index.index} at path "${listPathInfo.path}"`);
      }
      // Stable contents are already in correct relative order — but only
      // trust that after physical verification (see isPhysicallyAfter).
      // Contents out of order (and everything unverifiable) settle via the
      // self-healing mountAfter walk below.
      const stable = stableIndexSet !== null && stableIndexSet.has(index)
        && isPhysicallyAfter(lastNode, content.firstNode);
      if (!stable && lastNode.nextSibling !== content.firstNode) {
        content.mountAfter(lastNode);
      }
    }
    lastNode = content.lastNode || lastNode;
    setContent(bindingInfo.node, index, content);
  }
  lastNodeByNode.set(bindingInfo.node, lastNode);
  if (fragment !== null) {
    // Mount all at once
    bindingInfo.node.parentNode!.insertBefore(fragment, bindingInfo.node.nextSibling);
    setRootNodeByFragment(fragment, null);
  }
}
