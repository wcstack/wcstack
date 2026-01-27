export function applyChangeToProperty(element, propName, newValue) {
    const currentValue = element[propName];
    if (currentValue !== newValue) {
        element[propName] = newValue;
    }
}
//# sourceMappingURL=applyChangeToProperty.js.map