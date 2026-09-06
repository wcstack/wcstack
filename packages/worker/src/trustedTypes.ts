/**
 * Trusted Types (`require-trusted-types-for 'script'`) 対応。正本は docs/csp.md §7。
 *
 * `new Worker(url)` は TrustedScriptURL sink なので、TT 強制下では素の文字列を渡すと
 * 落ちる。ただしここに来る URL は `<wcs-worker src="...">`＝**作者が書いた属性値**で
 * あって、ユーザー入力でもレスポンスでもない。加えて worker のスクリプト取得元は
 * `worker-src` で別途縛られている。よってここは identity policy で署名してよい層。
 *
 * policy 名は全 @wcstack パッケージで単一の `wcstack` に固定し、生成結果をグローバル
 * スロットで共有する（`trusted-types` ディレクティブがある場合、`'allow-duplicates'`
 * 無しの重複生成は例外になるため）。
 *
 * **利用側が注入した policy はここでは優先しない。** 注入口は「信頼できない値に対する
 * sanitizer」として使われる想定なので、作者が書いた `src` をそこに通す理由が無い。
 * identity policy を作れなかったときだけフォールバックし、その場合は 1 度警告する。
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
      // 利用側 policy に落ちられるなら、報告は初回使用時の 1 回の warn（trustAuthoredScriptURL）
      // に任せる — docs/csp.md §7。落ちる先が無いときだけ、直し方付きで error にする
      if (typeof getTrustedTypesPolicy()?.createScriptURL !== "function") {
        console.error(
          `[@wcstack/worker] Could not create the Trusted Types policy "${POLICY_NAME}". `
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
 * 作者が書いたスクリプト URL を TrustedScriptURL に変換する。
 *
 * 解決順は 共有 identity policy > （TT はあるが identity policy を作れなかった場合のみ）
 * 利用側 policy > 生文字列。TT 非対応ブラウザでは署名自体が不要なので素通しする。
 */
export function trustAuthoredScriptURL(url: string): string {
  const internal = getInternalPolicy();
  const internalCreate = internal?.createScriptURL;
  if (typeof internalCreate === "function") {
    return internalCreate.call(internal, url) as string;
  }
  if (!("trustedTypes" in globalThis)) return url;

  const adopted = getTrustedTypesPolicy();
  const adoptedCreate = adopted?.createScriptURL;
  if (typeof adoptedCreate === "function") {
    if (!_fallbackWarned) {
      _fallbackWarned = true;
      console.warn(
        `[@wcstack/worker] Falling back to the injected Trusted Types policy to sign the worker `
        + `URL, because the "${POLICY_NAME}" policy could not be created. `
        + `Allow \`trusted-types ${POLICY_NAME};\` in the CSP to avoid this. See docs/csp.md section 7.`,
      );
    }
    return adoptedCreate.call(adopted, url) as string;
  }
  return url;
}
