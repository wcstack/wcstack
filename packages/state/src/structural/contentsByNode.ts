import { IContent } from "./types";

const contentsByNode = new WeakMap<Node, IContent[]>();

export function setContentByNode(node: Node, content: IContent): void {
  const contents = contentsByNode.get(node);
  if (contents) {
    contents.push(content);
  } else {
    contentsByNode.set(node, [content]);
  }
}

export function getContentsByNode(node: Node): IContent[] {
  return contentsByNode.get(node) || [];
}

export function deleteContentByNode(node: Node, content: IContent): void {
  const contents = contentsByNode.get(node);
  if (contents) {
    const index = contents.indexOf(content);
    if (index !== -1) {
      contents.splice(index, 1);
      if (contents.length === 0) {
        contentsByNode.delete(node);
      }
    }
  }
}