/**
 * core/messages.ts — 診断メッセージの単一正本（ja / en）。
 *
 * HTML パイプラインの全 validator はメッセージ文字列を直接組み立てず、
 * ここのカタログ関数を通す。locale の決定はツール層が行う:
 *   CLI: --lang > 環境(LC_ALL / LC_MESSAGES / LANG / Intl) > en（cli.ts resolveCliLocale）
 *   IDE: wcstack.messageLanguage 設定 > VS Code 表示言語 > en（wcsCompletionPlugin）
 * ここでは渡された locale 文字列を ja / en に解決するだけ（ja 系以外はすべて en）。
 * ライブラリ API として locale 未指定で呼ばれた場合のみ ja（後方互換の既定）。
 *
 * 互換性: 診断の安定契約は {code, range, severity} であり、message は
 * ロケールで変わってよい（docs/architecture-hardening/09-remediation-design.md §8 の
 * IDE/CI 一致条件は code / range に対するもの）。
 *
 * sidecar パイプライン（Manifest* / Drift*）のメッセージは従来から英語のみ。
 */

export type WcsLocale = 'ja' | 'en';

/** locale 文字列（'ja-JP' / 'en-US' / undefined 等）を ja / en に解決する。未指定は ja。 */
export function resolveLocale(locale?: string): WcsLocale {
  if (locale === undefined || locale === '' || /^ja\b|^ja[-_]/i.test(locale) || locale.toLowerCase() === 'ja') return 'ja';
  return 'en';
}

/** 型期待の対象種別（BindingTypeExpectation 用）。 */
export type ExpectedTypeKind = 'array' | 'boolean' | 'string';

/** 添字本数の要求（`$resolve` と `$update` は厳密一致・`$getAll` / `$setAll` は接頭辞なので上限）。 */
export type IndexArityRequirement = 'exact' | 'atMost';

export interface WcsMessageCatalog {
  // --- bindingValidator / templateSyntaxValidator ---
  spreadFilterNotAllowed(): string;
  spreadTargetRequired(): string;
  /** 構造ディレクティブ（for/if/elseif/else）が他バインディングと併記されている。 */
  structuralMustBeSingle(directive: string): string;
  bindingSyntax(detail: string): string;
  eventTokenUndeclared(tokenName: string): string;
  commandRhsFormat(): string;
  commandTokenUndeclared(tokenPath: string): string;
  /** `$command.<name>` used while the state has no `$commandTokens` at all (`name`: the token's name). */
  commandTokensAbsent(tokenPath: string, name: string): string;
  /** `eventToken.<member>: <name>` while the state has no `$eventTokens` at all. */
  eventTokensAbsent(tokenName: string): string;
  /** A `$on` entry whose name `$eventTokens` does not declare (`absent`: the state has no `$eventTokens`): the state fails to load. */
  onEntryUndeclared(tokenName: string, absent: boolean): string;
  streamPathMissing(path: string): string;
  pathMissing(path: string): string;
  /** stateSchema が宣言された state で、パスが schema 上に確定的に存在しない（error）。 */
  pathNonexistent(path: string): string;
  /** stateSchema 上の型が構造ディレクティブの要求（`for` = 配列）と食い違う（error）。 */
  pathTypeMismatch(path: string, label: string, expected: ExpectedTypeKind, actualType: string): string;
  /** 省略パス展開の注記（pathMissing 等の末尾に連結）。 */
  expansionSuffix(expandedPath: string): string;
  patternPathOutsideFor(path: string): string;
  omittedPathOutsideFor(path: string): string;
  loopIndexOutsideFor(path: string): string;
  /** `$getAll` / `$setAll` / `$resolve` / `$update` の添字の本数がパスの `*` の本数と噛み合わない。 */
  indexArity(api: string, path: string, requirement: IndexArityRequirement, wildcardCount: number, actual: number): string;
  /** ワイルドカードの階数がスコープの段数を超える（`$N` を含む）。 */
  wildcardRank(subject: string, needed: number, available: number): string;
  /**
   * 行の中の `*` が、その段で囲む `for:` とは別のリストを指す（4.0 の `[wcs/wildcard-rank]` #1403・F32）。
   * `over` はパスの `*` が回るリスト、`loop` はその段で囲む `for:` が描くリスト。
   */
  wildcardOtherList(path: string, over: string, loop: string): string;
  /** `for:` / `if:` テンプレートの中の `outerHTML:` / `outerText:`（4.0 は初期化で拒む。#203）。 */
  outerInTemplate(property: string): string;
  /** `#direct` をイベント束縛（`on*:`）以外に付けた（ランタイムは黙って無視する）。 */
  directNotEvent(property: string): string;
  /**
   * 4.0 が root へ委譲するイベントの束縛（`onclick: select`）で、ハンドラのメソッドがイベント引数の
   * `currentTarget` を読む（要素ではなく root になる）。`suggestedProperty` は書き換え先の左辺
   * （書かれた修飾子に `direct` を足した形 — `onclick#prevent,direct`）。
   */
  delegatedCurrentTarget(suggestedProperty: string, eventName: string, handler: string): string;
  /** パス getter どうしの循環参照。 */
  getterCycle(cycle: string): string;
  /** `$renderedCallback` が未バインドのパスを判定に使っている（その分岐は走らない）。 */
  updatedCallbackUnbound(path: string): string;
  /** getter の中でパス読み取りの先の素のプロパティアクセス（追跡されるのは root だけ）。 */
  getterUntrackedRead(root: string, suggestedPath: string): string;
  /**
   * 同じ読みで、そのパス（かその上）を書くのがページの束縛（`...: root` の spread・書き戻す束縛・要素の出力）
   * のとき。書き込みは getter に届かないと断定できる（error）。`binding` は束縛の原文、`written` はそれが書くパス。
   */
  getterUntrackedReadBound(root: string, suggestedPath: string, binding: string, tag: string, written: string): string;
  onHandlerThis(name: string): string;
  /** getter の中の `location` 読み（state ではないので追跡されない — 最初の URL のまま）。 */
  getterReadsLocation(read: string): string;
  /** `<form>` の `onsubmit:` に `#prevent` が無く、ハンドラも preventDefault を呼ばない。 */
  submitWithoutPrevent(handler: string): string;
  /** `<wcs-guard-handler>` のモジュールのトップレベル（export する関数の外）での `localStorage` / `sessionStorage` / `document.cookie` の読み。 */
  guardReadsAtModuleTop(read: string): string;
  /** `<wcs-state>` のモジュールのトップレベルでの同じ読み（state は読み込みの時点の値を持ち続ける）。 */
  stateReadsAtModuleTop(read: string): string;
  /** `$eventTokens` に宣言したのに、どの `eventToken.<member>:` 束縛も出さないトークン。`hasHandler`: `$on` にハンドラがある。 */
  eventTokenUnbound(token: string, hasHandler: boolean): string;
  /** 配列と分からない値の、添字の形（`this.errors[id] = …`）でのキーへの代入。`accessor` は `this.errors` の形。 */
  objectKeyAssign(target: string, accessor: string, suggestedPath: string): string;
  /** getter の中の現在時刻（`Date.now()` / 引数の無い `new Date()` / `performance.now()`）。キャッシュされ、最初の値のまま。 */
  getterReadsClock(read: string): string;
  /**
   * getter の中のウィンドウと文書の読み（`innerWidth`・`scrollY`・`matchMedia(…)`・`navigator.onLine`・`document.hidden` など）。
   * state ではないので追跡されず、getter は最初の値のまま。`kind` で、代わりに束ねる要素（`<wcs-resize>` /
   * `<wcs-media-query>` / `<wcs-network>`）か、要素の無いもの（スクロール位置・ページの可視性）は state に置いて
   * イベントハンドラから書く形を言う。
   */
  getterReadsAmbient(read: string, kind: AmbientReadKind): string;
  /** `$renderedCallback` が state に無いパスを判定に使っている（`paths` に現れないので、その分岐は走らない）。近い名前があるときだけ。 */
  updatedCallbackUnknownPath(path: string): string;
  /** 宣言したコマンドトークンを emit するが、どの `command.<method>:` 束縛にも結ばれていない。 */
  commandTokenUnbound(tokenPath: string): string;
  /** state が宣言していないトップレベルのキーへの書き込み（近い名前があるときだけ）。 */
  writePathMissing(key: string): string;
  /** A nested path a script writes (`this["items.*.lable"] = …`, `$setAll` / `$update`) that the state does not have. */
  nestedWritePathMissing(path: string): string;
  /**
   * getter・メソッドの中で読む state のパスが宣言に無い（近い名前があるときだけ）。`topLevel`: 宣言に無いトップレベルの
   * キー（ランタイムは読んだ時点で throw する）。そうでなければ読みは undefined になる。
   */
  readPathMissing(path: string, topLevel: boolean): string;
  /** `export default { … }` のトップレベルの spread: それが持ち込むキーは読めず、stateSchema が無いのでパスを検査しない。 */
  pathDynamicUnknownSpread(spread: string): string;
  /**
   * A key whose value the analyzer could not read (a name it could not follow to a literal), with bindings under it:
   * those paths are not checked. `name` is the name the value is written as, `from` the specifier it is imported from.
   */
  pathDynamicUnknownValue(path: string, count: number, name?: string, from?: string): string;
  /**
   * A slot an output of a custom element writes (`member` of `<tag>`), with bindings under it: what it holds is what
   * the element gives, so those paths are not checked.
   */
  pathDynamicUnknownOutput(path: string, count: number, tag: string, member: string): string;
  /**
   * A key (or a getter) whose JSDoc type names a type the lint cannot read — `import("./api.ts").Reservation` where the
   * file is not read or `Reservation` is not an `export interface` / `export type` it reads — with bindings under it:
   * those paths are not checked. `type` as written.
   */
  pathDynamicUnknownType(path: string, count: number, type: string): string;
  /**
   * The root state's script and the stateSchema applied to the page disagree on the top-level keys: `inScript` the
   * script declares and the schema lacks, `inSchema` the schema has and the script does not declare.
   */
  stateSchemaDrift(inScript: readonly string[], inSchema: readonly string[]): string;
  /**
   * A key seeded with an object literal whose keys are read but for a spread the analyzer could not read
   * (`draft: { ...makeDraft() }`), with bindings under it: those paths are not checked. `spread` as written, `from` the
   * specifier its name is imported from.
   */
  pathDynamicUnknownObjectSpread(path: string, count: number, spread: string, from?: string): string;
  /** 読めない `<wcs-state src>`: その state のパスもスクリプトの規則も検査しない。 */
  stateSrcUnread(src: string): string;
  /** 束縛があるのに `<wcs-state>` の無いファイル（`stateTag` は state のタグ名）: パスを検査していない。 */
  stateAbsent(stateTag: string): string;
  /** 双方向の束縛（`value:` / `checked:` / `radio:` / `checkbox:`）が setter の無い getter を指す。 */
  pathReadonlyTwoWay(path: string, property: string): string;
  /**
   * A member of a custom element that the element writes (`member` of `<tag>`, declared in `wcBindable.properties`)
   * bound to a getter without a setter (`path`). `atInit`: the element writes when it is bound, so the state fails to
   * initialize; otherwise the write fails each time the element reports a value. `twoWay`: the member is an input
   * too (`#ro` makes the binding one-way); otherwise it is output-only. `spread`: the spread that binds the member
   * (`...: lock`), when it is not written out.
   */
  pathReadonlyOutput(path: string, tag: string, member: string, atInit: boolean, twoWay: boolean, spread?: string): string;
  /** A script writes a getter without a setter (`this.total = 0`, `$setAll` / `$update` / `$resolve` on its path). */
  pathReadonlyWrite(path: string): string;
  /** A getter writes a path while it is evaluated (`via`: through the method it calls). */
  getterWrite(path: string, getter: string, via?: string): string;
  /** A setter writes its own path. */
  setterCycleSelf(path: string): string;
  /** Setters write each other (`cycle`: `"a" -> "b" -> "a"`). */
  setterCycle(cycle: string): string;
  /** A setter writes `writes`, none of which its getter reads. */
  setterUnobserved(path: string, writes: string): string;
  /** Appended to a path message: the path was written relative to the row (`relative`) in the accessor `accessor`. */
  relativePathOf(relative: string, accessor: string): string;
  /** A relative path in an accessor that is not a row's (its key has no `*`). */
  relativeNoRow(relative: string, accessor: string): string;
  /** A relative path handed to an API that takes its rows from `indexes` (`$resolve`, `$setAll`, `$update`). */
  relativeApiPath(relative: string, api: string): string;
  /** A key listing several accessor paths is malformed (`why`: a space, an empty entry, a recursive path). */
  accessorListSyntax(key: string, why: 'space' | 'empty' | 'recursive'): string;
  /** An accessor declared for several lists names the rows of one of them (`path`) by its full path. */
  accessorListPath(path: string, list: string, other: string, relative: string): string;
  handlerFilterNotAllowed(property: string): string;
  typeExpectation(label: string, expected: ExpectedTypeKind, resultType: string): string;
  /**
   * `attr.<a boolean HTML attribute>:` given a boolean (`attr.disabled: flag`): it is written "true" / "false", and the
   * attribute is on whenever it is present. `property` is the element's property that takes the boolean, `rhs` the
   * binding's right side as written.
   */
  attrBooleanPresence(attribute: string, property: string, rhs: string): string;
  /** `attr.<name>:` given a boolean, any other attribute: written as the text "true" / "false", never removed. */
  attrBooleanText(attribute: string, rhs: string): string;
  // --- formInputValidator ---
  /**
   * Radios in a `for:` row with a literal `name` and a binding of the row's: the browser makes one group of every
   * row's radios. `binding` is the binding that holds the row's value (`radio` / `checked`).
   */
  radioNameShared(name: string, binding: 'radio' | 'checked'): string;
  /**
   * `radio:` / `checkbox:` written before the binding that gives the control its value. `binding` and `value` are
   * the two left sides as written (`radio#ro`, `attr.value`); `fix` is the two bindings in the order that works.
   */
  radioBeforeValue(binding: string, value: string, checkbox: boolean, fix: string): string;
  /** The right side of a binding is an expression. `fix`: the path and filter that write it (`x|not`), or null (a getter). */
  bindingExpression(expression: string, fix: string | null): string;
  /** An event binding whose right side is a call or a function. `method`: the method it calls, when it can be told. */
  handlerExpression(property: string, expression: string, method: string | null): string;
  /** `{{ }}` in the value of the attribute `name`. */
  attributeMustache(name: string): string;
  /** A structural binding (`if` / `elseif` / `else` / `for`) on an element that is not a `<template>`. */
  structuralElement(directive: string, tagName: string): string;
  /** `this.<key>.<method>(…)` on a `Set` / `Map` of the state. */
  collectionMutation(key: string, method: string, kind: 'Set' | 'Map'): string;
  /** A literal id every row of a `for:` shares. */
  rowIdShared(id: string): string;
  /** `onSubmit:` — `lower` is the DOM event's spelling (`onsubmit`). */
  eventNameCase(property: string, lower: string): string;
  /** A relative or root-relative static import in an inline state (`guard`: a `<wcs-guard-handler>`'s) script. */
  inlineImport(specifier: string, guard: boolean): string;
  /** `key:` in a `data-wcs`. */
  keyBinding(): string;
  /**
   * A two-way `value:` with no conversion on the way in, into a path the state holds as a number. `path` and `left`
   * (the binding's left side, `value#onchange`) as written; `asNumber`: the element has `valueAsNumber`.
   */
  numberWrittenAsString(path: string, left: string, asNumber: boolean): string;
  /**
   * An output filter on a two-way `value:` / `valueAsNumber:` (`property`). `filters` (`|upper`), `left` and `rhs`
   * (the binding's two sides) as written. `keystroke`: the binding writes back on every keystroke — a field the user
   * types in, on `input`; otherwise it writes back a committed value (`#onchange`, a slider, a picker, a `<select>`)
   * and has no input filter to undo the output.
   */
  twoWayOutputFilter(property: string, filters: string, left: string, rhs: string, keystroke: boolean): string;
  // --- bindingHostValidator ---
  /** The bind attribute (`attribute`) written on `<body>` or `<html>` (`tag`): `<wcs-state>` binds only what is inside `<body>`. */
  bodyBinding(tag: string, attribute: string): string;
  /** An `on*:` binding (`property`, as written without modifiers) on a `<wcs-link>`: the host is `display: none`, so `handler` never runs. */
  linkHandler(property: string, handler: string): string;
  // --- ioAttributeValidator ---
  /**
   * A literal `root-margin` (`value`) on `<wcs-intersect>` / `<wcs-infinite-scroll>` (`tag`) the browser refuses.
   * `refused`: the values that are not a number with px or % (empty: there are more than four values); `suggested`:
   * the value with `px` added to its unitless numbers, or null when that does not make it valid.
   */
  rootMarginUnit(tag: string, value: string, refused: readonly string[], suggested: string | null): string;
  /**
   * A literal `frequency` (`value`) on a sensor tag (`tag`) that is not a positive finite number: the element reads it
   * as "none" and the sensor runs at the browser's default rate. `suggested`: the number the value starts with, when it
   * starts with a positive one (`60` for `60hz`), or null.
   */
  frequencyInvalid(tag: string, value: string, suggested: string | null): string;
  /**
   * A literal `target` (`value`) on a tag that takes a CSS selector there (`tag`), written as a bare word: it selects
   * `<value>` elements, the document has none, and it has an element with that id.
   */
  targetSelector(tag: string, value: string): string;
  // --- commandArgumentValidator ---
  /**
   * An `on*:` binding (`property`, without modifiers) that emits a command token (`token`, `$command.<name>`) straight
   * from the event: every subscriber is called with the event as its first argument, and `method` of `<tag>` — bound
   * with `command.<method>: <token>` — declares parameters. `more`: how many other such subscribers the document has.
   */
  commandEventArgument(property: string, token: string, tag: string, method: string, more: number): string;
  // --- outputPathValidator ---
  /**
   * A script assigns `true` to `path`, which is bound only to outputs of custom elements — `member` of `<tag>`.
   * `commands`: the commands that element declares (empty: it has none).
   */
  outputPathWritten(path: string, tag: string, member: string, commands: readonly string[]): string;
  filterUnknown(name: string): string;
  /** 4.0 で外れたフィルタの旧名（`uc` → `upper`。ランタイムは `[wcs/filter-unknown]`）。 */
  filterRemoved(name: string, canonical: string): string;
  /** 4.0 で外れた `substr`。`rewrite` は引数から計算した `slice(…)`（計算できなければ null）。 */
  substrRemoved(rewrite: string | null): string;
  filterMinArgs(name: string, minArgs: number, argCount: number): string;
  filterMaxArgs(name: string, maxArgs: number, argCount: number): string;
  filterArgType(name: string, argPosition: number, expectedType: string, argText: string, actualType: string): string;
  filterInputType(name: string, acceptTypes: string, currentType: string): string;
  /**
   * A comparison filter's literal argument (`eq('aproved')`) that the value it compares never is: `members` are the
   * values its type allows (a stateSchema `enum`, a JSDoc literal union), `suggestion` the "did you mean" suffix.
   */
  filterArgEnum(name: string, arg: string, members: readonly string[], suggestion: string): string;
  moustacheFouc(expression: string): string;
  /** `<title>` / `<textarea>` の中の `{{ }}`（`<template>` の外）: コメントの形はそこでは束縛にならない。 */
  moustacheFoucTextParent(expression: string, tag: 'title' | 'textarea'): string;
  /** 文書の `<head>` の中の `{{ }}` / コメント束縛（`written` は書かれた形）: ランタイムは束ねない。 */
  textBindingInHead(written: string): string;
  // --- nestedAssignValidator / stateTypeValidator ---
  nestedAssign(suggestedPath: string): string;
  typeAnnotationIncompatible(valueType: string, rawType: string): string;
  // --- watchDeclarationValidator ---
  /** `$watch` の値がオブジェクトでないと静的に断定できる（ランタイムは読み込み時に throw）。 */
  watchNotObject(): string;
  watchKeyCrossState(key: string): string;
  watchKeyReserved(key: string): string;
  watchKeyEmptySegment(key: string): string;
  watchHandlerNotFunction(key: string): string;
  watchPathMissing(key: string): string;
  // --- scanDeclarationValidator ---
  /**
   * 4.0 で外れた `$scan` を宣言した。diagnostics の後付けを入れた入口（`/auto` など）は読み込み時に throw し、
   * `/core` だけのページはキーを黙って無視する。ボリューム（`mountPath` が非 null）は
   * 読み込みを通らず、接ぎ木を拒んで console.error で報告する（その state は木に載らない）。
   */
  scanRemoved(mountPath: string | null): string;
  // --- arrayMutationValidator ---
  arrayMutation(method: string, alternative: string): string;
  arrayIndexAssign(suggestedPath: string): string;
  /** state の値を指す別名（`const cards = this.cards`）を通したその場の変更。`source` は別名の初期化、`target` は代入する先。 */
  inPlaceAlias(alias: string, source: string, target: string): string;
  /** 別名を通さないその場の変更（`Object.assign(this.x…, …)`、$on の `state.x.push(…)`）。`source` は変更の式。 */
  inPlaceChange(source: string, target: string): string;
  // --- ioNodeValidator ---
  tagMemberUnknown(property: string, tag: string): string;
  /**
   * `on` で始まるメンバーをドット無しで束縛した。提案する書き方には**書かれた修飾子**を
   * そのまま残す（`once#ro:` には `.once#ro:` と言う — 修飾子を落とすと直しの手が 1 つ増える）。
   */
  onPrefixedMember(member: string, tag: string, modifiers?: string): string;
  /** 4.0 で外れた API の旧名（`$trackDependency` → `$dependOn`。ランタイムは読んだ時点で `[wcs/name-alias]`）。 */
  nameAlias(written: string, canonical: string): string;
  /**
   * 4.0 で外れた宣言キーの旧名を `this.` 越しに**読んだ**（`this.$streams`）。4.0 の state に
   * そのキーは無いので、読み出しは黙って `undefined` になる（宣言していれば読み込み時に throw）。
   * 正式名（`$stream`・`$renderedCallback`）も宣言で、`this` 越しには読めない — 書き換えを勧めない。
   */
  declarationAliasRead(alias: string, canonical: string): string;
  /** 4.0 で外れた宣言キーの旧名を宣言した（`$streams` → `$stream`。ランタイムは読み込み時に `[wcs/declaration-alias]`）。 */
  declarationAlias(alias: string, canonical: string): string;
  /**
   * 同上をボリューム（`mount=`）で宣言した。ボリュームは読み込み（#1601）を通らず、ランタイムは接ぎ木を拒んで
   * console.error で報告する。正式名（`$stream` / `$renderedCallback`）もボリュームでは宣言できないので root を案内する。
   */
  declarationAliasInVolume(alias: string, canonical: string, mountPath: string): string;
  // --- configDeclarationValidator（`$behavior` / `$features` / `features=`。4.0） ---
  /** `$behavior` の値がオブジェクトでない（ランタイムは読み込み時に throw）。`keys` は manifest の `behaviorOptions` のキー。 */
  behaviorNotObject(keys: readonly string[]): string;
  /** `$behavior` の知らないキー（`keys` は受け付けるキー、`suggestion` は「もしかして」の suffix）。 */
  behaviorKeyUnknown(key: string, keys: readonly string[], suggestion: string): string;
  /** `$behavior` の値の型が違う（`type` は manifest の `behaviorOptions[key].type`）。 */
  behaviorValueType(key: string, type: string): string;
  /** ボリューム（`mount=`）の `$behavior` / `$features`（ランタイムは接ぎ木を拒み、console.error で報告する）。 */
  configInVolume(key: string, mountPath: string): string;
  /** `$features` の値が配列でない（ランタイムは読み込み時に throw）。 */
  featuresNotArray(): string;
  /** `$features` / `features=` の知らない後付けの名前（`names` は manifest の `features`、`suggestion` は「もしかして」の suffix）。 */
  featureUnknown(name: string, names: readonly string[], suggestion: string): string;
  // --- scopeDeclarationValidator（ボリューム・マウントしたコンポーネントの宣言。4.0） ---
  /** ボリュームが拒む宣言（scopes/volume.ts の REJECTED。ランタイムは接ぎ木を拒んで console.error）。 */
  volumeDeclarationRejected(key: string, mountPath: string): string;
  /** ボリュームでは実行されない宣言（scopes/volume.ts の NOT_RUN。ランタイムは console.warn で知らせ、その宣言を無視する）。 */
  volumeDeclarationNotRun(key: string, mountPath: string): string;
  /** `<wcs-state bind-component>` と併記した読み込み（`sources` は属性名か `<script type="module">`。ランタイムは読み込みを拒んで console.error）。 */
  bindComponentSource(prop: string, sources: readonly string[]): string;
  /** 同じ root の 2 つ目の `<wcs-state>`（ランタイムの #47。後から読み込んだ方を拒んで console.error）。 */
  secondRoot(): string;
  /**
   * A path in the template of a mounted class part (`tag`) whose first key (`key`) is not the part's, not handed to
   * it, and not on the object it is mounted on (`object`: that object's path in the page's tree; null when the part
   * is mounted on no object). `prop` is the part's state property (`state`).
   */
  partPathMissing(path: string, tag: string, key: string, prop: string, object: string | null): string;
  /** Appended to it when `key` is a top-level path of the page's own state. */
  partPathOfPage(key: string, prop: string): string;
  /** A `<wcs-state bind-component>` in a DCC definition (`tag`): the runtime refuses the definition. */
  dccBindComponent(tag: string): string;
  /** A second `<wcs-state>` of the definition's own (not in a template of its content). */
  dccSecondState(tag: string): string;
  /** `$bindables` / `$commands` (`key`) whose value is a literal that is not a list. */
  dccListNotArray(key: string): string;
  /** An empty string in the list. */
  dccEntryEmpty(key: string): string;
  /** An entry that starts with `$`. */
  dccEntryInternal(key: string, name: string): string;
  /** An entry written twice. */
  dccEntryDuplicated(key: string, name: string): string;
  /** An entry the state does not have. */
  dccEntryMissing(key: string, name: string): string;
  /** A method listed in `$bindables`. */
  dccBindableIsMethod(name: string): string;
  /** A value (a data key, a getter) listed in `$commands`. */
  dccCommandIsValue(name: string): string;
  /** An instance of a DCC (`tag`) carrying one of its `$bindables` (`name`) as an attribute. */
  dccAttribute(tag: string, name: string): string;
  /** `$1`〜`$128` の範囲の外の添字（ランタイムの `[wcs/index-param-range]`。`max` は manifest の `syntax.indexParam.maxDepth`）。 */
  indexParamRange(key: string, max: number): string;
  /** マークアップの `$0` / `$01` / `$1000`（添字の形でなく、`$` の名前空間にパスも無い。ランタイムは `[wcs/binding-path-missing]` でバインディングを失敗させる）。 */
  indexParamNotPath(key: string, max: number): string;
  /** 文書の root 以外の `<wcs-state>` の `features=`（ランタイムは読まない）。 */
  featuresAttrNotRoot(): string;
  tagCommandUnknown(name: string, tag: string, declared: string): string;
  /** ネイティブ要素の `command.<method>:` のメソッドが native-commands 後付けの表に無い（`allowed` はその要素に呼べるもの。ランタイムは #1205 で初期化に失敗する）。 */
  nativeCommandUnknown(method: string, tag: string, allowed: string): string;
  spreadNoBindable(tag: string): string;
  tagEventTokenKeyUnknown(name: string, tag: string, declared: string): string;
  /** `semantics: "handle"` の出力（`<wcs-camera>` の `streamReady`）を値として束ねた（ioNodeValidator）。 */
  handleBoundAsValue(name: string, tag: string): string;
  /** `attr.aria-*` の属性名が WAI-ARIA に存在しない（ariaValidator）。 */
  ariaAttrUnknown(name: string): string;
  /**
   * ライブリージョン（`attribute` は `aria-live="polite"` / `role="status"` のように書かれたまま）が、行（`for`）・
   * 枝（`if`）・ルート（`route`）と一緒に、文ごと挿入される（liveRegionValidator）。`condition` は、文が枝の条件の
   * 読むパスに束ねてあるときのその条件（null なら、リージョンが文を書いて持っている）。
   */
  liveRegionInserted(attribute: string, by: 'for' | 'if' | 'route', condition: string | null): string;
  /** 最近傍候補の「もしかして」suffix。 */
  didYouMean(candidate: string): string;
  /** 宣言済みメンバーが空のときの placeholder。 */
  none(): string;
  triggerSeededTruthy(path: string): string;
  storageSeedClobber(path: string, rawInitial: string): string;
  storageInitSeed(path: string, rawInitial: string): string;
  /** 非 manual の `<wcs-storage>` の value を `#init=element` なしでアクセサペア `path` に束ねた。 */
  storagePairClobber(path: string): string;
  /** `tag` の入力 `input` を束ねた `path` の下へ、ページが `example` に書き込む。 */
  inputNestedWrite(tag: string, input: string, path: string, example: string): string;
  /** 同上で、`input` が要求のたびに null へ戻る使い捨ての入力（`<wcs-fetch>` の `body`）。 */
  inputNestedWriteOneShot(tag: string, input: string, path: string, example: string): string;
  // --- documentEnvValidator ---
  devtoolsAfterState(): string;
  baseHrefMissing(): string;
  /** `<wcs-router>` の直後に無い `<wcs-outlet>`（どの router にも使われない）。 */
  routerOutletMisplaced(): string;
  /** `<wcs-link>` の `to` が付けるキー（`toKeys`）が、どれも `query-keys`（`named`）に無い。 */
  linkQueryKeyIgnored(toKeys: string, named: string): string;
  signalsDualEntry(): string;
  /** import map が @wcstack/signals と /dom の両方を割り当てている（別ファイルの module が 2 つ目のコアを持つ）。 */
  signalsImportMapBoth(): string;
  // --- packageLoadValidator ---
  /** ページが `pkg`（`@wcstack/upload`）のタグ `tags` を書くのに、そのスクリプトを読み込んでいない。`url` は読み込む `/auto`。 */
  tagPackageMissing(tags: readonly string[], pkg: string, url: string): string;
  /**
   * `<wcs-router>` の無いページの `<wcs-link>`: 接続で投げ、リンクは隠れる。`to` は最初のリンクの行き先、`count` は
   * そうなるリンクの数。
   */
  linkRouterMissing(to: string, count: number): string;
  /**
   * ページが lint の規則より新しい minor を固定している。`spec` は書かれたまま（`@wcstack/state@4.11.0`）、`version` は
   * その版、`minor` は `4.11`、`lint` は lint の規則の版（lint を作った @wcstack/state の版）。
   */
  lintVersionBehind(spec: string, version: string, minor: string, lint: string): string;
  /** `<wcs-route>`（またはレイアウトのテンプレート）の直下のテキストの `{{ }}`。 */
  routeBareMustache(inLayout: boolean): string;
  /** 既定の `<slot>` の無いレイアウトのテンプレートに、名前付きスロットの外の中身を渡している。 */
  layoutSlotMissing(layout: string): string;
  // --- namedStateValidator（deprecation） ---
  /** `<wcs-state name="x">` は v2 で `mount="x"` に置き換わる。 */
  namedStateAttrDeprecated(name: string): string;
  /** `path@name` は v2 で `name.path` に置き換わる（`@default` は単に外す）。 */
  namedStatePathDeprecated(name: string): string;
  // --- mountAttrValidator ---
  /**
   * `mount` 属性値が runtime（state の scopes/volume.ts の `validPath`）で拒まれる形。runtime の文面は
   * どの形でも `has an invalid mount path` で、ここは形ごとに理由を言う。
   */
  mountPathInvalid(problem: MountPathProblem, mountPath: string): string;
  // --- recursionValidator（$recursion / `**`） ---
  /**
   * `**` を解釈しない場所に `**` がある（`data-wcs` / mustache / `$watch` キー /
   * `$listKeys` キー / `$resolve` / `$postUpdate` / `$dependOn`（旧名 `$trackDependency`）/ 代入）、
   * または `$recursion` 宣言が無い。場所は `RecursionWildcardSite`。
   */
  recursionUnsupported(path: string, where: RecursionWildcardSite): string;
  /** 宣言済みアンカーと合致しない `**`（綴り違い・2 つ目の `**`・`**` の後ろが整形されていない）。 */
  recursionAnchorMismatch(path: string, recursiveAnchor: string): string;
  /** `$getAll("…**…", indexes)` の添字の形 — 非空の接頭辞（prefix）か、配列でない値（notArray）。 */
  recursionGetAllForm(path: string, problem: RecursionGetAllProblem): string;
  /** `$setAll("…**…", …)` の添字・値の形 — 非空の接頭辞 / 添字省略 / mapper / spread。 */
  recursionSetAllForm(path: string, problem: RecursionSetAllProblem): string;
  /** ノード自身 / 子リスト / 子ノード / その length / 子リストへ至る途中のオブジェクトへの一括書き込み。 */
  recursionStructuralWrite(path: string, target: 'node' | 'list' | 'branch' | 'length', repeatList: string): string;
  /**
   * 再帰 getter（またはその派生値の中）への書き込み。`subject` は書いた形そのもの
   * （`$setAll("nodes.**.total")` / `this["nodes.*.total"] = …` / `$resolve("nodes.*.total")`）。
   */
  recursionReadonly(subject: string, getterPath: string): string;
  /** ボリューム（`mount=`）の state が `$recursion` / `**` getter を宣言している（`$recursion` は接ぎ木を拒んで console.error）。 */
  recursionInVolume(subject: string, mountPath: string): string;
  /** `$recursion` の値がオブジェクトでない。 */
  recursionNotObject(): string;
  /** アンカーの本数が 1 でない（0 / 2 以上）。 */
  recursionAnchorCount(count: number): string;
  /** アンカー / 反復サブパスの形が不正。 */
  recursionNodePathInvalid(kind: RecursionNodePathKind, path: string, problem: RecursionNodePathProblem): string;
  /** 反復サブパスが文字列リテラルでない。 */
  recursionRepeatNotString(anchor: string): string;
  /** `**` を含むキーの宣言の形が不正（setter / getter でない / ノード自身 / 構造を名指す接尾辞）。 */
  recursionGetterInvalid(key: string, problem: RecursionGetterProblem, recursiveAnchor: string): string;
  /** 2 本の `**` getter が同じ具体パスへ展開する。 */
  recursionGetterCollision(a: string, b: string, repeat: string): string;
  /** 作者が手で書いた具体パス（`get "nodes.*.total"()`）が `**` getter の展開形と同名。 */
  recursionConcreteCollision(concreteKey: string, recursiveKey: string): string;
}

/**
 * getter が読んだウィンドウ・文書の値の種類（service/scriptAst.ts の findAmbientRead）: 大きさ（`innerWidth`・
 * `document.documentElement.clientWidth`）・`devicePixelRatio`・`matchMedia(…)`・`navigator.onLine`・スクロール位置
 * （`scrollY`・`document.documentElement.scrollTop`）・ページの可視性（`document.visibilityState` / `hidden`）。
 */
export type AmbientReadKind = 'size' | 'pixelRatio' | 'media' | 'online' | 'scroll' | 'visibility';

/** `mount` 属性値の不正の種類（runtime の validateVolumeMountPath の raise と 1:1）。 */
export type MountPathProblem = 'empty' | 'emptySegment' | 'wildcard' | 'whitespace' | 'reserved';

/** `**` が現れた場所（`**` を解釈しない消費者）。 */
export type RecursionWildcardSite =
  | 'binding' | 'watch' | 'resolve' | 'update' | 'undeclared'
  | 'assignment' | 'postUpdate' | 'dependOn' | 'trackDependency' | 'listKeys';
/** `$getAll` が `**` に対して拒否する添字の形。 */
export type RecursionGetAllProblem = 'prefix' | 'notArray';
/** `$setAll` が `**` に対して拒否する形。 */
export type RecursionSetAllProblem = 'prefix' | 'noIndexes' | 'mapper' | 'spread';
/** アンカー / 反復サブパスの種別（service/recursionPaths.ts の NodePathKind と同値）。 */
export type RecursionNodePathKind = 'anchor' | 'repeat';
/** アンカー / 反復サブパスの形の不正（service/recursionPaths.ts の NodePathProblem と同値）。 */
export type RecursionNodePathProblem =
  | 'empty' | 'emptySegment' | 'notElement'
  | 'reservedRoot' | 'reservedMount' | 'midWildcard' | 'nestedRecursion' | 'indexSegment';
/** `**` を含む宣言キーの不正。 */
export type RecursionGetterProblem = 'setter' | 'notGetter' | 'nodeItself' | 'structural';

/** 単位の無い 0（`0`・`0.0`・`-0`）— root margin では 0 にも単位が要る、と言い添えるため。 */
/** What a tag does when its `target` selects nothing (`wcs/target-selector`). */
const TARGET_EFFECT_JA: Readonly<Record<string, string>> = {
  'wcs-fullscreen': 'requestFullscreen() は失敗し、それを知らせるのは error の出力だけです',
  'wcs-pip': 'requestPictureInPicture() は失敗し、それを知らせるのは error の出力だけです',
  'wcs-pointer-lock': 'requestPointerLock() は失敗し、それを知らせるのは error の出力だけです',
  'wcs-intersect': '要素は何も監視せず、observing は false のままです',
  'wcs-resize': '要素は何も監視せず、observing は false のままです',
};
const TARGET_EFFECT_EN: Readonly<Record<string, string>> = {
  'wcs-fullscreen': 'requestFullscreen() fails, and only the error output says so',
  'wcs-pip': 'requestPictureInPicture() fails, and only the error output says so',
  'wcs-pointer-lock': 'requestPointerLock() fails, and only the error output says so',
  'wcs-intersect': 'the element observes nothing and observing stays false',
  'wcs-resize': 'the element observes nothing and observing stays false',
};

function isUnitlessZero(token: string): boolean {
  return /^[+-]?(?:0+\.?0*|\.0+)$/.test(token);
}

/** シードの原文（長いリテラルは先頭だけ）。 */
function shortSeed(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ');
  return flat.length <= 32 ? flat : `${flat.slice(0, 29)}…`;
}

/** At most this many keys are named in one message (the rest are counted). */
const MAX_LISTED_KEYS = 10;

/** The assignment that replaces `this.<key>.<method>(…)` on a `Set` / `Map` (`wcs/collection-mutation`). */
function collectionFix(key: string, method: string, kind: 'Set' | 'Map'): string {
  const k = `this.${key}`;
  if (method === 'clear') return `${k} = new ${kind}()`;
  if (kind === 'Set') return method === 'add' ? `${k} = new Set([...${k}, id])` : `${k} = new Set([...${k}].filter((x) => x !== id))`;
  return method === 'set' ? `${k} = new Map([...${k}, [key, value]])` : `${k} = new Map([...${k}].filter(([k]) => k !== key))`;
}

/** `a, b, c` — past MAX_LISTED_KEYS, `… (+N)`. */
function listKeys(keys: readonly string[]): string {
  return keys.length <= MAX_LISTED_KEYS ? keys.join(', ') : `${keys.slice(0, MAX_LISTED_KEYS).join(', ')} … (+${keys.length - MAX_LISTED_KEYS})`;
}

const JA_EXPECTED_LABEL: Record<ExpectedTypeKind, string> = {
  array: '配列型のパス',
  boolean: 'ブーリアン型',
  string: '文字列型',
};

const ja: WcsMessageCatalog = {
  spreadFilterNotAllowed: () => `スプレッドのターゲットにフィルタは使用できません`,
  spreadTargetRequired: () => `スプレッドにはターゲットパスが必要です`,
  structuralMustBeSingle: (d) => `'${d}' バインディングは単独で指定する必要があります（';' で他のバインディングと併記できません。ランタイムは読み込み時に throw します）`,
  bindingSyntax: (detail) => `バインディングの構文エラー（ランタイムは読み込み時に throw します）: ${detail}`,
  eventTokenUndeclared: (t) => `イベントトークン "${t}" は $eventTokens に宣言されていません`,
  commandRhsFormat: () => `command バインディングの右辺には $command.<name>（$commandTokens で宣言）を指定してください`,
  commandTokenUndeclared: (t) => `コマンドトークン "${t}" は $commandTokens に宣言されていません`,
  commandTokensAbsent: (t, name) =>
    `コマンドトークン "${t}" は宣言されていません。この state には $commandTokens がありません。state に $commandTokens: ["${name}"] を足してください`,
  eventTokensAbsent: (t) =>
    `イベントトークン "${t}" は宣言されていません。この state には $eventTokens がありません。state に $eventTokens: ["${t}"] を足してください`,
  onEntryUndeclared: (t, absent) =>
    `$on のエントリ "${t}" は $eventTokens に宣言されていません${absent ? '（この state には $eventTokens がありません）' : ''}。state は読み込みで失敗し、ページは初期化されません（$on entry "${t}" is not declared in $eventTokens）。${absent ? `$eventTokens: ["${t}"] を足してください` : `$eventTokens に "${t}" を足してください`}`,
  streamPathMissing: (p) => `パス "${p}" は $stream 宣言に存在しません`,
  pathMissing: (p) => `パス "${p}" は状態定義に存在しません`,
  pathNonexistent: (p) => `パス "${p}" は宣言された stateSchema に存在しません`,
  pathTypeMismatch: (p, label, expected, actual) =>
    `パス "${p}" は stateSchema 上で ${actual} 型ですが、${label} には${JA_EXPECTED_LABEL[expected]}が必要です`,
  expansionSuffix: (x) => `（展開: ${x}）`,
  patternPathOutsideFor: (p) => `パターンパス "${p}" は <template for> の外側では使用できません（4.0 は初期化で #1401 を投げます）`,
  omittedPathOutsideFor: (p) => `省略パス "${p}" は <template for> の外側では使用できません（4.0 は初期化で #1402 を投げます）`,
  loopIndexOutsideFor: (p) => `ループインデックス "${p}" は <template for> の外側では使用できません（4.0 は初期化で #1401 を投げます）`,
  indexArity: (api, p, req, wc, actual) =>
    `${api}("${p}") の添字は${req === "exact" ? `ちょうど ${wc} 個` : `${wc} 個以下`}である必要があります（パス中の "*" は ${wc} 個）。${actual} 個指定されています`,
  wildcardRank: (subject, needed, available) =>
    `${subject} は ${needed} 段のループが必要ですが、現在のスコープは ${available} 段です`,
  wildcardOtherList: (p, over, loop) =>
    `"${p}" の "*" は "${over}" の行を指しますが、その段で囲む for テンプレートが描くのは "${loop}" です（4.0 はバインド確立時に throw します）。束縛の "*" は囲むループの行です — 別のリストの行は getter の中で $resolve(path, indexes) で読んでください`,
  outerInTemplate: (prop) =>
    `"${prop}:" は要素そのものを置き換えるので、for / if テンプレートの中では使えません（行や枝はノードを位置で持つため。4.0 は初期化で throw します）。包む要素に innerHTML: を束縛してください`,
  directNotEvent: (prop) =>
    `修飾子 #direct はイベント束縛（on*:）だけに効きます。"${prop}" では無視されます`,
  delegatedCurrentTarget: (suggested, eventName, handler) =>
    `"${eventName}" イベントの束縛は root へ委譲されるので、"${handler}" の中の event.currentTarget はこの要素ではなく root になります。要素にリスナーを付けるには "${suggested}:" と書くか、event.target.closest(...) で要素を探してください`,
  getterCycle: (cycle) => `パス getter が循環参照しています: ${cycle}`,
  updatedCallbackUnbound: (p) =>
    `$renderedCallback は binding 駆動です。"${p}" はこのドキュメントのどのバインディングにも現れないため、この分岐は一度も実行されません。描画に依存せず反応するなら $watch を使ってください`,
  onHandlerThis: (name) =>
    `$on のハンドラ "${name}" が this を使っています。$on のハンドラは state を第 1 引数で受け取り（\`${name}(state, event) { state.x = … }\`）、this は undefined なので、this.… は呼ばれたときに例外になります。$watch やメソッドと違う点に注意`,
  getterReadsLocation: (read) =>
    `この getter は ${read} を読んでいますが、location は state ではないので、最初に読んだ URL を持ち続けます（ナビゲーションで再評価されません）。URL は state を通して読んでください — <wcs-router> の path / searchParams を束ねる`,
  getterReadsClock: (read) =>
    `この getter は ${read} を読んでいますが、時刻は state ではないので依存として登録されず、getter はキャッシュした最初の値を返し続けます（イベントトークンで毎フレーム「描き直し」ても変わりません）。時刻を state に置いてください — <wcs-raf> や <wcs-timer> が書く値を束ねる`,
  getterReadsAmbient: (read, kind) => {
    const head = `この getter は ${read} を読んでいますが、state ではないので依存として登録されず、getter はキャッシュした最初の値を返し続けます`;
    switch (kind) {
      case 'size':
        return `${head}（リサイズしても再評価されません）。大きさを state に置いてください — <wcs-resize> が書く width / height を束ねる（ブレークポイントの判定なら <wcs-media-query> の matched）`;
      case 'pixelRatio':
        return `${head}（拡大しても、別の画面へ移しても再評価されません）。ページが使う解像度のしきい値を <wcs-media-query> の matched で束ねてください（query="(min-resolution: 2dppx)"）`;
      case 'media':
        return `${head}（クエリが合うようになっても、合わなくなっても再評価されません）。<wcs-media-query> の matched を束ねてください（<wcs-media-query query="(max-width: 600px)" data-wcs="matched: narrow">）`;
      case 'online':
        return `${head}（オフラインになっても、戻っても再評価されません）。<wcs-network> の offline を束ねてください`;
      case 'scroll':
        return `${head}（スクロールしても再評価されません）。スクロール位置を出す wcstack の要素は無いので、値を state に置き、イベントハンドラ（scroll のリスナー）から書いてください`;
      default:
        return `${head}（ページが隠れても、表示されても再評価されません）。ページの可視性を出す wcstack の要素は無いので、値を state に置き、イベントハンドラ（visibilitychange のリスナー）から書いてください`;
    }
  },
  updatedCallbackUnknownPath: (p) =>
    `"${p}" は state のパスではないので $renderedCallback の paths に現れず、この分岐は一度も実行されません`,
  commandTokenUnbound: (t) =>
    `コマンドトークン "${t}" を emit していますが、このドキュメントにそれを受ける command.<メソッド>: ${t} の束縛がありません。emit は誰にも届きません。メソッドを呼ぶ要素に束ねてください（command.<メソッド>: ${t} — <メソッド> はその要素のメソッドの名前）`,
  writePathMissing: (k) =>
    `"${k}" は state が宣言していないキーです。書き込みは新しいキーを作るだけで、宣言したキーの束縛には届きません`,
  pathReadonlyWrite: (p) =>
    `"${p}" は setter の無い getter なので、この書き込みは実行のたびに例外になります（"${p}" is a getter without a setter）。getter が読む値を書く setter を足す（set "${p}"(v) { … }）か、その値を直接書いてください`,
  getterWrite: (p, g, via) =>
    `getter "${g}" の評価中に "${p}" を書いています${via === undefined ? '' : `（呼んでいるメソッド "${via}" の中）`}。getter は読むだけで、書き込みは評価のたびに例外になります。メソッド・setter・$watch のハンドラから書くか、値を別の getter で計算してください`,
  setterCycleSelf: (p) =>
    `"${p}" の setter が自分のパス "${p}" に書いています。setter のパスはアクセサそのものなので、書けば setter がまた呼ばれ、スタックが溢れるまで続きます。値は getter が読むデータのパス（_${p.split('.').pop()} など）に置いてください`,
  setterCycle: (cycle) =>
    `setter が互いに書き合っています: ${cycle}。条件で止まらなければ、互いを呼び続けてスタックが溢れます。値は getter が読むデータのパスに置いてください`,
  setterUnobserved: (p, w) =>
    `"${p}" の setter は ${w} を書きますが、getter "${p}" はそのどれも読みません。書いた後も getter は元の値を返し、"${p}" に束ねた双方向の入力はそこへ戻ります。getter が読む値を書くか、setter が書く値を getter で読んでください`,
  relativePathOf: (r, a) => `（アクセサ "${a}" の中の "${r}"）`,
  relativeNoRow: (r, a) =>
    `"${r}" は行からの相対パスですが、アクセサ "${a}" はリストの行のものではありません（キーに "*" がありません）。行が無いので、評価のたびに例外になります（#1402）。フルパスで書くか、行のアクセサ（get "<リスト>.*.<名前>"()）にしてください`,
  relativeApiPath: (r, api) =>
    `"${r}" は行からの相対パスですが、${api} は行を添字の引数で受け取り、呼ばれた行からは取りません。相対パスはここでは展開されず、呼び出しは例外になります。フルパスで書いてください（"<リスト>.*${r === '.' ? '' : r}"）`,
  accessorListSyntax: (k, why) =>
    `アクセサのキー "${k}" は複数のパスの並びですが、${why === 'space' ? 'カンマの前後に空白があります' : why === 'empty' ? '空の項目があります' : '再帰のパス（"**"）は並べられません'}。パスはカンマだけで区切ります（get "users.*.fullname,employees.*.fullname"()）${why === 'recursive' ? '' : '。ランタイムはカンマの間をそのままパスにするので、このままでは誰も読まないパスが宣言されます'}`,
  accessorListPath: (p, list, other, rel) =>
    `"${p}" は "${list}" の行のパスですが、このアクセサは "${other}" にも宣言されています。そちらの行ではこのパスに行が無く、読みは undefined、書きは例外になります。行からの相対パスで書いてください: this["${rel}"]`,
  nestedWritePathMissing: (p) =>
    `パス "${p}" は状態定義に存在しません。書き込みはオブジェクトに新しいキーを作るだけで、宣言したパスの束縛には届きません`,
  readPathMissing: (p, top) => top
    ? `"${p}" は state が宣言していないキーです。読んだ時点で例外になります（#301）`
    : `パス "${p}" は状態定義に存在しません。読みは undefined になり、そこから計算した値は黙って違います`,
  stateSrcUnread: (src) =>
    `"${src}" を読めないので、この state のパスもスクリプトの規則も検査していません。src はこのファイルからの相対パスで読みます（URL は読まず、/ から始まるパスは wcs-validate --root=<サイトのルート> のときだけその下で読みます）。サーバーと同じ並びに置いたファイルを、このファイルからの相対パスで指すか、--root を渡してください`,
  stateAbsent: (tag) =>
    `このファイルには束縛がありますが <${tag}> が無いので、束縛のパスは検査していません（ページが取り込む断片や、state をスクリプトで作るページ）。state のあるページを検査するか、このファイルの隣（か上）の wcstack.manifest.json の stateSchema にパスを宣言すると検査されます`,
  pathDynamicUnknownValue: (path, n, name, from) =>
    `"${path}" の値${name === undefined ? '' : from === undefined ? `（${name}）` : `（${name}。"${from}" から import）`}は静的に読めないので、その下に束ねたパス（${n} 件）は検査していません。キーに JSDoc の @type — 形か、モジュールのリテラルを指す typeof import("./file.js").name（辞書なら全部のキーを持つ既定の言語のファイル）— を付けるか、wcstack.manifest.json の stateSchema に宣言すると検査されます`,
  pathDynamicUnknownType: (path, n, type) =>
    `"${path}" の JSDoc の型 ${type} は読めないので、その下に束ねたパス（${n} 件）は検査していません（読むのは、読めるファイルの export interface / export type、.js の @typedef）。形をその場で書くか、同じスクリプトの @typedef にするか、wcstack.manifest.json の stateSchema に宣言すると検査されます`,
  stateSchemaDrift: (inScript, inSchema) =>
    `このページに当てた stateSchema が state のスクリプトと食い違っています${inScript.length > 0 ? `（スクリプトにあって schema に無いキー: ${listKeys(inScript)}）` : ''}${inSchema.length > 0 ? `（schema にあってスクリプトに無いキー: ${listKeys(inSchema)}）` : ''}。schema はスクリプトから作る派生物なので、古いか、別の state（別のページ）のものです — そのまま検査すると、名前を変えたキーへの束縛が通り、あるキーが存在しないと言われます。wcs-schema emit で作り直し（作った manifest は元の state のファイルを stateSource に記し、lint はそのファイルを読むページにだけ当てます）、CI では wcs-schema check で食い違いを止めてください`,
  pathDynamicUnknownOutput: (path, n, tag, member) =>
    `"${path}" は <${tag}> の出力 "${member}" が書くので、中身は要素が渡すものです。その形は静的に読めないので、その下に束ねたパス（${n} 件）は検査していません。キーに形を表す JSDoc の @type を付けるか、wcstack.manifest.json の stateSchema に宣言すると検査されます`,
  pathDynamicUnknownSpread: (sp) =>
    `${sp} が持ち込むキーは静的に読めないので、この state のパスは検査していません（束縛・getter の中の読み・$watch のキー）。キーを wcstack.manifest.json の stateSchema に宣言すると検査されます。npx wcs-schema（@wcstack/typescript）が state の型（JSDoc・TypeScript）から作れます`,
  pathDynamicUnknownObjectSpread: (path, n, sp, from) =>
    `${sp}${from === undefined ? '' : `（"${from}" から import）`}が "${path}" に持ち込むキーは静的に読めないので、その下に束ねたパス（${n} 件）は検査していません。オブジェクトリテラルを束縛するモジュールの const を spread するか、キーに形を表す JSDoc の @type を付けるか、wcstack.manifest.json の stateSchema に宣言すると検査されます`,
  pathReadonlyTwoWay: (p, prop) =>
    `"${p}" は setter の無い getter ですが、${prop}: は読者の入力を書き戻すので、入力のたびに書き込みが失敗します（"${p}" is a getter without a setter）。setter を足す（set "${p}"(v) { … }）か、#ro で一方向にしてください（${prop}#ro: ${p}）`,
  pathReadonlyOutput: (p, tag, member, atInit, twoWay, spread) =>
    `"${p}" は setter の無い getter ですが、${spread === undefined ? '' : `"${spread}" が束ねる `}"${member}" は <${tag}> が書くメンバー（${twoWay ? '入力でもある出力' : '出力'}）です。要素はその値を "${p}" に書くので、${atInit ? '束ねた時点の書き込みが失敗し、state の初期化が失敗します' : '要素が値を知らせるたびに書き込みが失敗します'}（"${p}" is a getter without a setter）。${spread !== undefined
      ? `setter を足す（set "${p}"(v) { … }）か、spread の後ろで "${member}" をデータのパスに束ねてください（${spread}; ${member}: <データのキー>）`
      : !twoWay
        ? `データのパスを束ねてそれを getter から読む（${member}: <データのキー>）か、setter を足してください（set "${p}"(v) { … }）`
        : atInit
          ? `setter を足す（set "${p}"(v) { … }）か、最初の値を state から取ってください（#init=element を外す）`
          : `setter を足す（set "${p}"(v) { … }）か、#ro で一方向にしてください（${member}#ro: ${p} — state から要素へは今までどおり書かれます）`}`,
  submitWithoutPrevent: (h) =>
    `onsubmit に #prevent が無く、"${h}" も preventDefault を呼びません。ブラウザはフォームも送るので、ページが読み直されるか、router があれば GET が欄の値（パスワードも）を URL と履歴に載せます。onsubmit#prevent: ${h} と書くか、ハンドラで event.preventDefault() を呼んでください`,
  guardReadsAtModuleTop: (r) =>
    `ガードのモジュールが、export する関数の外（トップレベル）で ${r} を読んでいます。モジュールはページの読み込みで 1 回だけ評価されるので、ガードはそのとき読んだ値を持ち続け、遷移のたびにその値で決めます（ログインした後もセッションが無いまま）。遷移のたびに走る、export した関数の中で読んでください`,
  stateReadsAtModuleTop: (r) =>
    `state のモジュールがトップレベルで ${r} を読んでいます。モジュールは <wcs-state> ごとに 1 回だけ評価されるので、state はページの読み込みの時点の値を持ち続けます（後で変わるトークンやセッションは見えません）。値を state に置く（<wcs-storage> に束ねる）か、使うメソッドの中で読んでください`,
  eventTokenUnbound: (t, handler) =>
    `イベントトークン "${t}" を $eventTokens に宣言していますが、このドキュメントにそれを出す eventToken.<メンバー>: ${t} の束縛がありません。どの要素も発火させないので、${handler ? '$on のハンドラは一度も走りません' : 'このトークンは一度も発火しません'}。発火させる要素に束ねる（eventToken.<メンバー>: ${t} — <メンバー> はその要素の wcBindable のプロパティ）か、$eventTokens から外してください`,
  objectKeyAssign: (t, acc, sp) =>
    `"${t}" のキーにその場で代入しています。state はこの書き込みを見ないので、それを読む束縛・getter・$watch は変わらず、何も描き直されません。新しいオブジェクトを代入する（${acc} = { ...${acc}, [key]: value }）か、ドットパスで書いてください（this["${sp}"] = …）`,
  getterUntrackedRead: (root, sp) =>
    `ここで追跡されるのは "${root}" だけです。"${sp}" が変わってもこの getter は再評価されません（パス読み取りの先の素のプロパティアクセスは追跡されない）。this["${sp}"] で読んでください`,
  getterUntrackedReadBound: (root, sp, binding, tag, written) =>
    `ここで追跡されるのは "${root}" だけですが、<${tag}> の束縛 "${binding}" は "${written}" をパスで書きます。その書き込みはこの getter に届かず、getter は前に計算した値を返し続けます（パス読み取りの先の素のプロパティアクセスは追跡されない）。this["${sp}"] で読んでください`,
  handlerFilterNotAllowed: (prop) => `イベントハンドラ "${prop}" にフィルタは使用できません`,
  typeExpectation: (label, expected, resultType) =>
    `"${label}" には${JA_EXPECTED_LABEL[expected]}が必要です（現在の型: ${resultType}）`,
  attrBooleanPresence: (a, p, rhs) =>
    `"attr.${a}" に boolean を束ねています。attr.* は String(value) を書くので、false のとき ${a}="false" になります。論理属性は値に関係なく、在るだけで効きます: ${a}="false" でも ${a} のままです（属性を外すのは null / undefined だけ）。プロパティを束ねてください: ${p}: ${rhs}`,
  attrBooleanText: (a, rhs) =>
    `"attr.${a}" に boolean を束ねています。attr.* は String(value) を書くので、属性は "true" か "false" になり、外れることはありません（外すのは null / undefined だけ）。属性の有無を見る側（CSS の [${a}]・hasAttribute()）には、どちらでも在ります。false の間は外すなら attr.${a}: ${rhs}|defaults(null)、文字の "true" / "false" が意図なら attr.${a}: ${rhs}|string と書いてください`,
  radioBeforeValue: (binding, value, checkbox, fix) =>
    `「${binding}:」が、この${checkbox ? 'チェックボックス' : 'ラジオ'}に値を与える「${value}:」より前に書かれています。束縛は書いた順に当たるので、値がまだブラウザの既定の "on" のうちに比べられ、最初の描画では何もチェックされません（何も知らせません。後から state に書くと正しいものがチェックされます）。値を先に書いてください: ${fix}`,
  bindingExpression: (expression, fix) =>
    `束縛の右辺はパスとフィルタで、式ではありません: "${expression}" は評価されず、その名前のパスとして引かれます。${fix !== null ? `${fix} と書いてください` : 'その値を計算する getter を state に書き、getter の名前を束ねてください'}`,
  handlerExpression: (property, expression, method) =>
    `イベントの束縛の右辺はメソッドの名前で、呼び出しや関数ではありません: "${expression}" は評価されません。${method !== null ? `"${property}: ${method}" と書いてください` : 'メソッドの名前を書いてください'}。ハンドラは (event, ...ループの添字) で呼ばれるので、行の値はメソッドの中で添字から読んでください`,
  attributeMustache: (name) =>
    `{{ }} はテキストの中でしか読まれません。属性 "${name}" の中では書いたまま残ります。属性を束ねてください（attr.${name}: <パス>。文字列を組み立てる getter を書いて）。ページを返す前にサーバーのテンプレートが埋めるのなら、このままで正しい書き方です`,
  structuralElement: (directive, tagName) =>
    `"${directive}:" は <template> の上でだけ働きます。<${tagName}> の上ではランタイムは "${directive}" という名前のプロパティを書くだけで、${directive === 'for' ? '要素は行ごとではなく 1 つだけ描かれます' : '要素は常に表示されます'}。要素を <template data-wcs="${directive === 'else' ? 'else:' : `${directive}: …`}"> の中に入れてください`,
  collectionMutation: (key, method, kind) =>
    `"this.${key}.${method}(…)" は state の ${kind} をその場で変えます。state はそれを見ないので、"${key}" に束ねたものも、それを読む getter も更新されません（何も知らせません）。新しい ${kind} を代入する（${collectionFix(key, method, kind)}）か、配列 / オブジェクトで持ってください`,
  rowIdShared: (id) =>
    `for: のすべての行が id="${id}" になります。id は 1 つの要素のもので、それを名指す <label for> や aria-labelledby は最初の行にしか届きません。id を束ねてください（attr.id: .domId — 行のキーから組み立てる行の getter を書いて）`,
  eventNameCase: (property, lower) =>
    `"${property}:" は "${property.slice(2)}" という名前のイベントを聞きますが、それを送るものはありません — DOM のイベント名は小文字です。DOM のイベントなら "${lower}:" と書いてください。部品のコールバック（"prop"）は部品が送るイベントで、eventToken.<メンバー>: で束ねます`,
  inlineImport: (specifier, guard) =>
    `インラインの ${guard ? '<wcs-guard-handler>' : '<wcs-state>'} のスクリプトは blob: URL から評価されるので、"${specifier}" は解決しません（${guard ? 'ガードは' : 'state は'}読み込みに失敗します）。${guard ? '完全な URL か、ページの import map が与える名前を import してください' : '完全な URL か、ページの import map が与える名前を import するか、state をファイルに移してください（src="./state.js"）'}`,
  keyBinding: () =>
    `"key:" は "key" という名前のプロパティを書くだけで、ほかに何もしません。key は要りません — 行は行のオブジェクトで突き合わされ、取り直したデータで行を保つのは $listKeys です`,
  radioNameShared: (name, binding) =>
    `行ごとのラジオがすべて name="${name}" になるので、ブラウザは全部の行のラジオを 1 つのグループにします。ページ全体で 1 つしか選ばれた状態にならず、表示は最初の描画から行ごとの値と食い違います（何も知らせません）。${binding === 'radio'
      ? '行ごとに違う name を束ねる（attr.name: .<行ごとに違うフィールド>）か、name を外してください（radio: は name が無くても、同じパスに束ねたラジオを選択に合わせます）'
      : '行ごとに違う name を束ねてください（attr.name: .<行ごとに違うフィールド>）。行をまたいで 1 つを選ばせるなら、全部を 1 つのパスに束ねます（value: .<行の id>; radio: <パス>）'}`,
  numberWrittenAsString: (path, left, asNumber) =>
    `"${path}" は state では数値ですが、value: が書き戻すのは要素の持つ文字列です。5 と入力した後の state は "5" で、"5" + 1 は "51" になります（何も知らせません）。書き戻すときに数値にしてください: ${asNumber ? `valueAsNumber: ${path}、または` : ''}左辺の入力フィルタ ${left}|number: ${path}（|int・|float も）`,
  twoWayOutputFilter: (prop, filters, left, rhs, keystroke) => keystroke
    ? `${prop}: は双方向で 1 打鍵ごとに書き戻し、出力フィルタ "${filters}" はそのたびに state の値を整形して欄へ書き直します。入力中の欄が書き換わり（キャレットは末尾へ飛び、IME の変換は途切れます）、state が受け取るのも欄の整形済みの文字です（出力フィルタは書き戻しで元に戻りません）。整形した文字は別の要素に表示する、欄の確定で書き戻して setter で整形する（${prop}#onchange:）、または一方向にしてください（${prop}#ro: ${rhs}）`
    : `${prop}: は双方向ですが、出力フィルタ "${filters}" は書き戻しで元に戻りません。要素が書き戻すのは表示している整形済みの値で、次はその値にフィルタが掛かります。左辺の入力フィルタで元に戻す（${left}|<フィルタ>: …）、整形した値は別の要素に表示する、または一方向にしてください（${prop}#ro: ${rhs}）`,
  bodyBinding: (tag, attribute) =>
    `<${tag}> の ${attribute} は束縛されません。<wcs-state> が束ねるのは <body> の中で、<body> と <html> そのものは束ねないので、ここに書いた束縛は何もしません（イベントのハンドラは走らず、class. / attr. などは書かれません）。束縛を <body> の中の要素（包む要素・<main>）へ移すか、値を $connectedCallback や $watch のハンドラから書いてください（document.documentElement.lang = …）`,
  linkHandler: (property, handler) =>
    `<wcs-link> の "${property}:" は "${handler}" を呼びません。<wcs-link> 自身は display: none で、利用者がクリックするのはリンクが自分の隣に作る <a> なので、イベントはホストに届きません。ハンドラは、リンクの中の要素（子は <a> の中へ移ります）か、リンクを囲む要素に書いてください。ハンドラから遷移するなら、router の navigateUrl に書きます（<wcs-router> の data-wcs="navigateUrl: …"）`,
  rootMarginUnit: (tag, value, refused, suggested) => {
    const why = refused.length === 0
      ? '値は 1〜4 個です'
      : `${refused.map((t) => `"${t}"`).join('・')} は px か % の付いた数値ではありません${refused.some(isUnitlessZero) ? '（0 にも単位が要ります）' : ''}`;
    const effect = tag === 'wcs-intersect' ? '要素は何も監視せず、observing は false のままです' : '要素は何も監視せず、次のページは読み込まれません';
    return `ブラウザは root-margin="${value}" を拒みます（rootMargin must be specified in pixels or percent）: ${why}。そのため${effect}。${suggested === null ? '1〜4 個の値を、それぞれ px か % の付いた数値で書いてください' : `root-margin="${suggested}" と書いてください`}`;
  },
  frequencyInvalid: (tag, value, suggested) =>
    `frequency="${value}" は正の数値ではないので、<${tag}> はこれを「指定なし」として読み、センサーはブラウザの既定の頻度で動きます（何も知らせません）。${suggested === null ? '正の数値（Hz）を書くか、既定の頻度でよければ属性を外してください' : `数値だけを書いてください: frequency="${suggested}"`}`,
  targetSelector: (tag, value) =>
    `<${tag}> の target は CSS セレクタです。target="${value}" は <${value}> 要素を選びますが、この文書にその要素は無く、id="${value}" の要素があります。対象が見つからないので、${TARGET_EFFECT_JA[tag] ?? '要素は何もしません'}。id を指すなら target="#${value}" と書いてください`,
  commandEventArgument: (property, token, tag, method, more) =>
    `"${property}: ${token}" はトークンをイベントから直接 emit するので、受け側のコマンドはイベントを第 1 引数として呼ばれます。<${tag}> の ${method}() は引数を取るコマンドで、${method}(event) になります${more > 0 ? `（ほかに ${more} 件の受け側も同じです）` : ''}。state のメソッドから emit してください — ${property}: <メソッド> と書き、<メソッド>() { this.${token}.emit(…) } で ${method}() が受け取る値を渡します（渡す値が無ければ引数なしで emit します）`,
  outputPathWritten: (path, tag, member, commands) =>
    `"${path}" は <${tag}> の出力 "${member}" に束ねてあります。出力は要素が書くもので、スクリプトの書き込みは要素に届きません。true を代入しても要素は何もせず、ページだけがそうなったことにします。${commands.length === 0
      ? `<${tag}> にコマンドは無く、この値は要素が知らせるものです。代入を外してください`
      : `要素にはコマンドで頼んでください（${commands.join('・')} — command.<メソッド>: $command.<名前> を束ね、ここで this.$command.<名前>.emit() を呼ぶ）。"${path}" は要素が書きます`}`,
  filterUnknown: (n) => `フィルタ "${n}" は組み込みフィルタに存在しません`,
  filterRemoved: (n, c) => `フィルタ "${n}" は 4.0 で外れました（"${c}" の 3.x の旧名）。"${c}" と書いてください`,
  substrRemoved: (rewrite) =>
    `フィルタ "substr" は 4.0 で外れました。slice(start, start + length) と書いてください — slice の第 2 引数は長さではなく終わりの位置です${rewrite === null ? '' : `（ここでは ${rewrite}）`}`,
  filterMinArgs: (n, min, c) => `フィルタ "${n}" には最低 ${min} 個の引数が必要です（${c} 個指定）`,
  filterMaxArgs: (n, max, c) => `フィルタ "${n}" の引数は最大 ${max} 個です（${c} 個指定）`,
  filterArgType: (n, i, exp, arg, act) => `フィルタ "${n}" の第${i}引数は ${exp} 型が必要です（"${arg}" は ${act} 型）`,
  filterInputType: (n, accepts, cur) => `フィルタ "${n}" は ${accepts} 型の入力が必要です（現在の型: ${cur}）`,
  filterArgEnum: (n, arg, members, suggestion) =>
    `"${n}(${arg})" の ${arg} は、比べる値が取りうる値（${members.join(' | ')}）にありません — ${n === 'ne' ? 'いつも真' : '決して真になりません'}${suggestion}`,
  moustacheFouc: (e) =>
    `<template> 外の {{ }} 構文は FOUC（初期表示時にテンプレート文字列が見える）の原因になります。<!--@@:${e}--> またはコメント構文の使用を検討してください。`,
  moustacheFoucTextParent: (e, tag) =>
    `<template> 外の {{ }} 構文は FOUC（初期表示時にテンプレート文字列が見える）の原因になります。<${tag}> の中のコメント構文は束縛になりません — 要素に束ねてください（<${tag} data-wcs="${tag === 'textarea' ? 'value' : 'textContent'}: ${e}">）。`,
  textBindingInHead: (w) =>
    `${w} は文書の <head> の中にありますが、<wcs-state> が束ねるのは <body> とシャドウルートだけなので、書いたままの文字が出ます。タイトルは state のスクリプトから document.title に書く（$connectedCallback と $watch のハンドラ）か、ルートの <wcs-head> の <title> に置いてください`,
  nestedAssign: (sp) => `ネストされたプロパティへの代入はリアクティブ更新をトリガーしません。this["${sp}"] を使用してください。`,
  watchNotObject: () => `$watch は「パス → ハンドラ関数」のオブジェクトである必要があります（この形はランタイムが読み込み時に throw します）`,
  watchKeyCrossState: (k) => `$watch のキー "${k}" は他の state を指しています。@ 付きの越境 watch は使えません（自 state のパスのみ）`,
  watchKeyReserved: (k) => `$watch のキー "${k}" は "$" で始められません（予約名前空間）`,
  watchKeyEmptySegment: (k) => `$watch のキー "${k}" に空のパスセグメントがあります`,
  watchHandlerNotFunction: (k) => `$watch のエントリ "${k}" の値は関数である必要があります`,
  watchPathMissing: (k) => `$watch のキー "${k}" は状態定義に存在しません（一度も発火しません）`,
  scanRemoved: (mountPath) =>
    mountPath === null
      ? `$scan は 4.0 で外れました（diagnostics の後付けを入れた入口 — /auto など — は読み込み時に throw し、/core だけでは黙って無視します）。パスの変化を畳むなら $watch、イベントを畳むなら $on のハンドラで、出力のプロパティへ書いてください`
      : `$scan は 4.0 で外れました。ボリューム（mount="${mountPath}"）では、ランタイムは接ぎ木を拒んで console.error で報告します（この state は木に載りません）。root の state の $watch か $on のハンドラで畳んでください`,
  typeAnnotationIncompatible: (vt, rt) => `型 "${vt}" は @type {${rt}} と互換性がありません`,
  arrayMutation: (m, alt) =>
    `配列の破壊的メソッド "${m}" はリアクティブ更新をトリガーしません（同一参照の自己再代入でも要素の追加・削除は反映されません）。非破壊メソッドと再代入を使用してください（例: ${alt}）。`,
  arrayIndexAssign: (sp) =>
    `配列インデックスへの直接代入はリアクティブ更新をトリガーしません。this["${sp}"] のようなドットパス代入、または with() と再代入を使用してください。`,
  inPlaceAlias: (a, src, t) =>
    `"${a}" は ${src}（state の値そのもの）です。それを通した変更はリアクティブ更新をトリガーせず、同じ値を書き戻しても一覧の行は追加・削除・置き換えされません。新しい値を作って ${t} に代入してください（${a}.with(i, item) / [...${a}, item] / { ...${a}, key: value }）`,
  inPlaceChange: (src, t) =>
    `${src} は state の値をその場で変えるので、リアクティブ更新をトリガーしません。新しい値を作って ${t} に代入してください`,
  tagMemberUnknown: (prop, tag) =>
    `"${prop}" は <${tag}> の wcBindable メンバーではありません（ランタイムは宣言に無いメンバーへの束縛を #38 で拒み、root では state が初期化に失敗します）`,
  nameAlias: (written, canonical) =>
    `"${written}" は 4.0 で外れました（"${canonical}" の 3.x の旧名で、ランタイムは読んだ時点で throw します）。"${canonical}" と書いてください`,
  declarationAliasRead: (alias, canonical) =>
    `"${alias}" は 4.0 で外れた宣言キー（"${canonical}" の 3.x の旧名）なので、this["${alias}"] は undefined になります。宣言は this を通して読めません — "${canonical}" を読んでも undefined です${canonical === '$stream' ? '（ストリームの状態は $streamStatus・$streamError で読みます）' : ''}`,
  declarationAlias: (alias, canonical) =>
    `宣言キー "${alias}" は 4.0 で外れました（"${canonical}" の 3.x の旧名で、ランタイムは読み込み時に throw します）。"${canonical}" と書いてください`,
  declarationAliasInVolume: (alias, canonical, mountPath) =>
    `宣言キー "${alias}" は 4.0 で外れました（"${canonical}" の 3.x の旧名）。ボリューム（mount="${mountPath}"）では、ランタイムは接ぎ木を拒んで console.error で報告します（この state は木に載りません）。"${canonical}" もボリュームでは宣言できないので、root の state に宣言してください`,
  behaviorNotObject: (keys) =>
    `$behavior は { ${keys.map((k) => `${k}?`).join(', ')} } のオブジェクトである必要があります（ランタイムは読み込み時に throw します）`,
  behaviorKeyUnknown: (key, keys, suggestion) =>
    `"${key}" は $behavior のキーではありません（${keys.join('・')} の ${keys.length} つだけ。ランタイムは読み込み時に throw します）${suggestion}`,
  behaviorValueType: (key, type) =>
    `$behavior の "${key}" は ${type === 'boolean' ? 'true か false' : type} である必要があります（ランタイムは読み込み時に throw します）`,
  configInVolume: (key, mountPath) =>
    `${key} はボリューム（mount="${mountPath}"）では宣言できません（ランタイムは接ぎ木を拒み、console.error で報告します — この state は木に載りません）。root の state に宣言してください — ボリュームは root のエンジンに接ぎ木されます`,
  featuresNotArray: () =>
    `$features は後付けの名前の配列である必要があります（例: ["temporal", "formats"]。ランタイムは読み込み時に throw します）`,
  featureUnknown: (name, names, suggestion) =>
    `"${name}" は後付けの名前ではありません（${names.join('・')}）${suggestion}`,
  volumeDeclarationRejected: (key, mountPath) =>
    `${key} はボリューム（mount="${mountPath}"）では実行されません。ランタイムは接ぎ木を拒んで console.error で報告します（この state は木に載りません）。root の state に宣言してください`,
  volumeDeclarationNotRun: (key, mountPath) =>
    `${key} はボリューム（mount="${mountPath}"）では実行されません（ランタイムは console.warn で知らせ、この宣言を無視します — root の state のものです）。root の state に宣言してください`,
  partPathMissing: (path, tag, key, prop, object) =>
    `<${tag}> のテンプレートのパス "${path}" は解決しません: "${key}" は部品の state のキーではなく、渡されてもおらず（${prop}.${key}: …）、${object === null
      ? `部品はどのオブジェクトにもマウントされていません（${prop}: …）`
      : `マウント先のオブジェクト（"${object}"）にもありません`}。部品の中の読みはマウント先へ落ちて何も失敗しないので、表示は空になります（実行時も [wcs/binding-path-missing] で知らせます）`,
  partPathOfPage: (key, prop) =>
    `。"${key}" はページの state のパスです: 部品からは読めないので、渡してください（${prop}.${key}: ${key}）`,
  dccBindComponent: (tag) =>
    `<${tag} data-wc-definition> の中の <wcs-state> に bind-component があります。DCC の state は定義のテンプレートのもので、インスタンスごとに読み込まれます。ランタイムはこの定義を拒み（a <wcs-state bind-component> cannot define a component）、<${tag}> はどのページでも定義されません。bind-component を外すか、クラスの部品として書いてください`,
  dccSecondState: (tag) =>
    `<${tag} data-wc-definition> に 2 つ目の <wcs-state> があります。定義の state は 1 つです: それぞれがタグを定義しようとし、ランタイムは 2 つ目を拒みます（<${tag}> is already defined）。インスタンスでも 2 つ目の root として拒まれます。1 つにまとめてください`,
  dccListNotArray: (key) =>
    `${key} は state のメンバー名のリストです（${key}: ["name", …]）。リストでないと、ランタイムはこの定義を拒み、タグはどのページでも定義されません`,
  dccEntryEmpty: (key) =>
    `${key} の項目は空でない文字列です。空の項目があると、ランタイムはこの定義を拒み、タグはどのページでも定義されません`,
  dccEntryInternal: (key, name) =>
    `${key} の "${name}" は $ で始まります。$ で始まるメンバーは内部のもので、公開できません。ランタイムはこの定義を拒み、タグはどのページでも定義されません`,
  dccEntryDuplicated: (key, name) =>
    `${key} に "${name}" が 2 回あります。ランタイムはこの定義を拒み、タグはどのページでも定義されません`,
  dccEntryMissing: (key, name) =>
    `${key} の "${name}" は、この定義の state にありません。ランタイムはこの定義を拒み、タグはどのページでも定義されません`,
  dccBindableIsMethod: (name) =>
    `$bindables の "${name}" はメソッドです。メソッドは $commands に書きます。ランタイムはこの定義を拒み、タグはどのページでも定義されません`,
  dccCommandIsValue: (name) =>
    `$commands の "${name}" はメソッドではありません。値は $bindables に書きます。ランタイムはこの定義を拒み、タグはどのページでも定義されません`,
  dccAttribute: (tag, name) =>
    `<${tag}> の入力 "${name}" を属性で書いています。DCC の入力は $bindables に並べたプロパティで、属性は読まれません: 部品は既定のままです。束ねる（data-wcs="${name}: <パス>"）か、プロパティに書いてください`,
  secondRoot: () =>
    '同じ root に 2 つ目の <wcs-state> があります。state の木は root ごとに 1 つです（ランタイムは後から読み込んだ方を拒んで console.error で報告します）。部分木は <wcs-state mount="path"> で接ぎ木してください',
  bindComponentSource: (prop, sources) =>
    `bind-component の state はホスト要素のプロパティ（<ホスト>.${prop || '…'}）だけから来ます。${sources.join('・')} と併記すると、ランタイムは読み込みを拒んで console.error で報告します（コンポーネントはマウントされません）。state はコンポーネントのプロパティに書いてください`,
  indexParamRange: (key, max) =>
    `"${key}" はループの添字ではありません — 添字は $1 から $${max} までです（ランタイムは読んだ時点で wcs/index-param-range を投げます）`,
  indexParamNotPath: (key, max) =>
    `"${key}" はループの添字ではなく（添字は $1 から $${max} まで）、"$" の名前空間に状態のパスもありません — ランタイムはこのバインディングを wcs/binding-path-missing で失敗させます`,
  featuresAttrNotRoot: () =>
    `features 属性を読むのは文書の root の <wcs-state>（mount と bind-component を持たない最初のもの）だけです。この要素の features は無視されます — root の <wcs-state> に書いてください`,
  onPrefixedMember: (member, tag, modifiers) =>
    `"${member}" は <${tag}> のメンバーですが、"on" で始まる名前はイベント束縛になり（"${member.slice(2)}" イベントを待つ）、値は届きません。プロパティとして束縛するには ".${member}${modifiers ? `#${modifiers}` : ''}:" と書いてください（@wcstack/state 3.1）`,
  tagCommandUnknown: (name, tag, declared) =>
    `"${name}" は <${tag}> の command ではありません（宣言済み: ${declared}）`,
  nativeCommandUnknown: (method, tag, allowed) =>
    `"${method}" はネイティブの <${tag}> に command で呼べるメソッドではありません（呼べるのは ${allowed}。ランタイムは初期化で wcs/token-misconfigured を投げます）`,
  spreadNoBindable: (tag) =>
    `'...'（spread）は <${tag}> に有効な wcBindable 宣言が必要です — このタグは宣言を持たないため、ランタイムはエラーを送出します`,
  tagEventTokenKeyUnknown: (name, tag, declared) =>
    `eventToken のキー "${name}" は <${tag}> の wcBindable プロパティではありません。生 DOM イベント名は発火しません — プロパティ名を指定してください（宣言済み: ${declared}）`,
  handleBoundAsValue: (name, tag) =>
    `<${tag}> の "${name}" は生きたリソース（ハンドル）で、値ではありません。state のパスに束ねると、スナップショットや SSR に載らないオブジェクトが state に入ります — eventToken.${name}: で受け、コマンドの引数として次の要素へ直接渡してください`,
  ariaAttrUnknown: (name) =>
    `"${name}" は WAI-ARIA の属性ではありません。setAttribute はそのまま書き込みますが、支援技術には黙って無視されます`,
  liveRegionInserted: (attribute, by, condition) =>
    `このライブリージョン（${attribute}）は、${by === 'route' ? '<wcs-route> に入ったとき' : by === 'for' ? 'for: の行が足されたとき' : '枝が現れたとき'}に文ごと挿入されます（${condition === null ? '文を書いて持っています' : `文は条件 "${condition}" が読むものに束ねてあり、枝はその文と一緒に現れます`}）。スクリーンリーダーが読み上げるのはページにあるリージョンの文が変わったときなので、この文は読み上げられません（挿入したときに読み上げられるのは role="alert" だけです）— 聞かせたい知らせは、常にページにあるリージョンに置いてください: リージョンは${by === 'route' ? 'ルート' : ' template '}の外に置き、textContent: を知らせる文に束ね、知らせることが無いときは空にする`,
  didYouMean: (c) => `。もしかして: "${c}"`,
  none: () => `なし`,
  triggerSeededTruthy: (path) =>
    `trigger バインド先 "${path}" が true でシードされています。trigger はエッジ検出なし（truthy 書き込みで即発火・manual もバイパス）のため、バインド時に即発火します。false でシードしてください`,
  storageSeedClobber: (path, raw) =>
    `<wcs-storage> の value バインド先 "${path}" が ${shortSeed(raw)} でシードされています。読み込みのたびに初期書き戻しが保存値を上書きします — バインドに #init=element を付けて（\`value#init=element: ${path}\`）保存値を勝たせ、スロットは null（空のキーが読む値）でシードしてください`,
  storageInitSeed: (path, raw) =>
    `<wcs-storage> の value バインド先 "${path}" が ${shortSeed(raw)} でシードされていますが、#init=element は要素の値をこのスロットへ引き込みます。初回（空のキー）は null なので、シードは null に置き換わります — null でシードして読む側で既定値を補う（\`this.${path} ?? …\`）か、null を無視する setter を持つアクセサペアを束ねてください`,
  storagePairClobber: (path) =>
    `<wcs-storage> の value を #init=element なしでアクセサペア "${path}" に束ねています。state の側が先に書くので、読み込みのたびに getter の最初の値が保存値の上に保存され、setter は保存値を受け取れません — #init=element を付けてください（\`value#init=element: ${path}\`）`,
  inputNestedWrite: (tag, input, path, example) =>
    `<${tag}> の入力 "${input}" に "${path}" を束ねていますが、ページはその下（"${example}"）へ書き込んでいます。束縛は "${path}" 自身への代入でしか当て直されないので、下への書き込みは <${tag}> に届きません — フィールドをパスで読んで新しい値を返す getter（\`this["${example}"]\`・\`$getAll\`）を束ねてください: 要素の値も受け取るなら、setter を添えたアクセサペアを ${input}#init=element: <getter> で。要素の値を受け取らないなら、一方向に ${input}#ro: <getter> で（setter も #ro も無いと、要素が知らせる値の書き戻しが getter に拒まれます — wcs/path-readonly）。または、下へ書かずに "${path}" を差し替えてください`,
  inputNestedWriteOneShot: (tag, input, path, example) =>
    `<${tag}> の入力 "${input}" に "${path}" を束ねていますが、ページはその下（"${example}"）へ書き込んでいます。束縛は "${path}" 自身への代入でしか当て直されず、<${tag}> は要求のたびに "${input}" を null に戻すので、次の要求は "${input}" なしで送られます — 要求を始めるハンドラで新しいオブジェクトを作って代入し（\`this.submitBody = { … }\`）、それを束ねてください`,
  devtoolsAfterState: () =>
    `@wcstack/devtools/auto は @wcstack/state/auto より先に読み込んでください（後からだと、DevTools のタイムラインは付いた時点から始まります。既にある配線は 4.0 が送り直します）`,
  baseHrefMissing: () =>
    `@wcstack/router を使う SPA には <head> 内の <base href="/">（またはそれを作る <head> の同期スクリプト — basename にロケールを置く形）が必要です（無いとディープリンクで basename が誤導出されます）`,
  routerOutletMisplaced: () =>
    `この <wcs-outlet> は <wcs-router> の直後に無いので、どの router も使いません。router は自分の直後の要素だけを outlet として使い、そこに <wcs-outlet> が無ければ自前の outlet を作ります。ルートは router の直後に描かれ、この outlet は空のままです — <wcs-router> の直後へ移してください`,
  linkQueryKeyIgnored: (toKeys, named) =>
    `この <wcs-link> の to が付けるキー（${toKeys}）は、どれも query-keys（${named}）にありません。query-keys のあるリンクは名指したキーだけを比べるので、リンク自身のクエリは判定に効かず、${named} が合えば ${toKeys} が何でも現在のリンクになります — こう書いたタブは同時にすべて現在になります。リンクが表すキーを名指してください（query-keys="${toKeys}"）`,
  signalsDualEntry: () =>
    `@wcstack/signals と @wcstack/signals/dom が同一ページから import されています。CDN では各エントリが自己完結バンドルのためリアクティブコアが二重化し、境界で反応が壊れます — すべて /dom エントリから import してください`,
  signalsImportMapBoth: () =>
    `この import map は @wcstack/signals と @wcstack/signals/dom の両方を割り当てています。CDN では各エントリがリアクティブコアを持つので、@wcstack/signals を import するモジュール（このページのものでも、読み込む .js でも）が 2 つ目のコアを持ち、境界で反応が壊れます。@wcstack/signals/dom だけを割り当ててください（コアの全部を export します）`,
  tagPackageMissing: (tags, pkg, url) =>
    `${tags.map((t) => `<${t}>`).join('・')} は ${pkg} のタグですが、このページは ${pkg} のスクリプトを読み込んでいません。要素は定義されないので、その束縛は待ち続けて何も起きず、コンソールにも何も出ません — <script type="module" src="${url}"></script> で読み込んでください`,
  linkRouterMissing: (to, n) =>
    `このページには <wcs-router> が無いので、この <wcs-link to="${to}">${n > 1 ? `（とページのほかの ${n - 1} 個）` : ''}は接続した時点で "[@wcstack/router] wcs-link is not connected to a router." を投げ、リンクは隠れます（display: none）。router の無いページでは <a href="${to}"> と書くか、<wcs-router> を置いてください`,
  lintVersionBehind: (spec, version, minor, lint) =>
    `このページは ${spec} を固定していますが、この lint の規則（@wcstack ${lint}）より新しい minor です。${minor} で加わった規則は検査されず、${minor} の正しい書き方が error になることもあります — @wcstack/lint を ${version} に上げてください（npm i -D @wcstack/lint@${version}。VS Code の拡張は ${minor} に対応する版へ）`,
  routeBareMustache: (inLayout) => inLayout
    ? `レイアウトのテンプレートの直下のテキストの {{ }} は、遷移では束ねられません — 要素で包んでください（<span>{{ … }}</span>）`
    : `<wcs-route> の直下のテキストの {{ }} は、最初に着いたルートでしか束ねられません。遷移で入ったルートでは書いたままの文字が出ます — 要素で包んでください（<h1>{{ … }}</h1>）`,
  layoutSlotMissing: (l) =>
    `レイアウト "${l}" のテンプレートに既定の <slot>（name の無いもの）がありません。この <wcs-layout> の名前付きスロットの外の中身（入れ子のルートとそのページ）は表示されません — ページを置く場所に <slot></slot> を書いてください`,
  namedStateAttrDeprecated: (name) =>
    `name 属性は v2 で撤去されました（1 root 1 ツリー）。ルートツリーへのマウント <wcs-state mount="${name}"> に置き換え、パスは "${name}.<path>" で参照してください（docs/state-mount-design.md §9）`,
  namedStatePathDeprecated: (name) =>
    name === 'default'
      ? `"@default" セレクタは v2 で撤去されました。"@default" を外してください（docs/state-mount-design.md §9）`
      : `"@name" セレクタは v2 で撤去されました（1 root 1 ツリー）。マウントしたツリーを "${name}.<path>" で参照してください（docs/state-mount-design.md §9）`,
  mountPathInvalid: (problem, mountPath) => {
    switch (problem) {
      case 'empty': return `"mount" には空でない静的なパスが必要です（ランタイムはボリュームを拒みます: has an invalid mount path）`;
      case 'emptySegment': return `"mount" パス "${mountPath}" に空の段があります（ランタイムはボリュームを拒みます: has an invalid mount path）`;
      case 'wildcard': return `"mount" パス "${mountPath}" は静的でなければなりません — "*" は使えません（ランタイムはボリュームを拒みます: has an invalid mount path）`;
      case 'whitespace': return `"mount" パス "${mountPath}" に空白は使えません（ランタイムはボリュームを拒みます: has an invalid mount path）`;
      default: return `"mount" パス "${mountPath}" に予約文字（$, #, @）は使えません（ランタイムはボリュームを拒みます: has an invalid mount path）`;
    }
  },
  recursionUnsupported: (p, where) => {
    switch (where) {
      case 'binding':
        return `"${p}" の "**" は data-wcs では使えません。"**" は $recursion 宣言・再帰 getter のキー・$getAll / $setAll のパス引数だけの記号です（ランタイムはバインド確立時に throw します）。HTML では展開後の具体パスを書いてください`;
      case 'watch':
        return `$watch のキー "${p}" に "**" は使えません。監視は具体パス（固定本数の "*"）に対してのみ成立します`;
      case 'resolve':
        return `$resolve("${p}") に "**" は渡せません。$resolve は展開後の具体パスと添字タプルの厳密一致だけを受け付けます`;
      case 'update':
        return `$update("${p}") に "**" は渡せません。$update は 1 つのアドレス（展開後の具体パスと添字タプルの厳密一致）だけを書き換えます — 全深さへは $setAll("${p}", [], value) で書いてください`;
      case 'assignment':
        return `this["${p}"] への代入に "**" は使えません（再帰 setter は初版では持てず、代入は展開後の具体パスにしか成立しません）。$setAll("${p}", [], value) で全深さへブロードキャストするか、具体パスへ書いてください`;
      case 'postUpdate':
        return `$postUpdate("${p}") に "**" は渡せません。通知は展開後の具体パス（固定本数の "*"）に対してのみ成立します`;
      case 'dependOn':
        return `$dependOn("${p}") に "**" は渡せません。依存の登録は展開後の具体パス（固定本数の "*"）に対してのみ成立します`;
      case 'trackDependency':
        return `$trackDependency("${p}") に "**" は渡せません。依存の登録は展開後の具体パス（固定本数の "*"）に対してのみ成立します`;
      case 'listKeys':
        return `$listKeys のキー "${p}" に "**" は使えません。キー付きリストは 1 本の具体リストパスです — 深さごとに宣言してください（例: "nodes.*.children"）`;
      default:
        return `"${p}" は "**" を含みますが、この state には $recursion 宣言がありません。$recursion = { "<anchor>": "<repeat>" }（例: { "nodes.*": "children.*" }）を宣言してください（宣言が無いと、ランタイムは読み込み時に #1101 で throw し、state は初期化に失敗します）`;
    }
  },
  recursionAnchorMismatch: (p, anchor) =>
    `"${p}" は宣言済みの再帰アンカー "${anchor}" と合致しません（初版は state ごとに 1 つの自己再帰のみ。"**" の後ろは整形された接尾辞 — 2 つ目の "**"・空セグメント・"**" 直後の素の "*" は置けません）`,
  recursionGetAllForm: (p, problem) =>
    problem === 'notArray'
      ? `$getAll("${p}", indexes) の "**" の添字は、省略（評価中の再帰 getter の深さ）か [] （全深さ）のどちらかです。null や配列でない値は渡せません`
      : `$getAll("${p}", indexes) の "**" に非空の接頭辞は渡せません（接頭辞はどの深さに適用されるかを言えません）。添字を省略すると評価中の再帰 getter の深さ、[] を渡すと全深さになります`,
  recursionSetAllForm: (p, problem) => {
    switch (problem) {
      case 'prefix':
        return `$setAll("${p}", indexes, …) の "**" に非空の接頭辞は渡せません（接頭辞はどの深さに適用されるかを言えません）。[] を渡して全深さへブロードキャストしてください`;
      case 'noIndexes':
        return `$setAll("${p}", …) の "**" には明示的な空の添字配列 [] が必要です（書き込み API は文脈を取りません）`;
      case 'mapper':
        return `$setAll("${p}", …) の "**" は mapper を取れません（添字タプルの本数が深さごとに変わるため）。定数値を渡してください`;
      default:
        return `$setAll("${p}", …) の "**" は { spread: true } を取れません（平坦な配列を木に配るには作者が走査順を知る必要があり、契約になりません）`;
    }
  },
  recursionStructuralWrite: (p, target, repeatList) => {
    switch (target) {
      case 'node':
        return `$setAll("${p}") は再帰の構造そのもの（ノード）を書き換えます。初版は葉のプロパティへのブロードキャストのみです — ノードを置き換えるとこの書き込みのために確定済みの子アドレスが無効になります`;
      case 'branch':
        return `$setAll("${p}") は再帰の構造そのもの（"${repeatList}" リストへ至る途中のオブジェクト）を書き換えます。初版は葉のプロパティへのブロードキャストのみです — 置き換えるとその下の確定済みの子アドレスが無効になります`;
      case 'length':
        return `$setAll("${p}") は再帰の構造そのもの（"${repeatList}" リストの length）を書き換えます。length への代入は配列を切り詰めるので、リストの置換と同じくその下の確定済みの子アドレスが無効になります`;
      default:
        return `$setAll("${p}") は再帰の構造そのもの（"${repeatList}" リスト）を書き換えます。初版は葉のプロパティへのブロードキャストのみです`;
    }
  },
  recursionReadonly: (subject, getterPath) =>
    `${subject} は再帰 getter "${getterPath}" に書き込みます（setter は初版では持てません。この綴りはその getter のある深さの展開形か、導出値の内側です）。この getter が導出元にしている値の側を書いてください`,
  recursionInVolume: (subject, mountPath) =>
    `${subject} はボリューム（mount="${mountPath}"）では宣言できません（$recursion はランタイムが接ぎ木を拒み、console.error で報告します）。再帰の宣言と "**" getter はルートの state に置いてください — アンカーのパスはルートの木に対して解決されます`,
  recursionNotObject: () =>
    `$recursion は「アンカー → 反復サブパス」のオブジェクトである必要があります（例: { "nodes.*": "children.*" }。この形はランタイムが読み込み時に throw します）`,
  recursionAnchorCount: (count) =>
    count === 0
      ? `$recursion にはアンカーがちょうど 1 つ必要です（空の宣言です）`
      : `$recursion が ${count} 個のアンカーを宣言しています。初版は state ごとにちょうど 1 つの自己再帰のみ対応します`,
  recursionNodePathInvalid: (kind, path, problem) => {
    const subject = kind === 'anchor' ? '$recursion のアンカー' : '$recursion の反復サブパス';
    switch (problem) {
      case 'empty': return `${subject}は空でない文字列である必要があります`;
      case 'emptySegment': return `${subject} "${path}" に空のパスセグメントがあります`;
      case 'notElement': return `${subject} "${path}" はリストの要素を指す必要があります — 末尾が ".*" のプロパティパス（例: "nodes.*"）にしてください`;
      case 'reservedRoot': return `${subject} "${path}" は "$" で始められません（予約名前空間）`;
      case 'reservedMount': return `${subject} "${path}" に "#" は使えません（マウント用の予約セグメント）`;
      case 'midWildcard': return `${subject} "${path}" の "*" は末尾にちょうど 1 つだけ置けます（途中のワイルドカードは初版では未対応）`;
      case 'indexSegment': return `${subject} "${path}" に添字セグメントは含められません（再帰は木の形に対する宣言であって、1 行に対する宣言ではありません）`;
      default: return `${subject} "${path}" に "**" は含められません（"**" に意味を与えるのがこの宣言そのものです）`;
    }
  },
  recursionRepeatNotString: (anchor) =>
    `$recursion のエントリ "${anchor}" の値は反復サブパスの文字列である必要があります（例: "children.*"）`,
  recursionGetterInvalid: (key, problem, anchor) => {
    switch (problem) {
      case 'setter': return `再帰 setter は初版では未対応です: "${key}"。通常のパス setter を宣言するか、具体パス経由で書き込んでください`;
      case 'notGetter': return `"${key}" は "**" を含みますが getter ではありません。"**" は計算パスの族を名指す記号です`;
      case 'structural': return `"${key}" は再帰の構造そのもの（ノード・子リスト・その length・子リストへ至る途中のオブジェクト）を名指しています。再帰 getter は全深さで実データの子リストを影にしてしまいます。"**" はノードの下の計算パス（例: "${anchor}.total"）を名指す記号です`;
      default: return `"${key}" は再帰ノード自身を名指しています。"**" はノードの下の計算パス（例: "${anchor}.total"）を名指す記号で、ノードそのものではありません`;
    }
  },
  recursionGetterCollision: (a, b, repeat) =>
    `"${a}" と "${b}" は異なる深さで同じ具体パスへ展開します（差が "${repeat}" の整数回ぶんです）。どちらかの名前を変えてください`,
  recursionConcreteCollision: (concreteKey, recursiveKey) =>
    `"${concreteKey}" は state に定義済みなので、再帰 getter "${recursiveKey}" はそこへ展開できません（ランタイムは宣言を読んだ時点で throw します）。どちらかの名前を変えてください`,
};

const EN_EXPECTED_LABEL: Record<ExpectedTypeKind, string> = {
  array: 'an array-typed path',
  boolean: 'a boolean',
  string: 'a string',
};

const en: WcsMessageCatalog = {
  spreadFilterNotAllowed: () => `Filters cannot be applied to a spread target`,
  spreadTargetRequired: () => `Spread requires a target path`,
  structuralMustBeSingle: (d) => `'${d}' must be the only binding in this attribute (it cannot be combined with ';'; the runtime throws at load time)`,
  bindingSyntax: (detail) => `Binding syntax error (the runtime throws at load time): ${detail}`,
  eventTokenUndeclared: (t) => `Event token "${t}" is not declared in $eventTokens`,
  commandRhsFormat: () => `The right side of a command binding must be $command.<name> (declared in $commandTokens)`,
  commandTokenUndeclared: (t) => `Command token "${t}" is not declared in $commandTokens`,
  commandTokensAbsent: (t, name) =>
    `Command token "${t}" is not declared: this state has no $commandTokens. Add $commandTokens: ["${name}"] to the state`,
  eventTokensAbsent: (t) =>
    `Event token "${t}" is not declared: this state has no $eventTokens. Add $eventTokens: ["${t}"] to the state`,
  onEntryUndeclared: (t, absent) =>
    `The $on entry "${t}" is not declared in $eventTokens${absent ? ' (this state has none)' : ''}, so the state fails to load and the page is not initialized ($on entry "${t}" is not declared in $eventTokens). ${absent ? `Add $eventTokens: ["${t}"]` : `Add "${t}" to $eventTokens`}`,
  streamPathMissing: (p) => `Path "${p}" does not exist in the $stream declaration`,
  pathMissing: (p) => `Path "${p}" does not exist in the state definition`,
  pathNonexistent: (p) => `Path "${p}" does not exist in the declared stateSchema`,
  pathTypeMismatch: (p, label, expected, actual) =>
    `Path "${p}" is ${actual} in the stateSchema, but ${label} requires ${expected === 'array' ? 'an array' : expected === 'boolean' ? 'a boolean' : 'a string'}`,
  expansionSuffix: (x) => ` (expanded: ${x})`,
  patternPathOutsideFor: (p) => `Pattern path "${p}" cannot be used outside a <template for> (4.0 throws #1401 at init)`,
  omittedPathOutsideFor: (p) => `Shorthand path "${p}" cannot be used outside a <template for> (4.0 throws #1402 at init)`,
  loopIndexOutsideFor: (p) => `Loop index "${p}" cannot be used outside a <template for> (4.0 throws #1401 at init)`,
  indexArity: (api, p, req, wc, actual) =>
    `${api}("${p}") requires ${req === "exact" ? "exactly" : "at most"} ${wc} index(es) ("*" appears ${wc} time(s) in the path) but got ${actual}`,
  wildcardRank: (subject, needed, available) =>
    `${subject} needs ${needed} enclosing loop level(s) but the current scope provides ${available}`,
  wildcardOtherList: (p, over, loop) =>
    `"${p}" ranges over the rows of "${over}", but the enclosing "for" template at that level renders "${loop}" (4.0 throws when the binding is established). A "*" in a binding is the row of the loop around it — read a row of another list in a getter, with $resolve(path, indexes)`,
  outerInTemplate: (prop) =>
    `"${prop}:" replaces its element, so it cannot be used inside a "for" / "if" template (a row or branch keeps its nodes by position; 4.0 throws at init). Bind innerHTML: on a wrapper element instead`,
  directNotEvent: (prop) =>
    `The #direct modifier applies only to event bindings (on*:); it is ignored on "${prop}"`,
  delegatedCurrentTarget: (suggested, eventName, handler) =>
    `"${eventName}" bindings are delegated to the root, so event.currentTarget in "${handler}" is the root, not this element. Write "${suggested}:" to keep the listener on the element, or find the element with event.target.closest(...)`,
  getterCycle: (cycle) => `Path getters form a dependency cycle: ${cycle}`,
  updatedCallbackUnbound: (p) =>
    `$renderedCallback is binding-driven. "${p}" is not bound anywhere in this document, so this branch never runs. Use $watch to react without depending on what is rendered`,
  onHandlerThis: (name) =>
    `The $on handler "${name}" uses this. A $on handler receives the state as its first argument (\`${name}(state, event) { state.x = … }\`) and this is undefined, so this.… throws when it is called — unlike $watch handlers and methods`,
  getterReadsLocation: (read) =>
    `This getter reads ${read}, which is not state: it keeps the URL it first read (a navigation does not re-evaluate it). Read the URL through state — bind <wcs-router>'s path / searchParams`,
  getterReadsClock: (read) =>
    `This getter reads ${read}. The time is not state, so it is not a dependency: the getter is cached and keeps returning its first value (an event token "redrawing" every frame does not change it). Keep the time in state — bind the value <wcs-raf> or <wcs-timer> writes`,
  getterReadsAmbient: (read, kind) => {
    const head = `This getter reads ${read}, which is not state, so it is not a dependency: the getter is cached and keeps returning its first value`;
    switch (kind) {
      case 'size':
        return `${head} (a resize does not re-evaluate it). Keep the size in state — bind the width / height <wcs-resize> writes (for a breakpoint, <wcs-media-query>'s matched)`;
      case 'pixelRatio':
        return `${head} (a zoom or a move to another screen does not re-evaluate it). Bind <wcs-media-query>'s matched for the resolution thresholds the page uses (query="(min-resolution: 2dppx)")`;
      case 'media':
        return `${head} (the query starting or ceasing to match does not re-evaluate it). Bind <wcs-media-query>'s matched instead (<wcs-media-query query="(max-width: 600px)" data-wcs="matched: narrow">)`;
      case 'online':
        return `${head} (going offline or coming back does not re-evaluate it). Bind <wcs-network>'s offline instead`;
      case 'scroll':
        return `${head} (scrolling does not re-evaluate it). No wcstack element gives the scroll position: keep the value in state and write it from an event handler (a scroll listener)`;
      default:
        return `${head} (the page being hidden or shown does not re-evaluate it). No wcstack element gives the page's visibility: keep the value in state and write it from an event handler (a visibilitychange listener)`;
    }
  },
  updatedCallbackUnknownPath: (p) =>
    `"${p}" is not a path of this state, so it is never in $renderedCallback's paths and this branch never runs`,
  commandTokenUnbound: (t) =>
    `The command token "${t}" is emitted, but no command.<method>: ${t} binding in this document receives it, so the emit reaches nothing. Bind it on the element whose method it should call (command.<method>: ${t}, with <method> the name of that element's method)`,
  writePathMissing: (k) =>
    `"${k}" is not a key the state declares. The write creates a new key and reaches no binding of a declared one`,
  pathReadonlyWrite: (p) =>
    `"${p}" is a getter without a setter, so this write throws each time it runs ("${p}" is a getter without a setter). Add a setter that writes what the getter reads (set "${p}"(v) { … }), or write those values instead`,
  getterWrite: (p, g, via) =>
    `The getter "${g}" writes "${p}" while it is evaluated${via === undefined ? '' : ` (in the method "${via}" it calls)`}. A getter only reads: the write throws each time the getter is evaluated. Write it from a method, a setter or a $watch handler, or compute the value in a getter of its own`,
  setterCycleSelf: (p) =>
    `The setter of "${p}" writes its own path "${p}". A setter's path is the accessor itself: writing it calls the setter again, until the stack overflows. Store the value under a data path the getter reads (such as _${p.split('.').pop()})`,
  setterCycle: (cycle) =>
    `Setters write each other: ${cycle}. Unless a condition stops them, they call each other until the stack overflows. Store the values under data paths the getters read`,
  setterUnobserved: (p, w) =>
    `The setter of "${p}" writes ${w}, none of which the getter "${p}" reads. After a write the getter returns its old value, and a two-way input bound to "${p}" goes back to it. Write what the getter reads, or read what the setter writes in the getter`,
  relativePathOf: (r, a) => ` ("${r}" in the accessor "${a}")`,
  relativeNoRow: (r, a) =>
    `"${r}" is relative to a row, but the accessor "${a}" is not one of a list's rows (its key has no "*"). With no row it throws each time it is evaluated (#1402). Write the full path, or make it a row accessor (get "<list>.*.<name>"())`,
  relativeApiPath: (r, api) =>
    `"${r}" is relative to a row, but ${api} takes its rows from its indexes argument, not from the row it is called at. A relative path is not expanded there, and the call throws. Write the full path ("<list>.*${r === '.' ? '' : r}")`,
  accessorListSyntax: (k, why) =>
    `The accessor key "${k}" lists several paths, but ${why === 'space' ? 'has a space beside a comma' : why === 'empty' ? 'has an empty entry' : 'a recursive path ("**") cannot be listed'}. Separate the paths with "," alone (get "users.*.fullname,employees.*.fullname"())${why === 'recursive' ? '' : ': the runtime takes what is between the commas as it is, so this declares a path nothing reads'}`,
  accessorListPath: (p, list, other, rel) =>
    `"${p}" is a path of the rows of "${list}", and this accessor is also declared for "${other}": at its rows that path has no row, so a read gives undefined and a write throws. Write it relative to the row: this["${rel}"]`,
  nestedWritePathMissing: (p) =>
    `Path "${p}" does not exist in the state definition. The write creates a new key in the object and reaches no binding of a declared path`,
  readPathMissing: (p, top) => top
    ? `"${p}" is not a key the state declares. Reading it throws (#301)`
    : `Path "${p}" does not exist in the state definition. The read gives undefined, and what is computed from it is wrong without a word`,
  stateSrcUnread: (src) =>
    `"${src}" cannot be read, so this state's paths and script rules are not checked. A src is read relative to this file (a URL is not read, and a path from / only under wcs-validate --root=<the site's root>): point it at the file laid out as on the server, relative to this file, or pass --root`,
  stateAbsent: (tag) =>
    `This file has bindings but no <${tag}>, so the paths they bind are not checked (a fragment a page includes, or a page whose state is made by script). Check the page that holds the state, or declare the paths in the stateSchema of a wcstack.manifest.json next to (or above) this file to have them checked`,
  pathDynamicUnknownValue: (path, n, name, from) =>
    `The value of "${path}"${name === undefined ? '' : from === undefined ? ` (${name})` : ` (${name}, imported from "${from}")`} cannot be read statically, so the ${n === 1 ? 'path' : `${n} paths`} bound under it ${n === 1 ? 'is' : 'are'} not checked. Give the key a JSDoc @type — its shape, or typeof import("./file.js").name for a module's literal (for a dictionary, the default language's file, which has every key) — or declare it in the stateSchema of wcstack.manifest.json to have them checked`,
  pathDynamicUnknownType: (path, n, type) =>
    `The JSDoc type ${type} of "${path}" cannot be read, so the ${n === 1 ? 'path' : `${n} paths`} bound under it ${n === 1 ? 'is' : 'are'} not checked (read are an export interface / export type of a file it can read, and a @typedef in a .js). Write the shape in place, make it a @typedef in the same script, or declare it in the stateSchema of wcstack.manifest.json to have them checked`,
  stateSchemaDrift: (inScript, inSchema) =>
    `The stateSchema applied to this page disagrees with its state's script${inScript.length > 0 ? ` (in the script, not in the schema: ${listKeys(inScript)})` : ''}${inSchema.length > 0 ? ` (in the schema, not in the script: ${listKeys(inSchema)})` : ''}. The schema is derived from a script: it is stale, or another state's (another page's). Checked against it, a binding to a renamed key passes and a key is said not to exist. Regenerate it with wcs-schema emit (the manifest it writes names its state file in stateSource, and the lint applies it only to the pages that load that file), and run wcs-schema check in CI to stop the drift`,
  pathDynamicUnknownOutput: (path, n, tag, member) =>
    `"${path}" is written by "${member}" of <${tag}>, an output, so it holds whatever the element gives: its shape cannot be read statically, and the ${n === 1 ? 'path' : `${n} paths`} bound under it ${n === 1 ? 'is' : 'are'} not checked. Give the key a JSDoc @type with its shape, or declare it in the stateSchema of wcstack.manifest.json to have them checked`,
  pathDynamicUnknownSpread: (sp) =>
    `The keys ${sp} brings in cannot be read statically, so this state's paths are not checked (bindings, reads in getters, $watch keys). Declare the keys in the stateSchema of wcstack.manifest.json to have them checked; npx wcs-schema (@wcstack/typescript) derives it from the state's types (JSDoc or TypeScript)`,
  pathDynamicUnknownObjectSpread: (path, n, sp, from) =>
    `The keys ${sp}${from === undefined ? '' : ` (imported from "${from}")`} brings into "${path}" cannot be read statically, so the ${n === 1 ? 'path' : `${n} paths`} bound under it ${n === 1 ? 'is' : 'are'} not checked. Spread a const of the module bound to an object literal, give the key a JSDoc @type with its shape, or declare it in the stateSchema of wcstack.manifest.json to have them checked`,
  pathReadonlyTwoWay: (p, prop) =>
    `"${p}" is a getter without a setter, and ${prop}: writes back what the reader enters, so every edit fails ("${p}" is a getter without a setter). Add a setter (set "${p}"(v) { … }), or bind it one way with #ro (${prop}#ro: ${p})`,
  pathReadonlyOutput: (p, tag, member, atInit, twoWay, spread) =>
    `"${p}" is a getter without a setter, but "${member}"${spread === undefined ? '' : `, which "${spread}" binds,`} is ${twoWay ? 'a member <' + tag + '> writes too (an output as well as an input)' : 'an output of <' + tag + '>'}: the element writes its value to "${p}", and ${atInit ? 'the write made when it is bound fails, so the state fails to initialize' : 'that write fails each time the element reports a value'} ("${p}" is a getter without a setter). ${spread !== undefined
      ? `Add a setter (set "${p}"(v) { … }), or bind "${member}" to a data path after the spread (${spread}; ${member}: <a data key>)`
      : !twoWay
        ? `Bind a data path and read it in the getter (${member}: <a data key>), or add a setter (set "${p}"(v) { … })`
        : atInit
          ? `Add a setter (set "${p}"(v) { … }), or take the first value from the state (remove #init=element)`
          : `Add a setter (set "${p}"(v) { … }), or bind it one way with #ro (${member}#ro: ${p} — the state still writes the element)`}`,
  submitWithoutPrevent: (h) =>
    `onsubmit has no #prevent and "${h}" does not call preventDefault, so the browser submits the form too: the page reloads, or with the router a GET puts the fields (a password too) in the URL and the history. Write onsubmit#prevent: ${h}, or call event.preventDefault() in the handler`,
  guardReadsAtModuleTop: (r) =>
    `The guard's module reads ${r} at its top level, outside the function it exports. The module is evaluated once, when the page loads, so the guard keeps the value it read then and decides every navigation with it (after a login, the session is still not there). Read it inside the exported function, which runs on every navigation`,
  stateReadsAtModuleTop: (r) =>
    `The state's module reads ${r} at its top level. The module is evaluated once per <wcs-state>, so the state keeps the value it read when the page loaded (a token or a session that changes later is not seen). Keep the value in state (bind it with <wcs-storage>), or read it inside the method that uses it`,
  eventTokenUnbound: (t, handler) =>
    `The event token "${t}" is declared in $eventTokens, but no eventToken.<member>: ${t} binding in this document emits it: no element fires it, so ${handler ? 'its $on handler never runs' : 'it never fires'}. Bind it on the element whose event should fire it (eventToken.<member>: ${t}, with <member> a wcBindable property of that element), or remove it from $eventTokens`,
  objectKeyAssign: (t, acc, sp) =>
    `This assigns a key of "${t}" in place. The state does not see the write, so no binding, getter or $watch that reads it changes, and nothing is rendered again. Assign a new object (${acc} = { ...${acc}, [key]: value }), or write the dot path this["${sp}"] = …`,
  getterUntrackedRead: (root, sp) =>
    `Only "${root}" is tracked here: the getter is not re-evaluated when "${sp}" changes (plain property access after a path read is not tracked). Read this["${sp}"] instead`,
  getterUntrackedReadBound: (root, sp, binding, tag, written) =>
    `Only "${root}" is tracked here, but the binding "${binding}" on <${tag}> writes "${written}" by path: that write never reaches this getter, which keeps returning the value it last computed (plain property access after a path read is not tracked). Read this["${sp}"] instead`,
  handlerFilterNotAllowed: (prop) => `Filters cannot be applied to event handler "${prop}"`,
  typeExpectation: (label, expected, resultType) =>
    `"${label}" requires ${EN_EXPECTED_LABEL[expected]} (current type: ${resultType})`,
  attrBooleanPresence: (a, p, rhs) =>
    `"attr.${a}" is given a boolean. attr.* writes String(value), so false is written as ${a}="false" — and a boolean attribute is on whenever it is present, whatever its value: ${a}="false" still means ${a} (only null / undefined remove an attribute). Bind the property instead: ${p}: ${rhs}`,
  attrBooleanText: (a, rhs) =>
    `"attr.${a}" is given a boolean. attr.* writes String(value), so the attribute is "true" or "false" and is never removed (only null / undefined remove it): whatever tests its presence — [${a}] in CSS, hasAttribute() — finds it either way. To remove it while false, write attr.${a}: ${rhs}|defaults(null); if the text "true" / "false" is what is meant, say so: attr.${a}: ${rhs}|string`,
  radioBeforeValue: (binding, value, checkbox, fix) =>
    `"${binding}:" is written before "${value}:", which gives this ${checkbox ? 'checkbox' : 'radio'} its value. Bindings are applied in the order written, so it is compared while its value is still the browser's default "on": nothing is checked at the first render — nothing says so, and a later write of the state checks the right one. Write the value first: ${fix}`,
  bindingExpression: (expression, fix) =>
    `A binding takes a path and filters, not an expression: "${expression}" is not evaluated, it is looked up as a path of that name. ${fix !== null ? `Write ${fix}` : 'Write a getter in the state that computes the value, and bind the getter\'s name'}`,
  handlerExpression: (property, expression, method) =>
    `An event binding names a method, not a call or a function: "${expression}" is not evaluated. ${method !== null ? `Write "${property}: ${method}"` : 'Write the method\'s name'}; the handler is called with (event, ...loopIndexes), so read the row's values in the method through the loop index`,
  attributeMustache: (name) =>
    `{{ }} is read in text only: in the attribute "${name}" it stays as written. Bind the attribute (attr.${name}: <path>, with a getter that builds the string) — a server-side template that fills it before the page is served is fine`,
  structuralElement: (directive, tagName) =>
    `"${directive}:" works on a <template> only: on <${tagName}> the runtime sets a property named "${directive}" and does nothing else — ${directive === 'for' ? 'the element is drawn once, not once per row' : 'the element is always shown'}. Put the element inside <template data-wcs="${directive === 'else' ? 'else:' : `${directive}: …`}">`,
  collectionMutation: (key, method, kind) =>
    `"this.${key}.${method}(…)" changes the state's ${kind} in place: the state does not see it, so nothing bound to "${key}" and no getter that reads it is updated — nothing says so. Assign a new ${kind} (${collectionFix(key, method, kind)}), or keep an array / an object`,
  rowIdShared: (id) =>
    `Every row of the for: gets id="${id}": an id belongs to one element, so a <label for> or aria-labelledby that names it reaches the first row only. Bind it (attr.id: .domId, with a row getter that builds it from the row's key)`,
  eventNameCase: (property, lower) =>
    `"${property}:" listens for an event named "${property.slice(2)}", which nothing dispatches — DOM event names are lower case. Write "${lower}:" for the DOM event; a callback "prop" of a part is an event the part dispatches, bound with eventToken.<member>:`,
  inlineImport: (specifier, guard) =>
    `An inline ${guard ? '<wcs-guard-handler>' : '<wcs-state>'} script is evaluated from a blob: URL, against which "${specifier}" does not resolve: the ${guard ? 'guard' : 'state'} fails to load. Import a full URL or a name the page's import map gives${guard ? '' : ', or move the state into a file (src="./state.js")'}`,
  keyBinding: () =>
    `"key:" sets a property named "key" and does nothing else. No key is needed: rows are matched by the row object, and $listKeys keeps rows across refetched data`,
  radioNameShared: (name, binding) =>
    `Every row's radios get name="${name}", so the browser makes one group of all the rows: only one radio on the whole page stays checked, and the page disagrees with the rows' values from the first render — nothing says so. ${binding === 'radio'
      ? 'Bind a name that differs per row (attr.name: .<a row field>), or drop the name: radio: keeps the radios bound to one path in step without it'
      : 'Bind a name that differs per row (attr.name: .<a row field>) — or, for one choice over all the rows, bind them all to one path: value: .<the row\'s id>; radio: <path>'}`,
  numberWrittenAsString: (path, left, asNumber) =>
    `"${path}" is a number in the state, but value: writes back what the element holds, a string: after the user enters 5 the state has "5", and "5" + 1 is "51" — nothing says so. Convert it on the way in: ${asNumber ? `valueAsNumber: ${path}, or ` : ''}an input filter on the left side, ${left}|number: ${path} (also |int, |float)`,
  twoWayOutputFilter: (prop, filters, left, rhs, keystroke) => keystroke
    ? `${prop}: is two-way and writes back on every keystroke, and the output filter "${filters}" formats what the state holds each time: the field is rewritten while the user types — the caret jumps to the end, an IME composition is cut — and what the state receives is the field's formatted text (an output filter is not undone on the way back). Show the formatted text in another element, write back when the field is committed and format in a setter (${prop}#onchange:), or make the binding one-way: ${prop}#ro: ${rhs}`
    : `${prop}: is two-way, and nothing undoes the output filter "${filters}" on the way back: the element writes back the formatted value it shows, and the filter is then applied to that. Undo it with an input filter on the left side (${left}|<filter>: …), show the formatted value in another element, or make the binding one-way: ${prop}#ro: ${rhs}`,
  bodyBinding: (tag, attribute) =>
    `${attribute} on <${tag}> is never bound: <wcs-state> binds what is inside <body>, not <body> or <html> themselves, so the bindings written here do nothing (an event handler never runs; class., attr. and the rest are never written). Move the binding to an element inside <body> (a wrapper, <main>), or write the value from $connectedCallback or a $watch handler (document.documentElement.lang = …)`,
  linkHandler: (property, handler) =>
    `"${property}:" on <wcs-link> never runs "${handler}": the <wcs-link> itself is display: none, and what the user clicks is the <a> it generates beside itself, so no event reaches the host. Put the handler on an element inside the link (its children move into the <a>) or on an element around it; to navigate from a handler, write the router's navigateUrl (data-wcs="navigateUrl: …" on <wcs-router>)`,
  rootMarginUnit: (tag, value, refused, suggested) => {
    const why = refused.length === 0
      ? 'it takes one to four values'
      : `${refused.map((t) => `"${t}"`).join(', ')} ${refused.length === 1 ? 'is not a number' : 'are not numbers'} with px or %${refused.some(isUnitlessZero) ? ' (a 0 needs its unit too)' : ''}`;
    const effect = tag === 'wcs-intersect' ? 'the element observes nothing and observing stays false' : 'the element observes nothing and no page is loaded';
    return `The browser refuses root-margin="${value}" (rootMargin must be specified in pixels or percent): ${why}. So ${effect}. ${suggested === null ? 'Write one to four values, each a number with px or %' : `Write root-margin="${suggested}"`}`;
  },
  frequencyInvalid: (tag, value, suggested) =>
    `frequency="${value}" is not a positive number, so <${tag}> reads it as "none" and the sensor runs at the browser's default rate, without a word. ${suggested === null ? 'Write a positive number (Hz), or remove the attribute for the default rate' : `Write the number alone: frequency="${suggested}"`}`,
  targetSelector: (tag, value) =>
    `The target of <${tag}> is a CSS selector: target="${value}" selects <${value}> elements, and this document has none — it has an element with id="${value}". No target is found, so ${TARGET_EFFECT_EN[tag] ?? 'the element does nothing'}. To name the id, write target="#${value}"`,
  commandEventArgument: (property, token, tag, method, more) =>
    `"${property}: ${token}" emits the token straight from the event, so the commands that receive it are called with the event as their first argument. ${method}() of <${tag}> takes an argument there, and gets the event: ${method}(event)${more > 0 ? ` (and ${more} more such ${more === 1 ? 'receiver' : 'receivers'})` : ''}. Emit from a state method instead — write ${property}: <method>, with <method>() { this.${token}.emit(…) } passing what ${method}() takes (emit with no argument when there is nothing to pass)`,
  outputPathWritten: (path, tag, member, commands) =>
    `"${path}" is bound to "${member}" of <${tag}>, an output: the element writes it, and a write from a script does not reach the element. Assigning true makes the element do nothing — only the page now says so. ${commands.length === 0
      ? `<${tag}> has no command: the value is the element's to report. Remove the assignment`
      : `Ask the element with a command (${commands.join(', ')} — bind command.<method>: $command.<name> and call this.$command.<name>.emit() here), and let the element write "${path}"`}`,
  filterUnknown: (n) => `Filter "${n}" is not a built-in filter`,
  filterRemoved: (n, c) => `Filter "${n}" was removed in 4.0 (it was the 3.x old name of "${c}") — write "${c}"`,
  substrRemoved: (rewrite) =>
    `Filter "substr" was removed in 4.0 — write slice(start, start + length): slice takes the end index, not a length${rewrite === null ? '' : ` (here: ${rewrite})`}`,
  filterMinArgs: (n, min, c) => `Filter "${n}" requires at least ${min} argument(s) (${c} given)`,
  filterMaxArgs: (n, max, c) => `Filter "${n}" accepts at most ${max} argument(s) (${c} given)`,
  filterArgType: (n, i, exp, arg, act) => `Argument ${i} of filter "${n}" must be of type ${exp} ("${arg}" is ${act})`,
  filterInputType: (n, accepts, cur) => `Filter "${n}" requires input of type ${accepts} (current type: ${cur})`,
  filterArgEnum: (n, arg, members, suggestion) =>
    `${arg} in "${n}(${arg})" is not a value the compared value takes (${members.join(' | ')}): it is ${n === 'ne' ? 'always true' : 'never true'}${suggestion}`,
  moustacheFouc: (e) =>
    `{{ }} outside a <template> causes FOUC (the raw template string is visible before binding). Consider the comment syntax <!--@@:${e}--> instead.`,
  moustacheFoucTextParent: (e, tag) =>
    `{{ }} outside a <template> causes FOUC (the raw template string is visible before binding). A comment binding is not bound inside <${tag}>: bind the element instead (<${tag} data-wcs="${tag === 'textarea' ? 'value' : 'textContent'}: ${e}">).`,
  textBindingInHead: (w) =>
    `${w} is in the document's <head>, and a <wcs-state> binds only the <body> and shadow roots, so it stays as written. Write document.title from the state's script ($connectedCallback and a $watch handler), or put the <title> in a route's <wcs-head>`,
  nestedAssign: (sp) => `Assigning to a nested property does not trigger a reactive update. Use this["${sp}"] instead.`,
  watchNotObject: () => `$watch must be an object mapping state paths to handler functions (the runtime throws on this shape at load time)`,
  watchKeyCrossState: (k) => `$watch key "${k}" targets another state. Cross-state watching with @ is not supported (own paths only)`,
  watchKeyReserved: (k) => `$watch key "${k}" must not start with "$" (reserved namespace)`,
  watchKeyEmptySegment: (k) => `$watch key "${k}" has an empty path segment`,
  watchHandlerNotFunction: (k) => `The value of $watch entry "${k}" must be a function`,
  watchPathMissing: (k) => `$watch key "${k}" does not exist in the state definition (it will never fire)`,
  scanRemoved: (mountPath) =>
    mountPath === null
      ? `$scan was removed in 4.0 (the entries with the diagnostics add-on, such as /auto, throw at load; /core alone ignores it). Fold a path's changes in a $watch handler, or events in an $on handler, and write the output property there`
      : `$scan was removed in 4.0. In a volume (mount="${mountPath}") the runtime refuses to graft it and reports that with console.error (this state is not on the tree). Fold in a $watch or $on handler on the root state`,
  typeAnnotationIncompatible: (vt, rt) => `Type "${vt}" is not compatible with @type {${rt}}`,
  arrayMutation: (m, alt) =>
    `Destructive array method "${m}" does not trigger a reactive update (re-assigning the same reference does not reflect added/removed elements either). Use a non-destructive method with reassignment (e.g. ${alt}).`,
  arrayIndexAssign: (sp) =>
    `Assigning directly to an array index does not trigger a reactive update. Use a dot-path assignment like this["${sp}"], or with() plus reassignment.`,
  inPlaceAlias: (a, src, t) =>
    `"${a}" is ${src} — the state's own value. A change through it does not trigger a reactive update, and writing the same value back does not add, remove or replace a list's rows. Build a new value and assign it to ${t} (${a}.with(i, item), [...${a}, item], { ...${a}, key: value })`,
  inPlaceChange: (src, t) =>
    `${src} changes the state's value in place, which does not trigger a reactive update. Build a new value and assign it to ${t}`,
  tagMemberUnknown: (prop, tag) =>
    `"${prop}" is not a wcBindable member of <${tag}> (the runtime refuses a binding to an undeclared member with #38; at the root the state fails to initialize)`,
  nameAlias: (written, canonical) =>
    `"${written}" was removed in 4.0 (the 3.x old name of "${canonical}"; the runtime throws when it is read) — write "${canonical}"`,
  declarationAliasRead: (alias, canonical) =>
    `"${alias}" is a declaration key 4.0 removed (the 3.x old name of "${canonical}"), so this["${alias}"] is undefined. A declaration cannot be read through this — reading "${canonical}" is undefined too${canonical === '$stream' ? ' (read a stream\'s state from $streamStatus / $streamError)' : ''}`,
  declarationAlias: (alias, canonical) =>
    `The declaration key "${alias}" was removed in 4.0 (the 3.x old name of "${canonical}"; the runtime throws at load time) — write "${canonical}"`,
  declarationAliasInVolume: (alias, canonical, mountPath) =>
    `The declaration key "${alias}" was removed in 4.0 (the 3.x old name of "${canonical}"). In a volume (mount="${mountPath}") the runtime refuses to graft it and reports that with console.error (this state is not on the tree). "${canonical}" cannot be declared in a volume either — declare it on the root state`,
  behaviorNotObject: (keys) =>
    `$behavior must be an object { ${keys.map((k) => `${k}?`).join(', ')} } (the runtime throws at load time)`,
  behaviorKeyUnknown: (key, keys, suggestion) =>
    `"${key}" is not a $behavior key (only ${keys.join(', ')}; the runtime throws at load time)${suggestion}`,
  behaviorValueType: (key, type) =>
    `$behavior "${key}" must be ${type === 'boolean' ? 'true or false' : type} (the runtime throws at load time)`,
  configInVolume: (key, mountPath) =>
    `${key} cannot be declared in a volume (mount="${mountPath}"): the runtime refuses to graft the volume and reports that with console.error (this state is not on the tree). Declare it on the root state — a volume is grafted onto the root's engine`,
  featuresNotArray: () =>
    `$features must be an array of add-on names (for example ["temporal", "formats"]; the runtime throws at load time)`,
  featureUnknown: (name, names, suggestion) =>
    `"${name}" is not an add-on (${names.join(', ')})${suggestion}`,
  volumeDeclarationRejected: (key, mountPath) =>
    `${key} is not run in a volume (mount="${mountPath}"): the runtime refuses to graft the volume and reports that with console.error (this state is not on the tree). Declare it on the root state`,
  volumeDeclarationNotRun: (key, mountPath) =>
    `${key} is not run in a volume (mount="${mountPath}"): the runtime says so with console.warn and ignores this declaration — it belongs to the root state. Declare it there`,
  partPathMissing: (path, tag, key, prop, object) =>
    `Path "${path}" in <${tag}>'s template does not resolve: "${key}" is not a key of the part's state, it is not handed to it (${prop}.${key}: …), and ${object === null
      ? `the part is mounted on no object (${prop}: …)`
      : `the object it is mounted on ("${object}") has no such key`}. Inside a part a read falls through to that object and fails nothing, so the field is empty (the runtime says so with [wcs/binding-path-missing])`,
  partPathOfPage: (key, prop) =>
    `. "${key}" is a path of the page's state: a part does not read it there — hand it over (${prop}.${key}: ${key})`,
  dccBindComponent: (tag) =>
    `The <wcs-state> in <${tag} data-wc-definition> has bind-component. A DCC's state belongs to the definition's template and is loaded per instance: the runtime refuses this definition (a <wcs-state bind-component> cannot define a component), and <${tag}> is defined on no page. Drop bind-component, or write the part as a class`,
  dccSecondState: (tag) =>
    `A second <wcs-state> in <${tag} data-wc-definition>. A definition has one state: each tries to define the tag, and the runtime refuses the second (<${tag}> is already defined) — and in an instance, as a second root. Put them in one`,
  dccListNotArray: (key) =>
    `${key} is a list of the state's member names (${key}: ["name", …]). The runtime refuses a definition where it is not a list, and the tag is defined on no page`,
  dccEntryEmpty: (key) =>
    `An entry of ${key} is a non-empty string. The runtime refuses a definition with an empty one, and the tag is defined on no page`,
  dccEntryInternal: (key, name) =>
    `"${name}" in ${key} starts with $: such members are internal and are never exposed. The runtime refuses this definition, and the tag is defined on no page`,
  dccEntryDuplicated: (key, name) =>
    `"${name}" is listed twice in ${key}. The runtime refuses this definition, and the tag is defined on no page`,
  dccEntryMissing: (key, name) =>
    `"${name}" in ${key} is not a member of this definition's state. The runtime refuses this definition, and the tag is defined on no page`,
  dccBindableIsMethod: (name) =>
    `"${name}" in $bindables is a method: list it in $commands. The runtime refuses this definition, and the tag is defined on no page`,
  dccCommandIsValue: (name) =>
    `"${name}" in $commands is not a method: list a value in $bindables. The runtime refuses this definition, and the tag is defined on no page`,
  dccAttribute: (tag, name) =>
    `<${tag}>'s input "${name}" is written as an attribute. A DCC's inputs are the properties its $bindables lists: the attribute is not read, and the part shows its default. Bind it (data-wcs="${name}: <path>") or set the property`,
  secondRoot: () =>
    'A second <wcs-state> on the same root: there is one state tree per root (the runtime refuses the one that loads second and reports it with console.error). Graft a subtree with <wcs-state mount="path">',
  bindComponentSource: (prop, sources) =>
    `A bind-component state comes only from the host element's property (<host>.${prop || '…'}): combined with ${sources.join(', ')}, the runtime refuses to load it and reports that with console.error (the component does not mount). Write the state on the component's property`,
  indexParamRange: (key, max) =>
    `"${key}" is not a loop index: list index parameters run from $1 to $${max} (the runtime throws wcs/index-param-range when it is read)`,
  indexParamNotPath: (key, max) =>
    `"${key}" is not a loop index (they run from $1 to $${max}) and the "$" namespace holds no state path: the runtime fails this binding with wcs/binding-path-missing`,
  featuresAttrNotRoot: () =>
    `The features attribute is read only on the document's root <wcs-state> (the first one without mount and bind-component); it is ignored here — put it on the root <wcs-state>`,
  onPrefixedMember: (member, tag, modifiers) =>
    `"${member}" is a member of <${tag}>, but a name starting with "on" makes an event binding (it listens for a "${member.slice(2)}" event) and the value never arrives. Write ".${member}${modifiers ? `#${modifiers}` : ''}:" to bind the property (@wcstack/state 3.1)`,
  tagCommandUnknown: (name, tag, declared) =>
    `"${name}" is not a command of <${tag}> (declared: ${declared})`,
  nativeCommandUnknown: (method, tag, allowed) =>
    `"${method}" is not a command of a native <${tag}> (its commands: ${allowed}; the runtime throws wcs/token-misconfigured at initialization)`,
  spreadNoBindable: (tag) =>
    `'...' (spread) requires <${tag}> to expose a valid wcBindable declaration — this tag declares none, so the runtime raises an error`,
  tagEventTokenKeyUnknown: (name, tag, declared) =>
    `eventToken key "${name}" is not a wcBindable property of <${tag}>. Raw DOM event names never fire — use the property name (declared: ${declared})`,
  handleBoundAsValue: (name, tag) =>
    `"${name}" of <${tag}> is a live resource (a handle), not a value. Bound to a state path, it puts an object no snapshot or SSR can carry into the state — receive it with eventToken.${name}: and hand it to the next element as a command argument`,
  ariaAttrUnknown: (name) =>
    `"${name}" is not a WAI-ARIA attribute. setAttribute writes it anyway, and assistive technology silently ignores it`,
  liveRegionInserted: (attribute, by, condition) =>
    `This live region (${attribute}) is inserted with its text when ${by === 'route' ? 'its <wcs-route> is entered' : by === 'for' ? 'its for: row is added' : 'its branch appears'} (${condition === null ? 'it holds text written in the markup' : `its text is bound to what the condition "${condition}" reads, so the branch appears with the text`}). A screen reader announces a region whose text changes while it is in the page, so this text is not announced (an inserted role="alert" is the one form announced on insertion) — a status message meant to be heard belongs in a region that is always in the page: keep the region outside the ${by === 'route' ? 'route' : 'template'}, bind its textContent: to the message, and empty it when there is nothing to say`,
  didYouMean: (c) => `. Did you mean "${c}"?`,
  none: () => `none`,
  triggerSeededTruthy: (path) =>
    `The trigger-bound slot "${path}" is seeded with true. trigger has no edge detection (any truthy write fires, and it bypasses manual), so it fires immediately at bind. Seed it with false`,
  storageSeedClobber: (path, raw) =>
    `The <wcs-storage> value-bound slot "${path}" is seeded with ${shortSeed(raw)}. The initial write-back overwrites the persisted value on every load — add #init=element to the binding (\`value#init=element: ${path}\`) so the stored value wins, and seed the slot with null (what an empty key loads as)`,
  storageInitSeed: (path, raw) =>
    `The <wcs-storage> value-bound slot "${path}" is seeded with ${shortSeed(raw)}, but #init=element pulls the element's value into it. On a first visit (an empty key) that is null, so the seed is replaced by null — seed it with null and supply the default where you read it (\`this.${path} ?? …\`), or bind an accessor pair whose setter ignores null`,
  storagePairClobber: (path) =>
    `The <wcs-storage> value is bound to the accessor pair "${path}" without #init=element. The state's side goes first, so on every load the getter's starting value is saved over the stored one, and the setter never receives it — add #init=element (\`value#init=element: ${path}\`)`,
  inputNestedWrite: (tag, input, path, example) =>
    `"${path}" is bound to the input "${input}" of <${tag}>, but the page writes below it ("${example}"). A binding is re-applied only when "${path}" itself is assigned, so those writes never reach <${tag}> — bind a getter that reads the fields by path (\`this["${example}"]\`, \`$getAll\`) and returns a new value: with a setter beside it to take the element's value in as well (the accessor pair, ${input}#init=element: <getter>), or one way when the element's value is not taken in (${input}#ro: <getter> — with neither a setter nor #ro, what the element reports is written back to the getter and refused: wcs/path-readonly). Or replace "${path}" instead of writing below it`,
  inputNestedWriteOneShot: (tag, input, path, example) =>
    `"${path}" is bound to the input "${input}" of <${tag}>, but the page writes below it ("${example}"). A binding is re-applied only when "${path}" itself is assigned, and <${tag}> resets "${input}" to null after every request, so the next request goes without it — build a new object in the handler that starts the request (\`this.submitBody = { … }\`) and bind that`,
  devtoolsAfterState: () =>
    `Load @wcstack/devtools/auto before @wcstack/state/auto (loaded later, the DevTools timeline starts when it attaches; 4.0 sends it the wiring that is there already)`,
  baseHrefMissing: () =>
    `An SPA using @wcstack/router needs <base href="/"> in <head>, or a synchronous <head> script that creates one — the form for a locale in the basename (without it, deep links misderive the basename)`,
  routerOutletMisplaced: () =>
    `This <wcs-outlet> is not right after a <wcs-router>, so no router uses it: a router uses only the element right after it as its outlet, and makes an outlet of its own there when that is not a <wcs-outlet>. The routes render right after the router and this outlet stays empty — move it right after the <wcs-router>`,
  linkQueryKeyIgnored: (toKeys, named) =>
    `None of the keys this <wcs-link>'s to sets (${toKeys}) is named in query-keys (${named}). A link with query-keys compares only the keys it names, so its own query plays no part: it is current wherever ${named} match, whatever ${toKeys} is — tabs written this way are all current at once. Name the keys the link is for (query-keys="${toKeys}")`,
  signalsDualEntry: () =>
    `Both @wcstack/signals and @wcstack/signals/dom are imported on this page. On a CDN each entry is a self-contained bundle, so the reactive core is duplicated and reactivity breaks at the seam — import everything from the single /dom entry`,
  signalsImportMapBoth: () =>
    `This import map maps both @wcstack/signals and @wcstack/signals/dom. On a CDN each entry carries its own reactive core, so a module that imports @wcstack/signals — this page's, or a .js file it loads — gets a second core and reactivity breaks at the seam. Map only @wcstack/signals/dom (it exports the whole core)`,
  tagPackageMissing: (tags, pkg, url) =>
    `${tags.map((t) => `<${t}>`).join(', ')} ${tags.length === 1 ? 'is a tag' : 'are tags'} of ${pkg}, and this page loads no script of ${pkg}: the element is never defined, so its bindings wait and nothing happens, without a word in the console. Load it with <script type="module" src="${url}"></script>`,
  linkRouterMissing: (to, n) =>
    `This page has no <wcs-router>, so this <wcs-link to="${to}">${n > 1 ? ` (and the ${n - 1} other${n > 2 ? 's' : ''} on the page)` : ''} throws "[@wcstack/router] wcs-link is not connected to a router." when it connects, and the link is hidden (display: none). On a page without the router write <a href="${to}">, or add the <wcs-router>`,
  lintVersionBehind: (spec, version, minor, lint) =>
    `This page pins ${spec}, a newer minor than the rules of this lint (@wcstack ${lint}): what ${minor} added is not checked, and correct ${minor} syntax can be reported as an error. Upgrade @wcstack/lint to ${version} (npm i -D @wcstack/lint@${version}; the VS Code extension to its release for ${minor})`,
  routeBareMustache: (inLayout) => inLayout
    ? `{{ }} in text directly under a layout template is not bound on a navigation. Wrap it in an element (<span>{{ … }}</span>)`
    : `{{ }} in text directly under <wcs-route> is bound only on the landing route: a route entered by navigation shows it as written. Wrap it in an element (<h1>{{ … }}</h1>)`,
  layoutSlotMissing: (l) =>
    `The template of layout "${l}" has no default <slot> (one without a name), so what this <wcs-layout> holds outside the named slots — the nested routes and their pages — is not shown. Put a <slot></slot> where the page goes`,
  namedStateAttrDeprecated: (name) =>
    `The "name" attribute was removed in v2 — there is a single state tree per root. Mount this state onto the tree instead: <wcs-state mount="${name}"> and read it as "${name}.<path>" (docs/state-mount-design.md §9)`,
  namedStatePathDeprecated: (name) =>
    name === 'default'
      ? `The "@default" selector was removed in v2 — drop it (docs/state-mount-design.md §9)`
      : `The "@name" selector was removed in v2 — there is a single state tree. Mount the named state onto the tree (<wcs-state mount="...">) and read it as "${name}.<path>" (docs/state-mount-design.md §9)`,
  mountPathInvalid: (problem, mountPath) => {
    // runtime（state の scopes/volume.ts の `validPath`）はどの形も `has an invalid mount path` で拒む
    switch (problem) {
      case 'empty': return `"mount" needs a non-empty static path (the runtime refuses the volume: "has an invalid mount path").`;
      case 'emptySegment': return `"mount" path "${mountPath}" has an empty segment (the runtime refuses the volume: "has an invalid mount path").`;
      case 'wildcard': return `"mount" path "${mountPath}" must be static — no "*" (the runtime refuses the volume: "has an invalid mount path").`;
      case 'whitespace': return `"mount" path "${mountPath}" must not contain whitespace (the runtime refuses the volume: "has an invalid mount path").`;
      default: return `"mount" path "${mountPath}" must not use the reserved characters $, #, @ (the runtime refuses the volume: "has an invalid mount path").`;
    }
  },
  recursionUnsupported: (p, where) => {
    switch (where) {
      case 'binding':
        return `"**" in "${p}" cannot be used in data-wcs. "**" is only meaningful in a $recursion declaration, in a recursive getter key, and in the path argument of $getAll / $setAll (the runtime throws when the binding is established). Write the expanded concrete path in HTML instead`;
      case 'watch':
        return `$watch key "${p}" cannot contain "**" — watching is defined against a concrete path (a fixed number of "*")`;
      case 'resolve':
        return `$resolve("${p}") cannot take "**" — it accepts only an expanded concrete path with an exactly matching index tuple`;
      case 'update':
        return `$update("${p}") cannot take "**" — it changes one address (an expanded concrete path with an exactly matching index tuple). Write every depth with $setAll("${p}", [], value)`;
      case 'assignment':
        return `this["${p}"] = … cannot use "**" (there are no recursive setters in this version; an assignment only resolves against an expanded concrete path). Broadcast with $setAll("${p}", [], value), or write a concrete path`;
      case 'postUpdate':
        return `$postUpdate("${p}") cannot take "**" — a notification is defined against a concrete path (a fixed number of "*")`;
      case 'dependOn':
        return `$dependOn("${p}") cannot take "**" — a dependency is registered against a concrete path (a fixed number of "*")`;
      case 'trackDependency':
        return `$trackDependency("${p}") cannot take "**" — a dependency is registered against a concrete path (a fixed number of "*")`;
      case 'listKeys':
        return `$listKeys key "${p}" cannot contain "**" — a keyed list is one concrete list path. Declare the key per depth instead (for example "nodes.*.children")`;
      default:
        return `"${p}" contains "**" but this state declares no $recursion anchor. Declare $recursion = { "<anchor>": "<repeat>" } (for example { "nodes.*": "children.*" }) — without it the runtime throws #1101 at load and the state fails to initialize`;
    }
  },
  recursionAnchorMismatch: (p, anchor) =>
    `"${p}" does not match the declared recursion anchor "${anchor}" (this version supports exactly one self-recursive anchor per state, and "**" must be followed by a well-formed suffix: no second "**", no empty segment, no bare "*" right after "**")`,
  recursionGetAllForm: (p, problem) =>
    problem === 'notArray'
      ? `$getAll("${p}", indexes) with "**" takes either no indexes (to read the depth of the recursive getter being evaluated) or [] (to walk every depth) — not null or a non-array value`
      : `$getAll("${p}", indexes) with "**" takes no partial prefix: a prefix cannot say which depth it applies to. Omit the indexes to read the depth of the recursive getter being evaluated, or pass [] to walk every depth`,
  recursionSetAllForm: (p, problem) => {
    switch (problem) {
      case 'prefix':
        return `$setAll("${p}", indexes, …) with "**" takes no partial prefix: a prefix cannot say which depth it applies to. Pass [] to broadcast to every depth`;
      case 'noIndexes':
        return `$setAll("${p}", …) with "**" requires an explicit empty indexes array ([]) — the write API takes no context`;
      case 'mapper':
        return `$setAll("${p}", …) with "**" does not take a mapper — the index tuple has a different length at each depth. Pass a constant value`;
      default:
        return `$setAll("${p}", …) with "**" does not take { spread: true } — handing a flat array to a tree needs the author to know the walk order, which is not a usable contract`;
    }
  },
  recursionStructuralWrite: (p, target, repeatList) => {
    switch (target) {
      case 'node':
        return `$setAll("${p}") writes the recursion structure itself (a node). This version broadcasts to leaf properties only — replacing a node would invalidate the child addresses already resolved for this write`;
      case 'branch':
        return `$setAll("${p}") writes the recursion structure itself (an object on the way to the "${repeatList}" list). This version broadcasts to leaf properties only — replacing it would invalidate the child addresses already resolved below it`;
      case 'length':
        return `$setAll("${p}") writes the recursion structure itself (the length of the "${repeatList}" list). Assigning length truncates the array, which invalidates the child addresses already resolved below it just like replacing the list`;
      default:
        return `$setAll("${p}") writes the recursion structure itself (the "${repeatList}" list). This version broadcasts to leaf properties only`;
    }
  },
  recursionReadonly: (subject, getterPath) =>
    `${subject} writes into the recursive getter "${getterPath}", which has no setter in this version (this spelling is that getter at one depth, or a path inside the value it derives). Write the values it derives from instead`,
  recursionInVolume: (subject, mountPath) =>
    `${subject} cannot be declared in a volume (mount="${mountPath}"); for $recursion the runtime refuses to graft the volume and reports that with console.error. Declare the recursion and its "**" getters on the root state — the anchor path is resolved against the root tree`,
  recursionNotObject: () =>
    `$recursion must be an object mapping one anchor path to its repeating sub-path (for example { "nodes.*": "children.*" }; the runtime throws at load time for this shape)`,
  recursionAnchorCount: (count) =>
    count === 0
      ? `$recursion must declare exactly one anchor; it is empty`
      : `$recursion declares ${count} anchors. This version supports exactly one self-recursive anchor per state`,
  recursionNodePathInvalid: (kind, path, problem) => {
    const subject = kind === 'anchor' ? '$recursion anchor' : '$recursion repeating sub-path';
    switch (problem) {
      case 'empty': return `${subject} must be a non-empty string`;
      case 'emptySegment': return `${subject} "${path}" must not contain empty path segments`;
      case 'notElement': return `${subject} "${path}" must name a list element: a property path ending with ".*" (for example "nodes.*")`;
      case 'reservedRoot': return `${subject} "${path}" must not start with "$" — that namespace is reserved`;
      case 'reservedMount': return `${subject} "${path}" must not contain "#" — that segment is reserved for mounts`;
      case 'midWildcard': return `${subject} "${path}" must have exactly one "*", at the end (wildcards in the middle are not supported in this version)`;
      case 'indexSegment': return `${subject} "${path}" must not contain an index segment — the recursion is declared over the shape of the tree, not over one row`;
      default: return `${subject} "${path}" must not contain "**" — the declaration is what gives "**" its meaning`;
    }
  },
  recursionRepeatNotString: (anchor) =>
    `$recursion entry "${anchor}" must map to the repeating sub-path as a string (for example "children.*")`,
  recursionGetterInvalid: (key, problem, anchor) => {
    switch (problem) {
      case 'setter': return `Recursive setters are not supported in this version: "${key}". Declare a plain path setter, or write through the concrete path`;
      case 'notGetter': return `"${key}" contains "**" but is not a getter. The recursion wildcard only names a family of computed paths`;
      case 'structural': return `"${key}" names the recursion structure itself (a node, its child list, that list's length, or an object on the way to the list). A recursive getter would hide the real child list at every depth — "**" names a computed leaf under a node (for example "${anchor}.total")`;
      default: return `"${key}" names the recursive node itself. "**" names a computed path under a node (for example "${anchor}.total"), not the node`;
    }
  },
  recursionGetterCollision: (a, b, repeat) =>
    `"${a}" and "${b}" expand to the same concrete path at different depths (they differ by whole repetitions of "${repeat}"). Rename one of them`,
  recursionConcreteCollision: (concreteKey, recursiveKey) =>
    `"${concreteKey}" is already defined on the state, so the recursive getter "${recursiveKey}" cannot expand to it (the runtime throws when the declaration is read). Rename one of them`,
};

const CATALOGS: Record<WcsLocale, WcsMessageCatalog> = { ja, en };

/** locale 文字列からカタログを取得する（未指定は ja = 従来挙動）。 */
export function getMessages(locale?: string): WcsMessageCatalog {
  return CATALOGS[resolveLocale(locale)];
}
