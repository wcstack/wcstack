/**
 * builtinFilters.ts
 *
 * Implementation file for built-in filter functions available in Structive.
 *
 * Main responsibilities:
 * - Provides filters for conversion, comparison, formatting, and validation of numbers, strings, dates, booleans, etc.
 * - Defines functions with options for each filter name, enabling flexible use during binding
 * - Designed for common use as both input and output filters
 *
 * Design points:
 * - Comprehensive coverage of diverse filters: eq, ne, lt, gt, inc, abs, clamp, fix, locale, uc, lc, cap, trim, slice, pad, truncate, join, int, float, round, percent, unit, date, time, ymd, hms, falsy, truthy, defaults, boolean, number, string, null, etc.
 * - Rich type checking and error handling for option values
 * - Centralized management of filter functions with FilterWithOptions type, easy to extend
 * - Dynamic retrieval of filter functions from filter names and options via builtinFilterFn
 */
import { config } from "../config.js";
import { didYouMean, LINT_HINT } from "../errorGuidance.js";
import { raiseError } from "../raiseError.js";
import { optionMustBeNumber, optionsRequired, valueMustBeArray, valueMustBeDate, valueMustBeNumber } from "./errorMessages.js";
import { FilterFn, FilterWithOptions, FilterWithOptionsFn } from "../filters/types";
import { builtinFilterAliases } from "../filters/filterAliases";

function validateNumberString(value: string): boolean {
  if (!value || isNaN(Number(value))) {
    return false;
  }
  return true;
}

/**
 * Reads one numeric option **at construction time** and returns the number itself.
 *
 * Every numeric filter used to write out the same three lines (`options?.[i] ?? optionsRequired`,
 * `validateNumberString`, `optionMustBeNumber`) and then call `Number(opt)` again on **every
 * apply**. Folding it here keeps the option checks in one place and takes the conversion off the
 * hot path.
 */
function numberOption(value: string, fnName: string): number {
  if (!validateNumberString(value)) {optionMustBeNumber(fnName);}
  return Number(value);
}

/** A required numeric option: missing → `optionsRequired`, non-numeric → `optionMustBeNumber`. */
function requiredNumberOption(options: string[] | undefined, index: number, fnName: string): number {
  return numberOption(options?.[index] ?? optionsRequired(fnName), fnName);
}

/**
 * Extends the display-side empty-value contract (requirement B8) to the formatting filters.
 *
 * A filter that builds its result with `String(value)` turns `undefined` / `null` into the
 * *characters* `"undefined"` / `"null"`, so `attr.title: x|trim` wrote `title="undefined"` where
 * the unfiltered `attr.title: x` correctly removes the attribute — one filter was enough to undo
 * what B8 established. This family therefore passes an absent value straight through and leaves
 * the decision to the apply side (attribute removed, class cleared, style cleared, text emptied).
 *
 * Deliberately **not** wrapped:
 * - filters for which an absent value *is* the input: `defaults` / `coalesce` / `nullIfEmpty` /
 *   `boolean` / `truthy` / `falsy` / `not` / `eq` / `ne`;
 * - the conversions, whose whole job is to convert: `int` / `float` / `number` / `string`;
 * - the filters that reject a value of the wrong type (the number, date and array families).
 *   Their throw is confined to the one binding and reported through `$errorCallback`
 *   (`apply/applyChangeFromBindings.ts`), which is a different quality of failure from silently
 *   painting the word "undefined" into the page.
 */
const nullishPassthrough = (factory: (options?: string[]) => FilterFn<string>): FilterWithOptionsFn =>
  (options?: string[]): FilterFn => {
    const filterFn = factory(options);
    // `== null` は null と undefined の両方（意図的な緩い比較）
    return (value: unknown): unknown => (value == null ? value : filterFn(value));
  };

/**
 * Equality filter - compares value with option.
 * 
 * @param options - Array with comparison value as first element
 * @returns Filter function that returns boolean
 */
const eq = (options?:string[], literals?: readonly unknown[]): FilterFn<boolean> => {
  const opt = options?.[0] ?? optionsRequired('eq');
  // The typed literal (B9): unquoted true / false / null / numbers are typed, quoted arguments are strings
  const literal = literals !== undefined && literals.length > 0 ? literals[0] : opt;
  return (value: unknown): boolean => {
    // Align types for comparison
    if (typeof value === 'number') {
      // A typed literal that is not a string compares as itself (B9). A number is never equal to
      // `true` / `false` / `null`, so `selectedId|eq(null)` is simply false once the id is a
      // number — it used to throw `optionMustBeNumber` on **every apply**, which broke every
      // binding on a path that is sometimes null and sometimes numeric. Only an unquoted
      // non-number (a bare string such as `eq(abc)`) still reports the type mismatch, and it has
      // to stay inside the closure: `eq` accepts values of any type, so `status|eq(active)` is
      // perfectly valid and cannot be rejected at construction the way `lt` / `add` can.
      if (typeof literal !== 'string') {return value === literal;}
      if (!validateNumberString(opt)) {optionMustBeNumber('eq');}
      return value === Number(opt);
    }
    if (typeof value === 'string') {
      return value === opt;
    }
    // Booleans, null and the rest compare with the typed literal: eq(true) matches true (B9)
    return value === literal;
  }
}

/**
 * Inequality filter - compares value with option.
 * 
 * @param options - Array with comparison value as first element
 * @returns Filter function that returns boolean
 */
const ne = (options?:string[], literals?: readonly unknown[]): FilterFn<boolean> => {
  const opt = options?.[0] ?? optionsRequired('ne');
  const literal = literals !== undefined && literals.length > 0 ? literals[0] : opt;
  return (value: unknown): boolean => {
    // Align types for comparison
    if (typeof value === 'number') {
      // Same as `eq`: a typed `true` / `false` / `null` compares as itself instead of being
      // forced through `Number()` (B9)
      if (typeof literal !== 'string') {return value !== literal;}
      if (!validateNumberString(opt)) {optionMustBeNumber('ne');}
      return value !== Number(opt);
    }
    if (typeof value === 'string') {
      return value !== opt;
    }
    // Booleans, null and the rest compare with the typed literal (B9)
    return value !== literal;
  }
}

/**
 * Boolean NOT filter - inverts the truthiness of the value.
 *
 * Deliberately the same lenient `!value` as the engine-owned copy in
 * `core/filterRegistry.ts` (`CORE_FILTERS.not`). `if:` / `else:` are built as one
 * `if` parse result plus an engine-injected `not` (`structural/createNotFilter.ts`),
 * and `apply/applyChangeToIf.ts` coerces the `if` side with `Boolean()`. A strict
 * `not` therefore made `else:` throw — and render neither branch — whenever the
 * condition was a falsy non-boolean (`0` / `""` / `undefined` / `null`). Keeping the
 * two implementations identical also means a page behaves the same whether or not
 * `features/formats` is installed (the split core entry registers no `not`).
 *
 * @param options - Unused
 * @returns Filter function that returns the inverted truthiness
 */
const not = (_options?:string[]): FilterFn<boolean> => {
  return (value: unknown): boolean => !value;
}

/**
 * Less than filter - checks if value is less than option.
 * 
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const lt = (options?:string[]): FilterFn<boolean> => {
  const opt = requiredNumberOption(options, 0, 'lt');
  return (value: unknown): boolean => {
    if (typeof value !== 'number') {valueMustBeNumber('lt');}
    return value < opt;
  }
}

/**
 * Less than or equal filter - checks if value is less than or equal to option.
 * 
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const le = (options?:string[]): FilterFn<boolean> => {
  const opt = requiredNumberOption(options, 0, 'le');
  return (value: unknown): boolean => {
    if (typeof value !== 'number') {valueMustBeNumber('le');}
    return value <= opt;
  }
}

/**
 * Greater than filter - checks if value is greater than option.
 * 
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const gt = (options?:string[]): FilterFn<boolean> => {
  const opt = requiredNumberOption(options, 0, 'gt');
  return (value: unknown): boolean => {
    if (typeof value !== 'number') {valueMustBeNumber('gt');}
    return value > opt;
  }
}

/**
 * Greater than or equal filter - checks if value is greater than or equal to option.
 * 
 * @param options - Array with comparison number as first element
 * @returns Filter function that returns boolean
 */
const ge = (options?:string[]): FilterFn<boolean> => {
  const opt = requiredNumberOption(options, 0, 'ge');
  return (value: unknown): boolean => {
    if (typeof value !== 'number') {valueMustBeNumber('ge');}
    return value >= opt;
  }
}

/**
 * Increment filter - adds option value to input value.
 * 
 * @param options - Array with increment number as first element
 * @returns Filter function that returns incremented number
 */
const inc = (options?:string[]): FilterFn<number> => {
  const opt = requiredNumberOption(options, 0, 'add');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('add');}
    return value + opt;
  }
}

/**
 * Decrement filter - subtracts option value from input value.
 * 
 * @param options - Array with decrement number as first element
 * @returns Filter function that returns decremented number
 */
const dec = (options?:string[]): FilterFn<number> => {
  const opt = requiredNumberOption(options, 0, 'sub');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('sub');}
    return value - opt;
  }
}

/**
 * Multiply filter - multiplies value by option.
 * 
 * @param options - Array with multiplier number as first element
 * @returns Filter function that returns multiplied number
 */
const mul = (options?:string[]): FilterFn<number> => {
  const opt = requiredNumberOption(options, 0, 'mul');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('mul');}
    return value * opt;
  }
}

/**
 * Divide filter - divides value by option.
 * 
 * @param options - Array with divisor number as first element
 * @returns Filter function that returns divided number
 */
const div = (options?:string[]): FilterFn<number> => {
  const opt = requiredNumberOption(options, 0, 'div');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('div');}
    return value / opt;
  }
}

/**
 * Modulo filter - returns remainder of division.
 * 
 * @param options - Array with divisor number as first element
 * @returns Filter function that returns remainder
 */
const mod = (options?:string[]): FilterFn<number> => {
  const opt = requiredNumberOption(options, 0, 'mod');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('mod');}
    return value % opt;
  }
}

/**
 * Absolute value filter - returns the magnitude of a number.
 *
 * @param options - Unused
 * @returns Filter function that returns the absolute value
 */
const abs = (_options?:string[]): FilterFn<number> => {
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('abs');}
    return Math.abs(value);
  }
}

/**
 * Clamp filter - constrains a number to the inclusive range [min, max].
 *
 * Saturating conversion in the same family as round/floor/ceil, so it stays on
 * the wire rather than in state. Pairs with `unit` for style bindings:
 * `style.width: ratio|clamp(0,1)|percent(0)`.
 *
 * @param options - Array with minimum as first element and maximum as second (both required)
 * @returns Filter function that returns the clamped number
 */
const clamp = (options?:string[]): FilterFn<number> => {
  const min = requiredNumberOption(options, 0, 'clamp');
  const max = requiredNumberOption(options, 1, 'clamp');
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('clamp');}
    return Math.min(Math.max(value, min), max);
  }
}

/**
 * Fixed decimal filter - formats number to fixed decimal places.
 *
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns formatted string
 */
const fix = (options?:string[]): FilterFn<string> => {
  const opt = numberOption(options?.[0] ?? "0", 'toFixed');
  return (value: unknown): string => {
    if (typeof value !== 'number') {valueMustBeNumber('toFixed');}
    return value.toFixed(opt);
  }
}

/**
 * Locale number filter - formats number according to locale.
 *
 * ロケール依存フィルタ（`locale` / `date` / `time` / `datetime`）は
 * **明示引数だけを構築時に確定し、既定の `config.locale` は適用のたびに読む**。
 *
 * 以前は `options?.[0] ?? config.locale` を返り値の関数の**外**で解決していた。
 * フィルタ関数はバインド構築時に一度だけ作られるので、これはロケールを
 * クロージャに焼き込むことを意味する。`config.locale` の確定がバインド構築より
 * 遅れると、それ以降どう直しても「同じページの中で日付だけ既定ロケール」が
 * 永続し、しかも `config.locale` は依存グラフに載らないので再描画で回復もしない。
 * 症状（日付だけ英語）は原因（起動順序）から遠く、追いにくい。
 *
 * 適用のたびに読めば、少なくとも**再適用されたバインドは回復する**。ロケールは
 * 起動時に確定する前提（docs/i18n-design.md D1）なので通常この差は現れず、
 * これは順序事故から復帰できるようにするための保険である。
 *
 * 明示引数（`|date(ja-JP)`）は構築時に固定でよい — バインド式の一部であり、
 * 実行中に変わらない。
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns localized number string
 */
const locale = (options?:string[]): FilterFn<string> => {
  const explicit = options?.[0];
  return (value: unknown): string => {
    if (typeof value !== 'number') {valueMustBeNumber('locale');}
    return value.toLocaleString(explicit ?? config.locale);
  }
}

/**
 * Uppercase filter - converts string to uppercase.
 * 
 * @param options - Unused
 * @returns Filter function that returns uppercase string
 */
const uc = (_options?:string[]): FilterFn<string> => {
  return (value: unknown): string => {
    return String(value).toUpperCase();
  }
}

/**
 * Lowercase filter - converts string to lowercase.
 * 
 * @param options - Unused
 * @returns Filter function that returns lowercase string
 */
const lc = (_options?:string[]): FilterFn<string> => {
  return (value: unknown): string => {
    return String(value).toLowerCase();
  }
}

/**
 * Capitalize filter - capitalizes first character of string.
 * 
 * @param options - Unused
 * @returns Filter function that returns capitalized string
 */
const cap = (_options?:string[]): FilterFn<string> => {
  return (value: unknown): string => {
    const v = String(value);
    if (v.length === 0) {return v;}
    if (v.length === 1) {return v.toUpperCase();}
    return v.charAt(0).toUpperCase() + v.slice(1);
  }
}

/**
 * Trim filter - removes whitespace from both ends of string.
 * 
 * @param options - Unused
 * @returns Filter function that returns trimmed string
 */
const trim = (_options?:string[]): FilterFn<string> => {
  return (value: unknown): string => {
    return String(value).trim();
  }
}

/**
 * Slice filter - extracts portion of string from specified index.
 * 
 * @param options - Array with start index and optional end index
 * @returns Filter function that returns sliced string
 */
const slice = (options?:string[]): FilterFn<string> => {
  const numberedOpts: number[] = [requiredNumberOption(options, 0, 'slice')];
  const opt2 = options?.[1];
  if (typeof opt2 !== 'undefined') {
    numberedOpts.push(numberOption(opt2, 'slice'));
  }
  return (value: unknown): string => {
    return String(value).slice(...numberedOpts);
  }
}

/**
 * Substring filter - extracts substring from specified position and length.
 * 
 * @param options - Array with start index and length
 * @returns Filter function that returns substring
 */
const substr = (options?:string[]): FilterFn<string> => {
  const opt1 = requiredNumberOption(options, 0, 'substr');
  const opt2 = requiredNumberOption(options, 1, 'substr');
  return (value: unknown): string => {
    return String(value).substr(opt1, opt2);
  }
}

/**
 * Pad filter - pads string to specified length from start.
 * 
 * @param options - Array with target length and pad string (default: '0')
 * @returns Filter function that returns padded string
 */
const pad = (options?:string[]): FilterFn<string> => {
  const opt1 = requiredNumberOption(options, 0, 'padStart');
  const opt2 = options?.[1] ?? '0';
  return (value: unknown): string => {
    return String(value).padStart(opt1, opt2);
  }
}

/**
 * padEnd filter - pads string to specified length from the end (the pair of `padStart`, requirement B12).
 *
 * @param options - Array with target length and pad string (default: ' ')
 * @returns Filter function that returns padded string
 */
const padEnd = (options?:string[]): FilterFn<string> => {
  const opt1 = requiredNumberOption(options, 0, 'padEnd');
  const opt2 = options?.[1] ?? ' ';
  return (value: unknown): string => {
    return String(value).padEnd(opt1, opt2);
  }
}

/**
 * Repeat filter - repeats string specified number of times.
 * 
 * @param options - Array with repeat count as first element
 * @returns Filter function that returns repeated string
 */
const rep = (options?:string[]): FilterFn<string> => {
  const opt = requiredNumberOption(options, 0, 'repeat');
  return (value: unknown): string => {
    return String(value).repeat(opt);
  }
}

/**
 * Reverse filter - reverses character order in string.
 * 
 * @param options - Unused
 * @returns Filter function that returns reversed string
 */
const rev = (_options?:string[]): FilterFn<string> => {
  return (value: unknown): string => {
    return String(value).split('').reverse().join('');
  }
}

/**
 * Integer filter - parses value to integer.
 * 
 * @param options - Unused
 * @returns Filter function that returns integer
 */
const int = (_options?:string[]): FilterFn<number> => {
  return (value: unknown): number => {
    return parseInt(String(value), 10);
  }
}

/**
 * Float filter - parses value to floating point number.
 * 
 * @param options - Unused
 * @returns Filter function that returns float
 */
const float = (_options?:string[]): FilterFn<number> => {
  return (value: unknown): number => {
    return parseFloat(String(value));
  }
}

/**
 * Round filter - rounds number to specified decimal places.
 * 
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns rounded number
 */
const round = (options?:string[]): FilterFn<number> => {
  const optValue = Math.pow(10, numberOption(options?.[0] ?? '0', 'round'));
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('round');}
    return Math.round(value * optValue) / optValue;
  }
}

/**
 * Floor filter - rounds number down to specified decimal places.
 * 
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns floored number
 */
const floor = (options?:string[]): FilterFn<number> => {
  const optValue = Math.pow(10, numberOption(options?.[0] ?? '0', 'floor'));
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('floor');}
    return Math.floor(value * optValue) / optValue;
  }
}

/**
 * Ceiling filter - rounds number up to specified decimal places.
 * 
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns ceiled number
 */
const ceil = (options?:string[]): FilterFn<number> => {
  const optValue = Math.pow(10, numberOption(options?.[0] ?? '0', 'ceil'));
  return (value: unknown): number => {
    if (typeof value !== 'number') {valueMustBeNumber('ceil');}
    return Math.ceil(value * optValue) / optValue;
  }
}

/**
 * Percent filter - formats number as percentage string.
 * 
 * @param options - Array with decimal places as first element (default: 0)
 * @returns Filter function that returns percentage string with '%'
 */
const percent = (options?:string[]): FilterFn<string> => {
  const opt = numberOption(options?.[0] ?? '0', 'percent');
  return (value: unknown): string => {
    if (typeof value !== 'number') {valueMustBeNumber('percent');}
    return `${(value * 100).toFixed(opt)}%`;
  }
}

/**
 * Unit filter - appends a CSS unit (or any suffix) to the value.
 *
 * A number alone does nothing in CSS, so without this the unit has to be built in
 * state — which drags presentation into the source of truth, and in the worst case
 * forces a whole derived array just to carry `"42%"` strings.
 * `style.height: samples.*.cpu|clamp(0,100)|fix(0)|unit(%)` keeps it on the wire.
 *
 * Accepts strings as well as numbers **on purpose**: the useful chains run through
 * `fix` / `percent`, which already return strings. Rejecting non-numbers here would
 * break exactly the combination this filter exists for.
 *
 * `null` / `undefined` pass through untouched rather than becoming `"undefinedpx"`, so the
 * binding layer's "undefined skips the write, null clears" semantics survive. That guard is no
 * longer written here: it is `nullishPassthrough`, shared with the rest of the `String(value)`
 * family, which used to paint `"undefined"` into the page for exactly the same reason.
 *
 * @param options - Array with the unit/suffix as first element (required)
 * @returns Filter function that returns the value with the unit appended
 */
const unit = (options?:string[]): FilterFn<string> => {
  const opt = options?.[0] ?? optionsRequired('unit');
  return (value: unknown): string => {
    return String(value) + opt;
  }
}

/**
 * Join filter - joins array elements into a string.
 *
 * The default separator is `", "` rather than `","`: a bare comma is what `String()`
 * already produces without any filter, so defaulting to it would make `|join` a no-op.
 *
 * @param options - Array with separator as first element (default: ', ')
 * @returns Filter function that returns the joined string
 */
const join = (options?:string[]): FilterFn<string> => {
  const opt = options?.[0] ?? ', ';
  return (value: unknown): string => {
    if (!Array.isArray(value)) {valueMustBeArray('join');}
    return value.join(opt);
  }
}

/**
 * Truncate filter - shortens a string and appends an ellipsis.
 *
 * The length option counts **kept characters**, not the total including the suffix,
 * matching the existing `slice(0, n)` reading. A string at or below the limit is
 * returned untouched (no suffix).
 *
 * @param options - Array with max kept length as first element and suffix as second (default: '…')
 * @returns Filter function that returns the truncated string
 */
const truncate = (options?:string[]): FilterFn<string> => {
  const maxLength = requiredNumberOption(options, 0, 'truncate');
  const suffix = options?.[1] ?? '…';
  return (value: unknown): string => {
    const v = String(value);
    if (v.length <= maxLength) {return v;}
    return v.slice(0, maxLength) + suffix;
  }
}

/**
 * Date filter - formats Date object as localized date string.
 *
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns date string
 */
const date = (options?:string[]): FilterFn<string> => {
  // 既定ロケールは適用のたびに読む（`locale` フィルタの注記を参照）
  const explicit = options?.[0];
  return (value: unknown): string => {
    if (!(value instanceof Date))  {valueMustBeDate('date');}
    return value.toLocaleDateString(explicit ?? config.locale);
  }
}

/**
 * Time filter - formats Date object as localized time string.
 * 
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns time string
 */
const time = (options?:string[]): FilterFn<string> => {
  // 既定ロケールは適用のたびに読む（`locale` フィルタの注記を参照）
  const explicit = options?.[0];
  return (value: unknown): string => {
    if (!(value instanceof Date)) {valueMustBeDate('time');}
    return value.toLocaleTimeString(explicit ?? config.locale);
  }
}

/**
 * DateTime filter - formats Date object as localized date and time string.
 * 
 * @param options - Array with locale string as first element (default: config.locale)
 * @returns Filter function that returns datetime string
 */
const datetime = (options?:string[]): FilterFn<string> => {
  // 既定ロケールは適用のたびに読む（`locale` フィルタの注記を参照）
  const explicit = options?.[0];
  return (value: unknown): string => {
    if (!(value instanceof Date)) {valueMustBeDate('datetime');}
    return value.toLocaleString(explicit ?? config.locale);
  }
}

/**
 * Year-Month-Day filter - formats Date object as YYYY-MM-DD string.
 * 
 * @param options - Array with separator string as first element (default: '-')
 * @returns Filter function that returns formatted date string
 */
const ymd = (options?:string[]): FilterFn<string> => {
  const opt = options?.[0] ?? '-';
  return (value: unknown): string => {
    if (!(value instanceof Date)) {valueMustBeDate('ymd');}
    const year = value.getFullYear().toString();
    const month = (value.getMonth() + 1).toString().padStart(2, '0');
    const day = value.getDate().toString().padStart(2, '0');
    return `${year}${opt}${month}${opt}${day}`;
  }
}

/**
 * Hour-Minute-Second filter - formats Date object as HH:MM:SS string.
 *
 * The counterpart of `ymd`: a fixed, zero-padded, locale-independent rendering with a
 * configurable separator, for when `time` (locale-formatted) is not stable enough.
 *
 * @param options - Array with separator string as first element (default: ':')
 * @returns Filter function that returns formatted time string
 */
const hms = (options?:string[]): FilterFn<string> => {
  const opt = options?.[0] ?? ':';
  return (value: unknown): string => {
    if (!(value instanceof Date)) {valueMustBeDate('hms');}
    const hours = value.getHours().toString().padStart(2, '0');
    const minutes = value.getMinutes().toString().padStart(2, '0');
    const seconds = value.getSeconds().toString().padStart(2, '0');
    return `${hours}${opt}${minutes}${opt}${seconds}`;
  }
}

/**
 * Falsy filter - checks if value is falsy, by JavaScript's own truthiness (`!value`: false, null,
 * undefined, 0, -0, 0n, '' and NaN). Before 3.0 the list was spelled out and missed 0n (B10).
 *
 * @param options - Unused
 * @returns Filter function that returns true for falsy values
 */
const falsy = (_options?:string[]): FilterFn<boolean> => {
  return (value: unknown): boolean => !value;
}

/**
 * Truthy filter - checks if value is truthy.
 * 
 * @param options - Unused
 * @returns Filter function that returns true for non-falsy values
 */
const truthy = (_options?:string[]): FilterFn<boolean> => {
  // JavaScript's truthiness, the same as the `boolean` filter (B10)
  return (value: unknown): boolean => !!value;
}

/**
 * Default filter - returns default value if input is falsy (JavaScript's truthiness, as `falsy`).
 * 
 * @param options - Array with default value as first element
 * @returns Filter function that returns value or default
 */
const defaults = (options?:string[], literals?: readonly unknown[]): FilterFn<unknown> => {
  const opt = options?.[0] ?? optionsRequired('defaults');
  // The fallback is the typed literal (B9): defaults(0) gives 0, defaults(null) gives null, defaults('0') gives "0"
  const fallback = literals !== undefined && literals.length > 0 ? literals[0] : opt;
  return (value: unknown): unknown => {
    if (!value) {return fallback;}
    return value;
  }
}

/**
 * coalesce filter - returns the default only for null / undefined (`defaults` also replaces 0, false and "").
 * Requirement B12: the nullish counterpart of `defaults`, read like SQL COALESCE.
 *
 * @param options - Array with default value as first element
 * @returns Filter function that returns value or default
 */
const coalesce = (options?:string[], literals?: readonly unknown[]): FilterFn<unknown> => {
  const opt = options?.[0] ?? optionsRequired('coalesce');
  const fallback = literals !== undefined && literals.length > 0 ? literals[0] : opt;
  return (value: unknown): unknown => value ?? fallback;
}

/**
 * Boolean filter - converts value to boolean.
 * 
 * @param options - Unused
 * @returns Filter function that returns boolean
 */
const boolean = (_options?:string[]): FilterFn<boolean> => {
  return (value: unknown): boolean => {
    return Boolean(value);
  }
}

/**
 * Number filter - converts value to number.
 * 
 * @param options - Unused
 * @returns Filter function that returns number
 */
const number = (_options?:string[]): FilterFn<number> => {
  return (value: unknown): number => {
    return Number(value);
  }
}

/**
 * String filter - converts value to string.
 * 
 * @param options - Unused
 * @returns Filter function that returns string
 */
const string = (_options?:string[]): FilterFn<string> => {
  return (value: unknown): string => {
    return String(value);
  }
}

/**
 * Null filter - converts empty string to null.
 * 
 * @param options - Unused
 * @returns Filter function that returns null for empty string, otherwise original value
 */
const _null = (_options?:string[]): FilterFn<unknown> => {
  return (value: unknown): unknown => {
    return (value === "") ? null : value;
  } 
}

const builtinFilters: FilterWithOptions = {
  "eq": eq,
  "ne": ne,
  "not": not,

  "lt": lt,
  "le": le,
  "gt": gt,
  "ge": ge,

  "add": inc,
  "sub": dec,
  "mul": mul,
  "div": div,
  "mod": mod,
  "abs": abs,
  "clamp": clamp,

  "toFixed": fix,
  "locale": locale,
  // `String(value)` で組み立てる族は、値が無いときに素通しする（要件 B8 — nullishPassthrough を参照）
  "upper": nullishPassthrough(uc),
  "lower": nullishPassthrough(lc),
  "capitalize": nullishPassthrough(cap),
  "trim": nullishPassthrough(trim),
  "slice": nullishPassthrough(slice),
  "substr": nullishPassthrough(substr),
  "padStart": nullishPassthrough(pad),
  "padEnd": nullishPassthrough(padEnd),
  "repeat": nullishPassthrough(rep),
  "reverse": nullishPassthrough(rev),
  "truncate": nullishPassthrough(truncate),
  "join": join,

  "int": int,
  "float": float,
  "round": round,
  "floor": floor,
  "ceil": ceil,
  "percent": percent,
  "unit": nullishPassthrough(unit),

  "date": date,
  "time": time,
  "datetime": datetime,
  "ymd": ymd,
  "hms": hms,

  "falsy": falsy,
  "truthy": truthy,
  "defaults": defaults,
  "coalesce": coalesce,

  "boolean": boolean,
  "number": number,
  "string": string,
  "nullIfEmpty": _null,
};

/**
 * The argument count each built-in accepts, [min, max] — checked when the bindings are planned
 * (`[wcs/filter-arity]`, requirement B3), with the same bounds lint uses. It is the same data as
 * `builtinFilterMeta` (filters/filterMeta.ts) without the descriptions, so that installing the formats
 * does not pull the metadata into the page; a test keeps the two equal.
 */
export const builtinFilterArity: Readonly<Record<string, readonly [number, number]>> = {
  eq: [1, 1],
  not: [0, 0],
  ne: [1, 1],
  lt: [1, 1],
  le: [1, 1],
  gt: [1, 1],
  ge: [1, 1],
  add: [1, 1],
  sub: [1, 1],
  mul: [1, 1],
  div: [1, 1],
  mod: [1, 1],
  abs: [0, 0],
  clamp: [2, 2],
  toFixed: [0, 1],
  locale: [0, 1],
  upper: [0, 0],
  lower: [0, 0],
  capitalize: [0, 0],
  trim: [0, 0],
  slice: [1, 2],
  // `substr` は長さも必須（実装が両方読む・README も `substr(start, length)`）。
  // [1, 2] だったころは `substr(0)` が引数の個数の検査を素通りし、工場の
  // 「requires at least one option」という的外れな文言で落ちていた
  substr: [2, 2],
  padStart: [1, 2],
  padEnd: [1, 2],
  repeat: [1, 1],
  reverse: [0, 0],
  truncate: [1, 2],
  join: [0, 1],
  int: [0, 0],
  float: [0, 0],
  round: [0, 1],
  floor: [0, 1],
  ceil: [0, 1],
  percent: [0, 1],
  unit: [1, 1],
  // ロケール依存の 3 つは `locale` と同じく引数 1 つ（`date(ja-JP)`）を受ける。
  // [0, 0] だったころは、README が規範として書いている `timestamp|date(ja-JP)` が
  // 束縛計画の段で必ず `[wcs/filter-arity]` になっていた（2.x には検査自体が無かった）
  date: [0, 1],
  time: [0, 1],
  datetime: [0, 1],
  ymd: [0, 1],
  hms: [0, 1],
  falsy: [0, 0],
  truthy: [0, 0],
  defaults: [1, 1],
  coalesce: [1, 1],
  boolean: [0, 0],
  number: [0, 0],
  string: [0, 0],
  nullIfEmpty: [0, 0],
};

export const outputBuiltinFilters = builtinFilters;
export const inputBuiltinFilters = builtinFilters;

export const builtinFiltersByFilterIOType = {
  "input": inputBuiltinFilters,
  "output": outputBuiltinFilters,
} as const;

/**
 * Retrieves built-in filter function by name and options.
 *
 * **Test / tooling only.** The binding pipeline never goes through here: it resolves
 * filters from the registry with `core/filterRegistry.ts#resolveFilterFn`, which also
 * checks `builtinFilterArity` and passes the **typed literals** (requirement B9).
 * This helper takes raw option strings only, so `builtinFilterFn("coalesce", ["0"])`
 * yields the string `"0"` where the runtime yields the number `0`. Prefer
 * `resolveFilterFn` in any new code, and treat a difference between the two as a
 * limitation of this helper rather than of the runtime.
 *
 * @param name - Filter name (a 3.x alias such as `uc` resolves to its canonical name)
 * @param options - Array of option strings
 * @returns Function that takes FilterWithOptions and returns filter function
 */
export const builtinFilterFn = (name:string, options: string[]) => (filters: FilterWithOptions) => {
  // 自前のキーだけを引く。素のオブジェクトへのブラケット参照だと `Object.prototype` のメンバが
  // フィルタとして通り（`toString` / `constructor` / `valueOf`）、`[wcs/filter-unknown]` の代わりに
  // `"[object Undefined]"` や素の TypeError が出ていた。登録簿（core/filterRegistry.ts）が
  // まさにこの穴のために `Map` を採っているのと同じ規準
  const own = Object.prototype.hasOwnProperty;
  const canonical = own.call(builtinFilterAliases, name) ? builtinFilterAliases[name] : name;
  const filter = own.call(filters, canonical) ? filters[canonical] : undefined;
  if (!filter) {
    // lint の wcs/filter-unknown と同じ語彙・同じ did-you-mean 規準（三面同語彙）。
    raiseError(`[wcs/filter-unknown] filter not found: ${name}.${didYouMean(name, Object.keys(filters))}${LINT_HINT}`);
  }
  return filter(options);
}

