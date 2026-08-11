/**
 * Trusted Types (`require-trusted-types-for 'script'`) 対応。正本は docs/csp.md §7。
 *
 * router が HTML sink に流すのは `<wcs-layout>` のテンプレート、つまり **作者が書いた
 * マークアップ**（同一文書の `<template>` か `src` で取りに行くアプリの資産）であって、
 * ユーザー入力ではない。Lit がテンプレートリテラルにだけ policy を当てているのと同じ
 * 立て付けで、ここは identity policy で署名してよい層に当たる。
 *
 * policy 名は全 @wcstack パッケージで単一の `wcstack` に固定する。利用側の CSP に
 * 書く行を 1 本に固定できるほうが、パッケージごとに名前を分けて最小権限にするより
 * 導入摩擦が小さいため（署名対象がどれも作者制御の値なので、分割しても守るものが
 * 増えない）。生成結果はグローバルスロットで共有し、複数パッケージが同居しても
 * `createPolicy` は 1 回だけ走らせる — `trusted-types` ディレクティブがある場合、
 * `'allow-duplicates'` 無しの重複生成は例外になるため。
 *
 * 利用側が自前の policy を注入していればそちらを優先する:
 *
 * ```js
 * globalThis[Symbol.for("wcstack.trustedTypes.policy")] =
 *   trustedTypes.createPolicy("my-app", { createHTML: (s) => DOMPurify.sanitize(s) });
 * ```
 */

export interface IWcsTrustedTypesPolicy {
  createHTML?(input: string): unknown;
  createScriptURL?(input: string): unknown;
}

/** 利用側が policy を差し込むグローバルスロット（全 @wcstack パッケージ共通）。 */
export const TRUSTED_TYPES_POLICY_SLOT = Symbol.for("wcstack.trustedTypes.policy");

/** wcstack が生成した identity policy を共有するスロット（内部用）。 */
const INTERNAL_POLICY_SLOT = Symbol.for("wcstack.trustedTypes.internal");

const POLICY_NAME = "wcstack";

type SymbolSlotHolder = { [key: symbol]: unknown };

interface ITrustedTypesFactory {
  createPolicy(name: string, rules: {
    createHTML(input: string): string;
    createScriptURL(input: string): string;
  }): IWcsTrustedTypesPolicy;
}

/** 利用側が注入した policy。 */
export function getTrustedTypesPolicy(): IWcsTrustedTypesPolicy | null {
  const value = (globalThis as SymbolSlotHolder)[TRUSTED_TYPES_POLICY_SLOT];
  if (value === null || typeof value !== "object") return null;
  return value as IWcsTrustedTypesPolicy;
}

/** 利用側 policy を設定する（`null` で解除）。 */
export function setTrustedTypesPolicy(policy: IWcsTrustedTypesPolicy | null): void {
  (globalThis as SymbolSlotHolder)[TRUSTED_TYPES_POLICY_SLOT] = policy;
}

/** テスト用: 共有 identity policy のキャッシュを捨てる。 */
export function _resetInternalTrustedTypesPolicy(): void {
  delete (globalThis as SymbolSlotHolder)[INTERNAL_POLICY_SLOT];
}

/**
 * 作者制御の文字列に署名するための共有 identity policy。TT 非対応ブラウザでは
 * null（呼び出し側は生文字列のまま進む）。生成失敗も null をキャッシュして、
 * 診断は 1 度だけ出す。
 */
function getInternalPolicy(): IWcsTrustedTypesPolicy | null {
  const holder = globalThis as SymbolSlotHolder;
  const cached = holder[INTERNAL_POLICY_SLOT];
  if (cached !== undefined) return cached as IWcsTrustedTypesPolicy | null;

  const factory = (globalThis as { trustedTypes?: ITrustedTypesFactory }).trustedTypes;
  let policy: IWcsTrustedTypesPolicy | null = null;
  if (factory && typeof factory.createPolicy === "function") {
    try {
      policy = factory.createPolicy(POLICY_NAME, {
        createHTML: (input: string) => input,
        createScriptURL: (input: string) => input,
      });
    } catch (error) {
      console.error(
        `[@wcstack/router] Could not create the Trusted Types policy "${POLICY_NAME}". `
        + `Allow it in the CSP (\`trusted-types ${POLICY_NAME};\`), or inject your own policy `
        + `at globalThis[Symbol.for("wcstack.trustedTypes.policy")]. See docs/csp.md section 7.`,
        error,
      );
    }
  }
  holder[INTERNAL_POLICY_SLOT] = policy;
  return policy;
}

/**
 * 作者が書いたマークアップを TrustedHTML に変換する。利用側 policy > 共有 identity
 * policy > 生文字列（TT 非対応ブラウザ）の順で解決する。
 */
export function trustAuthoredHTML(html: string): string {
  const adopted = getTrustedTypesPolicy();
  const adoptedCreateHTML = adopted?.createHTML;
  if (typeof adoptedCreateHTML === "function") {
    return adoptedCreateHTML.call(adopted, html) as string;
  }
  const internal = getInternalPolicy();
  const internalCreateHTML = internal?.createHTML;
  if (typeof internalCreateHTML === "function") {
    return internalCreateHTML.call(internal, html) as string;
  }
  return html;
}
