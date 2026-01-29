import { builtinFilterFn, outputBuiltinFilters } from "../filters/builtinFilters";
import { raiseError } from "../raiseError";
import { parseFilterArgs } from "./parseFilterArgs";
// format: filterName(arg1,arg2) or filterName
export function parseFilters(filterTextList) {
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
            const filterFn = builtinFilterFn(filterName, [])(outputBuiltinFilters);
            return {
                filterName: filterName,
                args: [],
                filterFn: filterFn,
            };
        }
        else {
            const argsText = filterText.substring(openParenIndex + 1, closeParenIndex);
            const args = parseFilterArgs(argsText);
            const filterName = filterText.substring(0, openParenIndex).trim();
            const filterFn = builtinFilterFn(filterName, args)(outputBuiltinFilters);
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