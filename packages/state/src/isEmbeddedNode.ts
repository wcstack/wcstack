import { config } from "./config";

// format: <!--{{ bind-state:path }}-->
// bind-stateはconfig.bindAttributeNameで変更可能

const keyword = config.bindAttributeName.replace(/^data-/, '');

export function isEmbeddedNode(node: Node): boolean {
  if (node.nodeType !== Node.COMMENT_NODE) {
    return false;
  }
  const commentNode = node as Comment;
  const text = commentNode.data.trim();
  const match = RegExp(`^{{\\s*${keyword}:(.+?)\\s*}}$`).exec(text);
  if (match === null) {
    return false;
  }
  return true;
}