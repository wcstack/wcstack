import { builtinFilterFn, builtinFiltersByFilterIOType } from "../filters/builtinFilters";
import { raiseError } from "../raiseError";
import { parseFilterArgs } from "./parseFilterArgs";
const filterFnByKey = new Map();
// format: filterName(arg1,arg2) or filterName
export function parseFilters(filterTextList, filterIOType) {
    const builtinFilters = builtinFiltersByFilterIOType[filterIOType];
    const filters = filterTextList.map((filterText) => {
        const openParenIndex = filterText.indexOf('(');
        const closeParenIndex = filterText.lastIndexOf(')');
        // check parentheses
        if (openParenIndex !== -1 && closeParenIndex === -1) {
            raiseError(`Invalid filter format: missing closing parenthesis in "${filterText}"`);
        }
        if (closeParenIndex !== -1 && openParenIndex === -1) {
            raiseError(`Invalid filter format: missing opening parenthesis in "${filterText}"`);
        }
        if (openParenIndex === -1) {
            // no arguments
            const filterName = filterText.trim();
            const filterKey = `${filterName}():${filterIOType}`;
            let filterFn = filterFnByKey.get(filterKey);
            if (typeof filterFn === 'undefined') {
                filterFn = builtinFilterFn(filterName, [])(builtinFilters);
                filterFnByKey.set(filterKey, filterFn);
            }
            return {
                filterName: filterName,
                args: [],
                filterFn: filterFn,
            };
        }
        else {
            const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
            const filterName = filterText.substring(0, openParenIndex).trim();
            const args = parseFilterArgs(argsText);
            const filterKey = `${filterName}(${args.join(',')}):${filterIOType}`;
            let filterFn = filterFnByKey.get(filterKey);
            if (typeof filterFn === 'undefined') {
                filterFn = builtinFilterFn(filterName, args)(builtinFilters);
                filterFnByKey.set(filterKey, filterFn);
            }
            return {
                filterName,
                args,
                filterFn,
            };
        }
    });
    return filters;
}
//# sourceMappingURL=parseFilters.js.map