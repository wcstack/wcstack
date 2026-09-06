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
 * **利用側が注入した policy はここでは優先しない。** 注入口は「信頼できない値に対する
 * sanitizer」として使われる想定で（fetch のレスポンス、state の値）、実際に案内している
 * 設定も DOMPurify である。作者が書いたレイアウトを sanitizer に通すと、既定でカスタム
 * 要素が除去されて `<wcs-link>` などがレイアウトから消える——例外も警告も無しに。
 * よってここは identity policy を優先し、**それを作れなかったときだけ**利用側 policy に
 * 落ちる（その場合は 1 度警告する）。
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
      // 利用側 policy に落ちられるなら、報告は初回使用時の 1 回の warn（trustAuthoredHTML）
      // に任せる — docs/csp.md §7 の「フォールバックと一度きりの warn」。error まで
      // 出すと、既に policy を注入した利用者へ「注入せよ」と言うことになる（実 Chromium の
      // e2e で確認）。落ちる先が無いときだけ、直し方付きで error にする
      if (typeof getTrustedTypesPolicy()?.createHTML !== "function") {
        console.error(
          `[@wcstack/router] Could not create the Trusted Types policy "${POLICY_NAME}". `
          + `Allow it in the CSP (\`trusted-types ${POLICY_NAME};\`), or inject your own policy `
          + `at globalThis[Symbol.for("wcstack.trustedTypes.policy")]. See docs/csp.md section 7.`,
          error,
        );
      }
    }
  }
  holder[INTERNAL_POLICY_SLOT] = policy;
  return policy;
}

let _fallbackWarned = false;

/** テスト用: フォールバック警告の一度きりフラグを戻す。 */
export function _resetAuthoredFallbackWarning(): void {
  _fallbackWarned = false;
}

/**
 * 作者が書いたマークアップを TrustedHTML に変換する。
 *
 * 解決順は 共有 identity policy > （TT はあるが identity policy を作れなかった場合のみ）
 * 利用側 policy > 生文字列。TT 非対応ブラウザでは署名自体が不要なので、利用側 policy が
 * 入っていても素通しする——作者のレイアウトを sanitizer に通す理由はどこにも無い。
 */
export function trustAuthoredHTML(html: string): string {
  const internal = getInternalPolicy();
  const internalCreateHTML = internal?.createHTML;
  if (typeof internalCreateHTML === "function") {
    return internalCreateHTML.call(internal, html) as string;
  }
  if (!("trustedTypes" in globalThis)) return html;

  const adopted = getTrustedTypesPolicy();
  const adoptedCreateHTML = adopted?.createHTML;
  if (typeof adoptedCreateHTML === "function") {
    if (!_fallbackWarned) {
      _fallbackWarned = true;
      console.warn(
        `[@wcstack/router] Falling back to the injected Trusted Types policy to expand a layout `
        + `template, because the "${POLICY_NAME}" policy could not be created. If that policy `
        + `sanitizes (e.g. DOMPurify), custom elements in the layout may be stripped. `
        + `Allow \`trusted-types ${POLICY_NAME};\` in the CSP to avoid this. See docs/csp.md section 7.`,
      );
    }
    return adoptedCreateHTML.call(adopted, html) as string;
  }
  return html;
}
