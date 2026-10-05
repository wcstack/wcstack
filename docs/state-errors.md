# @wcstack/state 4.0 message numbers

- **Audience**: anyone reading a `[@wcstack/state]` message that carries a number (`#501`), above all on a page that loads the split `/core` without the diagnostics feature
- **Status**: reference, generated from `src/messages.ts` (the numbers) and `src/diagnostics/messages.ts` (the codes and the sentences) of `@wcstack/state` 4.0. Numbers are only ever added: a number keeps its meaning across versions. A number missing from the table (118) is not assigned
- **See also**: [migration-v4.md](./migration-v4.md) §2 and §4.2 (the messages that matter when upgrading), [csp.md](./csp.md) §9 (#42 / #43)
- **日本語版**: [state-errors.ja.md](./state-errors.ja.md)

---

## 1. How a number appears

The same message reads differently depending on whether the diagnostics feature is installed:

```
[@wcstack/state] [wcs/filter-unknown] filter not found: uc. "uc" was renamed "upper" in 3.2 and removed in 4.0 — write "upper". Validate statically: npx @wcstack/lint <file>.
[@wcstack/state] #501 "uc"
```

| | With the diagnostics feature | Without it |
|---|---|---|
| Where | `@wcstack/state` (`bootstrapState()` installs every feature), `/auto`, `/parser`; `/core` after `installFeatures([diagnostics])`; the split auto entry with `features="diagnostics"` | `/core` alone |
| Text | `[@wcstack/state] [wcs/<code>] <sentence>` | `[@wcstack/state] #<number> <values>` |

- **The code** comes from the hundreds of the number: 1xx `binding-syntax`, 2xx `template-syntax`, 3xx `binding-path-missing`, and so on (the "Code" column). The feature writes it before the sentence; without the feature the message carries no code (4.0.0-rc.1 to rc.3 wrote it before the number too), and the "Code" column of the number tells it. Numbers 1–51 have no code, so with the feature their messages start with the sentence. The codes are the ones `@wcstack/lint` and the VS Code extension report.
- **#1, #1601 and #1701 come only with the feature.** It detects the 3.x names 4.0 removed: the declarations `$scan`, `$streams` and `$updatedCallback`, and reading `$trackDependency` / `$untrackDependency`. Without it a declaration under one of these names is ignored and reading one gives `undefined`, as for any `$` name the engine does not know.
- **The values**, without the feature, follow the number in the order of the "Values" column: a string is written as JSON (`"uc"`), anything else as `String(value)`.
- **Guidance.** With the feature, a message the engine throws through its error path can be followed by how to fix it: a "Did you mean" (edit distance 2 at most), the replacement of a filter name 4.0 removed (instead of a "Did you mean"), a fix for the case, and `Validate statically: npx @wcstack/lint <file>.` for the codes the lint detects. Messages written to the console (#11, #12, #17, #25, #41, #48, #49, #50, #51) carry the sentence only.
- **#44** names where the option was given (`bootstrapState`, `$behavior`, or `state` when `$behavior` is not an object). For `bootstrapState` and one of the options 4.0 moved, the sentence adds ` 4.0 moved it to the state's $behavior.`
- **#49 / #50 / #51** take the element's tag and then the name and value of each of `mount`, `bind-component`, `state` and `src` it has; the sentence renders them as the element (`<wcs-state src="./state.js">`).
- **Messages without a number** are printed in full whatever is installed: the barriers a page meets on purpose (`[wcs/feature-not-installed] … needs the add-on @wcstack/state/features/<name>`, a filter of the formats feature — formatting, arithmetic, conversion or defaults — on a page without it), `[wcs/feature-unknown]`, and the messages of the features themselves (volumes, components, SSR, `$watch` / `$stream`, devtools).

## 2. The numbers

`<…>` stands for a value. The sentence is the one the diagnostics feature prints after `[wcs/<code>] `.

| # | Code | Key | Sentence | Values |
|---|---|---|---|---|
| 1 | — | `ScanRemoved` | `$scan was removed (use $watch or $on)` | — |
| 2 | — | `GetterWithoutSetter` | `"<path>" is a getter without a setter` | `<path>` |
| 3 | — | `NoRow` | `no row for "<path>"` | `<path>` |
| 4 | — | `ParentNotObject` | `cannot write "<path>": its parent is <type>` | `<path>` `<type>` |
| 5 | — | `NotAMethod` | `"<name>" is not a method` | `<name>` |
| 6 | — | `GetAllNoCommonLevel` | `$getAll("<path>"): no loop level in common with the context` | `<path>` |
| 7 | — | `EqIndexNoRow` | `$eqIndex("<path>") needs a list row scope.` | `<path>` |
| 8 | — | `Readonly` | `This state is readonly.` | — |
| 9 | — | `SetAllNeedsIndexes` | `$setAll("<path>") needs indexes ([] for every match)` | `<path>` |
| 10 | — | `SetAllSpreadLength` | `$setAll("<path>", …, { spread: true }) needs an array of <n> values` | `<path>` `<n>` |
| 11 | — | `DrainNotSettled` | `updates did not settle after 32 passes` | — |
| 12 | — | `BindingFailed` | `binding "<type>: <path>" failed to apply.` | `<type>` `<path>` |
| 13 | — | `LoadFailed` | `failed to load "<src>": <status>` | `<src>` `<status>` |
| 14 | — | `ElementFailed` | `this <wcs-state> failed to initialize; create a new one` | — |
| 15 | — | `NotInitialized` | `state is not initialized` | — |
| 16 | — | `NoScript` | `no <script> with id "<id>"` | `<id>` |
| 17 | — | `TokenSubscriberThrew` | `a subscriber of token "<name>" threw.` | `<name>` |
| 18 | — | `TokenListNotArray` | `<key> must be an array of strings.` | `<key>` |
| 19 | — | `TokenEntryEmpty` | `<key> entries must be non-empty strings.` | `<key>` |
| 20 | — | `TokenEntryReserved` | `<key> entry "<name>" conflicts with the reserved namespace name "<reserved>".` | `<key>` `<name>` `<reserved>` |
| 21 | — | `TokenEntryDuplicated` | `<key> entry "<name>" is duplicated.` | `<key>` `<name>` |
| 22 | — | `OnNotObject` | `$on must be an object of handlers.` | — |
| 23 | — | `OnEntryUndeclared` | `$on entry "<name>" is not declared in $eventTokens.` | `<name>` |
| 24 | — | `OnEntryNotFunction` | `$on entry "<name>" must be a function.` | `<name>` |
| 25 | — | `NamingLimit` | `view-transition naming-limit (<limit>) reached.` | `<limit>` |
| 26 | — | `FilterOptionsRequired` | `filter <filter> requires at least one option` | `<filter>` |
| 27 | — | `FilterOptionNotNumber` | `filter <filter> requires a number as option` | `<filter>` |
| 28 | — | `FilterValueNotNumber` | `filter <filter> requires a number value` | `<filter>` |
| 29 | — | `FilterValueNotDate` | `filter <filter> requires a date value` | `<filter>` |
| 30 | — | `FilterValueNotArray` | `filter <filter> requires an array value` | `<filter>` |
| 31 | — | `DirectionalSyncDisabled` | `init=/sync= modifiers require enableDirectionalInitialSync.` | — |
| 32 | — | `SelectorRemoved` | `"<binding>": the "@name" selector was removed in v2 — there is a single state tree. Mount the named state onto the tree (<wcs-state mount="...">) and read it by its path prefix instead.` | `<binding>` |
| 33 | — | `ModifierUnknown` | `Unknown binding modifier "<key>" in "<modifier>".` | `<key>` `<modifier>` |
| 34 | — | `ModifierTwice` | `Binding modifier "<key>" may only be specified once.` | `<key>` |
| 35 | — | `ModifierValue` | `Invalid <key> modifier value "<value>".` | `<key>` `<value>` |
| 36 | — | `EventInitNone` | `Event bindings only allow init=none.` | — |
| 37 | — | `InitUnsupported` | `Binding type "<type>" does not support init=<init>.` | `<type>` `<init>` |
| 38 | — | `MemberUndeclared` | `Property "<name>" is not declared by wcBindable.` | `<name>` |
| 39 | — | `InitIncompatible` | `init=<init> is incompatible with wcBindable member "<name>".` | `<init>` `<name>` |
| 40 | — | `SyncConnectNeedsOutput` | `sync=connect requires observable property "<name>".` | `<name>` |
| 41 | — | `RenderChain` | `render chain depth limit exceeded (100 drains that rendering itself started); bindings for this batch were not applied.` | — |
| 42 | — | `InlineBlocked` | `The inline <script> of <wcs-state> was blocked by Content-Security-Policy. Inline state is evaluated through a blob: URL: give the page's nonce to the <script> that loads @wcstack/state, or allow blob: in script-src. Moving the state into an external file (src="./state.js") needs neither. See https://github.com/wcstack/wcstack/blob/main/docs/csp.md` | — |
| 43 | — | `InlineFailed` | `Failed to evaluate the inline <script> of <wcs-state>: <error message>. If this page sets a Content-Security-Policy, see https://github.com/wcstack/wcstack/blob/main/docs/csp.md` | `<error message>` |
| 44 | — | `OptionInvalid` | `<where>: "<key>" is not one of its options, or not of the option's type.` | `<where>` `<key>` |
| 45 | — | `BehaviorChanged` | `a re-set state may not change $behavior: create the element again.` | — |
| 46 | — | `FeaturesNotArray` | `$features must be an array of add-on names (["temporal", "formats"]).` | — |
| 47 | — | `SecondRoot` | `a second <wcs-state> on the same root: there is one state tree per root — graft a subtree with <wcs-state mount="path"> (v1's name="…" is gone: read the mounted state by its path).` | — |
| 48 | — | `LocaleInvalid` | `the locale "<locale>" (<html lang> or bootstrapState's locale) is not a language tag Intl takes (en-US, not en_US): the locale filters use "en".` | `<locale>` |
| 49 | — | `InitFailed` | `<wcs-state …> failed to initialize.` | `<tag>` `<attribute>` `<value>` `…` |
| 50 | — | `ConnectedFailed` | `<wcs-state …> $connectedCallback failed.` | `<tag>` `<attribute>` `<value>` `…` |
| 51 | — | `DisconnectedFailed` | `<wcs-state …> $disconnectedCallback failed.` | `<tag>` `<attribute>` `<value>` `…` |
| 101 | `wcs/binding-syntax` | `BindTextNoColon` | `Invalid bindText: "<binding>". Missing ':' separator between propPart and statePart.` | `<binding>` |
| 102 | `wcs/binding-syntax` | `StructuralTakesNoModifiers` | `"<binding>": "<keyword>" takes no modifiers or filters on its left side — write "<keyword>:".` | `<binding>` `<keyword>` |
| 103 | `wcs/binding-syntax` | `ElseTakesNoValue` | `"<binding>": "else" takes no value — write "else:".` | `<binding>` |
| 104 | `wcs/binding-syntax` | `SpreadNoPath` | `Invalid spread binding "<binding>": spread target path is required.` | `<binding>` |
| 105 | `wcs/binding-syntax` | `SpreadNoFilters` | `Invalid spread binding "<binding>": filters are not allowed on spread targets.` | `<binding>` |
| 106 | `wcs/binding-syntax` | `LeadingDotNamespace` | `"<property>": a leading "." binds an element property by name — write a non-empty property that is not a namespace (class, attr, style, command, eventToken, state).` | `<property>` |
| 107 | `wcs/binding-syntax` | `UnterminatedQuote` | `unterminated <quote> quote in the filter arguments "(<arguments>)". Close the quote.` | `<quote>` `<arguments>` |
| 108 | `wcs/binding-syntax` | `FilterUnclosed` | `Invalid filter format: missing closing parenthesis in "<filter>".` | `<filter>` |
| 109 | `wcs/binding-syntax` | `FilterUnopened` | `Invalid filter format: missing opening parenthesis in "<filter>".` | `<filter>` |
| 110 | `wcs/binding-syntax` | `FilterParenOrder` | `Invalid filter format: ")" comes before "(" in "<filter>".` | `<filter>` |
| 111 | `wcs/binding-syntax` | `FilterTrailing` | `"<filter>": unexpected "<text>" after the filter's closing ")" — separate filters with "\|" (write "<filter up to its ")">\|<text>").` | `<filter>` `<text>` |
| 112 | `wcs/binding-syntax` | `FilterEmpty` | `an empty filter in "<source>" — remove the extra "\|" or name the filter.` | `<source>` |
| 113 | `wcs/binding-syntax` | `FilterNameHasModifiersInput` | `"<name>" is not a filter name: a modifier list "#<modifiers>" comes before the input filters, not inside one` | `<name>` `<modifiers>` |
| 114 | `wcs/binding-syntax` | `FilterNameHasModifiersOutput` | `"<name>" is not a filter name: "#" cannot appear in one.` | `<name>` |
| 115 | `wcs/binding-syntax` | `OneModifierList` | `"<property>": a binding takes one modifier list after a single "#"` | `<property>` |
| 116 | `wcs/binding-syntax` | `NoPropertyName` | `"<property>": the left side of a binding must name a property — write "<property>: <path>" (modifiers and input filters come after the name).` | `<property>` |
| 117 | `wcs/binding-syntax` | `TooManySegments` | `"<path>" has <n> path segments — the limit is 512.` | `<path>` `<n>` |
| 119 | `wcs/binding-syntax` | `EmptySegment` | `"<binding>": the right side of a binding must name a state path — write "<property>: <path>" (a path segment cannot be empty; "." alone and a leading "." are the loop-relative shorthand).` | `<binding>` |
| 120 | `wcs/binding-syntax` | `UnsafeSegment` | `"<path>": a state path cannot go through "__proto__" or "prototype" (it would reach every object's prototype).` | `<path>` |
| 121 | `wcs/binding-syntax` | `ForNoFilters` | `"<binding>": "for:" takes no filters — a row is "<path>.<index>", so the rows of a filtered list would name other elements. Declare a getter that returns the filtered list and loop over it ("for: <getter>").` | `<binding>` |
| 201 | `wcs/template-syntax` | `StructuralNotSingle` | `Invalid bindText: "<binding>". 'if', 'elseif', 'else', and 'for' bindings must be single binding.` | `<binding>` |
| 202 | `wcs/template-syntax` | `ElseWithoutIf` | `"<type>:" must follow an "if:" template` | `<type>` |
| 203 | `wcs/template-syntax` | `OuterInTemplate` | `"<name>:" replaces its element, so it cannot be used inside a "for" / "if" template (a row or branch keeps its nodes by position): bind innerHTML: on a wrapper element instead.` | `<name>` |
| 204 | `wcs/template-syntax` | `TemplateHandedOver` | `a "<type>:" template at the top of inserted content was not rendered, as it would render beside itself out of the inserter's reach: wrap it in an element.` | `<type>` |
| 301 | `wcs/binding-path-missing` | `PathMissing` | `Path "<path>" does not exist on the state tree.` | `<path>` |
| 401 | `wcs/binding-type-expectation` | `ClassNeedsBoolean` | `class.<name> needs a boolean, got <type>.` | `<name>` `<type>` |
| 501 | `wcs/filter-unknown` | `FilterUnknown` | `filter not found: <name>.` | `<name>` |
| 601 | `wcs/filter-arity` | `FilterTooFewArgs` | `filter "<name>" requires at least <min> argument(s) (<given> given).` | `<name>` `<min>` `<given>` |
| 602 | `wcs/filter-arity` | `FilterTooManyArgs` | `filter "<name>" accepts at most <max> argument(s) (<given> given).` | `<name>` `<max>` `<given>` |
| 701 | `wcs/getter-cycle` | `GetterCycle` | `"<path>" depends on itself` | `<path>` |
| 801 | `wcs/getter-depth-exceeded` | `GetterDepth` | `"<path>"` | `<path>` |
| 901 | `wcs/index-arity` | `IndexArityExact` | `<api>("<path>") takes <depth> index(es), got <n>.` | `<api>` `<path>` `<depth>` `<n>` |
| 902 | `wcs/index-arity` | `IndexArityAtMost` | `<api>("<path>") takes at most <depth> index(es), got <n>.` | `<api>` `<path>` `<depth>` `<n>` |
| 1001 | `wcs/index-param-range` | `IndexParamRange` | `"<key>": list index parameters run from $1 to $128.` | `<key>` |
| 1101 | `wcs/recursion-unsupported` | `RecursionUnsupported` | `"<path>" uses "**", which is not accepted here.` | `<path>` |
| 1201 | `wcs/token-misconfigured` | `CommandRightSide` | `"<property>: <path>": the right-hand side must be $command.<name>` | `<property>` `<path>` |
| 1202 | `wcs/token-misconfigured` | `NoBindable` | `<tag> declares no static wcBindable (<what>).` | `<tag>` `<what>` |
| 1203 | `wcs/token-misconfigured` | `NoCommand` | `<tag> declares no command "<method>".` | `<tag>` `<method>` |
| 1204 | `wcs/token-misconfigured` | `NoProperty` | `<tag> declares no property "<property>".` | `<tag>` `<property>` |
| 1301 | `wcs/token-undeclared` | `EventTokenUndeclared` | `eventToken "<name>" is not declared in $eventTokens.` | `<name>` |
| 1302 | `wcs/token-undeclared` | `CommandTokenUndeclared` | `"$command.<name>" is not declared in $commandTokens.` | `<name>` |
| 1401 | `wcs/wildcard-rank` | `WildcardNoLoop` | `"<path>" needs <depth> enclosing loop level(s); the scope provides <n>.` | `<path>` `<depth>` `<n>` |
| 1402 | `wcs/wildcard-rank` | `WildcardRelative` | `"<path>" is relative: it needs an enclosing "for" template` | `<path>` |
| 1403 | `wcs/wildcard-rank` | `WildcardOtherList` | `"<path>" ranges over the rows of "<list>", but the enclosing "for" template at that level renders "<rendered list>".` | `<path>` `<list>` `<rendered list>` |
| 1501 | `wcs/spread-no-bindable` | `SpreadNoBindable` | `<tag> declares no static wcBindable (<what>).` | `<tag>` `<what>` |
| 1601 | `wcs/declaration-alias` | `DeclarationRemoved` | `<old name> was removed: write <name>.` | `<old name>` `<name>` |
| 1701 | `wcs/name-alias` | `ApiRemoved` | `<old name> was removed: write <name>.` | `<old name>` `<name>` |
