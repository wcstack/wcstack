import { Plugin } from 'vite';

interface WcstackViteOptions {
    /**
     * The tag names, when the page renames them (`bootstrapState({ tagNames: { state } })`,
     * the router's `tagNames.guardHandler`). Default `wcs-state` / `wcs-guard-handler`.
     */
    readonly tagNames?: {
        readonly state?: string;
        readonly guardHandler?: string;
    };
}
/**
 * The Vite plugin for pages written with wcstack tags (`plugins: [wcstack()]`).
 *
 * - `<wcs-state src="./state.ts">`: the engine loads the file with `import(src)` at run time, so
 *   Vite never sees it — the dev server serves it on request, but `vite build` would keep the
 *   attribute and emit no file. In a build, every local `src` of a `<wcs-state>` (the root state
 *   and `mount` volumes alike) is emitted as its own chunk with its `export default` kept (it shares
 *   chunks with the page's bundle), and the attribute becomes that file's URL under `base`. A `.json`
 *   src is emitted as an asset (the engine fetches a `.json` URL), a `publicDir` file is copied as it
 *   is, an external URL is left alone, and a local src with no file behind it fails the build.
 * - An inline `<script type="module">` inside `<wcs-state>` or `<wcs-guard-handler>` is the state or
 *   the guard, read by the element: Vite would move it into its bundle (dev and build). The plugin
 *   marks it `vite-ignore`, so Vite leaves it in the page.
 *
 * In dev a `src` is rewritten only the way Vite rewrites a `<script src>`: an absolute path gets the
 * `base`, and a relative one becomes absolute when the SPA fallback serves index.html for a deeper
 * URL (unless the page has a `<base>`).
 */
declare function wcstack(options?: WcstackViteOptions): Plugin;

export { wcstack as default, wcstack };
export type { WcstackViteOptions };
