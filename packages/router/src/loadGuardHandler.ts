import { GuardHandler } from "./components/types.js";
import { IRoute } from "./components/types.js";
import { raiseError } from "./raiseError.js";

type ScriptModule = { default?: unknown };

const CSP_GUIDE = "https://github.com/wcstack/wcstack/blob/main/docs/csp.md";

/**
 * ガードスクリプトの評価失敗を、原因の分かるメッセージに変換する。
 *
 * CSP にブロックされた動的 import の rejection は CSP に一切言及しないため、
 * ブロックされた事実は securitypolicyviolation の観測（`cspBlocked`）でしか取れない。
 * 真ならブロック確定として対処方法を書き、偽なら構文エラー等と区別できないので
 * 元のエラーを主にして CSP は参照先を添えるに留める。
 *
 * ガードは state と違ってインライン専用（`<wcs-route>` 直下の `<script>`）なので、
 * `src=` に逃がすという回避策が無い。CSP を敷くなら blob: の許可が必須になる。
 */
function describeImportFailure(error: unknown, firstError: unknown, cspBlocked: boolean): string {
  if (cspBlocked) {
    return `The guard <script> was blocked by Content-Security-Policy. ` +
      `Guard scripts are inline-only and are evaluated through a blob: URL, ` +
      `so script-src must allow blob:. See ${CSP_GUIDE}`;
  }
  return `loadGuardHandler: failed to import guard script. ` +
    `data: URL error: ${(error as Error)?.message ?? String(error)}` +
    (firstError ? `. Blob URL error: ${(firstError as Error)?.message ?? String(firstError)}` : '') +
    `. If this page sets a Content-Security-Policy, see ${CSP_GUIDE}`;
}

async function importModule(script: HTMLScriptElement, route: IRoute): Promise<GuardHandler | null> {
  let scriptModule: ScriptModule | null = null;
  let firstError: unknown = null;
  // devtools での識別用 sourceURL suffix。
  // uuid を使う: Route インスタンスでは constructor で getUUID() により必ず設定される。
  // partial mock 等で undefined の可能性に備えて空文字列フォールバックを置く。
  const routeTag = route.uuid || "";
  const sourceURL = routeTag ? `wcs-guard-handler:${routeTag}` : `wcs-guard-handler`;
  const sourceComment = `\n//# sourceURL=${sourceURL}\n`;
  const scriptText = script.text + sourceComment;
  // import() の失敗が CSP 由来かを判別するため、評価の間だけ違反を購読する。
  // blob: と data: はどちらも script-src で拒否されるので、両分岐を1つの観測で覆える。
  let cspBlocked = false;
  const onViolation = (event: Event) => {
    if ((event as SecurityPolicyViolationEvent).effectiveDirective.startsWith("script-src")) {
      cspBlocked = true;
    }
  };
  document.addEventListener("securitypolicyviolation", onViolation);
  try {
    if (typeof URL.createObjectURL === 'function') {
      const blob = new Blob([scriptText], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      try {
        scriptModule = await import(url) as ScriptModule;
      } catch (e) {
        // Blob URL import failed (e.g. happy-dom), fall through to data: URL
        firstError = e;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (!scriptModule) {
      // Fallback: Base64 data: URL (for test environments)
      const b64 = btoa(String.fromCodePoint(...new TextEncoder().encode(scriptText)));
      try {
        scriptModule = await import(`data:application/javascript;base64,${b64}`) as ScriptModule;
      } catch (e) {
        // 両 import が失敗した場合、Blob URL 側の元エラーを cause として失わないように包む
        // （Blob URL も失敗していなければ firstError は null）
        raiseError(describeImportFailure(e, firstError, cspBlocked), { cause: firstError ?? e });
      }
    }
  } finally {
    document.removeEventListener("securitypolicyviolation", onViolation);
  }
  if (scriptModule && typeof scriptModule.default === 'function') {
    return scriptModule.default as GuardHandler;
  }
  return null;
}

export function loadGuardHandler(script: HTMLScriptElement, route: IRoute): void {
  importModule(script, route).then(handler => {
    if (handler) {
      route.guardHandler = handler;
    } else {
      // ハンドラが取得できなかった場合は guardCheck の待ちを解除する
      route.notifyGuardHandlerLoadFailed();
    }
  }).catch(err => {
    console.error('loadGuardHandler failed:', err);
    // import 失敗時も guardCheck の待ちを解除する
    route.notifyGuardHandlerLoadFailed();
  });
}
