/**
 * `data-wcs` binding parser — a self-contained port of `@wcstack/state`'s `bindTextParser/`.
 *
 * DOM independent, pure string → result (apart from two module-level caches of parsed filter
 * lists, keyed by the filter text: equal filter texts return the SAME array — do not mutate
 * `inFilters` / `outFilters`). Syntax errors throw `Error` with the current engine's messages
 * (`[@wcstack/state] [wcs/binding-syntax] …` + the `@wcstack/lint` hint).
 *
 * Not done here (the engine's job): loop-relative shorthand expansion (`.name`, `.`),
 * `...:` spread expansion, filter name / alias / function resolution, `if`/`elseif`/`else`
 * sibling-order checks, and anything that needs the element.
 */
export type { BindingType, ParsedFilter, ParsedBinding } from "./types";
export { parseBindTextsForElement } from "./parseBindTextsForElement";
export { parseBindTextForEmbeddedNode } from "./parseBindTextForEmbeddedNode";
