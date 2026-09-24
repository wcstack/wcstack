export type BindingType = 'text' | 'prop' | 'event' | 'for' | 'if' | 'elseif' | 'else' | 'radio' | 'checkbox' | 'spread';

/** Left side (input) or right side (output) of a binding — only used to pick the diagnostic wording. */
export type FilterIOType = 'input' | 'output';

/**
 * A filter as the grammar reads it: name and arguments only. The filter function is resolved
 * later by the engine (the parser never looks names up, so unknown names pass here).
 *
 * Field names are the ones of `@wcstack/state`'s `IParsedFilter`:
 * - `filterName` — the name as written (no alias resolution).
 * - `args`       — the raw argument texts, quotes removed (format filters read these).
 * - `literals`   — the typed value of each argument (requirement B9): unquoted `true` / `false` /
 *                  `null` / numbers are typed, everything else (and every quoted argument) is the string.
 *                  Always the same length and order as `args`.
 */
export interface ParsedFilter {
  filterName: string;
  args: string[];
  literals: unknown[];
}

/** Parse result of one binding (DOM independent). */
export interface ParsedBinding {
  propName: string;
  propSegments: string[];
  propModifiers: string[];
  statePathName: string;
  inFilters: ParsedFilter[];
  outFilters: ParsedFilter[];
  bindingType: BindingType;
}

/** Bindings that must be the only binding of their attribute value. */
export const STRUCTURAL_BINDING_TYPE_SET: ReadonlySet<BindingType> = new Set<BindingType>([
  'if',
  'elseif',
  'else',
  'for',
]);
