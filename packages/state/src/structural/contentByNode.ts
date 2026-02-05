import { IContent } from "./types";

const contentByNode = new WeakMap<Node, IContent>();

export function setContentByNode(node: Node, content: IContent | null): void {
  if (content === null) {
    contentByNode.delete(node);
  } else {
    contentByNode.set(node, content);
  }
}

export function getContentByNode(node: Node): IContent | null {
  let currentNode: Node | null = node;
  while (currentNode) {
    const loopContext = contentByNode.get(currentNode);
    if (loopContext) {
      return loopContext;
    }
    currentNode = currentNode.parentNode;
  }
  return null;
}

