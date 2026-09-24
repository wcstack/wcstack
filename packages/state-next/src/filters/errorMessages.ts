/**
 * filters/errorMessages.ts — the filters' error messages, ported verbatim from
 * `@wcstack/state` (`formats/errorMessages.ts` + `raiseError.ts`).
 *
 * The `[@wcstack/state]` prefix is kept on purpose: the new engine is a drop-in replacement, and the
 * console text (and the tests pinning it) should not change with the engine underneath.
 */

export function raiseError(message: string): never {
  throw new Error(`[@wcstack/state] ${message}`);
}

/** The filter requires an option but none was given (the factory-side guard; arity usually fires first). */
export function optionsRequired(fnName: string): never {
  raiseError(`filter ${fnName} requires at least one option`);
}

/** A numeric option is not a number. */
export function optionMustBeNumber(fnName: string): never {
  raiseError(`filter ${fnName} requires a number as option`);
}

/** The value given to a numeric filter is not a number. */
export function valueMustBeNumber(fnName: string): never {
  raiseError(`filter ${fnName} requires a number value`);
}

/** The value given to a date filter is not a Date. */
export function valueMustBeDate(fnName: string): never {
  raiseError(`filter ${fnName} requires a date value`);
}

/** The value given to an array filter is not an array. */
export function valueMustBeArray(fnName: string): never {
  raiseError(`filter ${fnName} requires an array value`);
}
