export function getBindingInfos(node, parseBindingTextResults) {
    const bindingInfos = [];
    for (const parseBindingTextResult of parseBindingTextResults) {
        if (parseBindingTextResult.bindingType !== 'text') {
            bindingInfos.push({
                ...parseBindingTextResult,
                node: node,
                placeHolderNode: node,
            });
        }
        else {
            const placeHolderNode = document.createTextNode('');
            bindingInfos.push({
                ...parseBindingTextResult,
                node: node,
                placeHolderNode: placeHolderNode,
            });
        }
    }
    return bindingInfos;
}
//# sourceMappingURL=getBindingInfos.js.map