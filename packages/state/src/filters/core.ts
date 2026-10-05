/**
 * filters/core.ts — the core filter set (10): the conditions a binding tests, as opposed to the
 * values the formats add-on (`./formats`) computes and shows. Ported from `@wcstack/state`
 * (`formats/builtinFilters.ts`) with the semantics unchanged.
 *
 * - conditions: `eq ne not lt le gt ge truthy falsy boolean`
 *
 * The arithmetic (`add sub mul div mod abs clamp`), conversion (`number string int float`) and
 * missing-value (`defaults coalesce nullIfEmpty`) filters were here up to 4.0.0-rc.3; they are the
 * formats add-on's since, for the core's size target.
 *
 * `installCoreFilters()` puts them in the registry; the engine calls it before it plans bindings
 * (`else:` is built with an injected `not`, so the core set is never optional).
 */
import { optionMustBeNumber, optionsRequired, valueMustBeNumber } from "./errorMessages";
import { firstLiteral, requiredNumberOption, validateNumberString } from "./options";
import { registerFilters, type FilterDefinition, type FilterFn } from "./registry";

/** Equality — compares with the option (a typed literal compares as itself, B9). */
const eq = (options: string[], literals?: readonly unknown[]): FilterFn => {
  const opt = options?.[0] ?? optionsRequired('eq');
  const literal = firstLiteral(opt, literals);
  return (value: unknown): boolean => {
    if (typeof value === 'number') {
      // A typed literal that is not a string compares as itself (B9): a number is never equal to
      // `true` / `false` / `null`, so `selectedId|eq(null)` is false once the id is a number instead
      // of throwing on every apply. Only an unquoted non-number (`eq(abc)`) still reports the type
      // mismatch, and it has to stay here: `eq` accepts values of any type (`status|eq(active)` is
      // valid), so it cannot be rejected at construction the way `lt` / `add` can.
      if (typeof literal !== 'string') {return value === literal;}
      if (!validateNumberString(opt)) {optionMustBeNumber('eq');}
      return value === Number(opt);
    }
    if (typeof value === 'string') {
      return value === opt;
    }
    // Booleans, null and the rest compare with the typed literal: eq(true) matches true (B9)
    return value === literal;
  };
};

/** Inequality — the negation of `eq`, with the same typing rules (B9). */
const ne = (options: string[], literals?: readonly unknown[]): FilterFn => {
  const opt = options?.[0] ?? optionsRequired('ne');
  const literal = firstLiteral(opt, literals);
  return (value: unknown): boolean => {
    if (typeof value === 'number') {
      if (typeof literal !== 'string') {return value !== literal;}
      if (!validateNumberString(opt)) {optionMustBeNumber('ne');}
      return value !== Number(opt);
    }
    if (typeof value === 'string') {
      return value !== opt;
    }
    return value !== literal;
  };
};

/**
 * Inverts truthiness (lenient `!value`). `else:` is built as the `if` condition plus an injected
 * `not`, and `if:` coerces with `Boolean()`; a strict `not` made `else:` throw — rendering neither
 * branch — whenever the condition was a falsy non-boolean (`0` / `""` / `undefined` / `null`).
 */
const not = (): FilterFn => (value: unknown): boolean => !value;

/**
 * A comparison or arithmetic filter: one numeric option, a number value (`lt` … `ge` here, `add` …
 * `mod` in the formats add-on).
 */
export const numeric = (name: string, op: (value: number, opt: number) => unknown): FilterDefinition => ({
  factory: (options: string[]): FilterFn => {
    const opt = requiredNumberOption(options, 0, name);
    return (value: unknown): unknown => {
      if (typeof value !== 'number') {valueMustBeNumber(name);}
      return op(value, opt);
    };
  },
  arity: [1, 1],
});

/** JavaScript's truthiness, the same as `boolean` (B10). */
const truthy = (): FilterFn => (value: unknown): boolean => !!value;

/** JavaScript's falsiness (`!value`: false, null, undefined, 0, -0, 0n, '' and NaN — B10). */
const falsy = (): FilterFn => (value: unknown): boolean => !value;

const boolean = (): FilterFn => (value: unknown): boolean => Boolean(value);

/**
 * The core set: factory and [min, max] argument count (B3 — the same bounds lint uses).
 *
 * The key order is the source's (`builtinFilterMeta`, which lint reads): the did-you-mean
 * suggestion breaks ties by registration order (see `installFormats` for the order the full
 * build registers).
 */
export const coreFilters: Readonly<Record<string, FilterDefinition>> = {
  eq: { factory: eq, arity: [1, 1] },
  ne: { factory: ne, arity: [1, 1] },
  not: { factory: not, arity: [0, 0] },
  lt: numeric('lt', (value, opt) => value < opt),
  le: numeric('le', (value, opt) => value <= opt),
  gt: numeric('gt', (value, opt) => value > opt),
  ge: numeric('ge', (value, opt) => value >= opt),
  falsy: { factory: falsy, arity: [0, 0] },
  truthy: { factory: truthy, arity: [0, 0] },
  boolean: { factory: boolean, arity: [0, 0] },
};

let installed = false;

/** Puts the core set in the registry. Idempotent; the engine calls it before planning any binding. */
export function installCoreFilters(): void {
  if (installed) return;
  installed = true;
  registerFilters(coreFilters);
}
