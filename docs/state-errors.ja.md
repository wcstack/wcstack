# @wcstack/state 4.0 のメッセージ番号

- **対象**: 番号（`#501`）の付いた `[@wcstack/state]` のメッセージを読む人。とくに、診断の後付けを入れずに分割の `/core` を読み込むページ
- **状態**: リファレンス。`@wcstack/state` 4.0 の `src/messages.ts`（番号とコード）と `src/diagnostics/messages.ts`（文面）から生成した。番号は足すだけで、一度付いた番号の意味は版をまたいで変わらない。表に無い番号（118）は割り当てていない
- **関連**: [migration-v4.ja.md](./migration-v4.ja.md) §2・§4.2（上げるときに出会うメッセージ）、[csp.ja.md](./csp.ja.md) §9（#42 / #43）
- **English**: [state-errors.md](./state-errors.md)

---

## 1. 番号の出方

同じメッセージでも、診断の後付けが入っているかどうかで文面が変わる:

```
[@wcstack/state] [wcs/filter-unknown] filter not found: uc. "uc" was renamed "upper" in 3.2 and removed in 4.0 — write "upper". Validate statically: npx @wcstack/lint <file>.
[@wcstack/state] [wcs/filter-unknown] #501 "uc"
```

| | 診断の後付けあり | なし |
|---|---|---|
| どこで | `@wcstack/state`（`bootstrapState()` がすべての後付けを入れる）、`/auto`、`/parser`。`installFeatures([diagnostics])` の後の `/core`。`features="diagnostics"` の分割 auto | `/core` だけ |
| 文面 | `[@wcstack/state] [wcs/<コード>] <文>` | `[@wcstack/state] [wcs/<コード>] #<番号> <値>` |

- **コード**は番号の百の位から決まる: 1xx は `binding-syntax`、2xx は `template-syntax`、3xx は `binding-path-missing`、…（表の「Code」の列）。1〜50 にはコードが無いので、文か `#<番号>` から始まる。コードは `@wcstack/lint` と VS Code 拡張が報告するものと同じ。
- **値**は、後付けが無いとき、番号の後に表の「Values」の列の順で並ぶ。文字列は JSON（`"uc"`）、それ以外は `String(値)`。
- **案内**: 後付けがあると、エンジンがエラーの経路で投げるメッセージの後に、直し方が続くことがある — 「Did you mean」（編集距離 2 まで）、4.0 で外れたフィルタ名にはその書き換え先（「Did you mean」の代わり）、その場合の直し方、lint が検出するコードには `Validate statically: npx @wcstack/lint <file>.`。コンソールに書くメッセージ（#11・#12・#17・#25・#41・#48・#49・#50）は文だけ。
- **#44** はオプションを渡した場所を名指す（`bootstrapState`、`$behavior`、`$behavior` がオブジェクトでないときは `state`）。`bootstrapState` に 4.0 で移ったオプションを渡したときは、文の後に ` 4.0 moved it to the state's $behavior.` が付く。
- **#49 / #50** は要素のタグ名と、要素が持つ `mount`・`bind-component`・`state`・`src` の名前と値を受け取り、文では要素の形（`<wcs-state src="./state.js">`）に描く。
- **番号の無いメッセージ**は、何を入れていても全文で出る: ページが意図して出会う関門（`[wcs/feature-not-installed] … needs the add-on @wcstack/state/features/<name>`、formats の後付けの無いページの書式のフィルタ）、`[wcs/feature-unknown]`、後付けそのもののメッセージ（ボリューム・コンポーネント・SSR・`$watch` / `$stream`・devtools）。

## 2. 番号の一覧

`<…>` は値。文は、診断の後付けが `[wcs/<コード>] ` の後に出すもの（ランタイムの文面なので英語のまま）。

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
