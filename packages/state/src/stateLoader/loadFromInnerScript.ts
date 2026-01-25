import { IState } from "../types";

type ScriptModule = { default?: unknown };

export async function loadFromInnerScript(script: HTMLScriptElement, name: string): Promise<IState> {
  let scriptModule: ScriptModule | null = null;
  const uniq_comment = `\n//# sourceURL=${name}\n`;
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
  return (scriptModule && typeof scriptModule.default === 'object') ? scriptModule.default as IState : {};
}
