import { getBindingsByContent, setBindingsByContent } from "../bindings/bindingsByContent.js";
import { initializeBindingsByFragment } from "../bindings/initializeBindings.js";
import { ILoopContext } from "../list/types.js";
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

  mountAfter(targetNode: Node): void {
    const parentNode = targetNode.parentNode;
    const nextSibling = targetNode.nextSibling;
    if (parentNode) {
      this._childNodeArray.forEach((node) => {
        parentNode.insertBefore(node, nextSibling);
      });
    }
    this._mounted = true;
  }

  unmount(): void {
    this._childNodeArray.forEach((node) => {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
    const bindings = getBindingsByContent(this);
    for(const binding of bindings) {
      if (binding.bindingType === 'if' || binding.bindingType === 'elseif' || binding.bindingType === 'else') {
        const content = getContentByNode(binding.node);
        if (content !== null) {
          content.unmount();
        }
      }
    }
    this._mounted = false;
  }
}

export function createContent(
  bindingInfo: IBindingInfo, 
  loopContext: ILoopContext | null
): IContent {
  if (typeof bindingInfo.uuid === 'undefined' || bindingInfo.uuid === null) {
    raiseError(`BindingInfo.uuid is null.`);
  }
  const fragmentInfo = getFragmentInfoByUUID(bindingInfo.uuid);
  if (!fragmentInfo) {
    raiseError(`Fragment with UUID "${bindingInfo.uuid}" not found.`);
  }
  const cloneFragment = document.importNode(fragmentInfo.fragment, true);
  const bindings = initializeBindingsByFragment(cloneFragment, fragmentInfo.nodeInfos, loopContext);
  const content = new Content(cloneFragment);
  setBindingsByContent(content, bindings);
  setContentByNode(bindingInfo.node, content);
  return content;
}
