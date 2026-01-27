import { config } from "../config";
const bindTextByNode = new WeakMap();
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
const bindingTypeKeywordSet = new Set([
    config.commentTextPrefix,
    config.commentForPrefix,
    config.commentIfPrefix,
    config.commentElseIfPrefix,
    config.commentElsePrefix,
]);
const EMBEDDED_REGEX = new RegExp(`^\\s*@@\\s*(.+?)\\s*:\\s*(.+?)\\s*$`);
export function isCommentNode(node) {
    if (node.nodeType !== Node.COMMENT_NODE) {
        return false;
    }
    const commentNode = node;
    const text = commentNode.data.trim();
    const match = EMBEDDED_REGEX.exec(text);
    if (match === null) {
        return false;
    }
    if (!bindingTypeKeywordSet.has(match[1])) {
        return false;
    }
    bindTextByNode.set(node, match[2]);
    return true;
}
export function getCommentNodeBindText(node) {
    return bindTextByNode.get(node) || null;
}
//# sourceMappingURL=isCommentNode.js.map