import { GuardHandler } from "./components/types.js";
import { IRoute } from "./components/types.js";

type ScriptModule = { default?: unknown };

async function importModule(script: HTMLScriptElement): Promise<GuardHandler | null> {
  let scriptModule: ScriptModule | null = null;
  const sourceComment = `\n//# sourceURL=wcs-guard-handler\n`;
  const scriptText = script.text + sourceComment;
  if (typeof URL.createObjectURL === 'function') {
    const blob = new Blob([scriptText], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      scriptModule = await import(url) as ScriptModule;
    } catch {
      // Blob URL import failed (e.g. happy-dom), fall through to data: URL
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (!scriptModule) {
    // Fallback: Base64 data: URL (for test environments)
    const b64 = btoa(String.fromCodePoint(...new TextEncoder().encode(scriptText)));
    scriptModule = await import(`data:application/javascript;base64,${b64}`) as ScriptModule;
  }
  if (scriptModule && typeof scriptModule.default === 'function') {
    return scriptModule.default as GuardHandler;
  }
  return null;
}

export function loadGuardHandler(script: HTMLScriptElement, route: IRoute): void {
  importModule(script).then(handler => {
    if (handler) {
      route.guardHandler = handler;
    }
  });
}
