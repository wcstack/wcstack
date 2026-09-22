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

/** 添字本数の要求（`$resolve` は厳密一致・`$getAll` / `$setAll` は接頭辞なので上限）。 */
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
  resolvedPathInUi(path: string): string;
  /** `$getAll` / `$setAll` / `$resolve` の添字の本数がパスの `*` の本数と噛み合わない。 */
  indexArity(api: string, path: string, requirement: IndexArityRequirement, wildcardCount: number, actual: number): string;
  /** ワイルドカードの階数がスコープの段数を超える（`$N` を含む）。 */
  wildcardRank(subject: string, needed: number, available: number): string;
  /** パス getter どうしの循環参照。 */
  getterCycle(cycle: string): string;
  /** `$updatedCallback` が未バインドのパスを判定に使っている（その分岐は走らない）。 */
  updatedCallbackUnbound(path: string): string;
  /** getter の中でパス読み取りの先の素のプロパティアクセス（追跡されるのは root だけ）。 */
  getterUntrackedRead(root: string, suggestedPath: string): string;
  handlerFilterNotAllowed(property: string): string;
  typeExpectation(label: string, expected: ExpectedTypeKind, resultType: string): string;
  filterUnknown(name: string): string;
  filterMinArgs(name: string, minArgs: number, argCount: number): string;
  filterMaxArgs(name: string, maxArgs: number, argCount: number): string;
  filterArgType(name: string, argPosition: number, expectedType: string, argText: string, actualType: string): string;
  filterInputType(name: string, acceptTypes: string, currentType: string): string;
  wcsTextInfo(expression: string): string;
  moustacheFouc(expression: string): string;
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
  /** `$scan` の値がオブジェクトでないと静的に断定できる（ランタイムは読み込み時に throw）。 */
  scanNotObject(): string;
  scanOutputInvalid(name: string): string;
  scanOutputReserved(name: string): string;
  scanOutputEmpty(): string;
  /** ボリューム（`mount=`）の `$scan`（runtime は接ぎ木の前に raise）。 */
  scanInVolume(mountPath: string): string;
  /** マウントされたコンポーネント（`bind-component`）の `$scan`（runtime は warn して捨てる）。 */
  scanInMountedComponent(): string;
  scanOutputConflict(name: string, other: 'getter' | 'stream' | 'method'): string;
  scanEntryNotObject(name: string): string;
  scanSourceCount(name: string): string;
  scanFromNotString(name: string): string;
  scanOnNotString(name: string): string;
  scanResetNotString(name: string): string;
  scanOutputCycle(chain: readonly string[]): string;
  scanInitialMissing(name: string): string;
  scanFoldNotFunction(name: string): string;
  scanOnUndeclared(name: string, token: string): string;
  scanPathInvalid(name: string, field: 'from' | 'resetOn', path: string): string;
  scanPathReserved(name: string, field: 'from' | 'resetOn', path: string): string;
  scanFromSelf(name: string, path: string): string;
  scanResetNotArray(name: string): string;
  scanResetWildcard(name: string, path: string): string;
  scanResetIsFrom(name: string, path: string): string;
  scanResetUnderFrom(name: string, path: string, from: string): string;
  scanResetReadsOutput(name: string, path: string, output: string): string;
  scanSourceComputed(name: string, field: 'from' | 'resetOn', path: string, getter: string): string;
  scanFromWriteOnly(name: string, path: string, setter: string): string;
  scanPathMissing(name: string, field: 'from' | 'resetOn', path: string): string;
  // --- arrayMutationValidator ---
  arrayMutation(method: string, alternative: string): string;
  arrayIndexAssign(suggestedPath: string): string;
  // --- ioNodeValidator ---
  tagMemberUnknown(property: string, tag: string): string;
  onPrefixedMember(member: string, tag: string): string;
  tagCommandUnknown(name: string, tag: string, declared: string): string;
  spreadNoBindable(tag: string): string;
  tagEventTokenKeyUnknown(name: string, tag: string, declared: string): string;
  /** `attr.aria-*` の属性名が WAI-ARIA に存在しない（ariaValidator）。 */
  ariaAttrUnknown(name: string): string;
  /** 最近傍候補の「もしかして」suffix。 */
  didYouMean(candidate: string): string;
  /** 宣言済みメンバーが空のときの placeholder。 */
  none(): string;
  triggerSeededTruthy(path: string): string;
  storageSeedClobber(path: string, rawInitial: string): string;
  // --- documentEnvValidator ---
  devtoolsAfterState(): string;
  baseHrefMissing(): string;
  signalsDualEntry(): string;
  // --- namedStateValidator（deprecation） ---
  /** `<wcs-state name="x">` は v2 で `mount="x"` に置き換わる。 */
  namedStateAttrDeprecated(name: string): string;
  /** `path@name` は v2 で `name.path` に置き換わる（`@default` は単に外す）。 */
  namedStatePathDeprecated(name: string): string;
  // --- mountAttrValidator ---
  /** `mount` 属性値が runtime の validateVolumeMountPath で raise する形（同条件・同文言）。 */
  mountPathInvalid(problem: MountPathProblem, mountPath: string): string;
  // --- recursionValidator（$recursion / `**`） ---
  /**
   * `**` を解釈しない場所に `**` がある（`data-wcs` / mustache / `$watch` キー /
   * `$listKeys` キー / `$resolve` / `$postUpdate` / `$trackDependency` / 代入）、
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
  /** ボリューム（`mount=`）の state が `$recursion` / `**` getter を宣言している（runtime は接ぎ木前に raise）。 */
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
  /** マウントされたコンポーネント（`bind-component`）の `$recursion` / `**` getter（runtime は warn して実行しない）。 */
  recursionInMountedComponent(subject: string): string;
}

/** `mount` 属性値の不正の種類（runtime の validateVolumeMountPath の raise と 1:1）。 */
export type MountPathProblem = 'empty' | 'emptySegment' | 'wildcard' | 'reserved';

/** `**` が現れた場所（`**` を解釈しない消費者）。 */
export type RecursionWildcardSite =
  | 'binding' | 'watch' | 'resolve' | 'undeclared'
  | 'assignment' | 'postUpdate' | 'trackDependency' | 'listKeys' | 'scan';
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
  streamPathMissing: (p) => `パス "${p}" は $streams 宣言に存在しません`,
  pathMissing: (p) => `パス "${p}" は状態定義に存在しません`,
  pathNonexistent: (p) => `パス "${p}" は宣言された stateSchema に存在しません`,
  pathTypeMismatch: (p, label, expected, actual) =>
    `パス "${p}" は stateSchema 上で ${actual} 型ですが、${label} には${JA_EXPECTED_LABEL[expected]}が必要です`,
  expansionSuffix: (x) => `（展開: ${x}）`,
  patternPathOutsideFor: (p) => `パターンパス "${p}" は <template for> の外側では使用できません`,
  omittedPathOutsideFor: (p) => `省略パス "${p}" は <template for> の外側では使用できません`,
  loopIndexOutsideFor: (p) => `ループインデックス "${p}" は <template for> の外側では使用できません`,
  resolvedPathInUi: (p) => `解決済みパス "${p}" は UI バインディングでは使用できません。パターンパスを使用してください`,
  indexArity: (api, p, req, wc, actual) =>
    `${api}("${p}") の添字は${req === "exact" ? `ちょうど ${wc} 個` : `${wc} 個以下`}である必要があります（パス中の "*" は ${wc} 個）。${actual} 個指定されています`,
  wildcardRank: (subject, needed, available) =>
    `${subject} は ${needed} 段のループが必要ですが、現在のスコープは ${available} 段です`,
  getterCycle: (cycle) => `パス getter が循環参照しています: ${cycle}`,
  updatedCallbackUnbound: (p) =>
    `$updatedCallback は binding 駆動です。"${p}" はこのドキュメントのどのバインディングにも現れないため、この分岐は一度も実行されません。描画に依存せず反応するなら $watch を使ってください`,
  getterUntrackedRead: (root, sp) =>
    `ここで追跡されるのは "${root}" だけです。"${sp}" が変わってもこの getter は再評価されません（パス読み取りの先の素のプロパティアクセスは追跡されない）。this["${sp}"] で読んでください`,
  handlerFilterNotAllowed: (prop) => `イベントハンドラ "${prop}" にフィルタは使用できません`,
  typeExpectation: (label, expected, resultType) =>
    `"${label}" には${JA_EXPECTED_LABEL[expected]}が必要です（現在の型: ${resultType}）`,
  filterUnknown: (n) => `フィルタ "${n}" は組み込みフィルタに存在しません`,
  filterMinArgs: (n, min, c) => `フィルタ "${n}" には最低 ${min} 個の引数が必要です（${c} 個指定）`,
  filterMaxArgs: (n, max, c) => `フィルタ "${n}" の引数は最大 ${max} 個です（${c} 個指定）`,
  filterArgType: (n, i, exp, arg, act) => `フィルタ "${n}" の第${i}引数は ${exp} 型が必要です（"${arg}" は ${act} 型）`,
  filterInputType: (n, accepts, cur) => `フィルタ "${n}" は ${accepts} 型の入力が必要です（現在の型: ${cur}）`,
  wcsTextInfo: (e) => `wcs-text バインディング: ${e}`,
  moustacheFouc: (e) =>
    `<template> 外の {{ }} 構文は FOUC（初期表示時にテンプレート文字列が見える）の原因になります。<!--@@:${e}--> またはコメント構文の使用を検討してください。`,
  nestedAssign: (sp) => `ネストされたプロパティへの代入はリアクティブ更新をトリガーしません。this["${sp}"] を使用してください。`,
  watchNotObject: () => `$watch は「パス → ハンドラ関数」のオブジェクトである必要があります（この形はランタイムが読み込み時に throw します）`,
  watchKeyCrossState: (k) => `$watch のキー "${k}" は他の state を指しています。@ 付きの越境 watch は使えません（自 state のパスのみ）`,
  watchKeyReserved: (k) => `$watch のキー "${k}" は "$" で始められません（予約名前空間）`,
  watchKeyEmptySegment: (k) => `$watch のキー "${k}" に空のパスセグメントがあります`,
  watchHandlerNotFunction: (k) => `$watch のエントリ "${k}" の値は関数である必要があります`,
  watchPathMissing: (k) => `$watch のキー "${k}" は状態定義に存在しません（一度も発火しません）`,
  scanNotObject: () => `$scan は「出力名 → { from | on, initial, fold, resetOn? }」のオブジェクトである必要があります（この形はランタイムが読み込み時に throw します）`,
  scanOutputInvalid: (n) => `$scan の出力名 "${n}" は平坦なプロパティ名である必要があります（"."・"*"・先頭の "$" は使えません）`,
  scanOutputReserved: (n) => `$scan の出力名 "${n}" は Object.prototype から継承される名前です（"constructor" など）`,
  scanOutputEmpty: () => `$scan の出力名は空でない文字列である必要があります`,
  scanInVolume: (mountPath) => `$scan はボリューム（mount="${mountPath}"）では宣言できません（ランタイムは接ぎ木の前に throw します）。scan はルートの state に宣言してください`,
  scanInMountedComponent: () => `$scan はマウントされたコンポーネント（bind-component）では実行されません（ランタイムは wcs/mount-dollar-declaration で警告し、黙って捨てます）。scan はルートの state に宣言してください`,
  scanOutputConflict: (n, other) => other === 'getter'
    ? `$scan の出力名 "${n}" は同名の getter / setter と衝突しています（出力はランタイムが所有するプロパティです）`
    : other === 'method'
      ? `$scan の出力名 "${n}" は同名のメソッドと衝突しています（出力はランタイムが所有するプロパティで、畳んだ値がメソッドを上書きします）`
      : `$scan の出力名 "${n}" は同名の $streams エントリと衝突しています（出力の持ち主は 1 つだけです）`,
  scanEntryNotObject: (n) => `$scan のエントリ "${n}" は { from | on, initial, fold, resetOn? } のオブジェクトである必要があります`,
  scanSourceCount: (n) => `$scan のエントリ "${n}" には "from"（state パス）か "on"（イベントトークン名）のどちらか 1 つだけを書きます`,
  scanFromNotString: (n) => `$scan のエントリ "${n}" の "from" は空でない state パスの文字列である必要があります`,
  scanOnNotString: (n) => `$scan のエントリ "${n}" の "on" は空でないイベントトークン名である必要があります`,
  scanResetNotString: (n) => `$scan のエントリ "${n}" の "resetOn" には state パスの文字列だけを書きます`,
  scanOutputCycle: (chain) => `$scan のエントリ ${chain.map(c => `"${c}"`).join(' → ')} は from を通じて互いを畳み合っています（互いの書き込みで永久に畳み続けます）`,
  scanInitialMissing: (n) => `$scan のエントリ "${n}" に "initial" がありません（累積の種であり、resetOn の戻り先です）`,
  scanFoldNotFunction: (n) => `$scan のエントリ "${n}" の "fold" は関数である必要があります`,
  scanOnUndeclared: (n, t) => `$scan のエントリ "${n}" の on "${t}" は $eventTokens に宣言されていません`,
  scanPathInvalid: (n, f, p) => `$scan のエントリ "${n}" の ${f} "${p}" は state パスとして成立しません（先頭の "$"・"@"・空のセグメントは使えません）`,
  scanPathReserved: (n, f, p) => `$scan のエントリ "${n}" の ${f} "${p}" は Object.prototype から継承される名前です（"constructor" など）`,
  scanFromSelf: (n, p) => `$scan のエントリ "${n}" の from "${p}" は自分の出力を読んでいます（自分の書き込みを永久に畳み続けます）`,
  scanResetNotArray: (n) => `$scan のエントリ "${n}" の "resetOn" は state パスの配列である必要があります`,
  scanResetWildcard: (n, p) => `$scan のエントリ "${n}" の resetOn "${p}" に "*" は使えません（reset は出力全体を initial に戻します）`,
  scanResetIsFrom: (n, p) => `$scan のエントリ "${n}" の resetOn "${p}" は自分の from と同じです（変化のたびに畳まずに reset します）`,
  scanResetUnderFrom: (n, p, from) => `$scan のエントリ "${n}" の resetOn "${p}" は自分の from "${from}" の配下です（from を書くたびに同じバッチに載り、reset が毎回勝って一度も畳まれません）`,
  scanResetReadsOutput: (n, p, o) => `$scan のエントリ "${n}" の resetOn "${p}" は $scan の出力 "${o}" を読んでいます（累積で累積を消すフィードバックになります）。素の入力で reset してください`,
  scanSourceComputed: (n, f, p, g) => `$scan のエントリ "${n}" の ${f} "${p}" は${g === p ? ' getter' : g.includes('**') ? `再帰 getter "${g}" が計算するパス` : ` getter "${g}" の配下`}です。getter は入力が変わるたびに再評価されるので、畳むと出来事ではなく再評価の回数を数えます。getter が読む素の値を指すか、on でイベントを受けてください`,
  scanFromWriteOnly: (n, p, s) => `$scan のエントリ "${n}" の from "${p}" は${s === p ? ' getter の無い setter' : ` getter の無い setter "${s}" の配下`}です。読むと常に undefined なので、fold は毎回 undefined を受け取ります。setter が書く素の値を指すか、on でイベントを受けてください`,
  scanPathMissing: (n, f, p) => `$scan のエントリ "${n}" の ${f} "${p}" は状態定義に存在しません（${f === 'from' ? '一度も畳まれません' : '一度も reset されません'}）`,
  typeAnnotationIncompatible: (vt, rt) => `型 "${vt}" は @type {${rt}} と互換性がありません`,
  arrayMutation: (m, alt) =>
    `配列の破壊的メソッド "${m}" はリアクティブ更新をトリガーしません（同一参照の自己再代入でも要素の追加・削除は反映されません）。非破壊メソッドと再代入を使用してください（例: ${alt}）。`,
  arrayIndexAssign: (sp) =>
    `配列インデックスへの直接代入はリアクティブ更新をトリガーしません。this["${sp}"] のようなドットパス代入、または with() と再代入を使用してください。`,
  tagMemberUnknown: (prop, tag) =>
    `"${prop}" は <${tag}> の wcBindable メンバーではありません（未知メンバーへのバインドは黙って無視されます）`,
  onPrefixedMember: (member, tag) =>
    `"${member}" は <${tag}> のメンバーですが、"on" で始まる名前はイベント束縛になり（"${member.slice(2)}" イベントを待つ）、値は届きません。プロパティとして束縛するには ".${member}:" と書いてください（@wcstack/state 3.1）`,
  tagCommandUnknown: (name, tag, declared) =>
    `"${name}" は <${tag}> の command ではありません（宣言済み: ${declared}）`,
  spreadNoBindable: (tag) =>
    `'...'（spread）は <${tag}> に有効な wcBindable 宣言が必要です — このタグは宣言を持たないため、ランタイムはエラーを送出します`,
  tagEventTokenKeyUnknown: (name, tag, declared) =>
    `eventToken のキー "${name}" は <${tag}> の wcBindable プロパティではありません。生 DOM イベント名は発火しません — プロパティ名を指定してください（宣言済み: ${declared}）`,
  ariaAttrUnknown: (name) =>
    `"${name}" は WAI-ARIA の属性ではありません。setAttribute はそのまま書き込みますが、支援技術には黙って無視されます`,
  didYouMean: (c) => `。もしかして: "${c}"`,
  none: () => `なし`,
  triggerSeededTruthy: (path) =>
    `trigger バインド先 "${path}" が true でシードされています。trigger はエッジ検出なし（truthy 書き込みで即発火・manual もバイパス）のため、バインド時に即発火します。false でシードしてください`,
  storageSeedClobber: (path, raw) =>
    `<wcs-storage> の value バインド先 "${path}" が ${raw} でシードされています。初期書き戻しが保存値を上書きします — undefined でシード（\`${path}: undefined\`）するか manual を付けてください`,
  devtoolsAfterState: () =>
    `@wcstack/devtools/auto は @wcstack/state/auto より先に読み込んでください（後だと配線台帳がライブで captured されません）`,
  baseHrefMissing: () =>
    `@wcstack/router を使う SPA には <head> 内の <base href="/"> が必要です（無いとディープリンクで basename が誤導出されます）`,
  signalsDualEntry: () =>
    `@wcstack/signals と @wcstack/signals/dom が同一ページから import されています。CDN では各エントリが自己完結バンドルのためリアクティブコアが二重化し、境界で反応が壊れます — すべて /dom エントリから import してください`,
  namedStateAttrDeprecated: (name) =>
    `name 属性は v2 で撤去されました（1 root 1 ツリー）。ルートツリーへのマウント <wcs-state mount="${name}"> に置き換え、パスは "${name}.<path>" で参照してください（docs/state-mount-design.md §9）`,
  namedStatePathDeprecated: (name) =>
    name === 'default'
      ? `"@default" セレクタは v2 で撤去されました。"@default" を外してください（docs/state-mount-design.md §9）`
      : `"@name" セレクタは v2 で撤去されました（1 root 1 ツリー）。マウントしたツリーを "${name}.<path>" で参照してください（docs/state-mount-design.md §9）`,
  mountPathInvalid: (problem, mountPath) => {
    switch (problem) {
      case 'empty': return `"mount" には空でないツリーパスが必要です（runtime: "mount" requires a non-empty tree path.）`;
      case 'emptySegment': return `"mount" パス "${mountPath}" に空のセグメントがあります（runtime: has an empty segment.）`;
      case 'wildcard': return `"mount" パス "${mountPath}" は静的でなければなりません — ワイルドカードは使えません（runtime: must be static.）`;
      default: return `"mount" パス "${mountPath}" に予約文字（$, #, @）は使えません（runtime: must not use reserved characters.）`;
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
      case 'assignment':
        return `this["${p}"] への代入に "**" は使えません（再帰 setter は初版では持てず、代入は展開後の具体パスにしか成立しません）。$setAll("${p}", [], value) で全深さへブロードキャストするか、具体パスへ書いてください`;
      case 'postUpdate':
        return `$postUpdate("${p}") に "**" は渡せません。通知は展開後の具体パス（固定本数の "*"）に対してのみ成立します`;
      case 'trackDependency':
        return `$trackDependency("${p}") に "**" は渡せません。依存の登録は展開後の具体パス（固定本数の "*"）に対してのみ成立します`;
      case 'listKeys':
        return `$listKeys のキー "${p}" に "**" は使えません。キー付きリストは 1 本の具体リストパスです — 深さごとに宣言してください（例: "nodes.*.children"）`;
      case 'scan':
        return `$scan のパス "${p}" に "**" は使えません。from / resetOn は具体パス（固定本数の "*"）を指します`;
      default:
        return `"${p}" は "**" を含みますが、この state には $recursion 宣言がありません。$recursion = { "<anchor>": "<repeat>" }（例: { "nodes.*": "children.*" }）を宣言してください（宣言が無いと "**" のキーは黙って無視されます）`;
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
    `${subject} はボリューム（mount="${mountPath}"）では宣言できません（ランタイムは接ぎ木の前に throw します）。再帰の宣言と "**" getter はルートの state に置いてください — アンカーのパスはルートの木に対して解決されます`,
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
  recursionInMountedComponent: (subject) =>
    `${subject} はマウントされたコンポーネント（bind-component）では実行されません（ランタイムは wcs/mount-dollar-declaration で警告し、黙って捨てます）。$recursion と "**" getter はルートの state に置いてください — アンカーのパスはルートの木に対して解決されます`,
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
  streamPathMissing: (p) => `Path "${p}" does not exist in the $streams declaration`,
  pathMissing: (p) => `Path "${p}" does not exist in the state definition`,
  pathNonexistent: (p) => `Path "${p}" does not exist in the declared stateSchema`,
  pathTypeMismatch: (p, label, expected, actual) =>
    `Path "${p}" is ${actual} in the stateSchema, but ${label} requires ${expected === 'array' ? 'an array' : expected === 'boolean' ? 'a boolean' : 'a string'}`,
  expansionSuffix: (x) => ` (expanded: ${x})`,
  patternPathOutsideFor: (p) => `Pattern path "${p}" cannot be used outside a <template for>`,
  omittedPathOutsideFor: (p) => `Shorthand path "${p}" cannot be used outside a <template for>`,
  loopIndexOutsideFor: (p) => `Loop index "${p}" cannot be used outside a <template for>`,
  resolvedPathInUi: (p) => `Resolved path "${p}" cannot be used in a UI binding. Use a pattern path instead`,
  indexArity: (api, p, req, wc, actual) =>
    `${api}("${p}") requires ${req === "exact" ? "exactly" : "at most"} ${wc} index(es) ("*" appears ${wc} time(s) in the path) but got ${actual}`,
  wildcardRank: (subject, needed, available) =>
    `${subject} needs ${needed} enclosing loop level(s) but the current scope provides ${available}`,
  getterCycle: (cycle) => `Path getters form a dependency cycle: ${cycle}`,
  updatedCallbackUnbound: (p) =>
    `$updatedCallback is binding-driven. "${p}" is not bound anywhere in this document, so this branch never runs. Use $watch to react without depending on what is rendered`,
  getterUntrackedRead: (root, sp) =>
    `Only "${root}" is tracked here: the getter is not re-evaluated when "${sp}" changes (plain property access after a path read is not tracked). Read this["${sp}"] instead`,
  handlerFilterNotAllowed: (prop) => `Filters cannot be applied to event handler "${prop}"`,
  typeExpectation: (label, expected, resultType) =>
    `"${label}" requires ${EN_EXPECTED_LABEL[expected]} (current type: ${resultType})`,
  filterUnknown: (n) => `Filter "${n}" is not a built-in filter`,
  filterMinArgs: (n, min, c) => `Filter "${n}" requires at least ${min} argument(s) (${c} given)`,
  filterMaxArgs: (n, max, c) => `Filter "${n}" accepts at most ${max} argument(s) (${c} given)`,
  filterArgType: (n, i, exp, arg, act) => `Argument ${i} of filter "${n}" must be of type ${exp} ("${arg}" is ${act})`,
  filterInputType: (n, accepts, cur) => `Filter "${n}" requires input of type ${accepts} (current type: ${cur})`,
  wcsTextInfo: (e) => `wcs-text binding: ${e}`,
  moustacheFouc: (e) =>
    `{{ }} outside a <template> causes FOUC (the raw template string is visible before binding). Consider the comment syntax <!--@@:${e}--> instead.`,
  nestedAssign: (sp) => `Assigning to a nested property does not trigger a reactive update. Use this["${sp}"] instead.`,
  watchNotObject: () => `$watch must be an object mapping state paths to handler functions (the runtime throws on this shape at load time)`,
  watchKeyCrossState: (k) => `$watch key "${k}" targets another state. Cross-state watching with @ is not supported (own paths only)`,
  watchKeyReserved: (k) => `$watch key "${k}" must not start with "$" (reserved namespace)`,
  watchKeyEmptySegment: (k) => `$watch key "${k}" has an empty path segment`,
  watchHandlerNotFunction: (k) => `The value of $watch entry "${k}" must be a function`,
  watchPathMissing: (k) => `$watch key "${k}" does not exist in the state definition (it will never fire)`,
  scanNotObject: () => `$scan must be an object mapping output names to { from | on, initial, fold, resetOn? } (the runtime throws on this shape at load time)`,
  scanOutputInvalid: (n) => `$scan output name "${n}" must be a flat property name ("." and "*" and a leading "$" are not allowed)`,
  scanOutputReserved: (n) => `$scan output name "${n}" is a property name inherited from Object.prototype (e.g. "constructor")`,
  scanOutputEmpty: () => `$scan output name must be a non-empty string`,
  scanInVolume: (mountPath) => `$scan cannot be declared in a volume (mount="${mountPath}"); the runtime throws before grafting. Declare the scan on the root state`,
  scanInMountedComponent: () => `$scan is not run by a mounted component (bind-component); the runtime warns with wcs/mount-dollar-declaration and drops it. Declare the scan on the root state`,
  scanOutputConflict: (n, other) => other === 'getter'
    ? `$scan output "${n}" conflicts with a getter or setter of the same name (the output is a property the runtime owns)`
    : other === 'method'
      ? `$scan output "${n}" conflicts with a method of the same name (the output is a property the runtime owns, so the folded value would overwrite the method)`
      : `$scan output "${n}" conflicts with the $streams entry of the same name (each output has exactly one owner)`,
  scanEntryNotObject: (n) => `$scan entry "${n}" must be an object { from | on, initial, fold, resetOn? }`,
  scanSourceCount: (n) => `$scan entry "${n}" must declare exactly one of "from" (a state path) or "on" (an event-token name)`,
  scanFromNotString: (n) => `$scan entry "${n}" "from" must be a non-empty state path string`,
  scanOnNotString: (n) => `$scan entry "${n}" "on" must be a non-empty event-token name`,
  scanResetNotString: (n) => `$scan entry "${n}" "resetOn" must contain only state path strings`,
  scanOutputCycle: (chain) => `$scan entries ${chain.map(c => `"${c}"`).join(' → ')} feed each other through "from" (each fold would re-trigger the next forever)`,
  scanInitialMissing: (n) => `$scan entry "${n}" requires "initial" (the seed of the accumulator and the value resetOn returns to)`,
  scanFoldNotFunction: (n) => `$scan entry "${n}" fold must be a function`,
  scanOnUndeclared: (n, t) => `$scan entry "${n}" on "${t}" is not declared in $eventTokens`,
  scanPathInvalid: (n, f, p) => `$scan entry "${n}" ${f} "${p}" is not a valid state path (a leading "$", "@" and empty segments are not allowed)`,
  scanPathReserved: (n, f, p) => `$scan entry "${n}" ${f} "${p}" is a property name inherited from Object.prototype (e.g. "constructor")`,
  scanFromSelf: (n, p) => `$scan entry "${n}" from "${p}" reads the entry's own output (it would fold its own writes forever)`,
  scanResetNotArray: (n) => `$scan entry "${n}" "resetOn" must be an array of state paths`,
  scanResetWildcard: (n, p) => `$scan entry "${n}" resetOn "${p}" must not contain "*" (a reset returns the whole output to initial)`,
  scanResetIsFrom: (n, p) => `$scan entry "${n}" resetOn "${p}" is the entry's own from (every change would reset instead of fold)`,
  scanResetUnderFrom: (n, p, from) => `$scan entry "${n}" resetOn "${p}" sits under the entry's own from "${from}" (every write of from also lands it, so the reset would win every time and nothing would fold)`,
  scanResetReadsOutput: (n, p, o) => `$scan entry "${n}" resetOn "${p}" reads the $scan output "${o}" (a reset driven by an accumulator is a feedback loop). Reset on the plain inputs instead`,
  scanSourceComputed: (n, f, p, g) => `$scan entry "${n}" ${f} "${p}" ${g === p ? 'is a getter' : g.includes('**') ? `is computed by the recursive getter "${g}"` : `is under the getter "${g}"`}. A getter re-evaluates whenever its inputs change, so folding it counts re-evaluations, not events. Point at the plain value the getter reads, or use "on" with an event token`,
  scanFromWriteOnly: (n, p, s) => `$scan entry "${n}" from "${p}" ${s === p ? 'is a setter without a getter' : `is under the setter without a getter "${s}"`}, so it always reads undefined and every fold would receive undefined. Point at the plain value the setter writes, or use "on" with an event token`,
  scanPathMissing: (n, f, p) => `$scan entry "${n}" ${f} "${p}" does not exist in the state definition (${f === 'from' ? 'it will never fold' : 'it will never reset'})`,
  typeAnnotationIncompatible: (vt, rt) => `Type "${vt}" is not compatible with @type {${rt}}`,
  arrayMutation: (m, alt) =>
    `Destructive array method "${m}" does not trigger a reactive update (re-assigning the same reference does not reflect added/removed elements either). Use a non-destructive method with reassignment (e.g. ${alt}).`,
  arrayIndexAssign: (sp) =>
    `Assigning directly to an array index does not trigger a reactive update. Use a dot-path assignment like this["${sp}"], or with() plus reassignment.`,
  tagMemberUnknown: (prop, tag) =>
    `"${prop}" is not a wcBindable member of <${tag}> (bindings to unknown members are silently ignored)`,
  onPrefixedMember: (member, tag) =>
    `"${member}" is a member of <${tag}>, but a name starting with "on" makes an event binding (it listens for a "${member.slice(2)}" event) and the value never arrives. Write ".${member}:" to bind the property (@wcstack/state 3.1)`,
  tagCommandUnknown: (name, tag, declared) =>
    `"${name}" is not a command of <${tag}> (declared: ${declared})`,
  spreadNoBindable: (tag) =>
    `'...' (spread) requires <${tag}> to expose a valid wcBindable declaration — this tag declares none, so the runtime raises an error`,
  tagEventTokenKeyUnknown: (name, tag, declared) =>
    `eventToken key "${name}" is not a wcBindable property of <${tag}>. Raw DOM event names never fire — use the property name (declared: ${declared})`,
  ariaAttrUnknown: (name) =>
    `"${name}" is not a WAI-ARIA attribute. setAttribute writes it anyway, and assistive technology silently ignores it`,
  didYouMean: (c) => `. Did you mean "${c}"?`,
  none: () => `none`,
  triggerSeededTruthy: (path) =>
    `The trigger-bound slot "${path}" is seeded with true. trigger has no edge detection (any truthy write fires, and it bypasses manual), so it fires immediately at bind. Seed it with false`,
  storageSeedClobber: (path, raw) =>
    `The <wcs-storage> value-bound slot "${path}" is seeded with ${raw}. The initial write-back overwrites the persisted value — seed it with undefined (\`${path}: undefined\`) or add manual`,
  devtoolsAfterState: () =>
    `Load @wcstack/devtools/auto BEFORE @wcstack/state/auto (otherwise the wiring ledger is not captured live)`,
  baseHrefMissing: () =>
    `An SPA using @wcstack/router needs <base href="/"> in <head> (without it, deep links misderive the basename)`,
  signalsDualEntry: () =>
    `Both @wcstack/signals and @wcstack/signals/dom are imported on this page. On a CDN each entry is a self-contained bundle, so the reactive core is duplicated and reactivity breaks at the seam — import everything from the single /dom entry`,
  namedStateAttrDeprecated: (name) =>
    `The "name" attribute was removed in v2 — there is a single state tree per root. Mount this state onto the tree instead: <wcs-state mount="${name}"> and read it as "${name}.<path>" (docs/state-mount-design.md §9)`,
  namedStatePathDeprecated: (name) =>
    name === 'default'
      ? `The "@default" selector was removed in v2 — drop it (docs/state-mount-design.md §9)`
      : `The "@name" selector was removed in v2 — there is a single state tree. Mount the named state onto the tree (<wcs-state mount="...">) and read it as "${name}.<path>" (docs/state-mount-design.md §9)`,
  mountPathInvalid: (problem, mountPath) => {
    // runtime（state/src/webComponent/volume.ts validateVolumeMountPath）と同文言
    switch (problem) {
      case 'empty': return `"mount" requires a non-empty tree path.`;
      case 'emptySegment': return `"mount" path "${mountPath}" has an empty segment.`;
      case 'wildcard': return `"mount" path "${mountPath}" must be static (wildcards are not allowed).`;
      default: return `"mount" path "${mountPath}" must not use reserved characters ($, #, @).`;
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
      case 'assignment':
        return `this["${p}"] = … cannot use "**" (there are no recursive setters in this version; an assignment only resolves against an expanded concrete path). Broadcast with $setAll("${p}", [], value), or write a concrete path`;
      case 'postUpdate':
        return `$postUpdate("${p}") cannot take "**" — a notification is defined against a concrete path (a fixed number of "*")`;
      case 'trackDependency':
        return `$trackDependency("${p}") cannot take "**" — a dependency is registered against a concrete path (a fixed number of "*")`;
      case 'listKeys':
        return `$listKeys key "${p}" cannot contain "**" — a keyed list is one concrete list path. Declare the key per depth instead (for example "nodes.*.children")`;
      case 'scan':
        return `$scan path "${p}" cannot contain "**" — "from" and "resetOn" name a concrete path (a fixed number of "*")`;
      default:
        return `"${p}" contains "**" but this state declares no $recursion anchor. Declare $recursion = { "<anchor>": "<repeat>" } (for example { "nodes.*": "children.*" }) — without it a "**" key is silently ignored`;
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
    `${subject} cannot be declared in a volume (mount="${mountPath}"); the runtime throws before grafting. Declare the recursion and its "**" getters on the root state — the anchor path is resolved against the root tree`,
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
  recursionInMountedComponent: (subject) =>
    `${subject} is not run by a mounted component (bind-component); the runtime warns with wcs/mount-dollar-declaration and drops it. Declare $recursion and "**" getters on the root state — the anchor path is resolved against the root tree`,
};

const CATALOGS: Record<WcsLocale, WcsMessageCatalog> = { ja, en };

/** locale 文字列からカタログを取得する（未指定は ja = 従来挙動）。 */
export function getMessages(locale?: string): WcsMessageCatalog {
  return CATALOGS[resolveLocale(locale)];
}
