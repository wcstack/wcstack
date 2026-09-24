/**
 * filters/options.ts — option parsing shared by the core set and the formats add-on, ported
 * verbatim from `@wcstack/state` (`formats/builtinFilters.ts`).
 *
 * Numeric options are read **once, when the filter is built**: the checks stay in one place and the
 * `Number()` conversion stays off the apply path.
 */
import { optionMustBeNumber, optionsRequired } from "./errorMessages";

/** `""` and anything `Number()` cannot read are rejected (so `lt('')` is an error, not `lt(0)`). */
export function validateNumberString(value: string): boolean {
  if (!value || isNaN(Number(value))) {
    return false;
  }
  return true;
}

/** One numeric option, converted: non-numeric → `optionMustBeNumber`. */
export function numberOption(value: string, fnName: string): number {
  if (!validateNumberString(value)) {optionMustBeNumber(fnName);}
  return Number(value);
}

/** A required numeric option: missing → `optionsRequired`, non-numeric → `optionMustBeNumber`. */
export function requiredNumberOption(options: readonly string[] | undefined, index: number, fnName: string): number {
  return numberOption(options?.[index] ?? optionsRequired(fnName), fnName);
}

/**
 * The typed literal of the first argument (requirement B9): an unquoted `true` / `false` / `null` /
 * number arrives typed, a quoted argument as a string. Without literals (tooling calling a factory
 * directly) the raw option text stands in.
 */
export function firstLiteral(opt: string, literals: readonly unknown[] | undefined): unknown {
  return literals !== undefined && literals.length > 0 ? literals[0] : opt;
}
