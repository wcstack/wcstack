/**
 * filters/formats.ts — the formats add-on (24 filters): presentation, as opposed to the logic the
 * core set (`./core`) provides. Ported from `@wcstack/state` (`formats/builtinFilters.ts`) with the
 * semantics unchanged.
 *
 * - number display: `toFixed round floor ceil percent unit locale`
 * - string shaping: `upper lower capitalize trim slice substr padStart padEnd repeat reverse truncate join`
 * - date and time: `date time datetime ymd hms`
 *
 * `installFormats()` puts them in the registry. Without it, a formatting filter fails when the
 * bindings are planned with `[wcs/filter-unknown]` naming this add-on (never passes silently).
 * The locale-dependent four (`locale date time datetime`) read `config.locale` as their default.
 */
import { config } from "../config";
import { optionsRequired, valueMustBeArray, valueMustBeDate, valueMustBeNumber } from "./errorMessages";
import { numberOption, requiredNumberOption } from "./options";
import { registerFilters, type FilterDefinition, type FilterFactory, type FilterFn } from "./registry";

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
    return value.toLocaleString(explicit ?? config.locale);
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

/** `substr(start, length)` — both required. */
const substr = (options: string[]): FilterFn => {
  const opt1 = requiredNumberOption(options, 0, 'substr');
  const opt2 = requiredNumberOption(options, 1, 'substr');
  return (value: unknown): string => String(value).substr(opt1, opt2);
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
    return value.toLocaleDateString(explicit ?? config.locale);
  };
};

/** Locale-formatted time (the default locale is read per apply — see `locale`). */
const time = (options: string[]): FilterFn => {
  const explicit = options?.[0];
  return (value: unknown): string => {
    if (!(value instanceof Date)) {valueMustBeDate('time');}
    return value.toLocaleTimeString(explicit ?? config.locale);
  };
};

/** Locale-formatted date and time (the default locale is read per apply — see `locale`). */
const datetime = (options: string[]): FilterFn => {
  const explicit = options?.[0];
  return (value: unknown): string => {
    if (!(value instanceof Date)) {valueMustBeDate('datetime');}
    return value.toLocaleString(explicit ?? config.locale);
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

/**
 * The formats add-on: factory and [min, max] argument count (B3 — the same bounds lint uses).
 * The key order is the source's, for the did-you-mean tie-breaking (see `coreFilters`).
 */
export const formatFilters: Readonly<Record<string, FilterDefinition>> = {
  toFixed: { factory: toFixed, arity: [0, 1] },
  locale: { factory: locale, arity: [0, 1] },

  // The `String(value)` family passes an absent value through (B8 — see nullishPassthrough)
  upper: { factory: nullishPassthrough(upper), arity: [0, 0] },
  lower: { factory: nullishPassthrough(lower), arity: [0, 0] },
  capitalize: { factory: nullishPassthrough(capitalize), arity: [0, 0] },
  trim: { factory: nullishPassthrough(trim), arity: [0, 0] },
  slice: { factory: nullishPassthrough(slice), arity: [1, 2] },
  // The length is required too (the implementation reads both)
  substr: { factory: nullishPassthrough(substr), arity: [2, 2] },
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
};

let installed = false;

/** Puts the formats add-on in the registry. Idempotent. */
export function installFormats(): void {
  if (installed) return;
  installed = true;
  registerFilters(formatFilters);
}
