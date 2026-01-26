import { ILoopElement } from "./components/types";
import { getElementByUUID } from "./elementByUUID";

export function isLoopComment(node: Node): ILoopElement | null {
  if (node.nodeType !== Node.COMMENT_NODE) {
    return null;
  }
  const commentNode = node as Comment;
  const text = commentNode.data.trim();
  const match = /^@@loop:(.+)$/.exec(text);
  if (match === null) {
    return null;
  }
  const uuid = match[1];
  const element = getElementByUUID(uuid);
  if (element === null) {
    return null;
  }
  return element as unknown as ILoopElement;
}

