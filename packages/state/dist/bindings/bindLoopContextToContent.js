import { setLoopContextByNode } from "../list/loopContextByNode";
import { getNodesByContent } from "./nodesByContent";
export function bindLoopContextToContent(content, loopContext) {
    const nodes = getNodesByContent(content);
    for (const node of nodes) {
        setLoopContextByNode(node, loopContext);
    }
}
export function unbindLoopContextToContent(content) {
    const nodes = getNodesByContent(content);
    for (const node of nodes) {
        setLoopContextByNode(node, null);
    }
}
//# sourceMappingURL=bindLoopContextToContent.js.map