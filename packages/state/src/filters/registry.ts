/**
 * filters/registry.ts — the filter registry, ported from `@wcstack/state` (`core/filterRegistry.ts`).
 *
 * The grammar (`path|filter(args)`) only produces names and arguments; the functions are looked up
 * here when the bindings are planned. The core set (`./core`) and the formats add-on (`./formats`)
 * each put their filters in with an install call; this module knows neither implementation, so a
 * page that skips the add-on does not carry its code.
 *
 * Differences from the source, all decided:
 * - one registry, not an input / output pair (the source registered the same table in both);
 * - no aliases (`inc dec fix uc lc cap pad rep rev null` are not carried over);
 * - every registered filter has arity bounds (the source allowed them to be absent);
 * - the core set is registered like any other (the source hard-wired `not` into the registry).
 */
import { raiseError } from "../parser/raiseError";
import { raise, M } from "../messages";

export type FilterFn = (value: unknown) => unknown;

/**
 * Builds the function for one use of a filter. `options` are the argument texts (unquoted),
 * `literals` their typed values (requirement B9 — only filters that compare or return an argument
 * read them).
 */
export type FilterFactory = (options: string[], literals: readonly unknown[]) => FilterFn;

/** A filter as an install call hands it to the registry: the factory and its [min, max] argument count (B3). */
export interface FilterDefinition {
  factory: FilterFactory;
  arity: readonly [number, number];
}

/**
 * The formats add-on's filters (37: up to 4.0.0-rc.3 the 23 display ones, then the core's
 * arithmetic, conversion and missing-value 14). Only the names live here (not the code), so that a
 * page without the add-on can still say where one of them comes from instead of calling it a typo.
 * A test keeps this list equal to the add-on's table.
 */
export const FORMATS_FILTER_NAMES: readonly string[] = [
  "toFixed", "locale",
  "upper", "lower", "capitalize", "trim", "slice", "padStart", "padEnd", "repeat", "reverse", "truncate", "join",
  "round", "floor", "ceil", "percent", "unit",
  "date", "time", "datetime", "ymd", "hms",
  "add", "sub", "mul", "div", "mod", "abs", "clamp", "int", "float", "defaults", "coalesce", "number", "string", "nullIfEmpty",
];

/**
 * A `Map`, not a plain object: bracket access on an object lets the `Object.prototype` members
 * through as filters (`|toString` / `|constructor` / `|valueOf`), which then fail with a
 * meaningless TypeError instead of `[wcs/filter-unknown]`.
 */
const definitions = new Map<string, FilterDefinition>();

/** Name + arguments → the function already built for them (each is built once). */
const resolvedByKey = new Map<string, FilterFn>();

/**
 * The key of one argument list: **both the raw texts and the typed values** (B3 / B9).
 * - Raw texts alone would make `defaults(0)` and `defaults('0')` the same `["0"]`, sharing one
 *   function between two filters of different types.
 * - Typed values alone would fold `1` / `1.0` / `01` / `+1` into the same number, although the
 *   factories that read the raw text (`truncate` / `unit` / `join` / `ymd` / `padStart` …) answer
 *   them differently.
 * - A structural key, never `args.join(",")`: `['a,b']` and `['a', 'b']` are different arguments.
 */
export function filterArgsKey(args: readonly string[], literals: readonly unknown[]): string {
  return `${JSON.stringify(args)}${JSON.stringify(literals)}`;
}

/** Called by the install functions. Idempotent — a name registered again replaces the previous one. */
export function registerFilters(map: Record<string, FilterDefinition>): void {
  for (const name of Object.keys(map)) {
    // a copy: the registry keeps what was registered
    definitions.set(name, { ...map[name] });
  }
  // A new registration can change the answers already built (a page installs once; tests and
  // tooling swap registrations)
  resolvedByKey.clear();
}

export function hasFilter(name: string): boolean {
  return definitions.has(name);
}

/** The registered names, which the did-you-mean suggestion reads. */
export function knownFilterNames(): string[] {
  return [...definitions.keys()];
}

/** Drops the functions already built (tooling that clears its parser caches). */
export function clearFilterResolutionCache(): void {
  resolvedByKey.clear();
}

/**
 * `[wcs/filter-unknown]`. A formatting filter on a page without the formats add-on is not a typo:
 * that barrier is kept as full text, since it is met on pages without add-ons (the diagnostics
 * add-on adds the nearest name to either).
 */
function unknownFilter(name: string, known: Iterable<string>): never {
  if (FORMATS_FILTER_NAMES.includes(name)) {
    raiseError(`[wcs/filter-unknown] filter not found: ${name}. "${name}" is in the formats add-on — install it with installFeatures([formats]) from "@wcstack/state/features/formats".`, name, known);
  }
  raise(M.FilterUnknown, [name], name, known);
}

/**
 * The function for one use of a filter (binding planning). An unknown name or a wrong argument count
 * fails here, by name — the parser never rejects a filter.
 */
export function resolveFilter(name: string, options: string[], literals: readonly unknown[]): FilterFn {
  const key = `${name}${filterArgsKey(options, literals)}`;
  const resolved = resolvedByKey.get(key);
  if (typeof resolved !== "undefined") {
    return resolved;
  }
  const definition = definitions.get(name);
  if (definition === undefined) {
    unknownFilter(name, definitions.keys());
  }
  // Same vocabulary as lint's wcs/filter-arity
  const [min, max] = definition.arity;
  if (options.length < min) raise(M.FilterTooFewArgs, [name, min, options.length]);
  if (options.length > max) raise(M.FilterTooManyArgs, [name, max, options.length]);
  const filterFn = definition.factory(options, literals);
  resolvedByKey.set(key, filterFn);
  return filterFn;
}
