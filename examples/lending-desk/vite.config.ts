// Development: `vite` (DEV_PORT, default 5173), /api proxied to the API server (API_PORT, default 3001).
// Production: `vite build` → dist/, served by a plain static server plus the API (server/static.ts).
//
// `wcstack()` (@wcstack/typescript/vite) builds `<wcs-state src="src/state/app.ts">`: @wcstack/state loads
// the file with `import(src)` at run time, so Vite alone would emit nothing for it. The plugin emits it as a
// chunk of its own (keeping its `export default`) and rewrites the `src`; it also keeps the inline scripts of
// `<wcs-state>` (counter.html) and `<wcs-guard-handler>` (index.html) in the page.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig, type Alias } from "vite";
import { wcstack as wcstackFromNpm } from "@wcstack/typescript/vite";

const API = `http://127.0.0.1:${process.env.API_PORT ?? 3001}`;
const root = import.meta.dirname;

// WCS_LOCAL=1: the repository's packages/*/dist instead of the @wcstack packages from npm — the pages'
// `/auto` entries, `@wcstack/state/define` and the Vite plugin itself (the e2e spec builds so, over the
// dists CI rebuilt from src).
const LOCAL = process.env.WCS_LOCAL === "1";
const REPO = resolve(root, "..", "..").replaceAll("\\", "/");
const local: Alias[] = LOCAL
  ? [
      { find: /^@wcstack\/([\w-]+)\/auto$/, replacement: `${REPO}/packages/$1/dist/auto.min.js` },
      { find: /^@wcstack\/state\/define$/, replacement: `${REPO}/packages/state/dist/define.js` },
      { find: /^@wcstack\/([\w-]+)$/, replacement: `${REPO}/packages/$1/dist/index.esm.js` },
    ]
  : [];
const { wcstack } = LOCAL
  ? ((await import(pathToFileURL(`${REPO}/packages/typescript/dist/vite.js`).href)) as typeof import("@wcstack/typescript/vite"))
  : { wcstack: wcstackFromNpm };

// Vite's dev proxy keeps the browser's response open when the API goes away, so an EventSource
// through it never notices: end the response on a proxy error (the fw-inventory example does the same).
const endOnError = (proxy: { on(ev: "error", f: (err: Error, req: unknown, res: { destroy?: () => void }) => void): void }): void => {
  proxy.on("error", (_err, _req, res) => {
    try { res.destroy?.(); } catch { /* already gone */ }
  });
};

export default defineConfig({
  plugins: [wcstack()],
  resolve: { alias: local },
  server: {
    port: Number(process.env.DEV_PORT ?? 5173),
    strictPort: true,
    host: "127.0.0.1",
    proxy: { "/api": { target: API, changeOrigin: true, configure: endOnError } },
    ...(LOCAL ? { fs: { allow: [REPO] } } : {}),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2023",
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        counter: resolve(root, "counter.html"),
        qty: resolve(root, "qty-test.html"),
      },
    },
  },
});
