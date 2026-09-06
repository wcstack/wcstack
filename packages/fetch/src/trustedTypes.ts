/**
 * Trusted Types (`require-trusted-types-for 'script'`) 対応。正本は docs/csp.md §7。
 *
 * `<wcs-fetch target="...">` の HTML 置換モードが innerHTML に流すのは **レスポンス**
 * ＝ TT がまさに止めたい値そのもの。ここに identity policy を噛ませて通すのは
 * 「TT 対応」ではなく「TT の無効化」なので、fetch は自前の policy を作らない。
 * Angular が DomSanitizer を必須にしているのと同じ立て付けで、利用側が sanitizer を
 * 持つ policy を注入したときだけ通す。
 *
 * 注入口は全 @wcstack パッケージ共通のグローバルスロット。buildless（CDN 一発）でも
 * inline script 1 本で差し込める:
 *
 * ```js
 * globalThis[Symbol.for("wcstack.trustedTypes.policy")] =
 *   trustedTypes.createPolicy("my-app", { createHTML: (s) => DOMPurify.sanitize(s) });
 * ```
 *
 * policy があるときは TT 非対応ブラウザでも通す。sanitizer が Chromium でだけ効いて
 * Firefox では素通し、という差が出るほうが危ないため。
 */

export interface IWcsTrustedTypesPolicy {
  createHTML?(input: string): unknown;
  createScriptURL?(input: string): unknown;
}

/** 利用側が policy を差し込むグローバルスロット（全 @wcstack パッケージ共通）。 */
export const TRUSTED_TYPES_POLICY_SLOT = Symbol.for("wcstack.trustedTypes.policy");

type SymbolSlotHolder = { [key: symbol]: unknown };

/** 利用側が注入した policy。fetch は identity policy にフォールバックしない。 */
export function getTrustedTypesPolicy(): IWcsTrustedTypesPolicy | null {
  const value = (globalThis as SymbolSlotHolder)[TRUSTED_TYPES_POLICY_SLOT];
  if (value === null || typeof value !== "object") return null;
  return value as IWcsTrustedTypesPolicy;
}

/** 利用側 policy を設定する（`null` で解除）。 */
export function setTrustedTypesPolicy(policy: IWcsTrustedTypesPolicy | null): void {
  (globalThis as SymbolSlotHolder)[TRUSTED_TYPES_POLICY_SLOT] = policy;
}

/**
 * レスポンスを利用側 policy に通す。policy が無ければ素通し＝ TT 有効下では
 * ブラウザが弾く（意図どおり）。
 */
export function trustHtmlValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const policy = getTrustedTypesPolicy();
  const createHTML = policy?.createHTML;
  if (typeof createHTML !== "function") return value;
  return createHTML.call(policy, value);
}

let _enforced: boolean | undefined = undefined;
let _reported = false;

/** テスト用: 実測キャッシュと一度きりの診断をリセットする。 */
export function _resetTrustedTypesDiagnostics(): void {
  _enforced = undefined;
  _reported = false;
}

/**
 * TT が実際に強制されているかを実測する。エラーメッセージの文言に依存しないよう、
 * 使い捨ての要素へ実際に書いて確かめる。`default` policy がある場合は書き込みが
 * 通る＝我々の書き込みも通るので、正しく false になる。
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

// 呼び出し元（writeTargetHTML）が isTrustedTypesEnforced() を確認してから呼ぶ。
function reportTrustedTypesBlock(): void {
  if (_reported) return;
  _reported = true;
  const hasPolicy = typeof getTrustedTypesPolicy()?.createHTML === "function";
  const cause = hasPolicy
    ? "The injected policy's createHTML() did not return a TrustedHTML."
    : "No sanitizing policy is installed, and @wcstack/fetch deliberately does not pass "
      + "responses through an identity policy — that would defeat the CSP.";
  console.error(
    `[@wcstack/fetch] The "target" HTML replace mode was blocked by Trusted Types `
    + `(require-trusted-types-for 'script'). ${cause}\n`
    + `Install a sanitizing policy before the first fetch:\n`
    + `  globalThis[Symbol.for("wcstack.trustedTypes.policy")] =\n`
    + `    trustedTypes.createPolicy("my-app", { createHTML: (s) => DOMPurify.sanitize(s) });\n`
    + `Or drop "target" and bind the response through @wcstack/state. See docs/csp.md section 7.`,
  );
}

/**
 * HTML 置換モードの書き込み。
 *
 * TT に弾かれたときは直し方を 1 度だけ報告して**投げ返さない**（never-throw §3.6）。
 * 自動 fetch 経路（connect / url 変更 / trigger）は `fetch()` の rejection を受け取る先が
 * 無く、投げ返すと未処理 rejection として page error になる — 実 Chromium の e2e で
 * 確認した。報告が信号であり、黙って握り潰すのとは違う。TT 以外の失敗（innerHTML の
 * setter が別の理由で throw した等）は従来どおり呼び出し元へ投げ返す。
 */
export function writeTargetHTML(element: Element, html: unknown): void {
  try {
    element.innerHTML = trustHtmlValue(html) as string;
  } catch (error) {
    if (isTrustedTypesEnforced()) {
      reportTrustedTypesBlock();
      return;
    }
    throw error;
  }
}
