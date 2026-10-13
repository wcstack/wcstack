/**
 * filters/errorMessages.ts — the filters' error messages, ported from `@wcstack/state`
 * (`formats/errorMessages.ts`). Numbered core messages (src/messages.ts): the sentences, the same
 * as the source's, are the diagnostics add-on's.
 */

import { raise, M } from "../messages";

/** The filter requires an option but none was given (the factory-side guard; arity usually fires first). */
export function optionsRequired(fnName: string): never {
  raise(M.FilterOptionsRequired, [fnName]);
}

/** A numeric option is not a number. */
export function optionMustBeNumber(fnName: string): never {
  raise(M.FilterOptionNotNumber, [fnName]);
}

/** A date filter's style is not one of full / long / medium / short. */
export function styleInvalid(fnName: string, value: string): never {
  raise(M.FilterStyleInvalid, [fnName, value]);
}

/** `currency`'s code is not a currency Intl knows. */
export function currencyInvalid(value: string): never {
  raise(M.FilterCurrencyInvalid, [value]);
}

/** The value given to a numeric filter is not a number (the message says what it was). */
export function valueMustBeNumber(fnName: string, value: unknown): never {
  raise(M.FilterValueNotNumber, [fnName, value]);
}

/** The value given to a date filter is not a Date (the message says what it was). */
export function valueMustBeDate(fnName: string, value: unknown): never {
  raise(M.FilterValueNotDate, [fnName, value]);
}

/** The value given to an array filter is not an array. */
export function valueMustBeArray(fnName: string): never {
  raise(M.FilterValueNotArray, [fnName]);
}
