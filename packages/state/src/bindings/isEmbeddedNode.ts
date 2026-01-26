import { config } from "../config";

const bindTextByNode = new WeakMap<Node, string>();

// format: <!--wcs:path-->
// bind-stateはconfig.bindAttributeNameで変更可能

const KEYWORD = config.commentPrefix;
const EMBEDDED_REGEX = new RegExp(`^{{\\s*${KEYWORD}:\\s*(.+?)\\s*}}$`);

export function isEmbeddedNode(node: Node): boolean {
  if (node.nodeType !== Node.COMMENT_NODE) {
    return false;
  }
  const commentNode = node as Comment;
  const text = commentNode.data.trim();
  const match = EMBEDDED_REGEX.exec(text);
  if (match === null) {
    return false;
  }
  bindTextByNode.set(node, match[1]);
  return true;
}

export function getEmbeddedNodeBindText(node: Node): string | null {
  return bindTextByNode.get(node) || null;
}