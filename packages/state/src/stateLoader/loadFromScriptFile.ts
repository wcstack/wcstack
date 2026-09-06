import { raiseError } from "../raiseError";
import { IState } from "../types";

/**
 * `src` の値を **document の base URL** に対して解決する。
 *
 * `import(url)` の相対解決は「import を書いたモジュール」を基準にする。ここは
 * `@wcstack/state` の中なので、素の `import(url)` は `<wcs-state src>` を
 * **state パッケージの所在**から解決してしまう。同一オリジンに置いたページでは
 * たまたま一致して見えるが、CDN 一発（`https://esm.run/@wcstack/state/auto`）で
 * 読み込んだ瞬間に `src="/app.js"` が CDN 側の URL を指して 404 になる。
 *
 * `src` は HTML 属性なので、正しい基準は document の base URL である
 * （`src="*.json"` 側は `fetch` がそう解決しており、同じ属性が形式によって
 * 違う基準で解決されていた）。絶対 URL・`data:`・`blob:` は URL 解決で
 * そのまま素通りするため、既存の使い方は影響を受けない。
 */
export function resolveAgainstDocument(url: string): string {
  return new URL(url, document.baseURI).href;
}

export async function loadFromScriptFile(url: string): Promise<IState> {
  try {
    const module = await import(/* @vite-ignore */ resolveAgainstDocument(url));
    return module.default || {};
  } catch (e) {
    raiseError(`Failed to load script file: ${e}`);
  }
}
