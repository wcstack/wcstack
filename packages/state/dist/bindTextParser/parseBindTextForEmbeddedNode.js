import { parseStatePart } from "./parseStatePart.js";
export function parseBindTextForEmbeddedNode(bindText) {
    const stateResult = parseStatePart(bindText);
    return {
        propName: 'textContent',
        propSegments: ['textContent'],
        propModifiers: [],
        inFilters: [],
        ...stateResult,
        bindingType: 'text',
    };
}
//# sourceMappingURL=parseBindTextForEmbeddedNode.js.map