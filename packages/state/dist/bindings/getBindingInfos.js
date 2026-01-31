export function getBindingInfos(node, parseBindingTextResults) {
    const bindingInfos = [];
    for (const parseBindingTextResult of parseBindingTextResults) {
        if (parseBindingTextResult.bindingType !== 'text') {
            bindingInfos.push({
                ...parseBindingTextResult,
                node: node,
                replaceNode: node,
            });
        }
        else {
            const replaceNode = document.createTextNode('');
            bindingInfos.push({
                ...parseBindingTextResult,
                node: node,
                replaceNode: replaceNode,
            });
        }
    }
    return bindingInfos;
}
//# sourceMappingURL=getBindingInfos.js.map