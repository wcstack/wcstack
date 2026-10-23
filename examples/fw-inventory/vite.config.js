import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

// `npm run dev` proxies the API to `node server.js` (PORT, default 3000).
const API = "http://localhost:" + (process.env.API_PORT || 3000);
// Vite's proxy keeps the browser's response open when the server behind it goes away, so an
// EventSource through it never reconnects: end the response on a proxy error
// (docs/framework-adapter-integration.md §9).
const endOnError = (proxy) => proxy.on("error", (_err, _req, res) => { try { res.destroy(); } catch {} });
const proxy = {
  "/api": { target: API, changeOrigin: true, configure: endOnError },
  "/photos": { target: API, changeOrigin: true },
};

// WCS_LOCAL=1: the repository's packages/*/dist instead of the @wcstack packages from npm (the e2e
// spec builds so, over the dists CI rebuilt from src).
const REPO = resolve(import.meta.dirname, "..", "..").replaceAll("\\", "/");
const local = process.env.WCS_LOCAL === "1"
  ? [
      { find: /^@wcstack\/([\w-]+)\/auto$/, replacement: `${REPO}/packages/$1/dist/auto.min.js` },
      { find: /^@wcstack\/([\w-]+)$/, replacement: `${REPO}/packages/$1/dist/index.esm.js` },
    ]
  : [];

export default defineConfig({
  plugins: [
    react(),
    vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("wcs-") } } }),
  ],
  resolve: { alias: local },
  server: { proxy, fs: { allow: [REPO] } },
  preview: { proxy },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        warehouse: resolve(import.meta.dirname, "warehouse.html"),
      },
    },
  },
});
