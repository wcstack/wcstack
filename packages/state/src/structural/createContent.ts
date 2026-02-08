import { clearAbsoluteStateAddressByBindingInfo } from "../binding/getAbsoluteStateAddressByBindingInfo.js";
import { clearStateAddressByBindingInfo } from "../binding/getStateAddressByBindingInfo.js";
import { getBindingsByContent, setBindingsByContent } from "../bindings/bindingsByContent.js";
import { setIndexBindingsByContent } from "../bindings/indexBindingsByContent.js";
import { initializeBindingsByFragment } from "../bindings/initializeBindings.js";
import { setNodesByContent } from "../bindings/nodesByContent.js";
import { INDEX_BY_INDEX_NAME } from "../define.js";
import { raiseError } from "../raiseError.js";
import { IBindingInfo } from "../types.js";
import { getContentByNode, setContentByNode } from "./contentByNode.js";
import { getFragmentInfoByUUID } from "./fragmentInfoByUUID.js";
import { IContent } from "./types.js";

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
    targetNode.appendChild(this._content);
    this._mounted = true;
  }

  mountAfter(targetNode: Node): void {
    const parentNode = targetNode.parentNode;
    const nextSibling = targetNode.nextSibling;
    if (parentNode) {
      if (this._mounted) {
        this._childNodeArray.forEach((node) => {
          this._content.appendChild(node);
        });
      }
      parentNode.insertBefore(this._content, nextSibling);
    }
    this._mounted = true;
  }

  unmount(): void {
    this._childNodeArray.forEach((node) => {
      this._content.appendChild(node);
    });
    const bindings = getBindingsByContent(this);
    for(const binding of bindings) {
      if (binding.bindingType === 'if' || binding.bindingType === 'elseif' || binding.bindingType === 'else') {
        const content = getContentByNode(binding.node);
        if (content !== null) {
          content.unmount();
        }
      }
      clearStateAddressByBindingInfo(binding);
      clearAbsoluteStateAddressByBindingInfo(binding);
    }
    this._mounted = false;
  }
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
