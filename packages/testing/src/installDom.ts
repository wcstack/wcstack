/**
 * Bare Node (no vitest `environment: 'happy-dom'`): create a happy-dom `Window`
 * and install its globals, using the same `installGlobals` `@wcstack/server` runs
 * for SSR. Returns an async restore function that also closes the window.
 *
 * Import order matters: `@wcstack/state`'s element classes pick their base class
 * when the module is evaluated, so `mount()` imports it lazily — after this
 * function has installed `HTMLElement`. Do the same for any other wcstack
 * package you bootstrap (`async () => (await import("@wcstack/router")).bootstrapRouter()`).
 *
 * `happy-dom` is an optional peer: it is only needed here. A `window` can also be
 * passed in (`installDom({ window })`) to skip the import entirely.
 */

import { installGlobals } from "@wcstack/server";

export interface InstallDomOptions {
  /** `window.location` for the page (default `http://localhost/`). */
  readonly url?: string;
  /** A ready-made happy-dom `Window`; when given, `happy-dom` is not imported. */
  readonly window?: unknown;
}

interface HappyDomWindowLike {
  readonly happyDOM: { close(): Promise<void> };
}

export async function installDom(options: InstallDomOptions = {}): Promise<() => Promise<void>> {
  const window = options.window ?? (await createWindow(options.url ?? "http://localhost/"));
  const restore = installGlobals(window as Parameters<typeof installGlobals>[0]);
  return async () => {
    restore();
    await (window as HappyDomWindowLike).happyDOM.close();
  };
}

async function createWindow(url: string): Promise<unknown> {
  let mod: { Window: new (options: { url: string }) => unknown };
  try {
    mod = (await import("happy-dom")) as typeof mod;
  } catch {
    throw new Error(
      "@wcstack/testing: installDom() needs happy-dom (npm i -D happy-dom), or pass { window } — under vitest with environment: 'happy-dom' it is not needed at all",
    );
  }
  return new mod.Window({ url });
}
