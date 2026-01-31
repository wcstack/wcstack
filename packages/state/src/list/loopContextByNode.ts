import { IListIndex, ILoopContext } from "./types";

const loopContextByNode = new WeakMap<Node, ILoopContext>();

export function getLoopContextByNode(node: Node): ILoopContext | null {
  return loopContextByNode.get(node) || null;
}

export function setLoopContextByNode(node: Node, loopContext: ILoopContext | null): void {
  if (loopContext === null) {
    loopContextByNode.delete(node);
    return;
  }
  loopContextByNode.set(node, loopContext);
}
