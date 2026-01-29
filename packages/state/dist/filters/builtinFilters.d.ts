import { FilterFn, FilterWithOptions } from "./types";
export declare const outputBuiltinFilters: FilterWithOptions;
export declare const inputBuiltinFilters: FilterWithOptions;
/**
 * Retrieves built-in filter function by name and options.
 *
 * @param name - Filter name
 * @param options - Array of option strings
 * @returns Function that takes FilterWithOptions and returns filter function
 */
export declare const builtinFilterFn: (name: string, options: string[]) => (filters: FilterWithOptions) => FilterFn<unknown>;
//# sourceMappingURL=builtinFilters.d.ts.map