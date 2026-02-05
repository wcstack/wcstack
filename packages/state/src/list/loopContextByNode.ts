import { ILoopContext } from "./types";

const loopContextByNode = new WeakMap<Node, ILoopContext>();

export function getLoopContextByNode(node: Node): ILoopContext | null {
  let paramNode: Node | null = node;
  while (paramNode) {
    const loopContext = loopContextByNode.get(paramNode);
    if (loopContext) {
      return loopContext;
    }
    paramNode = paramNode.parentNode;
  }
  return null;
}

export function setLoopContextByNode(node: Node, loopContext: ILoopContext | null): void {
  if (loopContext === null) {
    loopContextByNode.delete(node);
    return;
  }
  loopContextByNode.set(node, loopContext);
}
