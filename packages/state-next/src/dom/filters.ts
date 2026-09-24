import type { ParsedFilter } from "../parser/index";
import { resolveFilter, type FilterFn } from "../filters/registry";
import { installCoreFilters } from "../filters/core";

export type { FilterFn };

let coreInstalled = false;

/**
 * Resolves a binding's parsed filters to functions (at plan time, once per binding spec).
 * The core filters are always available; the formatting ones come with `installFormats()`
 * (the auto bundle installs them).
 */
export function buildFilters(parsed: readonly ParsedFilter[]): FilterFn[] | null {
  if (parsed.length === 0) return null;
  if (!coreInstalled) {
    installCoreFilters();
    coreInstalled = true;
  }
  return parsed.map((f) => resolveFilter(f.filterName, f.args, f.literals));
}
