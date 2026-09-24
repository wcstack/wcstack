/**
 * filters/core.ts — the core filter set (24): what the logic of a binding needs, as opposed to the
 * presentation the formats add-on (`./formats`) provides. Ported from `@wcstack/state`
 * (`formats/builtinFilters.ts`) with the semantics unchanged.
 *
 * - conditions: `eq ne not lt le gt ge truthy falsy boolean`
 * - arithmetic: `add sub mul div mod abs clamp`
 * - conversions: `number string int float`
 * - missing values: `defaults coalesce nullIfEmpty`
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

const lt = (options: string[]): FilterFn => {
  const opt = requiredNumberOption(options, 0, 'lt');
  return (value: unknown): boolean => {
    if (typeof value !== 'number') {valueMustBeNumber('lt');}
    return value < opt;
  };
};

const le = (options: string[]): FilterFn => {
  const opt = requiredNumberOption(options, 0, 'le');
  return (value: unknown): boolean => {
    if (typeof value !== 'number') {valueMustBeNumber('le');}
    return value <= opt;
  };
};

const gt = (options: string[]): FilterFn => {
  const opt = requiredNumberOption(options, 0, 'gt');
  return (value: unknown): boolean => {
    if (typeof value !== 'number') {valueMustBeNumber('gt');}
    return value > opt;
  };
};

const ge = (options: string[]): FilterFn => {
  const opt = requiredNumberOption(options, 0, 'ge');
  return (value: unknown): boolean => {
    if (typeof value !== 'number') {valueMustBeNumber('ge');}
    return value >= opt;
  };
};

/** JavaScript's truthiness, the same as `boolean` (B10). */
const truthy = (): FilterFn => (value: unknown): boolean => !!value;

/** JavaScript's falsiness (`!value`: false, null, undefined, 0, -0, 0n, '' and NaN — B10). */
const falsy = (): FilterFn => (value: unknown): boolean => !value;

const boolean = (): FilterFn => (value: unknown): boolean => Boolean(value);

const add = (options: string[]): FilterFn => {
  const opt = requiredNumberOption(options, 0, 'add');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('add');}
    return value + opt;
  };
};

const sub = (options: string[]): FilterFn => {
  const opt = requiredNumberOption(options, 0, 'sub');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('sub');}
    return value - opt;
  };
};

const mul = (options: string[]): FilterFn => {
  const opt = requiredNumberOption(options, 0, 'mul');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('mul');}
    return value * opt;
  };
};

const div = (options: string[]): FilterFn => {
  const opt = requiredNumberOption(options, 0, 'div');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('div');}
    return value / opt;
  };
};

const mod = (options: string[]): FilterFn => {
  const opt = requiredNumberOption(options, 0, 'mod');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('mod');}
    return value % opt;
  };
};

const abs = (): FilterFn => (value: unknown): number => {
  if (typeof value !== 'number') {valueMustBeNumber('abs');}
  return Math.abs(value);
};

/** Constrains a number to the inclusive range [min, max] (`style.width: ratio|clamp(0,1)|percent(0)`). */
const clamp = (options: string[]): FilterFn => {
  const min = requiredNumberOption(options, 0, 'clamp');
  const max = requiredNumberOption(options, 1, 'clamp');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('clamp');}
    return Math.min(Math.max(value, min), max);
  };
};

// The conversions convert — an absent value is converted too (`string` gives "undefined");
// put `coalesce` in front when a missing value should not be converted.
const number = (): FilterFn => (value: unknown): number => Number(value);

const string = (): FilterFn => (value: unknown): string => String(value);

const int = (): FilterFn => (value: unknown): number => parseInt(String(value), 10);

const float = (): FilterFn => (value: unknown): number => parseFloat(String(value));

/** Replaces a falsy value (JavaScript's truthiness) with the typed literal: defaults(0) gives 0, defaults('0') "0" (B9). */
const defaults = (options: string[], literals?: readonly unknown[]): FilterFn => {
  const opt = options?.[0] ?? optionsRequired('defaults');
  const fallback = firstLiteral(opt, literals);
  return (value: unknown): unknown => {
    if (!value) {return fallback;}
    return value;
  };
};

/** Replaces only null / undefined (`defaults` also replaces 0, false and "") — SQL's COALESCE. */
const coalesce = (options: string[], literals?: readonly unknown[]): FilterFn => {
  const opt = options?.[0] ?? optionsRequired('coalesce');
  const fallback = firstLiteral(opt, literals);
  return (value: unknown): unknown => value ?? fallback;
};

/** "" → null, anything else unchanged. */
const nullIfEmpty = (): FilterFn => (value: unknown): unknown => (value === "") ? null : value;

/**
 * The core set: factory and [min, max] argument count (B3 — the same bounds lint uses).
 *
 * The key order is the source's (`builtinFilterMeta`, which lint reads) and is load-bearing: the
 * did-you-mean suggestion breaks ties by registration order, so keeping lint's relative order keeps
 * the console and lint proposing the same name.
 */
export const coreFilters: Readonly<Record<string, FilterDefinition>> = {
  eq: { factory: eq, arity: [1, 1] },
  ne: { factory: ne, arity: [1, 1] },
  not: { factory: not, arity: [0, 0] },
  lt: { factory: lt, arity: [1, 1] },
  le: { factory: le, arity: [1, 1] },
  gt: { factory: gt, arity: [1, 1] },
  ge: { factory: ge, arity: [1, 1] },
  add: { factory: add, arity: [1, 1] },
  sub: { factory: sub, arity: [1, 1] },
  mul: { factory: mul, arity: [1, 1] },
  div: { factory: div, arity: [1, 1] },
  mod: { factory: mod, arity: [1, 1] },
  abs: { factory: abs, arity: [0, 0] },
  clamp: { factory: clamp, arity: [2, 2] },
  int: { factory: int, arity: [0, 0] },
  float: { factory: float, arity: [0, 0] },
  falsy: { factory: falsy, arity: [0, 0] },
  truthy: { factory: truthy, arity: [0, 0] },
  defaults: { factory: defaults, arity: [1, 1] },
  coalesce: { factory: coalesce, arity: [1, 1] },
  boolean: { factory: boolean, arity: [0, 0] },
  number: { factory: number, arity: [0, 0] },
  string: { factory: string, arity: [0, 0] },
  nullIfEmpty: { factory: nullIfEmpty, arity: [0, 0] },
};

let installed = false;

/** Puts the core set in the registry. Idempotent; the engine calls it before planning any binding. */
export function installCoreFilters(): void {
  if (installed) return;
  installed = true;
  registerFilters(coreFilters);
}
