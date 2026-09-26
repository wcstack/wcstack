/**
 * The core's messages, by number. The prose lives in the diagnostics add-on
 * (`src/diagnostics/messages.ts`); without it a message reads
 * `[@wcstack/state] [wcs/binding-syntax] #108 "a|b("` — the code shared with lint and the VS Code
 * extension, the message number, and the values it would have shown. With it (the full `auto`
 * bundle installs it) the message is the full sentence, followed by the guidance.
 *
 * The hundreds of a number name its code (`CODES`): 1xx binding-syntax, 2xx template-syntax, …;
 * 1–99 carry no code. Numbers are only ever added, so a number read on a page keeps its meaning
 * across versions. `M` is a const enum: the build inlines the numbers.
 *
 * Kept as full text in the core, not numbered: the barriers a page without add-ons meets on
 * purpose (`[wcs/feature-not-installed]`, a formatting filter without the formats add-on).
 */
import { hooks } from "./hooks";
import { raiseError } from "./parser/raiseError";

export const enum M {
  // no code
  ScanRemoved = 1,
  GetterWithoutSetter = 2,
  NoRow = 3,
  ParentNotObject = 4,
  NotAMethod = 5,
  GetAllNoCommonLevel = 6,
  EqIndexNoRow = 7,
  Readonly = 8,
  SetAllNeedsIndexes = 9,
  SetAllSpreadLength = 10,
  DrainNotSettled = 11,
  BindingFailed = 12,
  LoadFailed = 13,
  ElementFailed = 14,
  NotInitialized = 15,
  NoScript = 16,
  TokenSubscriberThrew = 17,
  TokenListNotArray = 18,
  TokenEntryEmpty = 19,
  TokenEntryReserved = 20,
  TokenEntryDuplicated = 21,
  OnNotObject = 22,
  OnEntryUndeclared = 23,
  OnEntryNotFunction = 24,
  NamingLimit = 25,
  FilterOptionsRequired = 26,
  FilterOptionNotNumber = 27,
  FilterValueNotNumber = 28,
  FilterValueNotDate = 29,
  FilterValueNotArray = 30,
  DirectionalSyncDisabled = 31,
  SelectorRemoved = 32,
  // [wcs/binding-syntax]
  BindTextNoColon = 101,
  StructuralTakesNoModifiers = 102,
  ElseTakesNoValue = 103,
  SpreadNoPath = 104,
  SpreadNoFilters = 105,
  LeadingDotNamespace = 106,
  UnterminatedQuote = 107,
  FilterUnclosed = 108,
  FilterUnopened = 109,
  FilterParenOrder = 110,
  FilterTrailing = 111,
  FilterEmpty = 112,
  FilterNameHasModifiersInput = 113,
  FilterNameHasModifiersOutput = 114,
  OneModifierList = 115,
  NoPropertyName = 116,
  TooManySegments = 117,
  EmptySegment = 119,
  // [wcs/template-syntax]
  StructuralNotSingle = 201,
  ElseWithoutIf = 202,
  // [wcs/binding-path-missing]
  PathMissing = 301,
  // [wcs/binding-type-expectation]
  ClassNeedsBoolean = 401,
  // [wcs/filter-unknown]
  FilterUnknown = 501,
  // [wcs/filter-arity]
  FilterTooFewArgs = 601,
  FilterTooManyArgs = 602,
  // [wcs/getter-cycle]
  GetterCycle = 701,
  // [wcs/getter-depth-exceeded]
  GetterDepth = 801,
  // [wcs/index-arity]
  IndexArityExact = 901,
  IndexArityAtMost = 902,
  // [wcs/index-param-range]
  IndexParamRange = 1001,
  // [wcs/recursion-unsupported]
  RecursionUnsupported = 1101,
  // [wcs/token-misconfigured]
  CommandRightSide = 1201,
  NoBindable = 1202,
  NoCommand = 1203,
  NoProperty = 1204,
  // [wcs/token-undeclared]
  EventTokenUndeclared = 1301,
  CommandTokenUndeclared = 1302,
  // [wcs/wildcard-rank]
  WildcardNoLoop = 1401,
  WildcardRelative = 1402,
  // [wcs/spread-no-bindable]
  SpreadNoBindable = 1501,
  // [wcs/declaration-alias]
  DeclarationRemoved = 1601,
  // [wcs/name-alias]
  ApiRemoved = 1701,
}

/** The code of each hundred of message numbers ("" = none). */
export const CODES = [
  "", "binding-syntax", "template-syntax", "binding-path-missing", "binding-type-expectation",
  "filter-unknown", "filter-arity", "getter-cycle", "getter-depth-exceeded", "index-arity",
  "index-param-range", "recursion-unsupported", "token-misconfigured", "token-undeclared",
  "wildcard-rank", "spread-no-bindable", "declaration-alias", "name-alias",
];

/** `[wcs/<code>] ` for a message number, or "" when it has none. */
export const codeOf = (id: M): string => {
  const c = CODES[(id / 100) | 0];
  return c ? `[wcs/${c}] ` : "";
};

/** A message without the `[@wcstack/state]` prefix: the full sentence with diagnostics, else the number and the values. */
export function text(id: M, args: readonly unknown[] = []): string {
  return hooks.render !== null
    ? hooks.render(id, args)
    : `${codeOf(id)}#${id}${args.map((a) => ` ${typeof a === "string" ? JSON.stringify(a) : String(a)}`).join("")}`;
}

/** Throws message `id` (`subject` / `candidates` feed the diagnostics add-on's did-you-mean). */
export function raise(id: M, args?: readonly unknown[], subject?: string, candidates?: Iterable<string>): never {
  raiseError(text(id, args), subject, candidates);
}
