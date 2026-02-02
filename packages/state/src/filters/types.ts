/**
 * Filter/types.ts
 *
 * Type definition file for filter functions.
 *
 * Main responsibilities:
 * - Defines types for filter functions (FilterFn) and filter functions with options (FilterWithOptionsFn)
 * - Type-safe management of filter name-to-function mappings (FilterWithOptions) and filter function arrays (Filters)
 * - Defines types for retrieving filter functions from built-in filter collections
 *
 * Design points:
 * - Type design enabling flexible filter design and extension
 * - Supports filters with options and combinations of multiple filters
 */
export type FilterFn<T=unknown> = (value: unknown) => T;

export type FilterWithOptionsFn = (options?: string[]) => FilterFn;

export type FilterWithOptions = Record<string, FilterWithOptionsFn>;

export type Filters = FilterFn[];

export type FilterFnByBuiltinFiltersFn = (filters: FilterWithOptions) => FilterFn;
export type FilterFnByBuiltinFiltersFnByNameAndOptions = 
  (name: string, options: string[]) => FilterFnByBuiltinFiltersFn;

export type FilterIOType = "input" | "output";
export type FiltersByFilterIOType = Record<FilterIOType, FilterWithOptions>;
