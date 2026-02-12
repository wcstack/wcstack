import { createEmptySet } from "../createEmptySet";
import { IContent } from "./types";

const contentSetByNode = new WeakMap<Node, Set<IContent>>();

const EMPTY_SET = createEmptySet<IContent>();

export function setContentByNode(node: Node, content: IContent): void {
  const contents = contentSetByNode.get(node);
  if (contents) {
    contents.add(content);
  } else {
    contentSetByNode.set(node, new Set([content]));
  }
}

export function getContentSetByNode(node: Node): Readonly<Set<IContent>> {
  const contents = contentSetByNode.get(node);
  if (typeof contents !== "undefined") {
    return contents;
  }
  return EMPTY_SET;
}

export function deleteContentByNode(node: Node, content: IContent): void {
  const contents = contentSetByNode.get(node);
  if (contents) {
    contents.delete(content);
    if (contents.size === 0) {
      contentSetByNode.delete(node);
    }
  }
}