export function applyChangeToStyle(node, styleName, newValue) {
    const style = node.style;
    const currentValue = style[styleName];
    if (currentValue !== newValue) {
        style[styleName] = newValue;
    }
}
//# sourceMappingURL=applyChangeToStyle.js.map