export function applyChangeToStyle(binding, _context, newValue) {
    const styleName = binding.propSegments[1];
    const style = binding.node.style;
    const currentValue = style[styleName];
    if (currentValue !== newValue) {
        style[styleName] = newValue;
    }
}
//# sourceMappingURL=applyChangeToStyle.js.map