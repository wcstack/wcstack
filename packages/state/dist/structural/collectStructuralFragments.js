import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { config } from "../config";
import { getUUID } from "../getUUID";
import { setFragmentByUUID } from "./fragmentByUUID";
import { setParseBindTextResultByUUID } from "../bindTextParser/parseBindTextResultByUUID";
const keywordByBindingType = new Map([
    ["for", config.commentForPrefix],
    ["if", config.commentIfPrefix],
    ["elseif", config.commentElseIfPrefix],
    ["else", config.commentElsePrefix],
]);
export function collectStructuralFragments(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
        acceptNode(node) {
            const element = node;
            if (element instanceof HTMLTemplateElement) {
                const bindText = element.getAttribute(config.bindAttributeName) || '';
                if (bindText.length > 0) {
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
            return NodeFilter.FILTER_SKIP;
        }
    });
    while (walker.nextNode()) {
        const template = walker.currentNode;
        const bindText = template.getAttribute(config.bindAttributeName) || '';
        const parseBindTextResults = parseBindTextsForElement(bindText);
        const parseBindTextResult = parseBindTextResults[0];
        const fragment = template.content;
        const uuid = getUUID();
        setFragmentByUUID(uuid, fragment);
        setParseBindTextResultByUUID(uuid, parseBindTextResult);
        const keyword = keywordByBindingType.get(parseBindTextResult.bindingType);
        if (typeof keyword === 'undefined') {
            continue;
        }
        const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
        template.replaceWith(placeHolder);
        collectStructuralFragments(fragment);
    }
}
//# sourceMappingURL=collectStructuralFragments.js.map