const contentsByNode = new WeakMap();
export function setContentByNode(node, content) {
    const contents = contentsByNode.get(node);
    if (contents) {
        contents.push(content);
    }
    else {
        contentsByNode.set(node, [content]);
    }
}
export function getContentsByNode(node) {
    return contentsByNode.get(node) || [];
}
export function deleteContentByNode(node, content) {
    const contents = contentsByNode.get(node);
    if (contents) {
        const index = contents.indexOf(content);
        if (index !== -1) {
            contents.splice(index, 1);
            if (contents.length === 0) {
                contentsByNode.delete(node);
            }
        }
    }
}
//# sourceMappingURL=contentsByNode.js.map