/**
 * `@wcstack/state/parser`: the `data-wcs` parser as DOM-free pure functions, for tooling (the VS
 * Code extension, `@wcstack/lint`). The same exports and result shape as 3.x — each binding
 * carries its path's `statePathInfo`.
 *
 * This entry is a bundle of its own, so it turns its copy of the diagnostics renderer on: a
 * syntax error reads as the full sentence with its guidance, as 3.x's parser threw it (the core
 * alone throws the code and the message number).
 */
import { hooks } from "../hooks";
import { explain, render } from "../diagnostics/explain";
import { parseBindTextsForElement as parseAll, splitBindTexts } from "../parser/parseBindTextsForElement";
import { parseBindTextForEmbeddedNode as parseOne } from "../parser/parseBindTextForEmbeddedNode";
import { clearPropPartCache } from "../parser/parsePropPart";
import { clearStatePartCache } from "../parser/parseStatePart";
import type { BindingType, ParsedBinding, ParsedFilter } from "../parser/types";
import { clearPathInfoCache, getPathInfo, type IPathInfo } from "./pathInfo";

hooks.render = render;
hooks.explain = explain;

export { splitBindTexts, getPathInfo };
export { indexOfOutsideQuotes, splitOutsideQuotes } from "../parser/utils";
export type { BindingType, IPathInfo };

/** One parsed binding: the parser's fields and its path's info. */
export interface ParseBindTextResult extends ParsedBinding {
  readonly statePathInfo: IPathInfo;
  /** 3.x gave structural bindings an id here; the new engine does not use one. */
  readonly uuid?: string | null;
}

/** A filter resolved to its function (what the engine plans; the parser gives name and arguments). */
export interface IFilterInfo extends ParsedFilter {
  readonly filterFn: (value: unknown) => unknown;
}

const withInfo = (b: ParsedBinding): ParseBindTextResult => ({ ...b, statePathInfo: getPathInfo(b.statePathName) });

/** A `data-wcs` attribute's text → its bindings. */
export function parseBindTextsForElement(bindText: string): ParseBindTextResult[] {
  return parseAll(bindText).map(withInfo);
}

/** A `{{ … }}` expression → its (text) binding. */
export function parseBindTextForEmbeddedNode(bindText: string): ParseBindTextResult {
  return withInfo(parseOne(bindText));
}

/**
 * Drops this entry's caches (interned path infos, parsed filters). For long-running processes
 * (a language server): half-typed paths would otherwise stay interned. After a clear,
 * getPathInfo returns a new instance for the same path.
 */
export function clearParserCaches(): void {
  clearPathInfoCache();
  clearPropPartCache();
  clearStatePartCache();
}
