import { getParseBindTextResults } from "../bindings/getParseBindTextResults";
import { getSubscriberNodes } from "../bindings/getSubscriberNodes";
import { getNodePath } from "./getNodePath";
export function getFragmentNodeInfos(fragment) {
    const fragmnentNodeInfos = [];
    const subscriberNodes = getSubscriberNodes(fragment);
    for (const subscriberNode of subscriberNodes) {
        const parseBindingTextResults = getParseBindTextResults(subscriberNode);
        fragmnentNodeInfos.push({
            nodePath: getNodePath(subscriberNode),
            parseBindTextResults: parseBindingTextResults,
        });
    }
    return fragmnentNodeInfos;
}
//# sourceMappingURL=getFragmentNodeInfos.js.map