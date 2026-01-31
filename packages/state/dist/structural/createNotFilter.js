import { builtinFilterFn, outputBuiltinFilters } from "../filters/builtinFilters";
let _notFilterInfo = undefined;
export function createNotFilter() {
    if (_notFilterInfo) {
        return _notFilterInfo;
    }
    const filterName = "not";
    const args = [];
    const filterFn = builtinFilterFn(filterName, args)(outputBuiltinFilters);
    _notFilterInfo = {
        filterName,
        args,
        filterFn,
    };
    return _notFilterInfo;
}
//# sourceMappingURL=createNotFilter.js.map