/**
 * filters/formats.ts — the formats add-on (37 filters): the values a binding computes and shows, as
 * opposed to the conditions the core set (`./core`) tests. Ported from `@wcstack/state`
 * (`formats/builtinFilters.ts`) with the semantics unchanged.
 *
 * - number display: `toFixed round floor ceil percent unit locale`
 * - string shaping: `upper lower capitalize trim slice padStart padEnd repeat reverse truncate join`
 *   (`substr` was removed in 4.0: `slice(start, start + length)`)
 * - date and time: `date time datetime ymd hms`
 * - arithmetic: `add sub mul div mod abs clamp`
 * - conversions: `number string int float`
 * - missing values: `defaults coalesce nullIfEmpty`
 *
 * (The last three groups were the core's up to 4.0.0-rc.3.)
 *
 * `installFormats()` puts them in the registry. Without it, one of these filters fails when the
 * bindings are planned with `[wcs/filter-unknown]` naming this add-on (never passes silently).
 * The locale-dependent four (`locale date time datetime`) read `config.locale` as their default.
 */
import { config } from "../config";
import { optionsRequired, valueMustBeArray, valueMustBeDate, valueMustBeNumber } from "./errorMessages";
import { firstLiteral, numberOption, requiredNumberOption } from "./options";
import { registerFilters, type FilterDefinition, type FilterFactory, type FilterFn } from "./registry";
import { coreFilters, numeric } from "./core";
import { M, text } from "../messages";

/**
 * Extends the display-side empty-value contract (requirement B8) to the filters that build their
 * result with `String(value)`: those turn `undefined` / `null` into the *characters* "undefined" /
 * "null", so `attr.title: x|trim` wrote `title="undefined"` where `attr.title: x` removes the
 * attribute. This family passes an absent value straight through and leaves the decision to the
 * apply side (attribute removed, class cleared, style cleared, text emptied).
 *
 * Deliberately **not** wrapped: the filters that reject a value of the wrong type (the number, date
 * and array families) — their throw is confined to the one binding and reported, a different
 * quality of failure from painting the word "undefined" into the page.
 */
const nullishPassthrough = (factory: (options: string[]) => FilterFn): FilterFactory =>
  (options: string[]): FilterFn => {
    const filterFn = factory(options);
    // `== null` matches both null and undefined (deliberately loose)
    return (value: unknown): unknown => (value == null ? value : filterFn(value));
  };

/** Fixed decimals (default 0). */
const toFixed = (options: string[]): FilterFn => {
  const opt = numberOption(options?.[0] ?? "0", 'toFixed');
  return (value: unknown): string => {
    if (typeof value !== 'number') {valueMustBeNumber('toFixed');}
    return value.toFixed(opt);
  };
};

/** Rounds to the given decimals (default 0). */
const round = (options: string[]): FilterFn => {
  const optValue = Math.pow(10, numberOption(options?.[0] ?? '0', 'round'));
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('round');}
    return Math.round(value * optValue) / optValue;
  };
};

/** Rounds down to the given decimals (default 0). */
const floor = (options: string[]): FilterFn => {
  const optValue = Math.pow(10, numberOption(options?.[0] ?? '0', 'floor'));
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('floor');}
    return Math.floor(value * optValue) / optValue;
  };
};

/** Rounds up to the given decimals (default 0). */
const ceil = (options: string[]): FilterFn => {
  const optValue = Math.pow(10, numberOption(options?.[0] ?? '0', 'ceil'));
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('ceil');}
    return Math.ceil(value * optValue) / optValue;
  };
};

/** `0.123` → `"12%"` with the given decimals (default 0). */
const percent = (options: string[]): FilterFn => {
  const opt = numberOption(options?.[0] ?? '0', 'percent');
  return (value: unknown): string => {
    if (typeof value !== 'number') {valueMustBeNumber('percent');}
    return `${(value * 100).toFixed(opt)}%`;
  };
};

/**
 * Appends a CSS unit (or any suffix). Accepts strings as well as numbers **on purpose**: the useful
 * chains run through `toFixed` / `percent`, which already return strings
 * (`style.height: cpu|clamp(0,100)|toFixed(0)|unit(%)`). null / undefined pass through
 * (`nullishPassthrough`) rather than becoming "undefinedpx".
 */
const unit = (options: string[]): FilterFn => {
  const opt = options?.[0] ?? optionsRequired('unit');
  return (value: unknown): string => String(value) + opt;
};

let seen: string | undefined;
let valid = "en";

/**
 * The default locale (`config.locale`) as Intl takes it, checked when it changes (an identity
 * compare per apply): one it does not (`<html lang="en_US">`) is "en" (as 3.x), with a warning.
 */
function defaultLocale(): string {
  if (config.locale !== seen) {
    seen = config.locale;
    try {
      valid = Intl.getCanonicalLocales(seen)[0];
    } catch {
      console.warn(`[@wcstack/state] ${text(M.LocaleInvalid, [seen])}`);
      valid = "en";
    }
  }
  return valid;
}

/**
 * Locale-formatted number. The locale-dependent filters (`locale date time datetime`) fix an
 * **explicit** locale at construction but read the default `config.locale` **on every apply**: a
 * default baked into the closure at binding time would make an ordering accident (locale settled
 * after the bindings) permanent, since `config.locale` is not in the dependency graph. Read per
 * apply, a re-applied binding at least recovers.
 */
const locale = (options: string[]): FilterFn => {
  const explicit = options?.[0];
  return (value: unknown): string => {
    if (typeof value !== 'number') {valueMustBeNumber('locale');}
    return value.toLocaleString(explicit ?? defaultLocale());
  };
};

const upper = (): FilterFn => (value: unknown): string => String(value).toUpperCase();

const lower = (): FilterFn => (value: unknown): string => String(value).toLowerCase();

const capitalize = (): FilterFn => (value: unknown): string => {
  const v = String(value);
  if (v.length === 0) {return v;}
  if (v.length === 1) {return v.toUpperCase();}
  return v.charAt(0).toUpperCase() + v.slice(1);
};

const trim = (): FilterFn => (value: unknown): string => String(value).trim();

/** `slice(start[, end])`. */
const slice = (options: string[]): FilterFn => {
  const numberedOpts: number[] = [requiredNumberOption(options, 0, 'slice')];
  const opt2 = options?.[1];
  if (typeof opt2 !== 'undefined') {
    numberedOpts.push(numberOption(opt2, 'slice'));
  }
  return (value: unknown): string => String(value).slice(...numberedOpts);
};

/** Pads the start to a length; the pad string defaults to '0' (JavaScript's default is a space). */
const padStart = (options: string[]): FilterFn => {
  const opt1 = requiredNumberOption(options, 0, 'padStart');
  const opt2 = options?.[1] ?? '0';
  return (value: unknown): string => String(value).padStart(opt1, opt2);
};

/** Pads the end to a length; the pad string defaults to ' ' (as in JavaScript). */
const padEnd = (options: string[]): FilterFn => {
  const opt1 = requiredNumberOption(options, 0, 'padEnd');
  const opt2 = options?.[1] ?? ' ';
  return (value: unknown): string => String(value).padEnd(opt1, opt2);
};

const repeat = (options: string[]): FilterFn => {
  const opt = requiredNumberOption(options, 0, 'repeat');
  return (value: unknown): string => String(value).repeat(opt);
};

const reverse = (): FilterFn => (value: unknown): string => String(value).split('').reverse().join('');

/**
 * Shortens a string and appends a suffix (default '…', U+2026). The length counts **kept
 * characters**; a string at or below it is returned untouched (no suffix).
 */
const truncate = (options: string[]): FilterFn => {
  const maxLength = requiredNumberOption(options, 0, 'truncate');
  const suffix = options?.[1] ?? '…';
  return (value: unknown): string => {
    const v = String(value);
    if (v.length <= maxLength) {return v;}
    return v.slice(0, maxLength) + suffix;
  };
};

/**
 * Joins an array. The default separator is ", " rather than ",": a bare comma is what `String()`
 * already produces, so defaulting to it would make `|join` a no-op.
 */
const join = (options: string[]): FilterFn => {
  const opt = options?.[0] ?? ', ';
  return (value: unknown): string => {
    if (!Array.isArray(value)) {valueMustBeArray('join');}
    return value.join(opt);
  };
};

/** Locale-formatted date (the default locale is read per apply — see `locale`). */
const date = (options: string[]): FilterFn => {
  const explicit = options?.[0];
  return (value: unknown): string => {
    if (!(value instanceof Date)) {valueMustBeDate('date');}
    return value.toLocaleDateString(explicit ?? defaultLocale());
  };
};

/** Locale-formatted time (the default locale is read per apply — see `locale`). */
const time = (options: string[]): FilterFn => {
  const explicit = options?.[0];
  return (value: unknown): string => {
    if (!(value instanceof Date)) {valueMustBeDate('time');}
    return value.toLocaleTimeString(explicit ?? defaultLocale());
  };
};

/** Locale-formatted date and time (the default locale is read per apply — see `locale`). */
const datetime = (options: string[]): FilterFn => {
  const explicit = options?.[0];
  return (value: unknown): string => {
    if (!(value instanceof Date)) {valueMustBeDate('datetime');}
    return value.toLocaleString(explicit ?? defaultLocale());
  };
};

/** YYYY-MM-DD with a configurable separator (default '-'), locale-independent. */
const ymd = (options: string[]): FilterFn => {
  const opt = options?.[0] ?? '-';
  return (value: unknown): string => {
    if (!(value instanceof Date)) {valueMustBeDate('ymd');}
    const year = value.getFullYear().toString();
    const month = (value.getMonth() + 1).toString().padStart(2, '0');
    const day = value.getDate().toString().padStart(2, '0');
    return `${year}${opt}${month}${opt}${day}`;
  };
};

/** HH:MM:SS with a configurable separator (default ':'), zero-padded and locale-independent. */
const hms = (options: string[]): FilterFn => {
  const opt = options?.[0] ?? ':';
  return (value: unknown): string => {
    if (!(value instanceof Date)) {valueMustBeDate('hms');}
    const hours = value.getHours().toString().padStart(2, '0');
    const minutes = value.getMinutes().toString().padStart(2, '0');
    const seconds = value.getSeconds().toString().padStart(2, '0');
    return `${hours}${opt}${minutes}${opt}${seconds}`;
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

const { eq, ne, not, lt, le, gt, ge, falsy, truthy, boolean } = coreFilters;

/**
 * What `installFormats()` registers: factory and [min, max] argument count (B3 — the same bounds
 * lint uses), in the order the registry keeps them. The did-you-mean suggestion gives a tie to the
 * first registered, so the order is the one the full build registered up to 4.0.0-rc.3, when this
 * add-on had the 23 display filters and the core 24: the display filters, then that core set, each
 * in the source's (lint's) relative order. The core's 10 are registered here too, in their place
 * (the core registers them again when it first plans a binding, and a name registered again keeps
 * its place).
 */
const registered: Readonly<Record<string, FilterDefinition>> = {
  toFixed: { factory: toFixed, arity: [0, 1] },
  locale: { factory: locale, arity: [0, 1] },

  // The `String(value)` family passes an absent value through (B8 — see nullishPassthrough)
  upper: { factory: nullishPassthrough(upper), arity: [0, 0] },
  lower: { factory: nullishPassthrough(lower), arity: [0, 0] },
  capitalize: { factory: nullishPassthrough(capitalize), arity: [0, 0] },
  trim: { factory: nullishPassthrough(trim), arity: [0, 0] },
  slice: { factory: nullishPassthrough(slice), arity: [1, 2] },
  // The length is required too (the implementation reads both)
  padStart: { factory: nullishPassthrough(padStart), arity: [1, 2] },
  padEnd: { factory: nullishPassthrough(padEnd), arity: [1, 2] },
  repeat: { factory: nullishPassthrough(repeat), arity: [1, 1] },
  reverse: { factory: nullishPassthrough(reverse), arity: [0, 0] },
  truncate: { factory: nullishPassthrough(truncate), arity: [1, 2] },
  join: { factory: join, arity: [0, 1] },

  round: { factory: round, arity: [0, 1] },
  floor: { factory: floor, arity: [0, 1] },
  ceil: { factory: ceil, arity: [0, 1] },
  percent: { factory: percent, arity: [0, 1] },
  unit: { factory: nullishPassthrough(unit), arity: [1, 1] },

  // The locale-dependent three take a locale like `locale` does (`date(ja-JP)`)
  date: { factory: date, arity: [0, 1] },
  time: { factory: time, arity: [0, 1] },
  datetime: { factory: datetime, arity: [0, 1] },
  ymd: { factory: ymd, arity: [0, 1] },
  hms: { factory: hms, arity: [0, 1] },

  // the core set of 4.0.0-rc.3 (the core's own: eq ne not lt le gt ge falsy truthy boolean)
  eq, ne, not, lt, le, gt, ge,
  add: numeric('add', (value, opt) => value + opt),
  sub: numeric('sub', (value, opt) => value - opt),
  mul: numeric('mul', (value, opt) => value * opt),
  div: numeric('div', (value, opt) => value / opt),
  mod: numeric('mod', (value, opt) => value % opt),
  abs: { factory: abs, arity: [0, 0] },
  clamp: { factory: clamp, arity: [2, 2] },
  int: { factory: int, arity: [0, 0] },
  float: { factory: float, arity: [0, 0] },
  falsy, truthy,
  defaults: { factory: defaults, arity: [1, 1] },
  coalesce: { factory: coalesce, arity: [1, 1] },
  boolean,
  number: { factory: number, arity: [0, 0] },
  string: { factory: string, arity: [0, 0] },
  nullIfEmpty: { factory: nullIfEmpty, arity: [0, 0] },
};

/** The formats add-on's own filters (what `registered` holds beyond the core set), in that order. */
export const formatFilters: Readonly<Record<string, FilterDefinition>> = /*#__PURE__*/ Object.fromEntries(
  /*#__PURE__*/ Object.entries(registered).filter(([name]) => !(name in coreFilters)),
);

let installed = false;

/** Puts the formats add-on in the registry. Idempotent. */
export function installFormats(): void {
  if (installed) return;
  installed = true;
  registerFilters(registered);
}
