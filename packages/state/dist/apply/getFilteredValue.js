export function getFilteredValue(value, filters) {
    let filteredValue = value;
    for (const filter of filters) {
        filteredValue = filter.filterFn(filteredValue);
    }
    return filteredValue;
}
//# sourceMappingURL=getFilteredValue.js.map