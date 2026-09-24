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
import { didYouMean, LINT_HINT } from "./errorGuidance";
import { raiseError } from "./errorMessages";

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
 * The names the formats add-on registers. Only the names live here (not the code), so that a page
 * without the add-on can still say where a formatting filter comes from instead of calling it a
 * typo. A test keeps this list equal to the add-on's table.
 */
export const FORMATS_FILTER_NAMES: readonly string[] = [
  "toFixed", "locale",
  "upper", "lower", "capitalize", "trim", "slice", "substr", "padStart", "padEnd", "repeat", "reverse", "truncate", "join",
  "round", "floor", "ceil", "percent", "unit",
  "date", "time", "datetime", "ymd", "hms",
];

/**
 * A `Map`, not a plain object: bracket access on an object lets the `Object.prototype` members
 * through as filters (`|toString` / `|constructor` / `|valueOf`), which then fail with a
 * meaningless TypeError instead of `[wcs/filter-unknown]`.
 */
const factories = new Map<string, FilterFactory>();
const arities = new Map<string, readonly [number, number]>();

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
    const definition = map[name];
    factories.set(name, definition.factory);
    arities.set(name, definition.arity);
  }
  // A new registration can change the answers already built (a page installs once; tests and
  // tooling swap registrations)
  resolvedByKey.clear();
}

export function hasFilter(name: string): boolean {
  return factories.has(name);
}

/** The registered names, which the did-you-mean suggestion reads. */
export function knownFilterNames(): string[] {
  return [...factories.keys()];
}

/** Drops the functions already built (tooling that clears its parser caches). */
export function clearFilterResolutionCache(): void {
  resolvedByKey.clear();
}

/** The `[wcs/filter-unknown]` message — same vocabulary and did-you-mean as lint's diagnostic. */
function unknownFilterMessage(name: string): string {
  let addOn = "";
  if (FORMATS_FILTER_NAMES.includes(name)) {
    // Not a typo: the page did not install the add-on the filter belongs to
    addOn = ` "${name}" is in the formats add-on — install it with installFormats().`;
  } else if (!FORMATS_FILTER_NAMES.some((formatName) => factories.has(formatName))) {
    addOn = " No formatting filters are installed — add them with installFormats() (the formats add-on).";
  }
  return `[wcs/filter-unknown] filter not found: ${name}.${didYouMean(name, factories.keys())}${addOn}${LINT_HINT}`;
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
  const factory = factories.get(name);
  if (typeof factory === "undefined") {
    raiseError(unknownFilterMessage(name));
  }
  const bounds = arities.get(name) as readonly [number, number];
  if (options.length < bounds[0] || options.length > bounds[1]) {
    // Same vocabulary as lint's wcs/filter-arity
    raiseError(options.length < bounds[0]
      ? `[wcs/filter-arity] filter "${name}" requires at least ${bounds[0]} argument(s) (${options.length} given).${LINT_HINT}`
      : `[wcs/filter-arity] filter "${name}" accepts at most ${bounds[1]} argument(s) (${options.length} given).${LINT_HINT}`);
  }
  const filterFn = factory(options, literals);
  resolvedByKey.set(key, filterFn);
  return filterFn;
}
