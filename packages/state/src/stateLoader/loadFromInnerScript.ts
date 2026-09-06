import { IState } from "../types";

type ScriptModule = { default?: unknown };

const CSP_GUIDE = "https://github.com/wcstack/wcstack/blob/main/docs/csp.md";

/**
 * インライン `<script>` の評価失敗を、原因の分かるメッセージに変換する。
 *
 * CSP にブロックされた動的 import の rejection は
 * "Failed to fetch dynamically imported module" としか言わず、CSP には一切言及しない。
 * ブロックされた事実は securitypolicyviolation イベントでしか観測できないため、
 * その観測結果を `cspBlocked` で受け取る。
 *
 * 真ならブロック確定として対処方法まで書く。偽のときは構文エラー等と区別できないので、
 * 元のエラーを主にして CSP は参照先を添えるに留める（誤誘導を避ける）。
 */
function describeImportFailure(name: string, error: unknown, cspBlocked: boolean): string {
  const detail = (error as Error)?.message ?? String(error);
  if (cspBlocked) {
    return `The inline <script> of state "${name}" was blocked by Content-Security-Policy. ` +
      `Inline state is evaluated through a blob: URL, so script-src must allow blob:. ` +
      `Prefer moving the state into an external file and loading it with src="./state.js", ` +
      `which requires no extra CSP directive. See ${CSP_GUIDE}`;
  }
  return `Failed to evaluate the inline <script> of state "${name}": ${detail}. ` +
    `If this page sets a Content-Security-Policy, see ${CSP_GUIDE}`;
}

/**
 * ロードごとに増える通し番号。`data:` URL フォールバック（createObjectURL の無い
 * テスト / SSR 環境）では URL がスクリプト本文そのものなので、同じ本文を 2 度
 * 読み込むと ESM ローダーのキャッシュに当たり **同じモジュール = 同じ default export
 * オブジェクト** が返る — 2 つ目の `<wcs-state>` が 1 つ目の state を共有してしまう
 * （テストでは前のテストの書き込みが次のテストに漏れ、SSR では同一テンプレートの
 * 再描画で state が共有される）。blob: URL は生成のたびに一意なのでブラウザでは
 * 起きない。sourceURL コメントに番号を混ぜて本文を毎回変え、両経路を揃える。
 */
let loadSequence = 0;

export async function loadFromInnerScript(script: HTMLScriptElement, sourceLabel: string): Promise<IState> {
  let scriptModule: ScriptModule | null = null;
  const uniq_comment = `\n//# sourceURL=${sourceLabel}#${++loadSequence}\n`;
  // import() が失敗した理由が CSP かどうかを判別するために、評価の間だけ違反を購読する。
  let cspBlocked = false;
  const onViolation = (event: Event) => {
    if ((event as SecurityPolicyViolationEvent).effectiveDirective.startsWith("script-src")) {
      cspBlocked = true;
    }
  };
  document.addEventListener("securitypolicyviolation", onViolation);
  try {
    if (typeof URL.createObjectURL === 'function') {
      // Create a blob URL for the script and dynamically import it
      const blob = new Blob([script.text + uniq_comment], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      try {
        scriptModule = await import(url) as ScriptModule;
      } finally {
        // Clean up blob URL to prevent memory leak
        URL.revokeObjectURL(url);
      }
    } else {
      // Fallback: Base64 encoding method (for test environment)
      // Convert script to Base64 and import via data: URL
      const b64 = btoa(String.fromCodePoint(...new TextEncoder().encode(script.text + uniq_comment)));
      scriptModule = await import(`data:application/javascript;base64,${b64}`) as ScriptModule;
    }
  } catch (e) {
    // 呼び出し元（State._initialize / _initializeDCC）が raiseError で
    // `[@wcstack/state]` を付けるため、ここでは prefix を重ねない。
    throw new Error(describeImportFailure(sourceLabel, e, cspBlocked), { cause: e });
  } finally {
    document.removeEventListener("securitypolicyviolation", onViolation);
  }
  return (scriptModule && typeof scriptModule.default === 'object') ? scriptModule.default as IState : {};
}
