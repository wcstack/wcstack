/**
 * Trusted Types (`require-trusted-types-for 'script'`) 対応。正本は docs/csp.md §7。
 *
 * state が HTML sink に流すのは **状態の値**（`innerHTML: path` などのプロパティ
 * バインド）で、ユーザー入力が混ざり得る文字列そのもの。ここに identity policy を
 * 噛ませて通すのは TT の無効化と同義なので、state は自前の policy を作らない。
 * 利用側が sanitizer を持つ policy を注入したときだけ通し、無ければ従来どおり
 * ブラウザに弾かせる（ただし何を設定すれば直るかは必ず言う）。
 *
 * 注入口は全 @wcstack パッケージ共通のグローバルスロット。buildless（CDN 一発）でも
 * inline script 1 本で差し込める:
 *
 * ```js
 * globalThis[Symbol.for("wcstack.trustedTypes.policy")] =
 *   trustedTypes.createPolicy("my-app", { createHTML: (s) => DOMPurify.sanitize(s) });
 * ```
 *
 * バンドラ経由なら `setTrustedTypesPolicy()` を使う。値は毎回スロットから読むので
 * 後から差し替えても効く（identity policy を作る router / worker 側だけは
 * `createPolicy` の重複を避けるため生成結果をシングルトンで保持する）。
 */

export interface IWcsTrustedTypesPolicy {
  createHTML?(input: string): unknown;
  createScriptURL?(input: string): unknown;
}

/** 利用側が policy を差し込むグローバルスロット（全 @wcstack パッケージ共通）。 */
export const TRUSTED_TYPES_POLICY_SLOT = Symbol.for("wcstack.trustedTypes.policy");

type SymbolSlotHolder = { [key: symbol]: unknown };

/**
 * 利用側が注入した policy を返す。state はここに identity policy をフォールバック
 * させない（それをやると TT を無効化することになる）。
 */
export function getTrustedTypesPolicy(): IWcsTrustedTypesPolicy | null {
  const value = (globalThis as SymbolSlotHolder)[TRUSTED_TYPES_POLICY_SLOT];
  if (value === null || typeof value !== "object") return null;
  return value as IWcsTrustedTypesPolicy;
}

/** 利用側 policy を設定する（`null` で解除）。最初のバインド適用前に呼ぶこと。 */
export function setTrustedTypesPolicy(policy: IWcsTrustedTypesPolicy | null): void {
  (globalThis as SymbolSlotHolder)[TRUSTED_TYPES_POLICY_SLOT] = policy;
}

/**
 * TrustedHTML が要求されるプロパティか。`textContent` などの安全な sink は含めない。
 * ホットパス（全プロパティ書き込み）から呼ばれるので文字列比較だけで済ませる。
 */
export function isHtmlSinkProp(prop: string): boolean {
  return prop === "innerHTML" || prop === "outerHTML" || prop === "srcdoc";
}

/**
 * HTML sink へ書く値を利用側 policy に通す。policy が無ければ値をそのまま返す
 * ＝ TT 有効下ではブラウザが弾く（意図どおり）。policy がある場合は TT 非対応
 * ブラウザでも通す: sanitizer は Chromium だけで効いても意味がないため。
 */
export function trustHtmlValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const policy = getTrustedTypesPolicy();
  const createHTML = policy?.createHTML;
  if (typeof createHTML !== "function") return value;
  return createHTML.call(policy, value);
}

let _enforced: boolean | undefined = undefined;

/**
 * TT が実際に強制されているかを実測する。エラーメッセージの文言に依存しないよう、
 * 使い捨ての要素へ実際に書いて確かめる。`default` policy がある場合は書き込みが
 * 通る＝我々の書き込みも通るので、正しく false になる。
 *
 * cold path（書き込みが失敗した後）でしか呼ばれない。
 */
export function isTrustedTypesEnforced(): boolean {
  if (_enforced !== undefined) return _enforced;
  if (!("trustedTypes" in globalThis)) {
    _enforced = false;
    return _enforced;
  }
  try {
    document.createElement("div").innerHTML = "<i></i>";
    _enforced = false;
  } catch {
    _enforced = true;
  }
  return _enforced;
}

let _reported = false;

/** テスト用: 実測キャッシュと一度きりの診断をリセットする。 */
export function _resetTrustedTypesDiagnostics(): void {
  _enforced = undefined;
  _reported = false;
}

/**
 * HTML sink への書き込み失敗を診断する。applyChangeToProperty の catch は
 * `config.debug` 時しか warn しないため、TT が原因のときは黙って壊れていた。
 * 原因と直し方が分かる形で一度だけ報告する。
 */
export function reportTrustedTypesBlock(element: Element, prop: string): void {
  if (_reported) return;
  if (!isTrustedTypesEnforced()) return;
  _reported = true;
  const hasPolicy = typeof getTrustedTypesPolicy()?.createHTML === "function";
  const cause = hasPolicy
    ? "The injected policy's createHTML() did not return a TrustedHTML."
    : "No sanitizing policy is installed, and @wcstack/state deliberately does not "
      + "pass state values through an identity policy — that would defeat the CSP.";
  console.error(
    `[@wcstack/state] Writing to "${prop}" was blocked by Trusted Types `
    + `(require-trusted-types-for 'script'). ${cause}\n`
    + `Install a sanitizing policy before the first binding is applied:\n`
    + `  globalThis[Symbol.for("wcstack.trustedTypes.policy")] =\n`
    + `    trustedTypes.createPolicy("my-app", { createHTML: (s) => DOMPurify.sanitize(s) });\n`
    + `Or bind the value as text instead of HTML. See docs/csp.md section 7.`,
    { element, property: prop },
  );
}
