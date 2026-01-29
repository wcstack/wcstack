import { config } from "../config";
import { BindingType } from "../types";

const bindTextByNode = new WeakMap<Node, string>();

// format: <!--@@wcs-text:path-->
// bind-stateはconfig.commentTextPrefixで変更可能
// format: <!--@@wcs-for:UUID-->
// bind-stateはconfig.commentForPrefixで変更可能
// format: <!--@@wcs-if:UUID-->
// bind-stateはconfig.commentIfPrefixで変更可能
// format: <!--@@wcs-else:UUID-->
// bind-stateはconfig.commentElsePrefixで変更可能
// format: <!--@@wcs-elseif:UUID-->
// bind-stateはconfig.commentElseIfPrefixで変更可能
const bindingTypeKeywordSet: Set<string> = new Set<string>([
  config.commentTextPrefix,
  config.commentForPrefix,
  config.commentIfPrefix,
  config.commentElseIfPrefix,
  config.commentElsePrefix,
]);

// format: <!--@@:path-->は<!--@@wcs-text:path-->と同義にする
const EMBEDDED_REGEX = new RegExp(`^\\s*@@\\s*(.*?)\\s*:\\s*(.+?)\\s*$`);

export function isCommentNode(node: Node): boolean {
  if (node.nodeType !== Node.COMMENT_NODE) {
    return false;
  }
  const commentNode = node as Comment;
  const text = commentNode.data.trim();
  const match = EMBEDDED_REGEX.exec(text);
  if (match === null) {
    return false;
  }
  // 空の場合は wcs-text として扱う
  const keyword = match[1] || config.commentTextPrefix;
  if (!bindingTypeKeywordSet.has(keyword)) {
    return false;
  }
  bindTextByNode.set(node, match[2]);
  return true;
}

export function getCommentNodeBindText(node: Node): string | null {
  return bindTextByNode.get(node) || null;
}