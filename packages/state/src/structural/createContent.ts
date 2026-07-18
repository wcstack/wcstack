import { clearAbsoluteStateAddressByBinding } from "../binding/getAbsoluteStateAddressByBinding.js";
import { clearStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo.js";
import { getBindingsByContent, setBindingsByContent } from "../bindings/bindingsByContent.js";
import { getBindingSessionByContent, setBindingSessionByContent } from "../bindings/bindingSessionByContent.js";
import { setIndexBindingsByContent } from "../bindings/indexBindingsByContent.js";
import { initializeBindingsByFragment } from "../bindings/initializeBindings.js";
import { setNodesByContent } from "../bindings/nodesByContent.js";
import { markObserverSkipOnAdd, markObserverSkipOnRemove } from "../bindings/observerSkip.js";
import { INDEX_BY_INDEX_NAME } from "../define.js";
import { raiseError } from "../raiseError.js";
import { IBindingInfo } from "../types.js";
import { getContentSetByNode, setContentByNode } from "./contentsByNode.js";
import { getFragmentInfoByUUID } from "./fragmentInfoByUUID.js";
import { IContent } from "./types.js";

const recursiveBindingTypes = new Set(['if', 'elseif', 'else', 'for']);

class Content implements IContent {
  private _content: DocumentFragment;
  private _childNodeArray: Node[] = [];
  private _firstNode: Node | null = null;
  private _lastNode: Node | null = null;
  private _mounted: boolean = false;
  constructor(content: DocumentFragment) {
    this._content = content;
    this._childNodeArray = Array.from(this._content.childNodes);
    this._firstNode = this._childNodeArray.length > 0 ? this._childNodeArray[0] : null;
    this._lastNode = this._childNodeArray.length > 0 ? this._childNodeArray[this._childNodeArray.length - 1] : null;
  }

  get firstNode(): Node | null {
    return this._firstNode;
  }

  get lastNode(): Node | null {
    return this._lastNode;
  }

  get mounted(): boolean {
    return this._mounted;
  }

  appendTo(targetNode: Node): void {
    for(const node of this._childNodeArray) {
      // framework 起点のマウントを observer に伝える。中間 fragment へ append する
      // 経路でも、後続の一括 insertBefore(fragment) の mutation record には
      // この top-level node が addedNodes として現れるため、ここでのマークが届く。
      markObserverSkipOnAdd(node);
      targetNode.appendChild(node);
    }
    this._mounted = true;
  }

  mountAfter(targetNode: Node): void {
    const parentNode = targetNode.parentNode;
    const nextSibling = targetNode.nextSibling;
    if (parentNode) {
      for(const node of this._childNodeArray) {
        markObserverSkipOnAdd(node);
        parentNode.insertBefore(node, nextSibling);
      }
    }
    this._mounted = true;
  }

  unmount(): void {
    getBindingSessionByContent(this)?.dispose();
    for(const node of this._childNodeArray) {
      // framework 起点の削除であることを observer に伝える。clear の
      // parentNode.textContent='' 一括削除でも、この top-level node が
      // 削除サブツリーの root として mutation record に現れるため、ここで
      // マークしておけば observer の冗長走査をスキップできる。マークは
      // 同期実行中に立ち、observer は次 microtask で読むので順序は保証される。
      markObserverSkipOnRemove(node);
      if (node.parentNode !== null) {
        node.parentNode.removeChild(node);
      }
    }
    const bindings = getBindingsByContent(this);
    for(const binding of bindings) {
      if (recursiveBindingTypes.has(binding.bindingType)) {
        const contents = getContentSetByNode(binding.node);
        for (const content of contents) {
          content.unmount();
        }
      }
      clearStateAddressByBindingInfo(binding);
      clearAbsoluteStateAddressByBinding(binding);
    }
    this._mounted = false;
  }
}

/**
 * SSR ハイドレーション用: 既存の DOM ノード配列から Content を生成する。
 * テンプレートからの clone ではなく、SSR で描画済みのノードをそのまま使う。
 */
export function createContentFromNodes(
  nodes: Node[],
): IContent {
  const fragment = document.createDocumentFragment();
  // ノードを fragment に移動せず、参照だけ持つ Content を作る
  const content = new Content(fragment);
  // Content の内部状態を直接設定
  (content as any)._childNodeArray = nodes;
  (content as any)._firstNode = nodes.length > 0 ? nodes[0] : null;
  (content as any)._lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
  (content as any)._mounted = true; // SSR で既にマウント済み
  return content;
}

export function createContent(
  bindingInfo: IBindingInfo, 
): IContent {
  if (typeof bindingInfo.uuid === 'undefined' || bindingInfo.uuid === null) {
    raiseError(`BindingInfo.uuid is null.`);
  }
  const fragmentInfo = getFragmentInfoByUUID(bindingInfo.uuid);
  if (!fragmentInfo) {
    raiseError(`Fragment with UUID "${bindingInfo.uuid}" not found.`);
  }
  const cloneFragment = document.importNode(fragmentInfo.fragment, true);
  const initialInfo = initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos);
  const content = new Content(cloneFragment);
  setBindingSessionByContent(content, initialInfo.bindingSession);
  setBindingsByContent(content, initialInfo.bindingInfos);
  const indexBindings: IBindingInfo[] = [];
  for(const binding of initialInfo.bindingInfos) {
    if (binding.statePathName in INDEX_BY_INDEX_NAME) {
      indexBindings.push(binding);
    }
  }
  setIndexBindingsByContent(content, indexBindings);
  setNodesByContent(content, initialInfo.nodes);
  setContentByNode(bindingInfo.node, content);
  return content;
}
