import { getPathInfo } from "../address/PathInfo";
import { parseFilters } from "./parseFilters";
import { trimFn } from "./utils";
const cacheFilterInfos = new Map();
// format: statePath@stateName|filter|filter
// statePath-format: path.to.property (e.g., user.name.first, users.*.name, users.0.name, not include @)
// stateName: optional, default is 'default'
// filters-format: filterName or filterName(arg1,arg2)
export function parseStatePart(statePart) {
    const pos = statePart.indexOf('|');
    let stateAndPath = '';
    let filterTexts = [];
    let filtersText = '';
    let filters = [];
    if (pos !== -1) {
        stateAndPath = statePart.slice(0, pos).trim();
        filtersText = statePart.slice(pos + 1).trim();
        if (cacheFilterInfos.has(filtersText)) {
            filters = cacheFilterInfos.get(filtersText);
        }
        else {
            filterTexts = filtersText.split('|').map(trimFn);
            filters = parseFilters(filterTexts, "output");
            cacheFilterInfos.set(filtersText, filters);
        }
    }
    else {
        stateAndPath = statePart.trim();
    }
    const [statePathName, stateName = 'default'] = stateAndPath.split('@').map(trimFn);
    const pathInfo = getPathInfo(statePathName);
    return {
        stateName,
        statePathName,
        statePathInfo: pathInfo,
        outFilters: filters,
    };
}
//# sourceMappingURL=parseStatePart.js.map