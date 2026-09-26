/**
 * The sentences of the core's numbered messages (src/messages.ts), in the diagnostics add-on:
 * the core carries the number and the values, this renders what the core used to say. Each
 * sentence follows its `[wcs/<code>] ` (added from the number). `Record<M, …>` makes a number
 * without a sentence a type error.
 */
import { M } from "../messages";
import { MAX_DRAIN_PASSES, MAX_INDEX_PARAM } from "../engine";
import { MAX_PATH_SEGMENTS, MODIFIER_SEPARATOR, RECURSION_WILDCARD } from "../parser/define";

type Sentence = (...a: any[]) => string;

export const SENTENCES: Record<M, Sentence> = {
  [M.ScanRemoved]: () => "$scan was removed (use $watch or $on)",
  [M.GetterWithoutSetter]: (p) => `"${p}" is a getter without a setter`,
  [M.NoRow]: (p) => `no row for "${p}"`,
  [M.ParentNotObject]: (p, parent) => `cannot write "${p}": its parent is ${parent}`,
  [M.NotAMethod]: (name) => `"${name}" is not a method`,
  [M.GetAllNoCommonLevel]: (p) => `$getAll("${p}"): no loop level in common with the context`,
  [M.EqIndexNoRow]: (p) => `$eqIndex("${p}") needs a list row scope.`,
  [M.Readonly]: () => "This state is readonly.",
  [M.SetAllNeedsIndexes]: (p) => `$setAll("${p}") needs indexes ([] for every match)`,
  [M.SetAllSpreadLength]: (p, n) => `$setAll("${p}", …, { spread: true }) needs an array of ${n} values`,
  [M.DrainNotSettled]: () => `updates did not settle after ${MAX_DRAIN_PASSES} passes`,
  [M.BindingFailed]: (type, p) => `binding "${type}: ${p}" failed to apply.`,
  [M.LoadFailed]: (src, status) => `failed to load "${src}": ${status}`,
  [M.ElementFailed]: () => "this <wcs-state> failed to initialize; create a new one",
  [M.NotInitialized]: () => "state is not initialized",
  [M.NoScript]: (id) => `no <script> with id "${id}"`,
  [M.TokenSubscriberThrew]: (name) => `a subscriber of token "${name}" threw.`,
  [M.TokenListNotArray]: (key) => `${key} must be an array of strings.`,
  [M.TokenEntryEmpty]: (key) => `${key} entries must be non-empty strings.`,
  [M.TokenEntryReserved]: (key, name, reserved) => `${key} entry "${name}" conflicts with the reserved namespace name "${reserved}".`,
  [M.TokenEntryDuplicated]: (key, name) => `${key} entry "${name}" is duplicated.`,
  [M.OnNotObject]: () => "$on must be an object of handlers.",
  [M.OnEntryUndeclared]: (name) => `$on entry "${name}" is not declared in $eventTokens.`,
  [M.OnEntryNotFunction]: (name) => `$on entry "${name}" must be a function.`,
  [M.NamingLimit]: (limit) => `view-transition naming-limit (${limit}) reached.`,
  [M.FilterOptionsRequired]: (fn) => `filter ${fn} requires at least one option`,
  [M.FilterOptionNotNumber]: (fn) => `filter ${fn} requires a number as option`,
  [M.FilterValueNotNumber]: (fn) => `filter ${fn} requires a number value`,
  [M.FilterValueNotDate]: (fn) => `filter ${fn} requires a date value`,
  [M.FilterValueNotArray]: (fn) => `filter ${fn} requires an array value`,
  [M.DirectionalSyncDisabled]: () => "init=/sync= modifiers require enableDirectionalInitialSync.",
  [M.ModifierUnknown]: (key, modifier) => `Unknown binding modifier "${key}" in "${modifier}".`,
  [M.ModifierTwice]: (key) => `Binding modifier "${key}" may only be specified once.`,
  [M.ModifierValue]: (key, value) => `Invalid ${key} modifier value "${value}".`,
  [M.EventInitNone]: () => "Event bindings only allow init=none.",
  [M.InitUnsupported]: (type, init) => `Binding type "${type}" does not support init=${init}.`,
  [M.MemberUndeclared]: (name) => `Property "${name}" is not declared by wcBindable.`,
  [M.InitIncompatible]: (init, name) => `init=${init} is incompatible with wcBindable member "${name}".`,
  [M.SyncConnectNeedsOutput]: (name) => `sync=connect requires observable property "${name}".`,

  [M.BindTextNoColon]: (t) => `Invalid bindText: "${t}". Missing ':' separator between propPart and statePart.`,
  [M.StructuralTakesNoModifiers]: (t, keyword) => `"${t}": "${keyword}" takes no modifiers or filters on its left side — write "${keyword}:".`,
  [M.ElseTakesNoValue]: (t) => `"${t}": "else" takes no value — write "else:".`,
  [M.SpreadNoPath]: (t) => `Invalid spread binding "${t}": spread target path is required.`,
  [M.SpreadNoFilters]: (t) => `Invalid spread binding "${t}": filters are not allowed on spread targets.`,
  [M.LeadingDotNamespace]: (prop) => `"${prop}": a leading "." binds an element property by name — write a non-empty property that is not a namespace (class, attr, style, command, eventToken, state).`,
  [M.UnterminatedQuote]: (quote, args) => `unterminated ${quote} quote in the filter arguments "(${args})". Close the quote.`,
  [M.FilterUnclosed]: (f) => `Invalid filter format: missing closing parenthesis in "${f}".`,
  [M.FilterUnopened]: (f) => `Invalid filter format: missing opening parenthesis in "${f}".`,
  [M.FilterParenOrder]: (f) => `Invalid filter format: ")" comes before "(" in "${f}".`,
  [M.FilterTrailing]: (f, trailing) => `"${f}": unexpected "${trailing}" after the filter's closing ")" — separate filters with "|" (write "${f.slice(0, f.lastIndexOf(")") + 1)}|${trailing}").`,
  [M.FilterEmpty]: (source) => `an empty filter in "${source}" — remove the extra "|" or name the filter.`,
  [M.FilterNameHasModifiersInput]: (name, mods) => `"${name}" is not a filter name: a modifier list "${MODIFIER_SEPARATOR}${mods}" comes before the input filters, not inside one`,
  [M.FilterNameHasModifiersOutput]: (name) => `"${name}" is not a filter name: "${MODIFIER_SEPARATOR}" cannot appear in one.`,
  [M.OneModifierList]: (prop) => `"${prop}": a binding takes one modifier list after a single "#"`,
  [M.NoPropertyName]: (prop) => `"${prop}": the left side of a binding must name a property — write "<property>: <path>" (modifiers and input filters come after the name).`,
  [M.TooManySegments]: (p, n) => `"${p}" has ${n} path segments — the limit is ${MAX_PATH_SEGMENTS}.`,
  [M.SelectorRemoved]: (t) => `"${t}": the "@name" selector was removed in v2 — there is a single state tree. Mount the named state onto the tree (<wcs-state mount="...">) and read it by its path prefix instead.`,
  [M.EmptySegment]: (t) => `"${t}": the right side of a binding must name a state path — write "<property>: <path>" (a path segment cannot be empty; "." alone and a leading "." are the loop-relative shorthand).`,

  [M.StructuralNotSingle]: (t) => `Invalid bindText: "${t}". 'if', 'elseif', 'else', and 'for' bindings must be single binding.`,
  [M.ElseWithoutIf]: (type) => `"${type}:" must follow an "if:" template`,

  [M.PathMissing]: (p) => `Path "${p}" does not exist on the state tree.`,

  [M.ClassNeedsBoolean]: (name, type) => `class.${name} needs a boolean, got ${type}.`,

  [M.FilterUnknown]: (name) => `filter not found: ${name}.`,

  [M.FilterTooFewArgs]: (name, min, given) => `filter "${name}" requires at least ${min} argument(s) (${given} given).`,
  [M.FilterTooManyArgs]: (name, max, given) => `filter "${name}" accepts at most ${max} argument(s) (${given} given).`,

  [M.GetterCycle]: (p) => `"${p}" depends on itself`,

  [M.GetterDepth]: (p) => `"${p}"`,

  [M.IndexArityExact]: (api, p, depth, n) => `${api}("${p}") takes ${depth} index(es), got ${n}.`,
  [M.IndexArityAtMost]: (api, p, depth, n) => `${api}("${p}") takes at most ${depth} index(es), got ${n}.`,

  [M.IndexParamRange]: (key) => `"${key}": list index parameters run from $1 to $${MAX_INDEX_PARAM}.`,

  [M.RecursionUnsupported]: (p) => `"${p}" uses "${RECURSION_WILDCARD}", which is not accepted here.`,

  [M.CommandRightSide]: (prop, p) => `"${prop}: ${p}": the right-hand side must be $command.<name>`,
  [M.NoBindable]: (tag, what) => `<${tag}> declares no static wcBindable (${what}).`,
  [M.NoCommand]: (tag, method) => `<${tag}> declares no command "${method}".`,
  [M.NoProperty]: (tag, prop) => `<${tag}> declares no property "${prop}".`,

  [M.EventTokenUndeclared]: (name) => `eventToken "${name}" is not declared in $eventTokens.`,
  [M.CommandTokenUndeclared]: (name) => `"$command.${name}" is not declared in $commandTokens.`,

  [M.WildcardNoLoop]: (p, depth) => `"${p}" needs ${depth} enclosing loop level(s); the scope provides 0.`,
  [M.WildcardRelative]: (p) => `"${p}" is relative: it needs an enclosing "for" template`,

  [M.SpreadNoBindable]: (tag, what) => `<${tag}> declares no static wcBindable (${what}).`,

  [M.DeclarationRemoved]: (old, name) => `${old} was removed: write ${name}.`,

  [M.ApiRemoved]: (old, name) => `${old} was removed: write ${name}.`,
};
