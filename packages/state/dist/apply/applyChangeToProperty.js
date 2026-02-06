export function applyChangeToProperty(binding, _context, newValue) {
    const element = binding.node;
    const propSegments = binding.propSegments;
    if (propSegments.length === 1) {
        const firstSegment = propSegments[0];
        if (element[firstSegment] !== newValue) {
            element[firstSegment] = newValue;
        }
        return;
    }
    const firstSegment = propSegments[0];
    let subObject = element[firstSegment];
    for (let i = 1; i < propSegments.length - 1; i++) {
        const segment = propSegments[i];
        if (subObject == null) {
            return;
        }
        subObject = subObject[segment];
    }
    const oldValue = subObject[propSegments[propSegments.length - 1]];
    if (oldValue !== newValue) {
        subObject[propSegments[propSegments.length - 1]] = newValue;
    }
}
//# sourceMappingURL=applyChangeToProperty.js.map