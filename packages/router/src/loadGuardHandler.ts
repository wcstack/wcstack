import { GuardHandler } from "./components/types.js";
import { IRoute } from "./components/types.js";

type ScriptModule = { default?: unknown };

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
      throw new Error(
        `loadGuardHandler: failed to import guard script. ` +
        `data: URL error: ${(e as Error)?.message ?? String(e)}` +
        (firstError ? `. Blob URL error: ${(firstError as Error)?.message ?? String(firstError)}` : ''),
        { cause: firstError ?? e }
      );
    }
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
