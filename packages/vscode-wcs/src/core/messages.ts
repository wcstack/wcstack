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

export interface WcsMessageCatalog {
  // --- bindingValidator / templateSyntaxValidator ---
  spreadFilterNotAllowed(): string;
  spreadTargetRequired(): string;
  eventTokenUndeclared(tokenName: string): string;
  commandRhsFormat(): string;
  commandTokenUndeclared(tokenPath: string): string;
  streamPathMissing(path: string): string;
  pathMissing(path: string): string;
  /** 省略パス展開の注記（pathMissing 等の末尾に連結）。 */
  expansionSuffix(expandedPath: string): string;
  patternPathOutsideFor(path: string): string;
  omittedPathOutsideFor(path: string): string;
  loopIndexOutsideFor(path: string): string;
  resolvedPathInUi(path: string): string;
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
  // --- arrayMutationValidator ---
  arrayMutation(method: string, alternative: string): string;
  arrayIndexAssign(suggestedPath: string): string;
  // --- ioNodeValidator ---
  tagMemberUnknown(property: string, tag: string): string;
  tagCommandUnknown(name: string, tag: string, declared: string): string;
  tagEventTokenKeyUnknown(name: string, tag: string, declared: string): string;
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
}

const JA_EXPECTED_LABEL: Record<ExpectedTypeKind, string> = {
  array: '配列型のパス',
  boolean: 'ブーリアン型',
  string: '文字列型',
};

const ja: WcsMessageCatalog = {
  spreadFilterNotAllowed: () => `スプレッドのターゲットにフィルタは使用できません`,
  spreadTargetRequired: () => `スプレッドにはターゲットパスが必要です`,
  eventTokenUndeclared: (t) => `イベントトークン "${t}" は $eventTokens に宣言されていません`,
  commandRhsFormat: () => `command バインディングの右辺には $command.<name>（$commandTokens で宣言）を指定してください`,
  commandTokenUndeclared: (t) => `コマンドトークン "${t}" は $commandTokens に宣言されていません`,
  streamPathMissing: (p) => `パス "${p}" は $streams 宣言に存在しません`,
  pathMissing: (p) => `パス "${p}" は状態定義に存在しません`,
  expansionSuffix: (x) => `（展開: ${x}）`,
  patternPathOutsideFor: (p) => `パターンパス "${p}" は <template for> の外側では使用できません`,
  omittedPathOutsideFor: (p) => `省略パス "${p}" は <template for> の外側では使用できません`,
  loopIndexOutsideFor: (p) => `ループインデックス "${p}" は <template for> の外側では使用できません`,
  resolvedPathInUi: (p) => `解決済みパス "${p}" は UI バインディングでは使用できません。パターンパスを使用してください`,
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
  typeAnnotationIncompatible: (vt, rt) => `型 "${vt}" は @type {${rt}} と互換性がありません`,
  arrayMutation: (m, alt) =>
    `配列の破壊的メソッド "${m}" はリアクティブ更新をトリガーしません（同一参照の自己再代入でも要素の追加・削除は反映されません）。非破壊メソッドと再代入を使用してください（例: ${alt}）。`,
  arrayIndexAssign: (sp) =>
    `配列インデックスへの直接代入はリアクティブ更新をトリガーしません。this["${sp}"] のようなドットパス代入、または with() と再代入を使用してください。`,
  tagMemberUnknown: (prop, tag) =>
    `"${prop}" は <${tag}> の wcBindable メンバーではありません（未知メンバーへのバインドは黙って無視されます）`,
  tagCommandUnknown: (name, tag, declared) =>
    `"${name}" は <${tag}> の command ではありません（宣言済み: ${declared}）`,
  tagEventTokenKeyUnknown: (name, tag, declared) =>
    `eventToken のキー "${name}" は <${tag}> の wcBindable プロパティではありません。生 DOM イベント名は発火しません — プロパティ名を指定してください（宣言済み: ${declared}）`,
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
};

const EN_EXPECTED_LABEL: Record<ExpectedTypeKind, string> = {
  array: 'an array-typed path',
  boolean: 'a boolean',
  string: 'a string',
};

const en: WcsMessageCatalog = {
  spreadFilterNotAllowed: () => `Filters cannot be applied to a spread target`,
  spreadTargetRequired: () => `Spread requires a target path`,
  eventTokenUndeclared: (t) => `Event token "${t}" is not declared in $eventTokens`,
  commandRhsFormat: () => `The right side of a command binding must be $command.<name> (declared in $commandTokens)`,
  commandTokenUndeclared: (t) => `Command token "${t}" is not declared in $commandTokens`,
  streamPathMissing: (p) => `Path "${p}" does not exist in the $streams declaration`,
  pathMissing: (p) => `Path "${p}" does not exist in the state definition`,
  expansionSuffix: (x) => ` (expanded: ${x})`,
  patternPathOutsideFor: (p) => `Pattern path "${p}" cannot be used outside a <template for>`,
  omittedPathOutsideFor: (p) => `Shorthand path "${p}" cannot be used outside a <template for>`,
  loopIndexOutsideFor: (p) => `Loop index "${p}" cannot be used outside a <template for>`,
  resolvedPathInUi: (p) => `Resolved path "${p}" cannot be used in a UI binding. Use a pattern path instead`,
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
  typeAnnotationIncompatible: (vt, rt) => `Type "${vt}" is not compatible with @type {${rt}}`,
  arrayMutation: (m, alt) =>
    `Destructive array method "${m}" does not trigger a reactive update (re-assigning the same reference does not reflect added/removed elements either). Use a non-destructive method with reassignment (e.g. ${alt}).`,
  arrayIndexAssign: (sp) =>
    `Assigning directly to an array index does not trigger a reactive update. Use a dot-path assignment like this["${sp}"], or with() plus reassignment.`,
  tagMemberUnknown: (prop, tag) =>
    `"${prop}" is not a wcBindable member of <${tag}> (bindings to unknown members are silently ignored)`,
  tagCommandUnknown: (name, tag, declared) =>
    `"${name}" is not a command of <${tag}> (declared: ${declared})`,
  tagEventTokenKeyUnknown: (name, tag, declared) =>
    `eventToken key "${name}" is not a wcBindable property of <${tag}>. Raw DOM event names never fire — use the property name (declared: ${declared})`,
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
};

const CATALOGS: Record<WcsLocale, WcsMessageCatalog> = { ja, en };

/** locale 文字列からカタログを取得する（未指定は ja = 従来挙動）。 */
export function getMessages(locale?: string): WcsMessageCatalog {
  return CATALOGS[resolveLocale(locale)];
}
