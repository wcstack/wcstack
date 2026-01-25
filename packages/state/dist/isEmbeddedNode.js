import { config } from "./config";
// format: <!--{{ bind-state:path }}-->
// bind-stateはconfig.bindAttributeNameで変更可能
const keyword = config.bindAttributeName.replace(/^data-/, '');
export function isEmbeddedNode(node) {
    if (node.nodeType !== Node.COMMENT_NODE) {
        return false;
    }
    const commentNode = node;
    const text = commentNode.data.trim();
    const match = RegExp(`^{{\\s*${keyword}:(.+?)\\s*}}$`).exec(text);
    if (match === null) {
        return false;
    }
    return true;
}
//# sourceMappingURL=isEmbeddedNode.js.map