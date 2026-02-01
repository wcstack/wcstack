import { config } from "../config";

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

export function parseCommentNode(node: Node): string | null {
  const savedText = bindTextByNode.get(node);
  if (typeof savedText === "string") {
    return savedText;
  }
  if (node.nodeType !== Node.COMMENT_NODE) {
    return null;
  }
  const commentNode = node as Comment;
  const text = commentNode.data.trim();
  const match = EMBEDDED_REGEX.exec(text);
  if (match === null) {
    return null;
  }
  // 空の場合は wcs-text として扱う
  const keyword = match[1] || config.commentTextPrefix;
  if (!bindingTypeKeywordSet.has(keyword)) {
    return null;
  }
  bindTextByNode.set(node, match[2]);
  return match[2];
}

export function getCommentNodeBindText(node: Node): string | null {
  return bindTextByNode.get(node) || null;
}