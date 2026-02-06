export function applyChangeToAttribute(binding, _context, newValue) {
    const element = binding.node;
    const attrName = binding.propSegments[1];
    if (element.getAttribute(attrName) !== newValue) {
        element.setAttribute(attrName, newValue);
    }
}
//# sourceMappingURL=applyChangeToAttribute.js.map