import { getElementByUUID } from "./elementByUUID";
export function isLoopComment(node) {
    if (node.nodeType !== Node.COMMENT_NODE) {
        return null;
    }
    const commentNode = node;
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
    return element;
}
//# sourceMappingURL=isLoopComment.js.map