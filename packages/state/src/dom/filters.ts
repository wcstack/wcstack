import type { ParsedFilter } from "../parser/index";
import { resolveFilter, type FilterFn } from "../filters/registry";
import { installCoreFilters } from "../filters/core";

export type { FilterFn };

/** `v` through the filters `fs` (none when null). */
export function pipe(fs: FilterFn[] | null, v: unknown): unknown {
  if (fs !== null) for (let i = 0; i < fs.length; i++) v = fs[i](v);
  return v;
}

/**
 * Resolves a binding's parsed filters to functions (at plan time, once per binding spec).
 * The core filters (the conditions) are always available; the others come with the formats add-on
 * (`installFeatures([formats])`; the full build installs it).
 */
export function buildFilters(parsed: readonly ParsedFilter[]): FilterFn[] | null {
  if (parsed.length === 0) return null;
  installCoreFilters(); // idempotent
  return parsed.map((f) => resolveFilter(f.filterName, f.args, f.literals));
}
