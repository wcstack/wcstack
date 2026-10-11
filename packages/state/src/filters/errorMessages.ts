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

/** The value given to a numeric filter is not a number. */
export function valueMustBeNumber(fnName: string): never {
  raise(M.FilterValueNotNumber, [fnName]);
}

/** The value given to a date filter is not a Date. */
export function valueMustBeDate(fnName: string): never {
  raise(M.FilterValueNotDate, [fnName]);
}

/** The value given to an array filter is not an array. */
export function valueMustBeArray(fnName: string): never {
  raise(M.FilterValueNotArray, [fnName]);
}
