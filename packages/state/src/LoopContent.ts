import { ILoopContent } from "./types";

class LoopContent implements ILoopContent {
  private _content: DocumentFragment;
  private _childNodeArray: Node[] = [];
  private _firstNode: Node | null = null;
  private _lastNode: Node | null = null;
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

  mountAfter(targetNode: Node): void {
    const parentNode = targetNode.parentNode;
    const nextSibling = targetNode.nextSibling;
    if (parentNode) {
      this._childNodeArray.forEach((node) => {
        parentNode.insertBefore(node, nextSibling);
      });
    }
  }

  unmount(): void {
    this._childNodeArray.forEach((node) => {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
  }
}

export function createLoopContent(content: DocumentFragment): ILoopContent {
  return new LoopContent(content);
}