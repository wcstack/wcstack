import { getParseBindTextResults } from "../bindings/getParseBindTextResults";
import { parseBindTextsForElement } from "../bindTextParser/parseBindTextsForElement";
import { config } from "../config";
import { getUUID } from "../getUUID";
import { raiseError } from "../raiseError";
import { createNotFilter } from "./createNotFilter";
import { expandShorthandInBindAttribute, expandShorthandPaths } from "./expandShorthandPaths";
import { setFragmentInfoByUUID } from "./fragmentInfoByUUID";
import { getFragmentNodeInfos } from "./getFragmentNodeInfos";
import { getNodePath } from "./getNodePath";
const keywordByBindingType = new Map([
    ["for", config.commentForPrefix],
    ["if", config.commentIfPrefix],
    ["elseif", config.commentElseIfPrefix],
    ["else", config.commentElsePrefix],
]);
const notFilter = createNotFilter();
function cloneNotParseBindTextResult(bindingType, parseBindTextResult) {
    const filters = parseBindTextResult.outFilters;
    return {
        ...parseBindTextResult,
        outFilters: [...filters, notFilter],
        bindingType: bindingType,
    };
}
function _getFragmentInfo(fragment, parseBindingTextResult, forPath) {
    if (typeof forPath === "string") {
        expandShorthandPaths(fragment, forPath);
    }
    collectStructuralFragments(fragment, forPath);
    // after replacing and collect node infos on child fragment
    const fragmentInfo = {
        fragment: fragment,
        parseBindTextResult: parseBindingTextResult,
        nodeInfos: getFragmentNodeInfos(fragment),
    };
    return fragmentInfo;
}
export function collectStructuralFragments(root, forPath) {
    const elseKeyword = config.commentElsePrefix;
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
    let lastIfFragmentInfo = null; // for elseif chaining
    const elseFragmentInfos = []; // for elseif chaining
    const templates = [];
    while (walker.nextNode()) {
        const template = walker.currentNode;
        templates.push(template);
    }
    for (const template of templates) {
        let bindText = template.getAttribute(config.bindAttributeName) || '';
        if (typeof forPath === "string") {
            bindText = expandShorthandInBindAttribute(bindText, forPath);
        }
        const parseBindTextResults = parseBindTextsForElement(bindText);
        let parseBindTextResult = parseBindTextResults[0];
        const keyword = keywordByBindingType.get(parseBindTextResult.bindingType);
        if (typeof keyword === 'undefined') {
            continue;
        }
        const bindingType = parseBindTextResult.bindingType;
        const fragment = template.content;
        const uuid = getUUID();
        let fragmentInfo = null;
        // Determine childForPath for shorthand expansion
        const childForPath = bindingType === "for"
            ? parseBindTextResult.statePathName
            : forPath;
        if (bindingType === "else") {
            // check last 'if' or 'elseif' fragment info
            if (lastIfFragmentInfo === null) {
                raiseError(`'else' binding found without preceding 'if' or 'elseif' binding.`);
            }
            // else condition
            parseBindTextResult = cloneNotParseBindTextResult("else", lastIfFragmentInfo.parseBindTextResult);
            fragmentInfo = _getFragmentInfo(fragment, parseBindTextResult, childForPath);
            setFragmentInfoByUUID(uuid, fragmentInfo);
            const lastElseFragmentInfo = elseFragmentInfos.at(-1);
            const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
            if (typeof lastElseFragmentInfo !== "undefined") {
                template.remove();
                lastElseFragmentInfo.fragment.appendChild(placeHolder);
                lastElseFragmentInfo.nodeInfos.push({
                    nodePath: getNodePath(placeHolder),
                    parseBindTextResults: getParseBindTextResults(placeHolder),
                });
            }
            else {
                template.replaceWith(placeHolder);
            }
        }
        else if (bindingType === "elseif") {
            // check last 'if' or 'elseif' fragment info
            if (lastIfFragmentInfo === null) {
                raiseError(`'elseif' binding found without preceding 'if' or 'elseif' binding.`);
            }
            fragmentInfo = _getFragmentInfo(fragment, parseBindTextResult, childForPath);
            setFragmentInfoByUUID(uuid, fragmentInfo);
            const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
            // create else fragment
            const elseUUID = getUUID();
            const elseFragmentInfo = {
                fragment: document.createDocumentFragment(),
                parseBindTextResult: cloneNotParseBindTextResult("else", lastIfFragmentInfo.parseBindTextResult),
                nodeInfos: [],
            };
            elseFragmentInfo.fragment.appendChild(placeHolder);
            elseFragmentInfo.nodeInfos.push({
                nodePath: getNodePath(placeHolder),
                parseBindTextResults: getParseBindTextResults(placeHolder),
            });
            setFragmentInfoByUUID(elseUUID, elseFragmentInfo);
            const lastElseFragmentInfo = elseFragmentInfos.at(-1);
            elseFragmentInfos.push(elseFragmentInfo);
            const elsePlaceHolder = document.createComment(`@@${elseKeyword}:${elseUUID}`);
            if (typeof lastElseFragmentInfo !== "undefined") {
                template.remove();
                lastElseFragmentInfo.fragment.appendChild(elsePlaceHolder);
                lastElseFragmentInfo.nodeInfos.push({
                    nodePath: getNodePath(elsePlaceHolder),
                    parseBindTextResults: getParseBindTextResults(elsePlaceHolder),
                });
            }
            else {
                template.replaceWith(elsePlaceHolder);
            }
        }
        else {
            fragmentInfo = _getFragmentInfo(fragment, parseBindTextResult, childForPath);
            setFragmentInfoByUUID(uuid, fragmentInfo);
            const placeHolder = document.createComment(`@@${keyword}:${uuid}`);
            template.replaceWith(placeHolder);
        }
        // Update lastIfFragmentInfo for if/elseif/else chaining
        if (bindingType === "if") {
            elseFragmentInfos.length = 0; // start new if chain
            lastIfFragmentInfo = fragmentInfo;
        }
        else if (bindingType === "elseif") {
            lastIfFragmentInfo = fragmentInfo;
        }
        else if (bindingType === "else") {
            lastIfFragmentInfo = null;
            elseFragmentInfos.length = 0; // end if chain
        }
    }
}
//# sourceMappingURL=collectStructuralFragments.js.map