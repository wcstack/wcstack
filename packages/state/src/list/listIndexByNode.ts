import { IListIndex } from "./types";

const listIndexByNode = new WeakMap<Node, IListIndex>();

export function getListIndexByNode(node: Node): IListIndex | null {
  return listIndexByNode.get(node) || null;
}

export function setListIndexByNode(node: Node, listIndex: IListIndex | null): void {
  if (listIndex === null) {
    listIndexByNode.delete(node);
    return;
  }
  listIndexByNode.set(node, listIndex);
}
